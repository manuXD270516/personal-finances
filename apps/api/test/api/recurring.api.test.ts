import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
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
  financeRuntimes,
  financialPeriodPort,
  LIFECYCLE_MACHINES,
  outboxPort,
} from '../../src/identity/identity-wiring.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Motor de recurrencia por HTTP y por el worker contra PostgreSQL real (openspec add-recurrence-engine, tareas 4.2,
// 4.3, 5.2 y 6): CRUD, aprobar/vincular/omitir/liberar, revisión, comprometido, recorrido, roles, respuestas validadas
// contra el OpenAPI, y el job/consumidor del worker (pf_worker) con auditoría, recorrido y outbox en la misma
// transacción, el proceso de generación como actor y el origen `recurring`.
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

/** Corre el job solo para el workspace de la prueba (la base se comparte con otros archivos de integración). */
const runJob = () =>
  runGenerateOccurrences(
    commitments.generate,
    { list: async () => [{ workspaceId: owner.ws }] },
    workerLog.logger,
    'manual',
  );

const deliver = (consumer: string, envelope: EventEnvelope) =>
  consumers.deliver(definitions.get(consumer)!, envelope);

const bob = (amount: string) => ({ amount, currency: 'BOB' });
const usd = (amount: string) => ({ amount, currency: 'USD' });

let owner: User;
let editor: User;
let viewer: User;
let outsider: User;
let bank: string;
let cash: string;
let usdBank: string;
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
  owner = await user(`kc-rec-owner-${randomUUID()}`);
  editor = await user(`kc-rec-editor-${randomUUID()}`);
  viewer = await user(`kc-rec-viewer-${randomUUID()}`);
  outsider = await user(`kc-rec-out-${randomUUID()}`);
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
  usdBank = await account(owner, 'Banco USD', 'USD', '2000.00');
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

