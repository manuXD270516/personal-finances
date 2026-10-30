import { inflateSync } from 'node:zlib';
import { hasPdfSignature } from '../../domain/magic-bytes.js';
import type { InspectionVerdict } from '../../domain/types.js';
import { opensWithEmptyUserPassword, type PdfEncryptionParams } from './pdf-encryption.js';

/**
 * Inspector estructural de PDF (design decisión 4). Solo lee la estructura: NO renderiza, NO ejecuta nada ni
 * interpreta acciones. Rechaza el contenido activo (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile(s)`, `/RichMedia`,
 * `/XFA`, `/GoToE`, `/SubmitForm`, `/ImportData`) aunque los nombres estén ofuscados con `#xx` o dentro de flujos de
 * objetos comprimidos (se infla con tope), y el cifrado que exige contraseña de usuario (D319).
 *
 * `/OpenAction` y `/AA` no se rechazan por sí solos: solo importa a qué acción apuntan, y las acciones peligrosas ya
 * están en la lista de nombres prohibidos.
 */
export interface PdfLimits {
  readonly maxObjects: number;
  readonly maxInflatedBytes: number;
}

export const DEFAULT_PDF_LIMITS: PdfLimits = { maxObjects: 10_000, maxInflatedBytes: 50 * 1024 * 1024 };

const FORBIDDEN_NAMES: ReadonlySet<string> = new Set([
  'JavaScript',
  'JS',
  'Launch',
  'EmbeddedFile',
  'EmbeddedFiles',
  'RichMedia',
  'XFA',
  'GoToE',
  'SubmitForm',
  'ImportData',
]);

// Un nombre PDF: `/` y los caracteres regulares siguientes (no espacio ni delimitadores).
// eslint-disable-next-line no-control-regex -- el NUL es un separador de espacio en blanco de PDF
const NAME = /\/[^\u0000\t\n\f\r /<>[\](){}%]*/gu;

