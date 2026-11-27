import type { CategoryMergeQuery } from '@pf/classification/contracts';

/**
 * D496 (openspec add-category-and-counterparty-merge, decisión 9): las filas de una categoría fusionada cuentan como
 * de su destino vigente, también las que quedaron en periodos cerrados, para que la serie de la destino conserve la
 * historia. No cambia los reportes por periodo ni lo ya publicado: solo la lectura de la historia del pronóstico y de
 * los gastos atípicos. Sin `CategoryMergeQuery` (o sin fusiones) devuelve las filas tal cual.
 */
export async function withMergedCategories<R extends { readonly categoryId: string }>(
  merge: CategoryMergeQuery | undefined,
  workspaceId: string,
  rows: readonly R[],
): Promise<readonly R[]> {
  if (!merge || rows.length === 0) return rows;
  const resolved = await merge.resolve({
    workspaceId,
    categoryIds: [...new Set(rows.map((r) => r.categoryId))],
  });
  if (resolved.size === 0) return rows;
  return rows.map((r) => {
    const target = resolved.get(r.categoryId);
    return target === undefined ? r : { ...r, categoryId: target };
  });
}
