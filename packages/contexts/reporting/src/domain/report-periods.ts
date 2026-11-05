import { DomainError, LocalDate, plusDays, plusMonths } from '@pf/shared-kernel';
import { CostPeriodCalendar, MAX_COST_PERIODS, type KnownPeriod } from './cost-periods.js';

/** Agrupación temporal de los reportes (por omisión el periodo financiero, D246/D363). */
export type ReportGrouping = 'FINANCIAL_PERIOD' | 'CALENDAR_MONTH';

/** Periodo de un reporte: rango recortado al pedido, con marca de parcial (contiene hoy) y cantidad de días. */
export interface ReportPeriod {
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly partial: boolean;
  readonly days: number;
}

/** Máximo de periodos de un reporte y de semanas ISO de la granularidad semanal (design decisión 7). */
export const MAX_REPORT_PERIODS = MAX_COST_PERIODS;
export const MAX_REPORT_WEEKS = 106;

/** Días inclusivos entre dos fechas de negocio. */
export const daysBetween = (from: string, to: string): number =>
  LocalDate.parse(to).toEpochDay() - LocalDate.parse(from).toEpochDay() + 1;

const invalid = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

/** Semana ISO (lunes a domingo) que contiene la fecha: etiqueta `YYYY-Www` y lunes. */
export function isoWeekOf(date: string): { label: string; monday: string; sunday: string } {
  const day = LocalDate.parse(date);
  const epoch = day.toEpochDay();
  // 1970-01-01 fue jueves: lunes = 0 … domingo = 6.
  const weekday = (((epoch + 3) % 7) + 7) % 7;
  const mondayEpoch = epoch - weekday;
  // El jueves de la semana decide el año ISO.
  const thursday = LocalDate.ofEpochDay(mondayEpoch + 3);
  const jan1 = LocalDate.of(thursday.year, 1, 1).toEpochDay();
  const week = Math.floor((thursday.toEpochDay() - jan1) / 7) + 1;
  return {
    label: `${thursday.year}-W${String(week).padStart(2, '0')}`,
    monday: LocalDate.ofEpochDay(mondayEpoch).toString(),
    sunday: LocalDate.ofEpochDay(mondayEpoch + 6).toString(),
  };
}

/**
 * `ReportPeriodCalendar` (add-financial-reports, design decisión 7): periodos financieros del workspace (o meses
 * calendario) asignados por fecha de negocio en la zona del workspace, semanas ISO, tope de 24 periodos y 106
 * semanas, y periodo parcial (el que contiene hoy). Puro; se apoya en `CostPeriodCalendar` para la asignación.
 */
export class ReportPeriodCalendar {
  private constructor(
    private readonly base: CostPeriodCalendar,
    readonly grouping: ReportGrouping,
    readonly today: string,
  ) {}

  static of(
    grouping: ReportGrouping,
    known: readonly KnownPeriod[],
    startDay: number | null,
    today: string,
  ): ReportPeriodCalendar {
    if (grouping !== 'FINANCIAL_PERIOD' && grouping !== 'CALENDAR_MONTH') {
      throw invalid('grouping must be FINANCIAL_PERIOD or CALENDAR_MONTH', '/grouping');
    }
    LocalDate.parse(today);
    return new ReportPeriodCalendar(CostPeriodCalendar.of(grouping, known, startDay), grouping, today);
  }

  /** `partial` se decide sobre el periodo COMPLETO (`fullFrom`..`fullTo`), aunque el rango lo recorte. */
  private make(label: string, from: string, to: string, fullFrom = from, fullTo = to): ReportPeriod {
    return {
      label,
      from,
      to,
      partial: fullFrom <= this.today && this.today <= fullTo,
      days: daysBetween(from, to),
    };
  }

  /** Periodo COMPLETO (sin recortar) que contiene la fecha. */
  periodOf(date: string): ReportPeriod {
    const p = this.base.periodOf(date);
    return this.make(p.label, p.from, p.to);
  }

  /** Periodos que cubren `[from, to]`, recortados al rango. Más de 24 ⇒ `VALIDATION_FAILED`. */
  periods(from: string, to: string): ReportPeriod[] {
    this.assertRange(from, to);
    const out: ReportPeriod[] = [];
    let cursor = from;
    while (cursor <= to) {
      const p = this.periodOf(cursor);
      out.push(this.make(p.label, p.from < from ? from : p.from, p.to > to ? to : p.to, p.from, p.to));
      if (out.length > MAX_REPORT_PERIODS) {
        throw invalid(`the range covers more than ${MAX_REPORT_PERIODS} periods`, '/from');
      }
      cursor = plusDays(LocalDate.parse(p.to), 1).toString();
    }
    return out;
  }

  /** Semanas ISO recortadas al rango. Más de 106 ⇒ `VALIDATION_FAILED`. */
  weeks(from: string, to: string): ReportPeriod[] {
    this.assertRange(from, to);
    const out: ReportPeriod[] = [];
    let cursor = from;
    while (cursor <= to) {
      const w = isoWeekOf(cursor);
      out.push(
        this.make(
          w.label,
          w.monday < from ? from : w.monday,
          w.sunday > to ? to : w.sunday,
          w.monday,
          w.sunday,
        ),
      );
      if (out.length > MAX_REPORT_WEEKS) {
        throw invalid(`the range covers more than ${MAX_REPORT_WEEKS} weeks`, '/from');
      }
      cursor = plusDays(LocalDate.parse(w.sunday), 1).toString();
    }
    return out;
  }

  /** Periodo completo inmediatamente anterior (del mismo tipo). */
  previous(period: { readonly from: string }): ReportPeriod {
    return this.periodOf(plusDays(LocalDate.parse(period.from), -1).toString());
  }

  /** Periodo completo que contiene la fecha de inicio un año antes (YoY). */
  yearAgo(period: { readonly from: string }): ReportPeriod {
    return this.periodOf(plusMonths(LocalDate.parse(period.from), -12).toString());
  }

  /** Los `count` periodos completos inmediatamente anteriores a `period`, del más reciente al más antiguo. */
  priorPeriods(period: { readonly from: string }, count: number): ReportPeriod[] {
    const out: ReportPeriod[] = [];
    let ref: { readonly from: string } = period;
    for (let i = 0; i < count; i += 1) {
      const p = this.previous(ref);
      out.push(p);
      ref = p;
    }
    return out;
  }

  private assertRange(from: string, to: string): void {
    for (const [value, pointer] of [
      [from, '/from'],
      [to, '/to'],
    ] as const) {
      try {
        LocalDate.parse(value);
      } catch {
        throw invalid(`${pointer.slice(1)} must be a business date YYYY-MM-DD`, pointer);
      }
    }
    if (from > to) throw invalid('from must not be after to', '/from');
  }
}
