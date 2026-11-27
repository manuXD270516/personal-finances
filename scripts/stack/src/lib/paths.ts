import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError } from './errors.js';

/** Raíz del repositorio (scripts/stack/src/lib → ../../../..). Rutas siempre con node:path (Windows/POSIX). */
export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
export const COMPOSE_FILE = resolve(ROOT, 'deploy/compose/compose.yaml');
export const ENV_EXAMPLE = resolve(ROOT, '.env.example');
export const BACKUPS_DIR = resolve(ROOT, 'backups');

/** `.env` en uso: `PF_ENV_FILE` permite a la suite `test:stack` usar un entorno desechable. */
export function envFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(ROOT, env['PF_ENV_FILE'] || '.env');
}

/** Proyecto del stack de desarrollo del owner: nunca debe tocarlo un agente ni un proceso sin terminal. */
export const DEV_PROJECT = 'pfos';

/**
 * Proyecto Compose de `pnpm stack:*`: `PF_COMPOSE_PROJECT`, si no `PF_E2E_PROJECT` (debe empezar con `pfos-e2e`,
 * igual que el harness E2E) y recién después `pfos`. Si vienen las dos y difieren, error (fix-stack-project-guard).
 */
export function composeProject(env: NodeJS.ProcessEnv = process.env): string {
  const compose = env['PF_COMPOSE_PROJECT'] || undefined;
  const e2e = env['PF_E2E_PROJECT'] || undefined;
  if (e2e !== undefined && !e2e.startsWith('pfos-e2e')) {
    throw new UsageError(`PF_E2E_PROJECT debe empezar con pfos-e2e: ${e2e}`);
  }
  if (compose !== undefined && e2e !== undefined && compose !== e2e) {
    throw new UsageError(
      `PF_COMPOSE_PROJECT (${compose}) y PF_E2E_PROJECT (${e2e}) difieren: define solo uno o que coincidan`,
    );
  }
  return compose ?? e2e ?? DEV_PROJECT;
}

/**
 * Guarda de operaciones destructivas (down --volumes, reset, restore): sobre el proyecto `pfos` sin terminal
 * interactiva se niega aunque se pase `--yes`, salvo `PF_ALLOW_DEV_STACK_WIPE=pfos` (incidentes 2026-10-08 y 2026-11-27).
 */
export function assertDestructiveAllowed(
  action: string,
  project: string,
  opts: { isTTY: boolean; env?: NodeJS.ProcessEnv },
): void {
  if (project !== DEV_PROJECT || opts.isTTY) return;
  if ((opts.env ?? process.env)['PF_ALLOW_DEV_STACK_WIPE'] === DEV_PROJECT) return;
  throw new UsageError(
    `${action} sobre el proyecto ${DEV_PROJECT} (el stack de desarrollo del owner) se niega sin terminal interactiva, ` +
      'aunque se pase --yes: ya se borraron sus volúmenes dos veces (2026-10-08 y 2026-11-27). ' +
      'Para un stack desechable define PF_COMPOSE_PROJECT o PF_E2E_PROJECT=pfos-e2e-<nombre>; ' +
      'si de verdad hay que borrar el stack del owner sin terminal, define PF_ALLOW_DEV_STACK_WIPE=pfos.',
  );
}
