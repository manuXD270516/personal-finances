import { dec, LocalDate, Money, type Currency, type Decimal } from '@pf/shared-kernel';

/**
 * Riesgo de exceder una línea de presupuesto (openspec add-budget-overrun-risk, decisiones 2 y 3; FR-REPORTING-020).
 * DS puro: sin I/O ni reloj. Todo con Decimal exacto; los montos se materializan a la escala de la moneda del plan con
 * HALF_EVEN solo al presentarlos (y antes de comparar con la referencia, para que lo mostrado y el nivel coincidan).
 */
export type BudgetRiskLevel = 'EXCEEDED' | 'LIKELY' | 'POSSIBLE' | 'UNLIKELY' | 'NOT_AVAILABLE';
export type BudgetRiskReason = 'LINE_TYPE' | 'NO_REFERENCE' | 'TOO_EARLY';
export type BudgetRiskBasis = 'RUN_RATE' | 'FORECAST';
export type BudgetRiskLineKind = 'FIXED' | 'MAXIMUM' | 'MINIMUM' | 'RANGE' | 'PERCENT_OF_INCOME';

/** Días mínimos transcurridos para proyectar por ritmo sin pronóstico (`REPORTING_BUDGET_RISK_MIN_ELAPSED_DAYS`). */
export const DEFAULT_BUDGET_RISK_MIN_ELAPSED_DAYS = 7;

/** Pago conocido pendiente (ocurrencia de compromiso), ya en la moneda del plan. */
export interface KnownPayment {
  readonly dueDate: string;
  readonly amount: Decimal;
}

export interface BudgetRiskLineInput {
  readonly kind: BudgetRiskLineKind;
  /** Planificado efectivo (o el máximo en un rango). */
  readonly reference: Decimal;
  readonly actual: Decimal;
  /** Lo pagado en el periodo por ocurrencias resueltas con las categorías de la línea (ya en la moneda del plan). */
  readonly paidByOccurrences: Decimal;
  readonly knownPending: readonly KnownPayment[];
  /** Esperado y límite superior del 80 % del pronóstico vigente de la categoría para el periodo en curso. */
  readonly forecast: { readonly expected: Decimal; readonly upper: Decimal } | null;
}

export interface BudgetRiskPeriodInput {
  readonly currency: Currency;
  readonly today: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly minElapsedDays: number;
}

export interface BudgetRiskResult {
  readonly level: BudgetRiskLevel;
  readonly reason: BudgetRiskReason | null;
  readonly basis: BudgetRiskBasis | null;
  readonly actual: Money;
  readonly variableActual: Money;
  readonly knownPending: Money;
  readonly projected: Money | null;
  readonly projectedHigh: Money | null;
  readonly estimatedDate: string | null;
}

const epochDay = (date: string) => LocalDate.parse(date).toEpochDay();
const isoOf = (day: number) => LocalDate.ofEpochDay(day).toString();
const ZERO = dec('0');
const maxZero = (value: Decimal): Decimal => (value.isNegative() ? ZERO : value);

/** Días transcurridos (con hoy) y días que faltan (sin hoy) del periodo. */
export function periodDays(input: Pick<BudgetRiskPeriodInput, 'today' | 'periodStart' | 'periodEnd'>): {
  readonly elapsed: number;
  readonly remaining: number;
} {
  const today = epochDay(input.today);
  return { elapsed: today - epochDay(input.periodStart) + 1, remaining: epochDay(input.periodEnd) - today };
}

