import { DomainError } from '@pf/shared-kernel';
import type { BudgetNature, BudgetTarget } from './budget-types.js';

/**
 * Vista del catálogo de CLASSIFICATION que el dominio necesita (puerto de lectura `CategoryCatalogQuery.categoryTree`,
 * design decisión 2): jerarquía grupo -> categoría -> subcategoría con tipo y estado, y tags.
 */
export interface TargetTree {
  readonly groups: ReadonlyMap<string, { readonly kind: BudgetNature; readonly archived: boolean }>;
  readonly categories: ReadonlyMap<
    string,
    {
      readonly kind: BudgetNature;
      readonly groupId: string;
      readonly parentId: string | null;
      readonly archived: boolean;
    }
  >;
  readonly tags: ReadonlyMap<string, { readonly archived: boolean }>;
}

export interface ResolvedTarget {
  readonly nature: BudgetNature;
}

/**
 * Resuelve un objetivo contra el catálogo: inexistente => `REFERENCE_NOT_FOUND`; archivado => `CATEGORY_ARCHIVED` /
 * `TAG_ARCHIVED`; la naturaleza (gasto/ingreso) sale del `kind` de la categoría o del grupo (los tags son siempre de
 * gasto).
 */
export function resolveTarget(tree: TargetTree, target: BudgetTarget): ResolvedTarget {
  const pointer = '/target/id';
  if (target.kind === 'CATEGORY') {
    const category = tree.categories.get(target.id);
    if (!category) {
      throw new DomainError('REFERENCE_NOT_FOUND', `category ${target.id} not found`).at(pointer);
    }
    if (category.archived)
      throw new DomainError('CATEGORY_ARCHIVED', `category ${target.id} is archived`).at(pointer);
    return { nature: category.kind };
  }
  if (target.kind === 'GROUP') {
    const group = tree.groups.get(target.id);
    if (!group)
      throw new DomainError('REFERENCE_NOT_FOUND', `category group ${target.id} not found`).at(pointer);
    if (group.archived) {
      throw new DomainError('CATEGORY_ARCHIVED', `category group ${target.id} is archived`).at(pointer);
    }
    return { nature: group.kind };
  }
  const tag = tree.tags.get(target.id);
  if (!tag) throw new DomainError('REFERENCE_NOT_FOUND', `tag ${target.id} not found`).at(pointer);
  if (tag.archived) throw new DomainError('TAG_ARCHIVED', `tag ${target.id} is archived`).at(pointer);
  return { nature: 'EXPENSE' };
}

/** Categoría `id` y todas sus subcategorías (cualquier profundidad). */
export function categoryWithDescendants(tree: TargetTree, id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [cid, c] of tree.categories) {
      if (c.parentId !== null && out.has(c.parentId) && !out.has(cid)) {
        out.add(cid);
        grew = true;
      }
    }
  }
  return out;
}

/** Categorías (con subcategorías) que pertenecen a un grupo. */
export function categoriesOfGroup(tree: TargetTree, groupId: string): Set<string> {
  const out = new Set<string>();
  for (const [cid, c] of tree.categories) if (c.groupId === groupId) out.add(cid);
  return out;
}

/** Categorías que mide un objetivo de categoría o de grupo (los tags no se miden por categoría). */
export function categoriesOfTarget(tree: TargetTree, target: BudgetTarget): Set<string> {
  if (target.kind === 'CATEGORY') return categoryWithDescendants(tree, target.id);
  if (target.kind === 'GROUP') return categoriesOfGroup(tree, target.id);
  return new Set();
}

/**
 * DS `TargetOverlapPolicy` (design decisión 2): un plan no repite un objetivo (`BUDGET_LINE_DUPLICATE_TARGET`) ni
 * contiene a la vez una categoría y una de sus subcategorías, o un grupo y una categoría de ese grupo
 * (`BUDGET_TARGET_OVERLAP`), de modo que ningún gasto cuente en dos líneas del plan. Los tags son transversales: nunca
 * se solapan (y quedan fuera del disponible para gastar).
 */
export const TargetOverlapPolicy = {
  assertAllowed(existing: readonly BudgetTarget[], candidate: BudgetTarget, tree: TargetTree): void {
    for (const other of existing) {
      if (other.kind === candidate.kind && other.id === candidate.id) {
        throw new DomainError(
          'BUDGET_LINE_DUPLICATE_TARGET',
          `the plan already has a line for ${candidate.kind} ${candidate.id}`,
        ).at('/target');
      }
    }
    if (candidate.kind === 'TAG') return;
    const mine = categoriesOfTarget(tree, candidate);
    for (const other of existing) {
      if (other.kind === 'TAG') continue;
      const theirs = categoriesOfTarget(tree, other);
      const overlaps = [...mine].some((id) => theirs.has(id));
      if (overlaps) {
        throw new DomainError(
          'BUDGET_TARGET_OVERLAP',
          `${candidate.kind} ${candidate.id} overlaps the existing line for ${other.kind} ${other.id}`,
        ).at('/target');
      }
    }
  },
} as const;
