import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Pool } from '../src/db.js';
import { sleep } from '../src/config.js';

export async function waitFor(fn: () => Promise<boolean>, timeoutMs = 60_000, stepMs = 100): Promise<number> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return Date.now() - t0;
    await sleep(stepMs);
  }
  throw new Error(`waitFor timeout after ${timeoutMs}ms`);
}

export async function scalar(pool: Pool, sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query(sql, params as any[]);
  return Number(Object.values(rows[0])[0]);
}

/** Inversiones de orden por agregado según el orden real de aplicación (app.applied.seq). */
export async function orderInversions(pool: Pool): Promise<number> {
  return scalar(pool, `SELECT count(*) FROM (
      SELECT version, lag(version) OVER (PARTITION BY account_id ORDER BY seq) AS prev FROM app.applied) t
    WHERE prev IS NOT NULL AND version < prev`);
}

const resultsDir = fileURLToPath(new URL('../results/', import.meta.url));
export function saveResult(name: string, data: unknown) {
  mkdirSync(resultsDir, { recursive: true });
  const file = `${resultsDir}${name}.json`;
  const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  writeFileSync(file, JSON.stringify({ ...prev, ...(data as object) }, null, 2));
}

export const cwd = fileURLToPath(new URL('..', import.meta.url));
export function compose(args: string, env: Record<string, string> = {}): string {
  return execSync(`docker compose -p pf-spike-05 ${args}`, {
    cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
  });
}

export function pct(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
