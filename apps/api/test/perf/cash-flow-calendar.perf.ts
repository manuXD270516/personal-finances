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
 * add-cash-flow-forecast 5.2 (TC-REPORTING-FORECAST-021, NFR-PERF-010, NFR-PERF-004): el calendario de flujo de caja de
 * 90 días responde con p95 ≤ 500 ms contra PostgreSQL real con 40 cuentas líquidas y 300 ocurrencias no resueltas en el
 * horizonte, y el resumen del Home sigue con p95 ≤ 300 ms con el bloque `cashFlow` (30 días). Lectura directa de las
 * fuentes de verdad, sin read model ni caché. Corre en el job nightly `perf` (`pnpm perf:bench`); no bloquea los PR. La
 * métrica `reporting_cash_flow_calendar_duration_seconds` la cubre la alerta `UpcomingPaymentsReadModelRecommended`.
 */
const deps = inject('deps');
// Foto de la carga de fondo al empezar, antes de cada benchmark y al terminar (investigate-perf-under-load).
recordSuiteLoad(import.meta.url, deps.superuserUrl);
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const clock = new FixedClock(Instant.parse('2026-10-20T14:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const CALENDAR_BUDGET_MS = PERF_THRESHOLDS['NFR-PERF-010'].limitMs;
const HOME_BUDGET_MS = PERF_THRESHOLDS['NFR-PERF-004'].limitMs;
const SAMPLES = 40;
/** Cada fila del benchmark lleva su propio tope: la siembra y la medición no heredan el de la suite. */
const ROW_TIMEOUT_MS = 600_000;

let runtime: ApiRuntime;
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
    sub: `kc-cashflow-perf-${randomUUID()}`,
    iat: now - 5,
    exp: now + 3600,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `perf-cashflow-${randomUUID()}@pfos.test`,
    email_verified: true,
    name: 'perf',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(pair.privateKey);
  const me = await api('GET', '/api/v1/me');
  workspaceId = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
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
  await api('POST', `${W}/periods`, { through: '2027-03-31' });
  // 100 definiciones mensuales (una por cuenta repetida) con ocurrencias cada mes: ~300 sin resolver en los 90 días.
  for (let i = 0; i < 100; i += 1) {
    const r = await api('POST', `${W}/recurring`, {
      name: `Compromiso ${i}`,
      kind: 'EXPENSE',
      template: {
        accountId: accountIds[i % accountIds.length],
        amount: { type: 'FIXED', amount: { amount: '10.00', currency: 'BOB' } },
        schedule: { cadence: 'MONTHLY', startDate: `2026-10-${String(21 + (i % 8)).padStart(2, '0')}` },
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
}, 900_000);

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

describe('NFR-PERF-010: calendario de flujo de caja de 90 días', () => {
  it(
    '[TC-REPORTING-FORECAST-021] getCashFlowCalendar de 90 días con 40 cuentas líquidas y ~300 ocurrencias: p95 ≤ 500 ms',
    async () => {
      const path = `/api/v1/workspaces/${workspaceId}/reports/cash-flow-calendar?horizon=90`;
      const first = await api('GET', path);
      expect(first.status).toBe(200);
      // La siembra produjo el volumen del escenario (≥ 250 movimientos en el horizonte).
      expect((first.body['events'] as unknown[]).length).toBeGreaterThanOrEqual(250);
      const times = await measure(path);
      console.info(`cash-flow-calendar 90 días: p95 ${Math.round(p95(times))} ms (${SAMPLES} muestras)`);
      expect(p95(times)).toBeLessThanOrEqual(CALENDAR_BUDGET_MS);
    },
    ROW_TIMEOUT_MS,
  );

  it(
    '[TC-REPORTING-FORECAST-021] [TC-PLATFORM-PIPELINE-018] getReportSummary con el bloque cashFlow: p95 ≤ 300 ms',
    async () => {
      const times = await measure(`/api/v1/workspaces/${workspaceId}/reports/summary`);
      console.info(`home con cashFlow (summary): p95 ${Math.round(p95(times))} ms (${SAMPLES} muestras)`);
      expect(p95(times)).toBeLessThanOrEqual(HOME_BUDGET_MS);
    },
    ROW_TIMEOUT_MS,
  );
});
