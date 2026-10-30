import {
  CURRENCY_CODE,
  DomainError,
  dec,
  normalizeText,
  type Decimal,
  type LinearRegex,
} from '@pf/shared-kernel';
import { RegexGuard } from './regex-guard.js';
import { MATCH_MODES, SUBJECT_KINDS, type MatchMode, type RuleSubject } from './types.js';

/**
 * Condiciones del DSL (openspec add-rule-engine, decisión 8). Una condición es `{ field, operator, value?, valueTo?,
 * values?, currency?, fieldId? }`; un grupo es `{ match: ALL|ANY, items: Condition[] }` (un solo nivel).
 * `parseConditionItems` valida (matriz operador × campo, tipos y límites) y devuelve la forma normalizada;
 * `compileConditionTree` la compila UNA vez (texto normalizado, `Decimal`, regex lineal) para evaluar miles de sujetos.
 */

export const CONDITION_FIELDS = [
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
] as const;
export type ConditionField = (typeof CONDITION_FIELDS)[number];

export const OPERATORS = [
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'matches_regex',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'in',
  'is_empty',
  'is_not_empty',
] as const;
export type Operator = (typeof OPERATORS)[number];

const TEXT_OPS: readonly Operator[] = [
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
const ID_OPS: readonly Operator[] = ['equals', 'not_equals', 'in', 'is_empty', 'is_not_empty'];
const CODE_OPS: readonly Operator[] = ['equals', 'not_equals', 'in'];
const ORDERED_OPS: readonly Operator[] = ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between', 'in'];
const AMOUNT_OPS: readonly Operator[] = ['equals', 'not_equals', 'gt', 'gte', 'lt', 'lte', 'between'];
const SOURCE_OPS: readonly Operator[] = [
  'equals',
  'not_equals',
  'contains',
  'starts_with',
  'in',
  'is_empty',
  'is_not_empty',
];
const CUSTOM_OPS: readonly Operator[] = [
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
];

/** Operadores admitidos por campo (matriz operador × tipo de campo, FR-RULES-003). */
export const OPERATORS_BY_FIELD: Readonly<Record<ConditionField, readonly Operator[]>> = {
  DESCRIPTION: TEXT_OPS,
  COUNTERPARTY: ID_OPS,
  AMOUNT: AMOUNT_OPS,
  CURRENCY: CODE_OPS,
  ACCOUNT: ID_OPS,
  KIND: CODE_OPS,
  DATE: ORDERED_OPS,
  WEEKDAY: ORDERED_OPS,
  DAY_OF_MONTH: ORDERED_OPS,
  CATEGORY: ID_OPS,
  TAG: ID_OPS,
  EXTERNAL_SOURCE: SOURCE_OPS,
  CUSTOM_FIELD: CUSTOM_OPS,
};

export interface Condition {
  readonly field: ConditionField;
  readonly operator: Operator;
  /** Operando escalar (texto, id, decimal exacto como texto, fecha ISO, entero o booleano de un campo). */
  readonly value?: string | number | boolean;
  /** Segundo operando de `between`. */
  readonly valueTo?: string | number;
  /** Lista de `in`. */
  readonly values?: readonly (string | number)[];
  /** Obligatoria con `AMOUNT`. */
  readonly currency?: string;
  /** Obligatorio con `CUSTOM_FIELD`. */
  readonly fieldId?: string;
}

export interface ConditionGroup {
  readonly match: MatchMode;
  readonly items: readonly Condition[];
}

export type ConditionItem = Condition | ConditionGroup;

export const isGroup = (item: ConditionItem): item is ConditionGroup => 'items' in item;

/** Cuenta las condiciones de un árbol (las de los grupos cuentan, spec "1 a 20 condiciones"). */
export const countConditions = (items: readonly ConditionItem[]): number =>
  items.reduce((n, item) => n + (isGroup(item) ? item.items.length : 1), 0);

const invalid = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

const DECIMAL = /^-?\d+(\.\d+)?$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_TEXT_VALUE = 500;
const MAX_IN_VALUES = 100;
const KEYS = new Set(['field', 'operator', 'value', 'valueTo', 'values', 'currency', 'fieldId']);

function asRecord(raw: unknown, pointer: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw invalid('must be an object', pointer);
  return raw as Record<string, unknown>;
}

function textOperand(raw: unknown, pointer: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) throw invalid('must be non-empty text', pointer);
  if (raw.length > MAX_TEXT_VALUE) throw invalid(`must be at most ${MAX_TEXT_VALUE} characters`, pointer);
  return raw;
}

