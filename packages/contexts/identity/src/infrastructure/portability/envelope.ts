import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

/**
 * Cifrado de sobre del archivo de export (openspec add-workspace-export, design decisión 4; formato documentado en
 * contracts/export/v1/ENCRYPTION.md): AES-256-GCM por bloques de 64 KiB con una clave de datos propia de cada archivo.
 *
 *   cabecera (13 B) = "PFXE" | versión (1 B) | prefijo de nonce aleatorio (8 B)
 *   bloque i        = cifrado (≤ 64 KiB) | tag GCM (16 B)
 *   nonce_i         = prefijo (8 B) | i (uint32 BE)
 *   AAD_i           = cabecera | i (uint32 BE) | marca de último bloque (1 B)
 *
 * El número de bloque y la marca de último bloque van en el AAD: reordenar, duplicar, truncar o extender el archivo
 * invalida el tag de algún bloque. Cualquier fallo ⇒ `EnvelopeIntegrityError` (la API responde `EXPORT_FILE_CORRUPTED`).
 */
export const ENVELOPE_MAGIC = Buffer.from('PFXE', 'ascii');
export const ENVELOPE_VERSION = 1;
export const ENVELOPE_CHUNK_BYTES = 64 * 1024;
const TAG_BYTES = 16;
const PREFIX_BYTES = 8;
export const ENVELOPE_HEADER_BYTES = ENVELOPE_MAGIC.length + 1 + PREFIX_BYTES;
const RECORD_BYTES = ENVELOPE_CHUNK_BYTES + TAG_BYTES;
export const DATA_KEY_BYTES = 32;

export class EnvelopeIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeIntegrityError';
  }
}

const be32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
};

const nonceOf = (prefix: Buffer, index: number): Buffer => Buffer.concat([prefix, be32(index)]);
const aadOf = (header: Buffer, index: number, last: boolean): Buffer =>
  Buffer.concat([header, be32(index), Buffer.from([last ? 1 : 0])]);

function assertKey(key: Buffer): void {
  if (key.length !== DATA_KEY_BYTES) throw new Error('la clave de datos debe tener 32 bytes');
}

/** Clave de datos aleatoria de 256 bits (una por archivo). */
export const newDataKey = (): Buffer => randomBytes(DATA_KEY_BYTES);

/** Cifra `plain` en memoria; devuelve el archivo cifrado completo (cabecera + bloques). */
export function encryptEnvelope(plain: Buffer, dataKey: Buffer): Buffer {
  assertKey(dataKey);
  const prefix = randomBytes(PREFIX_BYTES);
  const header = Buffer.concat([ENVELOPE_MAGIC, Buffer.from([ENVELOPE_VERSION]), prefix]);
  const parts: Buffer[] = [header];
  // Un archivo vacío (o múltiplo exacto del bloque) también termina en un bloque marcado como último.
  const total = Math.max(1, Math.ceil(plain.length / ENVELOPE_CHUNK_BYTES));
  for (let i = 0; i < total; i += 1) {
    const chunk = plain.subarray(i * ENVELOPE_CHUNK_BYTES, (i + 1) * ENVELOPE_CHUNK_BYTES);
    const cipher = createCipheriv('aes-256-gcm', dataKey, nonceOf(prefix, i));
    cipher.setAAD(aadOf(header, i, i === total - 1));
    parts.push(cipher.update(chunk), cipher.final(), cipher.getAuthTag());
  }
  return Buffer.concat(parts);
}

/**
 * Descifrado en streaming: valida el tag de CADA bloque antes de emitirlo. Un bloque completo se procesa solo cuando
 * se sabe si es el último (hay datos posteriores o el flujo terminó), porque la marca de último bloque va en el AAD.
 */
export class DecryptStream extends Transform {
  private pending: Buffer = Buffer.alloc(0);
  private header: Buffer | null = null;
  private index = 0;

  constructor(private readonly dataKey: Buffer) {
    super();
    assertKey(dataKey);
  }

