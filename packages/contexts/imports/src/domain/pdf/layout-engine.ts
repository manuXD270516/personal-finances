import { parsePdfDate } from './date-grammar.js';
import type { ColumnRole, PdfLayout, PdfLayoutColumn, PdfLayoutSection } from './layout.js';
import { containsLiteral, normalizeLiteral } from './literals.js';
import { buildLines, typicalHeight, type PdfLine, type PdfWord } from './lines.js';
import type { PdfTextDocument } from './text-document.js';

/**
 * Reconstrucción de la tabla del extracto a partir de las coordenadas (openspec add-pdf-statement-parser decisiones
 * 7 y 8). Puro: opera sobre `PdfTextDocument` y un `PdfLayout`. Entrega filas con el texto CRUDO de cada celda; la
 * interpretación de montos y fechas, los saldos y la coherencia son de `statement-reader.ts`.
 *
 * Reglas: las bandas de columna salen de los rótulos del encabezado de la tabla de CADA página; una palabra que cruza
 * el límite de dos bandas no se asigna por aproximación (fila con `ambiguous`); las filas conservan el orden impreso
 * (nunca se ordenan por fecha); toda línea con contenido de monto o fecha que no encaja es «no reconocida».
 */
export interface RawRow {
  /** Página y línea (de la página) donde empieza el movimiento. */
  readonly page: number;
  readonly line: number;
  readonly section: string | null;
  readonly date: string | null;
  readonly time: string | null;
  readonly description: string;
  readonly counterparty: string | null;
  readonly amount: string | null;
  readonly debit: string | null;
  readonly credit: string | null;
  readonly balance: string | null;
  readonly reference: string | null;
  /** Alguna palabra de la fila cruza el límite de dos columnas. */
  readonly ambiguous: boolean;
}

export interface LineRef {
  readonly page: number;
  readonly line: number;
}

export interface EngineResult {
  readonly rows: readonly RawRow[];
  readonly unrecognized: readonly LineRef[];
  readonly pagesRead: number;
  /** Se encontró al menos un encabezado de tabla. */
  readonly tableFound: boolean;
  /** Celda de saldo de una `skipRow` (saldo anterior), texto crudo. */
  readonly skipBalances: readonly { readonly description: string; readonly value: string }[];
  /** Total impreso de cada sección (texto crudo del monto). */
  readonly sectionTotals: readonly { readonly id: string; readonly value: string | null }[];
}

interface Band {
  readonly column: PdfLayoutColumn;
  readonly lo: number;
  readonly hi: number;
}

type Cells = Partial<Record<ColumnRole, string[]>>;

interface LineCells {
  readonly line: PdfLine;
  readonly cells: Cells;
  readonly ambiguous: boolean;
}

const EPS = 0.5;
const DEFAULT_RIGHT_SLACK_EM = 4;

function findHeader(
  line: PdfLine,
  columns: readonly PdfLayoutColumn[],
): { readonly column: PdfLayoutColumn; readonly word: PdfWord }[] | null {
  const used = new Set<PdfWord>();
  const found: { column: PdfLayoutColumn; word: PdfWord }[] = [];
  for (const column of columns) {
    const labels = column.labels.map(normalizeLiteral);
    const word = line.words.find((w) => !used.has(w) && labels.includes(w.normalized));
    if (!word) return null;
    used.add(word);
    found.push({ column, word });
  }
  return found;
}

/** Bandas de columna desde los rótulos (decisión 7, paso 3). */
function buildBands(
  header: readonly { column: PdfLayoutColumn; word: PdfWord }[],
  h: number,
  rightSlackEm: number,
): Band[] {
  const ordered = [...header].sort((a, b) => a.word.left - b.word.left);
  return ordered.map((entry, i) => {
    const next = ordered[i + 1];
    const prev = ordered[i - 1];
    let lo = Number.NEGATIVE_INFINITY;
    let hi = Number.POSITIVE_INFINITY;
    if (prev) lo = boundary(prev, entry, h, rightSlackEm);
    if (next) hi = boundary(entry, next, h, rightSlackEm);
    return { column: entry.column, lo, hi };
  });
}

