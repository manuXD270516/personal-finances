import { DomainError } from '@pf/shared-kernel';

/**
 * Ajustes del disponible del workspace (openspec add-cash-flow-forecast, design.md decisión 12; D377, D378): modo de
 * horizonte, esenciales presupuestados y la lista de categorías esenciales. Reglas puras de validación y de cambios.
 */

export const SPENDABLE_HORIZON_MODES = ['FINANCIAL_PERIOD', 'NEXT_INCOME'] as const;
export type SpendableSettingsMode = (typeof SPENDABLE_HORIZON_MODES)[number];

/** Máximo de categorías esenciales (FR-PLANNING-024 / spec "Ajustes del disponible del workspace"). */
export const MAX_ESSENTIAL_CATEGORIES = 50;

export interface SpendableSettingsValue {
  readonly horizonMode: SpendableSettingsMode;
  readonly subtractEssentials: boolean;
  readonly essentialCategoryIds: readonly string[];
}

/** Categoría del árbol de CLASSIFICATION (`categoryTree`) en la forma mínima de la validación. */
export interface SettingsCategory {
  readonly kind: 'EXPENSE' | 'INCOME' | string;
  readonly archived: boolean;
}

export interface SettingsChange {
  readonly field: 'horizonMode' | 'subtractEssentials' | 'essentialCategoryIds';
  readonly before: unknown;
  readonly after: unknown;
}

const sorted = (ids: readonly string[]) => [...ids].sort();

export const SpendableSettingsPolicy = {
  /**
   * Una categoría de ingreso ⇒ `CATEGORY_KIND_MISMATCH`, una archivada ⇒ `CATEGORY_ARCHIVED`, una inexistente,
   * repetida o más de 50 ⇒ `VALIDATION_FAILED`. No cambia nada.
   */
  validate(input: SpendableSettingsValue, categories: ReadonlyMap<string, SettingsCategory>): void {
    if (!(SPENDABLE_HORIZON_MODES as readonly string[]).includes(input.horizonMode)) {
      throw new DomainError('VALIDATION_FAILED', 'horizonMode must be FINANCIAL_PERIOD or NEXT_INCOME').at(
        '/horizonMode',
      );
    }
    const ids = input.essentialCategoryIds;
    if (ids.length > MAX_ESSENTIAL_CATEGORIES) {
      throw new DomainError(
        'VALIDATION_FAILED',
        `at most ${MAX_ESSENTIAL_CATEGORIES} essential categories`,
      ).at('/essentialCategoryIds');
    }
    if (new Set(ids).size !== ids.length) {
      throw new DomainError('VALIDATION_FAILED', 'essentialCategoryIds must not repeat categories').at(
        '/essentialCategoryIds',
      );
    }
    ids.forEach((id, index) => {
      const pointer = `/essentialCategoryIds/${index}`;
      const category = categories.get(id);
      if (!category) throw new DomainError('VALIDATION_FAILED', `category ${id} not found`).at(pointer);
      if (category.kind !== 'EXPENSE') {
        throw new DomainError('CATEGORY_KIND_MISMATCH', 'only expense categories can be essential').at(
          pointer,
        );
      }
      if (category.archived) {
        throw new DomainError('CATEGORY_ARCHIVED', 'an archived category cannot be marked as essential').at(
          pointer,
        );
      }
    });
  },

  /** Cambios entre dos valores (el orden de las categorías no cuenta); vacío ⇒ idempotente por contenido. */
  changes(before: SpendableSettingsValue, after: SpendableSettingsValue): SettingsChange[] {
    const out: SettingsChange[] = [];
    if (before.horizonMode !== after.horizonMode) {
      out.push({ field: 'horizonMode', before: before.horizonMode, after: after.horizonMode });
    }
    if (before.subtractEssentials !== after.subtractEssentials) {
      out.push({
        field: 'subtractEssentials',
        before: before.subtractEssentials,
        after: after.subtractEssentials,
      });
    }
    if (
      JSON.stringify(sorted(before.essentialCategoryIds)) !==
      JSON.stringify(sorted(after.essentialCategoryIds))
    ) {
      out.push({
        field: 'essentialCategoryIds',
        before: sorted(before.essentialCategoryIds),
        after: sorted(after.essentialCategoryIds),
      });
    }
    return out;
  },
} as const;
