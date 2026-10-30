import { Money } from '@pf/shared-kernel';
import type { DecimalSeparator } from './csv-mapping.js';
import type { CsvRecord } from './csv-sniffer.js';
import { normalizeDescription, parseAmountText, parseDate } from './row-normalizer.js';
import { DEFAULT_CURRENCY_ALIASES, type ProfileMapping } from './profile-options.js';
import type { StatementRecord } from './statement.js';
import type { RowIssue } from './types.js';

/**
 * Normalizador de extractos tabulares con perfil (FR-IMPORTS-006; openspec add-import-pipeline decisión 7). Amplía el
 * `RowNormalizer` del CSV básico sin cambiarlo: omite pie, resuelve el indicador de débito/crédito, une columnas de
 * descripción, traduce alias de moneda, separa la referencia única de la que se repite, lee la hora y limpia prefijos
 * literales. Un monto con más decimales que la escala o no interpretable invalida la fila; NUNCA se redondea (INV-003)
 * ni se usa `number` (INV-001).
 */

/** Registros de datos: sin preámbulo, encabezado ni pie. Las filas omitidas no aparecen ni como inválidas. */
export function selectDataRecords(
  records: readonly CsvRecord[],
  mapping: Pick<ProfileMapping, 'skipRows' | 'hasHeader' | 'skipFooterRows'>,
): readonly CsvRecord[] {
  const body = records.slice(mapping.skipRows + (mapping.hasHeader ? 1 : 0));
  return mapping.skipFooterRows > 0 ? body.slice(0, Math.max(0, body.length - mapping.skipFooterRows)) : body;
}

export type InferredSeparator =
  | { readonly kind: 'OK'; readonly separator: DecimalSeparator }
  | { readonly kind: 'AMBIGUOUS' }
  | { readonly kind: 'INVALID' };

/**
 * Infiere el separador decimal de un monto cuando el perfil no lo fija: dos separadores distintos ⇒ el último es el
 * decimal; uno repetido ⇒ es de miles; uno solo con 3 dígitos detrás (`1.234`) ⇒ ambiguo (no se adivina).
 */
export function inferDecimalSeparator(raw: string): InferredSeparator {
  const s = raw.replace(/[\s\u00a0\u202f()+-]/gu, '');
  if (!/^[\d.,]*$/u.test(s)) return { kind: 'INVALID' };
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot < 0 && lastComma < 0) return { kind: 'OK', separator: '.' };
  if (lastDot >= 0 && lastComma >= 0) {
    return { kind: 'OK', separator: lastDot > lastComma ? '.' : ',' };
  }
  const sep: DecimalSeparator = lastDot >= 0 ? '.' : ',';
  const count = s.split(sep).length - 1;
  if (count > 1) return { kind: 'OK', separator: sep === '.' ? ',' : '.' };
  const intPart = s.slice(0, s.indexOf(sep));
  const fraction = s.slice(s.indexOf(sep) + 1);
  if (fraction.length === 3 && intPart !== '' && intPart !== '0' && !/^0+$/.test(intPart)) {
    return { kind: 'AMBIGUOUS' };
  }
  return { kind: 'OK', separator: sep };
}

type Amount =
  | { readonly kind: 'OK'; readonly signed: string }
  | { readonly kind: 'ZERO' }
  | { readonly kind: 'INVALID' }
  | { readonly kind: 'AMBIGUOUS' };

function readMagnitude(
  raw: string,
  fixed: DecimalSeparator | null,
):
  | { kind: 'EMPTY' }
  | { kind: 'INVALID' }
  | { kind: 'AMBIGUOUS' }
  | { kind: 'OK'; negative: boolean; magnitude: string } {
  let separator = fixed;
  if (separator === null) {
    const inferred = inferDecimalSeparator(raw);
    if (inferred.kind === 'AMBIGUOUS') return { kind: 'AMBIGUOUS' };
    if (inferred.kind === 'INVALID') return { kind: 'INVALID' };
    separator = inferred.separator;
  }
  return parseAmountText(raw, separator);
}

