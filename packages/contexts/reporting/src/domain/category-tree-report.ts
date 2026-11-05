import type { FlowFact } from './income-expense-report.js';
import { ReportConversionPolicy, type ReportAmount } from './report-conversion.js';

export interface CategoryNodeInfo {
  readonly categoryId: string;
  readonly name: string;
  readonly groupId: string;
  readonly parentId: string | null;
  readonly archived: boolean;
}

export interface CategoryGroupInfo {
  readonly groupId: string;
  readonly name: string;
}

export interface CategoryLeaf {
  readonly categoryId: string;
  readonly name: string;
  readonly archived: boolean;
  readonly amount: ReportAmount;
  readonly negativeNet: boolean;
}

export interface CategoryNode extends CategoryLeaf {
  readonly subcategories: readonly CategoryLeaf[];
}

export interface CategoryGroup {
  readonly groupId: string;
  readonly name: string;
  readonly amount: ReportAmount;
  readonly negativeNet: boolean;
  readonly categories: readonly CategoryNode[];
}

export interface CategoryTree {
  readonly groups: readonly CategoryGroup[];
  /** El resto cuando se pidió `topN`; `null` si no hubo recorte. */
  readonly others: ReportAmount | null;
  readonly total: ReportAmount;
}

/** Un neto negativo (reembolsos mayores al gasto) conserva su signo y se marca. */
export const isNegativeNet = (a: ReportAmount): boolean =>
  a.exact.isNegative() || (a.exact.isZero() && a.byCurrency.some((m) => m.isNegative()));

const compareNames = (a: string, b: string) => a.localeCompare(b, 'es');

/**
 * `CategoryTreeReport` (reporte 3): gasto por grupo → categoría → subcategoría. Una categoría suma sus subcategorías
 * y las archivadas siguen apareciendo con su historia. Se ordena de mayor a menor por el consolidado (empate por
 * nombre) y `topN` conserva las N categorías mayores agrupando el resto en "Otras categorías". Puro.
 */
export const CategoryTreeReport = {
  build(input: {
    readonly flows: readonly FlowFact[];
    readonly groups: readonly CategoryGroupInfo[];
    readonly categories: readonly CategoryNodeInfo[];
    readonly policy: ReportConversionPolicy;
    readonly topN?: number;
    readonly perDays?: number;
  }): CategoryTree {
    const { policy, perDays } = input;
    const expense = input.flows.filter((f) => f.nature === 'EXPENSE');
    const byId = new Map(input.categories.map((c) => [c.categoryId, c]));
    const rowsOf = (pred: (categoryId: string) => boolean) =>
      expense.filter((f) => pred(f.categoryId)).map((f) => ({ date: f.date, amount: f.amount }));
    const leaf = (c: CategoryNodeInfo, value: ReportAmount): CategoryLeaf => ({
      categoryId: c.categoryId,
      name: c.name,
      archived: c.archived,
      amount: value,
      negativeNet: isNegativeNet(value),
    });
    const order = <T extends { amount: ReportAmount; name: string }>(items: T[]): T[] =>
      items.sort((a, b) => b.amount.exact.comparedTo(a.amount.exact) || compareNames(a.name, b.name));

    // Categorías de primer nivel con sus subcategorías (solo las que tienen movimientos).
    const tops = input.categories.filter((c) => c.parentId === null);
    const nodes: (CategoryNode & { groupId: string })[] = [];
    for (const c of tops) {
      const subs = input.categories.filter((s) => s.parentId === c.categoryId);
      const ids = new Set([c.categoryId, ...subs.map((s) => s.categoryId)]);
      const own = rowsOf((id) => ids.has(id));
      if (own.length === 0) continue;
      const subLeaves = order(
        subs
          .filter((s) => rowsOf((id) => id === s.categoryId).length > 0)
          .map((s) =>
            leaf(
              s,
              policy.value(
                rowsOf((id) => id === s.categoryId),
                perDays,
              ),
            ),
          ),
      );
      nodes.push({ ...leaf(c, policy.value(own, perDays)), subcategories: subLeaves, groupId: c.groupId });
    }
    // Movimientos de una categoría desconocida (no debería ocurrir): se informan sin perderlos.
    const known = new Set(input.categories.map((c) => c.categoryId));
    const stray = rowsOf((id) => !known.has(id) && !byId.has(id));
    if (stray.length > 0) {
      nodes.push({
        categoryId: 'unknown',
        name: 'Sin categoría',
        archived: false,
        amount: policy.value(stray, perDays),
        negativeNet: false,
        subcategories: [],
        groupId: '',
      });
    }
    const ordered = order(nodes);
    const total = policy.value(
      rowsOf(() => true),
      perDays,
    );
    const limit = input.topN;
    const kept = limit !== undefined && limit < ordered.length ? ordered.slice(0, limit) : ordered;
    const dropped = limit !== undefined && limit < ordered.length ? ordered.slice(limit) : [];
    const others =
      dropped.length > 0
        ? ReportConversionPolicy.combine(
            policy.target,
            dropped.map((d) => d.amount),
          )
        : null;
    const groupInfo = new Map(input.groups.map((g) => [g.groupId, g]));
    const groups: CategoryGroup[] = [];
    for (const groupId of new Set(kept.map((n) => n.groupId))) {
      const members = kept.filter((n) => n.groupId === groupId);
      const amount = ReportConversionPolicy.combine(
        policy.target,
        members.map((m) => m.amount),
      );
      groups.push({
        groupId,
        name: groupInfo.get(groupId)?.name ?? 'Sin grupo',
        amount,
        negativeNet: isNegativeNet(amount),
        categories: order(members).map(({ groupId: _g, ...rest }) => rest),
      });
    }
    return { groups: order(groups), others, total };
  },
} as const;
