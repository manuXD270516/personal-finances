import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

/**
 * ZIP mínimo (APPNOTE 6.3.x, sin ZIP64, sin cifrado) para el formato `pfos-export`: nombres UTF-8, métodos 0 (store) y
 * 8 (deflate). Sin dependencias externas. El lector es DEFENSIVO (el archivo viene del usuario): límites de entradas y de
 * tamaño descomprimido declarado y real (anti zip-bomb), nombres sin rutas peligrosas, CRC-32 verificado y rechazo de
 * ZIP64, cifrado o entradas duplicadas.
 */
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const U32_MAX = 0xffffffff;

export class ZipFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipFormatError';
  }
}

/** Fecha/hora MS-DOS (zona UTC) de un instante: reproducible y sin tocar el reloj del sistema. */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.min(Math.max(at.getUTCFullYear(), 1980), 2107);
  return {
    time: (at.getUTCHours() << 11) | (at.getUTCMinutes() << 5) | (at.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getUTCMonth() + 1) << 5) | at.getUTCDate(),
  };
}

interface WrittenEntry {
  readonly name: Buffer;
  readonly method: 0 | 8;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly offset: number;
}

export class ZipWriter {
  private readonly parts: Buffer[] = [];
  private readonly entries: WrittenEntry[] = [];
  private offset = 0;
  private readonly stamp: { time: number; date: number };

  constructor(modifiedAt: Date) {
    this.stamp = dosDateTime(modifiedAt);
  }

