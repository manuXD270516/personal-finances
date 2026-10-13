import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

/**
 * fix-phase-4-gaps 7.2 (TC-DEBT-AMORT-045, NFR-PERF-004): `POST W/loans/payoff-simulations` responde con p95 < 300 ms con
 * 10 préstamos activos en BOB de 360 cuotas, tanto para las estrategias avalanche y snowball con 500.00 BOB extra al mes
 * como para los pagos extra de un préstamo. La simulación no persiste nada. Corre en el job nightly `perf`
 * (`pnpm perf:bench`) con timeout explícito; no bloquea los PR (el test funcional con límite de 3 s se mantiene).
 */
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const clock = new FixedClock(Instant.parse('2026-10-20T14:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const BUDGET_MS = 300;
const SAMPLES = 200;
const LOANS = 10;

let runtime: ApiRuntime;
let baseUrl = '';
let token = '';
let W = '';
const loanIds: string[] = [];

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
    sub: `kc-loan-sim-perf-${randomUUID()}`,
    iat: now - 5,
    exp: now + 3600,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `perf-loan-sim-${randomUUID()}@pfos.test`,
    email_verified: true,
    name: 'perf',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(pair.privateKey);
  const me = await api('GET', '/api/v1/me');
  const workspaceId = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
  W = `/api/v1/workspaces/${workspaceId}`;
  const bank = await api('POST', `${W}/accounts`, {
    name: 'Banco BOB',
    type: 'BANK',
    currency: 'BOB',
    openingBalance: { amount: { amount: '1000.00', currency: 'BOB' }, date: '2026-09-01' },
  });
  expect(bank.status, JSON.stringify(bank.body)).toBe(201);
  for (let i = 0; i < LOANS; i += 1) {
    const draft = await api('POST', `${W}/loans`, {
      name: `Préstamo ${i}`,
      account: { create: { name: `Préstamo de simulación ${i}` } },
      disbursementAccountId: bank.body['id'],
      principal: { amount: `${100_000 + i * 5_000}.00`, currency: 'BOB' },
      annualRate: `0.${String(10 + i).padStart(2, '0')}`,
      termInstallments: 360,
      disbursementDate: '2026-10-15',
      firstDueDate: '2026-11-15',
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const active = await api('POST', `${W}/loans/${draft.body['id']}/disburse`, {});
    expect(active.status, JSON.stringify(active.body)).toBe(200);
    loanIds.push(draft.body['id'] as string);
  }
}, 900_000);

afterAll(async () => {
  await runtime?.close();
});

const p95 = (times: number[]): number => {
  const sorted = [...times].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
};

async function measure(scenario: Record<string, unknown>): Promise<number[]> {
  const read = async () => {
    const started = performance.now();
    const r = await api('POST', `${W}/loans/payoff-simulations`, { scenario });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return performance.now() - started;
  };
  await read(); // calentamiento (conexiones y planes)
  const times: number[] = [];
  for (let i = 0; i < SAMPLES; i += 1) times.push(await read());
  return times;
}

describe('NFR-PERF-004: simulador de pago anticipado con 10 préstamos de 360 cuotas', () => {
  it('[TC-DEBT-AMORT-045] estrategias avalanche y snowball con 500.00 BOB extra al mes: p95 < 300 ms', async () => {
    const times = await measure({
      strategies: ['AVALANCHE', 'SNOWBALL'],
      monthlyExtra: { amount: '500.00', currency: 'BOB' },
    });
    console.info(`simulador de estrategias: p95 ${Math.round(p95(times))} ms (${SAMPLES} muestras)`);
    expect(p95(times)).toBeLessThan(BUDGET_MS);
  }, 600_000);

  it('[TC-DEBT-AMORT-045] pagos extra de un préstamo (mensual y único): p95 < 300 ms', async () => {
    const times = await measure({
      loanId: loanIds[0],
      extras: [
        { type: 'MONTHLY', fromInstallmentNo: 1, amount: '500.00' },
        { type: 'ONE_TIME', installmentNo: 12, amount: '5000.00' },
      ],
    });
    console.info(`simulador de pagos extra: p95 ${Math.round(p95(times))} ms (${SAMPLES} muestras)`);
    expect(p95(times)).toBeLessThan(BUDGET_MS);
  }, 600_000);
});