describe('Definiciones: crear, validar y consultar (FR-COMMITMENTS-001)', () => {
  it('[TC-COMMITMENTS-RECUR-001] crea el Alquiler mensual: versión 1, 4 ocurrencias, auditoría, recorrido y hechos', async () => {
    const def = await created('Alquiler');
    expect(def).toMatchObject({ status: 'ACTIVE', version: expect.any(Number), generatedCount: 4 });
    const occs = await occurrencesOf(def.id);
    expect(occs.map((o) => o.occurrenceDate)).toEqual([
      '2026-10-05',
      '2026-11-05',
      '2026-12-05',
      '2027-01-05',
    ]);
    expect(occs.every((o) => o.status === 'SCHEDULED')).toBe(true);

    const detail = await get(owner, `/recurring/${def.id}`);
    expect(detail.status).toBe(200);
    expect(contract.validateResponse('getRecurringDefinition', 200, detail.body)).toEqual([]);
    expect(detail.headers.get('etag')).toBeTruthy();
    expect((detail.body['versions'] as unknown[]).length).toBe(1);

    const audits = await auditOf(owner.ws, `aggregate_id = $1`, [def.id]);
    expect(audits.map((a) => a.action)).toContain('commitments.recurring_definition.created');
    const lifecycle = await get(owner, `/recurring/${def.id}/lifecycle`);
    expect(lifecycle.status).toBe(200);
    expect(contract.validateResponse('getRecurringDefinitionLifecycle', 200, lifecycle.body)).toEqual([]);
    const items = lifecycle.body['items'] as { kind: string; transition?: string }[];
    expect(items.map((i) => i.transition)).toEqual(['CREATE']);
    expect(lifecycle.body['currentState']).toBe('ACTIVE');

    const changed = (await outboxOf(owner.ws, 'commitments.RecurringDefinitionChanged')).filter(
      (e) => e.aggregateId === def.id,
    );
    expect(changed).toHaveLength(1);
    expect(
      (await outboxOf(owner.ws, 'commitments.OccurrencesGenerated')).some((e) => e.aggregateId === def.id),
    ).toBe(true);

    const list = await get(owner, '/recurring?kind=EXPENSE&q=alqui');
    expect(list.status).toBe(200);
    expect(contract.validateResponse('listRecurringDefinitions', 200, list.body)).toEqual([]);
    const item = (list.body['data'] as { id: string; pendingApprovalCount: number }[]).find(
      (d) => d.id === def.id,
    );
    expect(item?.pendingApprovalCount).toBe(0);
  });

  it('[TC-COMMITMENTS-RECUR-002] moneda distinta o categoría archivada se rechazan sin crear nada', async () => {
    const before = ((await get(owner, '/recurring?limit=200')).body['data'] as unknown[]).length;
    problem(
      await createDefinition('Netflix', { amount: { type: 'FIXED', amount: usd('25.00') } }),
      422,
      'CURRENCY_MISMATCH',
    );
    problem(
      await createDefinition('Cable TV', {
        amount: { type: 'FIXED', amount: bob('120.00') },
        categoryId: archivedCategory,
      }),
      409,
      'CATEGORY_ARCHIVED',
    );
    const after = ((await get(owner, '/recurring?limit=200')).body['data'] as unknown[]).length;
    expect(after).toBe(before);
  });

  it('[TC-COMMITMENTS-RECUR-003] LOAN_PAYMENT y CARD_PAYMENT ⇒ 422 RECURRING_KIND_NOT_AVAILABLE', async () => {
    problem(await createDefinition('Préstamo', {}, 'LOAN_PAYMENT'), 422, 'RECURRING_KIND_NOT_AVAILABLE');
    problem(await createDefinition('Tarjeta', {}, 'CARD_PAYMENT'), 422, 'RECURRING_KIND_NOT_AVAILABLE');
  });

  it('[TC-COMMITMENTS-RECUR-008] una RRULE fuera del subconjunto ⇒ 422 INVALID_RRULE; [TC-COMMITMENTS-RECUR-020] AUTO_CREATE con VARIABLE ⇒ RECURRING_MODE_NOT_ALLOWED', async () => {
    problem(
      await createDefinition('Raro', {
        schedule: { cadence: 'CUSTOM', rrule: 'FREQ=HOURLY;INTERVAL=2', startDate: '2026-10-05' },
      }),
      422,
      'INVALID_RRULE',
    );
    problem(
      await createDefinition('Mayorista', {
        amount: { type: 'VARIABLE' },
        materialization: { mode: 'AUTO_CREATE' },
      }),
      422,
      'RECURRING_MODE_NOT_ALLOWED',
    );
    problem(
      await createDefinition('Rango', {
        amount: { type: 'MIN_MAX', min: bob('200.00'), max: bob('150.00') },
      }),
      422,
      'RECURRING_INVALID_AMOUNT',
    );
  });

  it('[TC-COMMITMENTS-RECUR-004] una transferencia recurrente de otra moneda ⇒ TRANSFER_CURRENCY_MISMATCH', async () => {
    problem(
      await createDefinition(
        'Cambio',
        {
          accountId: usdBank,
          toAccountId: bank,
          categoryId: null,
          amount: { type: 'FIXED', amount: usd('100.00') },
        },
        'TRANSFER',
      ),
      422,
      'TRANSFER_CURRENCY_MISMATCH',
    );
  });

  it('[TC-COMMITMENTS-RECUR-007] una RRULE válida (último viernes) se acepta y fija las fechas', async () => {
    const def = await created('Último viernes', {
      schedule: { cadence: 'CUSTOM', rrule: 'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1', startDate: '2026-10-01' },
    });
    const occs = await occurrencesOf(def.id);
    expect(occs.map((o) => o.occurrenceDate)).toEqual(['2026-10-30', '2026-11-27', '2026-12-25']);
  });

  it('[TC-COMMITMENTS-RECUR-039] un VIEWER consulta pero no aprueba; otro workspace no accede', async () => {
    const def = await created('Alquiler VIEWER');
    const occ = await occOn(def.id, '2026-11-05');
    problem(
      await call('POST', `${W(owner)}/recurring/occurrences/${occ.id}/materialize`, {
        token: viewer.token,
        body: {},
        headers: { 'idempotency-key': randomUUID() },
      }),
      403,
      'INSUFFICIENT_ROLE',
    );
    const committed = await call('GET', `${W(owner)}/recurring/committed`, { token: viewer.token });
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    expect(contract.validateResponse('getCommittedAmount', 200, committed.body)).toEqual([]);
    expect((await call('GET', `${W(owner)}/recurring/${def.id}`, { token: viewer.token })).status).toBe(200);
    problem(
      await call('GET', `/api/v1/workspaces/${owner.ws}/recurring`, { token: outsider.token }),
      403,
      'WORKSPACE_ACCESS_DENIED',
    );
    const byEditor = await call('POST', `${W(owner)}/recurring`, {
      token: editor.token,
      body: { name: 'Editor crea', kind: 'EXPENSE', template: template() },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(byEditor.status, JSON.stringify(byEditor.body)).toBe(201);
    const none = await call('POST', `${W(owner)}/recurring`, {
      token: viewer.token,
      body: { name: 'x', kind: 'EXPENSE', template: template() },
      headers: { 'idempotency-key': randomUUID() },
    });
    problem(none, 403, 'INSUFFICIENT_ROLE');
  });
});

describe('Aprobar, vincular, omitir y liberar (FR-COMMITMENTS-008)', () => {
  it('[TC-COMMITMENTS-RECUR-023] aprobar con monto real crea el gasto POSTED; la misma clave repite la respuesta; [TC-COMMITMENTS-RECUR-025] otra clave ⇒ 409', async () => {
    const def = await created('Luz', {
      amount: { type: 'ESTIMATED', amount: bob('150.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-25' },
    });
    const occ = await occOn(def.id, '2026-10-25');
    const key = randomUUID();
    const first = await post(
      owner,
      `/recurring/occurrences/${occ.id}/materialize`,
      { amount: bob('163.40') },
      { 'idempotency-key': key },
    );
    expect(first.status, `${JSON.stringify(first.body)} ${apiErrors()}`).toBe(201);
    expect(
      contract.validateResponse('materializeRecurringOccurrence', 201, first.body),
      JSON.stringify(first.body),
    ).toEqual([]);
    const txnId = first.body['transactionId'] as string;
    expect((first.body['occurrence'] as { status: string }).status).toBe('MATERIALIZED');
    // Fecha por omisión = min(vencimiento, hoy) = hoy (2026-10-09).
    const txn = await get(owner, `/transactions/${txnId}`);
    expect(txn.body).toMatchObject({
      status: 'POSTED',
      transactionDate: '2026-10-09',
      amount: bob('163.40'),
      externalRef: { namespace: 'commitments.occurrence', id: occ.id },
    });
    const replay = await post(
      owner,
      `/recurring/occurrences/${occ.id}/materialize`,
      { amount: bob('163.40') },
      { 'idempotency-key': key },
    );
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body['transactionId']).toBe(txnId);

    problem(
      await post(owner, `/recurring/occurrences/${occ.id}/materialize`, { amount: bob('163.40') }),
      409,
      'OCCURRENCE_ALREADY_MATERIALIZED',
    );
    const created1 = (await outboxOf(owner.ws, 'transactions.TransactionCreated')).filter(
      (e) => (e.payload as { origin: { refId: string | null } }).origin.refId === occ.id,
    );
    expect(created1).toHaveLength(1);
    expect((created1[0]!.payload as { origin: { type: string } }).origin.type).toBe('RECURRING');
    const audits = await auditOf(owner.ws, `aggregate_id = $1 OR aggregate_id = $2`, [occ.id, txnId]);
    expect(audits.find((a) => a.aggregate_type === 'Transaction')?.origin).toBe('recurring');
    expect(audits.map((a) => a.action)).toContain('commitments.recurring_occurrence.materialized');
    const lifecycle = await get(owner, `/recurring/occurrences/${occ.id}/lifecycle`);
    expect(contract.validateResponse('getRecurringOccurrenceLifecycle', 200, lifecycle.body)).toEqual([]);
    expect((lifecycle.body['items'] as { transition?: string }[]).map((i) => i.transition)).toEqual([
      'GENERATE',
      'MATERIALIZE',
    ]);
  });

  it('[TC-COMMITMENTS-RECUR-024] variable sin monto y MIN_MAX fuera de rango se rechazan', async () => {
    const wholesale = await created('Compra mayorista', {
      amount: { type: 'VARIABLE' },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-30' },
    });
    const gym = await created('Gimnasio', {
      amount: { type: 'MIN_MAX', min: bob('100.00'), max: bob('180.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-28' },
    });
    problem(
      await post(
        owner,
        `/recurring/occurrences/${(await occOn(wholesale.id, '2026-10-30')).id}/materialize`,
        {},
      ),
      422,
      'OCCURRENCE_AMOUNT_REQUIRED',
    );
    problem(
      await post(owner, `/recurring/occurrences/${(await occOn(gym.id, '2026-10-28')).id}/materialize`, {
        amount: bob('200.00'),
      }),
      422,
      'RECURRING_INVALID_AMOUNT',
    );
    const ok1 = await post(
      owner,
      `/recurring/occurrences/${(await occOn(gym.id, '2026-10-28')).id}/materialize`,
      {
        status: 'PENDING',
      },
    );
    expect(ok1.status, JSON.stringify(ok1.body)).toBe(201);
    const txn = await get(owner, `/transactions/${ok1.body['transactionId'] as string}`);
    expect(txn.body).toMatchObject({ status: 'PENDING', amount: bob('180.00') });
  });

  it('[TC-COMMITMENTS-RECUR-029][TC-COMMITMENTS-RECUR-030][TC-COMMITMENTS-RECUR-049] vincular: compatible, otra cuenta y ya vinculada', async () => {
    const def = await created('Internet', {
      amount: { type: 'FIXED', amount: bob('199.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    const oct = await occOn(def.id, '2026-10-20');
    const nov = await occOn(def.id, '2026-11-20');
    const expense = async (accountId: string) =>
      (
        await ok(
          post(owner, '/transactions', {
            kind: 'EXPENSE',
            transactionDate: '2026-10-19',
            accountId,
            amount: bob('199.00'),
            splits: [{ amount: bob('199.00'), categoryId: category }],
          }),
        )
      )['id'] as string;
    const inBank = await expense(bank);
    const inCash = await expense(cash);

    const mismatch = await post(owner, `/recurring/occurrences/${oct.id}/link`, { transactionId: inCash });
    problem(mismatch, 422, 'OCCURRENCE_LINK_MISMATCH');
    expect((mismatch.body['details'] as { reasons: string[] }).reasons).toEqual(['ACCOUNT']);

    const linked = await post(owner, `/recurring/occurrences/${oct.id}/link`, { transactionId: inBank });
    expect(linked.status, JSON.stringify(linked.body)).toBe(200);
    expect(contract.validateResponse('linkRecurringOccurrence', 200, linked.body)).toEqual([]);
    expect(linked.body).toMatchObject({ status: 'MATCHED', matchedBy: 'USER_LINK', transactionId: inBank });
    const materialized = (await outboxOf(owner.ws, 'commitments.RecurringOccurrenceMaterialized')).find(
      (e) => e.aggregateId === oct.id,
    );
    expect(materialized?.payload).toMatchObject({
      mode: 'MATCHED',
      matchedBy: 'USER_LINK',
      transactionId: inBank,
    });

    problem(
      await post(owner, `/recurring/occurrences/${nov.id}/link`, { transactionId: inBank }),
      409,
      'TRANSACTION_ALREADY_LINKED',
    );

    // [TC-COMMITMENTS-RECUR-031] anular el gasto vinculado libera la ocurrencia una sola vez.
    const current = await get(owner, `/transactions/${inBank}`);
    const voided = await call('POST', `${W(owner)}/transactions/${inBank}/void`, {
      token: owner.token,
      body: { reason: 'duplicado' },
      headers: { 'idempotency-key': randomUUID(), 'if-match': `"${String(current.body['version'])}"` },
    });
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    const event = (await outboxOf(owner.ws, 'transactions.TransactionVoided')).find(
      (e) => (e.payload as { transactionId: string }).transactionId === inBank,
    )!;
    expect(await deliver('commitments.transaction-voided', event)).toBe('applied');
    expect(await deliver('commitments.transaction-voided', { ...event, eventId: randomUUID() })).toBe(
      'applied',
    );
    const released = await occOn(def.id, '2026-10-20');
    expect(released).toMatchObject({ status: 'DUE', transactionId: null });
    const changed = (await outboxOf(owner.ws, 'commitments.RecurringOccurrenceChanged')).filter(
      (e) => e.aggregateId === oct.id && (e.payload as { transition: string }).transition === 'RELEASE',
    );
    expect(changed).toHaveLength(1);
  });

  it('[TC-COMMITMENTS-RECUR-027] editar monto y fecha; omitir; y omitir una resuelta ⇒ INVALID_STATUS_TRANSITION', async () => {
    const def = await created('Seguro');
    const nov = await occOn(def.id, '2026-11-05');
    const edited = await patch(
      owner,
      `/recurring/occurrences/${nov.id}`,
      { expectedAmount: bob('3650.00'), dueDate: '2026-11-07' },
      nov.version,
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(contract.validateResponse('updateRecurringOccurrence', 200, edited.body)).toEqual([]);
    expect(edited.body).toMatchObject({
      occurrenceDate: '2026-11-05',
      dueDate: '2026-11-07',
      overridden: true,
    });
    problem(
      await patch(owner, `/recurring/occurrences/${nov.id}`, { dueDate: '2026-11-08' }, nov.version),
      412,
      'PRECONDITION_FAILED',
    );

    const dec = await occOn(def.id, '2026-12-05');
    const skipped = await post(owner, `/recurring/occurrences/${dec.id}/skip`, { reason: 'vacaciones' });
    expect(skipped.status, JSON.stringify(skipped.body)).toBe(200);
    expect(skipped.body).toMatchObject({ status: 'SKIPPED', skipReason: 'vacaciones' });
    problem(await post(owner, `/recurring/occurrences/${dec.id}/skip`, {}), 409, 'INVALID_STATUS_TRANSITION');
  });
});

describe('Pausar, reanudar, revisar y terminar (FR-COMMITMENTS-009)', () => {
  it('[TC-COMMITMENTS-RECUR-032][TC-COMMITMENTS-RECUR-041] pausa, reanuda, recorrido con las 3 transiciones y reanudar una terminada ⇒ 409', async () => {
    const def = await created('Gimnasio plan', { schedule: { cadence: 'MONTHLY', startDate: '2026-10-28' } });
    let version = Number((await get(owner, `/recurring/${def.id}`)).body['version']);
    const paused = await post(owner, `/recurring/${def.id}/pause`, undefined, { 'if-match': `"${version}"` });
    expect(paused.status, JSON.stringify(paused.body)).toBe(200);
    expect(contract.validateResponse('pauseRecurringDefinition', 200, paused.body)).toEqual([]);
    expect((await occurrencesOf(def.id)).every((o) => o.status === 'CANCELLED')).toBe(true);
    version = Number(paused.body['version']);
    const resumed = await post(owner, `/recurring/${def.id}/resume`, undefined, {
      'if-match': `"${version}"`,
    });
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
    expect(resumed.body['status']).toBe('ACTIVE');
    version = Number(resumed.body['version']);
    const ended = await post(owner, `/recurring/${def.id}/end`, {}, { 'if-match': `"${version}"` });
    expect(ended.status, JSON.stringify(ended.body)).toBe(200);
    expect(ended.body['status']).toBe('ENDED');
    problem(
      await post(owner, `/recurring/${def.id}/resume`, undefined, {
        'if-match': `"${String(ended.body['version'])}"`,
      }),
      409,
      'INVALID_STATUS_TRANSITION',
    );
    const lifecycle = await get(owner, `/recurring/${def.id}/lifecycle`);
    expect((lifecycle.body['items'] as { transition?: string }[]).map((i) => i.transition)).toEqual([
      'CREATE',
      'PAUSE',
      'RESUME',
      'END',
    ]);
  });

  it('[TC-COMMITMENTS-RECUR-034][TC-COMMITMENTS-RECUR-035] la revisión crea la versión 2 sin tocar lo resuelto y rechaza fechas anteriores', async () => {
    const def = await created('Alquiler revisado');
    for (const date of ['2026-10-05', '2026-11-05', '2026-12-05']) {
      const occ = await occOn(def.id, date);
      await ok(post(owner, `/recurring/occurrences/${occ.id}/materialize`, {}));
    }
    const version = Number((await get(owner, `/recurring/${def.id}`)).body['version']);
    const early = await post(
      owner,
      `/recurring/${def.id}/revisions`,
      { effectiveFrom: '2026-10-05', changes: { amount: { type: 'FIXED', amount: bob('3800.00') } } },
      { 'if-match': `"${version}"` },
    );
    problem(early, 422, 'RECURRING_REVISION_DATE_INVALID');
    const revised = await post(
      owner,
      `/recurring/${def.id}/revisions`,
      { effectiveFrom: '2027-01-05', changes: { amount: { type: 'FIXED', amount: bob('3800.00') } } },
      { 'if-match': `"${version}"` },
    );
    expect(revised.status, `${JSON.stringify(revised.body)} ${apiErrors()}`).toBe(200);
    expect(
      contract.validateResponse('reviseRecurringDefinition', 200, revised.body),
      JSON.stringify(revised.body),
    ).toEqual([]);
    expect(revised.body).toMatchObject({ rewritten: 1, cancelled: 0, resetOverrides: 0 });
    const occs = await occurrencesOf(def.id);
    expect(occs.map((o) => [o.occurrenceDate, o.status])).toEqual([
      ['2026-10-05', 'MATERIALIZED'],
      ['2026-11-05', 'MATERIALIZED'],
      ['2026-12-05', 'MATERIALIZED'],
      ['2027-01-05', 'SCHEDULED'],
    ]);
    const january = await get(owner, `/recurring/occurrences/${occs[3]!.id}`);
    expect(january.body).toMatchObject({
      definitionVersionNo: 2,
      expected: { type: 'FIXED', amount: bob('3800.00') },
    });
    const lifecycle = await get(owner, `/recurring/${def.id}/lifecycle`);
    expect(
      (lifecycle.body['items'] as { transition?: string; revisionTo?: number }[]).map((i) => i.transition),
    ).toEqual(['CREATE', 'REVISE']);
    const changed = (await outboxOf(owner.ws, 'commitments.RecurringDefinitionChanged')).filter(
      (e) => e.aggregateId === def.id && (e.payload as { transition: string }).transition === 'REVISE',
    );
    expect(changed).toHaveLength(1);
  });
});

describe('Comprometido y próximos pagos (FR-COMMITMENTS-011)', () => {
  it('[TC-COMMITMENTS-RECUR-036][TC-COMMITMENTS-RECUR-038] el comprometido del periodo explica sus partes y la bandeja/próximos filtran', async () => {
    const committed = await get(owner, '/recurring/committed');
    expect(committed.status, JSON.stringify(committed.body)).toBe(200);
    expect(
      contract.validateResponse('getCommittedAmount', 200, committed.body),
      JSON.stringify(committed.body),
    ).toEqual([]);
    expect(committed.body).toMatchObject({
      periodLabel: '2026-10',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
    });
    const byCurrency = committed.body['byCurrency'] as { currency: string; total: { amount: string } }[];
    expect(byCurrency.find((c) => c.currency === 'BOB')).toBeDefined();
    expect((committed.body['consolidated'] as { complete: boolean }).complete).toBe(true);
    const items = committed.body['items'] as { source: string; name: string | null }[];
    expect(items.some((i) => i.name === 'Internet')).toBe(true);

    const upcoming = await get(owner, '/recurring/occurrences?days=7');
    expect(upcoming.status).toBe(200);
    expect(contract.validateResponse('listRecurringOccurrences', 200, upcoming.body)).toEqual([]);
    const tray = await get(owner, '/recurring/occurrences?requiresApproval=true');
    expect(tray.status).toBe(200);
    expect(
      (tray.body['data'] as { requiresApproval: boolean }[]).every((o) => o.requiresApproval === true),
    ).toBe(true);
  });
});

describe('Worker: job de generación, creación automática y consumidor (pf_worker)', () => {
  it('[TC-COMMITMENTS-RECUR-019][TC-COMMITMENTS-RECUR-050][TC-COMMITMENTS-RECUR-051] la creación automática crea UNA transacción pendiente, auditada con el proceso del job', async () => {
    const def = await created('Internet auto', {
      amount: { type: 'FIXED', amount: bob('199.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-09' },
      materialization: { mode: 'AUTO_CREATE', autoCreateStatus: 'PENDING', leadDays: 3 },
    });
    const occ = await occOn(def.id, '2026-10-09');
    await Promise.all([runJob(), runJob()]);
    await runJob();
    const after = await occOn(def.id, '2026-10-09');
    expect(after.status).toBe('MATERIALIZED');
    expect(after.transactionId).toBeTruthy();
    const txn = await get(owner, `/transactions/${after.transactionId}`);
    expect(txn.body).toMatchObject({
      status: 'PENDING',
      transactionDate: '2026-10-09',
      amount: bob('199.00'),
      externalRef: { namespace: 'commitments.occurrence', id: occ.id },
    });
    const { rows } = await worker.query(
      `SELECT count(*)::int AS n FROM platform.outbox
        WHERE workspace_id = $1 AND event_type = 'commitments.RecurringOccurrenceMaterialized' AND aggregate_id = $2`,
      [owner.ws, occ.id],
    );
    expect(rows[0].n).toBe(1);
    const created1 = (await outboxOf(owner.ws, 'transactions.TransactionCreated')).filter(
      (e) => (e.payload as { origin: { refId: string | null } }).origin.refId === occ.id,
    );
    expect(created1).toHaveLength(1);
    const audits = await auditOf(owner.ws, `aggregate_id = $1 OR aggregate_id = $2`, [
      occ.id,
      after.transactionId,
    ]);
    const forOccurrence = audits.filter(
      (a) => a.aggregate_id === occ.id && a.action.endsWith('.materialized'),
    );
    expect(forOccurrence).toHaveLength(1);
    expect(forOccurrence[0]).toMatchObject({
      actor_type: 'WORKER',
      actor_process: 'commitments.generate-occurrences',
      origin: 'recurring',
    });
    expect(audits.find((a) => a.aggregate_type === 'Transaction')).toMatchObject({
      actor_type: 'WORKER',
      origin: 'recurring',
    });
  });

  it('[TC-COMMITMENTS-RECUR-018][TC-COMMITMENTS-RECUR-021] el job pasa a próxima una vez y publica el hecho con requiresApproval', async () => {
    const def = await created('Alquiler job', { schedule: { cadence: 'MONTHLY', startDate: '2026-10-12' } });
    await runJob();
    await runJob();
    const occ = await occOn(def.id, '2026-10-12');
    expect(occ).toMatchObject({ status: 'DUE', requiresApproval: true });
    const due = (await outboxOf(owner.ws, 'commitments.RecurringOccurrenceDue')).filter(
      (e) => e.aggregateId === occ.id,
    );
    expect(due).toHaveLength(1);
    expect(due[0]!.payload).toMatchObject({
      requiresApproval: true,
      mode: 'PENDING_APPROVAL',
      managedBy: 'USER',
    });
    const tray = await get(owner, '/recurring/occurrences?requiresApproval=true');
    expect((tray.body['data'] as { id: string }[]).some((o) => o.id === occ.id)).toBe(true);
  });

  it('[TC-COMMITMENTS-RECUR-026] [D129] la creación automática en un periodo cerrado deja la ocurrencia con el error visible', async () => {
    const def = await created('Internet cerrado', {
      amount: { type: 'FIXED', amount: bob('99.00') },
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-09' },
      materialization: { mode: 'AUTO_CREATE', leadDays: 1 },
    });
    // Cierra octubre en el ledger (lo escribe PLANNING en producción): rechaza movimientos y pendientes del mes.
    const admin = await connect(deps.superuserUrl);
    try {
      await admin.query(
        `INSERT INTO ledger.period_lock (workspace_id, year_month, period_start, period_end)
         VALUES ($1, '2026-10', '2026-10-01', '2026-10-31')`,
        [owner.ws],
      );
    } finally {
      await admin.end();
    }
    try {
      await runJob();
      const occ = await occOn(def.id, '2026-10-09');
      expect(occ.status).not.toBe('MATERIALIZED');
      expect(occ.lastAutoCreateError).toBe('PERIOD_CLOSED');
      expect(occ.transactionId).toBeNull();
    } finally {
      const reopen = await connect(deps.superuserUrl);
      try {
        await reopen.query(`DELETE FROM ledger.period_lock WHERE workspace_id = $1`, [owner.ws]);
      } finally {
        await reopen.end();
      }
    }
  });
});

describe('Base de datos: unicidad nominal y concurrencia (INV-013)', () => {
  it('[TC-COMMITMENTS-RECUR-015] dos generaciones concurrentes dejan una ocurrencia y un hecho por fecha', async () => {
    const def = await created('Internet concurrente', {
      schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' },
    });
    const admin = await connect(deps.superuserUrl);
    try {
      // La definición queda como recién creada sin ventana generada (los hechos previos se conservan como línea base).
      await admin.query(`DELETE FROM commitments.recurring_occurrence WHERE definition_id = $1`, [def.id]);
      await admin.query(
        `UPDATE commitments.recurring_definition SET generated_through = NULL WHERE id = $1`,
        [def.id],
      );
    } finally {
      await admin.end();
    }
    const baseline = (await outboxOf(owner.ws, 'commitments.OccurrencesGenerated')).filter(
      (e) => e.aggregateId === def.id,
    ).length;
    await Promise.all([runJob(), runJob()]);
    const occs = await occurrencesOf(def.id);
    expect(occs.map((o) => o.occurrenceDate)).toEqual(['2026-10-20', '2026-11-20', '2026-12-20']);
    const generated = (await outboxOf(owner.ws, 'commitments.OccurrencesGenerated')).filter(
      (e) => e.aggregateId === def.id,
    );
    expect(generated.length - baseline).toBe(1);
    const included = generated.at(-1)!.payload as { occurrences: { occurrenceDate: string }[] };
    expect(included.occurrences.map((o) => o.occurrenceDate)).toEqual([
      '2026-10-20',
      '2026-11-20',
      '2026-12-20',
    ]);
    expect(workerLog.lines.join(' ')).not.toMatch(/recurring_occurrence_nominal_uk/);
  });

  it('la base rechaza una segunda ocurrencia para la misma fecha nominal y una segunda transacción para la misma ocurrencia', async () => {
    const def = await created('Unicidad', { schedule: { cadence: 'MONTHLY', startDate: '2026-10-20' } });
    const occ = await occOn(def.id, '2026-10-20');
    const admin = await connect(deps.superuserUrl);
    try {
      await expect(
        admin.query(
          `INSERT INTO commitments.recurring_occurrence
             (id, workspace_id, definition_id, occurrence_date, due_date, definition_version_no, expected_type,
              expected_amount, currency, status)
           VALUES ($1, $2, $3, '2026-10-20', '2026-10-20', 1, 'FIXED', 10, 'BOB', 'SCHEDULED')`,
          [randomUUID(), owner.ws, def.id],
        ),
      ).rejects.toMatchObject({ code: '23505', constraint: 'recurring_occurrence_nominal_uk' });
    } finally {
      await admin.end();
    }
    const body = {
      kind: 'EXPENSE',
      transactionDate: '2026-10-09',
      accountId: bank,
      amount: bob('10.00'),
      splits: [{ amount: bob('10.00'), categoryId: category }],
      externalRef: { namespace: 'commitments.occurrence', id: occ.id },
    };
    const first = await post(owner, '/transactions', body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await post(owner, '/transactions', body);
    expect(second.status, JSON.stringify(second.body)).toBeGreaterThanOrEqual(409);
  });
});
