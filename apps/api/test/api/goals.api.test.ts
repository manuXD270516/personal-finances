/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import {
  commitmentsEventConsumers,
  createCommitmentsRuntime,
} from '@pf/commitments/interface/commitments.module';
import { goalsEventConsumers, runGoalsDaily, type GoalsRuntime } from '@pf/goals/interface/goals.module';
import {
  identityWorkspaceCalendarDirectory,
  identityWorkspaceSettingsDirectory,
  identityWorkspaceTimeZones,
} from '@pf/identity/interface/identity.module';
import { ledgerActivityRange } from '@pf/ledger/interface/ledger.module';
import { createPlanningRuntime } from '@pf/planning/interface/planning.module';
import { ApiContract } from '@pf/platform/api';
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
import { connect, inTx, sqlState } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Metas de ahorro por HTTP contra PostgreSQL real (openspec add-savings-goals, tareas 5.1 y 7.1): alta y validaciones,
// aportes reales (transferencia en la misma transacción) y reservas con su límite, sobre-asignación por episodios con el
// consumidor `goals.balance-watch` (pf_worker), vínculo de transferencias, anulación/revisión, retiros, reasignación,
// metas alcanzadas, plan recurrente, sugerencias, roles, idempotencia y aislamiento. Las respuestas se validan contra el
// OpenAPI. Cada escenario usa su propio workspace.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const contract = ApiContract.fromFile(resolveContractPath());
const clock = new FixedClock(Instant.parse('2026-10-15T16:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const workerLog = capturingLogger('finance-worker', 'worker');
const apiErrors = () =>
  JSON.stringify(apiLog.records().filter((r) => Number(r['level']) >= 50 || r['level'] === 'error'));

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
let worker: Pool;
let goals: GoalsRuntime;
let consumers: EventConsumerRuntime;
let definitions: Map<string, EventConsumerDefinition>;

interface Reply {
  status: number;
  body: Record<string, any>;
  headers: Headers;
  text: string;
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
  const parse = (): Record<string, any> => {
    try {
      return text ? (JSON.parse(text) as Record<string, any>) : {};
    } catch {
      return {};
    }
  };
  return { status: res.status, headers: res.headers, body: parse(), text };
}

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId };
}
type User = Awaited<ReturnType<typeof user>>;
const W = (u: User) => `/api/v1/workspaces/${u.ws}`;

async function join(owner: User, member: User, role: 'EDITOR' | 'VIEWER'): Promise<User> {
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
  return { ...member, ws: owner.ws };
}

const post = (u: User, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call('POST', `${W(u)}${path}`, {
    token: u.token,
    ...(body !== undefined ? { body } : {}),
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
const get = (u: User, path: string) => call('GET', `${W(u)}${path}`, { token: u.token });
const versioned = (u: User, method: string, path: string, body: unknown, version: number) =>
  call(method, `${W(u)}${path}`, {
    token: u.token,
    ...(body === undefined ? {} : { body }),
    headers: { 'if-match': `"${version}"` },
  });
const ok = async (r: Promise<Reply>, status = 201) => {
  const reply = await r;
  expect(reply.status, `${reply.text} ${apiErrors()}`).toBe(status);
  return reply.body;
};
const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, `${r.text} ${apiErrors()}`).toBe(status);
  expect(r.body['code'], r.text).toBe(code);
};
const checked = (operation: string, status: number, r: Reply) => {
  expect(r.status, `${r.text} ${apiErrors()}`).toBe(status);
  expect(contract.validateResponse(operation, status, r.body), r.text).toEqual([]);
  return r.body;
};

const bob = (amount: string) => ({ amount, currency: 'BOB' });
const setDay = (date: string) => clock.set(Instant.parse(`${date}T16:00:00Z`));

async function account(u: User, name: string, type: string, currency: string, opening: string) {
  const body: Record<string, unknown> = { name, type, currency };
  if (type !== 'CREDIT_CARD') {
    body['openingBalance'] = { amount: { amount: opening, currency }, date: '2026-09-01' };
  }
  return (await ok(post(u, '/accounts', body)))['id'] as string;
}

interface Scenario {
  owner: User;
  editor: User;
  viewer: User;
  banco: string;
  ahorro: string;
  efectivo: string;
  tarjeta: string;
}

async function scenario(label: string, bankBalance = '8000.00'): Promise<Scenario> {
  setDay('2026-10-15');
  const owner = await user(`kc-goals-${label}-${randomUUID()}`);
  const editor = await join(owner, await user(`kc-goals-${label}-ed-${randomUUID()}`), 'EDITOR');
  const viewer = await join(owner, await user(`kc-goals-${label}-vw-${randomUUID()}`), 'VIEWER');
  const banco = await account(owner, 'Banco BOB', 'BANK', 'BOB', bankBalance);
  const ahorro = await account(owner, 'Ahorro BOB', 'SAVINGS', 'BOB', '0.00');
  const efectivo = await account(owner, 'Efectivo BOB', 'CASH', 'BOB', '0.00');
  const tarjeta = await account(owner, 'Tarjeta X', 'CREDIT_CARD', 'BOB', '0.00');
  await ok(post(owner, '/periods', { through: '2027-03-31' }), 200);
  return { owner, editor, viewer, banco, ahorro, efectivo, tarjeta };
}

const emergency = (s: Scenario, over: Record<string, unknown> = {}) => ({
  name: 'Fondo de emergencia',
  type: 'EMERGENCY_FUND',
  target: bob('15000.00'),
  startDate: '2026-10-01',
  targetDate: '2027-03-31',
  linkedAccountIds: [s.ahorro],
  priority: 1,
  ...over,
});
const laptop = (over: Record<string, unknown> = {}) => ({
  name: 'Laptop',
  type: 'PURCHASE',
  target: bob('9000.00'),
  startDate: '2026-10-01',
  priority: 2,
  ...over,
});
async function create(u: User, body: Record<string, unknown>) {
  return checked('createGoal', 201, await post(u, '/goals', body));
}
const detail = async (u: User, id: string) => checked('getGoal', 200, await get(u, `/goals/${id}`));
const contribute = (u: User, goalId: string, body: Record<string, unknown>) =>
  post(u, `/goals/${goalId}/contributions`, body);
const reserve = (s: Scenario, goalId: string, amount: string, account = s.banco) =>
  contribute(s.owner, goalId, { fund: 'EARMARK', amount: bob(amount), sourceAccountId: account });
const reservations = async (u: User, accountId?: string) =>
  (
    checked(
      'getGoalReservations',
      200,
      await get(u, `/goals/reservations${accountId ? `?accountId=${accountId}` : ''}`),
    )['data'] as any[]
  ).slice();

async function auditOf(ws: string, where: string, params: unknown[] = []) {
  const client = await worker.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.workspace_id', $1, true)`,
      [ws],
    );
    const res = await client.query<{ action: string }>(
      `SELECT action FROM audit.audit_log WHERE ${where} ORDER BY occurred_at, id`,
      params,
    );
    await client.query('COMMIT');
    return res.rows;
  } finally {
    client.release();
  }
}

