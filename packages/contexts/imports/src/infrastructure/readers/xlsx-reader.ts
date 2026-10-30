import { inflateRawSync } from 'node:zlib';
import type { CsvRecord } from '../../domain/csv-sniffer.js';
import type { ParseFailure } from '../../domain/statement.js';

/**
 * Lector de hojas XLSX (Office Open XML; FR-IMPORTS-017, Could; openspec add-import-pipeline decisión 5). La hoja se
 * lee como una tabla de celdas de texto que sigue el MISMO mapeo que un CSV. Las celdas son DATOS:
 * - las fórmulas NO se evalúan: se usa el último valor guardado (`<v>`);
 * - un número se lee como su representación decimal MÁS CORTA que reconstruye el `double` (`String(n)`), sin notación
 *   científica; la regla de escala la aplica el normalizador (0.30000000000000004 excede la escala ⇒ fila inválida,
 *   nunca 0.30; INV-003);
 * - las celdas con formato de fecha (serial de Excel) se leen como `YYYY-MM-DD`.
 * DOCUMENTS ya acotó la estructura del ZIP (entradas, tamaño inflado, razón); aquí se vuelve a acotar al inflar.
 * Sin DTD ni entidades: se rechaza `<!DOCTYPE>`/`<!ENTITY>`.
 */
export interface XlsxReadOptions {
  /** Hoja del perfil; sin ella, la primera. */
  readonly sheet?: string | undefined;
  /** Filas de datos permitidas (el registro de encabezado no cuenta). */
  readonly maxRows: number;
  readonly maxColumns: number;
}

export type XlsxReadResult =
  | { readonly ok: true; readonly records: readonly CsvRecord[]; readonly columnCount: number }
  | {
      readonly ok: false;
      readonly failure:
        ParseFailure | { readonly code: 'IMPORT_UNSUPPORTED_FORMAT'; readonly pointer: string | null };
    };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

interface Entry {
  readonly method: number;
  readonly compressed: number;
  readonly offset: number;
}

function readDirectory(b: Buffer): Map<string, Entry> | null {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i -= 1) {
    if (b.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const total = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const entries = new Map<string, Entry>();
  for (let n = 0; n < total; n += 1) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== CENTRAL) return null;
    const method = b.readUInt16LE(p + 10);
    const compressed = b.readUInt32LE(p + 20);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const offset = b.readUInt32LE(p + 42);
    entries.set(b.toString('utf8', p + 46, p + 46 + nameLen), { method, compressed, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function inflateEntry(b: Buffer, e: Entry): string | null {
  if (e.offset + 30 > b.length || b.readUInt32LE(e.offset) !== 0x04034b50) return null;
  const start = e.offset + 30 + b.readUInt16LE(e.offset + 26) + b.readUInt16LE(e.offset + 28);
  const raw = b.subarray(start, start + e.compressed);
  try {
    const out = e.method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
    return out.toString('utf8');
  } catch {
    return null;
  }
}

const XML_ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/gu, (whole, name: string) => {
    if (name.startsWith('#x')) return codePoint(Number.parseInt(name.slice(2), 16)) ?? whole;
    if (name.startsWith('#')) return codePoint(Number.parseInt(name.slice(1), 10)) ?? whole;
    return XML_ENTITIES[name] ?? whole;
  });
}

function codePoint(cp: number): string | null {
  return Number.isInteger(cp) && cp >= 0x20 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)
    ? String.fromCodePoint(cp)
    : null;
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'u').exec(attrs);
  return m ? unescapeXml(m[1] as string) : null;
}

/** Texto de los `<t>` de un `<si>` o `<is>` (rich text: se concatenan los fragmentos). */
function textOf(xml: string): string {
  let out = '';
  for (const m of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)) out += unescapeXml(m[1] as string);
  return out;
}

function sharedStrings(xml: string | null): string[] {
  if (xml === null) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)].map((m) => textOf(m[1] as string));
}

