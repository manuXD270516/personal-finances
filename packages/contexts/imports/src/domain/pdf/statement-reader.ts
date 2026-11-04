import { dec, type Decimal } from '@pf/shared-kernel';
import { normalizeDescription } from '../row-normalizer.js';
import type { StatementBalance, StatementRecord } from '../statement.js';
import type { RowIssue } from '../types.js';
import { parsePdfDate, parsePdfTime } from './date-grammar.js';
import { runLayoutEngine, type EngineResult, type LineRef, type RawRow } from './layout-engine.js';
import type { PdfLayout, PdfLayoutRef } from './layout.js';
import { buildLines } from './lines.js';
import { containsLiteral, normalizeLiteral } from './literals.js';
import { parsePdfNumber } from './number-grammar.js';
import { readStatementHeader, type PdfStatementHeader } from './statement-header.js';
import type { PdfTextDocument } from './text-document.js';

/**
 * Lectura de un extracto PDF (openspec add-pdf-statement-parser decisiones 7–13): detección del diseño, páginas sin
 * texto, reconstrucción, interpretación exacta de montos y fechas, saldos del extracto y coherencia con FALLA
 * CERRADA (D347): si lo leído no cuadra con lo que el propio extracto declara, no hay vista previa. Puro y sin
 * datos del titular: del encabezado solo se conservan moneda, saldos, periodo, páginas y 4 dígitos de la cuenta.
 */
export type PdfFailureCode =
  | 'IMPORT_PDF_NO_TEXT'
  | 'IMPORT_PDF_LAYOUT_UNKNOWN'
  | 'IMPORT_PDF_PAGE_COUNT_MISMATCH'
  | 'IMPORT_PDF_TOTALS_MISMATCH';

export interface PdfCoherence {
  readonly totals: 'OK' | 'MISMATCH' | 'NOT_AVAILABLE';
  /** Valor absoluto de la primera diferencia numérica encontrada (texto decimal), o `null`. */
  readonly difference: string | null;
  readonly runningBalance: 'OK' | 'GAPS' | 'NOT_AVAILABLE';
  readonly recognizedRows: number;
  /** Páginas y números de línea (sin textos). */
  readonly unrecognizedLines: readonly LineRef[];
  /** Resultado de cada verificación (sin valores): solo para el diagnóstico local. */
  readonly checks: readonly { readonly check: string; readonly status: 'OK' | 'MISMATCH' | 'MISSING' }[];
}

export interface PdfReadInfo {
  readonly layout: PdfLayoutRef | null;
  readonly pagesRead: number;
  readonly pagesDeclared: number | null;
  readonly pagesWithoutText: readonly number[];
  readonly coherence: PdfCoherence | null;
  /** Últimos 4 dígitos del número de cuenta del encabezado (nunca el número completo). */
  readonly accountLast4: string | null;
  readonly currency: string | null;
}

export type PdfReadResult =
  | {
      readonly ok: true;
      readonly records: readonly StatementRecord[];
      readonly statement: StatementBalance;
      readonly info: PdfReadInfo;
    }
  | { readonly ok: false; readonly code: PdfFailureCode; readonly info: PdfReadInfo };

export interface PdfReadOptions {
  /** Escala de la moneda de la cuenta (decimales máximos de un monto). */
  readonly scale: number;
  readonly maxRows: number;
}

const issue = (
  code: RowIssue['code'],
  severity: RowIssue['severity'] = 'ERROR',
  detail?: string,
): RowIssue => (detail === undefined ? { code, severity } : { code, severity, detail });

/** Páginas con menos de `minChars` caracteres no blancos que no son una página en blanco declarada (decisión 13). */
export function findPagesWithoutText(
  doc: PdfTextDocument,
  minChars: number,
  blankLiterals: readonly string[],
): number[] {
  const blank = blankLiterals.map(normalizeLiteral);
  const out: number[] = [];
  for (const page of doc.pages) {
    const text = page.items.map((i) => i.text).join(' ');
    const count = [...text].filter((c) => c.trim() !== '').length;
    if (count >= minChars) continue;
    if (blank.some((b) => containsLiteral(normalizeLiteral(text), b))) continue;
    out.push(page.number);
  }
  return out;
}

