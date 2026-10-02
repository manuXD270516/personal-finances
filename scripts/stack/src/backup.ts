// pnpm backup:local [-- --name=<etiqueta>]
// Backup local consistente para desarrollo (docs/19 §9, docs/30 §3): backups/<UTC>-<etiqueta>/ con
// pfos.dump y keycloak.dump (pg_dump -Fc), objects/ (mirror del bucket vía S3) y manifest.json (sha256).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { option, parseArgs } from './lib/args.js';
import {
  backupDir,
  dumpDatabase,
  mirrorBucketTo,
  psql,
  s3FromEnv,
  writeManifest,
  type BackupManifest,
} from './lib/backup.js';
import { formatDuration, log, runMain, UsageError } from './lib/cli.js';
import { composeContext, serviceStates } from './lib/compose.js';
import { loadEnvFile } from './lib/dotenv.js';

runMain(async () => {
  const args = parseArgs(process.argv.slice(2), ['name']);
  const ctx = composeContext();
  const env = loadEnvFile(ctx.envFile, process.env);
  const states = await serviceStates(ctx);
  for (const svc of ['postgres', 'object-storage']) {
    if (!states.some((s) => s.Service === svc && s.State === 'running')) {
      throw new UsageError(`${svc} no está corriendo en el proyecto ${ctx.project}: pnpm stack:up`);
    }
  }
  const label = (option(args, 'name') ?? 'manual').replace(/[^A-Za-z0-9._-]/g, '-');
  const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-${label}`;
  const dir = backupDir(id);
  mkdirSync(dir, { recursive: true });
  const started = Date.now();

  const databases: BackupManifest['databases'] = {};
  databases['pfos'] = await dumpDatabase(ctx, 'pfos', join(dir, 'pfos.dump'));
  const hasKeycloak =
    (await psql(ctx, 'postgres', `SELECT 1 FROM pg_database WHERE datname = 'keycloak'`)).trim() === '1';
  if (hasKeycloak) databases['keycloak'] = await dumpDatabase(ctx, 'keycloak', join(dir, 'keycloak.dump'));
  const migrations = (
    await psql(ctx, 'pfos', `SELECT version FROM public.schema_migrations ORDER BY version`).catch(() => '')
  )
    .split(/\r?\n/)
    .filter(Boolean);

  const bucket = env['OBJECT_STORAGE_BUCKET']!;
  const s3 = s3FromEnv(env);
  const objects = await mirrorBucketTo(s3, bucket, dir).finally(() => s3.destroy());

  writeManifest({
    format: 'pfos-local-backup/v1',
    id,
    createdAt: new Date().toISOString(),
    project: ctx.project,
    databases,
    migrations,
    bucket,
    objects,
  });
  log(
    `backup ${id} listo en ${formatDuration(Date.now() - started)}: ` +
      `${Object.keys(databases).join(' + ')}, ${objects.length} objeto(s), ${migrations.length} migración(es)`,
  );
  log(`restaurar con: pnpm restore:local -- ${id} --yes`);
  return 0;
});