function intOperand(raw: unknown, min: number, max: number, pointer: string): number {
  const n = typeof raw === 'string' && /^\d+$/u.test(raw) ? Number(raw) : raw;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) {
    throw invalid(`must be an integer between ${min} and ${max}`, pointer);
  }
  return n;
}

function dateOperand(raw: unknown, pointer: string): string {
  if (typeof raw !== 'string' || !ISO_DATE.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
    throw invalid('must be a date YYYY-MM-DD', pointer);
  }
  return raw;
}

function decimalOperand(raw: unknown, pointer: string): string {
  if (typeof raw !== 'string' || !DECIMAL.test(raw)) {
    throw invalid('must be an exact decimal as text (never a floating point number)', pointer);
  }
  return raw;
}

/** Normaliza un operando según el campo; devuelve el valor tal como se guarda. */
function operand(field: ConditionField, raw: unknown, pointer: string): string | number | boolean {
  switch (field) {
    case 'AMOUNT':
      return decimalOperand(raw, pointer);
    case 'DATE':
      return dateOperand(raw, pointer);
    case 'WEEKDAY':
      return intOperand(raw, 1, 7, pointer);
    case 'DAY_OF_MONTH':
      return intOperand(raw, 1, 31, pointer);
    case 'CURRENCY': {
      const code = textOperand(raw, pointer);
      if (!CURRENCY_CODE.test(code)) throw invalid('must be a currency code', pointer);
      return code;
    }
    case 'KIND': {
      if (typeof raw !== 'string' || !(SUBJECT_KINDS as readonly string[]).includes(raw)) {
        throw invalid(`must be one of ${SUBJECT_KINDS.join(', ')}`, pointer);
      }
      return raw;
    }
    case 'CUSTOM_FIELD':
      if (typeof raw === 'boolean') return raw;
      return textOperand(raw, pointer);
    default:
      return textOperand(raw, pointer);
  }
}

function parseCondition(raw: unknown, pointer: string): Condition {
  const input = asRecord(raw, pointer);
  for (const key of Object.keys(input)) {
    if (!KEYS.has(key)) throw invalid(`'${key}' is not a condition property`, `${pointer}/${key}`);
  }
  const field = input['field'];
  if (typeof field !== 'string' || !(CONDITION_FIELDS as readonly string[]).includes(field)) {
    throw invalid(`field must be one of ${CONDITION_FIELDS.join(', ')}`, `${pointer}/field`);
  }
  const f = field as ConditionField;
  const op = input['operator'];
  if (typeof op !== 'string' || !(OPERATORS as readonly string[]).includes(op)) {
    throw invalid('unknown operator', `${pointer}/operator`);
  }
  const operator = op as Operator;
  if (!OPERATORS_BY_FIELD[f].includes(operator)) {
    throw invalid(`operator '${operator}' does not apply to ${f}`, `${pointer}/operator`);
  }
  const out: { -readonly [K in keyof Condition]: Condition[K] } = { field: f, operator };
  if (f === 'AMOUNT') {
    const currency = input['currency'];
    if (typeof currency !== 'string' || !CURRENCY_CODE.test(currency)) {
      throw invalid('an amount condition requires its currency', `${pointer}/currency`);
    }
    out.currency = currency;
  } else if (input['currency'] !== undefined) {
    throw invalid('currency only applies to AMOUNT', `${pointer}/currency`);
  }
  if (f === 'CUSTOM_FIELD') {
    out.fieldId = textOperand(input['fieldId'], `${pointer}/fieldId`);
  } else if (input['fieldId'] !== undefined) {
    throw invalid('fieldId only applies to CUSTOM_FIELD', `${pointer}/fieldId`);
  }
  if (operator === 'is_empty' || operator === 'is_not_empty') {
    for (const k of ['value', 'valueTo', 'values']) {
      if (input[k] !== undefined) throw invalid(`${operator} takes no operand`, `${pointer}/${k}`);
    }
    return out;
  }
  if (operator === 'in') {
    const list = input['values'];
    if (!Array.isArray(list) || list.length === 0 || list.length > MAX_IN_VALUES) {
      throw invalid(`values must have between 1 and ${MAX_IN_VALUES} items`, `${pointer}/values`);
    }
    out.values = list.map((v, i) => operand(f, v, `${pointer}/values/${i}`) as string | number);
    for (const k of ['value', 'valueTo']) {
      if (input[k] !== undefined) throw invalid('in takes values only', `${pointer}/${k}`);
    }
    return out;
  }
  if (input['values'] !== undefined) throw invalid('values only applies to in', `${pointer}/values`);
  out.value = operand(f, input['value'], `${pointer}/value`);
  if (operator === 'between') {
    out.valueTo = operand(f, input['valueTo'], `${pointer}/valueTo`) as string | number;
  } else if (input['valueTo'] !== undefined) {
    throw invalid('valueTo only applies to between', `${pointer}/valueTo`);
  }
  if (operator === 'matches_regex') {
    RegexGuard.compile(String(out.value), `${pointer}/value`);
  }
  if (
    (operator === 'contains' ||
      operator === 'not_contains' ||
      operator === 'starts_with' ||
      operator === 'ends_with') &&
    normalizeText(String(out.value)).length === 0
  ) {
    throw invalid('must have visible characters', `${pointer}/value`);
  }
  return out;
}