/** Los literales fijos de la primera página están todos (comparados sin mayúsculas ni acentos). */
export function layoutMatches(doc: PdfTextDocument, layout: PdfLayout): boolean {
  const first = doc.pages[0];
  if (!first) return false;
  // El texto sale de las líneas reconstruidas por posición: el orden del flujo de contenido no cuenta.
  const text = normalizeLiteral(
    buildLines(first)
      .map((l) => l.text)
      .join(' '),
  );
  // Los fragmentos pueden venir partidos: se compara también sin espacios.
  const compact = text.replace(/\s+/gu, '');
  return layout.detect.literals.every((l) => {
    const n = normalizeLiteral(l);
    return containsLiteral(text, n) || containsLiteral(compact, n.replace(/\s+/gu, ''));
  });
}

/** Elige el diseño por sus literales (la versión más reciente primero); el primero que reconstruye una tabla gana. */
export function detectLayout(doc: PdfTextDocument, candidates: readonly PdfLayout[]): PdfLayout | null {
  const ordered = [...candidates].sort((a, b) =>
    a.id === b.id ? b.version - a.version : a.id < b.id ? -1 : 1,
  );
  for (const layout of ordered) {
    if (!layoutMatches(doc, layout)) continue;
    const engine = runLayoutEngine(doc, layout);
    if (engine.tableFound) return layout;
  }
  return null;
}

const ZERO = dec('0');

export interface BuiltRow {
  readonly record: StatementRecord;
  /** Importe exacto con signo para la coherencia; `null` si la fila no se pudo leer. */
  readonly exact: Decimal | null;
}

export function buildStatementRow(
  row: RawRow,
  position: number,
  layout: PdfLayout,
  scale: number,
  currency: string | null,
): BuiltRow {
  const issues: RowIssue[] = [];
  const detail = `p${row.page}:l${row.line}`;
  if (row.ambiguous) issues.push(issue('IMPORT_PDF_AMBIGUOUS_CELL', 'ERROR', detail));

  let bookingDate: string | null = null;
  if (row.date !== null) {
    const parsed = parsePdfDate(row.date, layout.date);
    if (parsed.kind === 'OK') bookingDate = parsed.iso;
  }
  if (bookingDate === null) issues.push(issue('IMPORT_INVALID_DATE'));
  const time = row.time === null ? null : parsePdfTime(row.time, layout.time);

  // Monto: columna con signo, o crédito − débito, o el signo de la sección.
  let amount: string | null = null;
  let exact: Decimal | null = null;
  const number = (text: string | null, flag: boolean): { value: string; exact: Decimal } | null => {
    if (text === null) return { value: ZERO.toFixed(scale), exact: ZERO };
    const p = parsePdfNumber(text, layout.number, scale);
    if (p.kind === 'OK') return { value: p.value, exact: dec(p.exact) };
    if (flag)
      issues.push(issue(p.kind === 'AMBIGUOUS' ? 'IMPORT_AMBIGUOUS_NUMBER' : 'IMPORT_INVALID_AMOUNT'));
    if (p.kind === 'SCALE') return { value: '', exact: dec(p.exact) };
    return null;
  };
  const section = row.section === null ? undefined : layout.table.sections?.find((s) => s.id === row.section);
  if (row.amount !== null) {
    const n = number(row.amount, true);
    if (n !== null) {
      if (section !== undefined) {
        // El monto de una sección se imprime sin signo: el signo es el de la sección.
        if (n.exact.isNegative()) {
          issues.push(issue('IMPORT_INVALID_AMOUNT'));
        } else {
          exact = section.sign === 'DEBIT' ? n.exact.negated() : n.exact;
          if (n.value !== '') amount = section.sign === 'DEBIT' ? negate(n.value) : n.value;
        }
      } else {
        exact = n.exact;
        if (n.value !== '') amount = n.value;
      }
    }
  } else if (row.debit !== null || row.credit !== null) {
    const debit = number(row.debit, true);
    const credit = number(row.credit, true);
    if (debit !== null && credit !== null) {
      exact = credit.exact.minus(debit.exact);
      if (!debit.exact.isZero() && !credit.exact.isZero()) {
        issues.push(issue('IMPORT_PDF_BOTH_DEBIT_AND_CREDIT'));
      } else if (debit.value !== '' && credit.value !== '') {
        amount = credit.exact.minus(debit.exact).toFixed(scale);
      }
    }
  } else {
    issues.push(issue('IMPORT_INVALID_AMOUNT'));
  }
  if (
    amount === null &&
    !issues.some(
      (i) =>
        i.code === 'IMPORT_INVALID_AMOUNT' ||
        i.code === 'IMPORT_AMBIGUOUS_NUMBER' ||
        i.code === 'IMPORT_PDF_BOTH_DEBIT_AND_CREDIT',
    )
  ) {
    issues.push(issue('IMPORT_INVALID_AMOUNT'));
  }

  let runningBalance: string | null = null;
  if (row.balance !== null) {
    const p = parsePdfNumber(row.balance, layout.number, scale);
    if (p.kind === 'OK') runningBalance = p.value;
  }
  const description = normalizeDescription(row.description);
  if (description.truncated) issues.push(issue('IMPORT_DESCRIPTION_TRUNCATED', 'WARNING'));
  const counterparty = row.counterparty === null ? null : normalizeDescription(row.counterparty).text;
  return {
    // Una celda ambigua es un monto que el lector no pudo leer: no cuenta como leído en la coherencia.
    exact: row.ambiguous ? null : exact,
    record: {
      line: position,
      bookingDate,
      time,
      valueDate: null,
      amount,
      currency,
      description: description.text,
      externalId: layout.reference.unique ? row.reference : null,
      reference: row.reference,
      counterparty,
      runningBalance,
      issues,
    },
  };
}

