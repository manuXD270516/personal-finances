import { normalizeDecimalInput, separatorsOf } from '../common/money';
import type { CustomFieldValues } from '../common/types';

/**
 * Lógica pura de los custom fields en la UI (openspec add-custom-fields, FR-CLASSIFICATION-009): tipos del contrato,
 * conversión entre lo que escribe el usuario y el valor exacto que viaja (decimales como string, jamás `number`,
 * INV-001), y los parámetros de filtro del registro. La API valida igual: aquí solo se anticipan los errores.
 */

export const CUSTOM_FIELD_DATA_TYPES = ['TEXT', 'NUMBER', 'DECIMAL', 'DATE', 'BOOLEAN', 'SELECT'] as const;
export type CustomFieldDataType = (typeof CUSTOM_FIELD_DATA_TYPES)[number];
export const CUSTOM_FIELD_TARGETS = ['TRANSACTION', 'ACCOUNT'] as const;
export type CustomFieldTarget = (typeof CUSTOM_FIELD_TARGETS)[number];

export interface CustomFieldOption {
  readonly key: string;
  readonly label: string;
  readonly position: number;
}

export interface CustomFieldDefinition {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly dataType: CustomFieldDataType;
  readonly target: CustomFieldTarget;
  readonly required: boolean;
  readonly options: readonly CustomFieldOption[];
  readonly position: number;
  readonly archivedAt?: string | null;
  readonly version: number;
}

/**
 * Texto EDITADO por el usuario por clave de campo (los booleanos son `''`, `'true'` o `'false'`). Un campo ausente
 * está intacto: se muestra el valor guardado y no se envía.
 */
export type CustomFieldDraft = Readonly<Record<string, string>>;

export type CustomFieldError =
  'INVALID_INTEGER' | 'INVALID_DECIMAL' | 'INVALID_DATE' | 'TOO_LONG' | 'REQUIRED';

export const MAX_TEXT = 500;

const byPosition = (a: CustomFieldDefinition, b: CustomFieldDefinition) =>
  a.position - b.position || a.key.localeCompare(b.key);

/** Definiciones activas de una entidad en el orden persistente (las archivadas no ofrecen el campo). */
export const activeFields = (
  defs: readonly CustomFieldDefinition[],
  target: CustomFieldTarget,
): CustomFieldDefinition[] => defs.filter((d) => d.target === target && !d.archivedAt).sort(byPosition);

/**
 * Valor guardado → texto del control. Los decimales se muestran con el separador del locale (`35,125` en es-BO): así lo
 * que se ve se interpreta igual al volver a escribirlo (`35.125` sería ambiguo con el separador de miles).
 */
export function toInputText(
  def: CustomFieldDefinition,
  value: string | boolean | null | undefined,
  locale: string,
): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return String(value);
  return def.dataType === 'DECIMAL' ? value.replace('.', separatorsOf(locale).decimal) : value;
}

const INTEGER = /^-?(0|[1-9]\d{0,14})$/;
const DECIMAL = /^-?(0|[1-9]\d{0,19})(\.\d{1,18})?$/;

/** Decimal tolerante al locale (`35,125` en es-BO) → texto canónico con punto; `null` si no es un decimal válido. */
export function normalizeDecimal(raw: string, locale: string): string | null {
  const trimmed = raw.trim();
  const negative = trimmed.startsWith('-');
  const body = normalizeDecimalInput(negative ? trimmed.slice(1) : trimmed, locale);
  if (body === null) return null;
  return negative ? `-${body}` : body;
}

