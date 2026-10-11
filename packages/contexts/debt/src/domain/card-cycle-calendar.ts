import { DomainError, Instant, LocalDate, WeekendAdjustment } from '@pf/shared-kernel';
import type { CardTerms, CardTermsVersion } from './card-types.js';

/**
 * `CardCycleCalendar` (openspec add-credit-cards, design decisión 2; capability `debt/credit-cards`): cierres, ciclos y
 * vencimientos de una tarjeta en fechas LOCALES del workspace (RISK-020). Puro y determinista, sin reloj.
 *
 *  - `closing(y, m) = date(y, m, min(statementDay, lastDay(y, m)))`: un cierre por mes, sin omitir ninguno.
 *  - El ciclo `k` es `(closing(k−1), closing(k)]`: empieza el día siguiente al cierre anterior.
 *  - El vencimiento nominal es la primera fecha POSTERIOR al cierre cuyo día es `min(dueDay, lastDay(mes))`; luego se
 *    aplica el ajuste de fin de semana del motor (`PREVIOUS` viernes anterior, `NEXT` lunes siguiente). Con
 *    `PREVIOUS` el vencimiento ajustado nunca queda antes del cierre (se recorta al día del cierre).
 *  - Un cambio de términos rige para los cierres con fecha >= `effectiveFrom` de la versión; la primera versión rige
 *    desde siempre (para consultar ciclos previos al registro). Los estados emitidos no cambian.
 */
export interface CardCycle {
  /** Primer día del ciclo (día siguiente al cierre anterior). */
  readonly start: LocalDate;
  readonly closing: LocalDate;
  /** Vencimiento sin ajuste de fin de semana: la fecha nominal de la ocurrencia del plan de pago. */
  readonly nominalDue: LocalDate;
  /** Vencimiento con el ajuste de fin de semana. */
  readonly dueDate: LocalDate;
  /** Términos con los que cierra este ciclo. */
  readonly terms: CardTerms;
}

const NEG_INFINITY = LocalDate.of(1, 1, 1);
/** Meses máximos a explorar al buscar un cierre (cubre cualquier hueco entre versiones de términos). */
const SEARCH_MONTHS = 6;

const monthDate = (year: number, month: number, day: number): LocalDate =>
  LocalDate.of(year, month, Math.min(day, LocalDate.daysInMonth(year, month)));

const addMonths = (year: number, month: number, delta: number): { year: number; month: number } => {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
};

export function validateDay(value: unknown, pointer: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 31) {
    throw new DomainError('VALIDATION_FAILED', 'day must be an integer between 1 and 31').at(pointer);
  }
  return value;
}

export class CardCycleCalendar {
  private readonly parsed: readonly { readonly terms: CardTerms; readonly from: LocalDate }[];

  private constructor(readonly versions: readonly CardTermsVersion[]) {
    if (versions.length === 0) throw new DomainError('VALIDATION_FAILED', 'at least one terms version');
    const sorted = [...versions].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
    this.parsed = sorted.map((v, i) => ({
      terms: {
        statementDay: v.statementDay,
        dueDay: v.dueDay,
        dueWeekendAdjustment: v.dueWeekendAdjustment,
      },
      // La primera versión rige desde siempre.
      from: i === 0 ? NEG_INFINITY : LocalDate.parse(v.effectiveFrom),
    }));
  }

  /** Calendario con una sola versión de términos (vigente desde siempre). */
  static single(terms: CardTerms): CardCycleCalendar {
    return new CardCycleCalendar([{ ...terms, effectiveFrom: '0001-01-01' }]);
  }

  static fromVersions(versions: readonly CardTermsVersion[]): CardCycleCalendar {
    return new CardCycleCalendar(versions);
  }

  /** "Hoy" del workspace: la fecha local del instante en la zona IANA (independiente de la zona del proceso). */
  static todayOf(at: Date | Instant, timeZone: string): LocalDate {
    const instant = at instanceof Date ? Instant.fromDate(at) : at;
    return LocalDate.ofInstant(instant, timeZone);
  }

  /**
   * Cambio de términos desde el ciclo abierto (design decisión 2): rige para los cierres >= max(día siguiente al
   * último cierre emitido, hoy). Un cambio con la misma fecha efectiva reemplaza al anterior.
   */
  withTerms(
    terms: CardTerms,
    input: { readonly lastIssuedClosing: LocalDate | null; readonly today: LocalDate },
  ): CardCycleCalendar {
    const afterIssued = input.lastIssuedClosing ? input.lastIssuedClosing.plusDays(1) : NEG_INFINITY;
    const effective = afterIssued.compare(input.today) > 0 ? afterIssued : input.today;
    const effectiveFrom = effective.toString();
    const kept = this.versions.filter((v, i) => i === 0 || v.effectiveFrom < effectiveFrom);
    return new CardCycleCalendar([...kept, { ...terms, effectiveFrom }]);
  }

  // ───────────────────────────────────────────── cierres