async function outboxOf(ws: string, eventType: string): Promise<EventEnvelope[]> {
  const { rows } = await worker.query<{ envelope: EventEnvelope }>(
    'SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = $2 ORDER BY sequence',
    [ws, eventType],
  );
  return rows.map((r) => r.envelope);
}
const deliver = (consumer: string, envelope: EventEnvelope) =>
  consumers.deliver(definitions.get(consumer)!, envelope);

/** Entrega al consumidor cada asiento publicado del workspace (como el relay del worker). */
async function watchBalances(ws: string): Promise<void> {
  for (const e of await outboxOf(ws, 'ledger.JournalEntryPosted')) {
    await deliver('goals.balance-watch', e);
  }
}

async function count(u: User, table: string, where = '1=1'): Promise<number> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, async () => {
      const { rows } = await app.query<{ n: string }>(
        `SELECT count(*) AS n FROM ${table} WHERE workspace_id = $1 AND ${where}`,
        [u.ws],
      );
      return Number(rows[0]!.n);
    });
  } finally {
    await app.end();
  }
}

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
  goals = finance.goals;
  const planning = createPlanningRuntime({
    pool: worker,
    clock,
    audit: audit.port,
    lifecycle: audit.lifecycle,
    outbox: outboxPort(writer),
    calendar: identityWorkspaceCalendarDirectory(worker),
    activity: ledgerActivityRange(),
  });
  const commitments = createCommitmentsRuntime({
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
  const defs = [...commitmentsEventConsumers(commitments), ...goalsEventConsumers(finance.goals)];
  definitions = new Map(defs.map((d) => [d.consumer, d]));
  consumers = new EventConsumerRuntime({
    pool: worker,
    queue: {} as JobQueue,
    subscriptions: new EventSubscriptions(defs),
    logger: workerLog.logger,
  });
}, 240_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
});

// ───────────────────────────────────────────── alta y ciclo de vida

