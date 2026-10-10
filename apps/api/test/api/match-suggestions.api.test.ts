import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import {
  commitmentsEventConsumers,
  createCommitmentsRuntime,
  type CommitmentsRuntime,
} from '@pf/commitments/interface/commitments.module';
import {
  identityWorkspaceCalendarDirectory,
  identityWorkspaceSettingsDirectory,
  identityWorkspaceTimeZones,
} from '@pf/identity/interface/identity.module';
import { ledgerActivityRange } from '@pf/ledger/interface/ledger.module';
import { createPlanningRuntime } from '@pf/planning/interface/planning.module';
import { ApiContract, runWithRequestContext } from '@pf/platform/api';
import {
  EventConsumerRuntime,
  EventSubscriptions,
  PgOutboxWriter,
  type EventConsumerDefinition,
  type EventEnvelope,
} from '@pf/platform/events';
import type { JobQueue } from '@pf/platform/queue';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
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
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Matching sugerido por HTTP y por los consumidores del worker contra PostgreSQL real (openspec add-commitment-matching,
// tareas 3.3, 3.4, 4.2, 5.2): sugerencias creadas por `commitments.occurrence-matcher` y `commitments.match-backfill`
// (pf_worker, inbox + UNIQUE del par), lista, confirmar, descartar, expiración, tolerancias y roles, con las
// respuestas validadas contra el OpenAPI.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const contract = ApiContract.fromFile(resolveContractPath());
const clock = new FixedClock(Instant.parse('2026-10-09T16:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const workerLog = capturingLogger('finance-worker', 'worker');
const apiErrors = () =>
  JSON.stringify(apiLog.records().filter((r) => Number(r['level']) >= 50 || r['level'] === 'error'));

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
let worker: Pool;
let commitments: CommitmentsRuntime;
let ensurePeriods: (ws: string) => Promise<unknown>;
let consumers: EventConsumerRuntime;
let definitions: Map<string, EventConsumerDefinition>;

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

async function tokenFor(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub,
    iat: now - 5,
    exp: now + 300,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `${sub}@pfos.test`,
    email_verified: true,
    name: sub,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(signingKey);
}

async function call(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
  let payload: string | undefined;
  if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] ??= 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId };
}
type User = Awaited<ReturnType<typeof user>>;
const W = (u: User, ws = u.ws) => `/api/v1/workspaces/${ws}`;

async function join(owner: User, member: User, role: 'EDITOR' | 'VIEWER'): Promise<void> {
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: owner.ws },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, $3, 'ACTIVE')`,
          [owner.ws, member.id, role],
        ),
      true,
    );
  } finally {
    await app.end();
  }
}

const post = (u: User, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call('POST', `${W(u)}${path}`, {
    token: u.token,
    ...(body !== undefined ? { body } : {}),
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
const get = (u: User, path: string) => call('GET', `${W(u)}${path}`, { token: u.token });
const patch = (u: User, path: string, body: unknown, version: number) =>
  call('PATCH', `${W(u)}${path}`, {
    token: u.token,
    body,
    headers: { 'if-match': `"${version}"` },
  });
const ok = async (r: Promise<Reply>, status = 201) => {
  const reply = await r;
  expect(reply.status, `${JSON.stringify(reply.body)} ${apiErrors()}`).toBe(status);
  return reply.body;
};
const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.body['code'], JSON.stringify(r.body)).toBe(code);
};

async function outboxOf(ws: string, eventType: string) {
  const { rows } = await worker.query<{ envelope: EventEnvelope }>(
    'SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = $2 ORDER BY sequence',
    [ws, eventType],
  );
  return rows.map((r) => r.envelope);
}

/** Auditoría y recorrido como los ve el worker (RLS por workspace). */
async function auditOf(ws: string, where: string, params: unknown[] = []) {
  const client = await worker.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.workspace_id', $1, true)`,
      [ws],
    );
    const res = await client.query<{
      action: string;
      aggregate_type: string;
      aggregate_id: string;
      actor_type: string;
      actor_process: string | null;
      origin: string;
    }>(
      `SELECT action, aggregate_type, aggregate_id::text, actor_type, actor_process, origin
         FROM audit.audit_log WHERE ${where} ORDER BY occurred_at, id`,
      params,
    );
    await client.query('COMMIT');
    return res.rows;
  } finally {
    client.release();
  }
}

