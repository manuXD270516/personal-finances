import { crc32 } from 'node:zlib';

/**
 * ZIP secuencial del archivo de contenidos del export (openspec add-document-attachments, tarea 8.2; D315): entradas
 * SIN comprimir (los PDF, imágenes y XLSX ya lo están) con cabecera local completa (tamaño y CRC-32 conocidos porque
 * cada documento se lee entero —≤ 25 MiB— antes de emitirse), de modo que ni el escritor ni el lector necesitan más de
 * UNA entrada en memoria. El directorio central se emite al final para que cualquier `unzip` lo abra. ZIP clásico (sin
 * ZIP64): el archivo completo debe medir < 4 GiB.
 */
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const U32_MAX = 0xffffffff;

export class ContentsArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentsArchiveError';
  }
}

export interface ArchiveEntry {
  readonly name: string;
  readonly data: Buffer;
}

function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.min(Math.max(at.getUTCFullYear(), 1980), 2107);
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

/** Emite el ZIP entrada por entrada. Un error de la fuente aborta el flujo (el consumidor descarta el objeto). */
export async function* writeArchive(
  entries: AsyncIterable<ArchiveEntry>,
  modifiedAt: Date,
): AsyncGenerator<Buffer> {
  const stamp = dosDateTime(modifiedAt);
  const central: { name: Buffer; crc: number; size: number; offset: number }[] = [];
  let offset = 0;
  for await (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    if (name.length === 0 || name.length > 0xffff) throw new ContentsArchiveError('invalid entry name');
    if (central.length >= 0xfffe) throw new ContentsArchiveError('too many entries');
    if (offset + entry.data.length + 30 + name.length >= U32_MAX) {
      throw new ContentsArchiveError('the contents archive exceeds the classic ZIP limit (4 GiB)');
    }
    const crc = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(SIG_LOCAL, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(FLAG_UTF8, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(stamp.time, 10);
    header.writeUInt16LE(stamp.date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(entry.data.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    central.push({ name, crc, size: entry.data.length, offset });
    offset += header.length + name.length + entry.data.length;
    yield Buffer.concat([header, name]);
    if (entry.data.length > 0) yield entry.data;
  }
  const parts: Buffer[] = [];
  for (const e of central) {
    const h = Buffer.alloc(46);
    h.writeUInt32LE(SIG_CENTRAL, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(20, 6);
    h.writeUInt16LE(FLAG_UTF8, 8);
    h.writeUInt16LE(0, 10);
    h.writeUInt16LE(stamp.time, 12);
    h.writeUInt16LE(stamp.date, 14);
    h.writeUInt32LE(e.crc, 16);
    h.writeUInt32LE(e.size, 20);
    h.writeUInt32LE(e.size, 24);
    h.writeUInt16LE(e.name.length, 28);
    h.writeUInt32LE(e.offset, 42);
    parts.push(h, e.name);
  }
  const directory = Buffer.concat(parts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  yield Buffer.concat([directory, eocd]);
}

export interface ReadLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
}

const SAFE_NAME = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\\0:]+$/u;

/** Lector por demanda de un flujo de bytes (sin acumular más de lo pedido). */
class ByteReader {
  private readonly iterator: AsyncIterator<Buffer | Uint8Array>;
  private buffer: Buffer = Buffer.alloc(0);
  private ended = false;

  constructor(source: AsyncIterable<Buffer | Uint8Array>) {
    this.iterator = source[Symbol.asyncIterator]();
  }

  /** Exactamente `n` bytes, o `null` si el flujo termina antes (con 0 bytes leídos o parciales). */
  async take(n: number): Promise<Buffer | null> {
    while (this.buffer.length < n && !this.ended) {
      const next = await this.iterator.next();
      if (next.done) {
        this.ended = true;
        break;
      }
      const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
      this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    }
    if (this.buffer.length < n) return null;
    const out = this.buffer.subarray(0, n);
    this.buffer = this.buffer.subarray(n);
    return out;
  }

  /** Cierra la fuente sin consumir el resto. */
  async close(): Promise<void> {
    await this.iterator.return?.();
  }
}

/**
 * Lee un ZIP producido por `writeArchive` de forma secuencial (por cabeceras locales), validando cada entrada: método
 * 0, sin descriptor de datos, nombre seguro y único, tamaño ≤ `maxEntryBytes`, total ≤ `maxTotalBytes`, CRC-32. El
 * archivo viene del usuario: cualquier incoherencia lanza `ContentsArchiveError`.
 */
export async function* readArchive(
  source: AsyncIterable<Buffer | Uint8Array>,
  limits: ReadLimits,
): AsyncGenerator<ArchiveEntry> {
  const reader = new ByteReader(source);
  const seen = new Set<string>();
  let total = 0;
  try {
    for (;;) {
      const sig = await reader.take(4);
      if (sig === null) throw new ContentsArchiveError('truncated archive');
      const signature = sig.readUInt32LE(0);
      if (signature === SIG_CENTRAL || signature === SIG_EOCD) return;
      if (signature !== SIG_LOCAL) throw new ContentsArchiveError('not a contents archive');
      const rest = await reader.take(26);
      if (rest === null) throw new ContentsArchiveError('truncated archive');
      const flags = rest.readUInt16LE(2);
      const method = rest.readUInt16LE(4);
      const crc = rest.readUInt32LE(10);
      const compressed = rest.readUInt32LE(14);
      const size = rest.readUInt32LE(18);
      const nameLen = rest.readUInt16LE(22);
      const extraLen = rest.readUInt16LE(24);
      if ((flags & 0x09) !== 0)
        throw new ContentsArchiveError('encrypted or streamed entries are not supported');
      if (method !== 0 || compressed !== size)
        throw new ContentsArchiveError('unsupported compression method');
      if (seen.size >= limits.maxEntries) throw new ContentsArchiveError('too many entries');
      if (size > limits.maxEntryBytes) throw new ContentsArchiveError('entry too large');
      total += size;
      if (total > limits.maxTotalBytes) throw new ContentsArchiveError('archive too large');
      const nameBytes = await reader.take(nameLen);
      if (nameBytes === null) throw new ContentsArchiveError('truncated archive');
      if (extraLen > 0 && (await reader.take(extraLen)) === null)
        throw new ContentsArchiveError('truncated archive');
      const name = nameBytes.toString('utf8');
      if (!SAFE_NAME.test(name) || name.endsWith('/')) throw new ContentsArchiveError('invalid entry name');
      if (seen.has(name)) throw new ContentsArchiveError('duplicate entry');
      seen.add(name);
      const data = size === 0 ? Buffer.alloc(0) : await reader.take(size);
      if (data === null) throw new ContentsArchiveError('truncated archive');
      if (crc32(data) !== crc) throw new ContentsArchiveError('entry CRC-32 mismatch');
      yield { name, data };
    }
  } finally {
    await reader.close();
  }
}
