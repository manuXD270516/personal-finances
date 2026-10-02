import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raíz del repositorio (scripts/stack/src/lib → ../../../..). Rutas siempre con node:path (Windows/POSIX). */
export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
export const COMPOSE_FILE = resolve(ROOT, 'deploy/compose/compose.yaml');
export const ENV_EXAMPLE = resolve(ROOT, '.env.example');
export const BACKUPS_DIR = resolve(ROOT, 'backups');

/** `.env` en uso: `PF_ENV_FILE` permite a la suite `test:stack` usar un entorno desechable. */
export function envFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(ROOT, env['PF_ENV_FILE'] || '.env');
}

/** Proyecto Compose: `pfos` siempre, salvo pruebas desechables (`PF_COMPOSE_PROJECT=pfos-test`). */
export function composeProject(env: NodeJS.ProcessEnv = process.env): string {
  return env['PF_COMPOSE_PROJECT'] || 'pfos';
}
