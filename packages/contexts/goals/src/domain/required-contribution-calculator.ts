import {
  FinancialPeriodCalendar,
  Money,
  dec,
  type Currency,
  type Decimal,
  type LocalDate,
} from '@pf/shared-kernel';

export interface RequiredContribution {
  /** `null` si la meta no tiene fecha objetivo (nunca 0.00). */
  readonly monthly: Money | null;
  /** Periodos financieros incluidos (`0` si la fecha objetivo ya venció o no hay fecha). */
  readonly periods: number | null;
  /** La fecha objetivo cae en un periodo anterior al actual y la meta no está alcanzada. */
  readonly overdue: boolean;
}

export interface RequiredContributionInput {
  /** Restante (objetivo − acumulado, no negativo) sin redondear. */
  readonly remaining: Decimal;
  readonly currency: Currency;
  /** Hoy en la zona del workspace. */
  readonly today: LocalDate;
  readonly targetDate: LocalDate | null;
  /** Día de inicio del mes financiero (1..28). */
  readonly startDay: number;
}

/**
 * `RequiredContributionCalculator` (openspec add-savings-goals, decisión 12; FR-GOALS-003): `restante ÷ n`, con `n` los
 * periodos financieros desde el que contiene hoy hasta el que contiene la fecha objetivo, ambos incluidos. Una fecha
 * objetivo en un periodo anterior ⇒ todo el restante, marcado vencido. Sin fecha ⇒ `null`. Restante 0 ⇒ 0.00.
 */
export function calculateRequiredContribution(input: RequiredContributionInput): RequiredContribution {
  const { remaining, currency, today, targetDate, startDay } = input;
  if (targetDate === null) return { monthly: null, periods: null, overdue: false };
  if (remaining.lte(0)) return { monthly: Money.zero(currency), periods: 0, overdue: false };
  const periods = FinancialPeriodCalendar.periodsBetween(startDay, today, targetDate).length;
  if (periods === 0) {
    return { monthly: Money.roundToScale(remaining, currency), periods: 0, overdue: true };
  }
  return {
    monthly: Money.roundToScale(remaining.div(dec(String(periods))), currency),
    periods,
    overdue: false,
  };
}
