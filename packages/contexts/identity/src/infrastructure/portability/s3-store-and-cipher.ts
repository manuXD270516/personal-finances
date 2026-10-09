import { createHash } from 'node:crypto';
import { type Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { DomainError } from '@pf/shared-kernel';
import {
  ObjectMissingError,
  type EnvelopeCipher,
  type ExportKeyProvider,
  type ExportObjectStore,
  type SealedArchive,
  type WrappedDataKey,
} from '../../application/portability/ports.js';
import {
  DecryptStream,
  EnvelopeIntegrityError,
  decryptEnvelope,
  encryptEnvelope,
  newDataKey,
} from './envelope.js';
import { KeyUnwrapError } from './key-provider.js';

const status = (err: unknown): number | undefined =>
  (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const missing = (err: unknown): boolean =>
  status(err) === 404 || (err as { name?: string })?.name === 'NoSuchKey';

/**
 * Almacén de objetos S3 (SeaweedFS en local/CI, S3 en cloud) del bucket de exports (ADR-0009). Guarda SOLO objetos ya
 * cifrados por la aplicación; el SSE del bucket (donde exista) es una capa adicional, no la protección principal.
 */
export class S3ExportObjectStore implements ExportObjectStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async put(key: string, body: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: 'application/octet-stream',
      }),
    );
  }

  async openStream(key: string): Promise<Readable> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) throw new ObjectMissingError(key);
      return res.Body as Readable;
    } catch (err) {
      if (missing(err)) throw new ObjectMissingError(key);
      throw err;
    }
  }

  async get(key: string): Promise<Buffer> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!res.Body) throw new ObjectMissingError(key);
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (missing(err)) throw new ObjectMissingError(key);
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

const corrupted = (detail: string) => new DomainError('EXPORT_FILE_CORRUPTED', `export file: ${detail}`);

/** Traduce los fallos de cifrado/descifrado al código estable de la API. */
function asDomain(err: unknown): unknown {
  if (err instanceof EnvelopeIntegrityError) return corrupted('integrity check failed');
  if (err instanceof KeyUnwrapError) return corrupted('the encryption key is not available');
  return err;
}

/** Cifrado de sobre sobre el llavero de claves maestras: `seal`/`open`/`verify`/`decryptStream`. */
export class KeyringEnvelopeCipher implements EnvelopeCipher {
  constructor(private readonly keys: ExportKeyProvider) {}

  async seal(plain: Buffer, context: string): Promise<SealedArchive> {
    const dataKey = newDataKey();
    const encrypted = encryptEnvelope(plain, dataKey);
    const wrapped = await this.keys.wrap(dataKey, context);
    return { encrypted, keyId: wrapped.keyId, wrappedKey: wrapped.wrappedKey };
  }

  async open(encrypted: Buffer, wrapped: WrappedDataKey, context: string): Promise<Buffer> {
    try {
      return decryptEnvelope(encrypted, await this.keys.unwrap(wrapped, context));
    } catch (err) {
      throw asDomain(err);
    }
  }

  async verify(
    source: Readable,
    wrapped: WrappedDataKey,
    context: string,
  ): Promise<{ sha256: string; size: number }> {
    let dataKey: Buffer;
    try {
      dataKey = await this.keys.unwrap(wrapped, context);
    } catch (err) {
      source.destroy();
      throw asDomain(err);
    }
    const hash = createHash('sha256');
    let size = 0;
    try {
      await pipeline(
        source,
        new DecryptStream(dataKey),
        new Transform({
          transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback) {
            hash.update(chunk);
            size += chunk.length;
            cb();
          },
        }),
        async (sink) => {
          for await (const _ of sink) void _;
        },
      );
    } catch (err) {
      throw asDomain(err);
    }
    return { sha256: hash.digest('hex'), size };
  }

  async decryptStream(source: Readable, wrapped: WrappedDataKey, context: string): Promise<Readable> {
    let dataKey: Buffer;
    try {
      dataKey = await this.keys.unwrap(wrapped, context);
    } catch (err) {
      source.destroy();
      throw asDomain(err);
    }
    const decrypt = new DecryptStream(dataKey);
    source.on('error', (e) => decrypt.destroy(e));
    return source.pipe(decrypt);
  }
}