/**
 * Valida el árbol de condiciones: 1 a `max` condiciones (contando las de los grupos) y un solo nivel de grupos.
 * Un segundo nivel de anidamiento ⇒ `VALIDATION_FAILED`.
 */
export function parseConditionItems(raw: unknown, max: number, pointer = '/conditions'): ConditionItem[] {
  if (!Array.isArray(raw) || raw.length === 0) throw invalid('at least one condition is required', pointer);
  const items = raw.map((entry, i): ConditionItem => {
    const at = `${pointer}/${i}`;
    const record = asRecord(entry, at);
    if (!('items' in record) && !('match' in record)) return parseCondition(record, at);
    for (const key of Object.keys(record)) {
      if (key !== 'match' && key !== 'items')
        throw invalid(`'${key}' is not a group property`, `${at}/${key}`);
    }
    const match = record['match'];
    if (typeof match !== 'string' || !(MATCH_MODES as readonly string[]).includes(match)) {
      throw invalid('match must be ALL or ANY', `${at}/match`);
    }
    const inner = record['items'];
    if (!Array.isArray(inner) || inner.length === 0) throw invalid('a group needs conditions', `${at}/items`);
    return {
      match: match as MatchMode,
      items: inner.map((c, j) => {
        const p = `${at}/items/${j}`;
        const r = asRecord(c, p);
        if ('items' in r || 'match' in r) throw invalid('groups cannot be nested more than one level', p);
        return parseCondition(r, p);
      }),
    };
  });
  const total = countConditions(items);
  if (total > max) throw invalid(`at most ${max} conditions`, pointer);
  return items;
}

// ───────────────────────────────────────────────────────────────────────── evaluación

/** Sujeto con su descripción normalizada una sola vez. */
export class SubjectView {
  readonly description: string;
  private amountValue: Decimal | null | undefined;

  constructor(readonly subject: RuleSubject) {
    this.description = normalizeText(subject.description ?? '');
  }

  get amount(): Decimal | null {
    if (this.amountValue === undefined) {
      this.amountValue = DECIMAL.test(this.subject.amount.amount)
        ? dec(this.subject.amount.amount).abs()
        : null;
    }
    return this.amountValue;
  }

  /** Día de la semana ISO (1 = lunes … 7 = domingo) de la fecha de negocio, sin conversión de zona. */
  get weekday(): number {
    const day = new Date(`${this.subject.date}T00:00:00Z`).getUTCDay();
    return day === 0 ? 7 : day;
  }

  get dayOfMonth(): number {
    return Number(this.subject.date.slice(8, 10));
  }
}

export interface ConditionTrace {
  /** Puntero a la condición dentro de la definición (`/conditions/0`, `/conditions/1/items/0`). */
  readonly path: string;
  readonly met: boolean;
  /** Valor actual del sujeto en el campo evaluado (texto); `null` si no tiene. */
  readonly actual: string | null;
}

interface CompiledCondition {
  test(view: SubjectView): boolean;
  actual(view: SubjectView): string | null;
}

export interface CompiledNode {
  test(view: SubjectView): boolean;
  trace(view: SubjectView): ConditionTrace[];
}

const isDecimal = (v: unknown): v is string => typeof v === 'string' && DECIMAL.test(v);

/** Compara dos operandos de un campo personalizado: decimal exacto, fecha ISO, booleano o texto normalizado. */
function compareCustom(actual: string | boolean, expected: string | number | boolean): number | null {
  if (typeof actual === 'boolean' || typeof expected === 'boolean') {
    const a = String(actual);
    const e = String(expected);
    return a === e ? 0 : null;
  }
  const e = String(expected);
  if (isDecimal(actual) && isDecimal(e)) return dec(actual).comparedTo(dec(e));
  if (ISO_DATE.test(actual) && ISO_DATE.test(e)) return actual < e ? -1 : actual > e ? 1 : 0;
  const a = normalizeText(actual);
  const n = normalizeText(e);
  return a === n ? 0 : a < n ? -1 : 1;
}

