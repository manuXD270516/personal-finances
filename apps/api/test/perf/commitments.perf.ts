import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import {
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
  runtime = await createApiRuntime(apiConfig(baseEnv(deps)), apiLog.logger, {
    clock,
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
    },
  });
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
  const me = await api('GET', '/api/v1/me', token);
  userId = me.body['id'] as string;
  workspaceId = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;
  const account = await api('POST', `/api/v1/workspaces/${workspaceId}/accounts`, token, {
    name: 'Banco BOB',
    type: 'BANK',
    currency: 'BOB',
  });
  accountId = account.body['id'] as string;

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