  private versionFor(date: LocalDate): CardTerms {
    let current = (this.parsed[0] as (typeof this.parsed)[number]).terms;
    for (const v of this.parsed) {
      if (v.from.compare(date) <= 0) current = v.terms;
    }
    return current;
  }

  /** Cierres con fecha en el mes (puede haber más de uno solo en el mes de un cambio de términos). */
  private closingsInMonth(year: number, month: number): LocalDate[] {
    const out: LocalDate[] = [];
    this.parsed.forEach((v, i) => {
      const closing = monthDate(year, month, v.terms.statementDay);
      const next = this.parsed[i + 1];
      if (closing.compare(v.from) >= 0 && (!next || closing.compare(next.from) < 0)) out.push(closing);
    });
    return out.sort((a, b) => a.compare(b));
  }

  /** Primer cierre con fecha >= `date`. */
  closingOnOrAfter(date: LocalDate): LocalDate {
    for (let i = 0; i <= SEARCH_MONTHS; i += 1) {
      const m = addMonths(date.year, date.month, i);
      const found = this.closingsInMonth(m.year, m.month).find((c) => c.compare(date) >= 0);
      if (found) return found;
    }
    throw new DomainError('VALIDATION_FAILED', `no closing found on or after ${date.toString()}`);
  }

  /** Último cierre con fecha < `date`. */
  closingBefore(date: LocalDate): LocalDate {
    for (let i = 0; i <= SEARCH_MONTHS; i += 1) {
      const m = addMonths(date.year, date.month, -i);
      const found = this.closingsInMonth(m.year, m.month)
        .reverse()
        .find((c) => c.compare(date) < 0);
      if (found) return found;
    }
    throw new DomainError('VALIDATION_FAILED', `no closing found before ${date.toString()}`);
  }

  /** Todos los cierres con `from <= cierre <= to`, ascendentes. */
  closingsBetween(from: LocalDate, to: LocalDate): LocalDate[] {
    const out: LocalDate[] = [];
    let cursor = from;
    while (cursor.compare(to) <= 0) {
      const closing = this.closingOnOrAfter(cursor);
      if (closing.compare(to) > 0) break;
      out.push(closing);
      cursor = closing.plusDays(1);
    }
    return out;
  }

  // ───────────────────────────────────────────── ciclos

  private nominalDueOf(closing: LocalDate, terms: CardTerms): LocalDate {
    const sameMonth = monthDate(closing.year, closing.month, terms.dueDay);
    if (sameMonth.compare(closing) > 0) return sameMonth;
    const next = addMonths(closing.year, closing.month, 1);
    return monthDate(next.year, next.month, terms.dueDay);
  }

  private build(closing: LocalDate): CardCycle {
    const terms = this.versionFor(closing);
    const nominalDue = this.nominalDueOf(closing, terms);
    const adjusted = WeekendAdjustment.apply(nominalDue, terms.dueWeekendAdjustment);
    return {
      start: this.closingBefore(closing).plusDays(1),
      closing,
      nominalDue,
      dueDate: adjusted.compare(closing) < 0 ? closing : adjusted,
      terms,
    };
  }

  /** Ciclo que cierra exactamente en `closing` (debe ser un cierre de la secuencia). */
  cycleClosingAt(closing: LocalDate): CardCycle {
    if (this.closingOnOrAfter(closing).compare(closing) !== 0) {
      throw new DomainError('VALIDATION_FAILED', `${closing.toString()} is not a closing date of the card`);
    }
    return this.build(closing);
  }

  /** Ciclo que contiene la fecha de negocio. */
  cycleContaining(date: LocalDate): CardCycle {
    return this.build(this.closingOnOrAfter(date));
  }

  /** Ciclo abierto: el de menor cierre >= hoy. */
  openCycle(today: LocalDate): CardCycle {
    return this.cycleContaining(today);
  }

  /** Último ciclo cerrado (cierre < hoy). */
  lastClosedCycle(today: LocalDate): CardCycle {
    return this.build(this.closingBefore(today));
  }

  /** Hasta `limit` ciclos cerrados (cierre < hoy), del más reciente al más antiguo. */
  closedCycles(today: LocalDate, limit: number): CardCycle[] {
    const out: CardCycle[] = [];
    let cursor = today;
    for (let i = 0; i < limit; i += 1) {
      const closing = this.closingBefore(cursor);
      out.push(this.build(closing));
      cursor = closing;
    }
    return out;
  }

  /**
   * Ciclos cuyo vencimiento NOMINAL es `nominalDue` (casi siempre uno; dos si el cierre cae en un mes corto y el día
   * de vencimiento es mayor, p. ej. cierre 28 y vencimiento 31). Los pagos del plan los agregan.
   */
  cyclesDueOn(nominalDue: LocalDate): CardCycle[] {
    const from = nominalDue.plusDays(-70);
    return this.closingsBetween(from, nominalDue)
      .map((c) => this.build(c))
      .filter((c) => c.nominalDue.equals(nominalDue));
  }
}
