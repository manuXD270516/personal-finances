import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { psql, s3FromEnv } from '../../src/lib/backup.js';
import {
  compose,
  composeContext,
  serviceStates,
  type ComposeContext,
  type RunResult,
} from '../../src/lib/compose.js';
import { interpolateEnv, parseEnvLines } from '../../src/lib/dotenv.js';
import { renderEnv } from '../../src/lib/env-template.js';
import { ENV_EXAMPLE, ROOT } from '../../src/lib/paths.js';

/**
 * Entorno desechable para la suite `test:stack`: proyecto Compose `pfos-test` (nunca `pfos` ni contenedores
 * ajenos), `.env` temporal con secretos propios y puertos 3xxxx (no chocan con un `pfos` de desarrollo).
 */
export function createTestEnv(): {
  ctx: ComposeContext;
  env: Record<string, string>;
  processEnv: NodeJS.ProcessEnv;
} {
  const dir = mkdtempSync(join(tmpdir(), 'pfos-test-'));
  const envFile = join(dir, '.env');
  const example = readFileSync(ENV_EXAMPLE, 'utf8');
  const ports = new Map<string, string>();
  for (const line of parseEnvLines(example)) {
    if (line.key && /^PF_[A-Z0-9_]+_PORT$/.test(line.key)) ports.set(line.key, `3${line.value!.slice(1)}`);
  }
  writeFileSync(envFile, renderEnv(example, new Map(), ports).text);
  const processEnv: NodeJS.ProcessEnv = { ...process.env };
  // Los valores del `.env` temporal mandan: no heredar variables de la sesión que los pisen.
  for (const k of Object.keys(processEnv))
    if (/^(PF_DEV_|DATABASE_|OBJECT_STORAGE_|PFOS_ENV$)/.test(k)) delete processEnv[k];
  processEnv.PF_COMPOSE_PROJECT = 'pfos-test';
  processEnv.PF_ENV_FILE = envFile;
  const env = interpolateEnv(parseEnvLines(readFileSync(envFile, 'utf8')));
  return { ctx: composeContext(processEnv), env, processEnv };
}

/** Ejecuta un script raíz exactamente como lo haría el desarrollador: `pnpm <script> -- <args>`. */
export function pnpm(
  script: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<RunResult & { ms: number }> {
  const started = Date.now();
  return new Promise((resolvePromise, reject) => {
    // shell: pnpm es un .cmd en Windows; los argumentos son fijos del test (sin datos externos).
    const child = spawn(['pnpm', script, ...(args.length ? ['--', ...args] : [])].join(' '), {
      cwd: ROOT,
      env,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) =>
      resolvePromise({ code: code ?? 1, stdout, stderr, ms: Date.now() - started }),
    );
  });
}

export async function stateOf(ctx: ComposeContext, service: string) {
  return (await serviceStates(ctx)).find((s) => s.Service === service);
}

export async function sql(ctx: ComposeContext, query: string): Promise<string[]> {
  return (await psql(ctx, 'pfos', query)).split(/\r?\n/).filter(Boolean);
}

export async function waitUntil<T>(
  fn: () => Promise<T | undefined>,
  timeoutMs = 60_000,
  stepMs = 500,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error('waitUntil: timeout');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export async function http(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* texto plano */
  }
  return { status: res.status, body };
}

export function s3(env: Record<string, string>): S3Client {
  return s3FromEnv(env);
}

export async function putObject(client: S3Client, bucket: string, key: string, body: string): Promise<void> {
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.from(body) }));
}

export async function containerInspect(name: string, format: string): Promise<string> {
  const { run } = await import('../../src/lib/compose.js');
  const result = await run('docker', ['inspect', name, '--format', format], { mode: 'capture' });
  return result.stdout.trim();
}

export const overrideFile = (name: string): string => resolve(ROOT, 'scripts/stack/test/fixtures', name);

export { compose };
