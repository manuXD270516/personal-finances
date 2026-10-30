import type {
  ActionType,
  ConditionField,
  ConditionOperator,
  Coverage,
  DryRunItem,
  Rule,
  RuleAction,
  RuleCondition,
  RuleConditionItem,
  RuleMatchMode,
  RuleTrigger,
  SplitRuleRef,
} from './types';

/** Lógica pura de la pantalla de reglas (sin React): matriz de operadores, borradores del editor y vistas derivadas. */

export const CONDITION_FIELDS: readonly ConditionField[] = [
  'DESCRIPTION',
  'COUNTERPARTY',
  'AMOUNT',
  'CURRENCY',
  'ACCOUNT',
  'KIND',
  'DATE',
  'WEEKDAY',
  'DAY_OF_MONTH',
  'CATEGORY',
  'TAG',
  'EXTERNAL_SOURCE',
  'CUSTOM_FIELD',
];

const TEXT: readonly ConditionOperator[] = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'matches_regex',
  'in',
  'is_empty',
  'is_not_empty',
];
const ID: readonly ConditionOperator[] = ['equals', 'not_equals', 'in', 'is_empty', 'is_not_empty'];
const ORDERED: readonly ConditionOperator[] = [
  'equals',
  'not_equals',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'in',
];

/** Misma matriz operador × campo que valida el dominio (`OPERATORS_BY_FIELD` de `@pf/rules`). */
export const FIELD_OPERATORS: Readonly<Record<ConditionField, readonly ConditionOperator[]>> = {
  DESCRIPTION: TEXT,
  COUNTERPARTY: ID,
  AMOUNT: ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between'],
  CURRENCY: ['equals', 'not_equals', 'in'],
  ACCOUNT: ID,
  KIND: ['equals', 'not_equals', 'in'],
  DATE: ORDERED,
  WEEKDAY: ORDERED,
  DAY_OF_MONTH: ORDERED,
  CATEGORY: ID,
  TAG: ID,
  EXTERNAL_SOURCE: ['equals', 'not_equals', 'contains', 'starts_with', 'in', 'is_empty', 'is_not_empty'],
  CUSTOM_FIELD: [
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'in',
    'gt',
    'gte',
    'lt',
    'lte',
    'between',
    'is_empty',
    'is_not_empty',
  ],
};

export const ACTION_TYPES: readonly ActionType[] = [
  'SET_CATEGORY',
  'ADD_TAG',
  'REMOVE_TAG',
  'SET_COUNTERPARTY',
  'SET_CUSTOM_FIELD',
  'MARK_FOR_REVIEW',
  'SET_DESCRIPTION',
  'APPEND_NOTE',
  'EXCLUDE_FROM_IMPORT',
];

export const TRIGGERS: readonly RuleTrigger[] = ['IMPORT', 'MANUAL_CREATE', 'RETROACTIVE'];
/** Disparadores de una regla nueva (D337: la creación manual es opt-in por regla). */
export const DEFAULT_TRIGGERS: readonly RuleTrigger[] = ['IMPORT', 'RETROACTIVE'];

export type OperandShape = 'none' | 'single' | 'range' | 'list';
export const operandShape = (operator: ConditionOperator): OperandShape =>
  operator === 'is_empty' || operator === 'is_not_empty'
    ? 'none'
    : operator === 'between'
      ? 'range'
      : operator === 'in'
        ? 'list'
        : 'single';

/** Cómo se captura el operando de un campo. */
export type OperandKind =
  | 'text'
  | 'decimal'
  | 'date'
  | 'weekday'
  | 'dayOfMonth'
  | 'kind'
  | 'currency'
  | 'account'
  | 'category'
  | 'tag'
  | 'counterparty'
  | 'custom';

export const OPERAND_KIND: Readonly<Record<ConditionField, OperandKind>> = {
  DESCRIPTION: 'text',
  COUNTERPARTY: 'counterparty',
  AMOUNT: 'decimal',
  CURRENCY: 'currency',
  ACCOUNT: 'account',
  KIND: 'kind',
  DATE: 'date',
  WEEKDAY: 'weekday',
  DAY_OF_MONTH: 'dayOfMonth',
  CATEGORY: 'category',
  TAG: 'tag',
  EXTERNAL_SOURCE: 'text',
  CUSTOM_FIELD: 'custom',
};

