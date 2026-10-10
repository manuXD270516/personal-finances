import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import {
  commitmentsEventConsumers,
  createCommitmentsRuntime,
  runGenerateOccurrences,
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
import {
  EventConsumerRuntime,
  EventSubscriptions,
  PgOutboxWriter,
  deadLetterQueueName,
  eventQueueName,
  type EventEnvelope,
} from '@pf/platform/events';
import { uuidv7 } from '@pf/platform/logging';
import { PgBossJobQueue } from '@pf/platform/queue';
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
import { connect } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

/**
 * NFR-PERF-009 (TC-COMMITMENTS-RECUR-017, Should): `GenerateOccurrences(workspace)` de 60 definiciones activas
 * (20 diarias, 20 semanales y 20 mensuales) con horizonte de 90 días termina en ≤ 10 s contra PostgreSQL real. Corre en
 * el job nightly `perf` (`pnpm perf:bench`); no bloquea los PR.
 */
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const clock = new FixedClock(Instant.parse('2026-10-09T16:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const workerLog = capturingLogger('finance-worker', 'worker');
const BUDGET_MS = 10_000;

let runtime: ApiRuntime;
let worker: Pool;
let commitments: CommitmentsRuntime;
let userId = '';
let workspaceId = '';
let accountId = '';
let apiToken = '';
let categoryId = '';

async function api(method: string, path: string, token: string, body?: unknown) {
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
let baseUrl = '';

beforeAll(async () => {
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 6 });
  const pair = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(baseEnv(deps, { RATE_LIMIT_WRITES_PER_MIN: '100000' })),
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
  const token = await new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: `kc-rec-perf-${randomUUID()}`,
    iat: now - 5,
    exp: now + 600,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `perf-${randomUUID()}@pfos.test`,
    email_verified: true,
    name: 'perf',
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(pair.privateKey);
  apiToken = token;
  const me = await api('GET', '/api/v1/me', token);
  userId = me.body['id'] as string;
  workspaceId = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
  const account = await api('POST', `/api/v1/workspaces/${workspaceId}/accounts`, token, {
    name: 'Banco BOB',
    type: 'BANK',
    currency: 'BOB',
  });
  accountId = account.body['id'] as string;
  const group = await api('POST', `/api/v1/workspaces/${workspaceId}/category-groups`, token, {
    name: 'Servicios (perf)',
    kind: 'EXPENSE',
  });
  const cat = await api('POST', `/api/v1/workspaces/${workspaceId}/categories`, token, {
    groupId: group.body['id'],
    name: 'Internet (perf)',
  });
  categoryId = cat.body['id'] as string;

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
}, 300_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
});

describe('NFR-PERF-009: generación de ocurrencias', () => {
  it('[TC-COMMITMENTS-RECUR-017] 60 definiciones (20 diarias, 20 semanales y 20 mensuales) con horizonte de 90 días se generan en ≤ 10 s', async () => {
    const cadences = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
    for (const cadence of cadences) {
      for (let i = 0; i < 20; i += 1) {
        await runWithRequestContext({ actor: { type: 'USER', userId }, origin: 'api' }, () =>
          commitments.definitions.create({
            workspaceId,
            userId,
            name: `${cadence} ${i}`,
            kind: 'EXPENSE',
            template: {
              accountId,
              amount: { type: 'FIXED', amount: { amount: '10.00', currency: 'BOB' } },
              schedule: { cadence, startDate: '2026-10-09' },
              materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
            },
          }),
        );
      }
    }
    // Las deja sin ventana generada: es lo que el job debe producir de cero.
    const admin = await connect(deps.superuserUrl);
    try {
      await admin.query(`DELETE FROM commitments.recurring_occurrence WHERE workspace_id = $1`, [
        workspaceId,
      ]);
      await admin.query(
        `UPDATE commitments.recurring_definition SET generated_through = NULL WHERE workspace_id = $1`,
        [workspaceId],
      );
    } finally {
      await admin.end();
    }
    const started = performance.now();
    const result = await runGenerateOccurrences(
      commitments.generate,
      { list: async () => [{ workspaceId }] },
      workerLog.logger,
      'manual',
    );
    const elapsed = performance.now() - started;
    const reader = await connect(deps.superuserUrl);
    const counted = await reader
      .query(`SELECT count(*)::int AS n FROM commitments.recurring_occurrence WHERE workspace_id = $1`, [
        workspaceId,
      ])
      .finally(() => reader.end());
    console.info(
      `commitments.generate-occurrences: ${result.generated} ocurrencias en ${Math.round(elapsed)} ms`,
    );
    expect(result.failed).toBe(0);
    expect(result.generated).toBe(counted.rows[0].n);
    // 20×91 diarias + 20×13 semanales + 20×4 mensuales (el 9 de octubre cuenta).
    expect(result.generated).toBeGreaterThan(2000);
    expect(elapsed).toBeLessThanOrEqual(BUDGET_MS);
  });
});

/**
 * NFR-PERF-008 / D112 (TC-COMMITMENTS-MATCH-012): el consumidor `commitments.occurrence-matcher` drena una ráfaga de
 * 1 000 transacciones importadas (12 compatibles con ocurrencias pendientes y 50 hechos entregados dos veces) con su
 * concurrencia y lotes reales, sobre pg-boss y PostgreSQL reales, sin sugerencias duplicadas y por encima de la meta de
 * 42 eventos/s por consumidor.
 */
describe('NFR-PERF-008: ráfaga de transacciones importadas en el matcher', () => {
  it('[TC-COMMITMENTS-MATCH-012] 1 000 transacciones (12 compatibles, 50 reentregadas) dejan exactamente 12 sugerencias a ≥ 42 eventos/s', async () => {
    const BURST = 1000;
    const REDELIVERED = 50;
    const GOAL_EVENTS_PER_SECOND = 42;
    const admin = await connect(deps.superuserUrl);
    try {
      await admin.query(`DELETE FROM commitments.occurrence_match_suggestion WHERE workspace_id = $1`, [
        workspaceId,
      ]);
    } finally {
      await admin.end();
    }
    // 12 definiciones con montos separados más de un 10 %: cada gasto solo es compatible con "su" ocurrencia.
    const amounts = Array.from({ length: 12 }, (_, i) => (100 * 1.25 ** i).toFixed(2));
    for (const [i, amount] of amounts.entries()) {
      await runWithRequestContext({ actor: { type: 'USER', userId }, origin: 'api' }, () =>
        commitments.definitions.create({
          workspaceId,
          userId,
          name: `Servicio ráfaga ${i}`,
          kind: 'EXPENSE',
          template: {
            accountId,
            amount: { type: 'FIXED', amount: { amount, currency: 'BOB' } },
            schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
            materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
          },
        }),
      );
    }
    // Las transacciones se registran por la API real (ledger, auditoría y outbox de Transactions incluidos).
    const ids: string[] = [];
    const record = async (i: number): Promise<string> => {
      const matches = i < amounts.length;
      const amount = matches ? (amounts[i] as string) : (5000 + i * 7).toFixed(2);
      const created = await api('POST', `/api/v1/workspaces/${workspaceId}/transactions`, apiToken, {
        kind: 'EXPENSE',
        transactionDate: matches ? '2026-10-20' : '2026-10-19',
        accountId,
        amount: { amount, currency: 'BOB' },
        splits: [{ amount: { amount, currency: 'BOB' }, categoryId }],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      return created.body['id'] as string;
    };
    for (let from = 0; from < BURST; from += 10) {
      ids.push(...(await Promise.all(Array.from({ length: 10 }, (_, k) => record(from + k)))));
    }
    const envelope = (transactionId: string): EventEnvelope => ({
      eventId: uuidv7(),
      eventType: 'transactions.TransactionCreated',
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      workspaceId,
      aggregateType: 'Transaction',
      aggregateId: transactionId,
      aggregateVersion: 1,
      correlationId: uuidv7(),
      causationId: null,
      actor: { type: 'SYSTEM', id: null },
      payload: { transactionId, origin: { type: 'IMPORT', refId: null } },
    });
    // Los 50 reentregados llevan otro eventId: el inbox no los frena, los frena el UNIQUE del par.
    const events = [...ids.map(envelope), ...ids.slice(0, REDELIVERED).map(envelope)];

    const def = commitmentsEventConsumers(commitments).find(
      (d) => d.consumer === 'commitments.occurrence-matcher',
    )!;
    const queue = new PgBossJobQueue({
      connectionString: deps.workerDatabaseUrl,
      logger: workerLog.logger,
      pollingIntervalSeconds: 0.5,
      role: 'consumer',
    });
    await queue.start();
    try {
      const route = new EventSubscriptions([def]).routesFor('transactions.TransactionCreated', 1)[0]!;
      await queue.ensureQueue(deadLetterQueueName(def.consumer));
      await queue.ensureQueue(route.queue, route.options);
      const client = await worker.connect();
      try {
        await client.query('BEGIN');
        await queue.enqueueInTransaction(
          eventQueueName(def.consumer),
          events.map((e) => ({
            id: e.eventId,
            key: e.aggregateId,
            payload: e,
            correlationId: e.correlationId,
            traceContext: {},
          })),
          client,
        );
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      const consumers = new EventConsumerRuntime({
        pool: worker,
        queue,
        subscriptions: new EventSubscriptions([def]),
        logger: workerLog.logger,
      });
      const started = performance.now();
      await consumers.start();
      const deadline = Date.now() + 300_000;
      for (;;) {
        const { rows } = await worker.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM platform.inbox WHERE consumer = $1 AND workspace_id = $2',
          [def.consumer, workspaceId],
        );
        if ((rows[0]?.n ?? 0) >= events.length) break;
        if (Date.now() > deadline) throw new Error('el matcher no drenó la ráfaga a tiempo');
        await new Promise((r) => setTimeout(r, 100));
      }
      const seconds = (performance.now() - started) / 1000;
      const rate = events.length / seconds;
      process.stderr.write(
        `[TC-COMMITMENTS-MATCH-012] ${events.length} eventos en ${seconds.toFixed(1)} s (${String(Math.round(rate))} ev/s)
`,
      );
      expect(rate).toBeGreaterThanOrEqual(GOAL_EVENTS_PER_SECOND);
    } finally {
      await queue.drain();
      await queue.stop();
    }
    const reader = await connect(deps.superuserUrl);
    try {
      const { rows } = await reader.query<{ status: string; n: number }>(
        `SELECT status, count(*)::int AS n FROM commitments.occurrence_match_suggestion
          WHERE workspace_id = $1 GROUP BY status`,
        [workspaceId],
      );
      expect(Object.fromEntries(rows.map((r) => [r.status, r.n]))).toEqual({ PROPOSED: 12 });
    } finally {
      await reader.end();
    }
  }, 900_000);
});
