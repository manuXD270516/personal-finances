import { Money } from '@pf/shared-kernel';
import {
  canonicalSignedAmount,
  decodeText,
  emptyRecord,
  error,
  failed,
  joinDescription,
  validIsoDate,
  warning,
} from './reader-support.js';
import type {
  ParseOptions,
  ParsedStatement,
  SniffResult,
  StatementParser,
  StatementRecord,
} from './statement.js';

/**
 * Lector QIF (openspec add-import-pipeline decisión 5): `!Type:Bank`, `!Type:CCard` y `!Type:Cash`; campos `D`, `T`/`U`,
 * `P`, `M`, `N` (número de cheque = referencia NO única) y divisiones `$` que deben sumar el monto. QIF no declara el
 * orden de día y mes: una fecha ambigua sin orden elegido NO se interpreta (la importación espera mapeo).
 */
const SUPPORTED_TYPES = new Set(['bank', 'ccard', 'cash']);

interface RawQif {
  d?: string;
  t?: string;
  p?: string;
  m?: string;
  n?: string;
  splits: string[];
}

type ParsedDate =
  | { readonly kind: 'OK'; readonly date: string }
  | { readonly kind: 'AMBIGUOUS' }
  | { readonly kind: 'INVALID' };

/** `D03/04'26`, `3/4/2026`, `03-04-26`: el primer y el segundo número son día/mes en el orden indicado. */
export function parseQifDate(raw: string, order: 'DMY' | 'MDY' | undefined): ParsedDate {
  const m = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*(?:['/.-]\s*(\d{1,4}))$/u.exec(raw.trim());
  if (!m) return { kind: 'INVALID' };
  const a = Number(m[1]);
  const b = Number(m[2]);
  let year = Number(m[3]);
  if ((m[3] as string).length <= 2) year += 2000;
  let day: number;
  let month: number;
  if (a > 12 && b <= 12) [day, month] = [a, b];
  else if (b > 12 && a <= 12) [day, month] = [b, a];
  else if (a === b) [day, month] = [a, b];
  else if (order === 'DMY') [day, month] = [a, b];
  else if (order === 'MDY') [day, month] = [b, a];
  else return { kind: 'AMBIGUOUS' };
  const iso = validIsoDate(year, month, day);
  return iso ? { kind: 'OK', date: iso } : { kind: 'INVALID' };
}

export class QifReader implements StatementParser {
  readonly format = 'QIF' as const;

  sniff(head: Uint8Array): SniffResult | null {
    const text = decodeText(head.subarray(0, 2048));
    if (text === null) return null;
    return /^\s*!(type|account|option)/iu.test(text) ? { format: 'QIF', confidence: 'HIGH' } : null;
  }

  parse(bytes: Uint8Array, options: ParseOptions): ParsedStatement {
    const text = decodeText(bytes);
    if (text === null) return failed('QIF', 'IMPORT_PARSE_FAILED', 'encoding');
    const raws: RawQif[] = [];
    let active = false;
    let seenType = false;
    let cur: RawQif = { splits: [] };
    for (const line of text.split(/\r\n|\n|\r/u)) {
      if (line === '') continue;
      if (line.startsWith('!')) {
        const header = /^!type\s*:\s*(.*)$/iu.exec(line);
        if (header) {
          const type = (header[1] as string).trim().toLowerCase();
          if (!SUPPORTED_TYPES.has(type)) return failed('QIF', 'IMPORT_PARSE_FAILED', 'type');
          active = true;
          seenType = true;
        } else {
          active = false; // !Account, !Option: bloques que no son movimientos
        }
        continue;
      }
      if (!active) continue;
      if (line === '^') {
        if (cur.d !== undefined || cur.t !== undefined) {
          if (raws.length >= options.maxRows) return failed('QIF', 'IMPORT_TOO_MANY_ROWS', null);
          raws.push(cur);
        }
        cur = { splits: [] };
        continue;
      }
      const code = line[0] as string;
      const value = line.slice(1);
      if (code === 'D') cur.d = value;
      else if (code === 'T' || (code === 'U' && cur.t === undefined)) cur.t = value;
      else if (code === 'P') cur.p = value;
      else if (code === 'M') cur.m = value;
      else if (code === 'N') cur.n = value;
      else if (code === '$') cur.splits.push(value);
    }
    if (cur.d !== undefined || cur.t !== undefined) {
      if (raws.length >= options.maxRows) return failed('QIF', 'IMPORT_TOO_MANY_ROWS', null);
      raws.push(cur);
    }
    if (!seenType) return failed('QIF', 'IMPORT_PARSE_FAILED', 'type');

    const { accountCurrency: code, currencyScale: scale } = options;
    const dates = raws.map((r) =>
      r.d === undefined ? ({ kind: 'INVALID' } as const) : parseQifDate(r.d, options.dateOrder),
    );
    const ambiguous = dates.some((d) => d.kind === 'AMBIGUOUS');

    const records: StatementRecord[] = raws.map((r, idx) => {
      const issues = [];
      const date = dates[idx] as ParsedDate;
      if (date.kind === 'INVALID') issues.push(error('IMPORT_INVALID_DATE'));
      let amount = r.t === undefined ? null : canonicalSignedAmount(r.t, code, scale);
      if (amount === null) issues.push(error('IMPORT_INVALID_AMOUNT'));
      if (amount !== null && r.splits.length > 0) {
        const parts = r.splits.map((s) => canonicalSignedAmount(s, code, scale));
        const sum = parts.every((p): p is string => p !== null)
          ? Money.sum(
              parts.map((p) => Money.parse(p, code, scale)),
              { code, scale },
            )
          : null;
        if (sum === null || !sum.equals(Money.parse(amount, code, scale))) {
          issues.push(error('IMPORT_INVALID_AMOUNT'));
          amount = null;
        }
      }
      const description = joinDescription(r.p, r.m);
      if (description.truncated) issues.push(warning('IMPORT_DESCRIPTION_TRUNCATED'));
      return {
        ...emptyRecord(idx + 1),
        // Sin orden elegido ninguna fila lleva fecha: no se interpreta lo ambiguo (decisión del requirement).
        bookingDate: !ambiguous && date.kind === 'OK' ? date.date : null,
        amount,
        description: description.text,
        reference: r.n?.trim() || null,
        counterparty: r.p?.trim() || null,
        issues,
      };
    });
    return {
      format: 'QIF',
      records,
      statement: null,
      declaredCurrency: null,
      failure: null,
      needsMapping: ambiguous ? [{ code: 'IMPORT_AMBIGUOUS_DATE' }] : [],
    };
  }
}