// ───────────────────────────────────────────────────────────────────── borradores del editor

export interface ConditionDraft {
  readonly field: ConditionField;
  readonly operator: ConditionOperator;
  readonly value: string;
  readonly valueTo: string;
  /** Lista de `in`, un operando por línea o separado por comas. */
  readonly values: string;
  readonly currency: string;
  readonly fieldId: string;
}

export type ConditionItemDraft =
  | ({ readonly kind: 'condition' } & ConditionDraft)
  | { readonly kind: 'group'; readonly match: RuleMatchMode; readonly items: readonly ConditionDraft[] };

export interface ActionDraft {
  readonly type: ActionType;
  readonly categoryId: string;
  readonly tagId: string;
  readonly counterpartyId: string;
  readonly fieldId: string;
  readonly value: string;
  readonly text: string;
}

export interface RuleDraft {
  readonly name: string;
  readonly description: string;
  readonly priority: string;
  readonly triggers: readonly RuleTrigger[];
  readonly matchMode: RuleMatchMode;
  readonly conditions: readonly ConditionItemDraft[];
  readonly actions: readonly ActionDraft[];
  readonly stopProcessing: boolean;
}

export const emptyCondition = (over: Partial<ConditionDraft> = {}): ConditionDraft => ({
  field: 'DESCRIPTION',
  operator: 'contains',
  value: '',
  valueTo: '',
  values: '',
  currency: 'BOB',
  fieldId: '',
  ...over,
});

export const emptyAction = (over: Partial<ActionDraft> = {}): ActionDraft => ({
  type: 'SET_CATEGORY',
  categoryId: '',
  tagId: '',
  counterpartyId: '',
  fieldId: '',
  value: '',
  text: '',
  ...over,
});

export const emptyDraft = (over: Partial<RuleDraft> = {}): RuleDraft => ({
  name: '',
  description: '',
  priority: '100',
  triggers: DEFAULT_TRIGGERS,
  matchMode: 'ALL',
  conditions: [{ kind: 'condition', ...emptyCondition() }],
  actions: [emptyAction()],
  stopProcessing: false,
  ...over,
});

const str = (v: string | number | boolean | undefined): string => (v === undefined ? '' : String(v));

const conditionToDraft = (c: RuleCondition): ConditionDraft =>
  emptyCondition({
    field: c.field,
    operator: c.operator,
    value: str(c.value),
    valueTo: str(c.valueTo),
    values: (c.values ?? []).join('\n'),
    currency: c.currency ?? 'BOB',
    fieldId: c.fieldId ?? '',
  });

/** Borrador editable de una regla guardada. */
export function ruleToDraft(rule: Rule): RuleDraft {
  return {
    name: rule.name,
    description: rule.description ?? '',
    priority: String(rule.priority),
    triggers: rule.triggers,
    matchMode: rule.matchMode,
    conditions: rule.conditions.map((item): ConditionItemDraft =>
      'items' in item
        ? { kind: 'group', match: item.match, items: item.items.map(conditionToDraft) }
        : { kind: 'condition', ...conditionToDraft(item) },
    ),
    actions: rule.actions.map((a) =>
      emptyAction({
        type: a.type,
        categoryId: a.categoryId ?? '',
        tagId: a.tagId ?? '',
        counterpartyId: a.counterpartyId ?? '',
        fieldId: a.fieldId ?? '',
        value: a.value === undefined ? '' : String(a.value),
        text: a.text ?? '',
      }),
    ),
    stopProcessing: rule.stopProcessing,
  };
}

const listOf = (text: string): string[] =>
  text
    .split(/[\n,]/u)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

const intOperand = (text: string): number | string =>
  /^\d+$/u.test(text.trim()) ? Number(text.trim()) : text;

/** Operando en su tipo del DSL: enteros para el día de la semana y del mes; el resto, texto. */
function operandOf(field: ConditionField, text: string): string | number {
  return field === 'WEEKDAY' || field === 'DAY_OF_MONTH' ? intOperand(text) : text.trim();
}

