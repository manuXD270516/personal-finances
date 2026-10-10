import { DomainError } from '@pf/shared-kernel';

/**
 * `CsvSniffer` (openspec add-basic-csv-import, decisión 3): codificación (UTF-8 con o sin BOM, windows-1252),
 * binario, delimitador y registros RFC 4180. Puro: opera sobre bytes y devuelve texto NFC; no guarda nada.
 */

export const CSV_ENCODINGS = ['utf-8', 'windows-1252'] as const;
export type CsvEncoding = (typeof CSV_ENCODINGS)[number];

export const CSV_DELIMITERS = [',', ';', '\t', '|'] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

/** Un registro del archivo con su línea física inicial (1-based), para informar errores por fila. */
export interface CsvRecord {
  readonly line: number;
  readonly cells: readonly string[];
}

export interface CsvLimits {
  readonly maxRows: number;
  readonly maxColumns: number;
}

export interface CsvSniffResult {
  readonly encoding: CsvEncoding;
  readonly delimiter: CsvDelimiter;
  /** Texto decodificado (NFC): permite volver a leer con otro delimitador sin releer los bytes. */
  readonly text: string;
  /** Registros no vacíos del archivo (incluida la fila de encabezado), en orden. */
  readonly records: readonly CsvRecord[];
  /** Ancho máximo de los registros. */
  readonly columnCount: number;
}

const unsupported = (message: string) => new DomainError('IMPORT_UNSUPPORTED_FORMAT', message);

/** windows-1252 → Unicode para 0x80–0x9F (el resto coincide con Latin-1). Las posiciones sin definir quedan como C1. */
const CP1252_HIGH: readonly number[] = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0x008d, 0x017d, 0x008f, 0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122,
  0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

function decodeWindows1252(bytes: Uint8Array): string {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i] as number;
    out.push(String.fromCodePoint(b >= 0x80 && b <= 0x9f ? (CP1252_HIGH[b - 0x80] as number) : b));
  }
  return out.join('');
}

const isControl = (cp: number): boolean =>
  (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) || (cp >= 0x7f && cp <= 0x9f);

/** Decodifica los bytes y rechaza el binario (NUL o > 1 % de caracteres de control fuera de `\t\r\n`). */
export function decodeCsv(bytes: Uint8Array): { readonly encoding: CsvEncoding; readonly text: string } {
  if (bytes.length === 0) throw unsupported('the file is empty');
  if (bytes.includes(0)) throw unsupported('the file is binary (NUL byte)');
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  let encoding: CsvEncoding = 'utf-8';
  let text: string;
  if (hasBom) {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(3));
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      encoding = 'windows-1252';
      text = decodeWindows1252(bytes);
    }
  }
  let controls = 0;
  let total = 0;
  for (const ch of text) {
    total += 1;
    if (isControl(ch.codePointAt(0) as number)) controls += 1;
  }
  if (total === 0 || controls / total > 0.01) throw unsupported('the file is not delimited text');
  return { encoding, text: text.normalize('NFC') };
}

/** Cuenta, fuera de comillas, las apariciones de `delimiter` en cada una de las primeras `maxLines` líneas. */
function delimiterCounts(text: string, delimiter: string, maxLines: number): number[] {
  const counts: number[] = [];
  let inQuotes = false;
  let count = 0;
  let hasContent = false;
  for (let i = 0; i < text.length && counts.length < maxLines; i += 1) {
    const ch = text[i] as string;
    if (ch === '"') {
      inQuotes = !inQuotes;
      hasContent = true;
    } else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      if (hasContent) counts.push(count);
      count = 0;
      hasContent = false;
    } else {
      hasContent = true;
      if (!inQuotes && ch === delimiter) count += 1;
    }
  }
  if (hasContent && counts.length < maxLines) counts.push(count);
  return counts;
}

/**
 * Delimitador con el recuento más consistente en las primeras 20 líneas: gana el candidato presente (≥ 1) en más
 * líneas con el mismo recuento; el empate lo desempata el mayor recuento y luego el orden `, ; \t |`.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  let best: { delimiter: CsvDelimiter; lines: number; perLine: number } | null = null;
  for (const delimiter of CSV_DELIMITERS) {
    const counts = delimiterCounts(text, delimiter, 20);
    const tally = new Map<number, number>();
    for (const c of counts) if (c > 0) tally.set(c, (tally.get(c) ?? 0) + 1);
    let modeCount = 0;
    let modeLines = 0;
    for (const [perLine, lines] of tally) {
      if (lines > modeLines || (lines === modeLines && perLine > modeCount)) {
        modeCount = perLine;
        modeLines = lines;
      }
    }
    if (modeLines === 0) continue;
    if (!best || modeLines > best.lines || (modeLines === best.lines && modeCount > best.perLine)) {
      best = { delimiter, lines: modeLines, perLine: modeCount };
    }
  }
  return best?.delimiter ?? ',';
}

/**
 * Registros RFC 4180: comillas dobles, `""` como comilla escapada, saltos de línea (`\n`, `\r\n`, `\r`) dentro de
 * campos entrecomillados. Las líneas en blanco (o solo con celdas vacías) se omiten (la línea física se conserva en `line`).
 */
export function parseCsv(text: string, delimiter: CsvDelimiter): CsvRecord[] {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let quotedCell = false;
  let line = 1;
  let recordLine = 1;
  let touched = false;

  const endCell = () => {
    cells.push(cell);
    cell = '';
    quotedCell = false;
  };
  const endRecord = () => {
    endCell();
    if (touched && cells.some((c) => c.trim() !== '')) records.push({ line: recordLine, cells });
    cells = [];
    touched = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '' && !quotedCell) {
      inQuotes = true;
      quotedCell = true;
      touched = true;
    } else if (ch === delimiter) {
      touched = true;
      endCell();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      touched = true;
      cell += ch;
    }
  }
  if (touched) endRecord();
  return records;
}

/**
 * Lee un archivo CSV completo: decodifica, detecta el delimitador, parsea y aplica los límites. Errores:
 * `IMPORT_UNSUPPORTED_FORMAT` (binario, vacío o más de `maxColumns` columnas) e `IMPORT_TOO_MANY_ROWS` (más de
 * `maxRows` filas de datos, descontando la fila de encabezado).
 */
export function sniffCsv(bytes: Uint8Array, limits: CsvLimits): CsvSniffResult {
  const { encoding, text } = decodeCsv(bytes);
  const delimiter = detectDelimiter(text);
  const records = parseCsv(text, delimiter);
  if (records.length === 0) throw unsupported('the file has no rows');
  const columnCount = records.reduce((max, r) => Math.max(max, r.cells.length), 0);
  if (columnCount > limits.maxColumns) {
    throw unsupported(`the file has more than ${limits.maxColumns} columns`);
  }
  if (records.length - 1 > limits.maxRows) {
    throw new DomainError('IMPORT_TOO_MANY_ROWS', `the file has more than ${limits.maxRows} data rows`);
  }
  return { encoding, delimiter, text, records, columnCount };
}
