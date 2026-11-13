import type { CategoryInfo, EvaluatedSeries } from './readiness-gate.js';
import {
  FinancialPeriodCalendar,
  LocalDate,
  Money,
  convertExact,
  dec,
  present,
  shiftLabel,
  type Currency,
  type Decimal,
  type ExactRate,
  type PeriodLabel,
} from '@pf/shared-kernel';

/**
 * Costos e ingresos futuros CONOCIDOS (openspec add-expense-forecasts, decisiones 1, 2 y 4): se calculan aquí, de forma
 * determinista y con Decimal, nunca en el servicio. Los conocidos de la historia se restan con el MISMO criterio de tipos
 * (`VariableHistoryBuilder`) para no contar dos veces lo recurrente.
 */

export type KnownKind = 'EXPENSE' | 'INCOME' | 'LOAN_INTEREST';
export type KnownAmountType = 'FIXED' | 'ESTIMATED' | 'MIN_MAX' | 'VARIABLE';

/** Ocurrencia (generada o proyectada sin guardar) que entrega COMMITMENTS (`ProjectedOccurrenceDto`). */
export interface OccurrenceInput {
  readonly date: string;
  readonly definitionId: string;
  readonly occurrenceId: string | null;
  readonly projected: boolean;
  readonly kind: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'LOAN_PAYMENT' | 'CARD_PAYMENT';
  readonly amountType: KnownAmountType;
  readonly amount: { readonly amount: string; readonly currency: string } | null;
  readonly minAmount: { readonly amount: string; readonly currency: string } | null;
  readonly maxAmount: { readonly amount: string; readonly currency: string } | null;
  readonly categoryId: string | null;
  readonly managedBy: 'USER' | 'SUBSCRIPTION' | 'DEBT' | 'GOAL';
  readonly label: string;
}

/** Cuota futura de un préstamo con sus componentes (DEBT `LoanScheduleQuery.listUpcomingInstallments`). */
export interface InstallmentInput {
  readonly loanId: string;
  readonly label: string;
  readonly dueDate: string;
  readonly currency: string;
  readonly principal: string;
  readonly interest: string;
  readonly charges: string;
  readonly insurance: string;
  readonly taxes: string;
}

export interface KnownItem {
  readonly period: PeriodLabel;
  readonly date: string;
  readonly label: string;
  readonly kind: KnownKind;
  readonly amountType: KnownAmountType | 'SCHEDULE';
  /** En la moneda de reporte, a su escala (HALF_EVEN); `null` si es `VARIABLE` o no hay tasa. */
  readonly amount: string | null;
  /** Monto original cuando la moneda no es la de reporte (o el monto quedó sin convertir). */
  readonly originalAmount: { readonly amount: string; readonly currency: string } | null;
  readonly managedBy: string | null;
  readonly source: { readonly context: 'COMMITMENTS' | 'DEBT'; readonly id: string };
  /** Categoría de la ocurrencia; los intereses de préstamos no tienen (solo suman al total). */
  readonly categoryId: string | null;
  /** `true` si el monto no está disponible por ser `VARIABLE`. */
  readonly withoutAmount: boolean;
}

export interface KnownTotals {
  /** Σ exacta de los montos ya materializados de cada ítem (cada uno cuantizado a la escala de reporte). */
  readonly amount: Decimal;
  readonly withoutAmountCount: number;
  readonly itemCount: number;
}

/** Ocurrencias que cuentan como gasto o ingreso conocido (decisión 2): no transferencias, pagos de tarjeta ni metas. */
export function countsAsKnown(o: Pick<OccurrenceInput, 'kind' | 'managedBy'>): 'EXPENSE' | 'INCOME' | null {
  if (o.managedBy === 'GOAL') return null;
  if (o.kind === 'EXPENSE') return 'EXPENSE';
  if (o.kind === 'INCOME') return 'INCOME';
  return null;
}

export interface ComputeKnownInput {
  readonly occurrences: readonly OccurrenceInput[];
  readonly installments: readonly InstallmentInput[];
  readonly target: Currency;
  readonly startDay: number;
  /** Primer y último periodo pronosticados (los ítems fuera de ese rango no se listan). */
  readonly firstPeriod: PeriodLabel;
  readonly lastPeriod: PeriodLabel;
  /** Tasa exacta de hoy de la moneda; `null` si no hay (nunca 1:1). */
  readonly rateFor: (currencyCode: string) => ExactRate | null;
}

const scaleOfText = (amount: string): number => {
  const dot = amount.indexOf('.');
  return dot < 0 ? 0 : amount.length - dot - 1;
};

