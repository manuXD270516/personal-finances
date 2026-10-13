import { LocalDate, PeriodCalendar, plusDays } from '@pf/shared-kernel';
import type { ConversionCostGrouping, CostPeriod } from './conversion-cost.js';

/** Periodo financiero existente del workspace (PLANNING, `PeriodQuery.listPeriods`). */
export interface KnownPeriod {
  readonly label: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  /** Día de inicio con que se calculó (`FinancialPeriodDto.startDay`); opcional. */
  readonly startDay?: number;
}

/** Máximo de periodos que abarca una consulta del análisis (D246). */
export const MAX_COST_PERIODS = 24;

/**
 * Asignación de una fecha de negocio a su periodo de agrupación del análisis de costo (D246; RISK-020): por periodo
 * financiero (por defecto) o mes calendario. La fecha de negocio manda, nunca el instante ni la zona. En periodo
 * financiero gana el periodo EXISTENTE que contiene la fecha; si aún no existe (PLANNING provisiona los periodos de forma
 * asíncrona), se aplica la regla del día de inicio. Puro.
 */
export class CostPeriodCalendar {
  private readonly known: readonly KnownPeriod[];

  private constructor(
    readonly grouping: ConversionCostGrouping,
    known: readonly KnownPeriod[],
    private readonly startDay: number,
  ) {
    this.known = [...known].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  }

  /**
   * `startDay`: día de inicio vigente del workspace (1..28) o `null` si no se conoce: entonces se usa el del periodo
   * existente más cercano (o 1 sin periodos).
   */
  static of(
    grouping: ConversionCostGrouping,
    known: readonly KnownPeriod[],
    startDay: number | null,
  ): CostPeriodCalendar {
    const fallback = startDay ?? known.at(-1)?.startDay ?? startDayOf(known.at(-1)) ?? 1;
    return new CostPeriodCalendar(grouping, known, fallback);
  }

  periodOf(date: string): CostPeriod {
    const day = LocalDate.parse(date);
    if (this.grouping === 'FINANCIAL_PERIOD') {
      const own = this.known.find((p) => p.periodStart <= date && date <= p.periodEnd);
      if (own) return { label: own.label, from: own.periodStart, to: own.periodEnd };
    }
    const planned = PeriodCalendar.periodContaining(
      day,
      this.grouping === 'CALENDAR_MONTH' ? 1 : this.startDay,
    );
    return { label: planned.label, from: planned.range.start.toString(), to: planned.range.end.toString() };
  }

  /** Periodos distintos que cubren `[from, to]`, en orden (para validar el máximo de la consulta). */
  periodsBetween(from: string, to: string): CostPeriod[] {
    const out: CostPeriod[] = [];
    let cursor = from;
    while (cursor <= to && out.length <= MAX_COST_PERIODS) {
      const p = this.periodOf(cursor);
      out.push(p);
      cursor = plusDays(LocalDate.parse(p.to), 1).toString();
    }
    return out;
  }
}

/** Día de inicio de un periodo existente: el de su fecha de inicio (los de transición no empiezan en `startDay`). */
const startDayOf = (p: KnownPeriod | undefined): number | undefined =>
  p ? Math.min(28, Math.max(1, LocalDate.parse(p.periodStart).day)) : undefined;
