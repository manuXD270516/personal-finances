import {
  FinancialPeriodCalendar,
  Money,
  PeriodCalendar,
  dec,
  shiftLabel,
  type Currency,
  type Decimal,
  type LocalDate,
  type PlannedPeriod,
} from '@pf/shared-kernel';

/** Fuente del ritmo: historia de periodos terminados, aporte planificado, aporte simulado o ninguna. */
export type PaceSource = 'HISTORY' | 'PLAN' | 'SIMULATED' | 'NONE';

/** Horizonte máximo de la fecha esperada: 100 años de periodos. */
export const MAX_EXPECTED_PERIODS = 1200;

export interface PaceWindowInput {
  readonly startDay: number;
  readonly today: LocalDate;
  readonly goalStartDate: LocalDate;
  /** Periodos del ritmo de la meta (1..12). */
  readonly pacePeriods: number;
}

/**
 * Periodos terminados que alimentan el ritmo (decisión 13): los últimos `pacePeriods` periodos con fin anterior a hoy
 * y fin igual o posterior a la fecha de inicio de la meta (si hay menos, los que haya), del más antiguo al más reciente.
 */
export function paceWindow(input: PaceWindowInput): readonly PlannedPeriod[] {
  return FinancialPeriodCalendar.periodsBefore(input.startDay, input.today, input.pacePeriods)
    .filter((p) => p.range.end.compare(input.goalStartDate) >= 0)
    .reverse();
}

export interface PeriodNet {
  /** Σ neta de los movimientos del periodo en la moneda del objetivo (reasignaciones incluidas). */
  readonly net: Decimal;
  /** `false` si algún movimiento en otra moneda quedó fuera por falta de tasa. */
  readonly complete: boolean;
}

export interface ExpectedDateInput extends PaceWindowInput {
  /** Restante (objetivo − acumulado, no negativo) sin redondear. */
  readonly remaining: Decimal;
  readonly currency: Currency;
  /** Neto por etiqueta de periodo terminado (los ausentes cuentan 0). */
  readonly periodNets: ReadonlyMap<string, PeriodNet>;
  /** Aporte mensual planificado (moneda del objetivo); respaldo si no hay periodos terminados. */
  readonly planMonthly: Decimal | null;
  /** Fecha en que se alcanzó el objetivo (restante 0). */
  readonly achievedOn: LocalDate | null;
  /** Simulación: reemplaza el ritmo por este aporte mensual. */
  readonly simulatedPace?: Decimal | null | undefined;
}

export interface ExpectedDate {
  /** `null` sin ritmo (`NO_PACE`) o si se alcanzaría en más de `MAX_EXPECTED_PERIODS` periodos. */
  readonly date: LocalDate | null;
  readonly reason: 'NO_PACE' | 'BEYOND_HORIZON' | null;
  readonly pace: Money | null;
  readonly paceExact: Decimal | null;
  readonly source: PaceSource;
  /** Periodos terminados considerados (0 con ritmo del plan o simulado). */
  readonly periods: number;
  readonly complete: boolean;
}

/**
 * `ExpectedDateCalculator` (openspec add-savings-goals, decisión 13; FR-GOALS-003): ritmo = promedio de los movimientos
 * netos de los últimos N periodos terminados (el aporte planificado si no hay ninguno). Fecha esperada = último día del
 * periodo en que, desde el actual inclusive y al ritmo calculado, se cubre el restante. Sin ritmo (o ≤ 0) no hay fecha.
 */
export function calculateExpectedDate(input: ExpectedDateInput): ExpectedDate {
  const { currency } = input;
  let paceExact: Decimal | null;
  let source: PaceSource;
  let periods = 0;
  let complete = true;
  if (input.simulatedPace !== undefined && input.simulatedPace !== null) {
    paceExact = input.simulatedPace;
    source = 'SIMULATED';
  } else {
    const window = paceWindow(input);
    if (window.length > 0) {
      let sum = dec('0');
      for (const p of window) {
        const net = input.periodNets.get(p.label);
        if (net) {
          sum = sum.plus(net.net);
          if (!net.complete) complete = false;
        }
      }
      paceExact = sum.div(window.length);
      source = 'HISTORY';
      periods = window.length;
    } else if (input.planMonthly !== null) {
      paceExact = input.planMonthly;
      source = 'PLAN';
    } else {
      paceExact = null;
      source = 'NONE';
    }
  }
  const pace = paceExact === null ? null : Money.roundToScale(paceExact, currency);
  if (input.remaining.lte(0)) {
    return {
      date: input.achievedOn ?? input.today,
      reason: null,
      pace,
      paceExact,
      source,
      periods,
      complete,
    };
  }
  if (paceExact === null || paceExact.lte(0)) {
    return { date: null, reason: 'NO_PACE', pace, paceExact, source, periods, complete };
  }
  const k = input.remaining.div(paceExact).ceil();
  if (k.gt(MAX_EXPECTED_PERIODS)) {
    return { date: null, reason: 'BEYOND_HORIZON', pace, paceExact, source, periods, complete };
  }
  const current = FinancialPeriodCalendar.periodOf(input.startDay, input.today);
  const label = shiftLabel(current.label, k.toNumber() - 1);
  return {
    date: PeriodCalendar.rangeFor(label, input.startDay).end,
    reason: null,
    pace,
    paceExact,
    source,
    periods,
    complete,
  };
}
