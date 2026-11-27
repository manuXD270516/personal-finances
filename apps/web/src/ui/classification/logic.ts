import type { Category, CategoryGroup, Counterparty } from '../common/types';
import type { MergeCount, MergePreview, MergeTargetGroup } from './types';

/**
 * Lógica pura de la pantalla de clasificación (add-classification 8.1/8.2): árbol grupo → categoría → subcategoría
 * en el orden persistente (`sortOrder`, luego nombre), reordenamiento de hermanas (botones accesibles por teclado y
 * arrastrar) y alias de contrapartes.
 */

/** Iconos del catálogo sugerido (`default-catalog.es-BO.v1.json`) con su glifo de presentación (decorativo). */
export const CATEGORY_ICONS: Readonly<Record<string, string>> = {
  baby: '🍼',
  bike: '🚲',
  bolt: '⚡',
  book: '📖',
  briefcase: '💼',
  building: '🏢',
  bus: '🚌',
  car: '🚗',
  cart: '🛒',
  clock: '⏰',
  coffee: '☕',
  dots: '⋯',
  dumbbell: '🏋',
  fuel: '⛽',
  gift: '🎁',
  glass: '🥂',
  graduation: '🎓',
  heart: '❤',
  home: '🏠',
  key: '🔑',
  laptop: '💻',
  paw: '🐾',
  pencil: '✏',
  pie: '🥧',
  pill: '💊',
  plane: '✈',
  play: '▶',
  school: '🏫',
  shield: '🛡',
  shirt: '👕',
  sofa: '🛋',
  sparkles: '✨',
  stethoscope: '🩺',
  tag: '🏷',
  taxi: '🚕',
  ticket: '🎟',
  tooth: '🦷',
  'trending-up': '📈',
  undo: '↩',
  users: '👥',
  utensils: '🍴',
  wrench: '🔧',
};
export const ICON_NAMES: readonly string[] = Object.keys(CATEGORY_ICONS);

/** Color `#RRGGBB` válido para `<input type="color">` (otros valores guardados se muestran sin selector). */
export const isHexColor = (v: string | null | undefined): v is string => !!v && /^#[0-9a-fA-F]{6}$/.test(v);

const byOrder = (a: { sortOrder: number; name: string }, b: { sortOrder: number; name: string }) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

export interface CategoryNode {
  readonly category: Category;
  readonly children: readonly Category[];
}

export interface GroupNode {
  readonly group: CategoryGroup;
  readonly categories: readonly CategoryNode[];
}

/** Árbol grupo → categoría → subcategoría en el orden persistente (grupos sin categorías incluidos). */
export function categoryTree(groups: readonly CategoryGroup[], categories: readonly Category[]): GroupNode[] {
  return [...groups].sort(byOrder).map((group) => ({
    group,
    categories: categories
      .filter((c) => c.groupId === group.id && !c.parentId)
      .sort(byOrder)
      .map((category) => ({
        category,
        children: categories.filter((s) => s.parentId === category.id).sort(byOrder),
      })),
  }));
}

/** Hermanas activas (mismo grupo y padre) en el orden persistente: el conjunto exacto que exige `reorder`. */
export function activeSiblings(categories: readonly Category[], of: Category): Category[] {
  return categories
    .filter(
      (c) => !c.archivedAt && c.groupId === of.groupId && (c.parentId ?? null) === (of.parentId ?? null),
    )
    .sort(byOrder);
}

/** Mueve `id` a la posición `index` (acotada); `null` si no cambia el orden o `id` no está. */
export function moveTo(ids: readonly string[], id: string, index: number): string[] | null {
  const from = ids.indexOf(id);
  if (from < 0) return null;
  const to = Math.max(0, Math.min(ids.length - 1, index));
  if (to === from) return null;
  const out = ids.filter((x) => x !== id);
  out.splice(to, 0, id);
  return out;
}

