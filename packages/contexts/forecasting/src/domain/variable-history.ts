import {
  FinancialPeriodCalendar,
  LocalDate,
  Money,
  convertExact,
  dec,
  type Currency,
  type Decimal,
  type ExactRate,
} from '@pf/shared-kernel';
import { countsAsKnown, type OccurrenceInput } from './known-future.js';
import type { CategoryFigure, PeriodAggregate } from './period-series-builder.js';

/** Ocurrencia de gasto o ingreso resuelta (materializada o emparejada), con su transacción (COMMITMENTS `listResolved`). */
export interface ResolvedInput {
  readonly kind: OccurrenceInput['kind'];
  readonly managedBy: OccurrenceInput['managedBy'];
  readonly transactionDate: string;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly categoryId: string | null;
}

/** Porción de gasto con componente de préstamo (interés, cargos, seguro, impuestos) que ya está en los flujos. */
export interface LoanComponentInput {
  readonly businessDate: string;
  readonly categoryId: string;
  readonly amount: { readonly amount: string; readonly currency: string };
}

export interface VariableHistory {
  readonly periods: readonly PeriodAggregate[];
  /** Resultados negativos (resta mayor que el gasto de su serie) llevados a 0: calidad de datos. */
  readonly clampedCount: number;
}

const scaleOfText = (amount: string): number => {
  const dot = amount.indexOf('.');
  return dot < 0 ? 0 : amount.length - dot - 1;
};

/**
 * `VariableHistoryBuilder` (decisión 2): historia variable del periodo = gasto (o ingreso) − Σ ocurrencias resueltas de
 * gasto (o ingreso) cuya fecha de transacción cae en el periodo − Σ porciones con componente de préstamo. Por categoría
 * la resta usa la categoría de la ocurrencia (una sin categoría solo resta del total). Un resultado negativo se lleva a 0
 * y se cuenta. Los pagos de tarjeta, aportes a metas, capital de cuotas y transferencias no se restan: no son gasto.
 * La valoración usa la tasa de la fecha de cada flujo, igual que la historia (nunca 1:1: sin tasa no se resta).
 */
export const VariableHistoryBuilder = {
  build(input: {
    readonly periods: readonly PeriodAggregate[];
    readonly resolved: readonly ResolvedInput[];
    readonly loanComponents: readonly LoanComponentInput[];
    readonly startDay: number;
    readonly target: Currency;
    readonly rateFor: (currencyCode: string, date: string) => ExactRate | null;
  }): VariableHistory {
    const { target } = input;
    const value = (m: { amount: string; currency: string }, date: string): Decimal | null => {
      if (m.currency === target.code) return dec(m.amount);
      const rate = input.rateFor(m.currency, date);
      if (!rate) return null;
      return convertExact(Money.parse(m.amount, m.currency, scaleOfText(m.amount)), target, rate);
    };
    const labelOf = (date: string) =>
      FinancialPeriodCalendar.periodOf(input.startDay, LocalDate.parse(date)).label;

    interface Sub {
      expense: Decimal;
      income: Decimal;
      byCategory: Map<string, Decimal>;
    }
    const subs = new Map<string, Sub>();
    const subOf = (label: string): Sub => {
      const s = subs.get(label) ?? { expense: dec('0'), income: dec('0'), byCategory: new Map() };
      subs.set(label, s);
      return s;
    };
    for (const r of input.resolved) {
      const kind = countsAsKnown(r);
      if (kind === null) continue;
      const v = value(r.amount, r.transactionDate);
      if (v === null) continue;
      const s = subOf(labelOf(r.transactionDate));
      if (kind === 'INCOME') {
        s.income = s.income.plus(v);
        continue;
      }
      s.expense = s.expense.plus(v);
      if (r.categoryId) s.byCategory.set(r.categoryId, (s.byCategory.get(r.categoryId) ?? dec('0')).plus(v));
    }
    for (const c of input.loanComponents) {
      const v = value(c.amount, c.businessDate);
      if (v === null) continue;
      const s = subOf(labelOf(c.businessDate));
      s.expense = s.expense.plus(v);
      s.byCategory.set(c.categoryId, (s.byCategory.get(c.categoryId) ?? dec('0')).plus(v));
    }

    let clampedCount = 0;
    const floor = (v: Decimal): Decimal => {
      if (v.isNegative()) {
        clampedCount += 1;
        return dec('0');
      }
      return v;
    };
    const periods = input.periods.map((p): PeriodAggregate => {
      const s = subs.get(p.label);
      if (!s) return p;
      const byCategory = new Map<string, CategoryFigure>();
      for (const [categoryId, fig] of p.expenseByCategory) {
        const sub = s.byCategory.get(categoryId);
        byCategory.set(categoryId, sub ? { value: floor(fig.value.minus(sub)), txCount: fig.txCount } : fig);
      }
      return {
        ...p,
        expenseTotal: floor(p.expenseTotal.minus(s.expense)),
        incomeTotal: floor(p.incomeTotal.minus(s.income)),
        expenseByCategory: byCategory,
      };
    });
    return { periods, clampedCount };
  },
} as const;
