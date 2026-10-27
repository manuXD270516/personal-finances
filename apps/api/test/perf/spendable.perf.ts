import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { apiConfig, capturingLogger } from '../support/harness.js';
import { recordSuiteLoad } from './background-load.js';
import { perfApiEnv } from './perf-env.js';
import { PERF_THRESHOLDS } from './perf-report.js';

/**
 * add-spendable-amount 5.2 (TC-REPORTING-SPENDABLE-014, NFR-PERF-004): el resumen del Home con el bloque `spendable` y
 * `GET W/reports/spendable` responden con p95 ≤ 300 ms contra PostgreSQL real con 40 cuentas líquidas, 300 ocurrencias no
 * resueltas en el periodo y 20 metas con reservas y plan. Las reservas se siembran por SQL (generate_series) para no tardar
 * minutos por HTTP. Corre en el job nightly `perf` (`pnpm perf:bench`); no bloquea los PR. La métrica
 * `reporting_spendable_duration_seconds` la cubre la alerta `UpcomingPaymentsReadModelRecommended` (docs/18).
 */
const deps = inject('deps');
// Foto de la carga de fondo al empezar, antes de cada benchmark y al terminar (investigate-perf-under-load).
recordSuiteLoad(import.meta.url, deps.superuserUrl);
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const clock = new FixedClock(Instant.parse('2026-10-20T14:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
/** NFR-PERF-004 (docs/02): el umbral sale de `perf-report.ts`, que el test de política fija a docs/02 (TC-PLATFORM-PIPELINE-028). */
const BUDGET_MS = PERF_THRESHOLDS['NFR-PERF-004'].limitMs;
const SAMPLES = 40;

let runtime: ApiRuntime;
let worker: Pool;
let baseUrl = '';
let token = '';
let workspaceId = '';

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
  const pair = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(apiConfig(perfApiEnv(deps)), apiLog.logger, {
    clock,
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
    },
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
  const now = Math.floor(Date.now() / 1000);
  token = await new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: `kc-spendable-perf-${randomUUID()}`,
    iat: now - 5,
    exp: now + 3600,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `perf-spendable-${randomUUID()}@pfos.test`,
    email_verified: true,
    name: 'perf',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(pair.privateKey);
  const me = await api('GET', '/api/v1/me');
  workspaceId = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
  const userId = me.body['id'] as string;
  const W = `/api/v1/workspaces/${workspaceId}`;
  const accountIds: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    const account = await api('POST', `${W}/accounts`, {
      name: `Cuenta ${i}`,
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: { amount: '10000.00', currency: 'BOB' }, date: '2026-09-01' },
    });
    expect(account.status, JSON.stringify(account.body)).toBe(201);
    accountIds.push(account.body['id'] as string);
  }
  await api('POST', `${W}/periods`, { through: '2026-12-31' });
  // 300 definiciones mensuales con una ocurrencia sin resolver cada una dentro del periodo de octubre.
  for (let i = 0; i < 300; i += 1) {
    const r = await api('POST', `${W}/recurring`, {
      name: `Compromiso ${i}`,
      kind: 'EXPENSE',
      template: {
        accountId: accountIds[i % accountIds.length],
        amount: { type: 'FIXED', amount: { amount: '10.00', currency: 'BOB' } },
        schedule: { cadence: 'MONTHLY', startDate: '2026-10-25' },
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
  const goalIds: string[] = [];
  for (let i = 0; i < 20; i += 1) {
    const g = await api('POST', `${W}/goals`, {
      name: `Meta ${i}`,
      type: 'CUSTOM',
      target: { amount: '100000.00', currency: 'BOB' },
      startDate: '2026-01-01',
      targetDate: '2027-12-31',
      priority: (i % 5) + 1,
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    goalIds.push(g.body['id'] as string);
  }
  // Reservas repartidas entre las metas y las cuentas (los movimientos solo suman; no pasan por la guarda).
  const client = await worker.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true)`,
      [userId, workspaceId],
    );
    await client.query(
      `INSERT INTO goals.goal_movement
         (id, workspace_id, goal_id, fund, movement, amount, currency, account_id, occurred_on, origin, recorded_by)
       SELECT gen_random_uuid(), $1, ($2::uuid[])[1 + (n % 20)], 'EARMARK', 'CONTRIBUTION', 1 + (n % 7), 'BOB',
              ($3::uuid[])[1 + (n % 40)], DATE '2026-04-01' + (n % 180), 'SYSTEM', $4
         FROM generate_series(1, 400) n`,
      [workspaceId, goalIds, accountIds, userId],
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }
}, 900_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
});

const p95 = (times: number[]): number => {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
};

async function measure(path: string): Promise<number[]> {
  const read = async () => {
    const started = performance.now();
    const r = await api('GET', path);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return performance.now() - started;
  };
  await read(); // calentamiento (conexiones y planes)
  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) times.push(await read());
  return times;
}

describe('NFR-PERF-004: Home con el bloque spendable (Q5)', () => {
  it('[TC-REPORTING-SPENDABLE-014] [TC-PLATFORM-PIPELINE-018] getReportSummary con el bloque spendable: p95 ≤ 300 ms', async () => {
    const times = await measure(`/api/v1/workspaces/${workspaceId}/reports/summary`);
    console.info(`home Q5 (summary): p95 ${Math.round(p95(times))} ms (${SAMPLES} muestras)`);
    expect(p95(times)).toBeLessThanOrEqual(BUDGET_MS);
  });

  it('[TC-REPORTING-SPENDABLE-014] [TC-PLATFORM-PIPELINE-018] getSpendable con el detalle de 300 ocurrencias: p95 ≤ 300 ms', async () => {
    const times = await measure(`/api/v1/workspaces/${workspaceId}/reports/spendable`);
    console.info(`spendable: p95 ${Math.round(p95(times))} ms (${SAMPLES} muestras)`);
    expect(p95(times)).toBeLessThanOrEqual(BUDGET_MS);
  });
});
