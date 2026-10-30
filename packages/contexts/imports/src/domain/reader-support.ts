import { LocalDate, Money } from '@pf/shared-kernel';
import { normalizeDescription } from './row-normalizer.js';
import type { ParsedStatement, StatementFormat, StatementRecord } from './statement.js';
import type { RowIssue } from './types.js';

/** Utilidades compartidas por los lectores de formatos autodescritos (OFX, QIF, JSON). Sin dependencias externas. */

const PLAIN_AMOUNT = /^[+-]?\d+(?:\.\d+)?$/;

/**
 * Monto textual de un formato autodescrito ⇒ texto decimal con signo en la escala de la moneda. `null` si no es
 * interpretable o excede la escala (NUNCA se redondea, INV-003). Acepta `,` como separador decimal único.
 */
export function canonicalSignedAmount(raw: string, currencyCode: string, scale: number): string | null {
  let s = raw.replace(/[\s\u00a0]/gu, '');
  if (s === '') return null;
  if (s.includes(',') && !s.includes('.')) {
    const parts = s.split(',');
    s = parts.length === 2 && (parts[1] as string).length !== 3 ? `${parts[0]}.${parts[1]}` : parts.join('');
  } else {
    s = s.replace(/,/g, '');
  }
  if (!PLAIN_AMOUNT.test(s)) return null;
  const negative = s.startsWith('-');
  const digits = s.replace(/^[+-]/, '').replace(/^0+(?=\d)/, '');
  try {
    const money = Money.parse(digits, currencyCode, scale);
    if (money.isZero()) return money.toJSON().amount;
    return (negative ? money.negate() : money).toJSON().amount;
  } catch {
    return null;
  }
}

/** Fecha `YYYY-MM-DD` válida del calendario o `null`. */
export function validIsoDate(y: number, m: number, d: number): string | null {
  try {
    return LocalDate.of(y, m, d).toString();
  } catch {
    return null;
  }
}

/** Nombre y memo como descripción (sin repetir cuando coinciden), normalizada y acotada. */
export function joinDescription(...parts: readonly (string | null | undefined)[]): {
  text: string | null;
  truncated: boolean;
} {
  const seen: string[] = [];
  for (const part of parts) {
    const t = part?.trim();
    if (t && !seen.includes(t)) seen.push(t);
  }
  return normalizeDescription(seen.join(' '));
}

export const error = (code: RowIssue['code']): RowIssue => ({ code, severity: 'ERROR' });
export const warning = (code: RowIssue['code']): RowIssue => ({ code, severity: 'WARNING' });

export function emptyRecord(line: number): StatementRecord {
  return {
    line,
    bookingDate: null,
    time: null,
    valueDate: null,
    amount: null,
    currency: null,
    description: null,
    externalId: null,
    reference: null,
    counterparty: null,
    runningBalance: null,
    issues: [],
  };
}

/** Resultado de un fallo estructural: sin filas (el job queda en `PARSE_FAILED`). */
export function failed(
  format: StatementFormat,
  code: 'IMPORT_PARSE_FAILED' | 'IMPORT_TOO_MANY_ROWS',
  pointer: string | null,
): ParsedStatement {
  return {
    format,
    records: [],
    statement: null,
    declaredCurrency: null,
    failure: { code, pointer },
    needsMapping: [],
  };
}

/** Decodifica UTF-8 (con o sin BOM); si no es UTF-8 válido, windows-1252. Los NUL no son texto de extracto. */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.replace(/^\uFEFF/u, '').normalize('NFC');
}

/** Marca TODAS las filas con `IMPORT_CURRENCY_MISMATCH` cuando el archivo declara otra moneda que la cuenta. */
export function withCurrencyMismatch(records: readonly StatementRecord[]): StatementRecord[] {
  return records.map((r) => ({ ...r, issues: [...r.issues, error('IMPORT_CURRENCY_MISMATCH')] }));
}
