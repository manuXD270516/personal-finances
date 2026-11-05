import { dec, MoneyDecimal, type Money } from '@pf/shared-kernel';
import { type ReportConversionPolicy, type ReportAmount } from './report-conversion.js';
import type { ReportPeriod } from './report-periods.js';

/** Porción de flujo nominal (ingreso o gasto neto de reembolsos) ya agregada por (fecha, categoría, moneda). */
export interface FlowFact {
  readonly date: string;
  readonly nature: 'INCOME' | 'EXPENSE';
  readonly categoryId: string;
  readonly amount: Money;
}

export interface IncomeExpenseFigures {
  readonly income: ReportAmount;
  readonly expenses: ReportAmount;
  readonly savings: ReportAmount;
  /** Porcentaje con 1 decimal HALF_EVEN; `null` (sin definir) con ingreso ≤ 0. */
  readonly savingsRate: string | null;
}

type DateSpan = { readonly from: string; readonly to: string };
const inRange = (f: FlowFact, p: DateSpan | readonly DateSpan[]) =>
  (Array.isArray(p) ? (p as readonly DateSpan[]) : [p as DateSpan]).some(
    (r) => f.date >= r.from && f.date <= r.to,
  );

/**
 * `IncomeExpenseReport` (FR-REPORTING-008, reporte 1): ingreso, gasto, ahorro (ingreso − gasto) y tasa de ahorro de un
 * periodo, por moneda nativa y consolidado. El ahorro se valora desde los mismos agregados (suma exacta), así que
 * `ahorro = ingreso − gasto` sin descuadres de redondeo. Un reembolso ya viene restando en `EXPENSE`. Puro.
 */
export const IncomeExpenseReport = {
  figures(
    flows: readonly FlowFact[],
    period: DateSpan | readonly DateSpan[],
    policy: ReportConversionPolicy,
    perDays?: number,
  ): IncomeExpenseFigures {
    const own = flows.filter((f) => inRange(f, period));
    const incomeRows = own
      .filter((f) => f.nature === 'INCOME')
      .map((f) => ({ date: f.date, amount: f.amount }));
    const expenseRows = own
      .filter((f) => f.nature === 'EXPENSE')
      .map((f) => ({ date: f.date, amount: f.amount }));
    const income = policy.value(incomeRows, perDays);
    const expenses = policy.value(expenseRows, perDays);
    const savings = policy.value(
      [...incomeRows, ...expenseRows.map((r) => ({ date: r.date, amount: r.amount.negate() }))],
      perDays,
    );
    return { income, expenses, savings, savingsRate: IncomeExpenseReport.savingsRate(savings, income) };
  },

  /** Ahorro sobre ingreso en %, con 1 decimal HALF_EVEN; `null` con ingreso cero o negativo (nunca 0 % ni infinito). */
  savingsRate(savings: ReportAmount, income: ReportAmount): string | null {
    if (income.exact.lte(0)) return null;
    return dec(savings.exact)
      .div(income.exact)
      .times(100)
      .toDecimalPlaces(1, MoneyDecimal.ROUND_HALF_EVEN)
      .toFixed(1);
  },

  /** Cifras de cada periodo del reporte. */
  byPeriod(
    flows: readonly FlowFact[],
    periods: readonly ReportPeriod[],
    policy: ReportConversionPolicy,
    perDays = false,
  ) {
    return periods.map((period) => ({
      period,
      ...IncomeExpenseReport.figures(flows, period, policy, perDays ? period.days : undefined),
    }));
  },
} as const;
