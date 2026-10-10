import { LocalDate, Money, type Currency } from '@pf/shared-kernel';
import type { CsvMapping, DateFormat, DecimalSeparator } from './csv-mapping.js';
import type { CsvRecord } from './csv-sniffer.js';
import type { Direction, RowIssue } from './types.js';

/**
 * `RowNormalizer` (decisión 5 de add-basic-csv-import): fecha, monto exacto y descripción de una fila, con el formato
 * que el usuario eligió y sin adivinar. Un monto con más decimales que la escala de la moneda o no interpretable es
 * una fila inválida: NUNCA se redondea (INV-003) y nunca se usa `number` (INV-001).
 */

export const MAX_DESCRIPTION_LENGTH = 500;

// ───────────────────────────────────────────────────────────── fechas

const DATE_PATTERNS: Record<
  DateFormat,
  { readonly re: RegExp; readonly order: readonly ('d' | 'm' | 'y')[] }
> = {
  'dd/MM/yyyy': { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ['d', 'm', 'y'] },
  'dd-MM-yyyy': { re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, order: ['d', 'm', 'y'] },
  'dd/MM/yy': { re: /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/, order: ['d', 'm', 'y'] },
  'yyyy-MM-dd': { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, order: ['y', 'm', 'd'] },
  'MM/dd/yyyy': { re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, order: ['m', 'd', 'y'] },
};