export class BudgetOverrunProjector {
  /** Riesgo de una línea; el llamador ya filtró las líneas de ingreso y de etiqueta (no se evalúan). */
  static project(line: BudgetRiskLineInput, period: BudgetRiskPeriodInput): BudgetRiskResult {
    const { currency } = period;
    const money = (value: Decimal) => Money.roundToScale(value, currency, 'HALF_EVEN');
    const knownTotal = line.knownPending.reduce((acc, k) => acc.add(k.amount), ZERO);
    const variable = maxZero(line.actual.sub(line.paidByOccurrences));
    const base = {
      actual: money(line.actual),
      variableActual: money(variable),
      knownPending: money(knownTotal),
    };
    const unavailable = (reason: BudgetRiskReason): BudgetRiskResult => ({
      ...base,
      level: 'NOT_AVAILABLE',
      reason,
      basis: null,
      projected: null,
      projectedHigh: null,
      estimatedDate: null,
    });

    if (line.kind === 'FIXED' || line.kind === 'MINIMUM') return unavailable('LINE_TYPE');
    if (!line.reference.gt(ZERO)) return unavailable('NO_REFERENCE');
    const reference = money(line.reference);
    const actual = money(line.actual);
    if (actual.compare(reference) > 0) {
      return {
        ...base,
        level: 'EXCEEDED',
        reason: null,
        basis: null,
        projected: null,
        projectedHigh: null,
        estimatedDate: null,
      };
    }

    const { elapsed, remaining } = periodDays(period);
    const forecast = line.forecast;
    const knownOnly = money(line.actual.add(knownTotal));
    const knownAlreadyOver = knownOnly.compare(reference) > 0;
    if (!forecast && elapsed < period.minElapsedDays && !knownAlreadyOver) return unavailable('TOO_EARLY');

    // Gasto variable restante: pronóstico (esperado − gastado variable) o ritmo del periodo. Con pocos días y los pagos
    // conocidos ya sobre la referencia, el ritmo no es fiable: queda el mínimo seguro (solo lo conocido).
    const useRunRate = !forecast;
    const noisyRate = useRunRate && elapsed < period.minElapsedDays;
    const rest = forecast
      ? maxZero(forecast.expected.sub(variable))
      : noisyRate
        ? ZERO
        : variable.mul(remaining).div(elapsed);
    const restHigh = forecast ? maxZero(forecast.upper.sub(variable)) : null;
    const projected = money(line.actual.add(knownTotal).add(rest));
    const projectedHigh = restHigh === null ? null : money(line.actual.add(knownTotal).add(restHigh));
    const basis: BudgetRiskBasis = forecast ? 'FORECAST' : 'RUN_RATE';

    let level: BudgetRiskLevel = 'UNLIKELY';
    let dateRest: Decimal | null = null;
    if (projected.compare(reference) > 0) {
      level = 'LIKELY';
      dateRest = rest;
    } else if (projectedHigh !== null && projectedHigh.compare(reference) > 0) {
      level = 'POSSIBLE';
      dateRest = restHigh;
    }
    return {
      ...base,
      level,
      reason: null,
      basis,
      projected,
      projectedHigh,
      estimatedDate:
        dateRest === null
          ? null
          : BudgetOverrunProjector.estimateDate({
              actual: line.actual,
              reference: line.reference,
              known: line.knownPending,
              rest: dateRest,
              today: period.today,
              remaining,
            }),
    };
  }

  /**
   * Primer día t > hoy en que el gastado + los pagos conocidos que vencen hasta t (los vencidos sin pagar, desde mañana) +
   * el gasto variable restante repartido por igual entre los días que faltan supera la referencia. `null` si no hay
   * días por delante o ninguno la supera. El reparto es exacto (sin redondear por día).
   */
  static estimateDate(input: {
    readonly actual: Decimal;
    readonly reference: Decimal;
    readonly known: readonly KnownPayment[];
    readonly rest: Decimal;
    readonly today: string;
    readonly remaining: number;
  }): string | null {
    const today = epochDay(input.today);
    for (let n = 1; n <= input.remaining; n += 1) {
      const t = isoOf(today + n);
      let total = input.actual.add(input.rest.mul(n).div(input.remaining));
      for (const k of input.known) if (k.dueDate <= t) total = total.add(k.amount);
      if (total.gt(input.reference)) return t;
    }
    return null;
  }
}