  private open(record: Buffer, last: boolean): Buffer {
    const header = this.header as Buffer;
    if (record.length < TAG_BYTES) throw new EnvelopeIntegrityError('bloque truncado');
    const prefix = header.subarray(ENVELOPE_MAGIC.length + 1);
    try {
      const decipher = createDecipheriv('aes-256-gcm', this.dataKey, nonceOf(prefix, this.index));
      decipher.setAAD(aadOf(header, this.index, last));
      decipher.setAuthTag(record.subarray(record.length - TAG_BYTES));
      const plain = Buffer.concat([
        decipher.update(record.subarray(0, record.length - TAG_BYTES)),
        decipher.final(),
      ]);
      this.index += 1;
      return plain;
    } catch {
      throw new EnvelopeIntegrityError('autenticación del bloque fallida');
    }
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    try {
      this.pending = Buffer.concat([this.pending, chunk]);
      if (!this.header) {
        if (this.pending.length < ENVELOPE_HEADER_BYTES) return cb();
        const header = this.pending.subarray(0, ENVELOPE_HEADER_BYTES);
        if (
          !header.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC) ||
          header[ENVELOPE_MAGIC.length] !== ENVELOPE_VERSION
        ) {
          throw new EnvelopeIntegrityError('cabecera de sobre inválida');
        }
        this.header = Buffer.from(header);
        this.pending = this.pending.subarray(ENVELOPE_HEADER_BYTES);
      }
      // Un registro completo con datos detrás no es el último.
      while (this.pending.length > RECORD_BYTES) {
        const record = this.pending.subarray(0, RECORD_BYTES);
        this.pending = this.pending.subarray(RECORD_BYTES);
        this.push(this.open(record, false));
      }
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }

  override _flush(cb: TransformCallback): void {
    try {
      if (!this.header) throw new EnvelopeIntegrityError('archivo cifrado vacío o truncado');
      this.push(this.open(this.pending, true));
      this.pending = Buffer.alloc(0);
      cb();
    } catch (err) {
      cb(err as Error);
    }
  }
}

/** Descifra un archivo cifrado completo en memoria (lanza `EnvelopeIntegrityError` ante cualquier alteración). */
export function decryptEnvelope(encrypted: Buffer, dataKey: Buffer): Buffer {
  assertKey(dataKey);
  if (encrypted.length < ENVELOPE_HEADER_BYTES + TAG_BYTES)
    throw new EnvelopeIntegrityError('archivo cifrado truncado');
  const header = encrypted.subarray(0, ENVELOPE_HEADER_BYTES);
  if (
    !header.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC) ||
    header[ENVELOPE_MAGIC.length] !== ENVELOPE_VERSION
  ) {
    throw new EnvelopeIntegrityError('cabecera de sobre inválida');
  }
  const prefix = header.subarray(ENVELOPE_MAGIC.length + 1);
  const body = encrypted.subarray(ENVELOPE_HEADER_BYTES);
  const total = Math.ceil(body.length / RECORD_BYTES);
  const parts: Buffer[] = [];
  for (let i = 0; i < total; i += 1) {
    const record = body.subarray(i * RECORD_BYTES, (i + 1) * RECORD_BYTES);
    if (record.length < TAG_BYTES) throw new EnvelopeIntegrityError('bloque truncado');
    try {
      const decipher = createDecipheriv('aes-256-gcm', dataKey, nonceOf(prefix, i));
      decipher.setAAD(aadOf(header, i, i === total - 1));
      decipher.setAuthTag(record.subarray(record.length - TAG_BYTES));
      parts.push(decipher.update(record.subarray(0, record.length - TAG_BYTES)), decipher.final());
    } catch {
      throw new EnvelopeIntegrityError('autenticación del bloque fallida');
    }
  }
  return Buffer.concat(parts);
}

export const sha256Of = (data: Buffer | string): Buffer => createHash('sha256').update(data).digest();
