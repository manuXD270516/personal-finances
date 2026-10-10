import { DomainError, jsonPointer } from '@pf/shared-kernel';
import type { CsvRecord } from './csv-sniffer.js';

/**
 * `CsvMapping` (forma `imports.mapping.v1`, subconjunto del `MappingProfile.columns`/`numberFormat` de docs/13 §5.1,
 * decisión 4 de add-basic-csv-import): qué columna es la fecha, la descripción y el monto, el formato de fecha y el
 * separador decimal, SIEMPRE explícitos (sin adivinar por fila).
 */

export const DATE_FORMATS = ['dd/MM/yyyy', 'dd-MM-yyyy', 'dd/MM/yy', 'yyyy-MM-dd', 'MM/dd/yyyy'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const DECIMAL_SEPARATORS = [',', '.'] as const;
export type DecimalSeparator = (typeof DECIMAL_SEPARATORS)[number];

export const SIGN_CONVENTIONS = ['NEGATIVE_IS_OUTFLOW', 'POSITIVE_IS_OUTFLOW'] as const;
export type SignConvention = (typeof SIGN_CONVENTIONS)[number];

export const MAPPING_VERSION = 'imports.mapping.v1' as const;
export const MAX_SKIP_ROWS = 50;

export type AmountMapping =
  | { readonly mode: 'SIGNED'; readonly index: number; readonly signConvention: SignConvention }
  | { readonly mode: 'DEBIT_CREDIT'; readonly debitIndex: number; readonly creditIndex: number };

export interface CsvMapping {
  readonly hasHeader: boolean;
  /** Registros iniciales que se saltan ANTES del encabezado (preámbulo del banco). */
  readonly skipRows: number;
  readonly columns: {
    readonly date: { readonly index: number };
    readonly description: { readonly index: number };
    readonly amount: AmountMapping;
  };
  readonly dateFormat: DateFormat;
  readonly decimalSeparator: DecimalSeparator;
}

type Json = Readonly<Record<string, unknown>>;

const invalid = (pointer: string, message: string) =>
  new DomainError('IMPORT_MAPPING_INVALID', message).at(pointer);

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

function columnIndex(value: unknown, pointer: string, columnCount: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw invalid(pointer, 'the column index must be a non-negative integer');
  }
  if (value >= columnCount) {
    throw invalid(pointer, `column ${value} does not exist (the file has ${columnCount} columns)`);
  }
  return value;
}

function required(source: Json, key: string, pointer: string): unknown {
  const value = source[key];
  if (value === undefined || value === null) throw invalid(pointer, `${key} is required`);
  return value;
}

/**
 * Valida un mapeo contra el ancho del archivo. Rechaza (`IMPORT_MAPPING_INVALID`, con el puntero JSON del campo)
 * columnas inexistentes, fecha/descripción/monto sin asignar, formatos fuera del catálogo y columnas repetidas.
 */
export function parseMapping(input: unknown, columnCount: number): CsvMapping {
  if (!isObject(input)) throw invalid('', 'the mapping must be an object');
  const hasHeader = input['hasHeader'];
  if (typeof hasHeader !== 'boolean') throw invalid('/hasHeader', 'hasHeader must be a boolean');
  const skipRows = input['skipRows'] ?? 0;
  if (
    typeof skipRows !== 'number' ||
    !Number.isInteger(skipRows) ||
    skipRows < 0 ||
    skipRows > MAX_SKIP_ROWS
  ) {
    throw invalid('/skipRows', `skipRows must be an integer between 0 and ${MAX_SKIP_ROWS}`);
  }
  const dateFormat = input['dateFormat'];
  if (!(DATE_FORMATS as readonly unknown[]).includes(dateFormat)) {
    throw invalid('/dateFormat', `dateFormat must be one of ${DATE_FORMATS.join(', ')}`);
  }
  const decimalSeparator = input['decimalSeparator'];
  if (!(DECIMAL_SEPARATORS as readonly unknown[]).includes(decimalSeparator)) {
    throw invalid('/decimalSeparator', 'decimalSeparator must be "," or "."');
  }
  const columns = input['columns'];
  if (!isObject(columns)) throw invalid('/columns', 'columns is required');
  const date = required(columns, 'date', '/columns/date');
  const description = required(columns, 'description', '/columns/description');
  const amount = required(columns, 'amount', '/columns/amount');
  if (!isObject(date)) throw invalid('/columns/date', 'date must be { index }');
  if (!isObject(description)) throw invalid('/columns/description', 'description must be { index }');
  if (!isObject(amount)) throw invalid('/columns/amount', 'amount must be an object');
  const dateIndex = columnIndex(date['index'], jsonPointer('columns', 'date', 'index'), columnCount);
  const descriptionIndex = columnIndex(
    description['index'],
    jsonPointer('columns', 'description', 'index'),
    columnCount,
  );

  let amountMapping: AmountMapping;
  const used = [dateIndex, descriptionIndex];
  if (amount['mode'] === 'SIGNED') {
    const index = columnIndex(amount['index'], '/columns/amount/index', columnCount);
    if (!(SIGN_CONVENTIONS as readonly unknown[]).includes(amount['signConvention'])) {
      throw invalid('/columns/amount/signConvention', 'signConvention is required');
    }
    amountMapping = { mode: 'SIGNED', index, signConvention: amount['signConvention'] as SignConvention };
    used.push(index);
  } else if (amount['mode'] === 'DEBIT_CREDIT') {
    const debitIndex = columnIndex(amount['debitIndex'], '/columns/amount/debitIndex', columnCount);
    const creditIndex = columnIndex(amount['creditIndex'], '/columns/amount/creditIndex', columnCount);
    if (debitIndex === creditIndex) {
      throw invalid('/columns/amount/creditIndex', 'debit and credit must be different columns');
    }
    amountMapping = { mode: 'DEBIT_CREDIT', debitIndex, creditIndex };
    used.push(debitIndex, creditIndex);
  } else {
    throw invalid('/columns/amount/mode', 'amount.mode must be SIGNED or DEBIT_CREDIT');
  }
  if (new Set(used).size !== used.length) {
    throw invalid('/columns', 'date, description and amount must use different columns');
  }
  return {
    hasHeader,
    skipRows,
    columns: { date: { index: dateIndex }, description: { index: descriptionIndex }, amount: amountMapping },
    dateFormat: dateFormat as DateFormat,
    decimalSeparator: decimalSeparator as DecimalSeparator,
  };
}

/** Registros de datos: los posteriores a `skipRows` registros iniciales y, si hay, a la fila de encabezado. */
export function dataRecords(records: readonly CsvRecord[], mapping: CsvMapping): readonly CsvRecord[] {
  return records.slice(mapping.skipRows + (mapping.hasHeader ? 1 : 0));
}
