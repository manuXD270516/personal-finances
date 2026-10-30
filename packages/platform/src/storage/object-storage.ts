import { createHash, createHmac } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  UploadPartCommand,
  type S3Client,
} from '@aws-sdk/client-s3';

/**
 * Puerto `ObjectStorage` (ADR-0009; openspec add-document-attachments, tarea 4.3): lo mínimo que necesitan los
 * contextos sobre un almacén compatible con S3. El adapter `S3ObjectStorage` usa el cliente INTERNO para todo salvo la
 * URL presignada, que se firma con el endpoint PÚBLICO (el host forma parte de la firma, SPIKE-07).
 */
export interface PresignedPut {
  readonly url: string;
  readonly method: 'PUT';
  /** Cabeceras que el navegador DEBE enviar tal cual (están firmadas). */
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

export interface ObjectHead {
  readonly contentLength: number;
  /** `x-amz-checksum-sha256` en base64, si el almacenamiento lo guardó. */
  readonly checksumSha256: string | null;
  readonly lastModified: Date | null;
}

export interface ListedObject {
  readonly key: string;
  readonly size: number;
  readonly lastModified: Date;
}

export interface ObjectStorage {
  /**
   * URL de subida (PUT) atada al tamaño EXACTO, al tipo y a la suma SHA-256 (en base64) declarados; vence en
   * `expiresInSeconds`. El contenido no pasa por la API (FR-DOCUMENTS-001).
   */
  presignPut(input: {
    readonly bucket: string;
    readonly key: string;
    readonly contentType: string;
    readonly contentLength: number;
    readonly sha256Base64: string;
    readonly expiresInSeconds: number;
  }): PresignedPut;
  /** `null` si el objeto no existe. */
  head(bucket: string, key: string): Promise<ObjectHead | null>;
  /** Flujo del objeto; con `range` (`bytes=a-b`) solo ese tramo. Lanza `ObjectMissingError` si no existe. */
  get(bucket: string, key: string, range?: string): Promise<Readable>;
  put(bucket: string, key: string, body: Buffer, contentType?: string): Promise<void>;
  /**
   * Sube un flujo SIN cargarlo entero en memoria (multipart S3 con partes de 8 MiB; un objeto menor se sube de una
   * vez). Con `maxBytes`, un exceso aborta la subida (sin dejar partes) y lanza `ObjectTooLargeError`.
   */
  putStream(
    bucket: string,
    key: string,
    source: AsyncIterable<Buffer | Uint8Array>,
    options?: { readonly contentType?: string; readonly maxBytes?: number },
  ): Promise<{ readonly size: number }>;
  /** Borra el objeto (en un bucket versionado deja un marcador: use `deleteAllVersions`). */
  delete(bucket: string, key: string): Promise<void>;
  /** Borra TODAS las versiones y marcadores de la clave (crypto-shredding completo en buckets versionados). */
  deleteAllVersions(bucket: string, key: string): Promise<void>;
  list(bucket: string, prefix: string): AsyncIterable<ListedObject>;
}

/** El flujo subido por `putStream` superó `maxBytes`. */
export class ObjectTooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`the stream exceeds ${maxBytes} bytes`);
    this.name = 'ObjectTooLargeError';
  }
}

/** Tamaño de parte del multipart (el mínimo de S3 es 5 MiB salvo la última). */
export const MULTIPART_PART_BYTES = 8 * 1024 * 1024;

/**
 * Sube un flujo a S3 por multipart sin cargarlo entero en memoria (partes de 8 MiB; un objeto menor se sube de una
 * vez). Con `maxBytes`, un exceso aborta la subida (sin dejar partes) y lanza `ObjectTooLargeError`. Lo comparten
 * `S3ObjectStorage` y los almacenes de otros contextos que ya tienen su cliente S3.
 */
export async function putStreamMultipart(
  client: S3Client,
  bucket: string,
  key: string,
  source: AsyncIterable<Buffer | Uint8Array>,
  options: { readonly contentType?: string; readonly maxBytes?: number } = {},
): Promise<{ readonly size: number }> {
  const contentType = options.contentType ?? 'application/octet-stream';
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  let uploadId: string | undefined;
  const parts: { ETag: string; PartNumber: number }[] = [];
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let size = 0;
  const flush = async (): Promise<void> => {
    const body = Buffer.concat(pending, pendingBytes);
    pending = [];
    pendingBytes = 0;
    if (uploadId === undefined) {
      const created = await client.send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      );
      uploadId = created.UploadId;
    }
    const partNumber = parts.length + 1;
    const res = await client.send(
      new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: body,
        ContentLength: body.length,
      }),
    );
    parts.push({ ETag: res.ETag as string, PartNumber: partNumber });
  };
  try {
    for await (const chunk of source) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) throw new ObjectTooLargeError(maxBytes);
      pending.push(buf);
      pendingBytes += buf.length;
      if (pendingBytes >= MULTIPART_PART_BYTES) await flush();
    }
    if (uploadId === undefined) {
      const body = Buffer.concat(pending, pendingBytes);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentLength: body.length,
          ContentType: contentType,
        }),
      );
      return { size };
    }
    if (pendingBytes > 0) await flush();
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
    return { size };
  } catch (err) {
    if (uploadId !== undefined) {
      await client
        .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
        .catch(() => undefined);
    }
    throw err;
  }
}

export class ObjectMissingError extends Error {
  constructor(bucket: string, key: string) {
    super(`object ${bucket}/${key} does not exist`);
    this.name = 'ObjectMissingError';
  }
}

