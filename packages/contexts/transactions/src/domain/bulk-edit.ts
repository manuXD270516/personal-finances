import { DomainError } from '@pf/shared-kernel';
import {
  hasNominalSplits,
  type CustomFieldValue,
  type Split,
  type SplitInput,
  type TransactionKind,
  type TransactionState,
} from './transaction.js';

/**
 * Edición masiva de clasificación y estado `cleared` (openspec add-bulk-edit, FR-TRANSACTIONS-033). Reglas puras: qué
 * cambios admite una operación masiva y a qué transacciones se pueden aplicar. La edición masiva nunca toca montos,
 * cuentas, fechas ni el ledger (INV-033) y no puede tocar `systemFlags` (docs/33 D111).
 */

/** Máximo de transacciones por operación (docs/33 D94: sin asíncrono ni `BEST_EFFORT` en Phase 2). */
export const BULK_EDIT_MAX_ITEMS = 500;
const MAX_TAGS = 50;
const MAX_CUSTOM_FIELDS = 20;
const MAX_NOTES = 4000;

/** Cambio de un custom field: `value: null` lo quita; se identifica por `fieldId` o por `key`. */
export interface BulkCustomFieldChange {
  readonly fieldId?: string;
  readonly key?: string;
  readonly value: string | boolean | null;
}

export interface BulkEditChanges {
  /** Categoría nueva (solo transacciones de ingreso/gasto/reembolso con un único split). */
  readonly categoryId?: string;
  readonly addTagIds?: readonly string[];
  readonly removeTagIds?: readonly string[];
  /** Contraparte de la cabecera; `null` la quita. */
  readonly counterpartyId?: string | null;
  /** Reemplaza las notas; `null` las quita. */
  readonly notes?: string | null;
  /** `true` ⇒ `POSTED → CLEARED`; `false` ⇒ `CLEARED → POSTED`. */
  readonly cleared?: boolean;
  readonly customFields?: readonly BulkCustomFieldChange[];
}

const ALLOWED_KEYS: ReadonlySet<string> = new Set([
  'categoryId',
  'addTagIds',
  'removeTagIds',
  'counterpartyId',
  'notes',
  'cleared',
  'customFields',
]);

const invalid = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

function uniqueStrings(value: unknown, pointer: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.length === 0)) {
    throw invalid('must be a list of ids', pointer);
  }
  const unique = [...new Set(value as string[])];
  if (unique.length > MAX_TAGS) throw invalid(`at most ${MAX_TAGS} tags`, pointer);
  return unique;
}

/**
 * Valida y normaliza los cambios solicitados. Cualquier propiedad fuera de la lista (monto, cuenta, fecha, moneda,
 * splits, estado distinto de `cleared`, `systemFlags`…) ⇒ `VALIDATION_FAILED` y la operación completa se rechaza
 * (docs/10 §12; el validador de contrato ya lo hace en HTTP, esta es la defensa del dominio).
 */
export function parseBulkEditChanges(raw: unknown): BulkEditChanges {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw invalid('changes must be an object', '/changes');
  }
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!ALLOWED_KEYS.has(key)) throw invalid(`'${key}' cannot be changed in bulk`, `/changes/${key}`);
  }
  const out: { -readonly [K in keyof BulkEditChanges]: BulkEditChanges[K] } = {};
  if (input['categoryId'] !== undefined) {
    if (typeof input['categoryId'] !== 'string' || input['categoryId'].length === 0) {
      throw invalid('must be a category id', '/changes/categoryId');
    }
    out.categoryId = input['categoryId'];
  }
  if (input['addTagIds'] !== undefined)
    out.addTagIds = uniqueStrings(input['addTagIds'], '/changes/addTagIds');
  if (input['removeTagIds'] !== undefined) {
    out.removeTagIds = uniqueStrings(input['removeTagIds'], '/changes/removeTagIds');
  }
  if (out.addTagIds?.some((t) => out.removeTagIds?.includes(t))) {
    throw invalid('a tag cannot be added and removed in the same operation', '/changes/removeTagIds');
  }
  if (input['counterpartyId'] !== undefined) {
    const v = input['counterpartyId'];
    if (v !== null && (typeof v !== 'string' || v.length === 0)) {
      throw invalid('must be a counterparty id or null', '/changes/counterpartyId');
    }
    out.counterpartyId = v;
  }
  if (input['notes'] !== undefined) {
    const v = input['notes'];
    if (v !== null && typeof v !== 'string') throw invalid('must be text or null', '/changes/notes');
    if (typeof v === 'string' && v.length > MAX_NOTES) {
      throw invalid(`must be at most ${MAX_NOTES} characters`, '/changes/notes');
    }
    out.notes = v;
  }
  if (input['cleared'] !== undefined) {
    if (typeof input['cleared'] !== 'boolean') throw invalid('must be a boolean', '/changes/cleared');
    out.cleared = input['cleared'];
  }
  if (input['customFields'] !== undefined) {
    const list = input['customFields'];
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_CUSTOM_FIELDS) {
      throw invalid(`between 1 and ${MAX_CUSTOM_FIELDS} custom field changes`, '/changes/customFields');
    }
    out.customFields = list.map((c, i): BulkCustomFieldChange => {
      const item = c as Record<string, unknown>;
      const pointer = `/changes/customFields/${i}`;
      const fieldId = item['fieldId'];
      const key = item['key'];
      const value = item['value'];
      if ((typeof fieldId === 'string') === (typeof key === 'string')) {
        throw invalid('exactly one of fieldId or key is required', pointer);
      }
      if (value !== null && typeof value !== 'string' && typeof value !== 'boolean') {
        throw invalid('value must be text, boolean or null', `${pointer}/value`);
      }
      return {
        ...(typeof fieldId === 'string' ? { fieldId } : {}),
        ...(typeof key === 'string' ? { key } : {}),
        value: value as string | boolean | null,
      };
    });
  }
  if (Object.keys(out).length === 0) throw invalid('at least one change is required', '/changes');
  return out;
}

