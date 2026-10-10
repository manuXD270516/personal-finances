import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import {
  commitmentsEventConsumers,
  createCommitmentsRuntime,
  runGenerateOccurrences,
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
import { ApiContract, runWithRequestContext } from '@pf/platform/api';
import {
  EventConsumerRuntime,
  EventSubscriptions,
  PgOutboxWriter,
  type EventConsumerDefinition,
  type EventEnvelope,
} from '@pf/platform/events';
import type { JobQueue } from '@pf/platform/queue';
import { FixedClock, Instant, dec } from '@pf/shared-kernel';
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

// Suscripciones por HTTP y por el worker contra PostgreSQL real (openspec add-subscriptions, tareas 3.x, 5.1 y 7.2):
// alta con su definición recurrente, precio indexado, cargos y detección de cambios de precio con el consumidor del
// worker (pf_worker), propuestas, historial de precios, cancelación programada, costo, recordatorios y recorrido,
// roles, aislamiento y respuestas validadas contra el OpenAPI.
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
let visaUsd: string;
let visaBob: string;
let category: string;
let streamly: string;
let musicbox: string;
let clouddrive: string;
let oldtv: string;

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
  expected: { type: string; amount?: { amount: string; currency: string } };
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
  owner = await user(`kc-subs-owner-${randomUUID()}`);
  editor = await user(`kc-subs-editor-${randomUUID()}`);
  viewer = await user(`kc-subs-viewer-${randomUUID()}`);
  outsider = await user(`kc-subs-out-${randomUUID()}`);
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

  await account(owner, 'Banco BOB', 'BOB', '50000.00');
  await account(owner, 'Efectivo', 'BOB', '1000.00');
  visaUsd = await account(owner, 'Visa USD', 'USD', '2000.00');
  visaBob = await account(owner, 'Visa BOB', 'BOB', '5000.00');
  const group = (
    await ok(post(owner, '/category-groups', { name: 'Suscripciones (subs)', kind: 'EXPENSE' }))
  )['id'] as string;
  category = (await ok(post(owner, '/categories', { groupId: group, name: 'Streaming (subs)' })))[
    'id'
  ] as string;
  streamly = await counterparty(owner, 'Streamly');
  musicbox = await counterparty(owner, 'MusicBox');
  clouddrive = await counterparty(owner, 'CloudDrive');
  oldtv = await counterparty(owner, 'OldTV');
  await ok(
    call('POST', `${W(owner)}/counterparties/${oldtv}/archive`, {
      token: owner.token,
      headers: { 'if-match': '"1"' },
    }),
    200,
  );
  // Tasa paralela USD/BOB 9.80 (la misma valoración del Home y los presupuestos).
  await ok(
    post(owner, '/fx-rates', {
      base: 'USD',
      quote: 'BOB',
      value: '9.80',
      rateType: 'PARALLEL',
      asOf: '2026-10-08T10:00:00Z',
      sourceLabel: 'Casa de cambio',
    }),
  );
  await ensurePeriods(owner.ws);
}, 240_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
});

interface Sub {
  id: string;
  definitionId: string;
  version: number;
  status: string;
  name: string;
  planName: string | null;
  providerName: string | null;
  currentPrice: { amount: string; currency: string };
  nextRenewalOn: string | null;
  scheduledCancellationOn: string | null;
  cancelledOn: string | null;
  paymentAccountId: string;
  priceTolerancePercent: string;
  priceHistory?: {
    id: string;
    effectiveFrom: string;
    price: { amount: string; currency: string };
    origin: string;
    supersededBy: string | null;
  }[];
  pendingProposal?: {
    id: string;
    status: string;
    proposedPrice: { amount: string; currency: string };
    effectiveFrom: string;
    changePercent: string;
  } | null;
  definition?: { id: string; status: string; indexed: boolean };
}

async function counterparty(u: User, name: string): Promise<string> {
  return (await ok(post(u, '/counterparties', { name })))['id'] as string;
}

const input = (over: Record<string, unknown> = {}) => ({
  counterpartyId: streamly,
  name: 'Streamly',
  planName: 'Premium',
  price: usd('10.99'),
  billingCycle: { cadence: 'MONTHLY' },
  firstRenewalOn: '2026-11-15',
  paymentAccountId: visaUsd,
  materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
  categoryId: category,
  ...over,
});

async function subscribe(over: Record<string, unknown> = {}, u: User = owner): Promise<Sub> {
  const reply = await post(u, '/subscriptions', input(over));
  expect(reply.status, `${JSON.stringify(reply.body)} ${apiErrors()}`).toBe(201);
  expect(
    contract.validateResponse('createSubscription', 201, reply.body),
    JSON.stringify(reply.body),
  ).toEqual([]);
  return reply.body as unknown as Sub;
}

async function detail(id: string, u: User = owner): Promise<Sub> {
  // Siempre el workspace del `owner`: los demás usuarios son miembros (EDITOR, VIEWER) de él.
  const reply = await call('GET', `${W(owner)}/subscriptions/${id}`, { token: u.token });
  expect(reply.status, JSON.stringify(reply.body)).toBe(200);
  expect(contract.validateResponse('getSubscription', 200, reply.body), JSON.stringify(reply.body)).toEqual(
    [],
  );
  return reply.body as unknown as Sub;
}