describe('alta, edición y estados de la meta', () => {
  let s: Scenario;
  beforeAll(async () => {
    s = await scenario('life');
  }, 120_000);

  it('[TC-GOALS-SAVINGS-001] el fondo de emergencia nace ACTIVE, versión 1, sin progreso y con su auditoría', async () => {
    const g = await create(s.owner, emergency(s));
    expect(g).toMatchObject({ status: 'ACTIVE', version: 1, priority: 1, name: 'Fondo de emergencia' });
    expect(g['progress']).toMatchObject({ total: bob('0.00'), percent: '0.00', remaining: bob('15000.00') });
    const audits = await auditOf(s.owner.ws, `action = 'goals.goal.created' AND aggregate_id = $1`, [
      g['id'],
    ]);
    expect(audits).toHaveLength(1);
  });

  it('[TC-GOALS-SAVINGS-002] [TC-GOALS-SAVINGS-003] altas inválidas: decimales, cero, moneda, fechas, nombre repetido y pasivo', async () => {
    const before = await count(s.owner, 'goals.savings_goal');
    problem(
      await post(s.owner, '/goals', laptop({ name: 'Otra', target: bob('9000.005') })),
      422,
      'AMOUNT_SCALE_EXCEEDED',
    );
    problem(
      await post(s.owner, '/goals', laptop({ name: 'Otra', target: bob('0.00') })),
      422,
      'AMOUNT_NOT_POSITIVE',
    );
    problem(
      await post(s.owner, '/goals', laptop({ name: 'Otra', target: { amount: '500.00', currency: 'EUR' } })),
      422,
      'CURRENCY_NOT_ENABLED',
    );
    problem(
      await post(
        s.owner,
        '/goals',
        laptop({ name: 'Otra', startDate: '2026-10-01', targetDate: '2026-09-30' }),
      ),
      400,
      'VALIDATION_FAILED',
    );
    problem(
      await post(s.owner, '/goals', laptop({ name: 'Otra', linkedAccountIds: [s.tarjeta] })),
      422,
      'GOAL_ACCOUNT_NOT_ELIGIBLE',
    );
    await create(s.owner, laptop());
    problem(await post(s.owner, '/goals', laptop({ name: 'laptop' })), 409, 'NAME_TAKEN');
    expect(await count(s.owner, 'goals.savings_goal')).toBe(before + 1);
  });

  it('[TC-GOALS-SAVINGS-006] pausar y reanudar son transiciones auditadas y la meta pausada acepta reservas', async () => {
    const g = await create(s.owner, emergency(s, { name: 'Pausable', linkedAccountIds: [] }));
    const paused = checked(
      'pauseGoal',
      200,
      await versioned(s.owner, 'POST', `/goals/${g['id']}/pause`, undefined, g['version']),
    );
    expect(paused['status']).toBe('PAUSED');
    await ok(reserve(s, g['id'], '100.00'));
    const resumed = checked(
      'resumeGoal',
      200,
      await versioned(
        s.owner,
        'POST',
        `/goals/${g['id']}/resume`,
        undefined,
        (await detail(s.owner, g['id']))['version'],
      ),
    );
    expect(resumed['status']).toBe('ACTIVE');
    const lifecycle = checked('getGoalLifecycle', 200, await get(s.owner, `/goals/${g['id']}/lifecycle`));
    expect(lifecycle['path']).toEqual(['ACTIVE', 'PAUSED', 'ACTIVE']);
  });

  it('[TC-GOALS-SAVINGS-007] cancelar libera las reservas con movimientos explícitos y sube el disponible', async () => {
    const g = await create(s.owner, laptop({ name: 'Para cancelar' }));
    await ok(reserve(s, g['id'], '2000.00'));
    const before = (await reservations(s.owner, s.banco))[0];
    const cancelled = checked(
      'cancelGoal',
      200,
      await versioned(
        s.owner,
        'POST',
        `/goals/${g['id']}/cancel`,
        { reason: 'Compra postergada' },
        (await detail(s.owner, g['id']))['version'],
      ),
    );
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelReason: 'Compra postergada' });
    const movements = checked('listGoalMovements', 200, await get(s.owner, `/goals/${g['id']}/movements`));
    const release = (movements['data'] as any[]).find((m) => m.movement === 'WITHDRAWAL');
    expect(release).toMatchObject({ fund: 'EARMARK', amount: bob('-2000.00'), origin: 'SYSTEM' });
    const after = (await reservations(s.owner, s.banco))[0];
    expect(Number(after.available) - Number(before.available)).toBe(2000);
  });

  it('[TC-GOALS-SAVINGS-008] aportar a una meta cancelada es GOAL_CLOSED; cerrar o archivar una activa es INVALID_STATUS_TRANSITION', async () => {
    const dead = await create(s.owner, laptop({ name: 'Muerta' }));
    await ok(
      versioned(s.owner, 'POST', `/goals/${dead['id']}/cancel`, {}, dead['version']).then((r) => r),
      200,
    );
    problem(await reserve(s, dead['id'], '100.00'), 409, 'GOAL_CLOSED');
    const live = await create(s.owner, laptop({ name: 'Viva' }));
    problem(
      await versioned(s.owner, 'POST', `/goals/${live['id']}/close`, undefined, live['version']),
      409,
      'INVALID_STATUS_TRANSITION',
    );
    problem(
      await versioned(s.owner, 'POST', `/goals/${live['id']}/archive`, undefined, live['version']),
      409,
      'INVALID_STATUS_TRANSITION',
    );
    const deadNow = await detail(s.owner, dead['id']);
    const archived = checked(
      'archiveGoal',
      200,
      await versioned(s.owner, 'POST', `/goals/${dead['id']}/archive`, undefined, deadNow['version']),
    );
    expect(archived['archivedAt']).toBeTruthy();
    const list = checked('listGoals', 200, await get(s.owner, '/goals'));
    expect((list['data'] as any[]).map((g) => g.name)).not.toContain('Muerta');
  });
});

// ───────────────────────────────────────────── aportes, reservas y sobre-asignación

