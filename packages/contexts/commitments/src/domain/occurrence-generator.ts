import {
  LocalDate,
  WeekendAdjustment,
  expandRecurrence,
  type DateWindow,
  type RecurrenceRule,
} from '@pf/shared-kernel';
import type { AmountSpec } from './amount-spec.js';
import {
  explicitItemsOf,
  ruleOfSchedule,
  type DefinitionVersion,
  type IndexedPrice,
} from './definition-version.js';
import type { OccurrenceState } from './recurring-occurrence.js';

/** Ocurrencia que la regla produce para una ventana (aún no persistida). */
export interface Candidate {
  readonly occurrenceDate: LocalDate;
  readonly dueDate: LocalDate;
  readonly versionNo: number;
  readonly expected: AmountSpec;
  readonly currency: string;
  /** Si la versión indexa el precio, la aplicación estima el monto con la tasa vigente al generar. */
  readonly indexedPrice?: IndexedPrice;
  /** Clave del ítem de un calendario explícito (en préstamos, el número de cuota). */
  readonly scheduleKey?: string;
}

export interface GeneratorSource {
  readonly versions: readonly DefinitionVersion[];
  /** Fecha de fin fijada por "terminar": la serie no produce fechas posteriores. */
  readonly endDate: string | null;
}

const MAX_DATE = LocalDate.of(9999, 12, 31);

function intervalsOf(
  versions: readonly DefinitionVersion[],
): { version: DefinitionVersion; from: LocalDate; to: LocalDate }[] {
  const sorted = [...versions].sort((a, b) => a.versionNo - b.versionNo);
  // Versión vigente para una fecha: la última (mayor versionNo) con effectiveFrom ≤ fecha.
  const out: { version: DefinitionVersion; from: LocalDate; to: LocalDate }[] = [];
  sorted.forEach((version, i) => {
    const from = LocalDate.parse(version.effectiveFrom);
    let to = MAX_DATE;
    for (const later of sorted.slice(i + 1)) {
      const next = LocalDate.parse(later.effectiveFrom);
      const bound = next.plusDays(-1);
      if (bound.compare(to) < 0) to = bound;
    }
    if (to.compare(from) >= 0) out.push({ version, from, to });
  });
  return out;
}

/**
 * Candidatos de una ventana a partir de las versiones (design decisión 6): cada versión produce las fechas
 * nominales de su regla dentro de [effectiveFrom, effectiveFrom de la siguiente − 1] ∩ ventana ∩ fin de la serie.
 * Puro y determinista; la fecha nominal es la clave de INV-013 y el vencimiento aplica el ajuste de fin de semana.
 */
export function candidates(source: GeneratorSource, window: DateWindow): Candidate[] {
  const cap = source.endDate ? LocalDate.parse(source.endDate) : null;
  const out: Candidate[] = [];
  for (const { version, from, to } of intervalsOf(source.versions)) {
    let lo = window.from.compare(from) > 0 ? window.from : from;
    let hi = window.to.compare(to) < 0 ? window.to : to;
    if (cap !== null && cap.compare(hi) < 0) hi = cap;
    if (hi.compare(lo) < 0) continue;
    if (version.schedule.cadence === 'EXPLICIT') {
      // Calendario explícito (N3): un candidato por ítem dentro de la ventana; monto FIXED del ítem, sin ajustes.
      for (const item of explicitItemsOf(version.schedule)) {
        const date = LocalDate.parse(item.dueDate);
        if (date.compare(lo) < 0 || date.compare(hi) > 0) continue;
        out.push({
          occurrenceDate: date,
          dueDate: date,
          versionNo: version.versionNo,
          expected: { type: 'FIXED', amount: item.amount, min: null, max: null },
          currency: version.currency,
          scheduleKey: item.key,
        });
      }
      continue;
    }
    const rule: RecurrenceRule = ruleOfSchedule(version.schedule);
    lo = lo.compare(rule.dtstart) < 0 ? rule.dtstart : lo;
    for (const date of expandRecurrence(rule, { from: lo, to: hi })) {
      out.push({
        occurrenceDate: date,
        dueDate: WeekendAdjustment.apply(date, version.schedule.weekendAdjustment),
        versionNo: version.versionNo,
        expected: version.amount,
        currency: version.currency,
        ...(version.indexedPrice ? { indexedPrice: version.indexedPrice } : {}),
      });
    }
  }
  return out.sort((a, b) => a.occurrenceDate.compare(b.occurrenceDate));
}

/**
 * Fin de la serie: `finite = false` si no tiene fin (sin `until`, `COUNT` ni fecha de fin fijada); si es finita,
 * `last` es su última fecha nominal (`null` si ninguna fecha cae dentro de la serie).
 */
export function seriesEnd(
  source: GeneratorSource,
): { readonly finite: false } | { readonly finite: true; readonly last: LocalDate | null } {
  const latest = source.versions.reduce((a, b) => (b.versionNo > a.versionNo ? b : a));
  if (latest.schedule.cadence === 'EXPLICIT') {
    const cap = source.endDate;
    const dates = explicitItemsOf(latest.schedule)
      .map((i) => i.dueDate)
      .filter((d) => cap === null || d <= cap)
      .sort();
    const last = dates.at(-1);
    return { finite: true, last: last ? LocalDate.parse(last) : null };
  }
  const rule = ruleOfSchedule(latest.schedule);
  const cap = source.endDate ? LocalDate.parse(source.endDate) : null;
  let bound: LocalDate | null = rule.until;
  if (cap !== null && (bound === null || cap.compare(bound) < 0)) bound = cap;
  if (bound === null && rule.count === null) return { finite: false };
  const all = expandRecurrence(rule, { from: rule.dtstart, to: bound ?? MAX_DATE });
  return { finite: true, last: all[all.length - 1] ?? null };
}

export const OccurrenceGenerator = {
  candidates,

  /** Candidatos de la ventana que aún no existen (clave: fecha nominal). Re-ejecutar no cambia el resultado. */
  plan(source: GeneratorSource, window: DateWindow, existing: ReadonlySet<string>): Candidate[] {
    return candidates(source, window).filter((c) => !existing.has(c.occurrenceDate.toString()));
  },

  /**
   * Inicio de la primera ventana (D131): `max(dtstart, inicio del periodo financiero que contiene hoy)`; una definición
   * con inicio en el pasado no genera ocurrencias atrasadas de periodos anteriores.
   */
  initialStart(startDate: string, periodStart: LocalDate): LocalDate {
    const start = LocalDate.parse(startDate);
    return start.compare(periodStart) > 0 ? start : periodStart;
  },
} as const;

/** Estado de una ocurrencia existente relevante para el planificador (por fecha nominal). */
export type ExistingOccurrence = Pick<
  OccurrenceState,
  'id' | 'occurrenceDate' | 'status' | 'cancelReason' | 'dueDate' | 'amountOverridden' | 'dateOverridden'
>;
