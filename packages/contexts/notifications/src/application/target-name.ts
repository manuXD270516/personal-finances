import type { CategoryTreeDto } from '@pf/classification/contracts';

/** Nombre vigente del objetivo en el árbol del catálogo; `null` si ya no existe (texto genérico al presentar). */
export function targetNameIn(tree: CategoryTreeDto, kind: string, id: string): string | null {
  if (kind === 'CATEGORY') return tree.categories.find((c) => c.categoryId === id)?.name ?? null;
  if (kind === 'GROUP') return tree.groups.find((g) => g.groupId === id)?.name ?? null;
  if (kind === 'TAG') return tree.tags.find((t) => t.tagId === id)?.name ?? null;
  return null;
}