export function conditionBody(d: ConditionDraft): RuleCondition {
  const shape = operandShape(d.operator);
  return {
    field: d.field,
    operator: d.operator,
    ...(shape === 'single' || shape === 'range'
      ? {
          value:
            d.field === 'CUSTOM_FIELD' && (d.value === 'true' || d.value === 'false')
              ? d.value === 'true'
              : operandOf(d.field, d.value),
        }
      : {}),
    ...(shape === 'range' ? { valueTo: operandOf(d.field, d.valueTo) } : {}),
    ...(shape === 'list' ? { values: listOf(d.values).map((v) => operandOf(d.field, v)) } : {}),
    ...(d.field === 'AMOUNT' ? { currency: d.currency } : {}),
    ...(d.field === 'CUSTOM_FIELD' ? { fieldId: d.fieldId } : {}),
  };
}

export function actionBody(a: ActionDraft): RuleAction {
  switch (a.type) {
    case 'SET_CATEGORY':
      return { type: a.type, categoryId: a.categoryId };
    case 'ADD_TAG':
    case 'REMOVE_TAG':
      return { type: a.type, tagId: a.tagId };
    case 'SET_COUNTERPARTY':
      return { type: a.type, counterpartyId: a.counterpartyId };
    case 'SET_CUSTOM_FIELD':
      return {
        type: a.type,
        fieldId: a.fieldId,
        value: a.value === 'true' ? true : a.value === 'false' ? false : a.value,
      };
    case 'SET_DESCRIPTION':
    case 'APPEND_NOTE':
      return { type: a.type, text: a.text };
    default:
      return { type: a.type };
  }
}

/** Cuerpo de `createRule` / `updateRule` desde el borrador. */
export function draftBody(d: RuleDraft) {
  return {
    name: d.name.trim(),
    description: d.description.trim() === '' ? null : d.description.trim(),
    priority: Number(d.priority),
    triggers: d.triggers,
    matchMode: d.matchMode,
    conditions: d.conditions.map((c): RuleConditionItem =>
      c.kind === 'group' ? { match: c.match, items: c.items.map(conditionBody) } : conditionBody(c),
    ),
    actions: d.actions.map(actionBody),
    stopProcessing: d.stopProcessing,
  };
}

/** Definición (sin nombre ni prioridad) para la vista previa de una regla sin guardar. */
export function draftDefinition(d: RuleDraft) {
  const { name: _name, description: _description, priority: _priority, ...definition } = draftBody(d);
  return definition;
}

export type DraftErrorKey =
  | 'nameRequired'
  | 'priorityInvalid'
  | 'conditionsRequired'
  | 'actionsRequired'
  | 'operandRequired'
  | 'triggersRequired'
  | 'targetRequired'
  | 'tooManyConditions'
  | 'tooManyActions';

export interface DraftError {
  readonly key: DraftErrorKey;
  /** Puntero del campo (`name`, `conditions.0`, `actions.1`…) para enfocar y asociar el error. */
  readonly path: string;
}

const MAX_CONDITIONS = 20;
const MAX_ACTIONS = 10;

const conditionLeafCount = (items: readonly ConditionItemDraft[]): number =>
  items.reduce((n, i) => n + (i.kind === 'group' ? i.items.length : 1), 0);

function conditionError(c: ConditionDraft, path: string): DraftError | undefined {
  const shape = operandShape(c.operator);
  if (c.field === 'CUSTOM_FIELD' && c.fieldId.trim() === '') return { key: 'operandRequired', path };
  if ((shape === 'single' || shape === 'range') && c.value.trim() === '')
    return { key: 'operandRequired', path };
  if (shape === 'range' && c.valueTo.trim() === '') return { key: 'operandRequired', path };
  if (shape === 'list' && listOf(c.values).length === 0) return { key: 'operandRequired', path };
  return undefined;
}