describe('aportes reales, reservas y sobre-asignación', () => {
  let s: Scenario;
  let emergencia: Record<string, any>;
  beforeAll(async () => {
    s = await scenario('money');
    emergencia = await create(s.owner, emergency(s));
  }, 120_000);

  it('[TC-GOALS-SAVINGS-009] un aporte real crea la transferencia POSTED con origen GOAL y el movimiento, y publica sus hechos', async () => {
    const movement = checked(
      'contributeToGoal',
      201,
      await contribute(s.owner, emergencia['id'], {
        fund: 'REAL',
        amount: bob('1000.00'),
        sourceAccountId: s.banco,
        destinationAccountId: s.ahorro,
      }),
    );
    expect(movement).toMatchObject({
      fund: 'REAL',
      movement: 'CONTRIBUTION',
      amount: bob('1000.00'),
      transactionRevision: 1,
    });
    const tx = await get(s.owner, `/transactions/${movement['transactionId']}`);
    expect(tx.body).toMatchObject({ kind: 'TRANSFER', status: 'POSTED', source: 'GOAL' });
    const g = await detail(s.owner, emergencia['id']);
    expect(g['progress']).toMatchObject({ total: bob('1000.00'), percent: '6.67' });
    expect((await outboxOf(s.owner.ws, 'goals.SavingsContributionRecorded')).length).toBeGreaterThan(0);
    expect((await outboxOf(s.owner.ws, 'transactions.TransferCompleted')).length).toBeGreaterThan(0);
  });

  it('[TC-GOALS-SAVINGS-010] una cuenta no vinculada se rechaza sin crear la transferencia', async () => {
    const before = await count(s.owner, 'txn.transaction', "source = 'GOAL'");
    problem(
      await contribute(s.owner, emergencia['id'], {
        fund: 'REAL',
        amount: bob('500.00'),
        sourceAccountId: s.banco,
        destinationAccountId: s.efectivo,
      }),
      422,
      'GOAL_ACCOUNT_NOT_LINKED',
    );
    expect(await count(s.owner, 'txn.transaction', "source = 'GOAL'")).toBe(before);
  });

  it('[TC-GOALS-SAVINGS-012] [TC-GOALS-SAVINGS-013] [TC-GOALS-SAVINGS-014] una reserva no crea asientos, suma al reservado y no puede superar el disponible', async () => {
    const lap = await create(s.owner, laptop());
    const postings = await count(s.owner, 'ledger.posting');
    const r = checked('contributeToGoal', 201, await reserve(s, lap['id'], '2000.00'));
    expect(r).toMatchObject({ fund: 'EARMARK', transactionId: null });
    expect(await count(s.owner, 'ledger.posting')).toBe(postings);
    await ok(reserve(s, emergencia['id'], '1500.00'));
    const rows = await reservations(s.owner);
    const banco = rows.find((x) => x.accountId === s.banco);
    const ahorro = rows.find((x) => x.accountId === s.ahorro);
    expect(banco).toMatchObject({ balance: '7000.00', reserved: '3500.00', available: '3500.00' });
    expect(ahorro).toMatchObject({ balance: '1000.00', reserved: '1000.00', available: '0.00' });
    const over = await reserve(s, lap['id'], '3600.00');
    problem(over, 422, 'EARMARK_EXCEEDS_BALANCE');
    expect(over.body['details']).toMatchObject({
      balance: bob('7000.00'),
      reserved: bob('3500.00'),
      available: bob('3500.00'),
    });
    problem(await reserve(s, lap['id'], '1.00', s.ahorro), 422, 'EARMARK_EXCEEDS_BALANCE');
    await ok(reserve(s, lap['id'], '3500.00'));
    expect((await reservations(s.owner, s.banco))[0]).toMatchObject({ available: '0.00' });
  });

  it('[TC-GOALS-SAVINGS-016] [TC-GOALS-SAVINGS-017] [TC-GOALS-SAVINGS-018] la sobre-asignación publica un hecho por episodio', async () => {
    const expense = async (amount: string, status = 'POSTED') =>
      ok(
        post(s.owner, '/transactions', {
          kind: 'EXPENSE',
          status,
          transactionDate: '2026-10-15',
          accountId: s.banco,
          amount: bob(amount),
        }),
      );
    // Banco BOB: saldo 7000.00 y reservado 7000.00 (laptop 5500.00 + emergencia 1500.00)
    await expense('500.00', 'PENDING');
    await watchBalances(s.owner.ws);
    await runGoalsDaily(
      goals.reactions,
      { list: async () => [{ workspaceId: s.owner.ws }] },
      workerLog.logger,
      'manual',
    );
    expect((await reservations(s.owner, s.banco))[0]).toMatchObject({ overAllocated: false });
    await expense('1200.00');
    await watchBalances(s.owner.ws);
    await watchBalances(s.owner.ws);
    expect((await reservations(s.owner, s.banco))[0]).toMatchObject({
      overAllocated: true,
      shortfall: '1200.00',
    });
    expect(await outboxOf(s.owner.ws, 'goals.EarmarkExceedsBalance')).toHaveLength(1);
    await expense('100.00');
    await watchBalances(s.owner.ws);
    expect((await reservations(s.owner, s.banco))[0]).toMatchObject({ shortfall: '1300.00' });
    expect(await outboxOf(s.owner.ws, 'goals.EarmarkExceedsBalance')).toHaveLength(1);
    await ok(
      post(s.owner, '/transactions', {
        kind: 'INCOME',
        status: 'POSTED',
        transactionDate: '2026-10-15',
        accountId: s.banco,
        amount: bob('2000.00'),
      }),
    );
    await watchBalances(s.owner.ws);
    expect((await reservations(s.owner, s.banco))[0]).toMatchObject({ overAllocated: false });
    await expense('800.00');
    await watchBalances(s.owner.ws);
    const events = await outboxOf(s.owner.ws, 'goals.EarmarkExceedsBalance');
    expect(events).toHaveLength(2);
    expect((events[1]!.payload as any).shortfall).toEqual(bob('100.00'));
  });
});

// ───────────────────────────────────────────── vínculo, anulación, retiros y reasignación