  add(name: string, data: Buffer): void {
    const nameBytes = Buffer.from(name, 'utf8');
    if (nameBytes.length === 0 || nameBytes.length > 0xffff)
      throw new ZipFormatError('nombre de entrada inválido');
    if (data.length >= U32_MAX || this.offset >= U32_MAX || this.entries.length >= 0xfffe) {
      throw new ZipFormatError('el archivo excede los límites del ZIP clásico');
    }
    const deflated = data.length === 0 ? data : deflateRawSync(data, { level: 6 });
    const method: 0 | 8 = data.length > 0 && deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(SIG_LOCAL, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(FLAG_UTF8, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(this.stamp.time, 10);
    header.writeUInt16LE(this.stamp.date, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    this.entries.push({
      name: nameBytes,
      method,
      crc,
      compressedSize: body.length,
      size: data.length,
      offset: this.offset,
    });
    this.parts.push(header, nameBytes, body);
    this.offset += header.length + nameBytes.length + body.length;
  }

  finish(): Buffer {
    const centralStart = this.offset;
    const central: Buffer[] = [];
    for (const e of this.entries) {
      const h = Buffer.alloc(46);
      h.writeUInt32LE(SIG_CENTRAL, 0);
      h.writeUInt16LE(20, 4);
      h.writeUInt16LE(20, 6);
      h.writeUInt16LE(FLAG_UTF8, 8);
      h.writeUInt16LE(e.method, 10);
      h.writeUInt16LE(this.stamp.time, 12);
      h.writeUInt16LE(this.stamp.date, 14);
      h.writeUInt32LE(e.crc, 16);
      h.writeUInt32LE(e.compressedSize, 20);
      h.writeUInt32LE(e.size, 24);
      h.writeUInt16LE(e.name.length, 28);
      h.writeUInt32LE(e.offset, 42);
      central.push(h, e.name);
    }
    const centralBytes = Buffer.concat(central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD, 0);
    eocd.writeUInt16LE(this.entries.length, 8);
    eocd.writeUInt16LE(this.entries.length, 10);
    eocd.writeUInt32LE(centralBytes.length, 12);
    eocd.writeUInt32LE(centralStart, 16);
    return Buffer.concat([...this.parts, centralBytes, eocd]);
  }
}

export interface ZipLimits {
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 256,
  maxEntryBytes: 1024 * 1024 * 1024,
  maxTotalBytes: 2 * 1024 * 1024 * 1024,
};

interface ReadEntry {
  readonly name: string;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly offset: number;
}

const SAFE_NAME = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\\0:]+$/u;

export class ZipReader {
  private readonly byName = new Map<string, ReadEntry>();

  private constructor(
    private readonly data: Buffer,
    entries: readonly ReadEntry[],
  ) {
    for (const e of entries) this.byName.set(e.name, e);
  }

  static open(data: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipReader {
    if (data.length < 22) throw new ZipFormatError('no es un archivo ZIP');
    let eocd = -1;
    for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i -= 1) {
      if (data.readUInt32LE(i) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new ZipFormatError('no es un archivo ZIP');
    const count = data.readUInt16LE(eocd + 10);
    const centralSize = data.readUInt32LE(eocd + 12);
    const centralOffset = data.readUInt32LE(eocd + 16);
    if (count === 0xffff || centralSize === U32_MAX || centralOffset === U32_MAX) {
      throw new ZipFormatError('ZIP64 no soportado');
    }
    if (count > limits.maxEntries) throw new ZipFormatError('demasiadas entradas');
    if (centralOffset + centralSize > eocd) throw new ZipFormatError('directorio central inválido');
    const entries: ReadEntry[] = [];
    const seen = new Set<string>();
    let total = 0;
    let p = centralOffset;
    for (let i = 0; i < count; i += 1) {
      if (p + 46 > eocd || data.readUInt32LE(p) !== SIG_CENTRAL)
        throw new ZipFormatError('directorio central inválido');
      const flags = data.readUInt16LE(p + 8);
      const method = data.readUInt16LE(p + 10);
      const crc = data.readUInt32LE(p + 16);
      const compressedSize = data.readUInt32LE(p + 20);
      const size = data.readUInt32LE(p + 24);
      const nameLen = data.readUInt16LE(p + 28);
      const extraLen = data.readUInt16LE(p + 30);
      const commentLen = data.readUInt16LE(p + 32);
      const offset = data.readUInt32LE(p + 42);
      const name = data.subarray(p + 46, p + 46 + nameLen).toString('utf8');
      p += 46 + nameLen + extraLen + commentLen;
      if ((flags & 1) !== 0) throw new ZipFormatError('entrada cifrada no soportada');
      if (method !== 0 && method !== 8) throw new ZipFormatError('método de compresión no soportado');
      if (compressedSize === U32_MAX || size === U32_MAX || offset === U32_MAX)
        throw new ZipFormatError('ZIP64 no soportado');
      if (!SAFE_NAME.test(name) || name.endsWith('/')) throw new ZipFormatError('nombre de entrada inválido');
      if (seen.has(name)) throw new ZipFormatError('entrada duplicada');
      if (size > limits.maxEntryBytes) throw new ZipFormatError('entrada demasiado grande');
      total += size;
      if (total > limits.maxTotalBytes) throw new ZipFormatError('contenido descomprimido demasiado grande');
      seen.add(name);
      entries.push({ name, method, crc, compressedSize, size, offset });
    }
    return new ZipReader(data, entries);
  }

  names(): string[] {
    return [...this.byName.keys()];
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Tamaño descomprimido declarado de una entrada (verificado al leerla). */
  sizeOf(name: string): number | undefined {
    return this.byName.get(name)?.size;
  }

  read(name: string): Buffer {
    const e = this.byName.get(name);
    if (!e) throw new ZipFormatError(`falta la entrada ${name}`);
    const o = e.offset;
    if (o + 30 > this.data.length || this.data.readUInt32LE(o) !== SIG_LOCAL) {
      throw new ZipFormatError('entrada inválida');
    }
    const dataStart = o + 30 + this.data.readUInt16LE(o + 26) + this.data.readUInt16LE(o + 28);
    const raw = this.data.subarray(dataStart, dataStart + e.compressedSize);
    if (raw.length !== e.compressedSize) throw new ZipFormatError('entrada truncada');
    let out: Buffer;
    try {
      // `maxOutputLength` = tamaño declarado: una cabecera mentirosa no puede inflar más de lo permitido.
      out = e.method === 8 ? inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) }) : raw;
    } catch {
      throw new ZipFormatError('entrada corrupta');
    }
    if (out.length !== e.size || crc32(out) !== e.crc)
      throw new ZipFormatError('CRC-32 de la entrada inválido');
    return out;
  }
}
