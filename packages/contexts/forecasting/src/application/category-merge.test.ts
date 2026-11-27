import type { CategoryMergeQuery } from '@pf/classification/contracts';
import { describe, expect, it } from 'vitest';
import { DetectSpendingAnomalies } from './detect-spending-anomalies.js';
import { withMergedCategories } from './merge-history.js';
import { buildAnomalyWorld, line, restaurantHistory } from './testing/anomaly-in-memory.js';

// Continuidad de la historia de una categoría fusionada (D496; classification/categories, openspec
// add-category-and-counterparty-merge): FORECAST lee la historia de la origen como historia de la destino.
const merged = (pairs: Record<string, string>): CategoryMergeQuery => ({
  resolve: async ({ categoryIds }) =>
    new Map(categoryIds.filter((id) => pairs[id] !== undefined).map((id) => [id, pairs[id] as string])),
});

describe('withMergedCategories', () => {
  it('[TC-CLASSIFICATION-MERGE-028] la serie de la destino incluye los meses cerrados de la origen fusionada', async () => {
    const rows = ['05', '06', '07', '08', '09', '10'].map((m) => ({
      businessDate: `2026-${m}-10`,
      categoryId: 'super',
      amount: '100.00',
    }));
    const out = await withMergedCategories(merged({ super: 'supermercado' }), 'w1', rows);
    expect(out.every((r) => r.categoryId === 'supermercado')).toBe(true);
    expect(out.map((r) => r.amount)).toEqual(rows.map((r) => r.amount));
    // Sin la consulta, o sin fusiones, las filas quedan como estaban (los reportes por periodo no cambian).
    expect(await withMergedCategories(undefined, 'w1', rows)).toBe(rows);
    expect(await withMergedCategories(merged({}), 'w1', rows)).toBe(rows);
    expect(rows.every((r) => r.categoryId === 'super')).toBe(true);
  });
});

describe('DetectSpendingAnomalies con una categoría fusionada', () => {
  it('[TC-CLASSIFICATION-MERGE-029] el gasto se evalúa con la historia de 12 gastos de la categoría fusionada y lo ya marcado no cambia', async () => {
    const build = () => {
      const w = buildAnomalyWorld();
      w.categories.push({ categoryId: 'cat-supermercado', uncategorized: false });
      w.lines.push(...restaurantHistory({ categoryId: 'cat-restaurantes' }));
      w.lines.push(line({ id: 'big', date: '2026-11-12', amount: '304.00', categoryId: 'cat-supermercado' }));
      return w;
    };
    const detect = (deps: ReturnType<typeof build>['deps']) =>
      new DetectSpendingAnomalies(deps).runWorkspace('w1');
    // Sin fusión, «Supermercado» no tiene historia: el gasto no se marca por categoría.
    const before = await detect(build().deps);
    expect(before).toMatchObject({ flagged: 0 });
    // Con «Restaurantes» fusionada en «Supermercado», sus 12 gastos son la historia de la destino.
    const w = build();
    const after = await detect({
      ...w.deps,
      categoryMerge: merged({ 'cat-restaurantes': 'cat-supermercado' }),
    });
    expect(after).toMatchObject({ evaluated: 1, flagged: 1 });
  });
});
