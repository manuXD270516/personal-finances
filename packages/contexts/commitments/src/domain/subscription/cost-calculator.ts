import {
  LocalDate,
  MoneyDecimal,
  expandRecurrence,
  type Cadence,
  type Decimal,
  type Money,
} from '@pf/shared-kernel';
import { ruleOfSchedule, type ScheduleSpec } from '../definition-version.js';

/** Renovaciones por año de cada cadencia con intervalo 1 (openspec add-subscriptions, decisión 11; docs/14 §4). */
export const RENEWALS_PER_YEAR: Readonly<Record<Cadence, number>> = {
  DAILY: 365,
  WEEKLY: 52,
  BIWEEKLY: 26,
  SEMIMONTHLY: 24,
  MONTHLY: 12,
  BIMONTHLY: 6,
  QUARTERLY: 4,
  SEMIANNUAL: 2,
  ANNUAL: 1,
};

const MONTHS_PER_YEAR = new MoneyDecimal(12);

/** Mismo día del año siguiente (29-feb → 28-feb). */
function sameDayNextYear(date: LocalDate): LocalDate {
  const year = date.year + 1;
  return LocalDate.of(year, date.month, Math.min(date.day, LocalDate.daysInMonth(year, date.month)));
}

/**
 * Renovaciones por año de un ciclo: la tabla de la cadencia dividida por el intervalo; una regla personalizada
 * (`CUSTOM`) cuenta las fechas de los próximos 12 meses desde `today` (decisión 11, N5).
 */
export function renewalsPerYear(schedule: ScheduleSpec, today: LocalDate): Decimal {
  if (schedule.cadence === 'CUSTOM') {
    const rule = ruleOfSchedule({ ...schedule, endDate: null, maxOccurrences: null });
    const to = sameDayNextYear(today).plusDays(-1);
    return new MoneyDecimal(expandRecurrence(rule, { from: today, to }).length);
  }
  return new MoneyDecimal(RENEWALS_PER_YEAR[schedule.cadence]).div(schedule.interval);
}

export interface SubscriptionCost {
  /** Precio × renovaciones por año, a precisión completa (sin redondeo intermedio). */
  readonly annual: Decimal;
  /** Anualizado / 12, a precisión completa. */
  readonly monthly: Decimal;
}

/**
 * Costo anualizado y mensualizado de una suscripción en la moneda de su precio (FR-COMMITMENTS-015). El redondeo
 * HALF_EVEN a la escala de la moneda ocurre solo al presentar (`present`); aquí todo es exacto, así que
 * `monthly × 12 == annual`.
 */
export const SubscriptionCostCalculator = {
  cost(price: Money, renewals: Decimal): SubscriptionCost {
    const annual = price.amount.times(renewals);
    return { annual, monthly: annual.div(MONTHS_PER_YEAR) };
  },
} as const;
