import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

/**
 * NFR-PERF-004 con las tarjetas Q4/Q8 (add-upcoming-payments, tarea 7.3): el Home pide `getReportSummary` y
 * `getUpcomingPayments?days=7` en paralelo; con 60 definiciones activas (20 diarias, 20 semanales y 20 mensuales, unas 2 000
 * ocurrencias generadas a 90 días) y un gasto pendiente, el p95 de la pareja en paralelo debe ser ≤ 300 ms contra PostgreSQL
 * real. Corre en el job nightly `perf` (`pnpm perf:bench`); no bloquea los PR. La consulta de próximos pagos expone además
 * `reporting_upcoming_payments_duration_seconds` y `_rows` (docs/35 D117): si este benchmark supera el presupuesto, es la
 * señal de migrar al read model por eventos.
 */
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const clock = new FixedClock(Instant.parse('2026-10-20T14:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const BUDGET_MS = 300;
const SAMPLES = 40;

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
  runtime = await createApiRuntime(apiConfig(baseEnv(deps)), apiLog.logger, {
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
    sub: `kc-upc-perf-${randomUUID()}`,
    iat: now - 5,
    exp: now + 3600,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `perf-upc-${randomUUID()}@pfos.test`,
    email_verified: true,
    name: 'perf',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(pair.privateKey);
  const me = await api('GET', '/api/v1/me');
  workspaceId = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
  const W = `/api/v1/workspaces/${workspaceId}`;
  const account = await api('POST', `${W}/accounts`, {
    name: 'Banco BOB',
    type: 'BANK',
    currency: 'BOB',
    openingBalance: { amount: { amount: '10000.00', currency: 'BOB' }, date: '2026-09-01' },
  });
  const accountId = account.body['id'] as string;
  await api('POST', `${W}/periods`, { through: '2026-12-31' });
  for (const cadence of ['DAILY', 'WEEKLY', 'MONTHLY'] as const) {
    for (let i = 0; i < 20; i += 1) {
      const r = await api('POST', `${W}/recurring`, {
        name: `${cadence} ${i}`,
        kind: 'EXPENSE',
        template: {
          accountId,
          amount: { type: 'FIXED', amount: { amount: '10.00', currency: 'BOB' } },
          schedule: { cadence, startDate: '2026-10-20' },
          materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
        },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
  }
  await api('POST', `${W}/transactions`, {
    kind: 'EXPENSE',
    status: 'PENDING',
    transactionDate: '2026-10-18',
    accountId,
    description: 'Cena',
    amount: { amount: '300.00', currency: 'BOB' },
  });
}, 600_000);

afterAll(async () => {
  await runtime?.close();
});

describe('NFR-PERF-004: Home con las tarjetas Q4 y Q8', () => {
  it('getReportSummary y getUpcomingPayments?days=7 en paralelo con 60 definiciones: p95 ≤ 300 ms', async () => {
    const W = `/api/v1/workspaces/${workspaceId}`;
    const home = async () => {
      const started = performance.now();
      const [summary, upcoming] = await Promise.all([
        api('GET', `${W}/reports/summary`),
        api('GET', `${W}/reports/upcoming-payments?days=7`),
      ]);
      expect(summary.status).toBe(200);
      expect(upcoming.status).toBe(200);
      return performance.now() - started;
    };
    await home(); // calentamiento (conexiones y planes)
    const times: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) times.push(await home());
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(0.95 * times.length) - 1]!;
    console.info(
      `home Q4/Q8: p95 ${Math.round(p95)} ms, máx ${Math.round(times.at(-1)!)} ms (${SAMPLES} muestras)`,
    );
    expect(p95).toBeLessThanOrEqual(BUDGET_MS);
  });
});