const negate = (value: string): string => (value.startsWith('-') ? value.slice(1) : `-${value}`);

function parseHeaderNumber(text: string | null, layout: PdfLayout, scale: number): Decimal | null {
  if (text === null) return null;
  const p = parsePdfNumber(text, layout.number, scale);
  return p.kind === 'OK' || p.kind === 'SCALE' ? dec(p.exact) : null;
}

export function readPdfStatement(
  doc: PdfTextDocument,
  layout: PdfLayout,
  options: PdfReadOptions,
): PdfReadResult {
  const ref: PdfLayoutRef = { id: layout.id, version: layout.version };
  const header = readStatementHeader(doc, layout, options.scale);
  const engine = runLayoutEngine(doc, layout);
  const baseInfo = (extra: Partial<PdfReadInfo> = {}): PdfReadInfo => ({
    layout: ref,
    pagesRead: engine.pagesRead,
    pagesDeclared: header.pagesDeclared,
    pagesWithoutText: [],
    coherence: null,
    accountLast4: header.accountLast4,
    currency: header.currency,
    ...extra,
  });

  if (!engine.tableFound) {
    return { ok: false, code: 'IMPORT_PDF_LAYOUT_UNKNOWN', info: baseInfo() };
  }
  if (header.pagesDeclared !== null && header.pagesDeclared !== engine.pagesRead) {
    return { ok: false, code: 'IMPORT_PDF_PAGE_COUNT_MISMATCH', info: baseInfo() };
  }

  const built = engine.rows.map((row, i) =>
    buildStatementRow(row, i + 1, layout, options.scale, header.currency),
  );
  const records = built.map((b) => b.record);
  const coherence = checkCoherence(engine, built, header, layout, options.scale);

  if (coherence.totals === 'MISMATCH') {
    return { ok: false, code: 'IMPORT_PDF_TOTALS_MISMATCH', info: baseInfo({ coherence }) };
  }

  const opening = openingOf(engine, header, layout, options.scale);
  const closing = parseHeaderNumber(header.closingText, layout, options.scale);
  return {
    ok: true,
    records,
    statement: {
      openingBalance: opening === null ? null : opening.toFixed(options.scale),
      closingBalance: closing === null ? null : closing.toFixed(options.scale),
      closingDate: header.periodTo,
      periodFrom: header.periodFrom,
      periodTo: header.periodTo,
    },
    info: baseInfo({ coherence }),
  };
}

function openingOf(
  engine: EngineResult,
  header: PdfStatementHeader,
  layout: PdfLayout,
  scale: number,
): Decimal | null {
  const source = layout.header.openingBalance;
  if (source?.kind === 'SKIP_ROW') {
    const wanted = normalizeLiteral(source.description);
    const hit = engine.skipBalances.find((s) => normalizeLiteral(s.description) === wanted);
    return parseHeaderNumber(hit?.value ?? null, layout, scale);
  }
  return parseHeaderNumber(header.openingText, layout, scale);
}