/** `splitKind` de la categoría que admite cada tipo de transacción. */
export const splitKindOf = (kind: TransactionKind): 'INCOME' | 'EXPENSE' | 'REFUND' =>
  kind === 'INCOME' ? 'INCOME' : kind === 'REFUND' ? 'REFUND' : 'EXPENSE';

const CLASSIFIABLE_KINDS: readonly TransactionKind[] = ['INCOME', 'EXPENSE', 'REFUND'];

export interface BulkNotApplicable {
  readonly code: 'BULK_EDIT_NOT_APPLICABLE';
  readonly detail: string;
}

/**
 * Aplicabilidad de los cambios a una transacción (design decisión 4): la categoría solo a ingresos, gastos y
 * reembolsos con exactamente UN split nominal; tags y custom fields a todos los splits nominales (sin splits
 * clasificables no son aplicables; los custom fields solo en ingreso/gasto/reembolso, D97); contraparte, notas y
 * `cleared` son de la cabecera y aplican a cualquier tipo (las reglas de estado las valida el agregado).
 */
export function bulkApplicability(
  state: Pick<TransactionState, 'kind' | 'splits'>,
  changes: BulkEditChanges,
): BulkNotApplicable[] {
  const out: BulkNotApplicable[] = [];
  const nominal = hasNominalSplits(state.kind) ? state.splits.length : 0;
  if (changes.categoryId !== undefined) {
    if (!CLASSIFIABLE_KINDS.includes(state.kind)) {
      out.push({ code: 'BULK_EDIT_NOT_APPLICABLE', detail: `a ${state.kind} has no category to change` });
    } else if (nominal !== 1) {
      out.push({
        code: 'BULK_EDIT_NOT_APPLICABLE',
        detail: `the category can only be changed on single-split transactions (${nominal} splits)`,
      });
    }
  }
  const tags = (changes.addTagIds?.length ?? 0) + (changes.removeTagIds?.length ?? 0) > 0;
  if (tags && nominal === 0) {
    out.push({ code: 'BULK_EDIT_NOT_APPLICABLE', detail: 'the transaction has no splits to tag' });
  }
  if ((changes.customFields?.length ?? 0) > 0) {
    if (!CLASSIFIABLE_KINDS.includes(state.kind) || nominal === 0) {
      out.push({
        code: 'BULK_EDIT_NOT_APPLICABLE',
        detail: `custom fields do not apply to ${state.kind} transactions`,
      });
    }
  }
  return out;
}

const byKey = (a: CustomFieldValue, b: CustomFieldValue) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** Valores de custom fields ya validados por CLASSIFICATION: a fijar y campos a quitar. */
export interface ResolvedCustomFieldPatch {
  readonly set: readonly CustomFieldValue[];
  readonly removeFieldIds: readonly string[];
}

/**
 * Splits finales (`SplitInput[]` conservando ids y montos) tras aplicar categoría, tags y custom fields a TODOS los
 * splits nominales (la categoría solo si hay uno; lo valida `bulkApplicability`). Función pura: el estado financiero
 * nunca cambia (INV-033).
 */
export function applyBulkToSplits(
  splits: readonly Split[],
  changes: Pick<BulkEditChanges, 'categoryId' | 'addTagIds' | 'removeTagIds'>,
  customFields?: ResolvedCustomFieldPatch,
): SplitInput[] {
  return splits.map((s) => {
    const removed = new Set(changes.removeTagIds ?? []);
    const tagIds = [...new Set([...s.tagIds, ...(changes.addTagIds ?? [])])]
      .filter((t) => !removed.has(t))
      .sort();
    let values: readonly CustomFieldValue[] = s.customFields;
    if (customFields) {
      const merged = new Map(s.customFields.map((v) => [v.fieldId, v]));
      for (const id of customFields.removeFieldIds) merged.delete(id);
      for (const v of customFields.set) merged.set(v.fieldId, v);
      values = [...merged.values()].sort(byKey);
    }
    return {
      id: s.id,
      amount: s.amount,
      categoryId: changes.categoryId ?? s.categoryId,
      counterpartyId: s.counterpartyId,
      tagIds,
      memo: s.memo,
      customFields: values,
    };
  });
}
