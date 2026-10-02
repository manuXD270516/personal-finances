import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { compose, CommandError, type ComposeContext } from './compose.js';
import { BACKUPS_DIR } from './paths.js';

export interface ObjectEntry {
  readonly key: string;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly md5: string;
}

export interface DumpEntry {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface BackupManifest {
  readonly format: 'pfos-local-backup/v1';
  readonly id: string;
  readonly createdAt: string;
  readonly project: string;
  readonly databases: Record<string, DumpEntry>;
  readonly migrations: string[];
  readonly bucket: string;
  readonly objects: ObjectEntry[];
}

export function s3FromEnv(env: Record<string, string>): S3Client {
  return new S3Client({
    endpoint: env['OBJECT_STORAGE_ENDPOINT'] ?? '',
    region: env['OBJECT_STORAGE_REGION'] || 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env['OBJECT_STORAGE_ACCESS_KEY'] ?? '',
      secretAccessKey: env['OBJECT_STORAGE_SECRET_KEY'] ?? '',
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

export function digest(data: Buffer, algorithm: 'sha256' | 'md5'): string {
  return createHash(algorithm).update(data).digest('hex');
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/** Nombre de fichero seguro en Windows para una key S3 arbitraria. */
export const objectFileName = (key: string): string => encodeURIComponent(key).replace(/\*/g, '%2A');

export async function listAllObjects(s3: S3Client, bucket: string): Promise<{ key: string; etag: string }[]> {
  const out: { key: string; etag: string }[] = [];
  let token: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    for (const o of page.Contents ?? []) out.push({ key: o.Key!, etag: (o.ETag ?? '').replaceAll('"', '') });
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}

export async function getObjectBytes(s3: S3Client, bucket: string, key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}

/** `pg_dump -Fc` dentro del contenedor postgres, volcado en binario a `target` (sin pasar por un shell). */
export async function dumpDatabase(
  ctx: ComposeContext,
  database: string,
  target: string,
): Promise<DumpEntry> {
  const out = createWriteStream(target);
  const closed = new Promise<void>((r) => out.on('close', () => r()));
  const result = await compose(
    ['*'],
    ['exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres', '-d', database, '-Fc', '--no-password'],
    { output: out },
    ctx,
  );
  await closed;
  if (result.code !== 0) throw new CommandError(`pg_dump ${database} falló (código ${result.code})`, result);
  const bytes = readFileSync(target).length;
  return { file: target.split(/[\\/]/).pop()!, bytes, sha256: await fileSha256(target) };
}

export async function psql(ctx: ComposeContext, database: string, sql: string): Promise<string> {
  const result = await compose(
    ['*'],
    [
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-Atc',
      sql,
    ],
    { mode: 'capture' },
    ctx,
  );
  if (result.code !== 0) throw new CommandError(`psql falló: ${result.stderr.trim()}`, result);
  return result.stdout;
}

/** Recrea `database` desde un dump custom: DROP … WITH (FORCE) + `pg_restore --create` (propietarios y ACL incluidos). */
export async function restoreDatabase(
  ctx: ComposeContext,
  database: string,
  dumpPath: string,
): Promise<void> {
  await psql(ctx, 'postgres', `DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  const result = await compose(
    ['*'],
    [
      'exec',
      '-T',
      'postgres',
      'pg_restore',
      '-U',
      'postgres',
      '--create',
      '-d',
      'postgres',
      '--exit-on-error',
      '--no-password',
    ],
    { input: createReadStream(dumpPath), mode: 'capture' },
    ctx,
  );
  if (result.code !== 0)
    throw new CommandError(`pg_restore ${database} falló: ${result.stderr.trim()}`, result);
}

export function backupDir(id: string): string {
  return resolve(BACKUPS_DIR, id);
}

export function resolveBackupId(requested: string | undefined): string {
  if (requested && requested !== 'latest') {
    if (!existsSync(join(backupDir(requested), 'manifest.json')))
      throw new Error(`no existe el backup ${requested}`);
    return requested;
  }
  const ids = existsSync(BACKUPS_DIR)
    ? readdirSync(BACKUPS_DIR)
        .filter((d) => existsSync(join(BACKUPS_DIR, d, 'manifest.json')))
        .sort()
    : [];
  const latest = ids.at(-1);
  if (!latest) throw new Error(`no hay backups en ${BACKUPS_DIR}`);
  return latest;
}

export function readManifest(id: string): BackupManifest {
  return JSON.parse(readFileSync(join(backupDir(id), 'manifest.json'), 'utf8')) as BackupManifest;
}

export function writeManifest(manifest: BackupManifest): void {
  writeFileSync(join(backupDir(manifest.id), 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

export async function verifyBackup(manifest: BackupManifest): Promise<void> {
  const dir = backupDir(manifest.id);
  for (const entry of Object.values(manifest.databases)) {
    if ((await fileSha256(join(dir, entry.file))) !== entry.sha256)
      throw new Error(`checksum inválido: ${entry.file}`);
  }
  for (const o of manifest.objects) {
    if (digest(readFileSync(join(dir, 'objects', o.file)), 'sha256') !== o.sha256) {
      throw new Error(`checksum inválido: objeto ${o.key}`);
    }
  }
}

export async function mirrorBucketTo(s3: S3Client, bucket: string, dir: string): Promise<ObjectEntry[]> {
  const objectsDir = join(dir, 'objects');
  mkdirSync(objectsDir, { recursive: true });
  const entries: ObjectEntry[] = [];
  for (const { key } of await listAllObjects(s3, bucket)) {
    const data = await getObjectBytes(s3, bucket, key);
    const file = objectFileName(key);
    mkdirSync(dirname(join(objectsDir, file)), { recursive: true });
    writeFileSync(join(objectsDir, file), data);
    entries.push({ key, file, bytes: data.length, sha256: digest(data, 'sha256'), md5: digest(data, 'md5') });
  }
  return entries;
}

/** Deja el bucket exactamente con los objetos del backup: borra los nuevos y re-sube los que difieren. */
export async function restoreBucketFrom(
  s3: S3Client,
  bucket: string,
  dir: string,
  objects: readonly ObjectEntry[],
): Promise<{ uploaded: number; deleted: number }> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  const wanted = new Map(objects.map((o) => [o.key, o]));
  let deleted = 0;
  let uploaded = 0;
  const current = await listAllObjects(s3, bucket);
  for (const { key } of current) {
    if (!wanted.has(key)) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      deleted++;
    }
  }
  const currentEtag = new Map(current.map((c) => [c.key, c.etag]));
  for (const o of objects) {
    if (currentEtag.get(o.key) === o.md5) continue;
    const body = readFileSync(join(dir, 'objects', o.file));
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: o.key, Body: body }));
    uploaded++;
  }
  return { uploaded, deleted };
}
