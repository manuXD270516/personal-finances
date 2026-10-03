// pnpm restore:local -- <backup-id|latest> [--yes] [--with-keycloak]
// Devuelve base de datos y object storage al estado del backup. Detiene api/worker/web durante el restore y los
// vuelve a levantar después. Destructivo: pide confirmación (o --yes sin terminal).
import { parseArgs } from './lib/args.js';
import {
  backupDir,
  readManifest,
  resolveBackupId,
  restoreBucketFrom,
  restoreDatabase,
  s3FromEnv,
  verifyBackup,
} from './lib/backup.js';
import { confirm, formatDuration, log, runMain, UsageError } from './lib/cli.js';
import { composeContext, composeOrThrow, serviceStates } from './lib/compose.js';
import { loadEnvFile } from './lib/dotenv.js';
import { join } from 'node:path';

const APP_SERVICES = ['finance-api', 'finance-worker', 'finance-web'];

runMain(async () => {
  const args = parseArgs(process.argv.slice(2));
  const ctx = composeContext();
  const env = loadEnvFile(ctx.envFile, process.env);
  if (env['PFOS_ENV'] !== 'local' && env['PFOS_ENV'] !== 'ci') {
    throw new UsageError(`restore:local solo se permite con PFOS_ENV=local|ci (actual: ${env['PFOS_ENV']})`);
  }
  const id = resolveBackupId(args.positionals[0]);
  const manifest = readManifest(id);
  await verifyBackup(manifest);
  await confirm(
    `Restaurar ${id} sobre el proyecto ${ctx.project} (se pierden los cambios posteriores)`,
    args.flags.has('yes'),
  );
  const started = Date.now();

  const states = await serviceStates(ctx);
  const running = APP_SERVICES.filter((svc) =>
    states.some((s) => s.Service === svc && s.State === 'running'),
  );
  if (running.length > 0) {
    log(`deteniendo ${running.join(', ')} durante el restore`);
    await composeOrThrow(['*'], ['stop', ...running], {}, ctx);
  }
  const withKeycloak = args.flags.has('with-keycloak') && manifest.databases['keycloak'];
  try {
    const pfos = manifest.databases['pfos'];
    if (!pfos) throw new Error('el backup no contiene la base pfos');
    await restoreDatabase(ctx, 'pfos', join(backupDir(id), pfos.file));
    log('base pfos restaurada');
    if (withKeycloak) {
      await composeOrThrow(['*'], ['stop', 'keycloak'], {}, ctx);
      await restoreDatabase(ctx, 'keycloak', join(backupDir(id), manifest.databases['keycloak']!.file));
      log('base keycloak restaurada');
    }
    const s3 = s3FromEnv(env);
    const { uploaded, deleted } = await restoreBucketFrom(
      s3,
      manifest.bucket,
      backupDir(id),
      manifest.objects,
    ).finally(() => s3.destroy());
    log(
      `bucket ${manifest.bucket}: ${manifest.objects.length} objeto(s) (${uploaded} re-subido(s), ${deleted} borrado(s))`,
    );
  } finally {
    const restart = [...running, ...(withKeycloak ? ['keycloak'] : [])];
    if (restart.length > 0) {
      log(`levantando ${restart.join(', ')}`);
      await composeOrThrow(['*'], ['up', '-d', '--wait', '--no-deps', ...restart], {}, ctx);
      // add-ledger-core 5.6: al arrancar, finance-worker encola `ledger.daily-maintenance`
      // (VerifyLedgerIntegrity + RebuildBalanceSnapshots) sobre la base restaurada; las violaciones salen como log
      // `error` (alert=ledger.invariant_violation) del worker.
      if (restart.includes('finance-worker'))
        log('finance-worker verificará las invariantes del ledger restaurado (job ledger.daily-maintenance)');
    }
  }
  log(`restore de ${id} completo en ${formatDuration(Date.now() - started)}`);
  return 0;
});
