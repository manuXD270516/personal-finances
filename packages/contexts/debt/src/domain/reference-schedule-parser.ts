import { DomainError, LocalDate, Money, type Currency } from '@pf/shared-kernel';
import {
  detectDelimiter,
  parseDelimited,
  REFERENCE_DELIMITERS,
  type DelimitedRecord,
  type ReferenceDelimiter,
} from './delimited-text.js';
import type { ReferenceScheduleRow } from './loan-types.js';

/**
 * `ReferenceScheduleParser` (openspec add-loans, design decisión 12; TC-DEBT-AMORT-015, -016).
 *
 * Lee la tabla de amortización del banco desde texto (CSV, TSV o pegado de una planilla) con mapeo explícito de
 * columnas, formato de fecha y separador decimal explícitos, y valida cada fila. Puro: no guarda el contenido
 * original (solo se devuelven las filas válidas) ni toca el cronograma del préstamo.
 *
 * Los errores se devuelven por fila (`row` = número de fila de datos, 1-based, sin contar el encabezado; el detalle
 * trae la línea física `line`); la capa de aplicación los convierte a `LOAN_REFERENCE_INVALID`.
 */

export const MAX_REFERENCE_BYTES = 256 * 1024;
export const MAX_REFERENCE_ROWS = 600;
/** Tope de errores devueltos (evita respuestas enormes con un mapeo equivocado). */
export const MAX_REFERENCE_ERRORS = 50;

export const REFERENCE_DATE_FORMATS = ['DD/MM/YYYY', 'YYYY-MM-DD', 'MM/DD/YYYY'] as const;
export type ReferenceDateFormat = (typeof REFERENCE_DATE_FORMATS)[number];
export type DecimalSeparator = ',' | '.';

/** Columna: índice 0-based o nombre del encabezado (sin distinguir mayúsculas ni espacios en los bordes). */
export type ColumnRef = number | string;

export interface ReferenceColumnMapping {
  readonly installmentNo: ColumnRef;
  readonly dueDate: ColumnRef;
  readonly principal: ColumnRef;
  readonly interest: ColumnRef;
  readonly fees?: ColumnRef;
  readonly insurance?: ColumnRef;
  readonly taxes?: ColumnRef;
  readonly total?: ColumnRef;
  readonly balance?: ColumnRef;
}

export interface ParseReferenceInput {
  readonly text: string;
  /** Si se omite se detecta (la UI lo muestra y el usuario lo confirma). */
  readonly delimiter?: ReferenceDelimiter;
  /** La primera fila es el encabezado (por omisión sí). */
  readonly hasHeader?: boolean;
  readonly mapping: ReferenceColumnMapping;
  readonly dateFormat: ReferenceDateFormat;
  readonly decimalSeparator: DecimalSeparator;
  readonly currency: Currency;
}