const isCalendarDate = (v: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** Texto del usuario → valor a enviar (`null` = vacío) o el error de validación. */
export function parseFieldValue(
  def: CustomFieldDefinition,
  raw: string,
  locale: string,
): { ok: true; value: string | boolean | null } | { ok: false; error: CustomFieldError } {
  const text = raw.trim();
  if (text === '') return { ok: true, value: null };
  switch (def.dataType) {
    case 'TEXT':
      return raw.length > MAX_TEXT ? { ok: false, error: 'TOO_LONG' } : { ok: true, value: raw };
    case 'NUMBER': {
      const v = text.replace(/^\+/, '');
      return INTEGER.test(v)
        ? { ok: true, value: v === '-0' ? '0' : v }
        : { ok: false, error: 'INVALID_INTEGER' };
    }
    case 'DECIMAL': {
      const v = normalizeDecimal(text, locale);
      return v !== null && DECIMAL.test(v) ? { ok: true, value: v } : { ok: false, error: 'INVALID_DECIMAL' };
    }
    case 'DATE':
      return isCalendarDate(text) ? { ok: true, value: text } : { ok: false, error: 'INVALID_DATE' };
    case 'BOOLEAN':
      return { ok: true, value: text === 'true' };
    case 'SELECT':
      return { ok: true, value: text };
  }
}

/** Canónica de un decimal (sin ceros finales) para comparar lo escrito con lo guardado. */
const canonical = (v: string): string => {
  if (!v.includes('.')) return v === '-0' ? '0' : v;
  const trimmed = v.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed === '-0' ? '0' : trimmed;
};

export interface FieldsPayload {
  /** Cambios por clave para el cuerpo (`valor` fija, `null` quita); `undefined` si no hay nada que enviar. */
  readonly values: Record<string, string | boolean | null> | undefined;
  readonly errors: Readonly<Record<string, CustomFieldError>>;
}

/**
 * Cuerpo de `customFields` a partir de lo editado. Solo se envían los campos tocados cuyo valor cambió; vaciar un
 * campo que tenía valor lo quita (`null`). Al crear (`requireMandatory`) los obligatorios sin valor se señalan; al
 * editar nunca (la obligatoriedad no es retroactiva y la API la exige solo si se editan los custom fields). Los
 * campos archivados no se tocan: su valor histórico se conserva.
 */
export function buildFieldsPayload(
  defs: readonly CustomFieldDefinition[],
  draft: CustomFieldDraft,
  locale: string,
  opts: { original?: CustomFieldValues | undefined; requireMandatory: boolean },
): FieldsPayload {
  const values: Record<string, string | boolean | null> = {};
  const errors: Record<string, CustomFieldError> = {};
  for (const d of defs) {
    const touched = Object.hasOwn(draft, d.key);
    const previous = opts.original?.[d.key] ?? null;
    // Intacto: conserva lo guardado; un obligatorio sin valor solo se exige en registros nuevos.
    if (!touched) {
      if (d.required && opts.requireMandatory && previous === null) errors[d.key] = 'REQUIRED';
      continue;
    }
    const parsed = parseFieldValue(d, draft[d.key] ?? '', locale);
    if (!parsed.ok) {
      errors[d.key] = parsed.error;
      continue;
    }
    if (parsed.value === null) {
      if (d.required && opts.requireMandatory) errors[d.key] = 'REQUIRED';
      else if (previous !== null) values[d.key] = null;
      continue;
    }
    const same =
      previous !== null &&
      (typeof previous === 'boolean' || typeof parsed.value === 'boolean'
        ? previous === parsed.value
        : d.dataType === 'DECIMAL' || d.dataType === 'NUMBER'
          ? canonical(previous) === canonical(parsed.value)
          : previous === parsed.value);
    if (!same) values[d.key] = parsed.value;
  }
  return { values: Object.keys(values).length > 0 ? values : undefined, errors };
}

/** Texto de un valor guardado para el detalle y el registro (etiqueta de la opción, Sí/No, valor exacto). */
export function displayValue(
  def: CustomFieldDefinition | undefined,
  value: string | boolean,
  labels: { readonly yes: string; readonly no: string; readonly date: (isoDate: string) => string },
): string {
  if (typeof value === 'boolean') return value ? labels.yes : labels.no;
  if (def?.dataType === 'SELECT') return def.options.find((o) => o.key === value)?.label ?? value;
  if (def?.dataType === 'DATE') return labels.date(value);
  return value;
}

/** Valores de un registro como pares (definición, valor) en el orden de las definiciones; incluye archivadas. */
export function valuesOf(
  defs: readonly CustomFieldDefinition[],
  values: CustomFieldValues | undefined,
): { def: CustomFieldDefinition | undefined; key: string; value: string | boolean }[] {
  if (!values) return [];
  const byKey = new Map<string, CustomFieldDefinition>();
  // Si una clave archivada se reutilizó, gana la definición activa.
  for (const d of [...defs].sort((a, b) => Number(Boolean(b.archivedAt)) - Number(Boolean(a.archivedAt))))
    byKey.set(d.key, d);
  return Object.entries(values)
    .filter((e): e is [string, string | boolean] => e[1] !== null && e[1] !== undefined)
    .map(([key, value]) => ({ def: byKey.get(key), key, value }))
    .sort((a, b) => (a.def?.position ?? 1e9) - (b.def?.position ?? 1e9) || a.key.localeCompare(b.key));
}

export interface CustomFieldFilter {
  readonly key: string;
  readonly eq: string;
  readonly from: string;
  readonly to: string;
}

export const EMPTY_CUSTOM_FIELD_FILTER: CustomFieldFilter = { key: '', eq: '', from: '', to: '' };

/** ¿El tipo admite rangos en el filtro del registro? (NUMBER, DECIMAL y DATE). */
export const supportsRange = (t: CustomFieldDataType): boolean =>
  t === 'NUMBER' || t === 'DECIMAL' || t === 'DATE';

/**
 * Parámetros `customField[<clave>]`, `[gte]` y `[lte]` del filtro del registro. Los decimales se normalizan al
 * punto decimal (el locale solo afecta lo escrito); un valor inválido se omite (no se manda a la API).
 */
export function customFieldParams(
  def: CustomFieldDefinition | undefined,
  filter: CustomFieldFilter,
  locale: string,
): [string, string][] {
  if (!def || !filter.key) return [];
  const clean = (raw: string): string | null => {
    const parsed = parseFieldValue(def, raw, locale);
    if (!parsed.ok || parsed.value === null) return null;
    return typeof parsed.value === 'boolean' ? String(parsed.value) : parsed.value;
  };
  const out: [string, string][] = [];
  if (supportsRange(def.dataType)) {
    const from = clean(filter.from);
    const to = clean(filter.to);
    if (from !== null) out.push([`customField[${def.key}][gte]`, from]);
    if (to !== null) out.push([`customField[${def.key}][lte]`, to]);
  } else {
    const eq = clean(filter.eq);
    if (eq !== null) out.push([`customField[${def.key}]`, eq]);
  }
  return out;
}
