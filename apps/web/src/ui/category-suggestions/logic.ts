import type { FormatContext } from '../dashboard/types';

/**
 * Sugerencias de categoría por historial en la UI (openspec add-category-suggestions, FR-CLASSIFICATION-014, D476).
 * Todo lo de este archivo es puro: la sugerencia NUNCA se aplica sola; el usuario la acepta o elige otra categoría.
 */

export type SuggestionLevel = 'HIGH' | 'MEDIUM';
export type SuggestionBasis = 'COUNTERPARTY' | 'DESCRIPTION' | 'BOTH';
export type SuggestionKind = 'INCOME' | 'EXPENSE' | 'REFUND';

/** `HistoryCategorySuggestion` del contrato. */
export interface HistorySuggestion {
  readonly categoryId: string;
  readonly confidence: string;
  readonly level: SuggestionLevel;
  readonly support: number;
  readonly matches: number;
  readonly basis: SuggestionBasis;
  readonly descriptionKey: string | null;
  readonly counterpartyId: string | null;
}

export interface SuggestionResult {
  readonly status: 'SUGGESTED' | 'RULE_APPLIES' | 'NONE' | 'DISABLED';
  readonly suggestion: HistorySuggestion | null;
  readonly ruleId: string | null;
}

/** Respuesta de `getCounterpartyCategorySuggestion` (FR-CLASSIFICATION-011). */
export interface CounterpartySuggestion {
  readonly categoryId: string | null;
  readonly source: 'DEFAULT' | 'LAST_USED' | 'NONE';
}

/** Lo que el formulario muestra en el chip de sugerencia. */
export type ChipSuggestion =
  | { readonly source: 'RULE_APPLIES'; readonly ruleId: string }
  | { readonly source: 'DEFAULT'; readonly categoryId: string }
  | { readonly source: 'HISTORY'; readonly suggestion: HistorySuggestion }
  | { readonly source: 'LAST_USED'; readonly categoryId: string };

/** Debounce de la consulta del alta manual (decisión 5 del diseño). */
export const SUGGEST_DEBOUNCE_MS = 400;

export const queryPath = (base: string): string => `${base}/category-suggestions/query`;
export const feedbackPath = (base: string): string => `${base}/category-suggestions/feedback`;
export const statsPath = (base: string, from: string, to: string): string =>
  `${base}/category-suggestions/stats?from=${from}&to=${to}`;
export const acceptSuggestionsPath = (base: string, importId: string): string =>
  `${base}/imports/${importId}/rows/accept-suggestions`;
export const counterpartySuggestionPath = (
  base: string,
  counterpartyId: string,
  kind: SuggestionKind,
): string =>
  `${base}/counterparties/${counterpartyId}/category-suggestion?kind=${kind === 'INCOME' ? 'INCOME' : 'EXPENSE'}`;

/**
 * Cuerpo de la consulta: la descripción viaja en el cuerpo y nunca en la URL (es un dato personal). `null` si no hay
 * nada que consultar (ni descripción ni contraparte).
 */
export function queryBody(input: {
  readonly kind: SuggestionKind;
  readonly description: string;
  readonly counterpartyId: string;
  readonly accountId: string;
  readonly date: string;
}): Record<string, unknown> | null {
  const description = input.description.trim();
  if (description === '' && input.counterpartyId === '') return null;
  return {
    kind: input.kind,
    ...(description !== '' ? { description: description.slice(0, 500) } : {}),
    ...(input.counterpartyId !== '' ? { counterpartyId: input.counterpartyId } : {}),
    ...(input.accountId !== '' ? { accountId: input.accountId } : {}),
    ...(input.date !== '' ? { date: input.date } : {}),
  };
}

/**
 * Precedencia de lo que se muestra (docs/77 D476 y FR-CLASSIFICATION-011): una regla de alta manual que clasificará el
 * gasto, la categoría por defecto de la contraparte, la sugerencia por historial (que reemplaza a «la última usada») y,
 * si no hay ninguna, la última categoría usada con la contraparte.
 */
