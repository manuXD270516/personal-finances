import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DecryptStream,
  ENVELOPE_CHUNK_BYTES,
  ENVELOPE_HEADER_BYTES,
  EnvelopeIntegrityError,
  decryptEnvelope,
  encryptEnvelope,
  newDataKey,
  sha256Of,
} from './envelope.js';
import { KeyUnwrapError, LocalKeyringProvider } from './key-provider.js';

const streamDecrypt = async (encrypted: Buffer, key: Buffer, split = 7919): Promise<Buffer> => {
  const out: Buffer[] = [];
  const parts: Buffer[] = [];
  for (let i = 0; i < encrypted.length; i += split) parts.push(encrypted.subarray(i, i + split));
  await pipeline(
    Readable.from(parts),
    new DecryptStream(key),
    async function* (source) {
      for await (const chunk of source) out.push(chunk as Buffer);
      yield Buffer.alloc(0);
    },
    async (source) => {
      for await (const _ of source) void _;
    },
  );
  return Buffer.concat(out);
};

describe('cifrado de sobre AES-256-GCM por bloques (identity/workspace-portability)', () => {
  it('[TC-IDENTITY-EXPORT-005] el objeto cifrado no contiene texto en claro ni la firma ZIP', () => {
    const plain = Buffer.concat([
      Buffer.from('PK\u0003\u0004'),
      Buffer.from('Bank A 3099.10 BOB '.repeat(500)),
    ]);
    const key = newDataKey();
    const enc = encryptEnvelope(plain, key);
    expect(enc.subarray(0, 2).toString('ascii')).not.toBe('PK');
    expect(enc.includes(Buffer.from('Bank A'))).toBe(false);
    expect(enc.includes(Buffer.from('3099.10'))).toBe(false);
    expect(decryptEnvelope(enc, key).equals(plain)).toBe(true);
  });

  it('[TC-IDENTITY-EXPORT-005] ida y vuelta para tamaños en los bordes de bloque (vacío, 1, 64 KiB ± 1, varios bloques)', async () => {
    const key = newDataKey();
    for (const size of [
      0,
      1,
      ENVELOPE_CHUNK_BYTES - 1,
      ENVELOPE_CHUNK_BYTES,
      ENVELOPE_CHUNK_BYTES + 1,
      ENVELOPE_CHUNK_BYTES * 3,
      200_000,
    ]) {
      const plain = randomBytes(size);
      const enc = encryptEnvelope(plain, key);
      expect(decryptEnvelope(enc, key).equals(plain), `memoria ${size}`).toBe(true);
      expect((await streamDecrypt(enc, key)).equals(plain), `streaming ${size}`).toBe(true);
    }
  });

  it('[TC-IDENTITY-EXPORT-005] PBT: cualquier contenido sobrevive y cada cifrado usa nonces distintos', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 5000 }), (bytes) => {
        const key = newDataKey();
        const plain = Buffer.from(bytes);
        const a = encryptEnvelope(plain, key);
        const b = encryptEnvelope(plain, key);
        expect(a.equals(b)).toBe(false);
        expect(decryptEnvelope(a, key).equals(plain)).toBe(true);
      }),
      { numRuns: 30 },
    );
  });

  it('[TC-IDENTITY-EXPORT-005] alterar CUALQUIER byte (cabecera, cifrado o tag) se detecta', () => {
    const key = newDataKey();
    const plain = randomBytes(ENVELOPE_CHUNK_BYTES * 2 + 100);
    const enc = encryptEnvelope(plain, key);
    for (const pos of [
      0,
      4,
      5,
      ENVELOPE_HEADER_BYTES - 1,
      ENVELOPE_HEADER_BYTES,
      ENVELOPE_HEADER_BYTES + 100,
      enc.length - 1,
      ENVELOPE_HEADER_BYTES + ENVELOPE_CHUNK_BYTES + 16 + 5,
    ]) {
      const bad = Buffer.from(enc);
      bad[pos] = (bad[pos] as number) ^ 0x01;
      expect(() => decryptEnvelope(bad, key), `byte ${pos}`).toThrow(EnvelopeIntegrityError);
    }
  });

  it('[TC-IDENTITY-EXPORT-005] truncar, extender o reordenar bloques se detecta; otra clave no descifra', () => {
    const key = newDataKey();
    const plain = randomBytes(ENVELOPE_CHUNK_BYTES * 3);
    const enc = encryptEnvelope(plain, key);
    const record = ENVELOPE_CHUNK_BYTES + 16;
    expect(() => decryptEnvelope(enc.subarray(0, ENVELOPE_HEADER_BYTES + record * 2), key)).toThrow(
      EnvelopeIntegrityError,
    );
    expect(() => decryptEnvelope(enc.subarray(0, enc.length - 1), key)).toThrow(EnvelopeIntegrityError);
    expect(() => decryptEnvelope(Buffer.concat([enc, Buffer.from([1, 2, 3])]), key)).toThrow(
      EnvelopeIntegrityError,
    );
    expect(() =>
      decryptEnvelope(
        Buffer.concat([enc, enc.subarray(ENVELOPE_HEADER_BYTES, ENVELOPE_HEADER_BYTES + record)]),
        key,
      ),
    ).toThrow(EnvelopeIntegrityError);
    const swapped = Buffer.concat([
      enc.subarray(0, ENVELOPE_HEADER_BYTES),
      enc.subarray(ENVELOPE_HEADER_BYTES + record, ENVELOPE_HEADER_BYTES + record * 2),
      enc.subarray(ENVELOPE_HEADER_BYTES, ENVELOPE_HEADER_BYTES + record),
      enc.subarray(ENVELOPE_HEADER_BYTES + record * 2),
    ]);
    expect(() => decryptEnvelope(swapped, key)).toThrow(EnvelopeIntegrityError);
    expect(() => decryptEnvelope(enc, newDataKey())).toThrow(EnvelopeIntegrityError);
    expect(() => decryptEnvelope(Buffer.alloc(3), key)).toThrow(EnvelopeIntegrityError);
  });

  it('[TC-IDENTITY-EXPORT-005] el flujo no emite bytes de un bloque alterado y falla con EnvelopeIntegrityError', async () => {
    const key = newDataKey();
    const enc = encryptEnvelope(randomBytes(ENVELOPE_CHUNK_BYTES * 2 + 10), key);
    const bad = Buffer.from(enc);
    bad[enc.length - 3] = (bad[enc.length - 3] as number) ^ 0xff;
    await expect(streamDecrypt(bad, key)).rejects.toThrow(EnvelopeIntegrityError);
    await expect(streamDecrypt(enc.subarray(0, 5), key)).rejects.toThrow(EnvelopeIntegrityError);
  });

  it('sha256Of es el SHA-256 del contenido', () => {
    expect(sha256Of('abc').toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('llavero de claves maestras (cifrado de sobre, rotación)', () => {
  const k = (n: number) => Buffer.alloc(32, n).toString('base64url');

  it('[TC-IDENTITY-EXPORT-005] envuelve y desenvuelve la clave de datos con la clave vigente y su contexto', async () => {
    const ring = new LocalKeyringProvider(`k1:${k(1)},k2:${k(2)}`, 'k2');
    const data = newDataKey();
    const wrapped = await ring.wrap(data, 'ws|e1');
    expect(wrapped.keyId).toBe('k2');
    expect(wrapped.wrappedKey).toHaveLength(12 + 32 + 16);
    expect(Buffer.from(wrapped.wrappedKey).includes(data)).toBe(false);
    expect((await ring.unwrap(wrapped, 'ws|e1')).equals(data)).toBe(true);
  });

  it('[TC-IDENTITY-EXPORT-005] otra clave maestra, otro contexto o un envoltorio alterado no descifran', async () => {
    const ring = new LocalKeyringProvider(`k1:${k(1)}`);
    const other = new LocalKeyringProvider(`k1:${k(9)}`);
    const wrapped = await ring.wrap(newDataKey(), 'ws|e1');
    await expect(other.unwrap(wrapped, 'ws|e1')).rejects.toThrow(KeyUnwrapError);
    await expect(ring.unwrap(wrapped, 'ws|e2')).rejects.toThrow(KeyUnwrapError);
    const bad = Buffer.from(wrapped.wrappedKey);
    bad[20] = (bad[20] as number) ^ 1;
    await expect(ring.unwrap({ ...wrapped, wrappedKey: bad }, 'ws|e1')).rejects.toThrow(KeyUnwrapError);
    await expect(
      ring.unwrap({ keyId: 'k-retirada', wrappedKey: wrapped.wrappedKey }, 'ws|e1'),
    ).rejects.toThrow(KeyUnwrapError);
    await expect(ring.unwrap({ ...wrapped, wrappedKey: Buffer.alloc(3) }, 'ws|e1')).rejects.toThrow(
      KeyUnwrapError,
    );
  });

  it('rotación: los exports envueltos con una clave anterior siguen abriéndose mientras siga en el llavero', async () => {
    const before = new LocalKeyringProvider(`k1:${k(1)}`);
    const wrapped = await before.wrap(newDataKey(), 'c');
    const after = new LocalKeyringProvider(`k2:${k(2)},k1:${k(1)}`, 'k2');
    expect(after.activeKeyId).toBe('k2');
    expect((await after.wrap(newDataKey(), 'c')).keyId).toBe('k2');
    await expect(after.unwrap(wrapped, 'c')).resolves.toBeInstanceOf(Buffer);
    expect(after.keyIds()).toEqual(['k2', 'k1']);
  });

  it('acepta la clave maestra en hexadecimal (openssl rand -hex 32) y en base64url', async () => {
    const hex = Buffer.alloc(32, 5).toString('hex');
    const a = new LocalKeyringProvider(`k1:${hex}`);
    const b = new LocalKeyringProvider(`k1:${Buffer.alloc(32, 5).toString('base64url')}`);
    const data = newDataKey();
    expect((await b.unwrap(await a.wrap(data, 'c'), 'c')).equals(data)).toBe(true);
  });

  it('rechaza claves que no son de 32 bytes o una clave vigente fuera del llavero', () => {
    expect(() => new LocalKeyringProvider(`k1:${Buffer.alloc(16).toString('base64url')}`)).toThrow(
      /32 bytes/u,
    );
    expect(() => new LocalKeyringProvider(`k1:${k(1)}`, 'otra')).toThrow(/ACTIVE_KEY_ID/u);
  });
});