const deliver = (consumer: string, envelope: EventEnvelope) =>
  consumers.deliver(definitions.get(consumer)!, envelope);

const bob = (amount: string) => ({ amount, currency: 'BOB' });

let owner: User;
let editor: User;
let viewer: User;
let outsider: User;
let bank: string;
let cash: string;
let category: string;
let archivedCategory: string;

async function account(u: User, name: string, currency: string, opening: string): Promise<string> {
  const r = await ok(
    post(u, '/accounts', {
      name,
      type: 'BANK',
      currency,
      openingBalance: { amount: { amount: opening, currency }, date: '2026-09-01' },
    }),
  );
  return r['id'] as string;
}

const template = (over: Record<string, unknown> = {}) => ({
  accountId: bank,
  amount: { type: 'FIXED', amount: bob('3500.00') },
  categoryId: category,
  schedule: { cadence: 'MONTHLY', startDate: '2026-10-05' },
  materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
  ...over,
});

const createDefinition = (
  name: string,
  over: Record<string, unknown> = {},
  kind = 'EXPENSE',
  u: User = owner,
): Promise<Reply> => post(u, '/recurring', { name, kind, template: template(over) });

async function created(name: string, over: Record<string, unknown> = {}, kind = 'EXPENSE') {
  const body = await ok(createDefinition(name, over, kind));
  expect(contract.validateResponse('createRecurringDefinition', 201, body), JSON.stringify(body)).toEqual([]);
  return body as { id: string; version: number; generatedCount: number; status: string };
}

