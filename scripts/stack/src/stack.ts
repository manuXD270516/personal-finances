// pnpm stack:up|down|restart|logs|ps|reset|build — ciclo de vida del stack Compose `pfos` (docs/19 §0.5).
//   pnpm stack:up                              perfil deps (modo A)
//   pnpm stack:up -- --profile core            producto completo (modo B); también --profile observability…
//   pnpm stack:down [-- --volumes --yes]       para todo (conserva volúmenes salvo --volumes)
//   pnpm stack:restart [-- <servicio>…]
//   pnpm stack:logs [-- <servicio>…] [--follow] [--tail=200]
//   pnpm stack:reset -- --seed=minimal [--profile core] [--yes]   volúmenes limpios → migraciones → seed
import { listOption, option, parseArgs } from './lib/args.js';
import { confirm, formatDuration, log, runMain, UsageError, warn } from './lib/cli.js';
import { compose, composeContext, composeOrThrow, serviceStates } from './lib/compose.js';
import { loadEnvFile } from './lib/dotenv.js';
import { migrateInContainer, seedInContainer } from './lib/db.js';

const ALL = ['*'];
const VALUED = ['profile', 'tail', 'since', 'seed', 'timeout'];

function profilesFrom(args: ReturnType<typeof parseArgs>, fallback: string[]): string[] {
  const profiles = listOption(args, 'profile');
  if (profiles.length > 0) return profiles;
  const fromEnv = (process.env['PF_COMPOSE_PROFILES'] ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : fallback;
}

function printUrls(env: Record<string, string>, profiles: readonly string[]): void {
  const host = env['PF_BIND_ADDR'];
  const lines = [
    `postgres        ${host}:${env['PF_POSTGRES_PORT']}`,
    `object storage  http://${host}:${env['PF_OBJECT_STORAGE_PORT']}`,
    `mailpit         http://${host}:${env['PF_MAILPIT_UI_PORT']}`,
    `keycloak        ${env['OIDC_PUBLIC_BASE_URL']}`,
  ];
  if (profiles.includes('core')) {
    lines.push(`finance-api     http://${host}:${env['PF_API_PORT']}/health/ready`);
    lines.push(`finance-web     ${env['WEB_PUBLIC_URL']}`);
  }
  if (profiles.includes('observability'))
    lines.push(`grafana         http://${host}:${env['PF_GRAFANA_PORT']}`);
  for (const l of lines) log(`  ${l}`);
}

/** Si `migrate` falló, lo dice y muestra su log (SPIKE-08 §6.6): api/worker no arrancan sin migraciones. */
async function explainFailure(): Promise<void> {
  const states = await serviceStates().catch(() => []);
  const migrate = states.find((s) => s.Service === 'migrate');
  if (migrate && migrate.State === 'exited' && migrate.ExitCode !== 0) {
    warn(`migrate terminó con código ${migrate.ExitCode}: finance-api y finance-worker NO se iniciaron.`);
    warn('Log de migrate:');
    await compose(ALL, ['logs', '--no-color', '--tail', '80', 'migrate']);
    warn(
      'Si el stack ya estaba arriba, api/worker siguen con la versión anterior: corrige y ejecuta pnpm stack:restart.',
    );
    return;
  }
  const unhealthy = states.filter(
    (s) => s.Health === 'unhealthy' || (s.State === 'exited' && s.ExitCode !== 0),
  );
  for (const s of unhealthy)
    warn(`${s.Service}: ${s.State}${s.Health ? ` (${s.Health})` : ''} — pnpm stack:logs -- ${s.Service}`);
}

async function up(args: ReturnType<typeof parseArgs>): Promise<number> {
  const env = loadEnvFile(composeContext().envFile, process.env);
  const profiles = profilesFrom(args, ['deps']);
  if (profiles.includes('seed')) {
    throw new UsageError(
      'el perfil seed no se levanta con up (one-shot): usa pnpm db:seed -- --profile=minimal',
    );
  }
  const timeout = option(args, 'timeout') ?? '420';
  const started = Date.now();
  const extra = args.flags.has('build') ? ['--build'] : [];
  log(`docker compose up (${profiles.join(', ')}) — esperando a que todo esté healthy…`);
  const result = await compose(profiles, [
    'up',
    '-d',
    '--wait',
    '--wait-timeout',
    timeout,
    '--remove-orphans',
    ...extra,
  ]);
  if (result.code !== 0) {
    await explainFailure();
    return result.code;
  }
  log(`stack healthy en ${formatDuration(Date.now() - started)} (perfiles: ${profiles.join(', ')})`);
  printUrls(env, profiles);
  return 0;
}

async function down(args: ReturnType<typeof parseArgs>): Promise<number> {
  const volumes = args.flags.has('volumes');
  if (volumes)
    await confirm(
      'Esto borra los volúmenes del proyecto (base de datos y objetos locales)',
      args.flags.has('yes'),
    );
  await composeOrThrow(ALL, ['down', '--remove-orphans', ...(volumes ? ['--volumes'] : [])]);
  return 0;
}

async function reset(args: ReturnType<typeof parseArgs>): Promise<number> {
  const env = loadEnvFile(composeContext().envFile, process.env);
  if (env['PFOS_ENV'] !== 'local' && env['PFOS_ENV'] !== 'ci') {
    throw new UsageError(`stack:reset solo se permite con PFOS_ENV=local|ci (actual: ${env['PFOS_ENV']})`);
  }
  const seed = option(args, 'seed') ?? 'minimal';
  const profiles = profilesFrom(args, ['deps']);
  await confirm(
    `Reset del proyecto ${composeContext().project}: se borran base de datos y objetos locales`,
    args.flags.has('yes'),
  );
  const started = Date.now();
  await composeOrThrow(ALL, ['down', '--remove-orphans', '--volumes']);
  const code = await up(args);
  if (code !== 0) return code;
  // En `core` migrate ya corrió como dependencia; en `deps` se ejecuta aquí (misma imagen, mismo comando).
  if (!profiles.includes('core')) await migrateInContainer();
  if (seed !== 'none') await seedInContainer(seed);
  log(`reset completo en ${formatDuration(Date.now() - started)} (seed: ${seed})`);
  return 0;
}

runMain(async () => {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest, VALUED);
  switch (command) {
    case 'up':
      return up(args);
    case 'down':
      return down(args);
    case 'restart':
      await composeOrThrow(ALL, ['restart', ...args.positionals]);
      return 0;
    case 'logs': {
      const follow = args.flags.has('follow') || (process.stdout.isTTY && !args.flags.has('no-follow'));
      const tail = option(args, 'tail') ?? (follow ? '200' : 'all');
      const since = option(args, 'since');
      const result = await compose(ALL, [
        'logs',
        '--no-color',
        '--tail',
        tail,
        ...(since ? ['--since', since] : []),
        ...(follow ? ['--follow'] : []),
        ...args.positionals,
      ]);
      return result.code;
    }
    case 'ps':
      return (await compose(ALL, ['ps', '--all'])).code;
    case 'build':
      await composeOrThrow(['core'], ['build', 'migrate', 'finance-web']);
      return 0;
    case 'reset':
      return reset(args);
    default:
      throw new UsageError('uso: stack.ts up|down|restart|logs|ps|reset|build [opciones]');
  }
});