/** Errores de captura que se pueden detectar sin llamar a la API (la API sigue siendo la autoridad). */
export function validateDraft(d: RuleDraft): DraftError[] {
  const out: DraftError[] = [];
  if (d.name.trim() === '' || d.name.trim().length > 80) out.push({ key: 'nameRequired', path: 'name' });
  if (!/^\d+$/u.test(d.priority.trim()) || Number(d.priority) > 1_000_000) {
    out.push({ key: 'priorityInvalid', path: 'priority' });
  }
  if (d.triggers.length === 0) out.push({ key: 'triggersRequired', path: 'triggers' });
  if (d.conditions.length === 0) out.push({ key: 'conditionsRequired', path: 'conditions' });
  if (conditionLeafCount(d.conditions) > MAX_CONDITIONS)
    out.push({ key: 'tooManyConditions', path: 'conditions' });
  d.conditions.forEach((item, i) => {
    if (item.kind === 'condition') {
      const e = conditionError(item, `conditions.${i}`);
      if (e) out.push(e);
    } else {
      if (item.items.length === 0) out.push({ key: 'conditionsRequired', path: `conditions.${i}` });
      item.items.forEach((c, j) => {
        const e = conditionError(c, `conditions.${i}.items.${j}`);
        if (e) out.push(e);
      });
    }
  });
  if (d.actions.length === 0) out.push({ key: 'actionsRequired', path: 'actions' });
  if (d.actions.length > MAX_ACTIONS) out.push({ key: 'tooManyActions', path: 'actions' });
  d.actions.forEach((a, i) => {
    const missing =
      (a.type === 'SET_CATEGORY' && a.categoryId === '') ||
      ((a.type === 'ADD_TAG' || a.type === 'REMOVE_TAG') && a.tagId === '') ||
      (a.type === 'SET_COUNTERPARTY' && a.counterpartyId === '') ||
      (a.type === 'SET_CUSTOM_FIELD' && (a.fieldId.trim() === '' || a.value === '')) ||
      ((a.type === 'SET_DESCRIPTION' || a.type === 'APPEND_NOTE') && a.text.trim() === '');
    if (missing) out.push({ key: 'targetRequired', path: `actions.${i}` });
  });
  return out;
}

/** Mensaje de error de un puntero (`conditions.0.items.1`), si hay. */
export const errorAt = (errors: readonly DraftError[], path: string): DraftErrorKey | undefined =>
  errors.find((e) => e.path === path)?.key;

// ───────────────────────────────────────────────────────────────────── descripción legible

export interface NameResolver {
  category(id: string): string | undefined;
  tag(id: string): string | undefined;
  counterparty(id: string): string | undefined;
  account(id: string): string | undefined;
}

/** Texto corto de una acción para el listado (el nombre del destino, o el id si el catálogo aún no cargó). */
export function actionTarget(a: RuleAction, names: NameResolver): string {
  switch (a.type) {
    case 'SET_CATEGORY':
      return names.category(a.categoryId ?? '') ?? a.categoryId ?? '';
    case 'ADD_TAG':
    case 'REMOVE_TAG':
      return names.tag(a.tagId ?? '') ?? a.tagId ?? '';
    case 'SET_COUNTERPARTY':
      return names.counterparty(a.counterpartyId ?? '') ?? a.counterpartyId ?? '';
    case 'SET_CUSTOM_FIELD':
      return `${a.fieldId ?? ''} = ${String(a.value ?? '')}`;
    case 'SET_DESCRIPTION':
    case 'APPEND_NOTE':
      return a.text ?? '';
    default:
      return '';
  }
}

/** Mueve `id` `delta` posiciones dentro de `ids` (arriba = −1); sin cambio si sale del rango. */
export function moveId(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  const next = [...ids];
  [next[i], next[j]] = [next[j] as string, next[i] as string];
  return next;
}

/** Páginas de a lo más `size` elementos (la aplicación del dry-run es de a 500). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const APPLY_PAGE_SIZE = 500;

/** Transacciones del dry-run que se pueden aplicar (las no aplicables se muestran pero no se seleccionan). */
export const applicableItems = (items: readonly DryRunItem[]): DryRunItem[] =>
  items.filter((i) => i.applicable);

/** Cuántas transacciones tienen cada campo que cambiaría (resumen del diff). */
export function changeSummary(items: readonly DryRunItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) for (const c of i.changes) out[c.field] = (out[c.field] ?? 0) + 1;
  return out;
}

/** Campo de un cambio del dry-run sin el identificador (`customField:<id>` → `customField`). */
export const changeFieldKey = (field: string): string => field.split(':')[0] ?? field;

// ───────────────────────────────────────────────────────────────────── origen en el detalle

/** Regla que fijó un campo del split: «por la regla Supermercado (v1)» / «(v1, archivada)». */
export interface OriginView {
  readonly name: string;
  readonly version: number;
  readonly archived: boolean;
}