/** Nombres de un fragmento, con los escapes `#xx` ya resueltos. */
function* namesOf(text: string): Generator<string> {
  for (const m of text.matchAll(NAME)) {
    yield m[0]
      .slice(1)
      .replace(/#([0-9a-fA-F]{2})/gu, (_all, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  }
}

const hasForbiddenName = (text: string): boolean => {
  for (const name of namesOf(text)) if (FORBIDDEN_NAMES.has(name)) return true;
  return false;
};

interface StreamRegion {
  readonly dict: string;
  readonly start: number;
  readonly end: number;
}

/** Regiones `stream … endstream` con el texto del diccionario que las precede (desde el último `obj`). */
function streamRegions(text: string): StreamRegion[] {
  const out: StreamRegion[] = [];
  const keyword = /stream(\r\n|\n|\r)/gu;
  let from = 0;
  for (;;) {
    keyword.lastIndex = from;
    const m = keyword.exec(text);
    if (!m) break;
    const kwAt = m.index;
    // `endstream` también contiene la palabra `stream`: se descarta si le antecede `end`.
    if (kwAt >= 3 && text.slice(kwAt - 3, kwAt) === 'end') {
      from = kwAt + 6;
      continue;
    }
    const start = kwAt + m[0].length;
    const endAt = text.indexOf('endstream', start);
    const end = endAt < 0 ? text.length : endAt;
    const objAt = text.lastIndexOf('obj', kwAt);
    const dict = text.slice(objAt < 0 ? Math.max(0, kwAt - 2048) : objAt, kwAt);
    out.push({ dict, start, end });
    from = end + 9;
  }
  return out;
}

const hasName = (dict: string, wanted: string): boolean => {
  for (const name of namesOf(dict)) if (name === wanted) return true;
  return false;
};

/** Filtros declarados en el diccionario del flujo (normalizados). */
function filtersOf(dict: string): string[] {
  const known = [
    'FlateDecode',
    'Fl',
    'LZWDecode',
    'LZW',
    'ASCII85Decode',
    'A85',
    'ASCIIHexDecode',
    'AHx',
    'RunLengthDecode',
    'RL',
    'DCTDecode',
    'DCT',
    'CCITTFaxDecode',
    'CCF',
    'JBIG2Decode',
    'JPXDecode',
    'Crypt',
  ];
  return [...namesOf(dict)].filter((n) => known.includes(n));
}

export function inspectPdf(content: Buffer, limits: PdfLimits = DEFAULT_PDF_LIMITS): InspectionVerdict {
  if (!hasPdfSignature(content)) return { ok: false, reason: 'TYPE_MISMATCH' };
  const text = content.toString('latin1');

  const objects = text.match(/\bobj\b/gu)?.length ?? 0;
  if (objects > limits.maxObjects) return { ok: false, reason: 'MALFORMED_CONTENT' };

  const regions = streamRegions(text);
  // Texto fuera de los flujos: diccionarios, trailer, xref. Si un flujo falso esconde objetos reales, la inflación
  // fallida o la ausencia de filtro hacen que se escanee su contenido crudo (abajo).
  const outside: string[] = [];
  let cursor = 0;
  for (const r of regions) {
    outside.push(text.slice(cursor, r.start));
    cursor = r.end;
  }
  outside.push(text.slice(cursor));
  const outsideText = outside.join('\n');
  if (hasForbiddenName(outsideText)) return { ok: false, reason: 'ACTIVE_CONTENT' };

  let inflated = 0;
  let sawObjectStream = false;
  for (const r of regions) {
    const filters = filtersOf(r.dict);
    const body = content.subarray(r.start, r.end);
    const isObjStm = hasName(r.dict, 'ObjStm');
    if (isObjStm) sawObjectStream = true;
    const flateOnly = filters.length === 1 && (filters[0] === 'FlateDecode' || filters[0] === 'Fl');
    if (isObjStm && !flateOnly && filters.length > 0) return { ok: false, reason: 'MALFORMED_CONTENT' };

    let scanText: string | null = null;
    if (filters.length === 0) {
      scanText = body.toString('latin1');
    } else if (flateOnly) {
      try {
        const budget = limits.maxInflatedBytes - inflated;
        const out = inflateSync(body, { maxOutputLength: Math.max(1, budget) });
        inflated += out.length;
        scanText = out.toString('latin1');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
          return { ok: false, reason: 'MALFORMED_CONTENT' };
        }
        // No es un flujo Flate válido (o está cifrado): se escanea crudo por si es un flujo falso.
        scanText = isObjStm ? body.toString('latin1') : null;
        if (scanText === null && !hasName(r.dict, 'Image') && !looksBinary(body))
          scanText = body.toString('latin1');
      }
    } else if (
      (filters.includes('DCTDecode') || filters.includes('DCT')) &&
      !(body[0] === 0xff && body[1] === 0xd8)
    ) {
      scanText = body.toString('latin1');
    }
    if (scanText !== null && hasForbiddenName(scanText)) return { ok: false, reason: 'ACTIVE_CONTENT' };
  }
  void sawObjectStream;

  const encrypt = encryptionOf(text, outsideText);
  if (encrypt === 'unparseable') return { ok: false, reason: 'ENCRYPTED_CONTENT' };
  if (encrypt && !opensWithEmptyUserPassword(encrypt)) return { ok: false, reason: 'ENCRYPTED_CONTENT' };
  return { ok: true, format: 'PDF' };
}

/** Heurística barata: ¿el fragmento parece binario (muchos bytes no imprimibles)? */
function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 512);
  let odd = 0;
  for (let i = 0; i < n; i += 1) {
    const b = buf[i]!;
    if (b < 9 || (b > 13 && b < 32) || b > 126) odd += 1;
  }
  return n > 0 && odd / n > 0.2;
}

// ─────────────────────────────────────────────── /Encrypt