/** Comando de suscripción con `If-Match` de la versión vigente. */
async function command(
  sub: Sub,
  path: string,
  body?: unknown,
  method = 'POST',
  u: User = owner,
): Promise<Reply> {
  const current = await detail(sub.id, u);
  return call(method, `${W(owner)}/subscriptions/${sub.id}${path}`, {
    token: u.token,
    ...(body !== undefined ? { body } : {}),
    headers: { 'idempotency-key': randomUUID(), 'if-match': `"${current.version}"` },
  });
}

/** Diff de auditoría de la última entrada con esa acción para el agregado. */
async function auditChanges(ws: string, aggregateId: string, action: string) {
  const client = await worker.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.workspace_id', $1, true)`,
      [ws],
    );
    const res = await client.query<{
      actor_user_id: string | null;
      changes: { field: string; before: unknown; after: unknown }[];
    }>(
      `SELECT actor_user_id::text, changes FROM audit.audit_log WHERE aggregate_id = $1 AND action = $2
        ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [aggregateId, action],
    );
    await client.query('COMMIT');
    const row = res.rows[0];
    return row ? { actorUserId: row.actor_user_id, changes: row.changes } : undefined;
  } finally {
    client.release();
  }
}

const setNow = (iso: string) => clock.set(Instant.parse(iso));
/** 12:00 en America/La_Paz = 16:00Z. */
const noon = (date: string) => `${date}T16:00:00Z`;

const runDaily = () =>
  runSubscriptionDaily(
    commitments.subscriptionDaily,
    { list: async () => [{ workspaceId: owner.ws }] },
    workerLog.logger,
    'manual',
  );

/** Entrega al consumidor `commitments.subscription-charges` los hechos del motor sobre la definición. */
async function deliverCharges(definitionId: string): Promise<void> {
  for (const type of [
    'commitments.RecurringOccurrenceMaterialized',
    'commitments.RecurringOccurrenceChanged',
  ]) {
    for (const event of await outboxOf(owner.ws, type)) {
      if ((event.payload as { definitionId?: string }).definitionId === definitionId) {
        await deliver('commitments.subscription-charges', event);
      }
    }
  }
}

async function approve(definitionId: string, date: string, amount?: { amount: string; currency: string }) {
  const occ = await occOn(definitionId, date);
  await ok(post(owner, `/recurring/occurrences/${occ.id}/materialize`, amount ? { amount } : {}), 201);
  await deliverCharges(definitionId);
}

describe('Alta, listado y detalle (FR-COMMITMENTS-012)', () => {
  it('[TC-COMMITMENTS-SUBS-001] registrar Streamly 10.99 USD con Visa USD crea la definición recurrente, el primer precio, la auditoría y el recorrido', async () => {
    setNow(noon('2026-10-09'));
    const sub = await subscribe();
    expect(sub).toMatchObject({
      status: 'ACTIVE',
      name: 'Streamly',
      planName: 'Premium',
      providerName: 'Streamly',
      nextRenewalOn: '2026-11-15',
      currentPrice: usd('10.99'),
      priceTolerancePercent: '1.00',
    });
    expect(sub.priceHistory).toHaveLength(1);
    expect(sub.priceHistory?.[0]).toMatchObject({ effectiveFrom: '2026-11-15', origin: 'INITIAL' });
    const def = await get(owner, `/recurring/${sub.definitionId}`);
    expect(def.body).toMatchObject({
      kind: 'EXPENSE',
      managedBy: 'SUBSCRIPTION',
      managedRef: sub.id,
      current: { accountId: visaUsd, amount: { type: 'FIXED', amount: usd('10.99') } },
    });
    const occ = await occurrencesOf(sub.definitionId);
    expect(occ[0]).toMatchObject({ occurrenceDate: '2026-11-15', managedBy: 'SUBSCRIPTION' });

    const audits = await auditOf(owner.ws, `aggregate_id = $1`, [sub.id]);
    expect(audits.map((a) => a.action)).toEqual(['commitments.subscription.created']);
    expect(audits[0]).toMatchObject({ aggregate_type: 'Subscription', actor_type: 'USER' });
    const lifecycle = await get(owner, `/subscriptions/${sub.id}/lifecycle`);
    expect(lifecycle.status, JSON.stringify(lifecycle.body)).toBe(200);
    expect(contract.validateResponse('getSubscriptionLifecycle', 200, lifecycle.body)).toEqual([]);
    expect(lifecycle.body['currentState']).toBe('ACTIVE');
    expect((lifecycle.body['items'] as { transition: string }[]).map((i) => i.transition)).toEqual([
      'CREATE',
    ]);
  });

  it('[TC-COMMITMENTS-SUBS-002] contraparte archivada, precio cero y primera renovación anterior al trial se rechazan sin crear nada', async () => {
    const before = ((await get(owner, '/subscriptions?limit=200')).body['data'] as unknown[]).length;
    problem(
      await post(owner, '/subscriptions', input({ counterpartyId: oldtv })),
      409,
      'COUNTERPARTY_ARCHIVED',
    );
    problem(await post(owner, '/subscriptions', input({ price: usd('0.00') })), 422, 'AMOUNT_NOT_POSITIVE');
    problem(
      await post(owner, '/subscriptions', input({ trialEndsOn: '2026-11-20', firstRenewalOn: '2026-11-01' })),
      400,
      'VALIDATION_FAILED',
    );
    problem(
      await post(owner, '/subscriptions', input({ price: { amount: '10.999', currency: 'USD' } })),
      422,
      'AMOUNT_SCALE_EXCEEDED',
    );
    const after = ((await get(owner, '/subscriptions?limit=200')).body['data'] as unknown[]).length;
    expect(after).toBe(before);
    const definitions = (await get(owner, '/recurring?limit=200')).body['data'] as { name: string }[];
    expect(definitions.filter((d) => d.name === 'OldTV')).toHaveLength(0);
  });

  it('[TC-COMMITMENTS-SUBS-003] USD pagado con una tarjeta en BOB estima cada cargo con la tasa paralela (107.70 BOB)', async () => {
    setNow(noon('2026-10-09'));
    const sub = await subscribe({ name: 'Streamly BOB', paymentAccountId: visaBob });
    expect(sub.currentPrice).toEqual(usd('10.99'));
    expect(sub.definition).toMatchObject({ indexed: true });
    const first = await occOn(sub.definitionId, '2026-11-15');
    expect(first.expected).toMatchObject({ type: 'ESTIMATED', amount: bob('107.70') });
    const def = await get(owner, `/recurring/${sub.definitionId}`);
    expect(
      contract.validateResponse('getRecurringDefinition', 200, def.body),
      JSON.stringify(def.body),
    ).toEqual([]);
    expect((def.body['current'] as { indexedPrice: unknown }).indexedPrice).toEqual(usd('10.99'));
  });

  it('[TC-COMMITMENTS-SUBS-005] el listado excluye las canceladas salvo al filtrar por ese estado; [TC-COMMITMENTS-SUBS-017] otro workspace no ve la suscripción', async () => {
    const live = await subscribe({ name: 'Visible', counterpartyId: musicbox });
    const gone = await subscribe({
      name: 'Cancelada',
      counterpartyId: clouddrive,
      firstRenewalOn: '2026-11-20',
    });
    const cancelled = await command(gone, '/cancel', {});
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(contract.validateResponse('cancelSubscription', 200, cancelled.body)).toEqual([]);
    expect(cancelled.body).toMatchObject({
      status: 'CANCELLED',
      cancelledOn: '2026-10-09',
      nextRenewalOn: null,
    });

    const all = await get(owner, '/subscriptions?limit=200');
    expect(contract.validateResponse('listSubscriptions', 200, all.body), JSON.stringify(all.body)).toEqual(
      [],
    );
    const names = (all.body['data'] as { name: string; id: string }[]).map((s) => s.name);
    expect(names).toContain('Visible');
    expect(names).not.toContain('Cancelada');
    const onlyCancelled = await get(owner, '/subscriptions?status=CANCELLED&limit=200');
    expect((onlyCancelled.body['data'] as { name: string }[]).map((s) => s.name)).toContain('Cancelada');
    const byProvider = await get(owner, `/subscriptions?counterpartyId=${musicbox}&limit=200`);
    expect((byProvider.body['data'] as { id: string }[]).map((s) => s.id)).toContain(live.id);
    const byAccount = await get(owner, `/subscriptions?paymentAccountId=${visaBob}&limit=200`);
    expect(
      (byAccount.body['data'] as { paymentAccountId: string }[]).every((s) => s.paymentAccountId === visaBob),
    ).toBe(true);

    problem(
      await call('GET', `${W(owner)}/subscriptions/${live.id}`, { token: outsider.token }),
      403,
      'WORKSPACE_ACCESS_DENIED',
    );
    const intruder = await user(`kc-subs-other-${randomUUID()}`);
    problem(
      await call('GET', `${W(intruder)}/subscriptions/${live.id}`, { token: intruder.token }),
      404,
      'RESOURCE_NOT_FOUND',
    );
  });

  it('[TC-COMMITMENTS-SUBS-016] un VIEWER no puede cancelar y cada cambio del EDITOR queda auditado con su diff', async () => {
    const sub = await subscribe({ name: 'Auditada' });
    const viewerCancel = await command(sub, '/cancel', {}, 'POST', viewer);
    problem(viewerCancel, 403, 'INSUFFICIENT_ROLE');
    expect((await detail(sub.id)).status).toBe('ACTIVE');
    expect((await detail(sub.id, viewer)).id).toBe(sub.id);

    const updated = await command(sub, '', { planName: 'Estándar' }, 'PATCH', editor);
    expect(updated.status, `${JSON.stringify(updated.body)} ${apiErrors()}`).toBe(200);
    expect(contract.validateResponse('updateSubscription', 200, updated.body)).toEqual([]);
    expect(updated.body['planName']).toBe('Estándar');
    const audits = await auditOf(owner.ws, `aggregate_id = $1`, [sub.id]);
    expect(audits.map((a) => a.action)).toEqual([
      'commitments.subscription.created',
      'commitments.subscription.updated',
    ]);
    const changes = await auditChanges(owner.ws, sub.id, 'commitments.subscription.updated');
    expect(changes?.actorUserId).toBe(editor.id);
    expect(changes?.changes).toEqual(
      expect.arrayContaining([{ field: 'planName', before: 'Premium', after: 'Estándar' }]),
    );
    const viewerUpdate = await command(sub, '', { planName: 'X' }, 'PATCH', viewer);
    problem(viewerUpdate, 403, 'INSUFFICIENT_ROLE');
  });

  it('el POST de alta repite la respuesta con la misma Idempotency-Key y la edición exige If-Match', async () => {
    const key = randomUUID();
    const first = await post(owner, '/subscriptions', input({ name: 'Idempotente' }), {
      'idempotency-key': key,
    });
    const second = await post(owner, '/subscriptions', input({ name: 'Idempotente' }), {
      'idempotency-key': key,
    });
    expect(first.status).toBe(201);
    expect(second.body['id']).toBe(first.body['id']);
    const stale = await call('PATCH', `${W(owner)}/subscriptions/${first.body['id'] as string}`, {
      token: owner.token,
      body: { planName: 'x' },
      headers: { 'if-match': '"99"' },
    });
    problem(stale, 412, 'PRECONDITION_FAILED');
    const missing = await call('PATCH', `${W(owner)}/subscriptions/${first.body['id'] as string}`, {
      token: owner.token,
      body: { planName: 'x' },
    });
    expect(missing.status).toBe(428);
  });
});

describe('Estados, cancelación y recorrido', () => {
  it('[TC-COMMITMENTS-SUBS-011] pausar y reanudar: sin cargos de las fechas transcurridas; los endpoints del motor sobre la definición responden RECURRING_MANAGED_EXTERNALLY', async () => {
    setNow(noon('2026-10-09'));
    const sub = await subscribe({
      name: 'Pausable',
      counterpartyId: musicbox,
      price: usd('9.99'),
      firstRenewalOn: '2026-11-05',
    });
    const def = await get(owner, `/recurring/${sub.definitionId}`);
    const defVersion = def.body['version'] as number;
    for (const [path, body] of [
      ['/pause', undefined],
      ['/resume', undefined],
      ['/end', {}],
      [
        '/revisions',
        { effectiveFrom: '2026-12-05', changes: { amount: { type: 'FIXED', amount: usd('1.00') } } },
      ],
    ] as const) {
      const attempt = await call('POST', `${W(owner)}/recurring/${sub.definitionId}${path}`, {
        token: owner.token,
        ...(body !== undefined ? { body } : {}),
        headers: { 'idempotency-key': randomUUID(), 'if-match': `"${defVersion}"` },
      });
      problem(attempt, 409, 'RECURRING_MANAGED_EXTERNALLY');
    }
    const edit = await patch(owner, `/recurring/${sub.definitionId}`, { name: 'Otro' }, defVersion);
    problem(edit, 409, 'RECURRING_MANAGED_EXTERNALLY');
    // las acciones sobre las ocurrencias sí se hacen en el motor
    expect((await occOn(sub.definitionId, '2026-11-05')).id).toBeTruthy();

    setNow(noon('2026-11-01'));
    const paused = await command(sub, '/pause');
    expect(paused.status, `${JSON.stringify(paused.body)} ${apiErrors()}`).toBe(200);
    expect(contract.validateResponse('pauseSubscription', 200, paused.body)).toEqual([]);
    expect(paused.body).toMatchObject({ status: 'PAUSED', nextRenewalOn: null });
    const pending = (await occurrencesOf(sub.definitionId)).filter((o) =>
      ['SCHEDULED', 'DUE', 'OVERDUE'].includes(o.status),
    );
    expect(pending).toHaveLength(0);
    problem(await command(sub, '/pause'), 409, 'INVALID_STATUS_TRANSITION');

    setNow(noon('2027-01-10'));
    const resumed = await command(sub, '/resume');
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
    expect(resumed.body).toMatchObject({ status: 'ACTIVE', nextRenewalOn: '2027-02-05' });
    const dates = (await occurrencesOf(sub.definitionId))
      .filter((o) => ['SCHEDULED', 'DUE', 'OVERDUE'].includes(o.status))
      .map((o) => o.occurrenceDate);
    expect(dates).not.toContain('2026-11-05');
    expect(dates).not.toContain('2026-12-05');
    expect(dates[0]).toBe('2027-02-05');
    setNow(noon('2026-10-09'));
  });

  it('[TC-COMMITMENTS-SUBS-008] [TC-COMMITMENTS-SUBS-029] el fin de trial lo ejecuta el proceso una sola vez y el recorrido lo muestra con su actor', async () => {
    setNow(noon('2026-10-20'));
    const sub = await subscribe({
      name: 'CloudDrive',
      counterpartyId: clouddrive,
      price: usd('99.99'),
      billingCycle: { cadence: 'ANNUAL' },
      firstRenewalOn: '2026-11-20',
      trialEndsOn: '2026-11-20',
    });
    expect(sub.status).toBe('TRIAL');
    setNow('2026-11-20T03:30:00Z'); // 23:30 del 19 en La Paz
    await runDaily();
    expect((await detail(sub.id)).status).toBe('TRIAL');
    setNow('2026-11-20T04:05:00Z'); // 00:05 del 20
    await runDaily();
    await runDaily();
    const active = await detail(sub.id);
    expect(active).toMatchObject({
      status: 'ACTIVE',
      nextRenewalOn: '2026-11-20',
      currentPrice: usd('99.99'),
    });
    setNow(noon('2027-01-03'));
    const paused = await command(sub, '/pause');
    expect(paused.status).toBe(200);

    const lifecycle = await get(owner, `/subscriptions/${sub.id}/lifecycle`);
    expect(
      contract.validateResponse('getSubscriptionLifecycle', 200, lifecycle.body),
      JSON.stringify(lifecycle.body),
    ).toEqual([]);
    const items = lifecycle.body['items'] as {
      transition: string;
      fromState: string | null;
      toState: string;
      actor: { type: string };
    }[];
    const transitions = items.filter((i) => (i as { kind?: string }).kind === 'TRANSITION');
    expect(transitions.map((i) => `${i.transition}:${i.fromState ?? '∅'}→${i.toState}`)).toEqual([
      'CREATE:∅→TRIAL',
      'END_TRIAL:TRIAL→ACTIVE',
      'PAUSE:ACTIVE→PAUSED',
    ]);
    expect(transitions.map((i) => i.actor.type)).toEqual(['USER', 'WORKER', 'USER']);
    const audits = await auditOf(
      owner.ws,
      `aggregate_id = $1 AND action = 'commitments.subscription.trial_ended'`,
      [sub.id],
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_type: 'WORKER',
      actor_process: 'commitments.subscription-daily',
    });
    const machine = await get(owner, '/lifecycle-machines/Subscription');
    expect(machine.status, JSON.stringify(machine.body)).toBe(200);
    expect(contract.validateResponse('getLifecycleMachine', 200, machine.body)).toEqual([]);
    const exported = await fetch(
      `${baseUrl}${W(owner)}/subscriptions/${sub.id}/lifecycle/export?format=csv`,
      {
        headers: { authorization: `Bearer ${owner.token}` },
      },
    );
    expect(exported.status).toBe(200);
    expect(await exported.text()).toContain('END_TRIAL');
    setNow(noon('2026-10-09'));
  });

  it('[TC-COMMITMENTS-SUBS-019] la cancelación programada mantiene el estado hasta la fecha y se puede deshacer; el job la ejecuta una sola vez', async () => {
    setNow(noon('2026-10-20'));
    const sub = await subscribe({ name: 'Programada' });
    const scheduled = await command(sub, '/cancel', {
      effectiveOn: '2026-12-15',
      reason: 'fin del mes pagado',
    });
    expect(scheduled.status, `${JSON.stringify(scheduled.body)} ${apiErrors()}`).toBe(200);
    expect(scheduled.body).toMatchObject({ status: 'ACTIVE', scheduledCancellationOn: '2026-12-15' });
    const pendingFrom = async () =>
      (await occurrencesOf(sub.definitionId))
        .filter((o) => ['SCHEDULED', 'DUE', 'OVERDUE'].includes(o.status))
        .map((o) => o.occurrenceDate);
    expect((await pendingFrom()).filter((d) => d >= '2026-12-15')).toHaveLength(0);

    setNow(noon('2026-12-01'));
    await runJob();
    expect((await get(owner, `/recurring/${sub.definitionId}`)).body['status']).toBe('ACTIVE');
    const undone = await command(sub, '/scheduled-cancellation/undo');
    expect(undone.status, JSON.stringify(undone.body)).toBe(200);
    expect(contract.validateResponse('undoScheduledSubscriptionCancellation', 200, undone.body)).toEqual([]);
    expect(undone.body).toMatchObject({
      status: 'ACTIVE',
      scheduledCancellationOn: null,
      nextRenewalOn: '2026-12-15',
    });
    expect(await pendingFrom()).toContain('2026-12-15');
    problem(await command(sub, '/scheduled-cancellation/undo'), 409, 'INVALID_STATUS_TRANSITION');

    await ok(command(sub, '/cancel', { effectiveOn: '2026-12-15' }), 200);
    setNow('2026-12-15T04:05:00Z');
    await runDaily();
    await runDaily();
    const cancelled = await detail(sub.id);
    expect(cancelled).toMatchObject({
      status: 'CANCELLED',
      cancelledOn: '2026-12-15',
      scheduledCancellationOn: null,
    });
    expect((await get(owner, `/recurring/${sub.definitionId}`)).body['status']).toBe('ENDED');
    const events = (await outboxOf(owner.ws, 'commitments.SubscriptionCancelled')).filter(
      (e) => e.aggregateId === sub.id,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({ scheduled: true, cancelledOn: '2026-12-15' });
    problem(await command(sub, '/cancel', {}), 409, 'INVALID_STATUS_TRANSITION');
    problem(await command(sub, '', { planName: 'x' }, 'PATCH'), 409, 'INVALID_STATUS_TRANSITION');
    setNow(noon('2026-10-09'));
  });
});

describe('Precios, propuestas y cargos', () => {
  it('[TC-COMMITMENTS-SUBS-013] [TC-COMMITMENTS-SUBS-014] [TC-COMMITMENTS-SUBS-018] precio manual a futuro, vigencia no cronológica y corrección por reemplazo', async () => {
    setNow(noon('2026-10-09'));
    const sub = await subscribe({ name: 'Precios' });
    const changed = await command(sub, '/prices', { price: usd('12.99'), effectiveFrom: '2027-03-15' });
    expect(changed.status, `${JSON.stringify(changed.body)} ${apiErrors()}`).toBe(201);
    expect(contract.validateResponse('addSubscriptionPrice', 201, changed.body)).toEqual([]);
    const history = (changed.body as unknown as Sub).priceHistory!;
    expect(history.map((p) => [p.effectiveFrom, p.price.amount, p.origin])).toEqual([
      ['2026-11-15', '10.99', 'INITIAL'],
      ['2027-03-15', '12.99', 'MANUAL'],
    ]);
    expect((changed.body as unknown as Sub).currentPrice).toEqual(usd('10.99'));
    const events = (await outboxOf(owner.ws, 'commitments.SubscriptionPriceChanged')).filter(
      (e) => e.aggregateId === sub.id,
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      origin: 'MANUAL',
      previousPrice: usd('10.99'),
      newPrice: usd('12.99'),
      changePercentage: '+18.20',
      providerName: 'Streamly',
    });

    problem(
      await command(changed.body as unknown as Sub, '/prices', {
        price: usd('11.99'),
        effectiveFrom: '2027-01-15',
      }),
      422,
      'SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL',
    );

    const typo = await command(changed.body as unknown as Sub, '/prices', {
      price: usd('129.90'),
      effectiveFrom: '2027-06-15',
    });
    expect(typo.status).toBe(201);
    const wrong = (typo.body as unknown as Sub).priceHistory!.find((p) => p.price.amount === '129.90')!;
    const fixed = await command(typo.body as unknown as Sub, `/prices/${wrong.id}/supersede`, {
      price: usd('13.99'),
    });
    expect(fixed.status, `${JSON.stringify(fixed.body)} ${apiErrors()}`).toBe(200);
    expect(contract.validateResponse('supersedeSubscriptionPrice', 200, fixed.body)).toEqual([]);
    const fixedHistory = (fixed.body as unknown as Sub).priceHistory!;
    expect(fixedHistory.map((p) => [p.price.amount, p.origin, p.supersededBy !== null])).toEqual([
      ['10.99', 'INITIAL', false],
      ['12.99', 'MANUAL', false],
      ['129.90', 'MANUAL', true],
      ['13.99', 'CORRECTION', false],
    ]);
    problem(
      await command(fixed.body as unknown as Sub, `/prices/${wrong.id}/supersede`, { price: usd('14.00') }),
      409,
      'INVALID_STATUS_TRANSITION',
    );
    const origins = (await outboxOf(owner.ws, 'commitments.SubscriptionPriceChanged'))
      .filter((e) => e.aggregateId === sub.id)
      .map((e) => (e.payload as { origin: string }).origin);
    expect(origins).toEqual(['MANUAL', 'MANUAL', 'CORRECTION']);
  });

  it('[TC-COMMITMENTS-SUBS-020] [TC-COMMITMENTS-SUBS-022] [TC-COMMITMENTS-SUBS-023] un cargo sobre la tolerancia crea una propuesta (una sola aunque el hecho se reentregue) que el EDITOR acepta', async () => {
    setNow(noon('2026-10-01'));
    const sub = await subscribe({
      name: 'MusicBox',
      counterpartyId: musicbox,
      price: usd('9.99'),
      firstRenewalOn: '2026-10-05',
    });
    setNow(noon('2026-11-05'));
    await runJob();
    await approve(sub.definitionId, '2026-10-05');
    expect((await detail(sub.id)).pendingProposal).toBeNull();

    const occ = await occOn(sub.definitionId, '2026-11-05');
    await ok(post(owner, `/recurring/occurrences/${occ.id}/materialize`, { amount: usd('11.99') }), 201);
    const materialized = (await outboxOf(owner.ws, 'commitments.RecurringOccurrenceMaterialized')).find(
      (e) => (e.payload as { occurrenceId: string }).occurrenceId === occ.id,
    )!;
    // entrega concurrente y reentrega con otro identificador de evento
    await Promise.all([
      deliver('commitments.subscription-charges', materialized),
      deliver('commitments.subscription-charges', { ...materialized, eventId: randomUUID() }),
    ]);
    await deliver('commitments.subscription-charges', materialized);

    const withProposal = await detail(sub.id);
    expect(withProposal.pendingProposal).toMatchObject({
      status: 'PENDING',
      effectiveFrom: '2026-11-05',
      proposedPrice: usd('11.99'),
      changePercent: '+20.02',
    });
    expect(withProposal.currentPrice).toEqual(usd('9.99'));
    const detected = (await outboxOf(owner.ws, 'commitments.SubscriptionPriceChanged')).filter(
      (e) => e.aggregateId === sub.id,
    );
    expect(detected).toHaveLength(1);
    expect(detected[0]?.payload).toMatchObject({
      origin: 'DETECTED',
      changePercentage: '+20.02',
      previousPrice: usd('9.99'),
    });

    const charges = await get(owner, `/subscriptions/${sub.id}/charges`);
    expect(charges.status, JSON.stringify(charges.body)).toBe(200);
    expect(
      contract.validateResponse('listSubscriptionCharges', 200, charges.body),
      JSON.stringify(charges.body),
    ).toEqual([]);
    const rows = charges.body['data'] as {
      occurrenceDate: string;
      outcome: string;
      deviationPercent: string | null;
    }[];
    expect(rows.map((c) => [c.occurrenceDate, c.outcome])).toEqual([
      ['2026-11-05', 'PRICE_CHANGE_DETECTED'],
      ['2026-10-05', 'WITHIN_TOLERANCE'],
    ]);

    const proposalId = withProposal.pendingProposal!.id;
    const accepted = await command(withProposal, `/price-proposals/${proposalId}/accept`);
    expect(accepted.status, `${JSON.stringify(accepted.body)} ${apiErrors()}`).toBe(200);
    expect(contract.validateResponse('acceptSubscriptionPriceProposal', 200, accepted.body)).toEqual([]);
    const history = (accepted.body as unknown as Sub).priceHistory!;
    expect(history.map((p) => [p.effectiveFrom, p.price.amount, p.origin])).toEqual([
      ['2026-10-05', '9.99', 'INITIAL'],
      ['2026-11-05', '11.99', 'PROPOSAL'],
    ]);
    expect((accepted.body as unknown as Sub).pendingProposal).toBeNull();
    expect((await occOn(sub.definitionId, '2026-12-05')).expected).toMatchObject({ amount: usd('11.99') });
    // aceptar no vuelve a publicar el hecho
    expect(
      (await outboxOf(owner.ws, 'commitments.SubscriptionPriceChanged')).filter(
        (e) => e.aggregateId === sub.id,
      ),
    ).toHaveLength(1);
    problem(
      await command(accepted.body as unknown as Sub, `/price-proposals/${proposalId}/reject`),
      409,
      'SUBSCRIPTION_PROPOSAL_NOT_PENDING',
    );
    setNow(noon('2026-10-09'));
  });

  it('[TC-COMMITMENTS-SUBS-023] rechazar una propuesta deja el precio vigente', async () => {
    setNow(noon('2026-10-01'));
    const sub = await subscribe({
      name: 'Rechazo',
      counterpartyId: musicbox,
      price: usd('9.99'),
      firstRenewalOn: '2026-10-05',
    });
    setNow(noon('2026-10-05'));
    await approve(sub.definitionId, '2026-10-05', usd('11.99'));
    const withProposal = await detail(sub.id);
    expect(withProposal.pendingProposal?.status).toBe('PENDING');
    const rejected = await command(
      withProposal,
      `/price-proposals/${withProposal.pendingProposal!.id}/reject`,
    );
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect(contract.validateResponse('rejectSubscriptionPriceProposal', 200, rejected.body)).toEqual([]);
    expect(rejected.body).toMatchObject({ currentPrice: usd('9.99'), pendingProposal: null });
    problem(
      await command(
        rejected.body as unknown as Sub,
        `/price-proposals/${withProposal.pendingProposal!.id}/accept`,
      ),
      409,
      'SUBSCRIPTION_PROPOSAL_NOT_PENDING',
    );
    setNow(noon('2026-10-09'));
  });

  it('[TC-COMMITMENTS-SUBS-024] un cargo en BOB de una suscripción en USD registra la tasa implícita y detecta solo con el monto del extracto', async () => {
    setNow(noon('2026-10-20'));
    const sub = await subscribe({ name: 'Streamly BOB 2', paymentAccountId: visaBob });
    setNow(noon('2026-11-15'));
    await approve(sub.definitionId, '2026-11-15', bob('108.50'));
    const charges = await get(owner, `/subscriptions/${sub.id}/charges`);
    const [charge] = charges.body['data'] as { id: string; outcome: string; impliedRate: string | null }[];
    expect(charge).toMatchObject({ outcome: 'NOT_COMPARABLE', impliedRate: '9.8726' });
    expect((await detail(sub.id)).pendingProposal).toBeNull();

    const current = await detail(sub.id);
    const patched = await call('PATCH', `${W(owner)}/subscriptions/${sub.id}/charges/${charge!.id}`, {
      token: owner.token,
      body: { priceCurrencyAmount: usd('12.99') },
      headers: { 'if-match': `"${current.version}"` },
    });
    expect(patched.status, `${JSON.stringify(patched.body)} ${apiErrors()}`).toBe(200);
    expect(
      contract.validateResponse('updateSubscriptionCharge', 200, patched.body),
      JSON.stringify(patched.body),
    ).toEqual([]);
    expect(patched.body).toMatchObject({ outcome: 'PRICE_CHANGE_DETECTED', deviationPercent: '+18.20' });
    expect((await detail(sub.id)).pendingProposal).toMatchObject({
      proposedPrice: usd('12.99'),
      effectiveFrom: '2026-11-15',
      changePercent: '+18.20',
    });
    const wrongCurrency = await call('PATCH', `${W(owner)}/subscriptions/${sub.id}/charges/${charge!.id}`, {
      token: owner.token,
      body: { priceCurrencyAmount: bob('1.00') },
      headers: { 'if-match': `"${(await detail(sub.id)).version}"` },
    });
    problem(wrongCurrency, 422, 'CURRENCY_MISMATCH');
    setNow(noon('2026-10-09'));
  });
});

describe('Costo y recordatorios', () => {
  it('[TC-COMMITMENTS-SUBS-025] el costo mensual y anual en BOB usa la tasa paralela de hoy y deja fuera trials y pausadas', async () => {
    setNow(noon('2026-11-10'));
    // La tasa de octubre ya salió de la ventana de vigencia (7 días): la de hoy.
    await ok(
      post(owner, '/fx-rates', {
        base: 'USD',
        quote: 'BOB',
        value: '9.80',
        rateType: 'PARALLEL',
        asOf: '2026-11-10T10:00:00Z',
        sourceLabel: 'Casa de cambio',
      }),
    );
    const before = await get(owner, '/subscriptions/cost-summary');
    expect(
      contract.validateResponse('getSubscriptionCostSummary', 200, before.body),
      JSON.stringify(before.body),
    ).toEqual([]);
    const baseMonthly = dec(
      (before.body as { totals: { monthly: { amount: string } } }).totals.monthly.amount,
    );
    const sub = await subscribe({
      name: 'Costo USD',
      counterpartyId: streamly,
      price: usd('10.99'),
      firstRenewalOn: '2026-11-25',
    });
    const trial = await subscribe({
      name: 'Costo trial',
      counterpartyId: clouddrive,
      price: usd('4.99'),
      firstRenewalOn: '2026-12-10',
      trialEndsOn: '2026-12-10',
    });
    const reply = await get(owner, '/subscriptions/cost-summary');
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    expect(
      contract.validateResponse('getSubscriptionCostSummary', 200, reply.body),
      JSON.stringify(reply.body),
    ).toEqual([]);
    const cost = reply.body as unknown as {
      items: { subscriptionId: string; monthly: { base: unknown }; annual: { base: unknown } }[];
      totals: { monthly: { amount: string }; complete: boolean };
      afterTrial: {
        items: { subscriptionId: string; monthly: { base: unknown } }[];
        monthly: { amount: string };
      };
      meta: { ratesUsed: { rate: { base: string; value: string } }[] };
    };
    const item = cost.items.find((i) => i.subscriptionId === sub.id)!;
    expect(item.monthly.base).toEqual(bob('107.70'));
    expect(item.annual.base).toEqual(bob('1292.42'));
    expect(cost.afterTrial.items.find((i) => i.subscriptionId === trial.id)?.monthly.base).toEqual(
      bob('48.90'),
    );
    expect(cost.items.some((i) => i.subscriptionId === trial.id)).toBe(false);
    expect(
      dec(cost.totals.monthly.amount).minus(baseMonthly).minus('107.70').abs().lessThanOrEqualTo('0.01'),
    ).toBe(true);
    expect(cost.meta.ratesUsed.map((r) => [r.rate.base, r.rate.value])).toContainEqual(['USD', '9.8']);
    setNow(noon('2026-10-09'));
  });

  it('[TC-COMMITMENTS-SUBS-027] [TC-COMMITMENTS-SUBS-028] el job publica el recordatorio de renovación y de fin de trial una sola vez por fecha', async () => {
    setNow(noon('2026-11-01'));
    const sub = await subscribe({
      name: 'Recordada',
      counterpartyId: streamly,
      firstRenewalOn: '2026-11-15',
    });
    const trial = await subscribe({
      name: 'Trial recordado',
      counterpartyId: clouddrive,
      price: usd('99.99'),
      billingCycle: { cadence: 'ANNUAL' },
      firstRenewalOn: '2026-11-20',
      trialEndsOn: '2026-11-20',
    });
    const reminders = async (type: string, id: string) =>
      (await outboxOf(owner.ws, type)).filter((e) => e.aggregateId === id);
    setNow('2026-11-12T03:30:00Z'); // 23:30 del 11 en La Paz: faltan 4 días
    await runDaily();
    expect(await reminders('commitments.SubscriptionRenewalUpcoming', sub.id)).toHaveLength(0);
    setNow('2026-11-12T04:05:00Z'); // 00:05 del 12: faltan 3
    await runDaily();
    await runDaily();
    setNow(noon('2026-11-13'));
    await runDaily();
    const renewal = await reminders('commitments.SubscriptionRenewalUpcoming', sub.id);
    expect(renewal).toHaveLength(1);
    expect(renewal[0]?.payload).toMatchObject({
      renewalDate: '2026-11-15',
      providerName: 'Streamly',
      expectedPrice: usd('10.99'),
      paymentAccountName: 'Visa USD',
      requiresApproval: true,
    });
    setNow(noon('2026-11-17'));
    await runDaily();
    setNow(noon('2026-11-18'));
    await runDaily();
    const trialEvents = await reminders('commitments.SubscriptionTrialEnding', trial.id);
    expect(trialEvents).toHaveLength(1);
    expect(trialEvents[0]?.payload).toMatchObject({
      trialEndsOn: '2026-11-20',
      firstChargePrice: usd('99.99'),
      providerName: 'CloudDrive',
    });
    setNow(noon('2026-10-09'));
  });
});