function boundary(
  left: { column: PdfLayoutColumn; word: PdfWord },
  right: { column: PdfLayoutColumn; word: PdfWord },
  h: number,
  rightSlackEm: number,
): number {
  if (right.column.align === 'LEFT') return right.word.left;
  if (left.column.align === 'RIGHT') return left.word.right + 0.5 * h;
  // LEFT seguido de RIGHT: los montos pueden ser más anchos que su rótulo y extenderse hacia la izquierda.
  return right.word.left - rightSlackEm * h;
}

function bandIndex(bands: readonly Band[], x: number): number {
  const i = bands.findIndex((b) => x < b.hi);
  return i === -1 ? bands.length - 1 : i;
}

function cellsOf(line: PdfLine, bands: readonly Band[]): LineCells {
  const cells: Cells = {};
  let ambiguous = false;
  for (const word of line.words) {
    // La palabra cabe en una banda si su inicio y su fin caen en la misma; si no, no se asigna por aproximación.
    const first = bandIndex(bands, word.left + EPS);
    const last = bandIndex(bands, word.right - EPS);
    if (first !== last) {
      ambiguous = true;
      continue;
    }
    const role = (bands[first] as Band).column.role;
    const list = cells[role] ?? [];
    list.push(word.text);
    cells[role] = list;
  }
  return { line, cells, ambiguous };
}

const cell = (c: Cells, role: ColumnRole): string | null => {
  const v = c[role];
  return v && v.length > 0 ? v.join(' ') : null;
};

const hasMoney = (c: Cells): boolean =>
  (['AMOUNT', 'DEBIT', 'CREDIT', 'BALANCE'] as const).some((r) => cell(c, r) !== null);

const hasAny = (c: Cells): boolean =>
  (['DATE', 'TIME', 'DESCRIPTION', 'AMOUNT', 'DEBIT', 'CREDIT', 'BALANCE', 'REFERENCE'] as const).some(
    (r) => cell(c, r) !== null,
  );

const startsWithAny = (normalized: string, literals: readonly string[] | undefined): boolean =>
  (literals ?? []).some((l) => normalized.startsWith(normalizeLiteral(l)));

const containsAny = (normalized: string, literals: readonly string[] | undefined): boolean =>
  (literals ?? []).some((l) => containsLiteral(normalized, normalizeLiteral(l)));

/** Última cifra con forma de monto de la línea (total impreso de una sección). */
function trailingAmountText(line: PdfLine): string | null {
  const last = line.words[line.words.length - 1];
  if (!last) return null;
  const tokens = last.text.split(' ');
  return tokens[tokens.length - 1] ?? null;
}

interface Draft {
  page: number;
  line: number;
  section: string | null;
  date: string | null;
  time: string | null;
  description: string[];
  counterparty: string[];
  inCounterparty: boolean;
  amount: string | null;
  debit: string | null;
  credit: string | null;
  balance: string | null;
  reference: string[];
  ambiguous: boolean;
}

const newDraft = (page: number, line: number, section: string | null): Draft => ({
  page,
  line,
  section,
  date: null,
  time: null,
  description: [],
  counterparty: [],
  inCounterparty: false,
  amount: null,
  debit: null,
  credit: null,
  balance: null,
  reference: [],
  ambiguous: false,
});

function joinReference(parts: readonly string[]): string | null {
  if (parts.length === 0) return null;
  let out = '';
  for (const part of parts) out += out === '' ? part : out.endsWith('-') ? part : ` ${part}`;
  return out;
}

function toRow(d: Draft): RawRow {
  return {
    page: d.page,
    line: d.line,
    section: d.section,
    date: d.date,
    time: d.time,
    description: d.description.join(' ').trim(),
    counterparty: d.counterparty.length > 0 ? d.counterparty.join(' ').trim() : null,
    amount: d.amount,
    debit: d.debit,
    credit: d.credit,
    balance: d.balance,
    reference: joinReference(d.reference),
    ambiguous: d.ambiguous,
  };
}