const status = (err: unknown): number | undefined =>
  (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const isMissing = (err: unknown): boolean =>
  status(err) === 404 ||
  (err as { name?: string })?.name === 'NoSuchKey' ||
  (err as { name?: string })?.name === 'NotFound';

export interface S3ObjectStorageOptions {
  /** Cliente S3 interno (endpoint de la red de contenedores). */
  readonly client: S3Client;
  /** Endpoint público con el que se firman las URL presignadas (alcanzable por el navegador). */
  readonly publicEndpoint: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly now?: () => Date;
}

const rfc3986 = (s: string): string =>
  encodeURIComponent(s).replace(/[!'()*]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac('sha256', key).update(data, 'utf8').digest();
const sha256Hex = (data: string): string => createHash('sha256').update(data, 'utf8').digest('hex');

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly now: () => Date;

  constructor(private readonly options: S3ObjectStorageOptions) {
    this.client = options.client;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * SigV4 con autenticación en la query (path-style). Cabeceras firmadas: `content-length`, `content-type`, `host` y
   * `x-amz-checksum-sha256` (esta última NO se mueve a la query: el almacenamiento compara el cuerpo con ella y
   * rechaza un contenido sustituido, SPIKE-07). Cuerpo `UNSIGNED-PAYLOAD`.
   */
  presignPut(input: Parameters<ObjectStorage['presignPut']>[0]): PresignedPut {
    const base = new URL(this.options.publicEndpoint);
    const at = this.now();
    const amzDate = at
      .toISOString()
      .replace(/[-:]/gu, '')
      .replace(/\.\d{3}/u, '');
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${this.options.region}/s3/aws4_request`;
    const path = `${base.pathname.replace(/\/$/u, '')}/${rfc3986(input.bucket)}/${input.key
      .split('/')
      .map(rfc3986)
      .join('/')}`;
    const signedHeaders = 'content-length;content-type;host;x-amz-checksum-sha256';
    const query: [string, string][] = [
      ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
      ['X-Amz-Credential', `${this.options.accessKey}/${scope}`],
      ['X-Amz-Date', amzDate],
      ['X-Amz-Expires', String(input.expiresInSeconds)],
      ['X-Amz-SignedHeaders', signedHeaders],
    ];
    const canonicalQuery = query
      .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('&');
    const canonicalHeaders =
      `content-length:${input.contentLength}\n` +
      `content-type:${input.contentType}\n` +
      `host:${base.host}\n` +
      `x-amz-checksum-sha256:${input.sha256Base64}\n`;
    const canonicalRequest = [
      'PUT',
      path,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
    const kDate = hmac(`AWS4${this.options.secretKey}`, dateStamp);
    const kRegion = hmac(kDate, this.options.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
    return {
      url: `${base.protocol}//${base.host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`,
      method: 'PUT',
      headers: { 'Content-Type': input.contentType, 'x-amz-checksum-sha256': input.sha256Base64 },
      expiresAt: new Date(at.getTime() + input.expiresInSeconds * 1000),
    };
  }

  async head(bucket: string, key: string): Promise<ObjectHead | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: 'ENABLED' }),
      );
      return {
        contentLength: Number(out.ContentLength ?? 0),
        checksumSha256: out.ChecksumSHA256 ?? null,
        lastModified: out.LastModified ?? null,
      };
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }

  async get(bucket: string, key: string, range?: string): Promise<Readable> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key, ...(range ? { Range: range } : {}) }),
      );
      return out.Body as Readable;
    } catch (err) {
      if (isMissing(err)) throw new ObjectMissingError(bucket, key);
      throw err;
    }
  }

  async put(
    bucket: string,
    key: string,
    body: Buffer,
    contentType = 'application/octet-stream',
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentLength: body.length,
        ContentType: contentType,
      }),
    );
  }

  putStream(
    bucket: string,
    key: string,
    source: AsyncIterable<Buffer | Uint8Array>,
    options: { readonly contentType?: string; readonly maxBytes?: number } = {},
  ): Promise<{ readonly size: number }> {
    return putStreamMultipart(this.client, bucket, key, source, options);
  }

  async delete(bucket: string, key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
  }

  async deleteAllVersions(bucket: string, key: string): Promise<void> {
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    let removed = 0;
    for (;;) {
      const page = await this.client.send(
        new ListObjectVersionsCommand({
          Bucket: bucket,
          Prefix: key,
          ...(keyMarker ? { KeyMarker: keyMarker } : {}),
          ...(versionIdMarker ? { VersionIdMarker: versionIdMarker } : {}),
        }),
      );
      const all = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].filter((v) => v.Key === key);
      for (const v of all) {
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: bucket,
            Key: key,
            ...(v.VersionId && v.VersionId !== 'null' ? { VersionId: v.VersionId } : {}),
          }),
        );
        removed += 1;
      }
      if (!page.IsTruncated) break;
      keyMarker = page.NextKeyMarker;
      versionIdMarker = page.NextVersionIdMarker;
    }
    // Sin versiones listadas (bucket sin versioning): el borrado simple elimina el objeto de verdad. Con versiones ya
    // borradas NO se repite: en un bucket versionado dejaría un marcador nuevo.
    if (removed === 0) await this.delete(bucket, key);
  }

  async *list(bucket: string, prefix: string): AsyncIterable<ListedObject> {
    let token: string | undefined;
    do {
      const page = await this.client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ...(token ? { ContinuationToken: token } : {}),
        }),
      );
      for (const o of page.Contents ?? []) {
        if (o.Key)
          yield { key: o.Key, size: Number(o.Size ?? 0), lastModified: o.LastModified ?? new Date(0) };
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
}