export const originOfRef = (ref: SplitRuleRef | undefined): OriginView | undefined =>
  ref
    ? { name: ref.ruleName ?? ref.ruleId, version: ref.ruleVersion, archived: ref.ruleArchived === true }
    : undefined;

export const ruleRefFor = (refs: readonly SplitRuleRef[], field: string): SplitRuleRef | undefined =>
  refs.find((r) => r.field === field);

// ───────────────────────────────────────────────────────────────────── cobertura

export type CoverageRow = { readonly origin: keyof Coverage['byOrigin']; readonly count: number };

export function coverageRows(c: Coverage): CoverageRow[] {
  return (['rule', 'counterpartyDefault', 'manual', 'systemDefault', 'unknown'] as const).map((origin) => ({
    origin,
    count: c.byOrigin[origin],
  }));
}

/** `0.7400` → `74,00 %` en el locale de formato (el cociente ya viene redondeado a 4 decimales). */
export function percentText(ratio: string, locale: string): string {
  const [whole = '0', frac = '0000'] = ratio.split('.');
  const basisPoints = Number(whole) * 10_000 + Number(frac.padEnd(4, '0').slice(0, 4));
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(basisPoints / 100)} %`;
}

// ───────────────────────────────────────────────────────────────────── crear regla desde una fila

/** Descripción normalizada para una regla: sin acentos, en minúsculas y sin números de referencia ni dígitos de tarjeta. */
export function ruleTextFromDescription(description: string): string {
  return description
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/\s+/u)
    .filter((token) => token.length > 0 && !/\d/u.test(token))
    .join(' ')
    .trim();
}

export interface RuleSeed {
  readonly description?: string;
  readonly kind?: 'INCOME' | 'EXPENSE' | 'REFUND';
  readonly accountId?: string;
  readonly categoryId?: string;
  readonly counterpartyId?: string;
}

/** Borrador prellenado desde una transacción o fila: no se guarda nada hasta que el EDITOR lo confirme. */
export function draftFromSeed(seed: RuleSeed): RuleDraft {
  const text = ruleTextFromDescription(seed.description ?? '');
  const conditions: ConditionItemDraft[] = [];
  if (text !== '') {
    conditions.push({
      kind: 'condition',
      ...emptyCondition({ field: 'DESCRIPTION', operator: 'contains', value: text }),
    });
  }
  if (seed.kind) {
    conditions.push({
      kind: 'condition',
      ...emptyCondition({ field: 'KIND', operator: 'equals', value: seed.kind }),
    });
  }
  if (seed.accountId) {
    conditions.push({
      kind: 'condition',
      ...emptyCondition({ field: 'ACCOUNT', operator: 'equals', value: seed.accountId }),
    });
  }
  const actions: ActionDraft[] = [];
  if (seed.categoryId) actions.push(emptyAction({ type: 'SET_CATEGORY', categoryId: seed.categoryId }));
  if (seed.counterpartyId)
    actions.push(emptyAction({ type: 'SET_COUNTERPARTY', counterpartyId: seed.counterpartyId }));
  return emptyDraft({
    name: text === '' ? '' : text.replace(/^./u, (c) => c.toUpperCase()),
    conditions: conditions.length > 0 ? conditions : [{ kind: 'condition', ...emptyCondition() }],
    actions: actions.length > 0 ? actions : [emptyAction()],
  });
}

/** Parámetros de la URL de «crear regla desde esta fila». */
export function seedQuery(seed: RuleSeed): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(seed)) if (v) q.set(k, v);
  return q.toString();
}

export function seedFromQuery(q: URLSearchParams): RuleSeed {
  const kind = q.get('kind');
  return {
    ...(q.get('description') ? { description: q.get('description') as string } : {}),
    ...(kind === 'INCOME' || kind === 'EXPENSE' || kind === 'REFUND' ? { kind } : {}),
    ...(q.get('accountId') ? { accountId: q.get('accountId') as string } : {}),
    ...(q.get('categoryId') ? { categoryId: q.get('categoryId') as string } : {}),
    ...(q.get('counterpartyId') ? { counterpartyId: q.get('counterpartyId') as string } : {}),
  };
}

export const rulesPath = (base: string, suffix = ''): string => `${base}/rules${suffix}`;