function toSigned(
  magnitude: string,
  negative: boolean,
  currencyCode: string,
  scale: number,
): { signed: string; zero: boolean } | null {
  try {
    const money = Money.parse(magnitude, currencyCode, scale);
    if (money.isZero()) return { signed: money.toJSON().amount, zero: true };
    return { signed: (negative ? money.negate() : money).toJSON().amount, zero: false };
  } catch {
    return null;
  }
}

function readAmount(
  cells: readonly string[],
  mapping: ProfileMapping,
  currencyCode: string,
  scale: number,
): Amount {
  const cell = (i: number) => cells[i] ?? '';
  const a = mapping.columns.amount;
  const sep = mapping.decimalSeparator;
  if (a.mode === 'SIGNED') {
    const p = readMagnitude(cell(a.column.index), sep);
    if (p.kind === 'AMBIGUOUS') return { kind: 'AMBIGUOUS' };
    if (p.kind !== 'OK') return { kind: 'INVALID' };
    const outflowIsNegative = a.signConvention === 'NEGATIVE_IS_OUTFLOW';
    // Salida ⇒ negativa en el monto firmado del registro, sea cual sea la convención de origen.
    const outflow = p.negative === outflowIsNegative;
    const r = toSigned(p.magnitude, outflow, currencyCode, scale);
    if (!r) return { kind: 'INVALID' };
    return r.zero ? { kind: 'ZERO' } : { kind: 'OK', signed: r.signed };
  }
  if (a.mode === 'INDICATOR') {
    const p = readMagnitude(cell(a.column.index), sep);
    if (p.kind === 'AMBIGUOUS') return { kind: 'AMBIGUOUS' };
    if (p.kind !== 'OK') return { kind: 'INVALID' };
    const indicator = cell(a.indicator.index).trim().toUpperCase();
    const isDebit = a.debitValues.some((v) => v.toUpperCase() === indicator);
    const isCredit = a.creditValues.some((v) => v.toUpperCase() === indicator);
    if (isDebit === isCredit) return { kind: 'INVALID' };
    const r = toSigned(p.magnitude, isDebit, currencyCode, scale);
    if (!r) return { kind: 'INVALID' };
    return r.zero ? { kind: 'ZERO' } : { kind: 'OK', signed: r.signed };
  }
  const debit = readMagnitude(cell(a.debit.index), sep);
  const credit = readMagnitude(cell(a.credit.index), sep);
  if (debit.kind === 'AMBIGUOUS' || credit.kind === 'AMBIGUOUS') return { kind: 'AMBIGUOUS' };
  if (debit.kind === 'INVALID' || credit.kind === 'INVALID') return { kind: 'INVALID' };
  const d = debit.kind === 'OK' ? toSigned(debit.magnitude, true, currencyCode, scale) : null;
  const c = credit.kind === 'OK' ? toSigned(credit.magnitude, false, currencyCode, scale) : null;
  if ((debit.kind === 'OK' && !d) || (credit.kind === 'OK' && !c)) return { kind: 'INVALID' };
  const dHas = d !== null && !d.zero;
  const cHas = c !== null && !c.zero;
  if (dHas && cHas) return { kind: 'INVALID' };
  if (dHas) return { kind: 'OK', signed: d.signed };
  if (cHas) return { kind: 'OK', signed: c.signed };
  if (debit.kind === 'EMPTY' && credit.kind === 'EMPTY') return { kind: 'INVALID' };
  return { kind: 'ZERO' };
}