describe('vínculo de transferencias, anulación, retiros y reasignación', () => {
  let s: Scenario;
  let emergencia: Record<string, any>;
  beforeAll(async () => {
    s = await scenario('link');
    emergencia = await create(s.owner, emergency(s));
  }, 120_000);

  const manualTransfer = async (amount: string, to: string, status = 'POSTED') =>
    (await ok(
      post(s.owner, '/transfers', {
        status,
        transactionDate: '2026-10-20',
        fromAccountId: s.banco,
        toAccountId: to,
        amount: bob(amount),
      }),
    )) as Record<string, any>;

  it('[TC-GOALS-SAVINGS-019] [TC-GOALS-SAVINGS-020] [TC-GOALS-SAVINGS-021] vincular: elegible, motivos y duplicado', async () => {
    const t = await manualTransfer('500.00', s.ahorro);
    const linked = checked(
      'linkTransactionToGoal',
      201,
      await post(s.owner, `/goals/${emergencia['id']}/contributions/link`, { transactionId: t['id'] }),
    );
    expect(linked).toMatchObject({ movement: 'CONTRIBUTION', amount: bob('500.00'), transactionRevision: 1 });
    const other = await create(s.owner, laptop({ linkedAccountIds: [s.ahorro] }));
    problem(
      await post(s.owner, `/goals/${other['id']}/contributions/link`, { transactionId: t['id'] }),
      409,
      'GOAL_TRANSACTION_ALREADY_LINKED',
    );
    const pending = await manualTransfer('500.00', s.ahorro, 'PENDING');
    const bad = await post(s.owner, `/goals/${emergencia['id']}/contributions/link`, {
      transactionId: pending['id'],
    });
    problem(bad, 422, 'GOAL_TRANSACTION_NOT_ELIGIBLE');
    expect(bad.body['details'].reasons).toEqual(['STATUS']);
    const toCash = await manualTransfer('200.00', s.efectivo);
    const bad2 = await post(s.owner, `/goals/${emergencia['id']}/contributions/link`, {
      transactionId: toCash['id'],
    });
    expect(bad2.body['details'].reasons).toEqual(['ACCOUNT']);
    const links = checked(
      'listGoalTransactionLinks',
      200,
      await get(s.owner, `/goals/transaction-links?transactionIds=${t['id']}`),
    );
    expect((links['data'] as any[])[0].links[0]).toMatchObject({
      goalName: 'Fondo de emergencia',
      active: true,
    });
  });

  it('[TC-GOALS-SAVINGS-022] anular la transferencia registra un solo inverso aunque el hecho llegue dos veces', async () => {
    const t = await manualTransfer('300.00', s.ahorro);
    await ok(post(s.owner, `/goals/${emergencia['id']}/contributions/link`, { transactionId: t['id'] }));
    const before = (await detail(s.owner, emergencia['id']))['progress'].total.amount;
    const tx = await get(s.owner, `/transactions/${t['id']}`);
    expect(
      (
        await post(
          s.owner,
          `/transactions/${t['id']}/void`,
          { reason: 'error' },
          { 'if-match': `"${tx.body['version']}"` },
        )
      ).status,
    ).toBe(200);
    const voided = (await outboxOf(s.owner.ws, 'transactions.TransactionVoided')).find(
      (e) => (e.payload as any).transactionId === t['id'],
    )!;
    await deliver('goals.transaction-changes', voided);
    await deliver('goals.transaction-changes', { ...voided, eventId: randomUUID() } as EventEnvelope);
    const movements = (
      checked('listGoalMovements', 200, await get(s.owner, `/goals/${emergencia['id']}/movements`))[
        'data'
      ] as any[]
    ).filter((m) => m.transactionId === t['id']);
    expect(movements.map((m) => m.movement).sort()).toEqual(['CONTRIBUTION', 'REVERSAL']);
    const after = (await detail(s.owner, emergencia['id']))['progress'].total.amount;
    expect(Number(before) - Number(after)).toBe(300);
  });

  it('[TC-GOALS-SAVINGS-024] [TC-GOALS-SAVINGS-025] retiro con transferencia nueva y GOAL_INSUFFICIENT_FUNDS', async () => {
    const g = await detail(s.owner, emergencia['id']);
    const held = g['linkedAccounts'].find((a: any) => a.accountId === s.ahorro).funds.real.amount as string;
    expect(held).toMatch(/^[1-9]\d*\.\d{2}$/);
    problem(
      await post(s.owner, `/goals/${emergencia['id']}/withdrawals`, {
        fund: 'REAL',
        accountId: s.ahorro,
        amount: bob('999999.00'),
        mode: { type: 'TRANSFER', toAccountId: s.banco },
      }),
      422,
      'GOAL_INSUFFICIENT_FUNDS',
    );
    const w = checked(
      'withdrawFromGoal',
      201,
      await post(s.owner, `/goals/${emergencia['id']}/withdrawals`, {
        fund: 'REAL',
        accountId: s.ahorro,
        amount: bob('100.00'),
        mode: { type: 'TRANSFER', toAccountId: s.banco },
        reason: 'Gasto médico',
      }),
    );
    expect(w).toMatchObject({ movement: 'WITHDRAWAL', amount: bob('-100.00'), note: 'Gasto médico' });
    const tx = await get(s.owner, `/transactions/${w['transactionId']}`);
    expect(tx.body).toMatchObject({ source: 'GOAL', kind: 'TRANSFER' });
  });

  it('[TC-GOALS-SAVINGS-027] [TC-GOALS-SAVINGS-028] reasignar una reserva y rechazar fondos reales a una meta sin la cuenta', async () => {
    const lap = await create(s.owner, laptop({ name: 'Laptop 2' }));
    await ok(reserve(s, lap['id'], '1500.00'));
    const r = checked(
      'reassignGoalFunds',
      201,
      await post(s.owner, `/goals/${lap['id']}/reassignments`, {
        targetGoalId: emergencia['id'],
        fund: 'EARMARK',
        accountId: s.banco,
        amount: bob('1000.00'),
      }),
    );
    expect(r['source']).toMatchObject({ movement: 'REASSIGN_OUT', amount: bob('-1000.00') });
    expect(r['target']).toMatchObject({ movement: 'REASSIGN_IN', amount: bob('1000.00') });
    expect(r['source']['reassignmentId']).toBe(r['target']['reassignmentId']);
    problem(
      await post(s.owner, `/goals/${emergencia['id']}/reassignments`, {
        targetGoalId: lap['id'],
        fund: 'REAL',
        accountId: s.ahorro,
        amount: bob('10.00'),
      }),
      422,
      'GOAL_ACCOUNT_NOT_LINKED',
    );
  });

  it('[TC-GOALS-SAVINGS-029] los movimientos no se editan por la API (405) ni en la base (PF003)', async () => {
    const list = checked(
      'listGoalMovements',
      200,
      await get(s.owner, `/goals/${emergencia['id']}/movements`),
    );
    const id = (list['data'] as any[])[0].id;
    for (const method of ['PATCH', 'DELETE']) {
      const r = await call(method, `${W(s.owner)}/goals/${emergencia['id']}/movements/${id}`, {
        token: s.owner.token,
        body: {},
      });
      expect([404, 405]).toContain(r.status);
    }
    const app = await connect(deps.databaseUrl);
    try {
      const state = await inTx(app, { userId: s.owner.id, workspaceId: s.owner.ws }, () =>
        sqlState(() => app.query('UPDATE goals.goal_movement SET note = $1 WHERE id = $2', ['x', id])),
      );
      expect(['PF003', '42501']).toContain(state);
    } finally {
      await app.end();
    }
  });

  it('[TC-GOALS-SAVINGS-037] alcanzar publica GoalReached una vez por alcance y un retiro la reabre', async () => {
    const lap = await create(s.owner, laptop({ name: 'Laptop 3', target: bob('1000.00') }));
    await ok(reserve(s, lap['id'], '900.00'));
    await ok(reserve(s, lap['id'], '100.00'));
    expect((await detail(s.owner, lap['id']))['status']).toBe('ACHIEVED');
    await ok(reserve(s, lap['id'], '50.00'));
    const reached = (await outboxOf(s.owner.ws, 'goals.GoalReached')).filter(
      (e) => (e.payload as any).goalId === lap['id'],
    );
    expect(reached).toHaveLength(1);
    expect((reached[0]!.payload as any).trigger).toBe('MOVEMENT');
    await ok(
      post(s.owner, `/goals/${lap['id']}/withdrawals`, {
        fund: 'EARMARK',
        accountId: s.banco,
        amount: bob('200.00'),
        mode: { type: 'RELEASE' },
      }),
    );
    expect((await detail(s.owner, lap['id']))['status']).toBe('ACTIVE');
  });

  it('[TC-GOALS-SAVINGS-035] la simulación no persiste ni audita', async () => {
    const g = await detail(s.owner, emergencia['id']);
    const audits = await count(s.owner, 'audit.audit_log', `aggregate_id = '${emergencia['id']}'`);
    const sim = checked(
      'simulateGoal',
      200,
      await post(s.viewer, `/goals/${emergencia['id']}/simulations`, { monthlyContribution: bob('2000.00') }),
    );
    expect(sim['expectedDate']).toBeDefined();
    expect((await detail(s.owner, emergencia['id']))['version']).toBe(g['version']);
    expect(await count(s.owner, 'audit.audit_log', `aggregate_id = '${emergencia['id']}'`)).toBe(audits);
  });
});

