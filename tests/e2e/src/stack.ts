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
  // Sin red en E2E: providers de tasas de mercado deshabilitados (add-market-rate-providers).
  const e2eOverrides = new Map([
    ['FX_PROVIDER_PRIMARY', 'none'],
    ['FX_PROVIDER_FALLBACK', 'none'],
    ['FX_PROVIDER_OFFICIAL', 'none'],
    // Todas las peticiones llegan desde el contenedor del BFF: el límite por usuario se cuenta hoy por IP (el guard
    // de límite corre antes que el de identidad), así que la suite completa comparte una sola cuota de lecturas.
    ['RATE_LIMIT_READS_PER_MIN', '6000'],
    ['RATE_LIMIT_WRITES_PER_MIN', '1200'],
  ]);
  writeFileSync(file, renderEnv(example, e2eOverrides, ports).text);
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
