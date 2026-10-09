import type { ApiProblemBody } from '../../bff/finance-api-client';
import { customFieldParams, type CustomFieldDefinition } from '../custom-fields/logic';
import type { TransactionFilters } from './logic';

/**
 * Edición masiva (openspec add-bulk-edit 6.1; FR-TRANSACTIONS-033). Lógica pura de la pantalla: el borrador de cambios
 * que arma el usuario, el cuerpo de la API (`BulkEditChanges` / filtros de la vista previa) y la lectura de los
 * errores por ítem de una operación rechazada. La API valida todo igual; esto solo evita peticiones vacías.
 */

/** Tope de una operación síncrona (docs/33 D94): 500 transacciones. */
export const BULK_EDIT_MAX_ITEMS = 500;

/** Valor del selector de contraparte para quitarla (`counterpartyId: null`). */
export const CLEAR_COUNTERPARTY = '__clear__';

export type BulkClearedChoice = '' | 'cleared' | 'uncleared';

export interface BulkDraft {
  /** Categoría nueva; vacío = sin cambio. */
  readonly categoryId: string;
  readonly addTagIds: readonly string[];
  readonly removeTagIds: readonly string[];
  /** Vacío = sin cambio; `CLEAR_COUNTERPARTY` = quitar; si no, el id de la contraparte. */
  readonly counterparty: string;
  readonly cleared: BulkClearedChoice;
}

export const EMPTY_BULK_DRAFT: BulkDraft = {
  categoryId: '',
  addTagIds: [],
  removeTagIds: [],
  counterparty: '',
  cleared: '',
};

/** `changes` de la API (`BulkEditChanges`); `undefined` si el borrador no cambia nada. */
export interface BulkChanges {
  categoryId?: string;
  addTagIds?: string[];
  removeTagIds?: string[];
  counterpartyId?: string | null;
  cleared?: boolean;
}

export function bulkChanges(d: BulkDraft): BulkChanges | undefined {
  const out: BulkChanges = {};
  if (d.categoryId) out.categoryId = d.categoryId;
  if (d.addTagIds.length > 0) out.addTagIds = [...d.addTagIds];
  const removed = d.removeTagIds.filter((id) => !d.addTagIds.includes(id));
  if (removed.length > 0) out.removeTagIds = removed;
  if (d.counterparty === CLEAR_COUNTERPARTY) out.counterpartyId = null;
  else if (d.counterparty) out.counterpartyId = d.counterparty;
  if (d.cleared) out.cleared = d.cleared === 'cleared';
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Una etiqueta no puede agregarse y quitarse a la vez (la API lo rechaza con `VALIDATION_FAILED`). */
export const conflictingTags = (d: BulkDraft): string[] =>
  d.addTagIds.filter((id) => d.removeTagIds.includes(id));

/**
 * Filtros del registro como `BulkEditFilter` (los mismos del listado, en el cuerpo): lo que la vista previa resuelve a
 * las transacciones y versiones que luego se envían a ejecutar.
 */
export function bulkFilter(
  f: TransactionFilters,
  custom?: { readonly definition: CustomFieldDefinition | undefined; readonly locale: string },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (f.q.trim()) out['q'] = f.q.trim();
  if (f.accountId) out['accountId'] = [f.accountId];
  if (f.kind) out['kind'] = [f.kind];
  if (f.status) out['status'] = [f.status];
  if (f.withoutStatement) out['systemFlag'] = ['RECONCILED_WITHOUT_STATEMENT'];
  if (f.paymentMethod) out['paymentMethod'] = [f.paymentMethod];
  if (f.categoryId) out['categoryId'] = [f.categoryId];
  if (f.dateFrom) out['dateFrom'] = f.dateFrom;
  if (f.dateTo) out['dateTo'] = f.dateTo;
  if (custom) {
    const fields: Record<string, string | { gte?: string; lte?: string }> = {};
    for (const [name, value] of customFieldParams(custom.definition, f.customField, custom.locale)) {
      // `customField[clave]` (igualdad) o `customField[clave][gte|lte]` (rango).
      const m = /^customField\[([^\]]+)\](?:\[(gte|lte)\])?$/.exec(name);
      if (!m) continue;
      const key = m[1]!;
      if (m[2]) {
        const range = (typeof fields[key] === 'object' ? fields[key] : {}) as { gte?: string; lte?: string };
        fields[key] = { ...range, [m[2]]: value };
      } else fields[key] = value;
    }
    if (Object.keys(fields).length > 0) out['customField'] = fields;
  }
  return out;
}

export interface BulkPreviewItem {
  readonly id: string;
  readonly version: number | null;
  readonly applicable: boolean;
  readonly reasons: readonly string[];
}

export interface BulkPreview {
  readonly count: number;
  readonly truncated: boolean;
  readonly items: readonly BulkPreviewItem[];
}

/** Ítems aplicables (los que se pueden enviar) y no aplicables de una vista previa. */
export function splitPreview(p: BulkPreview): {
  readonly applicable: readonly BulkPreviewItem[];
  readonly blocked: readonly BulkPreviewItem[];
} {
  return {
    applicable: p.items.filter((i) => i.applicable && i.version !== null),
    blocked: p.items.filter((i) => !i.applicable || i.version === null),
  };
}

/** Cuerpo de la ejecución: cada ítem con su versión vigente en la vista previa (equivale a `If-Match` por ítem). */
export const bulkEditItems = (items: readonly BulkPreviewItem[]) =>
  items.map((i) => ({ id: i.id, version: i.version as number }));

export interface BulkItemError {
  /** Posición del ítem en la solicitud. */
  readonly index: number;
  readonly code: string;
}

/**
 * Errores por ítem de una operación rechazada (`errors[]` con `pointer: /items/<i>[/…]`, RFC 9457). Los errores sin
 * ítem (por ejemplo de `changes`) se ignoran: se muestran como el problema general.
 */
export function itemErrors(problem: ApiProblemBody | undefined): BulkItemError[] {
  const raw = problem?.['errors'];
  if (!Array.isArray(raw)) return [];
  const out: BulkItemError[] = [];
  for (const e of raw as { pointer?: unknown; code?: unknown }[]) {
    const m = typeof e.pointer === 'string' ? /^\/items\/(\d+)(?:\/|$)/.exec(e.pointer) : null;
    if (m && typeof e.code === 'string') out.push({ index: Number(m[1]), code: e.code });
  }
  return out;
}
