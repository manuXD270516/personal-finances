import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PdfTextDocument,
  PdfTextItem,
  PdfTextPage,
} from '../../../../../packages/contexts/imports/src/domain/pdf/text-document.js';
import {
  formatPdfNumber,
  type PdfNumberFormat,
} from '../../../../../packages/contexts/imports/src/domain/pdf/number-grammar.js';

/**
 * Pintor de diseños de extractos (openspec add-pdf-statement-parser, tarea 2.1 y decisión 14). Toma el
 * `expected.json` SINTÉTICO de cada entidad más una geometría y dibuja la misma página como un `PdfTextDocument` en
 * memoria (pruebas de dominio) o, con `render-pdf.ts`, como un PDF real (extremo a extremo). Ningún dato real: los
 * nombres, cuentas y montos son los de los fixtures ficticios. Fuente monoespaciada de 8 pt: avance 4,8 pt por carácter.
 */
export type EntityId = 'BCP' | 'GANADERO' | 'BNB';

export interface ExpectedMovement {
  readonly section?: string;
  readonly date: string;
  readonly time: string;
  readonly description: string;
  readonly amount: string;
  readonly balance: string | null;
  readonly reference?: string;
  readonly kind?: string;
  readonly counterparty?: { readonly account: string; readonly name: string; readonly bank: string };
}

export interface ExpectedStatement {
  readonly institution: string;
  readonly currency: string;
  readonly statement: {
    readonly openingBalance: string;
    readonly closingBalance: string;
    readonly periodFrom: string;
    readonly periodTo: string;
  };
  readonly summary?: Record<string, string>;
  readonly sections?: readonly { readonly name: string; readonly total: string }[];
  readonly movements: readonly ExpectedMovement[];
}

const DIR = fileURLToPath(new URL('..', import.meta.url));
const FOLDERS: Record<EntityId, string> = { BCP: 'bcp', GANADERO: 'ganadero', BNB: 'bnb' };

export const loadExpected = (id: EntityId): ExpectedStatement =>
  JSON.parse(readFileSync(resolve(DIR, FOLDERS[id], 'expected.json'), 'utf8')) as ExpectedStatement;

export interface PaintOptions {
  /** Orden de dibujo aleatorio con semilla fija (el orden de lectura no debe importar). */
  readonly shuffleSeed?: number;
  /** Texto dibujado carácter por carácter (los espacios, como separación sin carácter). */
  readonly charByChar?: boolean;
  /** Índices (0-based) de movimientos que no se dibujan (simula un movimiento no leído). */
  readonly drop?: readonly number[];
  /** Total de páginas impreso (`Total Páginas` / `Página N de M`) distinto del real. */
  readonly declaredPages?: number;
  /** Total impreso de una sección (id `DEPOSITS` / `WITHDRAWALS`) distinto del real. */
  readonly sectionTotals?: Readonly<Record<string, string>>;
  /** Texto impreso del monto de una fila (p. ej. `-12.345`). */
  readonly amountText?: Readonly<Record<number, string>>;
  /** El monto de la fila empieza en la columna de descripción y termina en la de débito. */
  readonly crossColumnRow?: number;
  /** Débito y crédito a la vez (Ganadero). */
  readonly bothDebitCredit?: { readonly row: number; readonly debit: string; readonly credit: string };
  /** BNB: la hora va debajo de la glosa (en lugar de en la línea de la fecha). */
  readonly timeBelow?: boolean;
  /** Último dígitos del número de cuenta del encabezado (sustituye al del fixture). */
  readonly accountNumber?: string;
  /** Etiqueta de moneda impresa (`Bolivianos` ⇒ BOB; `$US` ⇒ USD) en lugar de la del fixture. */
  readonly currencyLabel?: string;
  /** Formato numérico de los montos impresos (por omisión, el del banco). */
  readonly number?: PdfNumberFormat;
  /** Fecha de descarga impresa en el encabezado (Ganadero: `Fecha:`); cambia los bytes, no los movimientos. */
  readonly downloadDate?: string;
  /** Filas pegadas (9 pt) para llenar páginas: solo para el benchmark. */
  readonly compact?: boolean;
  /** Alto de página en puntos (por omisión 595); el pie y los totales se ubican respecto del final. */
  readonly pageHeight?: number;
  /** Líneas de la tabla de relleno antes del primer movimiento (para forzar más páginas). */
  readonly extraPageBreakEvery?: number;
  /** Texto de pie que se reemplaza por una página de solo imagen: páginas (1-based) sin texto. */
  readonly blankOutPages?: readonly number[];
}