/** Fecha de negocio literal (sin hora ni zona) en el formato elegido; `null` si no interpretable o inexistente. */
export function parseDate(raw: string, format: DateFormat): LocalDate | null {
  const pattern = DATE_PATTERNS[format];
  const m = pattern.re.exec(raw.trim());
  if (!m) return null;
  const parts: Record<'d' | 'm' | 'y', number> = { d: 0, m: 0, y: 0 };
  pattern.order.forEach((key, i) => {
    parts[key] = Number(m[i + 1]);
  });
  // `dd/MM/yy`: pivote 2000–2099 (docs/13 §12).
  if (format === 'dd/MM/yy') parts.y += 2000;
  try {
    return LocalDate.of(parts.y, parts.m, parts.d);
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────── montos

export type ParsedAmount =
  | { readonly kind: 'EMPTY' }
  | { readonly kind: 'INVALID' }
  | { readonly kind: 'OK'; readonly negative: boolean; readonly magnitude: string };

const PLAIN_INT = /^\d+$/;
const FRACTION = /^\d+$/;

/**
 * Interpreta un monto textual con el separador decimal elegido. El otro carácter es separador de miles y solo se
 * acepta en posiciones de miles válidas (`1.234.567`); espacios y espacios duros se ignoran. Signo inicial `-`/`+`,
 * signo final (`1.234,56-`) o paréntesis `(1.234,56)` (uno solo de ellos). `magnitude` es un decimal canónico sin signo.
 */
export function parseAmountText(raw: string, decimalSeparator: DecimalSeparator): ParsedAmount {
  let s = raw.replace(/[\s\u00a0\u202f]/gu, '');
  if (s === '') return { kind: 'EMPTY' };
  let negative = false;
  let signs = 0;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    signs += 1;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-') || s.startsWith('+')) {
    negative = s.startsWith('-') ? true : negative;
    signs += 1;
    s = s.slice(1);
  }
  if (s.endsWith('-') || s.endsWith('+')) {
    negative = s.endsWith('-') ? true : negative;
    signs += 1;
    s = s.slice(0, -1);
  }
  if (signs > 1 || s === '') return { kind: 'INVALID' };

  const thousands = decimalSeparator === ',' ? '.' : ',';
  const pieces = s.split(decimalSeparator);
  if (pieces.length > 2) return { kind: 'INVALID' };
  const integerRaw = pieces[0] as string;
  const fraction = pieces[1];
  if (fraction !== undefined && !FRACTION.test(fraction)) return { kind: 'INVALID' };
  if (integerRaw === '' && fraction === undefined) return { kind: 'INVALID' };

  let integer: string;
  if (integerRaw === '') {
    integer = '0';
  } else if (PLAIN_INT.test(integerRaw)) {
    integer = integerRaw;
  } else {
    const groups = integerRaw.split(thousands);
    const grouped =
      groups.length > 1 &&
      /^\d{1,3}$/.test(groups[0] as string) &&
      groups.slice(1).every((g) => /^\d{3}$/.test(g));
    if (!grouped) return { kind: 'INVALID' };
    integer = groups.join('');
  }
  integer = integer.replace(/^0+(?=\d)/, '');
  return { kind: 'OK', negative, magnitude: fraction === undefined ? integer : `${integer}.${fraction}` };
}

// ───────────────────────────────────────────────────────────── descripción

// eslint-disable-next-line no-control-regex -- limpieza intencional de caracteres de control
const WHITESPACE_CONTROLS = /[\t\n\r\u000b\u000c\u0085\u2028\u2029]/gu;
// Controles C0/C1 restantes, DEL y controles bidireccionales / de ancho cero que reordenan o esconden texto.
// eslint-disable-next-line no-control-regex -- limpieza intencional de caracteres de control
const STRIPPED = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/gu;

export interface NormalizedDescription {
  /** `null` si queda vacía (se guarda como nula, sin texto inventado). */
  readonly text: string | null;
  readonly truncated: boolean;
}

/** NFKC→NFC, sin caracteres de control, espacios colapsados, recorte y tope de 500 caracteres. */
export function normalizeDescription(raw: string): NormalizedDescription {
  const cleaned = raw
    .normalize('NFKC')
    .normalize('NFC')
    .replace(WHITESPACE_CONTROLS, ' ')
    .replace(STRIPPED, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (cleaned === '') return { text: null, truncated: false };
  const points = Array.from(cleaned);
  if (points.length <= MAX_DESCRIPTION_LENGTH) return { text: cleaned, truncated: false };
  return { text: points.slice(0, MAX_DESCRIPTION_LENGTH).join('').trimEnd(), truncated: true };
}

// ───────────────────────────────────────────────────────────── fila

export interface NormalizedRow {
  readonly lineNumber: number;
  /** `YYYY-MM-DD` o `null` si la fecha es inválida. */
  readonly bookingDate: string | null;
  /** Monto SIEMPRE positivo en la escala de la moneda; `null` si es inválido. Cero se informa y lo rechaza el validador. */
  readonly amount: string | null;
  /** `null` si el monto es inválido o cero. */
  readonly direction: Direction | null;
  /** Monto con signo (salida negativa), independiente de la convención de origen; `null` si no hay dirección. */
  readonly signedAmount: string | null;
  readonly description: string | null;
  readonly issues: readonly RowIssue[];
}

const ERROR = (code: RowIssue['code']): RowIssue => ({ code, severity: 'ERROR' });

function normalizeAmount(
  cells: readonly string[],
  mapping: CsvMapping,
  currency: Currency,
): { readonly magnitude: Money; readonly direction: Direction | null } | null {
  const cell = (i: number) => cells[i] ?? '';
  const toMoney = (magnitude: string): Money | null => {
    try {
      return Money.parse(magnitude, currency);
    } catch {
      return null;
    }
  };
  const amount = mapping.columns.amount;
  if (amount.mode === 'SIGNED') {
    const parsed = parseAmountText(cell(amount.index), mapping.decimalSeparator);
    if (parsed.kind !== 'OK') return null;
    const money = toMoney(parsed.magnitude);
    if (!money) return null;
    if (money.isZero()) return { magnitude: money, direction: null };
    const outflowIsNegative = amount.signConvention === 'NEGATIVE_IS_OUTFLOW';
    return { magnitude: money, direction: parsed.negative === outflowIsNegative ? 'OUT' : 'IN' };
  }
  // DEBIT_CREDIT: exactamente una de las dos columnas con un valor distinto de cero; el signo no importa.
  const debit = parseAmountText(cell(amount.debitIndex), mapping.decimalSeparator);
  const credit = parseAmountText(cell(amount.creditIndex), mapping.decimalSeparator);
  if (debit.kind === 'INVALID' || credit.kind === 'INVALID') return null;
  const debitMoney = debit.kind === 'OK' ? toMoney(debit.magnitude) : null;
  const creditMoney = credit.kind === 'OK' ? toMoney(credit.magnitude) : null;
  if ((debit.kind === 'OK' && !debitMoney) || (credit.kind === 'OK' && !creditMoney)) return null;
  const debitHas = debitMoney !== null && !debitMoney.isZero();
  const creditHas = creditMoney !== null && !creditMoney.isZero();
  if (debitHas && creditHas) return null;
  if (debitHas) return { magnitude: debitMoney, direction: 'OUT' };
  if (creditHas) return { magnitude: creditMoney, direction: 'IN' };
  // Ambas vacías (sin valor) no son interpretables; ambas en cero sí lo son (monto cero ⇒ lo rechaza el validador).
  if (debit.kind === 'EMPTY' && credit.kind === 'EMPTY') return null;
  return { magnitude: Money.zero(currency), direction: null };
}

/** Normaliza un registro de datos con el mapeo y la moneda de la cuenta (la validación de negocio es de `RowValidator`). */
export function normalizeRow(record: CsvRecord, mapping: CsvMapping, currency: Currency): NormalizedRow {
  const cells = record.cells;
  const issues: RowIssue[] = [];

  const date = parseDate(cells[mapping.columns.date.index] ?? '', mapping.dateFormat);
  if (!date) issues.push(ERROR('IMPORT_INVALID_DATE'));

  const parsed = normalizeAmount(cells, mapping, currency);
  if (!parsed) issues.push(ERROR('IMPORT_INVALID_AMOUNT'));

  const description = normalizeDescription(cells[mapping.columns.description.index] ?? '');
  if (description.truncated) issues.push({ code: 'IMPORT_DESCRIPTION_TRUNCATED', severity: 'WARNING' });

  const magnitude = parsed?.magnitude ?? null;
  const direction = parsed?.direction ?? null;
  const signed = magnitude && direction ? (direction === 'OUT' ? magnitude.negate() : magnitude) : null;
  return {
    lineNumber: record.line,
    bookingDate: date ? date.toString() : null,
    amount: magnitude ? magnitude.toJSON().amount : null,
    direction,
    signedAmount: signed ? signed.toJSON().amount : null,
    description: description.text,
    issues,
  };
}