function checkCoherence(
  engine: EngineResult,
  built: readonly BuiltRow[],
  header: PdfStatementHeader,
  layout: PdfLayout,
  scale: number,
): PdfCoherence {
  const unrecognizedLines = engine.unrecognized;
  const recognizedRows = built.length;
  let mismatch = unrecognizedLines.length > 0 || built.some((b) => b.exact === null);
  let difference: string | null = null;
  let evaluated = false;
  const checks: { check: string; status: 'OK' | 'MISMATCH' | 'MISSING' }[] = [];
  const note = (check: string, diff: Decimal): void => {
    if (!diff.isZero()) {
      mismatch = true;
      difference ??= diff.abs().toFixed(scale);
    }
    checks.push({ check, status: diff.isZero() ? 'OK' : 'MISMATCH' });
  };
  const missing = (check: string): void => {
    mismatch = true;
    checks.push({ check, status: 'MISSING' });
  };

  const exacts = built.map((b) => b.exact).filter((e): e is Decimal => e !== null);
  const total = exacts.reduce((acc, e) => acc.plus(e), ZERO);

  const declaresOpening = layout.header.openingBalance !== undefined;
  const declaresClosing = layout.header.closingBalance !== undefined;
  if (declaresOpening && declaresClosing) {
    evaluated = true;
    const opening = openingOf(engine, header, layout, scale);
    const closing = parseHeaderNumber(header.closingText, layout, scale);
    if (opening === null || closing === null) missing('OPENING_CLOSING');
    else note('OPENING_CLOSING', opening.plus(total).minus(closing));
  }

  for (const section of layout.table.sections ?? []) {
    const inSection = built.filter((b, i) => engine.rows[i]?.section === section.id);
    const printed = engine.sectionTotals.find((s) => s.id === section.id)?.value ?? null;
    if (inSection.length === 0 && printed === null) continue;
    evaluated = true;
    const printedValue = parseHeaderNumber(printed, layout, scale);
    if (printedValue === null) {
      missing(`SECTION_${section.id}`);
      continue;
    }
    const sum = inSection.reduce((acc, b) => acc.plus(b.exact === null ? ZERO : b.exact.abs()), ZERO);
    note(`SECTION_${section.id}`, sum.minus(printedValue));
  }

  const debits = exacts.filter((e) => e.isNegative()).reduce((acc, e) => acc.plus(e.abs()), ZERO);
  const credits = exacts.filter((e) => !e.isNegative()).reduce((acc, e) => acc.plus(e), ZERO);
  for (const [name, text, sum, declared] of [
    ['SUMMARY_DEBITS', header.totalDebitsText, debits, layout.header.totalDebits],
    ['SUMMARY_CREDITS', header.totalCreditsText, credits, layout.header.totalCredits],
  ] as const) {
    if (!declared) continue;
    evaluated = true;
    const value = parseHeaderNumber(text, layout, scale);
    if (value === null) missing(name);
    else note(name, sum.minus(value));
  }

  if (
    mismatch &&
    difference === null &&
    (unrecognizedLines.length > 0 || built.some((b) => b.exact === null))
  ) {
    difference = ZERO.toFixed(scale);
  }
  return {
    totals: mismatch ? 'MISMATCH' : evaluated ? 'OK' : 'NOT_AVAILABLE',
    difference,
    runningBalance: runningBalanceState(engine, built, header, layout, scale),
    recognizedRows,
    unrecognizedLines,
    checks: [
      ...checks,
      { check: 'UNRECOGNIZED_LINES', status: unrecognizedLines.length === 0 ? 'OK' : 'MISMATCH' },
    ],
  };
}

function runningBalanceState(
  engine: EngineResult,
  built: readonly BuiltRow[],
  header: PdfStatementHeader,
  layout: PdfLayout,
  scale: number,
): PdfCoherence['runningBalance'] {
  if (!built.some((b) => b.record.runningBalance !== null)) return 'NOT_AVAILABLE';
  let previous = openingOf(engine, header, layout, scale);
  let gaps = false;
  for (const b of built) {
    if (b.record.runningBalance === null || b.exact === null) continue;
    const balance = dec(b.record.runningBalance);
    if (previous !== null && !previous.plus(b.exact).eq(balance)) gaps = true;
    previous = balance;
  }
  return gaps ? 'GAPS' : 'OK';
}