/** `HH:mm` o `HH:mm:ss` ⇒ `HH:mm:ss`; `null` si no es una hora válida. */
export function parseTime(raw: string, format: 'HH:mm' | 'HH:mm:ss'): string | null {
  const m = (format === 'HH:mm' ? /^(\d{1,2}):(\d{2})$/ : /^(\d{1,2}):(\d{2}):(\d{2})$/).exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const s = format === 'HH:mm' ? 0 : Number(m[3]);
  if (h > 23 || mi > 59 || s > 59) return null;
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(h)}:${two(mi)}:${two(s)}`;
}

/** Quita UN prefijo literal (el primero de la lista que coincida) y recorta; sin expresiones regulares (ReDoS). */
export function cleanDescriptionPrefix(text: string, prefixes: readonly string[]): string {
  for (const prefix of prefixes) {
    if (prefix !== '' && text.startsWith(prefix)) return text.slice(prefix.length).trim();
  }
  return text;
}

const error = (code: RowIssue['code']): RowIssue => ({ code, severity: 'ERROR' });

export interface StatementNormalizeContext {
  /** Moneda y escala de la cuenta destino. */
  readonly currencyCode: string;
  readonly scale: number;
}

/** Normaliza un registro de datos con un perfil o mapeo. La validación de negocio (cero, futuro) es de `RowValidator`. */
export function normalizeStatementRow(
  record: CsvRecord,
  mapping: ProfileMapping,
  ctx: StatementNormalizeContext,
): StatementRecord {
  const cells = record.cells;
  const cell = (i: number) => cells[i] ?? '';
  const issues: RowIssue[] = [];
  const c = mapping.columns;

  const date = parseDate(cell(c.date.index), mapping.dateFormat);
  if (!date) issues.push(error('IMPORT_INVALID_DATE'));

  // Moneda: alias del perfil sobre los de la tabla por omisión; otra moneda ⇒ fila inválida.
  let currency: string | null = null;
  if (c.currency) {
    const raw = cell(c.currency.column.index).trim().toUpperCase();
    if (raw !== '') {
      currency = c.currency.aliases[raw] ?? DEFAULT_CURRENCY_ALIASES[raw] ?? raw;
      if (currency !== ctx.currencyCode) issues.push(error('IMPORT_CURRENCY_MISMATCH'));
    }
  }

  const amount = readAmount(cells, mapping, ctx.currencyCode, ctx.scale);
  if (amount.kind === 'AMBIGUOUS') issues.push(error('IMPORT_AMBIGUOUS_NUMBER'));
  else if (amount.kind === 'INVALID') issues.push(error('IMPORT_INVALID_AMOUNT'));

  const joined = c.description.map((d) => cell(d.index)).join(' ');
  const first = normalizeDescription(joined);
  let description = first.text;
  let truncated = first.truncated;
  if (description !== null && mapping.descriptionCleanup.length > 0) {
    const cleaned = normalizeDescription(cleanDescriptionPrefix(description, mapping.descriptionCleanup));
    description = cleaned.text;
    truncated = truncated || cleaned.truncated;
  }
  if (truncated) issues.push({ code: 'IMPORT_DESCRIPTION_TRUNCATED', severity: 'WARNING' });

  let time: string | null = null;
  if (c.time) {
    const raw = cell(c.time.column.index).trim();
    if (raw !== '') {
      time = parseTime(raw, c.time.format);
      if (time === null) issues.push({ code: 'IMPORT_INVALID_DATE', severity: 'WARNING' });
    }
  }
  const valueDate = c.valueDate
    ? (parseDate(cell(c.valueDate.index), mapping.dateFormat)?.toString() ?? null)
    : null;

  let externalId: string | null = null;
  let reference: string | null = null;
  if (c.reference) {
    const raw = cell(c.reference.column.index).trim();
    if (raw !== '') {
      if (c.reference.unique) externalId = raw;
      else reference = raw;
    }
  }

  let runningBalance: string | null = null;
  if (c.runningBalance) {
    const p = readMagnitude(cell(c.runningBalance.index), mapping.decimalSeparator);
    if (p.kind === 'OK') {
      runningBalance = toSigned(p.magnitude, p.negative, ctx.currencyCode, ctx.scale)?.signed ?? null;
    }
  }

  return {
    line: record.line,
    bookingDate: date ? date.toString() : null,
    time,
    valueDate,
    amount: amount.kind === 'OK' ? amount.signed : amount.kind === 'ZERO' ? zeroOf(ctx.scale) : null,
    currency,
    description,
    externalId,
    reference,
    counterparty: null,
    runningBalance,
    issues,
  };
}

function zeroOf(scale: number): string {
  return scale === 0 ? '0' : `0.${'0'.repeat(scale)}`;
}