/** Agrega las celdas de una línea a un movimiento (glosa en el orden de lectura, contraparte aparte). */
function absorb(d: Draft, lc: LineCells, layout: PdfLayout): void {
  const c = lc.cells;
  if (lc.ambiguous) d.ambiguous = true;
  d.date ??= cell(c, 'DATE');
  d.time ??= cell(c, 'TIME');
  d.amount ??= cell(c, 'AMOUNT');
  d.debit ??= cell(c, 'DEBIT');
  d.credit ??= cell(c, 'CREDIT');
  d.balance ??= cell(c, 'BALANCE');
  const ref = cell(c, 'REFERENCE');
  if (ref !== null) d.reference.push(ref);
  const desc = cell(c, 'DESCRIPTION');
  if (desc !== null) {
    const norm = normalizeLiteral(desc);
    if (startsWithAny(norm, layout.table.dropLinePrefixes)) return;
    if (d.inCounterparty || startsWithAny(norm, layout.table.counterpartyStarts)) {
      d.inCounterparty = true;
      d.counterparty.push(desc);
    } else {
      d.description.push(desc);
    }
  }
}

export function runLayoutEngine(doc: PdfTextDocument, layout: PdfLayout): EngineResult {
  const rows: RawRow[] = [];
  const unrecognized: LineRef[] = [];
  const skipBalances: { description: string; value: string }[] = [];
  const sectionTotals = new Map<string, string | null>();
  const sections = layout.table.sections ?? [];
  const anchorByAmount = layout.table.rowAnchor === 'AMOUNT';
  let bands: Band[] | null = null;
  let tableFound = false;
  let currentSection: PdfLayoutSection | null = null;
  let open: Draft | null = null;
  // Anclas por monto (BNB): las líneas de cada página/sección se atribuyen al final.
  const pending: { page: number; section: string | null; lcs: LineCells[] }[] = [];

  const close = (): void => {
    if (open !== null) rows.push(toRow(open));
    open = null;
  };

  for (const page of doc.pages) {
    const lines = buildLines(page);
    const h = typicalHeight(page);
    let headerSeen = false;
    let ended = false;
    let group: { page: number; section: string | null; lcs: LineCells[] } | null = null;

    for (const line of lines) {
      const header = headerSeen ? null : findHeader(line, layout.table.columns);
      if (header) {
        bands = buildBands(header, h, layout.table.rightSlackEm ?? DEFAULT_RIGHT_SLACK_EM);
        headerSeen = true;
        tableFound = true;
        continue;
      }
      // Secciones: el rótulo de inicio puede ir antes del encabezado de la tabla.
      const start = sections.find((s) => line.normalized === normalizeLiteral(s.startLabel));
      if (start) {
        close();
        currentSection = start;
        group = null;
        continue;
      }
      const total = sections.find((s) => line.normalized.startsWith(normalizeLiteral(s.totalLabel)));
      if (total) {
        close();
        sectionTotals.set(total.id, trailingAmountText(line));
        if (currentSection?.id === total.id) currentSection = null;
        group = null;
        continue;
      }
      // Sin encabezado propio la página reutiliza las bandas de la anterior; antes de la primera tabla no hay nada que leer.
      if (bands === null || ended) continue;
      if (containsAny(line.normalized, layout.page.discardLiterals)) continue;
      if (containsAny(line.normalized, layout.page.blankPageLiterals)) continue;
      if (startsWithAny(line.normalized, layout.page.repeatedLiterals)) continue;
      if (startsWithAny(line.normalized, layout.page.footerLiterals)) continue;
      if (containsAny(line.normalized, layout.table.endLabels)) {
        close();
        ended = true;
        continue;
      }
      const lc = cellsOf(line, bands);
      if (!hasAny(lc.cells) && !lc.ambiguous) continue;

      const description = cell(lc.cells, 'DESCRIPTION');
      const skip =
        description === null
          ? undefined
          : (layout.table.skipRows ?? []).find(
              (s) => normalizeLiteral(description) === normalizeLiteral(s.description),
            );
      if (skip) {
        close();
        const value = cell(lc.cells, 'BALANCE');
        if (value !== null) skipBalances.push({ description: skip.description, value });
        continue;
      }

      if (anchorByAmount) {
        if (group === null) {
          group = { page: page.number, section: currentSection?.id ?? null, lcs: [] };
          pending.push(group);
        }
        group.lcs.push(lc);
        continue;
      }

      // Ancla por fecha: abre un movimiento una línea cuya celda de fecha tiene forma de fecha.
      const dateText = cell(lc.cells, 'DATE');
      const isAnchor = dateText !== null && parsePdfDate(dateText, layout.date).kind !== 'NOT_DATE';
      if (isAnchor) {
        close();
        open = newDraft(page.number, line.index, currentSection?.id ?? null);
        absorb(open, lc, layout);
      } else if (
        open !== null &&
        !hasMoney(lc.cells) &&
        cell(lc.cells, 'DATE') === null &&
        cell(lc.cells, 'TIME') === null
      ) {
        // Continuación de glosa o de referencia (también al inicio de una página, tras el salto).
        absorb(open, lc, layout);
      } else {
        unrecognized.push({ page: page.number, line: line.index });
      }
    }
  }
  close();

  if (anchorByAmount) {
    for (const g of pending) {
      const result = attributeByAmount(g.lcs, g.section, g.page, layout);
      rows.push(...result.rows);
      unrecognized.push(...result.unrecognized);
    }
    rows.sort((a, b) => a.page - b.page || a.line - b.line);
  }

  return {
    rows,
    unrecognized,
    pagesRead: doc.pages.length,
    tableFound,
    skipBalances,
    sectionTotals: sections.map((s) => ({ id: s.id, value: sectionTotals.get(s.id) ?? null })),
  };
}

