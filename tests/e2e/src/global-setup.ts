import { ENV_FILE_VAR, createEnvFile, pnpm, processEnvFor, removeEnvFile } from './stack.js';

/**
 * Levanta el stack `pfos-e2e` en modo B (perfil core: postgres, Keycloak con el realm de desarrollo, migrate,
 * finance-api, finance-worker y finance-web) y carga la Minimal Seed (W1/W2 y usuarios owner/editor/viewer/outsider).
 *
 * - `PF_E2E_ENV_FILE=<ruta>`: reutiliza un stack ya levantado con ese `.env` (iteración local); no lo baja al final.
 * - `PF_STACK_PREBUILT_IMAGES=1`: no reconstruye imágenes (CI carga las del job `image` con FINANCE_*_IMAGE).
 * - `PF_E2E_KEEP_STACK=1`: deja el stack arriba al terminar (depuración); bajarlo con `pnpm stack:down`.
 * - `PF_E2E_PROJECT=pfos-e2e-<x>` y `PF_E2E_PORT_PREFIX=3|5`: otro proyecto Compose y otros puertos (3xxxx/5xxxx) para
 *   correr la suite en paralelo desde otro worktree; con `FINANCE_API_IMAGE`/`FINANCE_WEB_IMAGE` propios, las imágenes
 *   tampoco se pisan.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const reuse = process.env[ENV_FILE_VAR];
  if (reuse) return async () => undefined;

  const file = createEnvFile();
  process.env[ENV_FILE_VAR] = file;
  const env = processEnvFor(file);
  const teardown = async () => {
    if (process.env['PF_E2E_KEEP_STACK'] === '1') {
      process.stderr.write(`[e2e] stack ${env['PF_COMPOSE_PROJECT']} sigue arriba (PF_ENV_FILE=${file})\n`);
      return;
    }
    await pnpm('stack:down', ['--volumes', '--yes'], env).catch((err: unknown) =>
      process.stderr.write(`[e2e] stack:down falló: ${String(err)}\n`),
    );
    removeEnvFile(file);
  };
  try {
    await pnpm('stack:down', ['--volumes', '--yes'], env); // restos de una corrida interrumpida
    if (process.env['PF_STACK_PREBUILT_IMAGES'] !== '1') await pnpm('images:build', [], env);
    await pnpm('stack:up', ['--profile', 'core', '--timeout=600'], env);
    await pnpm('db:seed', ['--profile=minimal'], env);
  } catch (err) {
    await teardown();
    throw err;
  }
  return teardown;
}
