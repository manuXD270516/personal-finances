import { dec, LocalDate, Money, type Currency, type Decimal } from '@pf/shared-kernel';
import { categoriesOfTarget, type PlanCategoryNode, type PlannedLineInput } from './planned-spending.js';

/**
 * DS `SpendableHorizon` y esenciales del disponible (openspec add-cash-flow-forecast, design.md decisiones 10 a 12; D377,
 * D378, D387, D388; FR-PLANNING-024, docs/14 §4.2). Puros: sin reloj ni E/S.
 */

export type SpendableHorizonMode = 'FINANCIAL_PERIOD' | 'NEXT_INCOME';

/** Cuántos días hacia adelante se busca el próximo ingreso y cuántos se usan de respaldo (docs/14 §4.2). */
export const NEXT_INCOME_LOOKAHEAD_DAYS = 90;
export const NEXT_INCOME_FALLBACK_DAYS = 30;

export interface UpcomingIncome {
  readonly occurrenceId: string;
  readonly name: string;
  /** Vencimiento de la ocurrencia de ingreso no resuelta. */
  readonly date: string;
}

export interface ResolvedHorizon {
  readonly mode: SpendableHorizonMode;
  /** Inicio del horizonte mostrado: el del periodo, u hoy en "hasta el próximo ingreso". */
  readonly from: string;
  /** Último día (inclusive) cuyos compromisos se descuentan. */
  readonly to: string;
  readonly nextIncome: UpcomingIncome | null;
  /** Sin ingreso esperado en los próximos 90 días se usan 30 días desde hoy. */
  readonly fallback: boolean;
}

const addDays = (date: string, n: number) => LocalDate.parse(date).plusDays(n).toString();
const daysInclusive = (from: string, to: string) =>
  LocalDate.parse(to).toEpochDay() - LocalDate.parse(from).toEpochDay() + 1;

export const SpendableHorizon = {
  /**
   * `FINANCIAL_PERIOD` (D210, por omisión): el periodo que contiene hoy. `NEXT_INCOME`: desde hoy hasta el vencimiento,
   * inclusive, de la primera ocurrencia de ingreso no resuelta con vencimiento posterior a hoy y dentro de 90 días; si no
   * hay ninguna, 30 días desde hoy con `fallback`. Los ingresos vencidos (fecha ≤ hoy) NO fijan el horizonte.
   */
  resolve(input: {
    readonly mode: SpendableHorizonMode;
    readonly today: string;
    readonly period: { readonly start: string; readonly end: string };
    readonly incomes: readonly UpcomingIncome[];
  }): ResolvedHorizon {
    if (input.mode === 'FINANCIAL_PERIOD') {
      return {
        mode: input.mode,
        from: input.period.start,
        to: input.period.end,
        nextIncome: null,
        fallback: false,
      };
    }
    const limit = addDays(input.today, NEXT_INCOME_LOOKAHEAD_DAYS);
    const next = [...input.incomes]
      .filter((i) => i.date > input.today && i.date <= limit)
      .sort((a, b) =>
        a.date === b.date ? (a.occurrenceId < b.occurrenceId ? -1 : 1) : a.date < b.date ? -1 : 1,
      )[0];
    if (next) {
      return { mode: input.mode, from: input.today, to: next.date, nextIncome: next, fallback: false };
    }
    return {
      mode: input.mode,
      from: input.today,
      to: addDays(input.today, NEXT_INCOME_FALLBACK_DAYS),
      nextIncome: null,
      fallback: true,
    };
  },

  /** Periodos posteriores al que contiene hoy cuyo inicio alcanza el horizonte (`start ≤ to`). */
  periodsReached<P extends { readonly start: string; readonly end: string }>(
    periods: readonly P[],
    today: string,
    to: string,
  ): P[] {
    return periods
      .filter((p) => p.start > today && p.start <= to)
      .sort((a, b) => (a.start < b.start ? -1 : 1));
  },
} as const;

// ───────────────────────────────────────────── esenciales presupuestados

export interface EssentialCategory {
  readonly categoryId: string;
  readonly name: string;
  readonly archived: boolean;
}

export interface EssentialPlanPeriod {
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly plan: { readonly currency: string; readonly lines: readonly PlannedLineInput[] } | null;
}

export interface EssentialItem {
  readonly categoryId: string;
  readonly name: string;
  readonly periodLabel: string;
  readonly currency: Currency;
  readonly reference: Money;
  readonly actual: Money;
  /** Comprometido de esa categoría ya descontado en el horizonte (sin doble conteo). */
  readonly committed: Money;
  /** Lo que resta del disponible por esta línea (HALF_EVEN solo para mostrarlo; el término suma sin redondear). */
  readonly counted: Money;
  /** Periodo posterior: `reference × días dentro / días del periodo`. */
  readonly prorated: boolean;
}