/**
 * Ancla por monto (decisión 7, paso 5): las líneas del bloque (página y sección) se atribuyen al ancla más cercana en
 * vertical; la fecha, la hora, la glosa y la referencia de las líneas vecinas se asignan a su movimiento. Las líneas
 * se ordenan por posición: el orden de dibujo no importa.
 */
function attributeByAmount(
  lcs: readonly LineCells[],
  section: string | null,
  page: number,
  layout: PdfLayout,
): { rows: RawRow[]; unrecognized: LineRef[] } {
  const anchors = lcs.filter((lc) => cell(lc.cells, 'AMOUNT') !== null);
  const unrecognized: LineRef[] = [];
  if (anchors.length === 0) {
    return { rows: [], unrecognized: lcs.map((lc) => ({ page, line: lc.line.index })) };
  }
  const drafts = anchors.map((a) => ({
    anchor: a,
    draft: newDraft(page, a.line.index, section),
    lines: [] as LineCells[],
  }));
  for (const lc of lcs) {
    let best = drafts[0] as (typeof drafts)[number];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const d of drafts) {
      const distance = Math.abs(d.anchor.line.y - lc.line.y);
      if (distance < bestDistance) {
        best = d;
        bestDistance = distance;
      }
    }
    best.lines.push(lc);
  }
  const rows: RawRow[] = [];
  for (const d of drafts) {
    const ordered = [...d.lines].sort((a, b) => a.line.y - b.line.y || a.line.index - b.line.index);
    // Una sola línea con fecha de la forma del diseño y una sola con hora: las que sobran son líneas sueltas.
    for (const lc of ordered) {
      const dateText = cell(lc.cells, 'DATE');
      const timeText = cell(lc.cells, 'TIME');
      const badDate = dateText !== null && d.draft.date !== null && lc !== d.anchor;
      const badTime = timeText !== null && d.draft.time !== null && lc !== d.anchor;
      if (badDate || badTime) {
        unrecognized.push({ page, line: lc.line.index });
        continue;
      }
      absorb(d.draft, lc, layout);
    }
    rows.push(toRow(d.draft));
  }
  return { rows, unrecognized };
}
