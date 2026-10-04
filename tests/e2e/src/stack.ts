import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { interpolateEnv, parseEnvLines } from '../../../scripts/stack/src/lib/dotenv.js';
import { renderEnv } from '../../../scripts/stack/src/lib/env-template.js';

/**
 * Stack desechable de la suite E2E: proyecto Compose `pfos-e2e` (nunca `pfos` ni contenedores ajenos), `.env`
 * temporal generado desde `.env.example` con secretos aleatorios propios y puertos 4xxxx (no chocan con un `pfos`
 * de desarrollo ni con `pfos-test`). Modo B: las mismas imágenes que en producción, con Keycloak real.
 */
export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
export const E2E_PROJECT = e2eProject();

/**
 * Proyecto Compose de la corrida: `pfos-e2e` por defecto; `PF_E2E_PROJECT=pfos-e2e-<algo>` permite correr la suite en
 * paralelo desde otro worktree (siempre con prefijo `pfos`, nunca contenedores ajenos).
 */
function e2eProject(): string {
  const name = process.env['PF_E2E_PROJECT'] ?? 'pfos-e2e';
  if (!/^pfos-e2e[a-z0-9-]*$/.test(name))
    throw new Error(`PF_E2E_PROJECT debe empezar con pfos-e2e: ${name}`);
  return name;
}

/** Primer dígito de los puertos publicados (`4` ⇒ 4xxxx); `PF_E2E_PORT_PREFIX=5` evita choques entre corridas paralelas. */
const PORT_PREFIX = /^[35]$/.test(process.env['PF_E2E_PORT_PREFIX'] ?? '')
  ? process.env['PF_E2E_PORT_PREFIX']!
  : '4';

/** Puerto del servidor de providers simulados en el host (`<prefijo>9090`; `PF_E2E_FX_SIM_PORT` lo cambia). */
export const FX_SIM_PORT = Number.parseInt(process.env['PF_E2E_FX_SIM_PORT'] ?? `${PORT_PREFIX}9090`, 10);

/** Variables que comparten global setup y workers (Playwright hereda `process.env` del proceso principal). */
export const ENV_FILE_VAR = 'PF_E2E_ENV_FILE';

export function createEnvFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pfos-e2e-'));
  const file = join(dir, '.env');
  const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
  const ports = new Map<string, string>();
  for (const line of parseEnvLines(example)) {
    if (line.key && /^PF_[A-Z0-9_]+_PORT$/.test(line.key))
      ports.set(line.key, `${PORT_PREFIX}${line.value!.slice(1)}`);
  }
  // CI reutiliza las imágenes del job `image` (FINANCE_*_IMAGE en el entorno del proceso).
  // Sin red en E2E: los providers de tasas de mercado apuntan a providers SIMULADOS por el harness
  // (`src/fx-sim.ts`, servidor HTTP local en el host; add-market-rate-providers 7.2), nunca a la red real. El cron
  // de consulta corre cada 24 h: las pruebas disparan cada ciclo (`triggerPoll`) para controlar el escenario.
  const simUrl = `http://host.docker.internal:${FX_SIM_PORT}`;
  const e2eOverrides = new Map([
    ['FX_PROVIDER_PRIMARY', 'paralelo_bo'],
    ['FX_PROVIDER_FALLBACK', 'dolarapi_bo'],
    ['FX_PROVIDER_OFFICIAL', 'dolarapi_bo'],
    ['FX_POLL_INTERVAL', '24h'],
    ['FX_BACKFILL_ENABLED', 'true'],
  ]);
  const extra = new Map([
    ['FX_PROVIDER_PARALELO_BO_URL', simUrl],
    ['FX_PROVIDER_DOLARAPI_BO_URL', simUrl],
  ]);
  // Las claves que no están en `.env.example` (URL de los simulados) se agregan al final del `.env` desechable.
  writeFileSync(file, renderEnv(example, new Map([...e2eOverrides, ...extra]), ports).text);
  return file;
}

/** Valores interpolados del `.env` desechable (solo para los tests: contraseñas de prueba, URLs, puertos). */
export function readEnv(file = process.env[ENV_FILE_VAR]): Record<string, string> {
  if (!file || !existsSync(file))
    throw new Error(`${ENV_FILE_VAR} no apunta a un .env (¿corrió el global setup?)`);
  return interpolateEnv(parseEnvLines(readFileSync(file, 'utf8')));
}

export function processEnvFor(file: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Los valores del `.env` desechable mandan: no heredar variables de la sesión que los pisen.
  for (const k of Object.keys(env)) {
    if (
      /^(PF_DEV_|DATABASE_|OBJECT_STORAGE_|OIDC_|BFF_|SESSION_|WEB_PUBLIC_URL$|FINANCE_API_URL$|PFOS_ENV$)/.test(
        k,
      )
    ) {
      delete env[k];
    }
  }
  env['PF_COMPOSE_PROJECT'] = E2E_PROJECT;
  env['PF_ENV_FILE'] = file;
  return env;
}

/** `pnpm <script> -- <args>` en la raíz, como lo ejecutaría el desarrollador; salida visible en la consola. */
export function pnpm(script: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    // shell: pnpm es un .cmd en Windows; los argumentos son fijos del harness (sin datos externos).
    const child = spawn(['pnpm', script, ...(args.length ? ['--', ...args] : [])].join(' '), {
      cwd: ROOT,
      env,
      shell: true,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`pnpm ${script} terminó con código ${code}`)),
    );
  });
}

export function removeEnvFile(file: string): void {
  rmSync(resolve(file, '..'), { recursive: true, force: true });
}
