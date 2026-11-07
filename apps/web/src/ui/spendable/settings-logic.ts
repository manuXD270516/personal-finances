import type { Category, CategoryGroup } from '../common/types';
import type { SpendableHorizonMode, SpendableSettings, SpendableSettingsInput } from '../cash-flow/types';

/** Máximo de categorías esenciales que acepta la API (`VALIDATION_FAILED` por encima). */
export const MAX_ESSENTIAL_CATEGORIES = 50;

export const HORIZON_MODES: readonly SpendableHorizonMode[] = ['FINANCIAL_PERIOD', 'NEXT_INCOME'];

export const settingsApiPath = (base: string): string => `${base}/reports/spendable/settings`;

/** Borrador editable de los ajustes (sin la versión: esa viaja en `If-Match`). */
export type SettingsDraft = SpendableSettingsInput;

export const draftOf = (settings: SpendableSettings): SettingsDraft => ({
  horizonMode: settings.horizonMode,
  subtractEssentials: settings.subtractEssentials,
  essentialCategoryIds: [...settings.essentialCategoryIds],
});

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().every((id, i) => id === [...b].sort()[i]);

/** ¿El borrador cambia algo respecto de lo guardado? (el orden de las categorías no cuenta). */
export const settingsChanged = (saved: SpendableSettings, draft: SettingsDraft): boolean =>
  saved.horizonMode !== draft.horizonMode ||
  saved.subtractEssentials !== draft.subtractEssentials ||
  !sameIds(saved.essentialCategoryIds, draft.essentialCategoryIds);

/** Marca o desmarca una categoría; llegado al máximo no admite una más. */
export function toggleCategory(ids: readonly string[], id: string): readonly string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  return ids.length >= MAX_ESSENTIAL_CATEGORIES ? ids : [...ids, id];
}

export interface CategoryOption {
  readonly id: string;
  readonly label: string;
  /** Archivada pero todavía marcada: se muestra para poder quitarla (la API rechaza guardarla). */
  readonly archived: boolean;
}

/**
 * Categorías que se pueden marcar como esenciales: solo de gasto y no archivadas (las de ingreso las rechaza la API con
 * `CATEGORY_KIND_MISMATCH` y las archivadas con `CATEGORY_ARCHIVED`). Una archivada ya guardada se conserva en la lista para
 * poder desmarcarla. Orden: grupo y luego categoría, por su orden y nombre.
 */
export function categoryOptions(
  categories: readonly Category[],
  groups: readonly CategoryGroup[],
  selected: readonly string[],
): readonly CategoryOption[] {
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const groupOrder = new Map(groups.map((g) => [g.id, g.sortOrder]));
  return categories
    .filter((c) => c.kind === 'EXPENSE' && (!c.archivedAt || selected.includes(c.id)))
    .sort(
      (a, b) =>
        (groupOrder.get(a.groupId) ?? 0) - (groupOrder.get(b.groupId) ?? 0) ||
        a.sortOrder - b.sortOrder ||
        a.name.localeCompare(b.name),
    )
    .map((c) => {
      const group = groupName.get(c.groupId);
      return { id: c.id, label: group ? `${group} · ${c.name}` : c.name, archived: !!c.archivedAt };
    });
}