export function resolveChip(
  counterparty: CounterpartySuggestion | null,
  history: SuggestionResult | null,
): ChipSuggestion | null {
  if (history?.status === 'RULE_APPLIES' && history.ruleId) {
    return { source: 'RULE_APPLIES', ruleId: history.ruleId };
  }
  if (counterparty?.source === 'DEFAULT' && counterparty.categoryId) {
    return { source: 'DEFAULT', categoryId: counterparty.categoryId };
  }
  if (history?.status === 'SUGGESTED' && history.suggestion) {
    return { source: 'HISTORY', suggestion: history.suggestion };
  }
  if (counterparty?.source === 'LAST_USED' && counterparty.categoryId) {
    return { source: 'LAST_USED', categoryId: counterparty.categoryId };
  }
  return null;
}

/** El chip propone una categoría (no es el aviso de una regla). */
export const chipCategoryId = (chip: ChipSuggestion): string | null =>
  chip.source === 'RULE_APPLIES'
    ? null
    : chip.source === 'HISTORY'
      ? chip.suggestion.categoryId
      : chip.categoryId;

/**
 * Motivo por plantilla, sin modelos de lenguaje (TC-CLASSIFICATION-AUTO-017): cuántas de cuántas transacciones del patrón
 * el usuario puso en esa categoría y el patrón (la clave normalizada de la descripción o la contraparte).
 */
export function reasonText(
  f: FormatContext,
  suggestion: HistorySuggestion,
  names: {
    readonly category: string;
    readonly counterparty?: string | undefined;
    readonly kind: SuggestionKind;
  },
): string {
  const base = {
    category: names.category,
    matches: suggestion.matches,
    support: suggestion.support,
    kind: f.t(`reason.kind.${names.kind}`),
  };
  if (suggestion.basis === 'COUNTERPARTY') {
    return f.t('reason.counterparty', { ...base, counterparty: names.counterparty ?? '' });
  }
  if (suggestion.basis === 'BOTH') {
    return f.t('reason.both', { ...base, key: suggestion.descriptionKey ?? '' });
  }
  return f.t('reason.description', { ...base, key: suggestion.descriptionKey ?? '' });
}

/** Primer y último día del mes de `today` (`YYYY-MM-DD`), para la tarjeta de la tasa de aceptación. */
export function monthRange(today: string): { readonly from: string; readonly to: string } {
  const [y, m] = today.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

/** Tasa de aceptación como porcentaje legible (`0.7500` → `75 %`); `—` si no hay sugerencias. */
export function rateText(share: string | null, locale: string): string {
  if (share === null) return '—';
  // El texto decimal de la API se formatea tal cual, sin pasarlo por `number`.
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(
    share as `${number}`,
  );
}

/** Respuesta de `getCategorySuggestionStats`. */
export interface SuggestionStats {
  readonly from: string;
  readonly to: string;
  readonly shown: number;
  readonly accepted: number;
  readonly corrected: number;
  readonly ignored: number;
  readonly acceptanceRate: string | null;
  readonly bySurface: readonly {
    readonly surface: 'MANUAL_ENTRY' | 'IMPORT';
    readonly shown: number;
    readonly accepted: number;
    readonly corrected: number;
    readonly ignored: number;
  }[];
  readonly byLevel: readonly {
    readonly level: SuggestionLevel;
    readonly shown: number;
    readonly accepted: number;
    readonly corrected: number;
    readonly ignored: number;
  }[];
}

/** Filas de la vista previa con una sugerencia vigente, por nivel (para los botones de aceptación en lote). */
export function suggestionCounts(
  rows: readonly { readonly suggestedCategory?: HistorySuggestion | null | undefined }[],
): { readonly high: number; readonly medium: number } {
  let high = 0;
  let medium = 0;
  for (const r of rows) {
    if (r.suggestedCategory?.level === 'HIGH') high += 1;
    else if (r.suggestedCategory?.level === 'MEDIUM') medium += 1;
  }
  return { high, medium };
}
