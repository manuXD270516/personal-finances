import { DomainError, canonicalDecimal } from '@pf/shared-kernel';

export { canonicalDecimal };

/**
 * Validación pura de valores de custom fields por tipo (openspec add-custom-fields, FR-CLASSIFICATION-009, design
 * decisión 1). Los números y decimales viajan SIEMPRE como string decimal exacto (INV-001): jamás `number` de JS.
 */
export const CUSTOM_FIELD_DATA_TYPES = ['TEXT', 'NUMBER', 'DECIMAL', 'DATE', 'BOOLEAN', 'SELECT'] as const;
export type CustomFieldDataType = (typeof CUSTOM_FIELD_DATA_TYPES)[number];

/** Clase de almacenamiento de un valor (columna `value_*` de las tablas de valores). */
export const CUSTOM_FIELD_VALUE_TYPES = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN'] as const;
export type CustomFieldValueType = (typeof CUSTOM_FIELD_VALUE_TYPES)[number];

export const CUSTOM_FIELD_TARGETS = ['TRANSACTION', 'ACCOUNT'] as const;
export type CustomFieldTarget = (typeof CUSTOM_FIELD_TARGETS)[number];

export const isCustomFieldDataType = (v: unknown): v is CustomFieldDataType =>
  typeof v === 'string' && (CUSTOM_FIELD_DATA_TYPES as readonly string[]).includes(v);
export const isCustomFieldTarget = (v: unknown): v is CustomFieldTarget =>
  typeof v === 'string' && (CUSTOM_FIELD_TARGETS as readonly string[]).includes(v);

/** `SELECT` se guarda como texto (clave de opción); `NUMBER` y `DECIMAL` comparten la columna numérica. */
export function valueTypeOf(dataType: CustomFieldDataType): CustomFieldValueType {
  switch (dataType) {
    case 'NUMBER':
    case 'DECIMAL':
      return 'NUMBER';
    case 'DATE':
      return 'DATE';
    case 'BOOLEAN':
      return 'BOOLEAN';
    default:
      return 'TEXT';
  }
}

/** Valor ya validado y normalizado (decimal canónico, fecha ISO, texto, booleano o clave de opción). */
export interface NormalizedCustomFieldValue {
  readonly valueType: CustomFieldValueType;
  readonly value: string | boolean;
}

export const MAX_TEXT_LENGTH = 500;
const INTEGER = /^-?(0|[1-9][0-9]{0,14})$/u;
const DECIMAL = /^-?(0|[1-9][0-9]{0,19})(\.[0-9]{1,18})?$/u;
const ISO_DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u;

const invalid = (message: string, pointer: string): DomainError =>
  new DomainError('CUSTOM_FIELD_VALUE_INVALID', message).at(pointer);

/** ¿Es una fecha de calendario real `AAAA-MM-DD`? (`2026-02-30` no lo es). */
export function isCalendarDate(text: string): boolean {
  const m = ISO_DATE.exec(text);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const d = new Date(Date.UTC(2000, month - 1, day));
  d.setUTCFullYear(year);
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Valida `raw` contra el tipo de la definición y devuelve el valor normalizado; si es inválido lanza
 * `CUSTOM_FIELD_VALUE_INVALID` (422) apuntando a `pointer`.
 */
export function normalizeCustomFieldValue(
  def: { readonly dataType: CustomFieldDataType; readonly optionKeys: readonly string[] },
  raw: unknown,
  pointer: string,
): NormalizedCustomFieldValue {
  const valueType = valueTypeOf(def.dataType);
  switch (def.dataType) {
    case 'TEXT': {
      if (typeof raw !== 'string' || raw.trim().length < 1 || raw.length > MAX_TEXT_LENGTH) {
        throw invalid(`a TEXT value must have 1..${MAX_TEXT_LENGTH} characters`, pointer);
      }
      return { valueType, value: raw };
    }
    case 'NUMBER': {
      if (typeof raw !== 'string' || !INTEGER.test(raw)) {
        throw invalid('a NUMBER value must be an integer string of up to 15 digits', pointer);
      }
      return { valueType, value: canonicalDecimal(raw) };
    }
    case 'DECIMAL': {
      if (typeof raw !== 'string' || !DECIMAL.test(raw)) {
        throw invalid('a DECIMAL value must be an exact decimal string with up to 18 decimals', pointer);
      }
      return { valueType, value: canonicalDecimal(raw) };
    }
    case 'DATE': {
      if (typeof raw !== 'string' || !isCalendarDate(raw)) {
        throw invalid('a DATE value must be a valid calendar date AAAA-MM-DD', pointer);
      }
      return { valueType, value: raw };
    }
    case 'BOOLEAN': {
      if (typeof raw !== 'boolean') throw invalid('a BOOLEAN value must be true or false', pointer);
      return { valueType, value: raw };
    }
    case 'SELECT': {
      if (typeof raw !== 'string' || !def.optionKeys.includes(raw)) {
        throw invalid('a SELECT value must be the key of a current option', pointer);
      }
      return { valueType, value: raw };
    }
  }
}