/** `s` (índice de `cellXfs`) ⇒ ¿formato de fecha? */
function dateStyles(xml: string | null): Set<number> {
  const dates = new Set<number>();
  if (xml === null) return dates;
  const custom = new Set<number>();
  for (const m of xml.matchAll(/<numFmt\b([^>]*)\/?>/gu)) {
    const id = Number(attr(m[1] as string, 'numFmtId'));
    const code = (attr(m[1] as string, 'formatCode') ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./gu, '');
    if (/[dmyh]/iu.test(code) && !/^[#0.,%\s]*$/u.test(code)) custom.add(id);
  }
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/u.exec(xml)?.[1] ?? '';
  let i = 0;
  for (const m of cellXfs.matchAll(/<xf\b([^>]*)\/?>/gu)) {
    const id = Number(attr(m[1] as string, 'numFmtId') ?? '0');
    if ((id >= 14 && id <= 22) || (id >= 45 && id <= 47) || custom.has(id)) dates.add(i);
    i += 1;
  }
  return dates;
}

/** Número de `double` ⇒ decimal más corto que lo reconstruye, sin notación científica. */
export function shortestDecimal(value: string): string | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/u.exec(s);
  if (!m) return s;
  const [, sign, int, frac = '', expRaw] = m;
  const exp = Number(expRaw);
  const digits = `${int}${frac}`;
  const pointAt = (int as string).length + exp;
  if (pointAt <= 0) return `${sign}0.${'0'.repeat(-pointAt)}${digits}`;
  if (pointAt >= digits.length) return `${sign}${digits}${'0'.repeat(pointAt - digits.length)}`;
  return `${sign}${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
}

function serialToDate(value: string): string | null {
  const days = Math.floor(Number(value));
  if (!Number.isFinite(days) || days < 1 || days > 2_958_465) return null;
  // Época 1899-12-30 (cubre el error del 29/02/1900 de Excel para fechas posteriores a marzo de 1900).
  const d = new Date(Date.UTC(1899, 11, 30) + days * 86_400_000);
  const two = (v: number) => String(v).padStart(2, '0');
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

const columnIndex = (ref: string): number => {
  let n = 0;
  for (const ch of ref.replace(/\d+/gu, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export function readXlsxTable(bytes: Uint8Array, options: XlsxReadOptions): XlsxReadResult {
  const parseFailed = (pointer: string): XlsxReadResult => ({
    ok: false,
    failure: { code: 'IMPORT_PARSE_FAILED', pointer },
  });
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dir = readDirectory(b);
  if (dir === null) return parseFailed('zip');
  const read = (name: string): string | null => {
    const e = dir.get(name);
    return e ? inflateEntry(b, e) : null;
  };
  const workbook = read('xl/workbook.xml');
  if (workbook === null) return parseFailed('xl/workbook.xml');
  for (const xml of [workbook]) if (/<!(DOCTYPE|ENTITY)/iu.test(xml)) return parseFailed('dtd');

  const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/gu)].map((m) => ({
    name: attr(m[1] as string, 'name') ?? '',
    rid: attr(m[1] as string, 'r:id') ?? attr(m[1] as string, 'id') ?? '',
  }));
  const chosen = options.sheet === undefined ? sheets[0] : sheets.find((s) => s.name === options.sheet);
  if (!chosen) return parseFailed('sheet');
  const rels = read('xl/_rels/workbook.xml.rels') ?? '';
  let target: string | null = null;
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/gu)) {
    if (attr(m[1] as string, 'Id') === chosen.rid) target = attr(m[1] as string, 'Target');
  }
  if (target === null) return parseFailed('sheet');
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  const sheetXml = read(path);
  if (sheetXml === null) return parseFailed('sheet');
  if (/<!(DOCTYPE|ENTITY)/iu.test(sheetXml)) return parseFailed('dtd');

  const strings = sharedStrings(read('xl/sharedStrings.xml'));
  const dates = dateStyles(read('xl/styles.xml'));

  const records: CsvRecord[] = [];
  let columnCount = 0;
  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/gu)) {
    const rowNumber = Number(attr(rowMatch[1] as string, 'r') ?? records.length + 1);
    const cells: string[] = [];
    for (const c of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
      const attrs = c[1] as string;
      const body = c[2] ?? '';
      const col = columnIndex(attr(attrs, 'r') ?? '');
      if (col < 0) continue;
      if (col >= options.maxColumns) {
        return { ok: false, failure: { code: 'IMPORT_UNSUPPORTED_FORMAT', pointer: null } };
      }
      const type = attr(attrs, 't') ?? 'n';
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/u.exec(body)?.[1];
      let value = '';
      if (type === 's') value = strings[Number(v)] ?? '';
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'str') value = v === undefined ? '' : unescapeXml(v);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (type === 'e') value = '';
      else if (v !== undefined) {
        const style = Number(attr(attrs, 's') ?? '0');
        value = (dates.has(style) ? serialToDate(v) : shortestDecimal(unescapeXml(v))) ?? '';
      }
      while (cells.length < col) cells.push('');
      cells[col] = value;
    }
    if (cells.every((x) => x === '')) continue;
    columnCount = Math.max(columnCount, cells.length);
    records.push({ line: rowNumber, cells });
    if (records.length - 1 > options.maxRows) {
      return { ok: false, failure: { code: 'IMPORT_TOO_MANY_ROWS', pointer: null } };
    }
  }
  return { ok: true, records, columnCount };
}