// ───────────────────────────────────────────── plan recurrente y sugerencias

describe('plan, aporte recurrente y sugerencias', () => {
  let s: Scenario;
  beforeAll(async () => {
    s = await scenario('plan');
  }, 120_000);

  it('[TC-GOALS-SAVINGS-038] [TC-GOALS-SAVINGS-039] el plan recurrente crea una definición administrada por la meta', async () => {
    setDay('2026-10-10');
    const g = await create(s.owner, emergency(s));
    problem(
      await versioned(
        s.owner,
        'PUT',
        `/goals/${g['id']}/plan`,
        { monthlyAmount: { amount: '1000.00', currency: 'USD' }, fund: 'REAL', automation: 'NONE' },
        g['version'],
      ),
      422,
      'CURRENCY_MISMATCH',
    );
    const withPlan = checked(
      'setGoalPlan',
      200,
      await versioned(
        s.owner,
        'PUT',
        `/goals/${g['id']}/plan`,
        {
          monthlyAmount: bob('1500.00'),
          fund: 'REAL',
          sourceAccountId: s.banco,
          destinationAccountId: s.ahorro,
          dayOfMonth: 5,
          automation: 'RECURRING',
          materialization: { mode: 'PENDING_APPROVAL' },
        },
        g['version'],
      ),
    );
    const definitionId = withPlan['plan']['definitionId'] as string;
    expect(definitionId).toBeTruthy();
    const definition = await get(s.owner, `/recurring/${definitionId}`);
    expect(definition.body).toMatchObject({ kind: 'TRANSFER', managedBy: 'GOAL', managedRef: g['id'] });
    // Las acciones de usuario sobre la definición se rechazan.
    const pause = await versioned(
      s.owner,
      'POST',
      `/recurring/${definitionId}/pause`,
      undefined,
      definition.body['version'],
    );
    problem(pause, 409, 'RECURRING_MANAGED_EXTERNALLY');
    // Pausar la meta pausa la definición.
    const paused = await versioned(
      s.owner,
      'POST',
      `/goals/${g['id']}/pause`,
      undefined,
      withPlan['version'],
    );
    expect(paused.status, paused.text).toBe(200);
    expect((await get(s.owner, `/recurring/${definitionId}`)).body['status']).toBe('PAUSED');
  });

  it('[TC-GOALS-SAVINGS-040] una transferencia manual a una cuenta vinculada se sugiere y solo se registra al confirmar', async () => {
    setDay('2026-10-15');
    const exclusive = await account(s.owner, 'Ahorro exclusivo', 'SAVINGS', 'BOB', '0.00');
    const g = await create(
      s.owner,
      emergency(s, { name: 'Sugerida', targetDate: undefined, linkedAccountIds: [exclusive] }),
    );
    const t = await ok(
      post(s.owner, '/transfers', {
        transactionDate: '2026-10-15',
        fromAccountId: s.banco,
        toAccountId: exclusive,
        amount: bob('700.00'),
      }),
    );
    const completed = (await outboxOf(s.owner.ws, 'transactions.TransferCompleted')).find(
      (e) => (e.payload as any).transactionId === t['id'],
    )!;
    await deliver('goals.contribution-suggestions', completed);
    const list = checked(
      'listGoalContributionSuggestions',
      200,
      await get(s.owner, '/goals/contribution-suggestions'),
    );
    const suggestion = (list['data'] as any[]).find((x) => x.transactionId === t['id']);
    expect(suggestion).toMatchObject({ status: 'PENDING', goalId: g['id'], amount: bob('700.00') });
    expect((await detail(s.owner, g['id']))['progress'].total).toEqual(bob('0.00'));
    const movement = checked(
      'confirmGoalContributionSuggestion',
      200,
      await post(s.owner, `/goals/contribution-suggestions/${suggestion.id}/confirm`, {}),
    );
    expect(movement).toMatchObject({ origin: 'SUGGESTION', amount: bob('700.00') });
    problem(
      await post(s.owner, `/goals/contribution-suggestions/${suggestion.id}/confirm`, {}),
      409,
      'GOAL_SUGGESTION_NOT_PENDING',
    );
  });
});

// ───────────────────────────────────────────── permisos, idempotencia y aislamiento