export type EssentialWarningReason = 'NO_PLAN' | 'NO_LINE' | 'ARCHIVED';

export interface EssentialWarning {
  readonly categoryId: string;
  readonly reason: EssentialWarningReason;
  readonly periodLabel: string | null;
}

export interface EssentialsResult {
  /** Término de esenciales por moneda del plan, sin redondear (el calculador lo materializa una vez). */
  readonly byCurrency: ReadonlyMap<string, Decimal>;
  readonly items: readonly EssentialItem[];
  readonly warnings: readonly EssentialWarning[];
}

/** Egreso ya descontado como comprometido (los que cuentan en `SpendableCalculator`). */
export interface EssentialCommittedItem {
  readonly categoryId: string | null;
  readonly amount: Money;
}

export const SpendableEssentials = {
  /**
   * Por moneda del plan y por cada línea de gasto cuyo objetivo es una categoría esencial: `max(0, planificado − gastado −
   * comprometido de esa categoría en el horizonte)` completo para el periodo en curso y, para cada periodo posterior que
   * el horizonte alcanza, `planificado × días dentro / días del periodo`, sin redondeo intermedio (D387). Las líneas por
   * grupo o etiqueta no cuentan. Un periodo sin plan, una categoría sin línea o una categoría archivada no restan y se
   * informan.
   */
  compute(input: {
    readonly essentials: readonly EssentialCategory[];
    readonly current: EssentialPlanPeriod | null;
    readonly later: readonly EssentialPlanPeriod[];
    /** Último día del horizonte (inclusive). */
    readonly horizonEnd: string;
    readonly categories: ReadonlyMap<string, PlanCategoryNode>;
    readonly committed: readonly EssentialCommittedItem[];
    readonly currencyOf: (code: string) => Currency;
  }): EssentialsResult {
    const byCurrency = new Map<string, Decimal>();
    const items: EssentialItem[] = [];
    const warnings: EssentialWarning[] = [];
    const warn = (w: EssentialWarning) => {
      if (
        !warnings.some(
          (x) => x.categoryId === w.categoryId && x.reason === w.reason && x.periodLabel === w.periodLabel,
        )
      )
        warnings.push(w);
    };
    const add = (code: string, value: Decimal) =>
      byCurrency.set(code, (byCurrency.get(code) ?? dec('0')).plus(value));
    for (const category of input.essentials) {
      if (category.archived) {
        warn({ categoryId: category.categoryId, reason: 'ARCHIVED', periodLabel: null });
        continue;
      }
      const covered = categoriesOfTarget('CATEGORY', category.categoryId, input.categories);
      const periods: { period: EssentialPlanPeriod | null; later: boolean }[] = [
        { period: input.current, later: false },
        ...input.later.map((p) => ({ period: p as EssentialPlanPeriod | null, later: true })),
      ];
      for (const { period, later } of periods) {
        if (period === null || period.plan === null) {
          warn({
            categoryId: category.categoryId,
            reason: 'NO_PLAN',
            periodLabel: period?.label ?? null,
          });
          continue;
        }
        const line = period.plan.lines.find(
          (l) => l.nature === 'EXPENSE' && l.targetKind === 'CATEGORY' && l.targetId === category.categoryId,
        );
        if (!line) {
          warn({ categoryId: category.categoryId, reason: 'NO_LINE', periodLabel: period.label });
          continue;
        }
        const currency = input.currencyOf(period.plan.currency);
        const zero = Money.zero(currency);
        let counted: Decimal;
        let committedMoney = zero;
        let actual = line.actual;
        if (later) {
          const inside = daysInclusive(
            period.start,
            input.horizonEnd < period.end ? input.horizonEnd : period.end,
          );
          const length = daysInclusive(period.start, period.end);
          counted = line.reference.toDecimal().times(inside).div(length);
          actual = zero;
        } else {
          const committed = input.committed
            .filter(
              (c) =>
                c.categoryId !== null &&
                covered.has(c.categoryId) &&
                c.amount.currency.code === period.plan?.currency,
            )
            .reduce((acc, c) => acc.plus(c.amount.toDecimal()), dec('0'));
          committedMoney = Money.roundToScale(committed, currency, 'HALF_EVEN');
          const left = line.reference.toDecimal().minus(line.actual.toDecimal()).minus(committed);
          counted = left.gt(0) ? left : dec('0');
        }
        add(period.plan.currency, counted);
        items.push({
          categoryId: category.categoryId,
          name: category.name,
          periodLabel: period.label,
          currency,
          reference: line.reference,
          actual,
          committed: committedMoney,
          counted: Money.roundToScale(counted, currency, 'HALF_EVEN'),
          prorated: later,
        });
      }
    }
    return { byCurrency, items, warnings };
  },
} as const;
