import { DomainError } from '@pf/shared-kernel';

/**
 * Acciones del DSL (openspec add-rule-engine, decisión 8). El esquema NO tiene propiedades para monto, moneda, cuenta,
 * fecha, tipo ni estado (`additionalProperties: false`): una definición que intente fijarlos se rechaza con
 * `VALIDATION_FAILED` y la regla jamás genera asientos (INV-004/005 sin cambio).
 */

export const ACTION_TYPES = [
  'SET_CATEGORY',
  'ADD_TAG',
  'REMOVE_TAG',
  'SET_COUNTERPARTY',
  'SET_CUSTOM_FIELD',
  'MARK_FOR_REVIEW',
  'SET_DESCRIPTION',
  'APPEND_NOTE',
  'EXCLUDE_FROM_IMPORT',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export type Action =
  | { readonly type: 'SET_CATEGORY'; readonly categoryId: string }
  | { readonly type: 'ADD_TAG'; readonly tagId: string }
  | { readonly type: 'REMOVE_TAG'; readonly tagId: string }
  | { readonly type: 'SET_COUNTERPARTY'; readonly counterpartyId: string }
  | { readonly type: 'SET_CUSTOM_FIELD'; readonly fieldId: string; readonly value: string | boolean }
  | { readonly type: 'MARK_FOR_REVIEW' }
  | { readonly type: 'SET_DESCRIPTION'; readonly text: string }
  | { readonly type: 'APPEND_NOTE'; readonly text: string }
  | { readonly type: 'EXCLUDE_FROM_IMPORT' };

/** Propiedades admitidas por tipo de acción. */
const PROPS: Readonly<Record<ActionType, readonly string[]>> = {
  SET_CATEGORY: ['categoryId'],
  ADD_TAG: ['tagId'],
  REMOVE_TAG: ['tagId'],
  SET_COUNTERPARTY: ['counterpartyId'],
  SET_CUSTOM_FIELD: ['fieldId', 'value'],
  MARK_FOR_REVIEW: [],
  SET_DESCRIPTION: ['text'],
  APPEND_NOTE: ['text'],
  EXCLUDE_FROM_IMPORT: [],
};

const MAX_TEXT = 500;
const invalid = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

function idOf(raw: unknown, pointer: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > 100) {
    throw invalid('must be an id', pointer);
  }
  return raw;
}

function textOf(raw: unknown, pointer: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) throw invalid('must be non-empty text', pointer);
  if (raw.length > MAX_TEXT) throw invalid(`must be at most ${MAX_TEXT} characters`, pointer);
  return raw;
}

/** Valida y normaliza una acción. */
export function parseAction(raw: unknown, pointer: string): Action {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw invalid('must be an object', pointer);
  const input = raw as Record<string, unknown>;
  const type = input['type'];
  if (typeof type !== 'string' || !(ACTION_TYPES as readonly string[]).includes(type)) {
    throw invalid(`type must be one of ${ACTION_TYPES.join(', ')}`, `${pointer}/type`);
  }
  const t = type as ActionType;
  for (const key of Object.keys(input)) {
    if (key !== 'type' && !PROPS[t].includes(key)) {
      throw invalid(`'${key}' cannot be set by a rule action ${t}`, `${pointer}/${key}`);
    }
  }
  switch (t) {
    case 'SET_CATEGORY':
      return { type: t, categoryId: idOf(input['categoryId'], `${pointer}/categoryId`) };
    case 'ADD_TAG':
    case 'REMOVE_TAG':
      return { type: t, tagId: idOf(input['tagId'], `${pointer}/tagId`) };
    case 'SET_COUNTERPARTY':
      return { type: t, counterpartyId: idOf(input['counterpartyId'], `${pointer}/counterpartyId`) };
    case 'SET_CUSTOM_FIELD': {
      const value = input['value'];
      if (typeof value !== 'boolean' && (typeof value !== 'string' || value.length > MAX_TEXT)) {
        throw invalid('value must be text or boolean', `${pointer}/value`);
      }
      return { type: t, fieldId: idOf(input['fieldId'], `${pointer}/fieldId`), value };
    }
    case 'SET_DESCRIPTION':
    case 'APPEND_NOTE':
      return { type: t, text: textOf(input['text'], `${pointer}/text`) };
    case 'MARK_FOR_REVIEW':
    case 'EXCLUDE_FROM_IMPORT':
      return { type: t };
  }
}

export function parseActions(raw: unknown, max: number, pointer = '/actions'): Action[] {
  if (!Array.isArray(raw) || raw.length === 0) throw invalid('at least one action is required', pointer);
  if (raw.length > max) throw invalid(`at most ${max} actions`, pointer);
  return raw.map((a, i) => parseAction(a, `${pointer}/${i}`));
}

/** Destinos de catálogo que referencia una acción (para validarlos al guardar y señalar "requiere atención"). */
export interface ActionTargets {
  readonly categoryIds: readonly string[];
  readonly tagIds: readonly string[];
  readonly counterpartyIds: readonly string[];
  readonly customFieldIds: readonly string[];
}

export function actionTargets(actions: readonly Action[]): ActionTargets {
  const pick = (f: (a: Action) => string | null) => [
    ...new Set(actions.map(f).filter((x): x is string => x !== null)),
  ];
  return {
    categoryIds: pick((a) => (a.type === 'SET_CATEGORY' ? a.categoryId : null)),
    tagIds: pick((a) => (a.type === 'ADD_TAG' || a.type === 'REMOVE_TAG' ? a.tagId : null)),
    counterpartyIds: pick((a) => (a.type === 'SET_COUNTERPARTY' ? a.counterpartyId : null)),
    customFieldIds: pick((a) => (a.type === 'SET_CUSTOM_FIELD' ? a.fieldId : null)),
  };
}