describe('permisos, idempotencia y aislamiento', () => {
  let s: Scenario;
  let other: Scenario;
  let emergencia: Record<string, any>;
  beforeAll(async () => {
    s = await scenario('sec');
    other = await scenario('sec2');
    emergencia = await create(s.owner, emergency(s));
    await create(other.owner, laptop());
  }, 120_000);

  it('[TC-GOALS-SAVINGS-041] VIEWER no escribe, la Idempotency-Key evita aportes duplicados y otro workspace no ve la meta', async () => {
    const body = {
      fund: 'REAL',
      amount: bob('100.00'),
      sourceAccountId: s.banco,
      destinationAccountId: s.ahorro,
    };
    problem(await contribute(s.viewer, emergencia['id'], body), 403, 'INSUFFICIENT_ROLE');
    const key = randomUUID();
    const first = await post(
      s.editor,
      `/goals/${emergencia['id']}/contributions`,
      { ...body, amount: bob('1000.00') },
      { 'idempotency-key': key },
    );
    const second = await post(
      s.editor,
      `/goals/${emergencia['id']}/contributions`,
      { ...body, amount: bob('1000.00') },
      { 'idempotency-key': key },
    );
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get('idempotent-replayed')).toBe('true');
    expect(await count(s.owner, 'txn.transaction', "source = 'GOAL'")).toBe(1);
    expect(await count(s.owner, 'goals.goal_movement', "movement = 'CONTRIBUTION'")).toBe(1);
    const foreign = await call('GET', `/api/v1/workspaces/${other.owner.ws}/goals/${emergencia['id']}`, {
      token: other.owner.token,
    });
    problem(foreign, 404, 'RESOURCE_NOT_FOUND');
    const app = await connect(deps.databaseUrl);
    try {
      expect(await sqlState(() => app.query('SELECT 1 FROM goals.savings_goal'))).toBe('PF002');
    } finally {
      await app.end();
    }
  });

  it('[TC-REPORTING-SPENDABLE-013] un VIEWER ve el mismo disponible que el OWNER y los datos de otro workspace no lo afectan', async () => {
    const spendable = async (u: User) => checked('getSpendable', 200, await get(u, '/reports/spendable'));
    const withoutMeta = (body: Record<string, any>) => {
      const { meta: _meta, ...rest } = body;
      return rest;
    };
    const owner = await spendable(s.owner);
    const viewer = await spendable(s.viewer);
    expect(withoutMeta(viewer)).toEqual(withoutMeta(owner));
    // Una reserva en otro workspace no cambia el disponible de este.
    await ok(
      contribute(other.owner, (await create(other.owner, laptop({ name: 'Otra laptop' })))['id'], {
        fund: 'EARMARK',
        amount: bob('1000.00'),
        sourceAccountId: other.banco,
      }),
    );
    expect(withoutMeta(await spendable(s.owner))).toEqual(withoutMeta(owner));
    const foreign = await call('GET', `/api/v1/workspaces/${s.owner.ws}/reports/spendable`, {
      token: other.owner.token,
    });
    expect([403, 404]).toContain(foreign.status);
  });
});

// ───────────────────────────────────────────── objetivo, revisión, retiro vinculado y resumen del Home

