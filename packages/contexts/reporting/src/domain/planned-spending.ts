import { dec, LocalDate, type Decimal, type Money } from '@pf/shared-kernel';

/**
 * DS `PlannedSpending` (openspec add-cash-flow-forecast, design.md decisión 7; D383; FR-PLANNING-024): el gasto planificado
 * restante de los planes de los periodos del horizonte, repartido en partes iguales exactas por día, para la serie
 * "con gasto planificado" del calendario. Puro: sin reloj ni E/S; sin redondeo intermedio (Decimal de precisión 40).
 */

export interface PlannedLineInput {
  readonly targetKind: 'CATEGORY' | 'GROUP' | 'TAG';
  readonly targetId: string;
  readonly nature: 'EXPENSE' | 'INCOME';
  /** Planificado efectivo (o máximo) de la línea. */
  readonly reference: Money;
  readonly actual: Money;
}

export interface PlannedPeriodInput {
  readonly periodId: string | null;
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly plan: { readonly currency: string; readonly lines: readonly PlannedLineInput[] } | null;
}

/** Categoría del árbol de CLASSIFICATION en la forma mínima que necesita el dominio. */
export interface PlanCategoryNode {
  readonly parentId: string | null;
  readonly groupId: string | null;
}

/** Egreso de la serie principal con categoría (ocurrencia o pendiente), ya aplicado a su fecha. */
export interface PlannedCommittedItem {
  readonly date: string;
  readonly categoryId: string | null;
  readonly amount: Money;
}

export interface PlannedSpendingPeriod {
  readonly periodId: string | null;
  readonly label: string;
  readonly status: 'PLAN' | 'NO_PLAN';
}

export interface PlannedSpendingResult {
  /** Gasto planificado por moneda del plan y día (solo días dentro del horizonte). */
  readonly byCurrency: ReadonlyMap<string, ReadonlyMap<string, Decimal>>;
  readonly periods: readonly PlannedSpendingPeriod[];
}

/** Categorías que cubre un objetivo: la categoría y sus subcategorías, o las categorías de un grupo. */
export function categoriesOfTarget(
  kind: 'CATEGORY' | 'GROUP' | 'TAG',
  id: string,
  categories: ReadonlyMap<string, PlanCategoryNode>,
): ReadonlySet<string> {
  if (kind === 'TAG') return new Set();
  const rootOf = (categoryId: string): PlanCategoryNode & { id: string } => {
    let current = categories.get(categoryId) as PlanCategoryNode;
    let currentId = categoryId;
    for (let guard = 0; current && current.parentId !== null && guard < 8; guard += 1) {
      const parent = categories.get(current.parentId);
      if (!parent) break;
      currentId = current.parentId;
      current = parent;
    }
    return { ...current, id: currentId };
  };
  const out = new Set<string>();
  for (const [categoryId, node] of categories) {
    if (kind === 'CATEGORY') {
      // La categoría o cualquier descendiente suyo.
      let cursor: string | null = categoryId;
      for (let guard = 0; cursor !== null && guard < 8; guard += 1) {
        if (cursor === id) {
          out.add(categoryId);
          break;
        }
        cursor = categories.get(cursor)?.parentId ?? null;
      }
    } else if (node.groupId === id || rootOf(categoryId).groupId === id) {
      out.add(categoryId);
    }
  }
  return out;
}

const epoch = (date: string) => LocalDate.parse(date).toEpochDay();
const daysBetween = (from: string, to: string) => epoch(to) - epoch(from) + 1;
const addDays = (date: string, n: number) => LocalDate.parse(date).plusDays(n).toString();
const max = (a: string, b: string) => (a > b ? a : b);
const min = (a: string, b: string) => (a < b ? a : b);

export const PlannedSpending = {
  compute(input: {
    readonly today: string;
    /** Último día del horizonte (inclusive). */
    readonly horizonEnd: string;
    readonly periods: readonly PlannedPeriodInput[];
    readonly categories: ReadonlyMap<string, PlanCategoryNode>;
    readonly committed: readonly PlannedCommittedItem[];
    /** Monedas con cuentas líquidas: el plan en otra moneda se informa sin aplicarse. */
    readonly liquidCurrencies: ReadonlySet<string>;
  }): PlannedSpendingResult {
    const byCurrency = new Map<string, Map<string, Decimal>>();
    const periods: PlannedSpendingPeriod[] = [];
    const relevant = input.periods
      .filter((p) => p.end >= input.today && p.start <= input.horizonEnd)
      .sort((a, b) => (a.start < b.start ? -1 : 1));
    for (const p of relevant) {
      periods.push({ periodId: p.periodId, label: p.label, status: p.plan ? 'PLAN' : 'NO_PLAN' });
      if (!p.plan || !input.liquidCurrencies.has(p.plan.currency)) continue;
      const containsToday = p.start <= input.today;
      // Periodo en curso: el restante entre los días [hoy, fin dentro del horizonte]; posterior: el plan completo entre
      // todos sus días, aplicado solo a los del horizonte.
      const spreadFrom = containsToday ? max(input.today, p.start) : p.start;
      const spreadTo = containsToday ? min(p.end, input.horizonEnd) : p.end;
      const spreadDays = daysBetween(spreadFrom, spreadTo);
      if (spreadDays <= 0) continue;
      let remaining = dec('0');
      for (const line of p.plan.lines) {
        if (line.nature !== 'EXPENSE' || line.targetKind === 'TAG') continue;
        const covered = categoriesOfTarget(line.targetKind, line.targetId, input.categories);
        const committed = input.committed
          .filter(
            (c) =>
              c.categoryId !== null &&
              covered.has(c.categoryId) &&
              c.amount.currency.code === p.plan?.currency &&
              c.date >= p.start &&
              c.date <= p.end,
          )
          .reduce((acc, c) => acc.plus(c.amount.toDecimal()), dec('0'));
        const left = line.reference.toDecimal().minus(line.actual.toDecimal()).minus(committed);
        if (left.gt(0)) remaining = remaining.plus(left);
      }
      if (remaining.isZero()) continue;
      const perDay = remaining.div(spreadDays);
      const days = byCurrency.get(p.plan.currency) ?? new Map<string, Decimal>();
      byCurrency.set(p.plan.currency, days);
      for (let i = 0; i < spreadDays; i += 1) {
        const date = addDays(spreadFrom, i);
        if (date < input.today || date > input.horizonEnd) continue;
        days.set(date, (days.get(date) ?? dec('0')).plus(perDay));
      }
    }
    return { byCurrency, periods };
  },
} as const;
