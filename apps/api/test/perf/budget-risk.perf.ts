import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { apiConfig, capturingLogger } from '../support/harness.js';
import { recordSuiteLoad } from './background-load.js';
import { perfApiEnv } from './perf-env.js';
import { PERF_THRESHOLDS } from './perf-report.js';

/**
 * add-budget-overrun-risk 5.2 (TC-REPORTING-INSIGHT-017, NFR-PERF-004): el riesgo de un plan de 40 líneas con 3000 gastos y
 * 20 ocurrencias pendientes responde con p95 ≤ 300 ms (`getBudgetRisk`) y el resumen del Home con el bloque de riesgo sigue
 * con p95 ≤ 300 ms. Lectura directa de las fuentes de verdad, sin read model ni caché. Corre en el job nightly `perf`
 * (`pnpm perf:bench`); no bloquea los PR. La duración del paso de avisos dentro de `reporting.cash-flow-watch` se registra en
 * el log del worker (`job.step: budget-risk`, `durationMs`) y la lectura HTTP, en `reporting_budget_risk_duration_seconds`.
 */
const deps = inject('deps');
recordSuiteLoad(import.meta.url, deps.superuserUrl);
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
// 2026-11-20 (12:00 en La Paz): 20 días transcurridos del periodo 2026-11.
const clock = new FixedClock(Instant.parse('2026-11-20T16:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const RISK_BUDGET_MS = 300;
const HOME_BUDGET_MS = PERF_THRESHOLDS['NFR-PERF-004'].limitMs;
const LINES = 40;
const EXPENSES = 3000;
const SAMPLES = 40;
const ROW_TIMEOUT_MS = 600_000;

let runtime: ApiRuntime;
let baseUrl = '';
let token = '';
let workspaceId = '';
let periodId = '';
let planId = '';

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

/** Ejecuta `count` tareas con a lo sumo `width` en vuelo (la siembra usa HTTP, no el cliente pg). */
async function pooled(count: number, width: number, task: (i: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < count) {
        const i = next;
        next += 1;
        await task(i);
      }
    }),
  );
}

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(apiConfig(perfApiEnv(deps, {})), apiLog.logger, {
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
    sub: `kc-budgetrisk-perf-${randomUUID()}`,
    iat: now - 5,
    exp: now + 3600,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `perf-budgetrisk-${randomUUID()}@pfos.test`,
    email_verified: true,
    name: 'perf',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(pair.privateKey);
  const me = await api('GET', '/api/v1/me');
  workspaceId = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
  const W = `/api/v1/workspaces/${workspaceId}`;
  const bob = (amount: string) => ({ amount, currency: 'BOB' });
  const account = await api('POST', `${W}/accounts`, {
    name: 'Banco',
    type: 'BANK',
    currency: 'BOB',
    openingBalance: { amount: bob('1000000.00'), date: '2026-10-01' },
  });
  expect(account.status, JSON.stringify(account.body)).toBe(201);
  const accountId = account.body['id'] as string;
  const group = await api('POST', `${W}/category-groups`, { name: 'Gastos', kind: 'EXPENSE' });
  const categories: string[] = [];
  for (let i = 0; i < LINES; i += 1) {
    const c = await api('POST', `${W}/categories`, { groupId: group.body['id'], name: `Categoría ${i}` });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    categories.push(c.body['id'] as string);
  }
  await api('POST', `${W}/periods`, { through: '2026-12-31' });
  const periods = (await api('GET', `${W}/periods?limit=100`)).body['data'] as {
    id: string;
    label: string;
  }[];
  periodId = periods.find((p) => p.label === '2026-11')!.id;
  const plan = await api('POST', `${W}/budgets`, { periodId, source: { kind: 'EMPTY' } });
  expect(plan.status, JSON.stringify(plan.body)).toBe(201);
  planId = plan.body['id'] as string;
  for (const category of categories) {
    const line = await api('POST', `${W}/budgets/${String(plan.body['id'])}/lines`, {
      target: { kind: 'CATEGORY', id: category },
      kind: 'MAXIMUM',
      planned: bob('5000.00'),
    });
    expect(line.status, JSON.stringify(line.body)).toBe(201);
  }
  await pooled(EXPENSES, 8, async (i) => {
    const category = categories[i % categories.length]!;
    const amount = bob('5.00');
    const r = await api('POST', `${W}/transactions`, {
      kind: 'EXPENSE',
      transactionDate: `2026-11-${String(1 + (i % 19)).padStart(2, '0')}`,
      accountId,
      amount,
      splits: [{ amount, categoryId: category }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
  for (let i = 0; i < 20; i += 1) {
    const r = await api('POST', `${W}/recurring`, {
      name: `Compromiso ${i}`,
      kind: 'EXPENSE',
      template: {
        accountId,
        amount: { type: 'FIXED', amount: bob('50.00') },
        categoryId: categories[i % categories.length],
        schedule: { cadence: 'MONTHLY', startDate: `2026-11-${String(21 + (i % 8)).padStart(2, '0')}` },
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
}, 3_600_000);

afterAll(async () => {
  await runtime?.close();
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

describe('NFR-PERF-004: riesgo de exceder un presupuesto', () => {
  it(
    '[TC-REPORTING-INSIGHT-017] getBudgetRisk de un plan de 40 líneas con 3000 gastos y 20 ocurrencias pendientes: p95 ≤ 300 ms',
    async () => {
      const path = `/api/v1/workspaces/${workspaceId}/periods/${periodId}/budget-risk`;
      const first = await api('GET', path);
      expect(first.status).toBe(200);
      expect(first.body['status']).toBe('AVAILABLE');
      expect((first.body['lines'] as unknown[]).length).toBe(LINES);
      const planTimes = await measure(`/api/v1/workspaces/${workspaceId}/budgets/${planId}`);
      console.info(`budgets list p95 ${Math.round(p95(planTimes))} ms`);
      const times = await measure(path);
      console.info(`budget-risk min ${Math.round(Math.min(...times))} ms`);
      console.info(`budget-risk (40 líneas): p95 ${Math.round(p95(times))} ms (${SAMPLES} muestras)`);
      expect(p95(times)).toBeLessThanOrEqual(RISK_BUDGET_MS);
    },
    ROW_TIMEOUT_MS,
  );

  it(
    '[TC-REPORTING-INSIGHT-017] [TC-PLATFORM-PIPELINE-018] getReportSummary con el bloque de riesgo: p95 ≤ 300 ms',
    async () => {
      const times = await measure(`/api/v1/workspaces/${workspaceId}/reports/summary`);
      console.info(`home con budgetRisk (summary): p95 ${Math.round(p95(times))} ms (${SAMPLES} muestras)`);
      expect(p95(times)).toBeLessThanOrEqual(HOME_BUDGET_MS);
    },
    ROW_TIMEOUT_MS,
  );
});
