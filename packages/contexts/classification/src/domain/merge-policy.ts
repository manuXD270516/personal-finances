import { DomainError } from '@pf/shared-kernel';
import type { Category } from './category.js';
import { Alias, aliasList, type Counterparty } from './counterparty.js';
import { counterpartyMerged, categoryMerged, validation } from './errors.js';
import { SystemCategoryPolicy } from './system-categories.js';

/**
 * Políticas puras de fusión (openspec add-category-and-counterparty-merge, design decisión 2): validan origen y destino
 * y calculan qué se mueve. No tocan el almacenamiento; el servicio aplica el resultado en una única unidad de trabajo.
 */

/** Referencia a un dato en conflicto (`kind` es un tipo de referencia, no un agregado). */
export interface MergeConflictRef {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
}

/** Conflicto que bloquea la fusión (`CLASSIFICATION_MERGE_CONFLICT`). */
export interface MergeConflictInfo {
  readonly reason: string;
  readonly refs: readonly MergeConflictRef[];
}

export interface CategoryMergePlan {
  /** Subcategorías activas de la origen que pasan a ser hijas de la destino (D497: las archivadas no se mueven). */
  readonly movedSubcategories: readonly Category[];
  /** Conflictos propios de CLASSIFICATION (nombres de hermanas repetidos). */
  readonly conflicts: readonly MergeConflictInfo[];
}

export const CategoryMergePolicy = {
  /**
   * Valida la fusión de `source` en `target` y devuelve lo que se mueve. Orden de las reglas: origen igual a la destino
   * (`VALIDATION_FAILED`), ya fusionadas (`CATEGORY_MERGED`), origen de sistema (`SYSTEM_CATEGORY_IMMUTABLE`), tipos
   * distintos (`CATEGORY_KIND_MISMATCH`), destino archivada (`CATEGORY_ARCHIVED`) y profundidad
   * (`CATEGORY_DEPTH_EXCEEDED`). Un nombre repetido entre hermanas no lanza: se informa como conflicto.
   */
  plan(source: Category, target: Category, all: readonly Category[]): CategoryMergePlan {
    if (source.id === target.id) {
      throw validation('a category cannot be merged into itself', '/targetCategoryId');
    }
    if (source.isMerged) throw categoryMerged(source.mergedIntoId);
    if (target.isMerged) throw categoryMerged(target.mergedIntoId);
    if (source.isSystem) throw SystemCategoryPolicy.immutable('system categories cannot be merged');
    if (source.kind !== target.kind) {
      throw new DomainError('CATEGORY_KIND_MISMATCH', 'source and target categories have different kinds');
    }
    if (target.isArchived) throw new DomainError('CATEGORY_ARCHIVED', 'the target category is archived');
    const children = all.filter((c) => c.parentId === source.id && !c.isArchived);
    if (children.length === 0) return { movedSubcategories: [], conflicts: [] };
    if (target.parentId !== null) {
      throw new DomainError('CATEGORY_DEPTH_EXCEEDED', 'at most group → category → subcategory');
    }
    if (target.isSystem) {
      throw SystemCategoryPolicy.immutable('system categories cannot have subcategories');
    }
    const taken = new Map(
      all.filter((c) => c.parentId === target.id && !c.isArchived).map((c) => [c.normalizedName, c]),
    );
    const conflicts: MergeConflictInfo[] = [];
    for (const child of children) {
      const clash = taken.get(child.normalizedName);
      if (clash) {
        conflicts.push({
          reason: 'SUBCATEGORY_NAME_TAKEN',
          refs: [
            { kind: 'CATEGORY', id: child.id, label: child.name },
            { kind: 'CATEGORY', id: clash.id, label: clash.name },
          ],
        });
      }
    }
    return { movedSubcategories: children, conflicts };
  },
} as const;

export interface CounterpartyMergePlan {
  /** Alias de la origen que pasan a la destino (texto visible). */
  readonly movedAliases: readonly string[];
  /** Nombre de la origen agregado como alias de la destino (`null` si coincide con el nombre o un alias). */
  readonly nameAsAlias: string | null;
  /** Lista final de alias de la destino. */
  readonly aliases: readonly string[];
  /** Categoría por defecto final de la destino (D498). */
  readonly defaultCategoryId: string | null;
}

export const CounterpartyMergePolicy = {
  /**
   * Valida la fusión de `source` en `target` y calcula alias y categoría por defecto. Reglas: distintas
   * (`VALIDATION_FAILED`), ninguna fusionada (`COUNTERPARTY_MERGED`), destino activa (`COUNTERPARTY_ARCHIVED`). El tipo
   * puede diferir: la destino conserva el suyo. `activeCategoryIds` decide si la categoría por defecto de la origen se
   * hereda (D498: solo si la destino no tiene una y la de la origen está activa).
   */
  plan(
    source: Counterparty,
    target: Counterparty,
    all: readonly Counterparty[],
    activeCategoryIds: ReadonlySet<string>,
  ): CounterpartyMergePlan {
    if (source.id === target.id) {
      throw validation('a counterparty cannot be merged into itself', '/targetCounterpartyId');
    }
    if (source.isMerged) throw counterpartyMerged(source.mergedIntoId);
    if (target.isMerged) throw counterpartyMerged(target.mergedIntoId);
    if (target.isArchived)
      throw new DomainError('COUNTERPARTY_ARCHIVED', 'the target counterparty is archived');
    const targetKnown = new Set([target.normalizedName, ...target.normalizedAliases]);
    // Nombres y alias de terceras contrapartes activas: agregarlos como alias de la destino los colisionaría.
    const others = all.filter((c) => c.id !== source.id && c.id !== target.id && !c.isArchived);
    const foreign = new Set(others.flatMap((c) => [c.normalizedName, ...c.normalizedAliases]));
    const movedAliases: string[] = [];
    const finalAliases = [...target.aliases];
    for (const raw of source.aliases) {
      const a = Alias.of(raw);
      if (targetKnown.has(a.normalized)) continue;
      targetKnown.add(a.normalized);
      movedAliases.push(a.text);
      finalAliases.push(a.text);
    }
    let nameAsAlias: string | null = null;
    try {
      const name = Alias.of(source.name);
      if (!targetKnown.has(name.normalized) && !foreign.has(name.normalized)) {
        nameAsAlias = name.text;
        finalAliases.push(name.text);
      }
    } catch {
      // Un nombre demasiado corto para ser alias (mínimo 3 caracteres normalizados) no se agrega.
    }
    const inheritable =
      source.defaultCategoryId !== null && activeCategoryIds.has(source.defaultCategoryId)
        ? source.defaultCategoryId
        : null;
    return {
      movedAliases,
      nameAsAlias,
      aliases: aliasList(finalAliases).map((a) => a.text),
      defaultCategoryId: target.defaultCategoryId ?? inheritable,
    };
  },
} as const;
