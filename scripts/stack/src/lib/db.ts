import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from './cli.js';
import { composeOrThrow, run, CommandError } from './compose.js';
import { ROOT } from './paths.js';

/** `migrate` en contenedor (misma imagen y comando que en CI/cloud). Arranca postgres/object-storage si faltan. */
export async function migrateInContainer(): Promise<void> {
  log('migrate (contenedor): dbmate up + rol pf_app + pg-boss + bucket');
  await composeOrThrow(['core'], ['run', '--rm', '--no-TTY', 'migrate']);
}

/**
 * Seed one-shot: `docker compose --profile core run --rm seed seed --profile=<p>` (SPIKE-08: nunca dentro de
 * `up --wait`; `--profile seed` solo es inválido porque depende de `migrate`).
 */
export async function seedInContainer(profile: string): Promise<void> {
  log(`seed (contenedor): perfil ${profile}`);
  await composeOrThrow(['core'], ['run', '--rm', '--no-TTY', 'seed', 'seed', `--profile=${profile}`]);
}

const API_DIST = resolve(ROOT, 'apps/api/dist/entrypoint.js');

/** turbo vía node (sin `pnpm.cmd`: spawn sin shell no ejecuta .cmd en Windows). */
export const TURBO_BIN = resolve(ROOT, 'node_modules/turbo/bin/turbo');

/** Construye @pf/api y sus dependencias del workspace (tsc), necesario para ejecutar en el host. */
export async function buildApi(): Promise<void> {
  log('build de @pf/api (turbo)…');
  const result = await run(process.execPath, [
    TURBO_BIN,
    'run',
    'build',
    '--filter=@pf/api',
    '--output-logs=errors-only',
  ]);
  if (result.code !== 0) throw new CommandError('build de @pf/api falló', result);
}

/** `migrate` en el host (modo A): mismo código, binario dbmate de npm para Windows/macOS/Linux. */
export async function runApiCommandOnHost(
  command: 'migrate' | 'seed',
  env: Record<string, string>,
  extraArgs: readonly string[] = [],
): Promise<void> {
  if (!existsSync(API_DIST)) await buildApi();
  log(`${command} (host)…`);
  const result = await run(process.execPath, [API_DIST, command, ...extraArgs], {
    env: { ...process.env, ...env },
  });
  if (result.code !== 0) throw new CommandError(`${command} terminó con código ${result.code}`, result);
}