/** Sube (−1) o baja (+1) una posición; `null` en los extremos (alternativa por teclado a arrastrar). */
export const moveBy = (ids: readonly string[], id: string, delta: -1 | 1): string[] | null =>
  ids.indexOf(id) < 0 ? null : moveTo(ids, id, ids.indexOf(id) + delta);

/**
 * Alias escritos separados por comas o saltos de línea: sin vacíos ni repetidos (ignorando mayúsculas); cada alias
 * debe tener ≥ 3 caracteres y como máximo hay 20 (`CounterpartyUpdate.aliases`).
 */
export function parseAliases(
  raw: string,
): { ok: true; aliases: string[] } | { ok: false; error: 'ALIAS_MIN' | 'ALIAS_MAX_COUNT' } {
  const seen = new Set<string>();
  const aliases: string[] = [];
  for (const part of raw.split(/[,\n]/)) {
    const alias = part.trim().replace(/\s+/g, ' ');
    if (!alias) continue;
    const key = alias.toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  if (aliases.some((a) => a.length < 3 || a.length > 120)) return { ok: false, error: 'ALIAS_MIN' };
  if (aliases.length > 20) return { ok: false, error: 'ALIAS_MAX_COUNT' };
  return { ok: true, aliases };
}

// ── Fusión de categorías y contrapartes (add-category-and-counterparty-merge, tareas 6.1 a 6.3) ──────────────────

/**
 * Destinos compatibles para fusionar `source` en otra categoría: mismo tipo de movimiento, activa, no fusionada y
 * distinta de la origen. Se puede elegir el padre de una subcategoría; si la origen tiene subcategorías activas, una
 * subcategoría no sirve de destino (excedería la profundidad). Agrupadas por grupo en el orden persistente.
 */
export function categoryMergeTargets(
  groups: readonly CategoryGroup[],
  categories: readonly Category[],
  source: Category,
): MergeTargetGroup[] {
  const hasActiveChildren = categories.some((c) => c.parentId === source.id && !c.archivedAt);
  const byId = new Map(categories.map((c) => [c.id, c]));
  const eligible = (c: Category) =>
    c.id !== source.id &&
    c.kind === source.kind &&
    !c.archivedAt &&
    !c.mergedInto &&
    !(hasActiveChildren && c.parentId);
  return [...groups]
    .sort(byOrder)
    .map((g) => ({
      label: g.name,
      options: categories
        .filter((c) => c.groupId === g.id && eligible(c))
        .sort((a, b) => {
          const pa = a.parentId ? (byId.get(a.parentId)?.name ?? '') : a.name;
          const pb = b.parentId ? (byId.get(b.parentId)?.name ?? '') : b.name;
          return pa.localeCompare(pb) || Number(!!a.parentId) - Number(!!b.parentId) || byOrder(a, b);
        })
        .map((c) => ({
          id: c.id,
          label: c.parentId ? `${byId.get(c.parentId)?.name ?? '…'} › ${c.name}` : c.name,
        })),
    }))
    .filter((g) => g.options.length > 0);
}

/** Destinos compatibles para fusionar una contraparte: activa, no fusionada y distinta de la origen. */
export function counterpartyMergeTargets(
  counterparties: readonly Counterparty[],
  source: Counterparty,
): MergeTargetGroup['options'] {
  return counterparties
    .filter((c) => c.id !== source.id && !c.archivedAt && !c.mergedInto)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, label: c.name }));
}

/** Conteos para mostrar: sin los que valen 0, en el orden en que los informa la API. Las claves nuevas se toleran. */
export const visibleCounts = (counts: readonly MergeCount[]): MergeCount[] =>
  counts.filter((c) => c.count > 0);

/**
 * La fusión se puede confirmar solo con una vista previa cargada sin conflictos y con la casilla de «no se puede
 * deshacer» marcada.
 */
export const canConfirmMerge = (preview: MergePreview | null | undefined, acknowledged: boolean): boolean =>
  !!preview && preview.conflicts.length === 0 && acknowledged;
