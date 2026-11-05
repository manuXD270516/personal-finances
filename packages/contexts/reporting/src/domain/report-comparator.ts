import {
  dec,
  DomainError,
  LocalDate,
  type Money,
  present,
  type Currency,
  type Decimal,
} from '@pf/shared-kernel';
import { PeriodComparator } from './period-comparator.js';
import { type ReportConversionPolicy, type ReportAmount } from './report-conversion.js';
import {
  daysBetween,
  MAX_REPORT_PERIODS,
  type ReportPeriod,
  type ReportPeriodCalendar,
} from './report-periods.js';

export type ReportCompareMode =
  'NONE' | 'PREVIOUS_PERIOD' | 'PREVIOUS_YEAR' | 'CUSTOM' | 'PREVIOUS_PERIOD_TO_DATE';

export const ROLLING_WINDOWS = [3, 6, 12] as const;
export type RollingWindow = (typeof ROLLING_WINDOWS)[number];

/** Variación de una cifra contra su comparada (D367: `isNew` si lo comparado es 0 y lo actual no). */
export interface ReportVariation {
  readonly compared: ReportAmount;
  readonly deltaAbs: Money;
  readonly deltaPct: string | null;
  readonly isNew: boolean;
}

/** Línea base del promedio móvil de los N periodos completos anteriores. */
export interface ReportBaseline {
  readonly periods: RollingWindow;
  readonly average: Money | null;
  readonly periodsUsed: number;
  readonly insufficient: boolean;
  readonly deltaAbs: Money | null;
  readonly deltaPct: string | null;
}

/** Periodo emparejado con su contraparte de comparación (puede ser un tramo más corto: "a la fecha"). */
export interface ComparisonPair {
  readonly current: ReportPeriod;
  readonly compared: ReportPeriod;
}

const invalid = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

/**
 * `ReportComparator` (FR-REPORTING-009, design decisión 7): emparejamiento de periodos para MoM, YoY, rango
 * personalizado y "a la fecha", variación absoluta y porcentual (2 decimales HALF_EVEN sobre el valor absoluto del
 * comparado, vía `PeriodComparator.variation`) y promedio móvil. Puro.
 */
export const ReportComparator = {
  /**
   * Pares (periodo, comparado) para MoM, YoY o "a la fecha". `CUSTOM` no empareja por periodo (ver `customRange`).
   * En "a la fecha" el periodo en curso se recorta a hoy y el comparado a la misma cantidad de días desde su inicio,
   * acotada a su último día.
   */
  pairs(
    mode: Exclude<ReportCompareMode, 'NONE' | 'CUSTOM'>,
    periods: readonly ReportPeriod[],
    calendar: ReportPeriodCalendar,
  ): ComparisonPair[] {
    return periods.map((current) => {
      if (mode === 'PREVIOUS_YEAR') return { current, compared: calendar.yearAgo(current) };
      const previous = calendar.previous(current);
      if (mode === 'PREVIOUS_PERIOD') return { current, compared: previous };
      // PREVIOUS_PERIOD_TO_DATE
      if (!current.partial) return { current, compared: previous };
      const elapsed =
        LocalDate.parse(calendar.today).toEpochDay() - LocalDate.parse(current.from).toEpochDay();
      const comparedTo = LocalDate.ofEpochDay(
        Math.min(
          LocalDate.parse(previous.from).toEpochDay() + elapsed,
          LocalDate.parse(previous.to).toEpochDay(),
        ),
      ).toString();
      return {
        current: { ...current, to: calendar.today, days: daysBetween(current.from, calendar.today) },
        compared: { ...previous, to: comparedTo, days: daysBetween(previous.from, comparedTo) },
      };
    });
  },

  /** Rango personalizado: hasta 24 periodos; si difiere la cantidad de días se informa y puede normalizarse. */
  customRange(
    compareFrom: string | undefined,
    compareTo: string | undefined,
    calendar: ReportPeriodCalendar,
  ): { periods: ReportPeriod[]; days: number } {
    if (!compareFrom || !compareTo) {
      throw invalid('compareFrom and compareTo are required with compare=CUSTOM', '/compareFrom');
    }
    const periods = calendar.periods(compareFrom, compareTo);
    if (periods.length > MAX_REPORT_PERIODS)
      throw invalid('the comparison range is too long', '/compareFrom');
    return { periods, days: daysBetween(compareFrom, compareTo) };
  },

  variation(current: ReportAmount, compared: ReportAmount, target: Currency): ReportVariation {
    const v = PeriodComparator.variation(current.exact, compared.exact);
    return {
      compared,
      deltaAbs: present(v.deltaAbs, target),
      deltaPct: v.deltaPct,
      isNew: v.isNew,
    };
  },

  /**
   * Periodos que alimentan el promedio móvil de `period`: los `window` completos inmediatamente anteriores. Los que
   * terminan antes del primer asiento del workspace no cuentan; con menos de `window` el historial es insuficiente.
   */
  baselinePeriods(
    period: ReportPeriod,
    window: RollingWindow,
    calendar: ReportPeriodCalendar,
    firstActivityDate: string | null,
  ): { prior: ReportPeriod[]; usable: ReportPeriod[]; insufficient: boolean } {
    const prior = calendar.priorPeriods(period, window);
    const usable = prior.filter((p) => firstActivityDate !== null && p.to >= firstActivityDate && !p.partial);
    return { prior, usable, insufficient: usable.length < window };
  },

  /** Línea base y variación contra el promedio de `values` (sus `exact` consolidados). */
  baseline(
    window: RollingWindow,
    current: ReportAmount,
    values: readonly Decimal[] | null,
    target: Currency,
  ): ReportBaseline {
    if (values === null || values.length < window) {
      return {
        periods: window,
        average: null,
        periodsUsed: values?.length ?? 0,
        insufficient: true,
        deltaAbs: null,
        deltaPct: null,
      };
    }
    const average = values.reduce((a, v) => a.plus(v), dec('0')).div(window);
    const v = PeriodComparator.variation(current.exact, average);
    return {
      periods: window,
      average: present(average, target),
      periodsUsed: values.length,
      insufficient: false,
      deltaAbs: present(v.deltaAbs, target),
      deltaPct: v.deltaPct,
    };
  },

  /** Cifra en cero (para comparar contra periodos sin movimientos). */
  zero(policy: ReportConversionPolicy): ReportAmount {
    return policy.zero();
  },
} as const;
