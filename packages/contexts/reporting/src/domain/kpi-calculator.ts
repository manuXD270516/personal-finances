import { MoneyDecimal, type Currency, type Decimal, type Money } from '@pf/shared-kernel';
import { ConsolidationService } from './consolidation-service.js';
import { sumByCurrency, type ExactRate } from './valuation.js';

/**
 * Flujo nominal (fila de `SummarizeNominalFlows` de Transactions): postings a `INCOME:*`/`EXPENSE:*` de asientos
 * activos agregados por día, moneda y categoría, con el signo del usuario (ingreso +; gasto neto de reembolsos).
 */
export interface NominalFlow {
  readonly businessDate: string;
  readonly nature: 'INCOME' | 'EXPENSE';
  readonly categoryId: string;
  readonly amount: Money;
}

export interface DateRangeText {
  readonly from: string;
  readonly to: string;
}

export interface CategoryTotal {
  readonly categoryId: string;
  readonly name: string;
  /** Neto en la moneda de reporte, sin redondear (puede ser negativo). */
  readonly amount: Decimal;
  readonly complete: boolean;
}

export interface TopCategoriesOptions {
  readonly target: Currency;
  /** Tasa vigente al cierre del día del flujo (`conv_t`). */
  readonly rateFor: (currency: string, date: string) => ExactRate | null;
  readonly nameOf: (categoryId: string) => string;
}

const collator = new Intl.Collator('es', { sensitivity: 'base' });

/**
 * DS `KpiCalculator` (docs/14 §4; design.md decisiones 2 y 5), puro:
 *   Income(P) = Σ flujos INCOME; Expenses(P) = Σ flujos EXPENSE (los reembolsos restan en su fecha);
 *   Savings = Income − Expenses; SR = Savings / Income × 100 con 1 decimal HALF_EVEN, `null` si Income ≤ 0;
 *   Top-N = categorías de gasto por neto consolidado descendente, desempate por nombre (collation `es`).
 */
export const KpiCalculator = {
  within(flows: readonly NominalFlow[], range: DateRangeText): NominalFlow[] {
    return flows.filter((f) => f.businessDate >= range.from && f.businessDate <= range.to);
  },

  incomeByCurrency(flows: readonly NominalFlow[]): Money[] {
    return sumByCurrency(flows.filter((f) => f.nature === 'INCOME').map((f) => f.amount));
  },

  expenseByCurrency(flows: readonly NominalFlow[]): Money[] {
    return sumByCurrency(flows.filter((f) => f.nature === 'EXPENSE').map((f) => f.amount));
  },

  /** Tasa de ahorro en % con 1 decimal (HALF_EVEN); `null` = no definida (ingresos cero, UI "—"). */
  savingsRate(income: Decimal, savings: Decimal): string | null {
    if (income.lte(0)) return null;
    return savings.div(income).times(100).toDecimalPlaces(1, MoneyDecimal.ROUND_HALF_EVEN).toFixed(1);
  },

  topCategories(flows: readonly NominalFlow[], n: number, options: TopCategoriesOptions): CategoryTotal[] {
    if (n <= 0) return [];
    const byCategory = new Map<string, NominalFlow[]>();
    for (const f of flows) {
      if (f.nature !== 'EXPENSE') continue;
      byCategory.set(f.categoryId, [...(byCategory.get(f.categoryId) ?? []), f]);
    }
    const totals: CategoryTotal[] = [...byCategory.entries()].map(([categoryId, rows]) => {
      const c = ConsolidationService.consolidateFlows(
        rows.map((r) => ({ date: r.businessDate, amount: r.amount })),
        options.target,
        options.rateFor,
      );
      return { categoryId, name: options.nameOf(categoryId), amount: c.total, complete: c.complete };
    });
    return totals
      .sort(
        (a, b) =>
          b.amount.comparedTo(a.amount) ||
          collator.compare(a.name, b.name) ||
          (a.categoryId < b.categoryId ? -1 : a.categoryId > b.categoryId ? 1 : 0),
      )
      .slice(0, n);
  },
} as const;