export interface ReferenceRowError {
  /** Fila de datos (1-based); 0 = error del archivo o del mapeo. */
  readonly row: number;
  readonly field: string;
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export type ParseReferenceResult =
  | {
      readonly ok: true;
      readonly delimiter: ReferenceDelimiter;
      readonly rows: readonly ReferenceScheduleRow[];
    }
  | { readonly ok: false; readonly errors: readonly ReferenceRowError[] };

export type ValidateReferenceResult =
  | { readonly ok: true; readonly rows: readonly ReferenceScheduleRow[] }
  | { readonly ok: false; readonly errors: readonly ReferenceRowError[] };

/** Fila ingresada a mano (montos como strings decimales con punto, fecha ISO). Los opcionales ausentes valen 0. */
export interface ManualReferenceRow {
  readonly n: number;
  readonly dueDate: string;
  readonly principal: string;
  readonly interest: string;
  readonly fees?: string;
  readonly insurance?: string;
  readonly taxes?: string;
  readonly total?: string;
  readonly balance?: string;
}

export interface ReferenceTablePreview {
  readonly delimiter: ReferenceDelimiter;
  /** Primera fila (encabezado si `hasHeader`). */
  readonly headers: readonly string[];
  /** Filas de datos (sin encabezado). */
  readonly rowCount: number;
  /** Primeras filas de datos, para que el usuario confirme separador y columnas. */
  readonly preview: readonly (readonly string[])[];
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length;

const fileError = (
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ReferenceRowError => ({
  row: 0,
  field: 'file',
  code,
  message,
  details,
});

/** Detecta el separador y muestra encabezados y primeras filas; no valida montos ni fechas. */
export function detectReferenceTable(
  text: string,
  options: { delimiter?: ReferenceDelimiter; hasHeader?: boolean } = {},
): ReferenceTablePreview {
  const delimiter = options.delimiter ?? detectDelimiter(text);
  const records = parseDelimited(text, delimiter);
  const hasHeader = options.hasHeader ?? true;
  const data = hasHeader ? records.slice(1) : records;
  return {
    delimiter,
    headers: (records[0]?.cells ?? []).map((c) => c.trim()),
    rowCount: data.length,
    preview: data.slice(0, 5).map((r) => r.cells.map((c) => c.trim())),
  };
}

// ---------- celdas ----------

const escapeRegex = (ch: string): string => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Cell<T> = { readonly value: T } | { readonly error: ReferenceRowError };

function parseAmountCell(
  raw: string,
  separator: DecimalSeparator,
  currency: Currency,
  row: number,
  field: string,
  line: number,
): Cell<Money> {
  const fail = (code: string, message: string): Cell<Money> => ({
    error: { row, field, code, message, details: { line, value: raw } },
  });
  const thousands = separator === ',' ? '.' : ',';
  let text = raw.replace(/\s/g, '');
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }
  const d = escapeRegex(separator);
  const t = escapeRegex(thousands);
  const plain = new RegExp(`^\\d+(?:${d}\\d+)?$`);
  const grouped = new RegExp(`^\\d{1,3}(?:${t}\\d{3})+(?:${d}\\d+)?$`);
  if (!plain.test(text) && !grouped.test(text)) {
    return fail('AMOUNT_UNREADABLE', `row ${row}: ${field} "${raw}" is not a readable amount`);
  }
  const canonical = text.split(thousands).join('').replace(separator, '.');
  let money: Money;
  try {
    money = Money.parse(canonical, currency);
  } catch (e) {
    if (e instanceof DomainError && e.code === 'AMOUNT_SCALE_EXCEEDED') {
      return fail(
        'AMOUNT_SCALE_EXCEEDED',
        `row ${row}: ${field} "${raw}" has more decimals than ${currency.code} allows`,
      );
    }
    return fail('AMOUNT_UNREADABLE', `row ${row}: ${field} "${raw}" is not a readable amount`);
  }
  if (negative && !money.isZero()) {
    return fail('AMOUNT_NEGATIVE', `row ${row}: ${field} "${raw}" must not be negative`);
  }
  return { value: money };
}

function parseDateCell(raw: string, format: ReferenceDateFormat, row: number, line: number): Cell<LocalDate> {
  const text = raw.trim();
  const fail = (): Cell<LocalDate> => ({
    error: {
      row,
      field: 'dueDate',
      code: 'DATE_INVALID',
      message: `row ${row}: dueDate "${raw}" does not match ${format}`,
      details: { line, value: raw, format },
    },
  });
  let year: number;
  let month: number;
  let day: number;
  if (format === 'YYYY-MM-DD') {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
    if (!m) return fail();
    [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
    if (!m) return fail();
    year = Number(m[3]);
    [month, day] = format === 'DD/MM/YYYY' ? [Number(m[2]), Number(m[1])] : [Number(m[1]), Number(m[2])];
  }
  try {
    return { value: LocalDate.of(year, month, day) };
  } catch {
    return fail();
  }
}

function parseNumberCell(raw: string, row: number, line: number): Cell<number> {
  const text = raw.trim();
  if (!/^\d{1,9}$/.test(text) || Number(text) < 1) {
    return {
      error: {
        row,
        field: 'installmentNo',
        code: 'INSTALLMENT_NO_INVALID',
        message: `row ${row}: installmentNo "${raw}" must be a positive integer`,
        details: { line, value: raw },
      },
    };
  }
  return { value: Number(text) };
}

// ---------- validación común ----------

interface RawRow {
  readonly row: number;
  readonly line: number;
  readonly n: Cell<number>;
  readonly dueDate: Cell<LocalDate>;
  readonly principal: Cell<Money>;
  readonly interest: Cell<Money>;
  readonly fees: Cell<Money>;
  readonly insurance: Cell<Money>;
  readonly taxes: Cell<Money>;
  /** `null` = columna no informada: el total se deriva de los componentes. */
  readonly total: Cell<Money> | null;
  readonly balance: Cell<Money> | null;
}

function finalize(raws: readonly RawRow[], currency: Currency): ValidateReferenceResult {
  const errors: ReferenceRowError[] = [];
  const rows: ReferenceScheduleRow[] = [];
  const seen = new Map<number, number>();
  for (const raw of raws) {
    const cells = [
      raw.n,
      raw.dueDate,
      raw.principal,
      raw.interest,
      raw.fees,
      raw.insurance,
      raw.taxes,
      raw.total,
      raw.balance,
    ];
    let broken = false;
    for (const cell of cells) {
      if (cell && 'error' in cell) {
        errors.push(cell.error);
        broken = true;
      }
    }
    if (raw.n && 'value' in raw.n) {
      const first = seen.get(raw.n.value);
      if (first !== undefined) {
        errors.push({
          row: raw.row,
          field: 'installmentNo',
          code: 'INSTALLMENT_NO_DUPLICATED',
          message: `row ${raw.row}: installment ${raw.n.value} is already in row ${first}`,
          details: { line: raw.line, installmentNo: raw.n.value, firstRow: first },
        });
        broken = true;
      } else {
        seen.set(raw.n.value, raw.row);
      }
    }
    if (broken) continue;
    const v = (c: Cell<Money> | null): Money => (c && 'value' in c ? c.value : Money.zero(currency));
    const n = (raw.n as { value: number }).value;
    const principal = v(raw.principal);
    const interest = v(raw.interest);
    const fees = v(raw.fees);
    const insurance = v(raw.insurance);
    const taxes = v(raw.taxes);
    const calculated = Money.sum([principal, interest, fees, insurance, taxes], currency);
    let total = calculated;
    if (raw.total && 'value' in raw.total) {
      total = raw.total.value;
      if (!total.equals(calculated)) {
        errors.push({
          row: raw.row,
          field: 'total',
          code: 'TOTAL_MISMATCH',
          message: `row ${raw.row}: total ${calculated.toFixed()} calculado frente a ${total.toFixed()} informado`,
          details: { line: raw.line, calculated: calculated.toFixed(), reported: total.toFixed() },
        });
        continue;
      }
    }
    const base: ReferenceScheduleRow = {
      n,
      dueDate: (raw.dueDate as { value: LocalDate }).value.toString(),
      principal: principal.toFixed(),
      interest: interest.toFixed(),
      fees: fees.toFixed(),
      insurance: insurance.toFixed(),
      taxes: taxes.toFixed(),
      total: total.toFixed(),
    };
    rows.push(
      raw.balance && 'value' in raw.balance ? { ...base, balance: raw.balance.value.toFixed() } : base,
    );
  }
  if (errors.length > 0) {
    // orden estable por fila; dentro de la fila se conserva el orden de detección
    const sorted = errors
      .map((e, i) => ({ e, i }))
      .sort((a, b) => a.e.row - b.e.row || a.i - b.i)
      .map(({ e }) => e);
    return { ok: false, errors: sorted.slice(0, MAX_REFERENCE_ERRORS) };
  }
  if (rows.length === 0) {
    return { ok: false, errors: [fileError('NO_ROWS', 'the table has no rows')] };
  }
  if (rows.length > MAX_REFERENCE_ROWS) {
    return {
      ok: false,
      errors: [
        fileError('TOO_MANY_ROWS', `the table has more than ${MAX_REFERENCE_ROWS} rows`, {
          max: MAX_REFERENCE_ROWS,
        }),
      ],
    };
  }
  return { ok: true, rows: rows.sort((a, b) => a.n - b.n) };
}

/** Parsea y valida la tabla del banco. Devuelve las filas válidas (ordenadas por número) o los errores por fila. */
export function parseReferenceSchedule(input: ParseReferenceInput): ParseReferenceResult {
  if (byteLength(input.text) > MAX_REFERENCE_BYTES) {
    return {
      ok: false,
      errors: [
        fileError('TOO_LARGE', `the file exceeds ${MAX_REFERENCE_BYTES / 1024} KiB`, {
          maxBytes: MAX_REFERENCE_BYTES,
        }),
      ],
    };
  }
  const delimiter = input.delimiter ?? detectDelimiter(input.text);
  if (!(REFERENCE_DELIMITERS as readonly string[]).includes(delimiter)) {
    return { ok: false, errors: [fileError('DELIMITER_INVALID', 'unsupported delimiter')] };
  }
  const records = parseDelimited(input.text, delimiter);
  const hasHeader = input.hasHeader ?? true;
  const header = hasHeader ? (records[0]?.cells ?? []) : [];
  const data: readonly DelimitedRecord[] = hasHeader ? records.slice(1) : records;
  if (data.length > MAX_REFERENCE_ROWS) {
    return {
      ok: false,
      errors: [
        fileError('TOO_MANY_ROWS', `the table has more than ${MAX_REFERENCE_ROWS} rows`, {
          max: MAX_REFERENCE_ROWS,
        }),
      ],
    };
  }

  // Resolución del mapeo
  const mappingErrors: ReferenceRowError[] = [];
  const resolve = (field: string, ref: ColumnRef | undefined): number | null => {
    if (ref === undefined) return null;
    if (typeof ref === 'number') {
      if (Number.isInteger(ref) && ref >= 0) return ref;
    } else if (hasHeader) {
      const wanted = ref.trim().toLowerCase();
      const idx = header.findIndex((h) => h.trim().toLowerCase() === wanted);
      if (idx >= 0) return idx;
    }
    mappingErrors.push({
      row: 0,
      field,
      code: 'MAPPING_COLUMN_NOT_FOUND',
      message: `the column mapped to ${field} was not found`,
      details: { column: ref },
    });
    return null;
  };
  const m = input.mapping;
  const idx = {
    n: resolve('installmentNo', m.installmentNo),
    dueDate: resolve('dueDate', m.dueDate),
    principal: resolve('principal', m.principal),
    interest: resolve('interest', m.interest),
    fees: resolve('fees', m.fees),
    insurance: resolve('insurance', m.insurance),
    taxes: resolve('taxes', m.taxes),
    total: resolve('total', m.total),
    balance: resolve('balance', m.balance),
  };
  if (mappingErrors.length > 0) return { ok: false, errors: mappingErrors };

  const raws: RawRow[] = data.map((record, i) => {
    const row = i + 1;
    const line = record.line;
    const get = (column: number | null): string | null =>
      column === null ? null : (record.cells[column] ?? '').trim();
    const required = <T>(column: number | null, field: string, parse: (raw: string) => Cell<T>): Cell<T> => {
      const raw = get(column) ?? '';
      if (raw === '') {
        return {
          error: {
            row,
            field,
            code: 'VALUE_MISSING',
            message: `row ${row}: ${field} is empty`,
            details: { line },
          },
        };
      }
      return parse(raw);
    };
    const amount = (field: string) => (raw: string) =>
      parseAmountCell(raw, input.decimalSeparator, input.currency, row, field, line);
    const optionalAmount = (column: number | null, field: string): Cell<Money> => {
      const raw = get(column);
      return raw === null || raw === '' ? { value: Money.zero(input.currency) } : amount(field)(raw);
    };
    const optionalReported = (column: number | null, field: string): Cell<Money> | null => {
      const raw = get(column);
      return raw === null || raw === '' ? null : amount(field)(raw);
    };
    return {
      row,
      line,
      n: required(idx.n, 'installmentNo', (r) => parseNumberCell(r, row, line)),
      dueDate: required(idx.dueDate, 'dueDate', (r) => parseDateCell(r, input.dateFormat, row, line)),
      principal: required(idx.principal, 'principal', amount('principal')),
      interest: required(idx.interest, 'interest', amount('interest')),
      fees: optionalAmount(idx.fees, 'fees'),
      insurance: optionalAmount(idx.insurance, 'insurance'),
      taxes: optionalAmount(idx.taxes, 'taxes'),
      total: optionalReported(idx.total, 'total'),
      balance: optionalReported(idx.balance, 'balance'),
    };
  });
  const result = finalize(raws, input.currency);
  return result.ok ? { ok: true, delimiter, rows: result.rows } : result;
}

/** Validación de filas ingresadas una a una: mismas reglas que la tabla pegada (escala, negativos, total, duplicados). */
export function validateReferenceRows(
  rows: readonly ManualReferenceRow[],
  currency: Currency,
): ValidateReferenceResult {
  if (rows.length > MAX_REFERENCE_ROWS) {
    return {
      ok: false,
      errors: [
        fileError('TOO_MANY_ROWS', `the table has more than ${MAX_REFERENCE_ROWS} rows`, {
          max: MAX_REFERENCE_ROWS,
        }),
      ],
    };
  }
  const raws: RawRow[] = rows.map((r, i) => {
    const row = i + 1;
    /** `required`: obligatorio; `zero`: ausente vale 0; `reported`: ausente = columna no informada. */
    const amount = (
      value: string | undefined,
      field: string,
      kind: 'required' | 'zero' | 'reported',
    ): Cell<Money> | null => {
      if (value === undefined || value === '') {
        if (kind === 'zero') return { value: Money.zero(currency) };
        if (kind === 'reported') return null;
        return {
          error: { row, field, code: 'VALUE_MISSING', message: `row ${row}: ${field} is empty`, details: {} },
        };
      }
      return parseAmountCell(value, '.', currency, row, field, row);
    };
    let date: Cell<LocalDate>;
    try {
      date = { value: LocalDate.parse(r.dueDate) };
    } catch {
      date = parseDateCell(r.dueDate, 'YYYY-MM-DD', row, row);
    }
    const n: Cell<number> =
      Number.isInteger(r.n) && r.n >= 1
        ? { value: r.n }
        : {
            error: {
              row,
              field: 'installmentNo',
              code: 'INSTALLMENT_NO_INVALID',
              message: `row ${row}: installmentNo must be a positive integer`,
              details: { value: r.n },
            },
          };
    return {
      row,
      line: row,
      n,
      dueDate: date,
      principal: amount(r.principal, 'principal', 'required') as Cell<Money>,
      interest: amount(r.interest, 'interest', 'required') as Cell<Money>,
      fees: amount(r.fees, 'fees', 'zero') as Cell<Money>,
      insurance: amount(r.insurance, 'insurance', 'zero') as Cell<Money>,
      taxes: amount(r.taxes, 'taxes', 'zero') as Cell<Money>,
      total: amount(r.total, 'total', 'reported'),
      balance: amount(r.balance, 'balance', 'reported'),
    };
  });
  return finalize(raws, currency);
}
