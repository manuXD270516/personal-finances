import { parsePdfDate, parseLongDate, parseMonthYear } from './date-grammar.js';
import type { BalanceSource, PdfLayout } from './layout.js';
import { normalizeLiteral } from './literals.js';
import { buildLines, type PdfLine } from './lines.js';
import { parsePdfNumber } from './number-grammar.js';
import type { PdfTextDocument } from './text-document.js';

/**
 * Encabezado del extracto (decisión 11): del encabezado SOLO salen la moneda, los saldos, el periodo, el total de
 * páginas y los últimos 4 dígitos del número de cuenta. Titular, dirección, operador, sucursal, canal y el número
 * completo se descartan aquí y nunca llegan al resto del sistema.
 */
export interface PdfStatementHeader {
  readonly currency: string | null;
  readonly accountLast4: string | null;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  /** Saldo del encabezado (texto crudo del número) o `null`. */
  readonly openingText: string | null;
  readonly closingText: string | null;
  readonly totalDebitsText: string | null;
  readonly totalCreditsText: string | null;
  /** Total de páginas declarado por el extracto. */
  readonly pagesDeclared: number | null;
}

export type Candidates = readonly string[];

/** Valores candidatos a la derecha de un rótulo: el resto de la misma palabra y la palabra siguiente. */
function labelCandidates(lines: readonly PdfLine[], label: string): Candidates[] {
  const wanted = normalizeLiteral(label);
  const labelTokens = label.trim().split(/\s+/u).length;
  const found: string[][] = [];
  for (const line of lines) {
    line.words.forEach((word, i) => {
      if (word.normalized !== wanted && !word.normalized.startsWith(`${wanted} `)) return;
      const out: string[] = [];
      const remainder = word.text.split(' ').slice(labelTokens).join(' ').trim();
      if (remainder !== '') out.push(remainder);
      const next = line.words[i + 1];
      if (next) out.push(next.text);
      found.push(out);
    });
  }
  return found;
}

const digitsOnly = (s: string): string => [...s].filter((c) => c >= '0' && c <= '9').join('');

function pickNumber(c: Candidates, layout: PdfLayout, scale: number): string | null {
  for (const candidate of c) {
    const parsed = parsePdfNumber(candidate, layout.number, scale);
    if (parsed.kind === 'OK' || parsed.kind === 'SCALE') return candidate;
  }
  return null;
}

function balanceText(
  source: BalanceSource | undefined,
  lines: readonly PdfLine[],
  layout: PdfLayout,
  scale: number,
): string | null {
  if (!source || source.kind !== 'LABEL') return null;
  const all = labelCandidates(lines, source.label).map((c) => pickNumber(c, layout, scale));
  const values = all.filter((v): v is string => v !== null);
  if (values.length === 0) return null;
  return source.occurrence === 'LAST' ? (values[values.length - 1] as string) : (values[0] as string);
}

function periodOf(layout: PdfLayout, lines: readonly PdfLine[]): { from: string; to: string } | null {
  const source = layout.header.period;
  if (!source) return null;
  if (source.kind === 'MONTH_YEAR') {
    for (const c of labelCandidates(lines, source.label)) {
      for (const candidate of c) {
        const month = parseMonthYear(candidate);
        if (month) return month;
      }
    }
    return null;
  }
  for (const line of lines) {
    for (const word of line.words) {
      if (source.kind === 'LONG_DATE_RANGE') {
        const text = word.text.trim();
        const at = normalizeLiteral(text).indexOf(' al ');
        if (!normalizeLiteral(text).startsWith('del ') || at < 0) continue;
        const from = parseLongDate(text.slice(4, at));
        const to = parseLongDate(text.slice(at + 4));
        if (from && to) return { from, to };
      } else {
        const dates: string[] = [];
        for (const token of word.text.split(/\s+/u)) {
          const direct = parsePdfDate(token, layout.date);
          if (direct.kind === 'OK') dates.push(direct.iso);
          else if (token.length === 21 && token[10] === '-') {
            for (const part of [token.slice(0, 10), token.slice(11)]) {
              const d = parsePdfDate(part, layout.date);
              if (d.kind === 'OK') dates.push(d.iso);
            }
          }
        }
        if (dates.length >= 2) return { from: dates[0] as string, to: dates[1] as string };
      }
    }
  }
  return null;
}

function pagesDeclared(layout: PdfLayout, perPage: readonly (readonly PdfLine[])[]): number | null {
  const source = layout.header.totalPages;
  if (!source) return null;
  const all = perPage.flat();
  if (source.kind === 'LABEL') {
    for (const c of labelCandidates(all, source.label)) {
      for (const candidate of c) {
        const t = candidate.trim();
        if (t !== '' && [...t].every((ch) => ch >= '0' && ch <= '9')) return Number(t);
      }
    }
    return null;
  }
  // `Página N de M`.
  for (const line of all) {
    for (const word of line.words) {
      const tokens = word.normalized.split(' ');
      if (tokens.length === 4 && tokens[0] === 'pagina' && tokens[2] === 'de') {
        const m = tokens[3] as string;
        if ([...m].every((ch) => ch >= '0' && ch <= '9')) return Number(m);
      }
    }
  }
  return null;
}

export function readStatementHeader(
  doc: PdfTextDocument,
  layout: PdfLayout,
  scale: number,
): PdfStatementHeader {
  const perPage = doc.pages.map((p) => buildLines(p));
  const all = perPage.flat();
  const first = perPage[0] ?? [];

  let currency: string | null = null;
  const labels = layout.currencyLabels.map((c) => ({
    label: normalizeLiteral(c.label),
    currency: c.currency,
  }));
  outer: for (const line of first) {
    for (const word of line.words) {
      const hit = labels.find((l) => l.label === word.normalized);
      if (hit) {
        currency = hit.currency;
        break outer;
      }
    }
  }

  let accountLast4: string | null = null;
  if (layout.header.account) {
    for (const c of labelCandidates(first, layout.header.account.label)) {
      const digits = c.map(digitsOnly).find((d) => d.length >= 4);
      if (digits) {
        accountLast4 = digits.slice(-4);
        break;
      }
    }
  }

  const period = periodOf(layout, first);
  return {
    currency,
    accountLast4,
    periodFrom: period?.from ?? null,
    periodTo: period?.to ?? null,
    openingText: balanceText(layout.header.openingBalance, all, layout, scale),
    closingText: balanceText(layout.header.closingBalance, all, layout, scale),
    totalDebitsText: layout.header.totalDebits
      ? balanceText({ kind: 'LABEL', label: layout.header.totalDebits.label }, all, layout, scale)
      : null,
    totalCreditsText: layout.header.totalCredits
      ? balanceText({ kind: 'LABEL', label: layout.header.totalCredits.label }, all, layout, scale)
      : null,
    pagesDeclared: pagesDeclared(layout, perPage),
  };
}
