import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import {
  createCommitmentsRuntime,
  runSubscriptionDaily,
  type CommitmentsRuntime,
} from '@pf/commitments/interface/commitments.module';
import {
  identityWorkspaceCalendarDirectory,
  identityWorkspaceSettingsDirectory,
  identityWorkspaceTimeZones,
} from '@pf/identity/interface/identity.module';
import { ledgerActivityRange } from '@pf/ledger/interface/ledger.module';
import { createPlanningRuntime } from '@pf/planning/interface/planning.module';
import { runWithRequestContext } from '@pf/platform/api';
import { PgOutboxWriter } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import {
  AUDIT_POLICIES,
  counterpartyNamesOf,
  financeRuntimes,
  financialPeriodPort,
  LIFECYCLE_MACHINES,
  outboxPort,
} from '../../src/identity/identity-wiring.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

/**
 * Presupuestos de rendimiento de suscripciones (openspec add-subscriptions, tarea 5.2; Should):
 *  - `GET W/subscriptions/cost-summary` con 60 suscripciones en 4 monedas: p95 ≤ 300 ms (referencia NFR-PERF-004);
 *  - el job `commitments.subscription-daily` procesa 60 suscripciones de un workspace en ≤ 10 s (referencia
 *    NFR-PERF-009), con un recordatorio por suscripción.
 * Corre en el job nightly `perf` (`pnpm perf:bench`); no bloquea los PR.
 */
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const clock = new FixedClock(Instant.parse('2026-11-10T16:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const workerLog = capturingLogger('finance-worker', 'worker');
const COST_P95_MS = 300;
const DAILY_BUDGET_MS = 10_000;
const CURRENCIES = ['BOB', 'USD', 'USDT', 'EUR'] as const;

let runtime: ApiRuntime;
let worker: Pool;
let commitments: CommitmentsRuntime;
let baseUrl = '';
let token = '';
let userId = '';
let workspaceId = '';
const accounts = new Map<string, string>();

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

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
};

beforeAll(async () => {
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 6 });
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
    sub: `kc-subs-perf-${randomUUID()}`,
    iat: now - 5,
    exp: now + 3600,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `subs-perf-${randomUUID()}@pfos.test`,
    email_verified: true,
    name: 'perf',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(pair.privateKey);
  const me = await api('GET', '/api/v1/me');
  userId = me.body['id'] as string;
  workspaceId = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
  // EUR no viene habilitada por omisión (BOB/USD/USDT): se habilita para el workspace.
  const client = await worker.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.workspace_id', $1, true)`,
      [workspaceId],
    );
    await client.query(
      `INSERT INTO fx.workspace_currency (workspace_id, currency_code) VALUES ($1, 'EUR') ON CONFLICT DO NOTHING`,
      [workspaceId],
    );
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  for (const currency of CURRENCIES) {
    const created = await api('POST', `/api/v1/workspaces/${workspaceId}/accounts`, {
      name: `Cuenta ${currency}`,
      type: 'BANK',
      currency,
    });
    accounts.set(currency, created.body['id'] as string);
    if (currency !== 'BOB') {
      const rate = await api('POST', `/api/v1/workspaces/${workspaceId}/fx-rates`, {
        base: currency,
        quote: 'BOB',
        value: currency === 'EUR' ? '10.50' : '9.80',
        rateType: 'PARALLEL',
        asOf: '2026-11-10T10:00:00Z',
      });
      expect(rate.status, JSON.stringify(rate.body)).toBe(201);
    }
  }
  const provider = await api('POST', `/api/v1/workspaces/${workspaceId}/counterparties`, {
    name: 'Proveedor',
  });

  const audit = createAuditRuntime({
    pool: worker,
    clock,
    policies: AUDIT_POLICIES,
    timeZones: identityWorkspaceTimeZones(worker),
    machines: LIFECYCLE_MACHINES,
  });
  const writer = new PgOutboxWriter(eventSchemaRegistry());
  const finance = financeRuntimes({
    pool: worker,
    clock,
    audit: audit.port,
    lifecycle: audit.lifecycle,
    lifecycleQuery: audit.lifecycleQuery,
    history: audit.history,
    logger: workerLog.logger,
    config: apiConfig(baseEnv(deps)),
    outbox: writer,
  });
  const planning = createPlanningRuntime({
    pool: worker,
    clock,
    audit: audit.port,
    lifecycle: audit.lifecycle,
    outbox: outboxPort(writer),
    calendar: identityWorkspaceCalendarDirectory(worker),
    activity: ledgerActivityRange(),
  });
  commitments = createCommitmentsRuntime({
    pool: worker,
    clock,
    audit: audit.port,
    lifecycle: audit.lifecycle,
    lifecycleQuery: audit.lifecycleQuery,
    outbox: outboxPort(writer),
    calendar: identityWorkspaceCalendarDirectory(worker),
    settings: identityWorkspaceSettingsDirectory(worker),
    periods: financialPeriodPort(planning.periodQuery),
    accounts: finance.accounts.query,
    accountCatalog: finance.accounts.catalog,
    classification: finance.classification.validator,
    rates: finance.fx.valuation,
    transactions: finance.transactions.recurring,
    links: finance.transactions.links,
    pending: finance.transactions.pending,
    counterpartyNames: counterpartyNamesOf(finance.classification.counterparties),
    rateValidityWindowDays: 7,
  });

  // 60 suscripciones activas en 4 monedas (15 por moneda, el precio en su propia moneda), todas con su próxima
  // renovación dentro de la ventana del recordatorio (3 días).
  await runWithRequestContext({ actor: { type: 'USER', userId }, origin: 'api' }, async () => {
    for (let i = 0; i < 60; i += 1) {
      const currency = CURRENCIES[i % CURRENCIES.length]!;
      await commitments.subscriptions.create({
        workspaceId,
        userId,
        counterpartyId: provider.body['id'] as string,
        name: `Suscripción ${i}`,
        price: { amount: `${10 + i}.00`, currency },
        billingCycle: { cadence: 'MONTHLY' },
        firstRenewalOn: '2026-11-12',
        paymentAccountId: accounts.get(currency)!,
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      });
    }
  });
}, 600_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
});