describe('cambio de objetivo, revisión de la transferencia, retiro vinculado y resumen', () => {
  let s: Scenario;
  beforeAll(async () => {
    s = await scenario('misc');
  }, 120_000);

  it('[TC-GOALS-SAVINGS-004] [TC-GOALS-SAVINGS-005] bajar el objetivo alcanza la meta; moneda y cuentas con fondos se bloquean', async () => {
    const g = await create(s.owner, emergency(s));
    const t = await ok(
      post(s.owner, '/transfers', {
        transactionDate: '2026-10-15',
        fromAccountId: s.banco,
        toAccountId: s.ahorro,
        amount: bob('1000.00'),
      }),
    );
    await ok(post(s.owner, `/goals/${g['id']}/contributions/link`, { transactionId: t['id'] }));
    const current = await detail(s.owner, g['id']);
    problem(
      await versioned(s.owner, 'PATCH', `/goals/${g['id']}`, { linkedAccountIds: [] }, current['version']),
      409,
      'GOAL_ACCOUNT_HAS_FUNDS',
    );
    problem(
      await versioned(
        s.owner,
        'PATCH',
        `/goals/${g['id']}`,
        { target: { amount: '1000.00', currency: 'USD' } },
        current['version'],
      ),
      409,
      'GOAL_CURRENCY_LOCKED',
    );
    expect((await detail(s.owner, g['id']))['version']).toBe(current['version']);
    const lowered = checked(
      'updateGoal',
      200,
      await versioned(s.owner, 'PATCH', `/goals/${g['id']}`, { target: bob('800.00') }, current['version']),
    );
    expect(lowered).toMatchObject({ status: 'ACHIEVED' });
    expect(lowered['progress']['percent']).toBe('125.00');
    const reached = (await outboxOf(s.owner.ws, 'goals.GoalReached')).filter(
      (e) => (e.payload as any).goalId === g['id'],
    );
    expect((reached[0]!.payload as any).trigger).toBe('TARGET_CHANGE');
    const raised = checked(
      'updateGoal',
      200,
      await versioned(s.owner, 'PATCH', `/goals/${g['id']}`, { target: bob('2000.00') }, lowered['version']),
    );
    expect(raised).toMatchObject({ status: 'ACTIVE' });
    expect(raised['progress']['percent']).toBe('50.00');
  });

  it('[TC-GOALS-SAVINGS-023] revisar el monto de la transferencia del aporte registra el inverso y un aporte nuevo con la revisión 2', async () => {
    const g = await create(s.owner, emergency(s, { name: 'Revisable' }));
    const t = await ok(
      post(s.owner, '/transfers', {
        transactionDate: '2026-10-16',
        fromAccountId: s.banco,
        toAccountId: s.ahorro,
        amount: bob('500.00'),
      }),
    );
    await ok(post(s.owner, `/goals/${g['id']}/contributions/link`, { transactionId: t['id'] }));
    const before = await get(s.owner, `/transactions/${t['id']}`);
    const patched = await call('PATCH', `${W(s.owner)}/transactions/${t['id']}`, {
      token: s.owner.token,
      body: { amount: bob('450.00') },
      headers: {
        'if-match': `"${before.body['version']}"`,
        'content-type': 'application/merge-patch+json',
      },
    });
    expect(patched.status, patched.text).toBe(200);
    const revised = (await outboxOf(s.owner.ws, 'transactions.TransferRevised')).find(
      (e) => (e.payload as any).transactionId === t['id'],
    )!;
    await deliver('goals.transaction-changes', revised);
    const movements = (
      checked('listGoalMovements', 200, await get(s.owner, `/goals/${g['id']}/movements`))['data'] as any[]
    ).filter((m) => m.transactionId === t['id']);
    expect(movements.map((m) => [m.movement, m.amount.amount, m.transactionRevision]).sort()).toEqual([
      ['CONTRIBUTION', '450.00', 2],
      ['CONTRIBUTION', '500.00', 1],
      ['REVERSAL', '-500.00', 1],
    ]);
    expect((await detail(s.owner, g['id']))['progress']['total']).toEqual(bob('450.00'));
  });

  it('[TC-GOALS-SAVINGS-026] un gasto vinculado como retiro parcial', async () => {
    const g = await create(s.owner, emergency(s, { name: 'Con retiro' }));
    const t = await ok(
      post(s.owner, '/transfers', {
        transactionDate: '2026-10-16',
        fromAccountId: s.banco,
        toAccountId: s.ahorro,
        amount: bob('1000.00'),
      }),
    );
    await ok(post(s.owner, `/goals/${g['id']}/contributions/link`, { transactionId: t['id'] }));
    const expense = await ok(
      post(s.owner, '/transactions', {
        kind: 'EXPENSE',
        status: 'POSTED',
        transactionDate: '2026-10-17',
        accountId: s.ahorro,
        amount: bob('300.00'),
        description: 'Reparación auto',
      }),
    );
    const w = checked(
      'withdrawFromGoal',
      201,
      await post(s.owner, `/goals/${g['id']}/withdrawals`, {
        fund: 'REAL',
        accountId: s.ahorro,
        amount: bob('250.00'),
        mode: { type: 'LINK', transactionId: expense['id'] },
      }),
    );
    expect(w).toMatchObject({ amount: bob('-250.00'), transactionId: expense['id'] });
    const second = await post(s.owner, `/goals/${g['id']}/withdrawals`, {
      fund: 'REAL',
      accountId: s.ahorro,
      amount: bob('100.00'),
      mode: { type: 'LINK', transactionId: expense['id'] },
    });
    expect([409, 422]).toContain(second.status);
    expect((await detail(s.owner, g['id']))['progress']['total']).toEqual(bob('750.00'));
  });

  it('[TC-GOALS-SAVINGS-046] [TC-GOALS-SAVINGS-047] [TC-GOALS-SAVINGS-048] el resumen del Home trae Q9 con metas y los aportes netos del mes', async () => {
    const summary = checked('getReportSummary', 200, await get(s.owner, '/reports/summary?month=2026-10'));
    const block = summary['goals'];
    expect(block.status).toBe('AVAILABLE');
    expect(block.items.length).toBeLessThanOrEqual(3);
    expect(block.items[0]).toHaveProperty('percent');
    const q = Object.fromEntries((summary['questions'] as any[]).map((x) => [x.question, x.status]));
    expect(q['Q9']).toBe('AVAILABLE');
    // add-spendable-amount: Q5 se habilita con el disponible para gastar (bloque `spendable`).
    expect(q['Q5']).toBe('AVAILABLE');
    expect(summary['spendable'].consolidated.total.currency).toBe('BOB');
    expect(summary['goalContributions'].base.currency).toBe('BOB');
    const empty = await scenario('misc-empty');
    const none = checked('getReportSummary', 200, await get(empty.owner, '/reports/summary?month=2026-10'));
    expect(none['goals']).toMatchObject({ status: 'NO_DATA', action: 'CREATE_GOAL', items: [] });
  });

  it('[TC-REPORTING-SPENDABLE-012] una reserva recién registrada se refleja en la siguiente consulta del disponible, con periodo, moneda y frescura', async () => {
    const t = await scenario('spendable');
    const goal = await create(t.owner, laptop({ name: 'Laptop spendable' }));
    const before = checked('getSpendable', 200, await get(t.owner, '/reports/spendable'));
    expect(before['period']).toMatchObject({ label: '2026-10', start: '2026-10-01', end: '2026-10-31' });
    expect(before['reportingCurrency']).toBe('BOB');
    expect(before['byCurrency'][0]).toMatchObject({ currency: 'BOB', reservedForGoals: bob('0.00') });
    await ok(reserve(t, goal['id'], '500.00'));
    const after = checked('getSpendable', 200, await get(t.owner, '/reports/spendable'));
    const total = (b: Record<string, any>) => Number(b['consolidated'].total.amount);
    expect(total(before) - total(after)).toBe(500);
    expect(after['byCurrency'][0]['reservedForGoals']).toEqual(bob('500.00'));
    expect(after['meta']).toHaveProperty('generatedAt');
    expect(after['meta']).toHaveProperty('dataFreshness');
    expect(after['budgetView']).toMatchObject({ status: 'NO_PLAN', action: 'CREATE_BUDGET' });
    // El mismo bloque viaja en el resumen del Home.
    const summary = checked('getReportSummary', 200, await get(t.owner, '/reports/summary?month=2026-10'));
    expect(summary['spendable'].consolidated).toEqual(after['consolidated']);
  });
});

describe('concurrencia', () => {
  it('[TC-GOALS-SAVINGS-021] dos vínculos paralelos de la misma transferencia a dos metas: exactamente uno gana', async () => {
    const s = await scenario('conc');
    const a = await create(s.owner, emergency(s, { name: 'Meta A' }));
    const b = await create(s.owner, emergency(s, { name: 'Meta B' }));
    const t = await ok(
      post(s.owner, '/transfers', {
        transactionDate: '2026-10-16',
        fromAccountId: s.banco,
        toAccountId: s.ahorro,
        amount: bob('200.00'),
      }),
    );
    const results = await Promise.all([
      post(s.owner, `/goals/${a['id']}/contributions/link`, { transactionId: t['id'] }),
      post(s.owner, `/goals/${b['id']}/contributions/link`, { transactionId: t['id'] }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body['code']).toBe('GOAL_TRANSACTION_ALREADY_LINKED');
    expect(await count(s.owner, 'goals.goal_movement', "movement = 'CONTRIBUTION'")).toBe(1);
  });
});