interface Occ {
  id: string;
  occurrenceDate: string;
  dueDate: string;
  status: string;
  version: number;
  transactionId: string | null;
  requiresApproval: boolean;
  definitionName: string;
  lastAutoCreateError: string | null;
}
async function occurrencesOf(definitionId: string, query = ''): Promise<Occ[]> {
  const r = await get(owner, `/recurring/${definitionId}/occurrences?limit=200${query}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(contract.validateResponse('listDefinitionOccurrences', 200, r.body), JSON.stringify(r.body)).toEqual(
    [],
  );
  return r.body['data'] as Occ[];
}
const occOn = async (definitionId: string, date: string) =>
  (await occurrencesOf(definitionId)).find((o) => o.occurrenceDate === date)!;

beforeAll(async () => {
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 6 });
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(apiConfig(baseEnv(deps)), apiLog.logger, {
    clock,
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
    },
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
  owner = await user(`kc-match-owner-${randomUUID()}`);
  editor = await user(`kc-match-editor-${randomUUID()}`);
  viewer = await user(`kc-match-viewer-${randomUUID()}`);
  outsider = await user(`kc-match-out-${randomUUID()}`);
  await join(owner, editor, 'EDITOR');
  await join(owner, viewer, 'VIEWER');

  // Composición del worker (pf_worker): la misma que create-worker-runtime.
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
  // Periodos como en el worker: calendario del directorio (pf_worker no ve iam.workspace por membresía).
  const planning = createPlanningRuntime({
    pool: worker,
    clock,
    audit: audit.port,
    lifecycle: audit.lifecycle,
    outbox: outboxPort(writer),
    calendar: identityWorkspaceCalendarDirectory(worker),
    activity: ledgerActivityRange(),
  });
  ensurePeriods = (ws) =>
    runWithRequestContext(
      { actor: { type: 'WORKER', process: 'planning.ensure-periods' }, origin: 'system' },
      () => planning.service.ensurePeriods({ workspaceId: ws }),
    );
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
  const defs = commitmentsEventConsumers(commitments);
  definitions = new Map(defs.map((d) => [d.consumer, d]));
  consumers = new EventConsumerRuntime({
    pool: worker,
    queue: {} as JobQueue,
    subscriptions: new EventSubscriptions(defs),
    logger: workerLog.logger,
  });

  bank = await account(owner, 'Banco BOB', 'BOB', '50000.00');
  cash = await account(owner, 'Efectivo', 'BOB', '1000.00');
  const group = (await ok(post(owner, '/category-groups', { name: 'Vivienda (rec)', kind: 'EXPENSE' })))[
    'id'
  ] as string;
  category = (await ok(post(owner, '/categories', { groupId: group, name: 'Alquiler (rec)' })))[
    'id'
  ] as string;
  archivedCategory = (await ok(post(owner, '/categories', { groupId: group, name: 'Cable TV (rec)' })))[
    'id'
  ] as string;
  await ok(
    call('POST', `${W(owner)}/categories/${archivedCategory}/archive`, {
      token: owner.token,
      headers: { 'if-match': '"1"' },
    }),
    200,
  );
  await ensurePeriods(owner.ws);
}, 240_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
});

// ───────────────────────────────────────────── matching sugerido (openspec add-commitment-matching)

const patchTx = (u: User, id: string, body: unknown, version: number) =>
  call('PATCH', `${W(u)}/transactions/${id}`, {
    token: u.token,
    body,
    headers: { 'if-match': `"${version}"`, 'content-type': 'application/merge-patch+json' },
  });

/** Registra un gasto manual (el hecho `TransactionCreated.v1` queda en el outbox). */
async function expense(
  date: string,
  amount: string,
  over: Record<string, unknown> = {},
  accountId = bank,
  u: User = owner,
) {
  const created = await ok(
    post(u, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: date,
      accountId,
      amount: bob(amount),
      splits: [{ amount: bob(amount), categoryId: category }],
      ...over,
    }),
  );
  return created['id'] as string;
}

const txEvent = async (type: string, transactionId: string, nth = -1) => {
  const all = (await outboxOf(owner.ws, type)).filter(
    (e) => (e.payload as { transactionId?: string }).transactionId === transactionId,
  );
  const found = nth < 0 ? all.at(nth) : all[nth];
  expect(found, `${type} de ${transactionId}`).toBeDefined();
  return found as EventEnvelope;
};

const matcher = 'commitments.occurrence-matcher';
const backfill = 'commitments.match-backfill';

interface Suggestion {
  id: string;
  score: string;
  confidence: string;
  status: string;
  ambiguous: boolean;
  expireReason: string | null;
  version: number;
  reasons: {
    amountDelta: { amount: string; currency: string } | null;
    dateDeltaDays: number;
    counterparty: string;
  };
  occurrence: { id: string; definitionName: string; status: string; dueDate: string } | null;
  transaction: { id: string; source: string; businessDate: string; amount: { amount: string } } | null;
}
async function suggestions(query = '', u: User = owner) {
  const r = await call('GET', `${W(owner)}/recurring/match-suggestions?limit=200${query}`, {
    token: u.token,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(contract.validateResponse('listMatchSuggestions', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  return { data: r.body['data'] as Suggestion[], proposedCount: r.body['proposedCount'] as number };
}
const forTx = async (transactionId: string, status = 'PROPOSED,CONFIRMED,DISMISSED,EXPIRED') =>
  (await suggestions(`&transactionId=${transactionId}&status=${status}`)).data;

const suggestedEvents = async (transactionId: string) =>
  (await outboxOf(owner.ws, 'commitments.OccurrenceMatchSuggested')).filter(
    (e) => (e.payload as { transactionId: string }).transactionId === transactionId,
  );

describe('Sugerencia de coincidencia: consumidor, lista y contrato (FR-COMMITMENTS-010)', () => {
  it('[TC-COMMITMENTS-MATCH-001][TC-COMMITMENTS-MATCH-016] un gasto manual genera una sugerencia HIGH sin resolver la ocurrencia; el hecho reentregado no duplica', async () => {
    const def = await created('Internet match', {
      amount: { type: 'FIXED', amount: bob('199.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    const occ = await occOn(def.id, '2026-10-20');
    const txId = await expense('2026-10-19', '199.00');
    const event = await txEvent('transactions.TransactionCreated', txId);
    expect(await deliver(matcher, event)).toBe('applied');
    // misma entrega (inbox) y otra entrega del mismo hecho con otro eventId (UNIQUE del par)
    expect(await deliver(matcher, event)).toBe('duplicate');
    expect(await deliver(matcher, { ...event, eventId: randomUUID() })).toBe('applied');

    const found = await forTx(txId);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      status: 'PROPOSED',
      score: '85.00',
      confidence: 'HIGH',
      ambiguous: false,
      expireReason: null,
      reasons: { amountDelta: bob('0.00'), dateDeltaDays: 1, counterparty: 'UNKNOWN' },
      occurrence: { id: occ.id, definitionName: 'Internet match', dueDate: '2026-10-20' },
      transaction: { id: txId, source: 'MANUAL', businessDate: '2026-10-19', amount: bob('199.00') },
    });
    // La ocurrencia y la transacción siguen sin tocarse y ningún hecho de vinculación se emitió.
    expect(await occOn(def.id, '2026-10-20')).toMatchObject({ transactionId: null, status: occ.status });
    expect(
      (await outboxOf(owner.ws, 'commitments.RecurringOccurrenceMaterialized')).filter(
        (e) => e.aggregateId === occ.id,
      ),
    ).toEqual([]);
    const emitted = await suggestedEvents(txId);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.payload).toMatchObject({
      suggestionId: found[0]!.id,
      occurrenceId: occ.id,
      score: '85.00',
      confidence: 'HIGH',
      amountDelta: bob('0.00'),
      dateDeltaDays: 1,
      transactionOrigin: 'MANUAL',
    });
    const listed = await suggestions();
    expect(listed.proposedCount).toBeGreaterThanOrEqual(1);
    expect(listed.data.map((s) => s.id)).toContain(found[0]!.id);
    // sin auditoría de creación por fila (derivado recalculable): solo las decisiones del usuario se auditan
    expect(await auditOf(owner.ws, `aggregate_id = $1`, [found[0]!.id])).toEqual([]);
  });

  it('[TC-COMMITMENTS-MATCH-002] un gasto sin ocurrencia compatible no genera sugerencias', async () => {
    await created('Internet solo banco', {
      amount: { type: 'FIXED', amount: bob('777.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    const txId = await expense('2026-10-19', '45.90', {}, cash);
    await deliver(matcher, await txEvent('transactions.TransactionCreated', txId));
    expect(await forTx(txId)).toEqual([]);
  });

  it('[TC-COMMITMENTS-MATCH-006] confirmar vincula por sugerencia y saca el pago del comprometido; la misma clave repite la respuesta', async () => {
    const def = await created('Internet confirmar', {
      amount: { type: 'FIXED', amount: bob('321.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    await created('Internet confirmar oficina', {
      amount: { type: 'FIXED', amount: bob('321.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-22' },
    });
    const occ = await occOn(def.id, '2026-10-20');
    const txId = await expense('2026-10-21', '321.00');
    await deliver(matcher, await txEvent('transactions.TransactionCreated', txId));
    const found = await forTx(txId);
    expect(found).toHaveLength(2);
    const chosen = found.find((s) => s.occurrence?.id === occ.id)!;
    const rival = found.find((s) => s.occurrence?.id !== occ.id)!;
    expect(chosen).toMatchObject({ score: '85.00', ambiguous: true });

    const key = randomUUID();
    const confirmed = await post(owner, `/recurring/match-suggestions/${chosen.id}/confirm`, undefined, {
      'idempotency-key': key,
    });
    expect(confirmed.status, `${JSON.stringify(confirmed.body)} ${apiErrors()}`).toBe(200);
    expect(contract.validateResponse('confirmMatchSuggestion', 200, confirmed.body)).toEqual([]);
    expect(confirmed.body['suggestion']).toMatchObject({ id: chosen.id, status: 'CONFIRMED' });
    expect(confirmed.body['occurrence']).toMatchObject({
      id: occ.id,
      status: 'MATCHED',
      matchedBy: 'SUGGESTION',
      transactionId: txId,
    });
    // la misma clave repite la respuesta; otra clave sobre una ya confirmada ⇒ 409
    const replay = await post(owner, `/recurring/match-suggestions/${chosen.id}/confirm`, undefined, {
      'idempotency-key': key,
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(confirmed.body);
    problem(
      await post(owner, `/recurring/match-suggestions/${chosen.id}/confirm`),
      409,
      'MATCH_SUGGESTION_NOT_PENDING',
    );
    // la otra se expiró por sustitución
    const rivalNow = (await forTx(txId)).find((s) => s.id === rival.id)!;
    expect(rivalNow).toMatchObject({ status: 'EXPIRED', expireReason: 'SUPERSEDED' });
    expect((await suggestions()).data.map((s) => s.id)).not.toContain(rival.id);

    // hecho de vinculación con matchedBy SUGGESTION, auditoría de la decisión y recorrido de la ocurrencia
    const materialized = (await outboxOf(owner.ws, 'commitments.RecurringOccurrenceMaterialized')).filter(
      (e) => e.aggregateId === occ.id,
    );
    expect(materialized).toHaveLength(1);
    expect(materialized[0]?.payload).toMatchObject({
      mode: 'MATCHED',
      matchedBy: 'SUGGESTION',
      transactionId: txId,
      amount: bob('321.00'),
    });
    const audits = await auditOf(owner.ws, `aggregate_id = $1`, [chosen.id]);
    expect(audits.map((a) => a.action)).toEqual(['commitments.match_suggestion.confirmed']);
    const lifecycle = await get(owner, `/recurring/occurrences/${occ.id}/lifecycle`);
    expect(lifecycle.status).toBe(200);
    const link = (
      lifecycle.body['items'] as { transition?: string; detailRefs?: Record<string, unknown> }[]
    ).find((i) => i.transition === 'LINK');
    expect(link?.detailRefs).toMatchObject({ transactionId: txId, suggestionId: chosen.id });

    // sale del total comprometido de octubre (queda solo la oficina)
    const committed = await get(owner, '/recurring/committed');
    expect(committed.status).toBe(200);
    const names = (committed.body['items'] as { name: string }[]).map((i) => i.name);
    expect(names).not.toContain('Internet confirmar');
    expect(names).toContain('Internet confirmar oficina');
  });

  it('[TC-COMMITMENTS-MATCH-007] aprobar la ocurrencia por otra vía expira la sugerencia y confirmar responde 409', async () => {
    const def = await created('Internet otra via', {
      amount: { type: 'FIXED', amount: bob('333.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    const occ = await occOn(def.id, '2026-10-20');
    const txId = await expense('2026-10-19', '333.00');
    await deliver(matcher, await txEvent('transactions.TransactionCreated', txId));
    const [sug] = await forTx(txId);
    expect(sug?.status).toBe('PROPOSED');
    await ok(post(owner, `/recurring/occurrences/${occ.id}/materialize`, {}), 201);
    const [after] = await forTx(txId);
    expect(after).toMatchObject({ status: 'EXPIRED', expireReason: 'OCCURRENCE_RESOLVED' });
    problem(
      await post(owner, `/recurring/match-suggestions/${sug!.id}/confirm`),
      409,
      'MATCH_SUGGESTION_NOT_PENDING',
    );
    expect(await occOn(def.id, '2026-10-20')).toMatchObject({ status: 'MATERIALIZED', matchedBy: null });
  });

  it('[TC-COMMITMENTS-MATCH-008] descartar es permanente: reentregar el hecho o editar el gasto no la revive', async () => {
    const def = await created('Internet descartar', {
      amount: { type: 'FIXED', amount: bob('444.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    const txId = await expense('2026-10-19', '444.00');
    const createdEvent = await txEvent('transactions.TransactionCreated', txId);
    await deliver(matcher, createdEvent);
    const [sug] = await forTx(txId);
    const dismissed = await post(owner, `/recurring/match-suggestions/${sug!.id}/dismiss`);
    expect(dismissed.status, JSON.stringify(dismissed.body)).toBe(200);
    expect(contract.validateResponse('dismissMatchSuggestion', 200, dismissed.body)).toEqual([]);
    expect(dismissed.body).toMatchObject({ id: sug!.id, status: 'DISMISSED' });
    problem(
      await post(owner, `/recurring/match-suggestions/${sug!.id}/dismiss`),
      409,
      'MATCH_SUGGESTION_NOT_PENDING',
    );
    expect((await auditOf(owner.ws, `aggregate_id = $1`, [sug!.id])).map((a) => a.action)).toEqual([
      'commitments.match_suggestion.dismissed',
    ]);

    // edición descriptiva del gasto y reentrega de Created con otro eventId
    const current = await get(owner, `/transactions/${txId}`);
    const edited = await patchTx(
      owner,
      txId,
      { description: 'Internet octubre' },
      Number(current.body['version']),
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    await deliver(matcher, { ...createdEvent, eventId: randomUUID() });
    const updatedEvents = (await outboxOf(owner.ws, 'transactions.TransactionUpdated')).filter(
      (e) => (e.payload as { transactionId: string }).transactionId === txId,
    );
    for (const e of updatedEvents) await deliver(matcher, e);

    const all = await forTx(txId);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: sug!.id, status: 'DISMISSED' });
    expect(await occOn(def.id, '2026-10-20')).toMatchObject({ transactionId: null });
    expect((await suggestions()).data.map((s) => s.id)).not.toContain(sug!.id);
  });

  it('[TC-COMMITMENTS-MATCH-010] anular el gasto expira la sugerencia y corregir el monto fuera de tolerancia la expira por incompatibilidad', async () => {
    await created('Internet expira', {
      amount: { type: 'FIXED', amount: bob('555.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    const voidedTx = await expense('2026-10-19', '555.00');
    const editedTx = await expense('2026-10-19', '555.00');
    await deliver(matcher, await txEvent('transactions.TransactionCreated', voidedTx));
    await deliver(matcher, await txEvent('transactions.TransactionCreated', editedTx));
    // ambos gastos son candidatos de la misma ocurrencia ⇒ dos sugerencias
    expect(await forTx(voidedTx)).toHaveLength(1);
    expect(await forTx(editedTx)).toHaveLength(1);

    // a: anular
    const current = await get(owner, `/transactions/${voidedTx}`);
    const voided = await call('POST', `${W(owner)}/transactions/${voidedTx}/void`, {
      token: owner.token,
      body: { reason: 'duplicado' },
      headers: { 'idempotency-key': randomUUID(), 'if-match': `"${String(current.body['version'])}"` },
    });
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    expect(await deliver(matcher, await txEvent('transactions.TransactionVoided', voidedTx))).toBe('applied');
    expect((await forTx(voidedTx))[0]).toMatchObject({
      status: 'EXPIRED',
      expireReason: 'TRANSACTION_VOIDED',
    });

    // b: corregir a 750.00 (incompatible) y luego volver a 555.00 (re-propuesta)
    const cur = await get(owner, `/transactions/${editedTx}`);
    const fix = await patchTx(
      owner,
      editedTx,
      { amount: bob('750.00'), splits: [{ amount: bob('750.00'), categoryId: category }] },
      Number(cur.body['version']),
    );
    expect(fix.status, `${JSON.stringify(fix.body)} ${apiErrors()}`).toBe(200);
    const updates = async () =>
      (await outboxOf(owner.ws, 'transactions.TransactionUpdated')).filter(
        (e) => (e.payload as { transactionId: string }).transactionId === editedTx,
      );
    const first = await updates();
    expect((first.at(-1)!.payload as { changedFields: string[] }).changedFields).toContain('amount');
    await deliver(matcher, first.at(-1)!);
    expect((await forTx(editedTx))[0]).toMatchObject({ status: 'EXPIRED', expireReason: 'INCOMPATIBLE' });

    const cur2 = await get(owner, `/transactions/${editedTx}`);
    const back = await patchTx(
      owner,
      editedTx,
      { amount: bob('555.00'), splits: [{ amount: bob('555.00'), categoryId: category }] },
      Number(cur2.body['version']),
    );
    expect(back.status, JSON.stringify(back.body)).toBe(200);
    await deliver(matcher, (await updates()).at(-1)!);
    expect((await forTx(editedTx))[0]).toMatchObject({
      status: 'PROPOSED',
      expireReason: null,
      score: '85.00',
    });
    expect(await suggestedEvents(editedTx)).toHaveLength(2);
  });

  it('[TC-COMMITMENTS-MATCH-011] definir el compromiso después del pago sugiere la transacción ya registrada', async () => {
    const txId = await expense('2026-10-10', '666.00');
    const def = await created('Seguro auto match', {
      amount: { type: 'FIXED', amount: bob('666.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-10' },
    });
    const occ = await occOn(def.id, '2026-10-10');
    const generated = (await outboxOf(owner.ws, 'commitments.OccurrencesGenerated')).find(
      (e) => e.aggregateId === def.id,
    )!;
    expect(await deliver(backfill, generated)).toBe('applied');
    expect(await deliver(backfill, { ...generated, eventId: randomUUID() })).toBe('applied');
    const found = await forTx(txId);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      status: 'PROPOSED',
      occurrence: { id: occ.id },
      reasons: { dateDeltaDays: 0 },
    });
    expect(await suggestedEvents(txId)).toHaveLength(1);
  });

  it('[TC-COMMITMENTS-MATCH-004] la tolerancia y la ventana configuradas en la definición se aplican (PATCH validado por el contrato)', async () => {
    const def = await created('Internet tolerancia', {
      amount: { type: 'FIXED', amount: bob('888.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    const version = Number((await get(owner, `/recurring/${def.id}`)).body['version']);
    const updated = await patch(
      owner,
      `/recurring/${def.id}`,
      { matching: { amountTolerancePercent: '5', dateWindowDays: 2 } },
      version,
    );
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(contract.validateResponse('updateRecurringDefinition', 200, updated.body)).toEqual([]);
    expect(updated.body['matching']).toEqual({ amountTolerancePercent: '5.00', dateWindowDays: 2 });
    expect((await get(owner, `/recurring/${def.id}`)).body['matching']).toEqual({
      amountTolerancePercent: '5.00',
      dateWindowDays: 2,
    });
    // fuera de rango ⇒ 400 por el contrato
    const bad = await patch(
      owner,
      `/recurring/${def.id}`,
      { matching: { dateWindowDays: 16 } },
      Number(updated.body['version']),
    );
    expect([400, 422]).toContain(bad.status);
    const late = await expense('2026-10-23', '920.00'); // 888 × 1.05 = 932.40, pero 3 días del vencimiento
    const near = await expense('2026-10-21', '920.00');
    await deliver(matcher, await txEvent('transactions.TransactionCreated', late));
    await deliver(matcher, await txEvent('transactions.TransactionCreated', near));
    expect(await forTx(late)).toEqual([]);
    expect(await forTx(near)).toHaveLength(1);
    // `null` restablece el valor por omisión
    const reset = await patch(
      owner,
      `/recurring/${def.id}`,
      { matching: { amountTolerancePercent: null, dateWindowDays: null } },
      Number(updated.body['version']),
    );
    expect(reset.body['matching']).toEqual({ amountTolerancePercent: null, dateWindowDays: null });
  });
});

describe('Roles y aislamiento del matching (TC-COMMITMENTS-MATCH-015)', () => {
  it('[TC-COMMITMENTS-MATCH-015] un VIEWER ve las sugerencias pero no confirma ni descarta; un EDITOR sí; otro workspace no accede', async () => {
    const def = await created('Internet roles', {
      amount: { type: 'FIXED', amount: bob('999.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    const txId = await expense('2026-10-19', '999.00');
    await deliver(matcher, await txEvent('transactions.TransactionCreated', txId));
    const [sug] = await forTx(txId);

    const asViewer = await suggestions(`&transactionId=${txId}`, viewer);
    expect(asViewer.data.map((s) => s.id)).toEqual([sug!.id]);
    for (const action of ['confirm', 'dismiss']) {
      problem(
        await call('POST', `${W(owner)}/recurring/match-suggestions/${sug!.id}/${action}`, {
          token: viewer.token,
          headers: { 'idempotency-key': randomUUID() },
        }),
        403,
        'INSUFFICIENT_ROLE',
      );
    }
    expect((await forTx(txId))[0]).toMatchObject({ status: 'PROPOSED' });
    expect(await occOn(def.id, '2026-10-20')).toMatchObject({ transactionId: null });

    problem(
      await call('GET', `${W(owner)}/recurring/match-suggestions`, { token: outsider.token }),
      403,
      'WORKSPACE_ACCESS_DENIED',
    );
    problem(
      await call('POST', `${W(owner)}/recurring/match-suggestions/${sug!.id}/confirm`, {
        token: outsider.token,
        headers: { 'idempotency-key': randomUUID() },
      }),
      403,
      'WORKSPACE_ACCESS_DENIED',
    );
    // una sugerencia inexistente (o de otro workspace) es 404 aun para el dueño del workspace
    problem(
      await post(owner, `/recurring/match-suggestions/${randomUUID()}/confirm`),
      404,
      'RESOURCE_NOT_FOUND',
    );

    const byEditor = await call('POST', `${W(owner)}/recurring/match-suggestions/${sug!.id}/dismiss`, {
      token: editor.token,
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(byEditor.status, JSON.stringify(byEditor.body)).toBe(200);
    expect(byEditor.body).toMatchObject({ status: 'DISMISSED' });
  });
});