describe('Rendimiento de suscripciones', () => {
  it('[TC-COMMITMENTS-SUBS-025] el costo de 60 suscripciones en 4 monedas responde con p95 ≤ 300 ms', async () => {
    const samples: number[] = [];
    for (let i = 0; i < 30; i += 1) {
      const started = performance.now();
      const reply = await api('GET', `/api/v1/workspaces/${workspaceId}/subscriptions/cost-summary`);
      samples.push(performance.now() - started);
      expect(reply.status).toBe(200);
      expect((reply.body['items'] as unknown[]).length).toBe(60);
    }
    const p95 = percentile(samples, 95);
    console.info(`subscriptions.cost-summary: p95 ${Math.round(p95)} ms (n=${samples.length})`);
    expect(p95).toBeLessThanOrEqual(COST_P95_MS);
  });

  it('[TC-COMMITMENTS-SUBS-027] el job diario procesa 60 suscripciones con su recordatorio en ≤ 10 s', async () => {
    const started = performance.now();
    const result = await runSubscriptionDaily(
      commitments.subscriptionDaily,
      { list: async () => [{ workspaceId }] },
      workerLog.logger,
      'manual',
    );
    const elapsed = performance.now() - started;
    console.info(
      `commitments.subscription-daily: ${result.reminders} recordatorios en ${Math.round(elapsed)} ms`,
    );
    expect(result.failed).toBe(0);
    expect(result.reminders).toBe(60);
    expect(elapsed).toBeLessThanOrEqual(DAILY_BUDGET_MS);
  });
});