export const KnownFutureCalculator = {
  /**
   * Ítems conocidos por periodo. `MIN_MAX`: el máximo en gastos y el mínimo en ingresos (criterio conservador del
   * calendario); `VARIABLE`: se lista sin monto; otra moneda: tasa de hoy, y sin tasa se lista sin convertir y no se suma.
   * Una cuota de préstamo aporta interés, cargos, seguro e impuestos (nunca capital) con la etiqueta de la cuota.
   */
  compute(input: ComputeKnownInput): KnownItem[] {
    const items: KnownItem[] = [];
    const periodOf = (date: string): PeriodLabel =>
      FinancialPeriodCalendar.periodOf(input.startDay, LocalDate.parse(date)).label;
    const inRange = (p: PeriodLabel) => p >= input.firstPeriod && p <= input.lastPeriod;
    const materialize = (
      raw: { readonly amount: string; readonly currency: string } | null,
    ): { amount: string | null; original: KnownItem['originalAmount'] } => {
      if (!raw) return { amount: null, original: null };
      if (raw.currency === input.target.code) {
        const value = Money.roundToScale(dec(raw.amount), input.target, 'HALF_EVEN');
        return { amount: value.toFixed(), original: null };
      }
      const original = { amount: raw.amount, currency: raw.currency };
      const rate = input.rateFor(raw.currency);
      if (!rate) return { amount: null, original };
      const converted = convertExact(
        Money.parse(raw.amount, raw.currency, scaleOfText(raw.amount)),
        input.target,
        rate,
      );
      return { amount: present(converted, input.target).toFixed(), original };
    };

    for (const o of input.occurrences) {
      const kind = countsAsKnown(o);
      if (kind === null) continue;
      const period = periodOf(o.date);
      if (!inRange(period)) continue;
      const chosen = o.amountType === 'MIN_MAX' ? (kind === 'EXPENSE' ? o.maxAmount : o.minAmount) : o.amount;
      const variable = o.amountType === 'VARIABLE' || chosen === null;
      const m = variable ? { amount: null, original: null } : materialize(chosen);
      items.push({
        period,
        date: o.date,
        label: o.label,
        kind,
        amountType: o.amountType,
        amount: m.amount,
        originalAmount: m.original,
        managedBy: o.managedBy,
        source: { context: 'COMMITMENTS', id: o.occurrenceId ?? o.definitionId },
        categoryId: o.categoryId,
        withoutAmount: variable,
      });
    }

    for (const i of input.installments) {
      const period = periodOf(i.dueDate);
      if (!inRange(period)) continue;
      const component = [i.interest, i.charges, i.insurance, i.taxes]
        .map((x) => dec(x))
        .reduce((a, b) => a.plus(b), dec('0'));
      if (component.isZero()) continue;
      const scale = Math.max(...[i.interest, i.charges, i.insurance, i.taxes].map(scaleOfText));
      const m = materialize({ amount: component.toFixed(scale), currency: i.currency });
      items.push({
        period,
        date: i.dueDate,
        label: i.label,
        kind: 'LOAN_INTEREST',
        amountType: 'SCHEDULE',
        amount: m.amount,
        originalAmount: m.original,
        managedBy: 'DEBT',
        source: { context: 'DEBT', id: i.loanId },
        categoryId: null,
        withoutAmount: false,
      });
    }
    return items.sort((a, b) =>
      a.date === b.date ? (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) : a.date < b.date ? -1 : 1,
    );
  },

  /** Σ exacta de los ítems que pasan el filtro, de un periodo. */
  totals(
    items: readonly KnownItem[],
    period: PeriodLabel,
    accepts: (item: KnownItem) => boolean,
  ): KnownTotals {
    let amount = dec('0');
    let withoutAmountCount = 0;
    let itemCount = 0;
    for (const item of items) {
      if (item.period !== period || !accepts(item)) continue;
      itemCount += 1;
      if (item.withoutAmount) withoutAmountCount += 1;
      if (item.amount !== null) amount = amount.plus(item.amount);
    }
    return { amount, withoutAmountCount, itemCount };
  },

  /**
   * Conocidos que corresponden a una serie: el gasto total suma todos los de gasto y los intereses de préstamos; una
   * categoría, un grupo o «Otras categorías», solo los de sus categorías (un conocido sin categoría solo suma al total).
   */
  forSeries(
    series: Pick<EvaluatedSeries, 'scope' | 'scopeRef' | 'groupedCategoryIds'>,
    items: readonly KnownItem[],
    categories: readonly CategoryInfo[],
  ): KnownItem[] {
    switch (series.scope) {
      case 'TOTAL_EXPENSE':
        return items.filter((k) => k.kind !== 'INCOME');
      case 'TOTAL_INCOME':
        return items.filter((k) => k.kind === 'INCOME');
      case 'LIQUID_VARIABLE_OUTFLOW':
        // Solo gasto variable: los conocidos ya están en el calendario (add-predicted-cash-flow-band).
        return [];
      case 'CATEGORY':
        return items.filter((k) => k.kind === 'EXPENSE' && k.categoryId === series.scopeRef);
      case 'OTHER_CATEGORIES': {
        const ids = new Set(series.groupedCategoryIds);
        return items.filter((k) => k.kind === 'EXPENSE' && k.categoryId !== null && ids.has(k.categoryId));
      }
      case 'CATEGORY_GROUP': {
        const ids = new Set(categories.filter((c) => c.groupId === series.scopeRef).map((c) => c.categoryId));
        return items.filter((k) => k.kind === 'EXPENSE' && k.categoryId !== null && ids.has(k.categoryId));
      }
    }
  },

  /** Periodos pronosticados: el en curso y los `horizon - 1` siguientes. */
  periodsFrom(current: PeriodLabel, horizon: number): PeriodLabel[] {
    return Array.from({ length: horizon }, (_, i) => shiftLabel(current, i));
  },
} as const;
