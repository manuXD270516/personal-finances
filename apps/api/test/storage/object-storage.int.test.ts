import { randomUUID } from 'node:crypto';
import { ListObjectVersionsCommand } from '@aws-sdk/client-s3';
import {
  ObjectMissingError,
  ObjectTooLargeError,
  S3ObjectStorage,
  createObjectStorageClient,
} from '@pf/platform/storage';
import { afterAll, describe, expect, inject, it } from 'vitest';

// Suite de contrato del adapter `ObjectStorage` contra SeaweedFS real (openspec add-document-attachments, tarea 4.3;
// TC-SECURITY-UPLOAD-004/005): presign PUT con cabeceras firmadas y endpoint público, head, get (completo y por rango),
// put, delete, borrado de TODAS las versiones y listado por prefijo.
const deps = inject('deps');
const client = createObjectStorageClient({
  OBJECT_STORAGE_ENDPOINT: deps.s3Endpoint,
  OBJECT_STORAGE_REGION: 'us-east-1',
  OBJECT_STORAGE_ACCESS_KEY: deps.s3AccessKey,
  OBJECT_STORAGE_SECRET_KEY: deps.s3SecretKey,
  OBJECT_STORAGE_FORCE_PATH_STYLE: true,
});
const storage = new S3ObjectStorage({
  client,
  publicEndpoint: deps.s3Endpoint,
  region: 'us-east-1',
  accessKey: deps.s3AccessKey,
  secretKey: deps.s3SecretKey,
});
afterAll(() => client.destroy());

const read = async (stream: NodeJS.ReadableStream): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
};

describe('S3ObjectStorage (contrato contra SeaweedFS)', () => {
  it('put, head, get completo y por rango, y delete', async () => {
    const key = `contract/${randomUUID()}`;
    expect(await storage.head(deps.quarantineBucket, key)).toBeNull();
    await expect(storage.get(deps.quarantineBucket, key)).rejects.toBeInstanceOf(ObjectMissingError);
    await storage.put(deps.quarantineBucket, key, Buffer.from('0123456789'));
    expect(await storage.head(deps.quarantineBucket, key)).toMatchObject({ contentLength: 10 });
    expect((await read(await storage.get(deps.quarantineBucket, key))).toString()).toBe('0123456789');
    expect((await read(await storage.get(deps.quarantineBucket, key, 'bytes=2-4'))).toString()).toBe('234');
    await storage.delete(deps.quarantineBucket, key);
    expect(await storage.head(deps.quarantineBucket, key)).toBeNull();
    // Borrar lo inexistente no falla.
    await storage.delete(deps.quarantineBucket, key);
  });

  it('listado por prefijo con tamaño y fecha', async () => {
    const prefix = `contract-list/${randomUUID()}/`;
    for (const name of ['a', 'b', 'c'])
      await storage.put(deps.quarantineBucket, `${prefix}${name}`, Buffer.from(name));
    const listed: string[] = [];
    for await (const o of storage.list(deps.quarantineBucket, prefix)) {
      expect(o.size).toBe(1);
      expect(o.lastModified.getTime()).toBeGreaterThan(0);
      listed.push(o.key);
    }
    expect(listed.sort()).toEqual([`${prefix}a`, `${prefix}b`, `${prefix}c`]);
    for (const k of listed) await storage.delete(deps.quarantineBucket, k);
  });

  it('[TC-SECURITY-UPLOAD-016] en el bucket versionado, deleteAllVersions borra todas las versiones y marcadores', async () => {
    const key = `contract-versions/${randomUUID()}`;
    await storage.put(deps.bucket, key, Buffer.from('v1'));
    await storage.put(deps.bucket, key, Buffer.from('v2 más largo'));
    const before = await client.send(new ListObjectVersionsCommand({ Bucket: deps.bucket, Prefix: key }));
    expect((before.Versions ?? []).length).toBeGreaterThanOrEqual(2);
    await storage.deleteAllVersions(deps.bucket, key);
    const after = await client.send(new ListObjectVersionsCommand({ Bucket: deps.bucket, Prefix: key }));
    expect([...(after.Versions ?? []), ...(after.DeleteMarkers ?? [])].filter((v) => v.Key === key)).toEqual(
      [],
    );
    expect(await storage.head(deps.bucket, key)).toBeNull();
  });

  it('[TC-SECURITY-UPLOAD-004] la URL firmada solo sirve con el tamaño, el tipo y la suma firmados', async () => {
    const key = `contract-put/${randomUUID()}`;
    const body = Buffer.from('contenido firmado');
    const sha = (await import('node:crypto')).createHash('sha256').update(body).digest('base64');
    const put = storage.presignPut({
      bucket: deps.quarantineBucket,
      key,
      contentType: 'text/csv',
      contentLength: body.length,
      sha256Base64: sha,
      expiresInSeconds: 60,
    });
    expect(put.method).toBe('PUT');
    expect(put.headers).toEqual({ 'Content-Type': 'text/csv', 'x-amz-checksum-sha256': sha });
    expect(new URL(put.url).searchParams.get('X-Amz-Expires')).toBe('60');
    const swapped = Buffer.from('contenido firmadX');
    expect(
      (await fetch(put.url, { method: 'PUT', headers: put.headers, body: swapped })).status,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (
        await fetch(put.url, {
          method: 'PUT',
          headers: { ...put.headers, 'Content-Type': 'text/html' },
          body,
        })
      ).status,
    ).toBeGreaterThanOrEqual(400);
    const ok = await fetch(put.url, { method: 'PUT', headers: put.headers, body });
    expect(ok.status).toBe(200);
    expect((await storage.head(deps.quarantineBucket, key))?.contentLength).toBe(body.length);
    await storage.delete(deps.quarantineBucket, key);
  });

  it('[TC-DOCUMENTS-ATTACH-024] putStream sube por multipart un flujo de 20 MiB sin cargarlo entero y uno pequeño de una vez', async () => {
    const big = `contract-stream/${randomUUID()}`;
    const part = Buffer.alloc(1024 * 1024, 5);
    const source = (async function* () {
      for (let i = 0; i < 20; i += 1) yield part;
    })();
    expect(await storage.putStream(deps.quarantineBucket, big, source)).toEqual({ size: 20 * 1024 * 1024 });
    expect((await storage.head(deps.quarantineBucket, big))?.contentLength).toBe(20 * 1024 * 1024);
    const small = `contract-stream/${randomUUID()}`;
    await storage.putStream(
      deps.quarantineBucket,
      small,
      (async function* () {
        yield Buffer.from('pequeño');
      })(),
    );
    expect((await read(await storage.get(deps.quarantineBucket, small))).toString()).toBe('pequeño');
    await storage.delete(deps.quarantineBucket, big);
    await storage.delete(deps.quarantineBucket, small);
  }, 120_000);

  it('[TC-DOCUMENTS-ATTACH-024] putStream con tope aborta, lanza ObjectTooLargeError y no deja el objeto', async () => {
    const key = `contract-stream/${randomUUID()}`;
    const source = (async function* () {
      for (let i = 0; i < 12; i += 1) yield Buffer.alloc(1024 * 1024, 1);
    })();
    await expect(
      storage.putStream(deps.quarantineBucket, key, source, { maxBytes: 10 * 1024 * 1024 }),
    ).rejects.toBeInstanceOf(ObjectTooLargeError);
    expect(await storage.head(deps.quarantineBucket, key)).toBeNull();
  }, 120_000);
});