function compileCondition(c: Condition, pointer: string): CompiledCondition {
  const op = c.operator;
  const regex: LinearRegex | null =
    op === 'matches_regex' ? RegexGuard.compile(String(c.value), `${pointer}/value`) : null;
  const normValue = c.value === undefined ? '' : normalizeText(String(c.value));
  const normValues = (c.values ?? []).map((v) => normalizeText(String(v)));

  // Texto (DESCRIPTION y EXTERNAL_SOURCE comparten operadores; el último ya viene en minúsculas).
  const textTest = (text: string): boolean => {
    switch (op) {
      case 'equals':
        return text === normValue;
      case 'not_equals':
        return text !== normValue;
      case 'contains':
        return text.includes(normValue);
      case 'not_contains':
        return !text.includes(normValue);
      case 'starts_with':
        return text.startsWith(normValue);
      case 'ends_with':
        return text.endsWith(normValue);
      case 'matches_regex':
        return (regex as LinearRegex).test(text);
      case 'in':
        return normValues.includes(text);
      case 'is_empty':
        return text.length === 0;
      case 'is_not_empty':
        return text.length > 0;
      default:
        return false;
    }
  };

  const idTest = (id: string | null): boolean => {
    switch (op) {
      case 'equals':
        return id === c.value;
      case 'not_equals':
        return id !== c.value;
      case 'in':
        return id !== null && (c.values as readonly (string | number)[]).includes(id);
      case 'is_empty':
        return id === null;
      case 'is_not_empty':
        return id !== null;
      default:
        return false;
    }
  };

  /** Operadores ordenados sobre un valor comparable (`cmp(x)` = signo de `actual − x`). */
  const orderedTest = (cmp: (expected: string | number) => number | null): boolean => {
    const against = (v: string | number | boolean | undefined) => cmp(v as string | number);
    switch (op) {
      case 'equals':
        return against(c.value) === 0;
      case 'not_equals':
        return against(c.value) !== 0;
      case 'gt':
        return (against(c.value) ?? -1) > 0;
      case 'gte':
        return (against(c.value) ?? -1) >= 0;
      case 'lt':
        return (against(c.value) ?? 1) < 0;
      case 'lte':
        return (against(c.value) ?? 1) <= 0;
      case 'between':
        return (against(c.value) ?? -1) >= 0 && (against(c.valueTo) ?? 1) <= 0;
      case 'in':
        return (c.values ?? []).some((v) => cmp(v) === 0);
      default:
        return false;
    }
  };

  switch (c.field) {
    case 'DESCRIPTION':
      return {
        test: (v) => textTest(v.description),
        actual: (v) => v.subject.description,
      };
    case 'EXTERNAL_SOURCE':
      return {
        test: (v) => textTest(normalizeText(v.subject.externalSource ?? '')),
        actual: (v) => v.subject.externalSource,
      };
    case 'COUNTERPARTY':
      return { test: (v) => idTest(v.subject.counterpartyId), actual: (v) => v.subject.counterpartyId };
    case 'ACCOUNT':
      return { test: (v) => idTest(v.subject.accountId), actual: (v) => v.subject.accountId };
    case 'CATEGORY':
      return { test: (v) => idTest(v.subject.categoryId), actual: (v) => v.subject.categoryId };
    case 'CURRENCY':
      return {
        test: (v) => {
          const code = v.subject.amount.currency;
          if (op === 'equals') return code === c.value;
          if (op === 'not_equals') return code !== c.value;
          return (c.values as readonly (string | number)[]).includes(code);
        },
        actual: (v) => v.subject.amount.currency,
      };
    case 'KIND':
      return {
        test: (v) => {
          if (op === 'equals') return v.subject.kind === c.value;
          if (op === 'not_equals') return v.subject.kind !== c.value;
          return (c.values as readonly (string | number)[]).includes(v.subject.kind);
        },
        actual: (v) => v.subject.kind,
      };
    case 'TAG':
      return {
        test: (v) => {
          const tags = v.subject.tagIds;
          switch (op) {
            case 'equals':
              return tags.includes(c.value as string);
            case 'not_equals':
              return !tags.includes(c.value as string);
            case 'in':
              return (c.values as readonly (string | number)[]).some((t) => tags.includes(String(t)));
            case 'is_empty':
              return tags.length === 0;
            case 'is_not_empty':
              return tags.length > 0;
            default:
              return false;
          }
        },
        actual: (v) => (v.subject.tagIds.length === 0 ? null : v.subject.tagIds.join(', ')),
      };
    case 'AMOUNT': {
      const expected = c.value === undefined ? null : dec(String(c.value));
      const upper = c.valueTo === undefined ? null : dec(String(c.valueTo));
      return {
        test: (v) => {
          if (v.subject.amount.currency !== c.currency) return false;
          const amount = v.amount;
          if (amount === null || expected === null) return false;
          switch (op) {
            case 'equals':
              return amount.eq(expected);
            case 'not_equals':
              return !amount.eq(expected);
            case 'gt':
              return amount.gt(expected);
            case 'gte':
              return amount.gte(expected);
            case 'lt':
              return amount.lt(expected);
            case 'lte':
              return amount.lte(expected);
            case 'between':
              return upper !== null && amount.gte(expected) && amount.lte(upper);
            default:
              return false;
          }
        },
        actual: (v) => `${v.subject.amount.amount} ${v.subject.amount.currency}`,
      };
    }
    case 'DATE':
      return {
        test: (v) =>
          orderedTest((e) => (v.subject.date < String(e) ? -1 : v.subject.date > String(e) ? 1 : 0)),
        actual: (v) => v.subject.date,
      };
    case 'WEEKDAY':
      return {
        test: (v) => orderedTest((e) => v.weekday - Number(e)),
        actual: (v) => String(v.weekday),
      };
    case 'DAY_OF_MONTH':
      return {
        test: (v) => orderedTest((e) => v.dayOfMonth - Number(e)),
        actual: (v) => String(v.dayOfMonth),
      };
    case 'CUSTOM_FIELD': {
      const valueOf = (v: SubjectView) =>
        v.subject.customFields.find((f) => f.fieldId === c.fieldId)?.value ?? null;
      return {
        test: (v) => {
          const actual = valueOf(v);
          if (op === 'is_empty') return actual === null;
          if (op === 'is_not_empty') return actual !== null;
          if (actual === null) return op === 'not_equals' || op === 'not_contains';
          if (op === 'contains' || op === 'not_contains' || op === 'starts_with' || op === 'ends_with') {
            const text = normalizeText(String(actual));
            const needle = normValue;
            const hit =
              op === 'starts_with'
                ? text.startsWith(needle)
                : op === 'ends_with'
                  ? text.endsWith(needle)
                  : text.includes(needle);
            return op === 'not_contains' ? !hit : hit;
          }
          return orderedTest((e) => compareCustom(actual, e));
        },
        actual: (v) => {
          const value = valueOf(v);
          return value === null ? null : String(value);
        },
      };
    }
  }
}

