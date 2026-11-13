import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { apiConfig, capturingLogger } from '../support/harness.js';
import { recordSuiteLoad } from './background-load.js';
import { perfApiEnv } from './perf-env.js';
import { PERF_THRESHOLDS } from './perf-report.js';

/**
 * add-predicted-cash-flow-band 5.2 (TC-REPORTING-PREDICTED-011): el mismo escenario con un pronóstico vigente con series del
 * gasto variable líquido en BOB y USD (la banda del calendario y el gasto esperado del Home se leen de la corrida
 * vigente en la misma transacción; sin llamar al servicio). Se siembra directo en `forecasting.*` con el superusuario.
 *
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
  runtime = await createApiRuntime(
    apiConfig(perfApiEnv(deps, { FORECASTING_ENABLED: 'true' })),
    apiLog.logger,
    {
      clock,
      identity: {
        jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
      },
    },
  );
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
    // La última cuenta es en dólares: el pronóstico trae una serie del gasto variable líquido por moneda (BOB y USD).
    const currency = i === 39 ? 'USD' : 'BOB';
    const account = await api('POST', `${W}/accounts`, {
      name: `Cuenta ${i}`,
      type: 'BANK',
      currency,
      openingBalance: { amount: { amount: '10000.00', currency }, date: '2026-09-01' },
    });
    expect(account.status, JSON.stringify(account.body)).toBe(201);
    if (currency === 'BOB') accountIds.push(account.body['id'] as string);
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
  await seedForecast(workspaceId);
}, 900_000);

/** Pronóstico vigente con una serie del gasto variable líquido por moneda y un periodo en curso + 3 (2026-10 .. 2027-01). */
async function seedForecast(ws: string): Promise<void> {
  const superuser = new Pool({ connectionString: deps.superuserUrl, max: 1 });
  try {
    const runId = randomUUID();
    await superuser.query(
      `INSERT INTO forecasting.forecast_run (id, workspace_id, trigger, status, requested_at, started_at, completed_at,
         as_of_period, reporting_currency, attempts, next_attempt_at, series_published)
       VALUES ($1, $2, 'SCHEDULED', 'COMPLETED', '2026-10-19T10:00:00Z', '2026-10-19T10:00:05Z', '2026-10-19T10:01:00Z',
         '2026-09', 'BOB', 1, '2026-10-19T10:00:00Z', 2)`,
      [runId, ws],
    );
    for (const [i, [currency, base]] of (
      [
        ['BOB', 1500],
        ['USD', 120],
      ] as const
    ).entries()) {
      const seriesId = randomUUID();
      await superuser.query(
        `INSERT INTO forecasting.forecast_series (id, workspace_id, run_id, opaque_ref, scope, scope_ref, name, currency,
           scale, readiness, history_from, history_to, history_periods, status, model_name, model_version)
         VALUES ($1, $2, $3, $4, 'LIQUID_VARIABLE_OUTFLOW', NULL, $5::text, $5::varchar, 2, 'MODEL', '2026-02', '2026-09', 8,
           'PUBLISHED', 'mean_last_n', '1')`,
        [seriesId, ws, runId, `s${i + 1}`, currency],
      );
      for (const [m, period] of ['2026-10', '2026-11', '2026-12', '2027-01'].entries()) {
        await superuser.query(
          `INSERT INTO forecasting.forecast_point (series_id, workspace_id, period, months_ahead, prediction, lower_80,
             upper_80, lower_95, upper_95, baseline_value)
           VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9, $5::numeric)`,
          [seriesId, ws, period, m + 1, base, base * 0.9, base * 1.1, base * 0.8, base * 1.2],
        );
      }
    }
  } finally {
    await superuser.end();
  }
}

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
    '[TC-REPORTING-FORECAST-021] [TC-REPORTING-PREDICTED-011] getCashFlowCalendar de 90 días con 40 cuentas líquidas, ~300 ocurrencias y la banda del pronóstico: p95 ≤ 500 ms',
    async () => {
      const path = `/api/v1/workspaces/${workspaceId}/reports/cash-flow-calendar?horizon=90`;
      const first = await api('GET', path);
      expect(first.status).toBe(200);
      // La siembra produjo el volumen del escenario (≥ 250 movimientos en el horizonte).
      expect((first.body['events'] as unknown[]).length).toBeGreaterThanOrEqual(250);
      // Con el pronóstico vigente el calendario trae la banda de BOB y la de USD (add-predicted-cash-flow-band).
      const currencies = first.body['currencies'] as { currency: string; predicted: { status: string } }[];
      expect(currencies.map((c) => [c.currency, c.predicted.status])).toEqual([
        ['BOB', 'AVAILABLE'],
        ['USD', 'AVAILABLE'],
      ]);
      const times = await measure(path);
      console.info(`cash-flow-calendar 90 días: p95 ${Math.round(p95(times))} ms (${SAMPLES} muestras)`);
      expect(p95(times)).toBeLessThanOrEqual(CALENDAR_BUDGET_MS);
    },
    ROW_TIMEOUT_MS,
  );

  it(
    '[TC-REPORTING-FORECAST-021] [TC-REPORTING-PREDICTED-011] [TC-PLATFORM-PIPELINE-018] getReportSummary con el bloque cashFlow y el pronóstico: p95 ≤ 300 ms',
    async () => {
      const times = await measure(`/api/v1/workspaces/${workspaceId}/reports/summary`);
      console.info(`home con cashFlow (summary): p95 ${Math.round(p95(times))} ms (${SAMPLES} muestras)`);
      expect(p95(times)).toBeLessThanOrEqual(HOME_BUDGET_MS);
    },
    ROW_TIMEOUT_MS,
  );
});
