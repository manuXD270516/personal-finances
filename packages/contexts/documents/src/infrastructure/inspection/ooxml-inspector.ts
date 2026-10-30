import { inflateRawSync } from 'node:zlib';
import type { InspectionVerdict } from '../../domain/types.js';

/**
 * Inspector de libros XLSX (Office Open XML; design decisión 4). Lee el directorio central del ZIP SIN inflar para
 * aplicar los límites, y después infla cada entrada con tope (el tamaño declarado puede mentir). No ejecuta macros ni
 * fórmulas ni interpreta el contenido de las hojas.
 */
export interface ArchiveLimits {
  readonly maxEntries: number;
  readonly maxUncompressedBytes: number;
  readonly maxRatio: number;
}

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: 1000,
  maxUncompressedBytes: 104_857_600,
  maxRatio: 100,
};

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
  readonly flags: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

const limitsExceeded: InspectionVerdict = { ok: false, reason: 'ARCHIVE_LIMITS_EXCEEDED' };
const malformed: InspectionVerdict = { ok: false, reason: 'MALFORMED_CONTENT' };

/** Directorio central. `null` ⇒ no es un ZIP legible. ZIP64 se trata como fuera de límites. */
function readDirectory(b: Buffer): ZipEntry[] | 'zip64' | null {
  const min = Math.max(0, b.length - 65_557);
  let eocd = -1;
  for (let i = b.length - 22; i >= min; i -= 1) {
    if (b.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const total = b.readUInt16LE(eocd + 10);
  const size = b.readUInt32LE(eocd + 12);
  const offset = b.readUInt32LE(eocd + 16);
  if (total === 0xffff || size === 0xffffffff || offset === 0xffffffff) return 'zip64';
  if (offset + size > b.length) return null;
  const entries: ZipEntry[] = [];
  let p = offset;
  for (let n = 0; n < total; n += 1) {
    if (p + 46 > b.length || b.readUInt32LE(p) !== CENTRAL) return null;
    const flags = b.readUInt16LE(p + 8);
    const method = b.readUInt16LE(p + 10);
    const compressedSize = b.readUInt32LE(p + 20);
    const uncompressedSize = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const localOffset = b.readUInt32LE(p + 42);
    if (p + 46 + nameLen > b.length) return null;
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      return 'zip64';
    }
    const name = b.subarray(p + 46, p + 46 + nameLen).toString((flags & 0x800) !== 0 ? 'utf8' : 'latin1');
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Contenido de una entrada, inflado con tope `cap`. Lanza `RangeError` si excede el tope. */
function readEntry(b: Buffer, e: ZipEntry, cap: number): Buffer | null {
  if (e.localOffset + 30 > b.length || b.readUInt32LE(e.localOffset) !== LOCAL) return null;
  const nameLen = b.readUInt16LE(e.localOffset + 26);
  const extraLen = b.readUInt16LE(e.localOffset + 28);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const raw = b.subarray(start, start + e.compressedSize);
  if (raw.length !== e.compressedSize) return null;
  if (e.method === 0) {
    if (raw.length > cap) throw new RangeError('exceeds cap');
    return raw;
  }
  if (e.method !== 8) return null;
  try {
    return inflateRawSync(raw, { maxOutputLength: Math.max(1, cap) });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new RangeError('exceeds cap', { cause: err });
    }
    return null;
  }
}

const unsafePath = (name: string): boolean =>
  name.startsWith('/') ||
  name.startsWith('\\') ||
  /^[A-Za-z]:/u.test(name) ||
  name.includes('\\') ||
  name.split('/').includes('..') ||
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f]/u.test(name);

export function inspectXlsx(
  content: Buffer,
  limits: ArchiveLimits = DEFAULT_ARCHIVE_LIMITS,
): InspectionVerdict {
  const dir = readDirectory(content);
  if (dir === 'zip64') return limitsExceeded;
  if (dir === null) return malformed;
  if (dir.length > limits.maxEntries) return limitsExceeded;

  let declaredTotal = 0;
  for (const e of dir) {
    if ((e.flags & 0x1) !== 0) return { ok: false, reason: 'ENCRYPTED_CONTENT' };
    declaredTotal += e.uncompressedSize;
    if (declaredTotal > limits.maxUncompressedBytes) return limitsExceeded;
    // Razón de compresión por entrada: u / c (un flujo que "se infla desde nada" también es una bomba).
    if (e.uncompressedSize > 0 && e.method === 8) {
      const ratio = e.compressedSize === 0 ? Number.POSITIVE_INFINITY : e.uncompressedSize / e.compressedSize;
      if (ratio > limits.maxRatio) return limitsExceeded;
    }
    if (e.method !== 0 && e.method !== 8) return malformed;
    if (unsafePath(e.name)) return malformed;
  }

  const names = new Set(dir.map((e) => e.name));
  if (!names.has('[Content_Types].xml') || !names.has('xl/workbook.xml')) {
    return { ok: false, reason: 'TYPE_MISMATCH' };
  }
  // Macros por estructura: proyecto VBA, controles ActiveX o macros de hoja (`xl/macrosheets`).
  for (const n of names) {
    if (/^xl\/vbaProject\.bin$/iu.test(n) || /^xl\/activeX\//iu.test(n) || /^xl\/macrosheets\//iu.test(n)) {
      return { ok: false, reason: 'MACROS_PRESENT' };
    }
  }

  // Inflado real con tope: el tamaño declarado puede mentir. La suma real tampoco puede superar el límite.
  let actualTotal = 0;
  for (const e of dir) {
    if (e.name.endsWith('/')) continue;
    let data: Buffer | null;
    try {
      data = readEntry(
        content,
        e,
        Math.min(e.uncompressedSize + 1, limits.maxUncompressedBytes - actualTotal + 1),
      );
    } catch {
      return limitsExceeded;
    }
    if (data === null) return malformed;
    if (data.length !== e.uncompressedSize) return limitsExceeded;
    actualTotal += data.length;
    if (actualTotal > limits.maxUncompressedBytes) return limitsExceeded;
    if (
      e.name === '[Content_Types].xml' ||
      e.name === 'xl/workbook.xml' ||
      e.name === 'xl/_rels/workbook.xml.rels'
    ) {
      const xml = data.toString('utf8');
      if (/macroEnabled|vbaProject|activeX/iu.test(xml)) return { ok: false, reason: 'MACROS_PRESENT' };
    }
  }
  return { ok: true, format: 'XLSX' };
}