/**
 * Compila el árbol de la regla. `evaluate` devuelve si se cumple; `trace` informa cada condición con su resultado y su
 * valor actual (vista previa, sin efectos). En una regla `ANY` o en un grupo, todas las condiciones se evalúan en la
 * traza aunque el resultado ya esté decidido: el usuario ve por qué cada una cumplió o no.
 */
export function compileConditionTree(
  match: MatchMode,
  items: readonly ConditionItem[],
  pointer = '/conditions',
): CompiledNode {
  type Entry =
    | { readonly kind: 'leaf'; readonly path: string; readonly compiled: CompiledCondition }
    | {
        readonly kind: 'group';
        readonly match: MatchMode;
        readonly leaves: readonly { readonly path: string; readonly compiled: CompiledCondition }[];
      };
  const entries: Entry[] = items.map((item, i): Entry => {
    const path = `${pointer}/${i}`;
    if (isGroup(item)) {
      return {
        kind: 'group',
        match: item.match,
        leaves: item.items.map((c, j) => ({
          path: `${path}/items/${j}`,
          compiled: compileCondition(c, `${path}/items/${j}`),
        })),
      };
    }
    return { kind: 'leaf', path, compiled: compileCondition(item, path) };
  });
  const testEntry = (e: Entry, view: SubjectView): boolean => {
    if (e.kind === 'leaf') return e.compiled.test(view);
    if (e.match === 'ALL') {
      for (const l of e.leaves) if (!l.compiled.test(view)) return false;
      return true;
    }
    for (const l of e.leaves) if (l.compiled.test(view)) return true;
    return false;
  };
  return {
    test(view) {
      if (match === 'ALL') {
        for (const e of entries) if (!testEntry(e, view)) return false;
        return true;
      }
      for (const e of entries) if (testEntry(e, view)) return true;
      return false;
    },
    trace(view) {
      return entries.flatMap((e) =>
        e.kind === 'leaf'
          ? [{ path: e.path, met: e.compiled.test(view), actual: e.compiled.actual(view) }]
          : e.leaves.map((l) => ({
              path: l.path,
              met: l.compiled.test(view),
              actual: l.compiled.actual(view),
            })),
      );
    },
  };
}