const SIZE = 8;
const CHAR = 4.8;
const LH = 12;
const PAGE_W = 842;
const PAGE_H = 595;

class Canvas {
  readonly items: PdfTextItem[] = [];
  constructor(private readonly charByChar: boolean) {}

  text(text: string, x: number, y: number): void {
    if (text === '') return;
    if (!this.charByChar) {
      this.items.push({ text, x, y, width: text.length * CHAR, height: SIZE });
      return;
    }
    [...text].forEach((ch, i) => {
      if (ch === ' ') return;
      this.items.push({ text: ch, x: x + i * CHAR, y, width: CHAR, height: SIZE });
    });
  }

  /** Alineado a la derecha: `edge` es el borde derecho del texto. */
  right(text: string, edge: number, y: number): void {
    this.text(text, edge - text.length * CHAR, y);
  }
}

/** Mulberry32: generador con semilla para el orden de dibujo. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(pages: Canvas[], options: PaintOptions): PdfTextDocument {
  const out: PdfTextPage[] = pages.map((c, i) => {
    let items = options.blankOutPages?.includes(i + 1) ? [] : [...c.items];
    if (options.shuffleSeed !== undefined) {
      const rnd = seeded(options.shuffleSeed + i);
      for (let k = items.length - 1; k > 0; k--) {
        const j = Math.floor(rnd() * (k + 1));
        [items[k], items[j]] = [items[j] as PdfTextItem, items[k] as PdfTextItem];
      }
    }
    items = items.map((it) => ({ ...it, x: round(it.x), y: round(it.y) }));
    return { number: i + 1, width: PAGE_W, height: options.pageHeight ?? PAGE_H, items };
  });
  return { pageCount: out.length, pages: out };
}

const round = (v: number): number => Math.round(v * 100) / 100;

/** Ajuste de línea por palabras: unir las líneas con un espacio devuelve el texto original. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line === '') line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line !== '') lines.push(line);
  return lines;
}

const isoToCompact = (iso: string): string => iso.replaceAll('-', '');
const isoToSlash = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

const plain = (value: string): string => (value.startsWith('-') ? value.slice(1) : value);

// ───────────────────────────────────────────────────────────── BCP

const BCP_NUMBER: PdfNumberFormat = { decimal: '.', thousands: null };

function paintBcp(e: ExpectedStatement, o: PaintOptions): PdfTextDocument {
  const num = o.number ?? BCP_NUMBER;
  const c = new Canvas(o.charByChar ?? false);
  c.text('Extracto de Cuenta por Mes', 320, 40);
  c.text('Nro. Cuenta:', 40, 70);
  c.text(o.accountNumber ?? '000-00000001-0-00', 130, 70);
  c.text('Periodo:', 500, 70);
  c.text('Marzo 2026', 560, 70);
  c.text('Cliente:', 40, 90);
  c.text('Titular Ficticio Uno Demo', 130, 90);
  c.text('Moneda:', 500, 90);
  c.text(o.currencyLabel ?? 'Bolivianos', 560, 90);
  c.text('Saldo Inicial:', 40, 110);
  c.text(fmt(e.statement.openingBalance, num), 130, 110);
  c.text('Saldo Final:', 500, 110);
  c.text(fmt(e.statement.closingBalance, num), 560, 110);
  c.text('Fecha Consulta:', 40, 130);
  c.text('02/04/2026 - 10:00:00', 130, 130);
  c.text('Tipo Cuenta:', 500, 130);
  c.text('Caja Ahorro', 560, 130);
  tableHeader(c, 170);
  let y = 190;
  e.movements.forEach((m, index) => {
    if ((o.drop ?? []).includes(index)) return;
    const lines = wrap(m.description, 34);
    c.text(isoToCompact(m.date), 40, y);
    c.text(m.time, 110, y);
    c.text(lines[0] as string, 170, y);
    c.text(
      m.kind === 'INTEREST'
        ? 'Automático'
        : /Compra/u.test(m.description)
          ? 'Tarjeta de Debito'
          : 'Transferencia Interbancaria',
      360,
      y,
    );
    c.text('Agencia Demo Central', 500, y);
    amountCell(c, o, index, m.amount, num, y, 700, 638);
    c.right(fmt(m.balance ?? '0.00', num), 800, y);
    lines.slice(1).forEach((l, k) => c.text(l, 170, y + LH * (k + 1)));
    y += LH * lines.length + 6;
  });
  c.text(
    'Esta información está sujeta a verificación y confirmación del Banco por lo que carece de valor legal.',
    40,
    520,
  );
  c.right(`Página 1 de ${o.declaredPages ?? 1}`, 800, 560);
  return finish([c], o);
}

function tableHeader(c: Canvas, y: number): void {
  c.text('Fecha', 40, y);
  c.text('Hora', 110, y);
  c.text('Descripción', 170, y);
  c.text('Medio de Atención', 360, y);
  c.text('Lugar', 500, y);
  c.right('Monto', 700, y);
  c.right('Saldo', 800, y);
}

function amountCell(
  c: Canvas,
  o: PaintOptions,
  index: number,
  amount: string,
  num: PdfNumberFormat,
  y: number,
  edge: number,
  crossX: number,
): void {
  const text = o.amountText?.[index] ?? fmt(amount, num);
  // `crossX`: empieza dentro de la columna anterior y termina dentro de la del monto (fragmento entre dos columnas).
  if (o.crossColumnRow === index) c.text(text, crossX, y);
  else c.right(text, edge, y);
}

const fmt = (value: string, num: PdfNumberFormat): string => formatPdfNumber(value, num, 2);

// ───────────────────────────────────────────────────────────── Banco Ganadero

const GANADERO_NUMBER: PdfNumberFormat = { decimal: '.', thousands: ',' };

function paintGanadero(e: ExpectedStatement, o: PaintOptions): PdfTextDocument {
  const num = o.number ?? GANADERO_NUMBER;
  // Geometría compacta (benchmark de 5 000 movimientos en 100 páginas): una línea de 9 pt por movimiento.
  const lh = o.compact ? 9 : LH;
  const gap = o.compact ? 0 : 8;
  const pages: Canvas[] = [];
  const header = (c: Canvas, first: boolean): number => {
    if (first) {
      c.text('EXTRACTO DE CUENTA', 380, 40);
      c.text('01/03/2026-31/03/2026', 360, 55);
      c.text('Banco Pampa Demo S.A.', 640, 75);
      c.text(o.currencyLabel ?? 'EXPRESADO EN BOLIVIANOS', 40, 90);
      c.text('Banca por Internet', 640, 90);
      c.text('NRO. DE CUENTA:', 40, 120);
      c.text(o.accountNumber ?? '0000000001', 130, 120);
      c.text('DEL 01/03/2026 AL 31/03/2026', 300, 120);
      c.text('Procesado por 00000001', 600, 120);
      c.text('CLIENTE: TITULAR FICTICIO UNO DEMO', 40, 140);
      c.text(`Fecha: ${o.downloadDate ?? '02/04/2026'}`, 600, 140);
      c.text('Hora: 10:00:00 Hs.', 600, 155);
    }
    const y = first ? 190 : 60;
    c.text('FECHA', 40, y);
    c.text('HORA', 110, y);
    c.text('OFICINA/CANAL', 170, y);
    c.text('TRANSACCIÓN', 270, y);
    c.text('DESCRIPCIÓN', 350, y);
    c.right('DÉBITO', 640, y);
    c.right('CRÉDITO', 700, y);
    c.right('SALDO', 780, y);
    return y + 24;
  };

  let canvas = new Canvas(o.charByChar ?? false);
  pages.push(canvas);
  let y = header(canvas, true);
  const cells = (
    c: Canvas,
    yy: number,
    parts: {
      d: string;
      t: string;
      ch: string;
      id: string;
      desc: string;
      debit: string;
      credit: string;
      bal: string;
    },
  ): void => {
    c.text(parts.d, 40, yy);
    c.text(parts.t, 110, yy);
    c.text(parts.ch, 170, yy);
    c.text(parts.id, 270, yy);
    c.text(parts.desc, 350, yy);
    c.right(parts.debit, 640, yy);
    c.right(parts.credit, 700, yy);
    c.right(parts.bal, 780, yy);
  };
  cells(canvas, y, {
    d: '-',
    t: '-',
    ch: '-',
    id: '-',
    desc: 'Saldo anterior',
    debit: fmt('0.00', num),
    credit: fmt('0.00', num),
    bal: fmt(e.statement.openingBalance, num),
  });
  y += lh + gap;

  // Saltos de página: la fila 3 (4.ª) se corta tras su primera línea, como en la ficha.
  const PAGE_BREAK_BEFORE = 4;
  const rows: { m: ExpectedMovement; index: number; lines: string[] }[] = [];
  e.movements.forEach((m, index) => {
    if ((o.drop ?? []).includes(index)) return;
    rows.push({ m, index, lines: wrap(m.description, 40) });
  });
  const pageBreakAt = o.extraPageBreakEvery ?? PAGE_BREAK_BEFORE;
  let drawn = 0;
  for (const [n, row] of rows.entries()) {
    const { m, index } = row;
    const channel = m.reference?.startsWith('517')
      ? 'OFICINA DEMO'
      : /ATM/u.test(m.description)
        ? 'ATM/POS'
        : 'WEB/MOV/DEM';
    const negative = m.amount.startsWith('-');
    const printed = o.amountText?.[index] ?? fmt(plain(m.amount), num);
    const both = o.bothDebitCredit?.row === index ? o.bothDebitCredit : null;
    const debit = both ? fmt(both.debit, num) : negative ? printed : fmt('0.00', num);
    const credit = both ? fmt(both.credit, num) : negative ? fmt('0.00', num) : printed;
    const first = row.lines[0] as string;
    const carry = n + 1 === pageBreakAt && row.lines.length > 1 && o.extraPageBreakEvery === undefined;
    const lineCount = carry ? 1 : row.lines.length;
    if (o.crossColumnRow === index) {
      cells(canvas, y, {
        d: isoToSlash(m.date),
        t: m.time,
        ch: channel,
        id: m.reference ?? '',
        desc: first,
        debit: '',
        credit,
        bal: fmt(m.balance ?? '0.00', num),
      });
      // Monto que empieza en la descripción (columna anterior) y termina en el débito.
      canvas.text(printed, 575, y);
    } else {
      cells(canvas, y, {
        d: isoToSlash(m.date),
        t: m.time,
        ch: channel,
        id: m.reference ?? '',
        desc: first,
        debit,
        credit,
        bal: fmt(m.balance ?? '0.00', num),
      });
    }
    for (let k = 1; k < lineCount; k++) canvas.text(row.lines[k] as string, 350, y + lh * k);
    y += lh * lineCount + gap;
    drawn += 1;
    const more = n + 1 < rows.length;
    const hit =
      o.extraPageBreakEvery !== undefined ? drawn % o.extraPageBreakEvery === 0 : n + 1 === pageBreakAt;
    if (more || carry) {
      if (hit || carry) {
        canvas = new Canvas(o.charByChar ?? false);
        pages.push(canvas);
        y = header(canvas, false);
        if (carry) {
          for (let k = 1; k < row.lines.length; k++)
            canvas.text(row.lines[k] as string, 350, y + lh * (k - 1));
          y += lh * (row.lines.length - 1) + gap;
        }
      }
    }
  }
  pages.forEach((c, i) => footer(c, i + 1, pages.length, o, num, i === pages.length - 1, e));
  return finish(pages, o);
}

function footer(
  c: Canvas,
  pageNo: number,
  totalPages: number,
  o: PaintOptions,
  num: PdfNumberFormat,
  last: boolean,
  e: ExpectedStatement,
): void {
  if (last) {
    const base = (o.pageHeight ?? PAGE_H) - 125;
    c.right('TOTAL SALDO ACTUAL:', 700, base);
    c.right(fmt(e.statement.closingBalance, num), 780, base);
    c.right('TOTAL FONDOS RESERVADOS:', 700, base + 12);
    c.right(fmt('0.00', num), 780, base + 12);
    c.right('SALDO DISPONIBLE:', 700, base + 24);
    c.right(fmt(e.statement.closingBalance, num), 780, base + 24);
    c.right('DEPOSITO POR CONFIRMAR:', 700, base + 36);
    c.right(fmt('0.00', num), 780, base + 36);
  }
  const fy = (o.pageHeight ?? PAGE_H) - 35;
  c.text(`Página Actual: ${pageNo}`, 40, fy);
  c.text('Total Páginas:', 640, fy);
  c.text(String(o.declaredPages ?? totalPages), 730, fy);
}

// ───────────────────────────────────────────────────────────── BNB

const BNB_NUMBER: PdfNumberFormat = { decimal: '.', thousands: ',' };

function paintBnb(e: ExpectedStatement, o: PaintOptions): PdfTextDocument {
  const num = o.number ?? BNB_NUMBER;
  const canvases = [0, 1, 2, 3].map(() => new Canvas(o.charByChar ?? false));
  const [p1, p2, p3, p4] = canvases as [Canvas, Canvas, Canvas, Canvas];
  const holder = (c: Canvas): void =>
    c.text('TITULAR FICTICIO UNO DEMO | Número de cuenta: 000-0000001', 40, 40);
  const pageNo = (c: Canvas, n: number): void => c.right(`Página ${n} de ${o.declaredPages ?? 4}`, 800, 560);

  c1(p1);
  function c1(c: Canvas): void {
    c.text('Información de servicio al cliente', 320, 30);
    c.text('Tu Banca Personal', 40, 70);
    c.text('del 01 de marzo, 2026 al 31 de marzo, 2026', 40, 90);
    c.text('Número de cuenta:', 500, 90);
    c.text(o.accountNumber ?? '000-0000001', 620, 90);
    c.text('TITULAR FICTICIO UNO DEMO', 40, 106);
    c.text('Tipo: CAJA DE AHORRO UNICA', 500, 106);
    c.text('Resumen de cuenta', 40, 140);
    c.text('Moneda', 40, 160);
    c.text(o.currencyLabel ?? 'BOLIVIANOS', 300, 160);
    const summary = e.summary ?? {};
    const lineOf = (label: string, value: string, y: number): void => {
      c.text(label, 40, y);
      c.right(fmt(value, num), 400, y);
    };
    lineOf('Saldo al 01 de marzo, 2026', e.statement.openingBalance, 180);
    lineOf('Total de débitos', summary.totalDebits ?? '0.00', 196);
    lineOf('Total de créditos', summary.totalCredits ?? '0.00', 212);
    lineOf('Total ITF', summary.totalItf ?? '0.00', 228);
    lineOf('Saldo al 31 de marzo, 2026', e.statement.closingBalance, 244);
    pageNo(c, 1);
  }

  const table = (c: Canvas, section: string, amountLabel: string, totalLabel: string, id: string): void => {
    holder(c);
    c.text(section, 40, 80);
    const hy = 100;
    c.text('Fecha', 40, hy);
    c.text('Hora', 110, hy);
    c.text('Descripción', 160, hy);
    c.text('Referencia', 470, hy);
    c.text('Comprobante', 540, hy);
    c.right('ITF', 650, hy);
    c.right(amountLabel, 740, hy);
    let y = 130;
    e.movements.forEach((m, index) => {
      if (m.section !== id || (o.drop ?? []).includes(index)) return;
      const desc = [m.description];
      if (m.counterparty) {
        const text = `Cuenta Destino: ${m.counterparty.account}. Nombre: ${m.counterparty.name}. Banco: ${m.counterparty.bank}. Dato Adicional: Cuenta: 00`;
        desc.push(...wrap(text, 52));
        if (index === 2) desc.push('CUENTA: 0000000001 NOMBRE(S): TITULAR FICTICIO UNO DEMO');
      }
      const time = m.time.slice(0, 5);
      c.text(isoToSlash(m.date), 40, y);
      if (!o.timeBelow) c.text(time, 110, y);
      desc.forEach((l, k) => c.text(l, 160, y + LH * (k + 1)));
      c.text(m.reference ?? '', 470, y + LH);
      amountCell(c, o, index, plain(m.amount), num, y + LH, 740, 648);
      if (o.timeBelow) c.text(time, 110, y + LH * 2);
      y += LH * (Math.max(desc.length, 2) + 3);
    });
    const total = o.sectionTotals?.[id] ?? e.sections?.find((s) => s.name === id)?.total ?? '0.00';
    c.text(totalLabel, 40, y + 12);
    c.right(fmt(total, num), 740, y + 12);
  };
  table(p2, 'Depósitos', 'Créditos', 'Total depósitos', 'DEPOSITS');
  pageNo(p2, 2);
  table(p3, 'Retiros', 'Débitos', 'Total retiros', 'WITHDRAWALS');
  pageNo(p3, 3);
  holder(p4);
  p4.text('Esta página se dejó en blanco intencionalmente', 280, 300);
  pageNo(p4, 4);
  return finish(canvases, o);
}

/** Extracto de Banco Ganadero con `rows` movimientos de una línea, `perPage` por página (benchmark TC-IMPORTS-PDF-046). */
export function paintLargeStatement(rows: number, perPage: number): PdfTextDocument {
  let cents = 1_000_000_000n;
  const opening = cents;
  const movements: ExpectedMovement[] = [];
  for (let i = 0; i < rows; i++) {
    const value = BigInt(((i * 37) % 900) + 100);
    const credit = i % 3 === 0;
    cents += credit ? value : -value;
    const day = String((i % 28) + 1).padStart(2, '0');
    const money = (c: bigint): string => {
      const abs = c < 0n ? -c : c;
      return `${c < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
    };
    movements.push({
      date: `2026-03-${day}`,
      time: '10:00:00',
      description: `Movimiento sintetico ${i + 1}`,
      amount: money(credit ? value : -value),
      balance: money(cents),
      reference: String(900_000_000 + i),
    });
  }
  const money = (c: bigint): string => `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
  const expected: ExpectedStatement = {
    institution: 'Banco Pampa Demo',
    currency: 'BOB',
    statement: {
      openingBalance: money(opening),
      closingBalance: money(cents),
      periodFrom: '2026-03-01',
      periodTo: '2026-03-31',
    },
    movements,
  };
  return paintGanadero(expected, { compact: true, pageHeight: 800, extraPageBreakEvery: perPage });
}

export function paintStatement(id: EntityId, options: PaintOptions = {}): PdfTextDocument {
  const expected = loadExpected(id);
  switch (id) {
    case 'BCP':
      return paintBcp(expected, options);
    case 'GANADERO':
      return paintGanadero(expected, options);
    case 'BNB':
      return paintBnb(expected, options);
  }
}