function parsePdfString(src: string, from: number): { value: Buffer; end: number } | null {
  let i = from;
  while (i < src.length && /\s/u.test(src[i]!)) i += 1;
  if (src[i] === '<' && src[i + 1] !== '<') {
    const close = src.indexOf('>', i);
    if (close < 0) return null;
    let hex = src.slice(i + 1, close).replace(/\s+/gu, '');
    if (hex.length % 2 === 1) hex += '0';
    if (!/^[0-9a-fA-F]*$/u.test(hex)) return null;
    return { value: Buffer.from(hex, 'hex'), end: close + 1 };
  }
  if (src[i] === '(') {
    const bytes: number[] = [];
    let depth = 1;
    i += 1;
    while (i < src.length && depth > 0) {
      const c = src[i]!;
      if (c === '\\') {
        const n = src[i + 1] ?? '';
        const map: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
        if (n in map) {
          bytes.push(map[n]!);
          i += 2;
        } else if (/[0-7]/u.test(n)) {
          let oct = '';
          let k = 0;
          while (k < 3 && /[0-7]/u.test(src[i + 1 + k] ?? '')) {
            oct += src[i + 1 + k];
            k += 1;
          }
          bytes.push(Number.parseInt(oct, 8) & 0xff);
          i += 1 + k;
        } else if (n === '\r' || n === '\n') {
          i += n === '\r' && src[i + 2] === '\n' ? 3 : 2;
        } else {
          bytes.push(n.charCodeAt(0) & 0xff);
          i += 2;
        }
        continue;
      }
      if (c === '(') depth += 1;
      else if (c === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
      bytes.push(c.charCodeAt(0) & 0xff);
      i += 1;
    }
    return depth === 0 ? { value: Buffer.from(bytes), end: i + 1 } : null;
  }
  return null;
}

function entryOf(dict: string, key: string): number | null {
  const re = new RegExp(`/${key}(?![A-Za-z0-9])`, 'u');
  const m = re.exec(dict);
  return m ? m.index + m[0].length : null;
}

function intEntry(dict: string, key: string): number | null {
  const at = entryOf(dict, key);
  if (at === null) return null;
  const m = /^\s*(-?\d+)/u.exec(dict.slice(at, at + 32));
  return m ? Number.parseInt(m[1]!, 10) : null;
}

function stringEntry(dict: string, key: string): Buffer | null {
  const at = entryOf(dict, key);
  if (at === null) return null;
  return parsePdfString(dict, at)?.value ?? null;
}

/** Diccionario `<< … >>` que empieza en `from` (anidamiento contado, cadenas saltadas). */
function dictAt(src: string, from: number): string | null {
  const open = src.indexOf('<<', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const two = src.slice(i, i + 2);
    if (two === '<<') {
      depth += 1;
      i += 1;
    } else if (two === '>>') {
      depth -= 1;
      i += 1;
      if (depth === 0) return src.slice(open, i + 1);
    } else if (src[i] === '(') {
      const s = parsePdfString(src, i);
      if (!s) return null;
      i = s.end - 1;
    }
  }
  return null;
}

/**
 * Parámetros del manejador estándar a partir del `/Encrypt` del trailer (directo o referencia indirecta). `null` si el
 * documento no está cifrado; `'unparseable'` si lo está y no se pueden leer (falla cerrada: se rechaza).
 */
function encryptionOf(text: string, outside: string): PdfEncryptionParams | 'unparseable' | null {
  const at = /\/Encrypt(?![A-Za-z0-9])/u.exec(outside);
  if (!at) return null;
  const after = outside.slice(at.index + at[0].length, at.index + at[0].length + 64);
  let dict: string | null;
  const ref = /^\s*(\d+)\s+(\d+)\s+R/u.exec(after);
  if (ref) {
    const obj = new RegExp(`(?:^|[\\s>])${ref[1]}\\s+${ref[2]}\\s+obj`, 'u').exec(text);
    dict = obj ? dictAt(text, obj.index + obj[0].length) : null;
  } else {
    dict = dictAt(outside, at.index + at[0].length);
  }
  if (!dict) return 'unparseable';
  const filter = /\/Filter\s*\/([A-Za-z]+)/u.exec(dict)?.[1] ?? '';
  const r = intEntry(dict, 'R');
  const v = intEntry(dict, 'V') ?? 0;
  const o = stringEntry(dict, 'O');
  const u = stringEntry(dict, 'U');
  const p = intEntry(dict, 'P');
  if (filter !== 'Standard' || r === null || !o || !u || p === null) return 'unparseable';
  const idAt = /\/ID\s*\[/u.exec(outside);
  const id0 = idAt
    ? (parsePdfString(outside, idAt.index + idAt[0].length)?.value ?? Buffer.alloc(0))
    : Buffer.alloc(0);
  const emd = /\/EncryptMetadata\s+(true|false)/u.exec(dict)?.[1];
  return {
    filter,
    v,
    r,
    o,
    u,
    p,
    lengthBits: intEntry(dict, 'Length') ?? (r >= 4 ? 128 : 40),
    encryptMetadata: emd !== 'false',
    id0,
  };
}
