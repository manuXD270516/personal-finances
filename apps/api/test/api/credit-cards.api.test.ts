/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import {
  commitmentsEventConsumers,
  createCommitmentsRuntime,
} from '@pf/commitments/interface/commitments.module';
import { debtEventConsumers, runCardDaily, type CardsRuntime } from '@pf/debt/interface/debt.module';
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
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Tarjetas de crédito por HTTP contra PostgreSQL real (openspec add-credit-cards, tareas 5.2 y 5.3): registro y
// validaciones, bimoneda y límite compartido, plan de pago administrado visto desde Pagos recurrentes, emisión del
// estado de cuenta con el job `debt.card-daily` (pf_worker, reloj fijo en America/La_Paz), montos del banco, cuotas,
// comprometido y próximos pagos, pago como transferencia (no es gasto), roles, auditoría y aislamiento. Las respuestas
// se validan contra el OpenAPI. Cada escenario usa su propio workspace (el reloj se mueve hacia delante en cada uno).
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const contract = ApiContract.fromFile(resolveContractPath());
const clock = new FixedClock(Instant.parse('2026-10-20T16:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const workerLog = capturingLogger('finance-worker', 'worker');
const apiErrors = () =>
  JSON.stringify(apiLog.records().filter((r) => Number(r['level']) >= 50 || r['level'] === 'error'));

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
let worker: Pool;
let cards: CardsRuntime;
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
const get = (u: User, path: string, headers: Record<string, string> = {}) =>
  call('GET', `${W(u)}${path}`, { token: u.token, headers });
const withVersion = (u: User, method: string, path: string, body: unknown, version: number) =>
  call(method, `${W(u)}${path}`, { token: u.token, body, headers: { 'if-match': `"${version}"` } });
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

const money = (amount: string, currency = 'BOB') => ({ amount, currency });
const bob = (amount: string) => money(amount);
const setDay = (date: string) => clock.set(Instant.parse(`${date}T16:00:00Z`));

// ───────────────────────────────────────────── acceso al worker (pf_worker) y hechos

async function outboxOf(ws: string, eventType: string): Promise<EventEnvelope[]> {
  const { rows } = await worker.query<{ envelope: EventEnvelope }>(
    'SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = $2 ORDER BY sequence',
    [ws, eventType],
  );
  return rows.map((r) => r.envelope);
}

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
      actor_user_id: string | null;
      changes: { field: string; before: unknown; after: unknown }[];
    }>(
      `SELECT action, aggregate_type, aggregate_id::text, actor_user_id::text, changes
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

/** Job `debt.card-daily` de UN workspace con el actor de proceso (como el worker real). */
const runDaily = (ws: string) =>
  runCardDaily(cards.daily, { list: async () => [{ workspaceId: ws }] }, workerLog.logger, 'manual');

async function postingCount(u: User): Promise<number> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, async () => {
      const { rows } = await app.query<{ n: string }>(
        `SELECT count(*) AS n FROM ledger.posting WHERE workspace_id = $1`,
        [u.ws],
      );
      return Number(rows[0]!.n);
    });
  } finally {
    await app.end();
  }
}

// ───────────────────────────────────────────── escenarios

interface Scenario {
  owner: User;
  editor: User;
  viewer: User;
  bank: string;
  category: string;
}

async function scenario(label: string, bankBalance = '5000.00'): Promise<Scenario> {
  const owner = await user(`kc-cards-${label}-${randomUUID()}`);
  const editor = await join(owner, await user(`kc-cards-${label}-ed-${randomUUID()}`), 'EDITOR');
  const viewer = await join(owner, await user(`kc-cards-${label}-vw-${randomUUID()}`), 'VIEWER');
  const bank = await account(owner, 'Banco BOB', 'BANK', 'BOB', bankBalance);
  const group = await ok(post(owner, '/category-groups', { name: `Compras ${label}`, kind: 'EXPENSE' }));
  const category = await ok(post(owner, '/categories', { groupId: group['id'], name: `Tienda ${label}` }));
  await ok(post(owner, '/periods', { through: '2027-03-31' }), 200);
  return { owner, editor, viewer, bank, category: category['id'] as string };
}

async function account(
  u: User,
  name: string,
  type: string,
  currency: string,
  opening: string,
  date = '2026-09-01',
): Promise<string> {
  const r = await ok(
    post(u, '/accounts', {
      name,
      type,
      currency,
      openingBalance: { amount: money(opening, currency), date },
    }),
  );
  return r['id'] as string;
}
const visaAccount = (u: User, name: string, currency = 'BOB', owed = '1200.00') =>
  account(u, name, 'CREDIT_CARD', currency, owed);

const percent5 = { type: 'PERCENT', percent: '5.00', floor: bob('50.00') };

const cardBody = (over: Record<string, unknown> = {}) => ({
  name: 'Visa Oro',
  statementDay: 25,
  dueDay: 15,
  ...over,
});

async function registerCard(u: User, over: Record<string, unknown>) {
  const r = await post(u, '/credit-cards', cardBody(over));
  return checked('createCreditCard', 201, r);
}
const cardOf = async (u: User, id: string) =>
  checked('getCreditCard', 200, await get(u, `/credit-cards/${id}`));
const statementsOf = async (u: User, id: string, query = '') =>
  checked('listCardStatements', 200, await get(u, `/credit-cards/${id}/statements${query}`))['data'] as any[];

async function spend(
  s: Scenario,
  accountId: string,
  amount: string,
  date: string,
  over: Record<string, unknown> = {},
  currency = 'BOB',
) {
  const created = await ok(
    post(s.owner, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: date,
      accountId,
      amount: money(amount, currency),
      splits: [{ amount: money(amount, currency), categoryId: s.category }],
      ...over,
    }),
  );
  return created['id'] as string;
}

async function transfer(s: Scenario, from: string, to: string, amount: string, date: string) {
  const created = await ok(
    post(s.owner, '/transfers', {
      transactionDate: date,
      fromAccountId: from,
      toAccountId: to,
      amount: bob(amount),
    }),
  );
  return created;
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
  cards = finance.cards;
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
  const defs = [...commitmentsEventConsumers(commitments), ...debtEventConsumers(finance.cards)];
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

// ───────────────────────────────────────────── registro

describe('registro de la tarjeta (debt/credit-cards)', () => {
  let s: Scenario;
  beforeAll(async () => {
    setDay('2026-10-20');
    s = await scenario('reg');
  }, 120_000);

  it('[TC-DEBT-CARD-001] registrar una tarjeta en BOB no crea asientos y la cuenta conserva su deuda', async () => {
    const visa = await visaAccount(s.owner, 'Visa Oro BOB', 'BOB', '1200.00');
    const before = await postingCount(s.owner);
    const card = await registerCard(s.owner, {
      accounts: [{ accountId: visa, creditLimit: bob('10000.00'), minimumRule: percent5 }],
    });
    expect(card).toMatchObject({ name: 'Visa Oro', status: 'ACTIVE', statementDay: 25, dueDay: 15 });
    expect(card['accounts'][0]).toMatchObject({ accountId: visa, balance: bob('1200.00') });
    expect(card['accounts'][0].creditLimit).toEqual(bob('10000.00'));
    expect(await postingCount(s.owner)).toBe(before);
    const audits = await auditOf(s.owner.ws, `aggregate_id = $1`, [card['id']]);
    expect(audits.map((a) => a.action)).toContain('debt.credit_card.created');
  });

  it('[TC-DEBT-CARD-002] cuenta inválida, cuenta ya vinculada y día de cierre fuera de rango se rechazan', async () => {
    const visa = await visaAccount(s.owner, 'Visa Plata BOB', 'BOB', '300.00');
    const before = (checked('listCreditCards', 200, await get(s.owner, '/credit-cards'))['data'] as any[])
      .length;
    // A: una cuenta de banco no es de tarjeta.
    problem(
      await post(
        s.owner,
        '/credit-cards',
        cardBody({ accounts: [{ accountId: s.bank, minimumRule: percent5, creditLimit: bob('100.00') }] }),
      ),
      422,
      'CREDIT_CARD_ACCOUNT_INVALID',
    );
    // B: la cuenta ya vinculada a otra tarjeta activa.
    const first = await registerCard(s.owner, {
      name: 'Visa Plata',
      accounts: [{ accountId: visa, creditLimit: bob('5000.00'), minimumRule: percent5 }],
    });
    problem(
      await post(
        s.owner,
        '/credit-cards',
        cardBody({
          name: 'Otra Visa',
          accounts: [{ accountId: visa, creditLimit: bob('5000.00'), minimumRule: percent5 }],
        }),
      ),
      409,
      'CREDIT_CARD_ACCOUNT_IN_USE',
    );
    // C: día 32. El TC dice 422, pero el catálogo de errores manda 400 VALIDATION_FAILED (el esquema del contrato).
    const free = await visaAccount(s.owner, 'Visa Libre BOB', 'BOB', '0.00');
    problem(
      await post(
        s.owner,
        '/credit-cards',
        cardBody({
          name: 'Dia 32',
          statementDay: 32,
          accounts: [{ accountId: free, creditLimit: bob('5000.00'), minimumRule: percent5 }],
        }),
      ),
      400,
      'VALIDATION_FAILED',
    );
    const after = checked('listCreditCards', 200, await get(s.owner, '/credit-cards'))['data'] as any[];
    expect(after.map((c) => c.id)).toContain(first['id']);
    expect(after).toHaveLength(before + 1);
  });

  it('[TC-DEBT-CARD-003] una tarjeta bimoneda informa un estado de cuenta por moneda en el ciclo del 2026-10-25', async () => {
    const bobAcc = await visaAccount(s.owner, 'Bimoneda BOB', 'BOB', '100.00');
    const usdAcc = await visaAccount(s.owner, 'Bimoneda USD', 'USD', '50.00');
    const card = await registerCard(s.owner, {
      name: 'Visa Bimoneda',
      accounts: [
        { accountId: bobAcc, creditLimit: bob('10000.00'), minimumRule: percent5 },
        {
          accountId: usdAcc,
          creditLimit: money('2000.00', 'USD'),
          minimumRule: { type: 'FIXED', amount: money('25.00', 'USD') },
        },
      ],
    });
    expect(card['accounts']).toHaveLength(2);
    const cycle = (await statementsOf(s.owner, card['id'])).filter((x) => x.closingDate === '2026-10-25');
    expect(cycle.map((x) => x.currency).sort()).toEqual(['BOB', 'USD']);
    expect(new Set(cycle.map((x) => x.dueDate))).toEqual(new Set(['2026-11-15']));
  });

  it('[TC-DEBT-CARD-004] el límite compartido se acepta en la moneda de una cuenta y se rechaza en una ajena', async () => {
    const bobAcc = await visaAccount(s.owner, 'Compartida BOB', 'BOB', '0.00');
    const usdAcc = await visaAccount(s.owner, 'Compartida USD', 'USD', '0.00');
    const accounts = [
      { accountId: bobAcc, minimumRule: percent5 },
      { accountId: usdAcc, minimumRule: { type: 'FIXED', amount: money('25.00', 'USD') } },
    ];
    problem(
      await post(
        s.owner,
        '/credit-cards',
        cardBody({
          name: 'Compartida USDT',
          limitMode: 'SHARED',
          sharedLimit: money('10000.00', 'USDT'),
          accounts,
        }),
      ),
      400,
      'VALIDATION_FAILED',
    );
    const card = await registerCard(s.owner, {
      name: 'Compartida',
      limitMode: 'SHARED',
      sharedLimit: bob('10000.00'),
      accounts,
    });
    expect(card).toMatchObject({ limitMode: 'SHARED', sharedLimit: bob('10000.00') });
  });
});

// ───────────────────────────────────────────── plan de pago, emisión y pago

interface Occ {
  id: string;
  occurrenceDate: string;
  status: string;
  version: number;
  transactionId: string | null;
  skipReason: string | null;
  cancelReason: string | null;
  kind: string;
  managedBy: string;
  expected: { type: string; amount?: { amount: string; currency: string } };
}
const occurrencesOf = async (u: User, definitionId: string): Promise<Occ[]> =>
  checked('listDefinitionOccurrences', 200, await get(u, `/recurring/${definitionId}/occurrences?limit=200`))[
    'data'
  ] as Occ[];
const occOn = async (u: User, definitionId: string, date: string) =>
  (await occurrencesOf(u, definitionId)).find((o) => o.occurrenceDate === date)!;
const definitionOf = async (u: User, id: string) =>
  checked('getRecurringDefinition', 200, await get(u, `/recurring/${id}`));

/** Lo que la Home muestra del mes: ingresos, gastos y ahorro (sin saldos: el pago sí mueve saldos). */
const monthFlows = async (u: User, month: string) => {
  const body = checked('getReportSummary', 200, await get(u, `/reports/summary?month=${month}`));
  const flows = (t: Record<string, any>) => ({
    income: t['income'],
    expense: t['expense'],
    net: t['net'],
    savingsRate: t['savingsRate'],
  });
  return {
    byCurrency: (body['byCurrency'] as Record<string, any>[]).map((t) => ({
      currency: t['currency'],
      ...flows(t),
    })),
    consolidated: flows(body['consolidated']),
    topExpenseCategories: body['topExpenseCategories'],
  };
};

describe('plan de pago administrado, estado de cuenta y pago (debt/credit-cards)', () => {
  let s: Scenario;
  let visa: string;
  let card: any;
  let definitionId: string;
  const statementOf = async (closing: string) =>
    (await statementsOf(s.owner, card.id)).find((x) => x.closingDate === closing && x.accountId === visa);

  beforeAll(async () => {
    setDay('2026-10-20');
    s = await scenario('plan');
    visa = await visaAccount(s.owner, 'Visa Oro BOB', 'BOB', '1000.00');
    await spend(s, visa, '120.50', '2026-10-12');
    card = await registerCard(s.owner, {
      accounts: [
        {
          accountId: visa,
          creditLimit: bob('10000.00'),
          minimumRule: percent5,
          paymentPlan: { sourceAccountId: s.bank },
        },
      ],
    });
    definitionId = card.accounts[0].paymentPlan.definitionId;
  }, 180_000);

  it('[TC-DEBT-CARD-017] el plan es una definición CARD_PAYMENT de DEBT mensual el día 15, con el monto estimado antes del cierre', async () => {
    const def = await definitionOf(s.owner, definitionId);
    expect(def).toMatchObject({
      kind: 'CARD_PAYMENT',
      managedBy: 'DEBT',
      managedRef: card.accounts[0].id,
      name: 'Pago de tarjeta · Visa Oro',
      status: 'ACTIVE',
    });
    expect(def['current'].accountId).toBe(s.bank);
    expect(def['current'].toAccountId).toBe(visa);
    expect(def['current'].schedule).toMatchObject({ cadence: 'MONTHLY', monthDays: [15] });
    const listed = checked('listRecurringDefinitions', 200, await get(s.owner, '/recurring'))[
      'data'
    ] as any[];
    expect(listed.map((d) => d.id)).toContain(definitionId);
    // Ciclo abierto (cierra el 2026-10-25): estimado con el saldo de hoy.
    const nov = await occOn(s.owner, definitionId, '2026-11-15');
    expect(nov.expected).toEqual({ type: 'ESTIMATED', amount: bob('1120.50') });
    expect(nov.status).toBe('SCHEDULED');
  });

  it('[TC-DEBT-CARD-029] el usuario no crea CARD_PAYMENT ni pausa la definición administrada', async () => {
    problem(
      await post(s.owner, '/recurring', {
        name: 'Pago tarjeta manual',
        kind: 'CARD_PAYMENT',
        template: {
          accountId: s.bank,
          toAccountId: visa,
          amount: { type: 'VARIABLE' },
          schedule: { cadence: 'MONTHLY', startDate: '2026-11-15' },
          materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
        },
      }),
      422,
      'RECURRING_KIND_NOT_AVAILABLE',
    );
    const def = await definitionOf(s.owner, definitionId);
    problem(
      await post(s.owner, `/recurring/${definitionId}/pause`, undefined, {
        'if-match': `"${def['version']}"`,
      }),
      409,
      'RECURRING_MANAGED_EXTERNALLY',
    );
    expect((await definitionOf(s.owner, definitionId))['status']).toBe('ACTIVE');
  });

  it('[TC-DEBT-CARD-017] [TC-DEBT-CARD-013] al cerrar el ciclo el job emite una sola vez y la ocurrencia espera el monto exacto', async () => {
    setDay('2026-10-26');
    const first = await runDaily(s.owner.ws);
    expect(first).toMatchObject({ issued: 1, failed: 0 });
    const st = (await statementOf('2026-10-25'))!;
    expect(st).toMatchObject({ status: 'ISSUED', dueDate: '2026-11-15', cycleStart: '2026-09-26' });
    expect(st.id).toEqual(expect.any(String));
    expect(st.issued).toMatchObject({
      previousBalance: bob('1000.00'),
      purchases: bob('120.50'),
      closingBalance: bob('1120.50'),
      billedBalance: bob('1120.50'),
      minimumDue: bob('56.02'),
      noInterestPayment: bob('1120.50'),
    });
    expect(st.remainingNoInterest).toEqual(bob('1120.50'));
    const nov = await occOn(s.owner, definitionId, '2026-11-15');
    expect(nov.expected).toEqual({ type: 'FIXED', amount: bob('1120.50') });
    const issuedEvents = await outboxOf(s.owner.ws, 'debt.CardStatementIssued');
    expect(issuedEvents).toHaveLength(1);
    expect(issuedEvents[0]!.payload).toMatchObject({ closingDate: '2026-10-25', dueDate: '2026-11-15' });
    // Repetir el job no emite otra vez ni cambia el monto.
    expect(await runDaily(s.owner.ws)).toMatchObject({ issued: 0, failed: 0 });
    expect(await outboxOf(s.owner.ws, 'debt.CardStatementIssued')).toHaveLength(1);
  });

  it('[TC-DEBT-CARD-014] los montos del banco sustituyen a los calculados y se pueden borrar; el VIEWER no los registra', async () => {
    const st = (await statementOf('2026-10-25'))!;
    const path = `/credit-cards/${card.id}/statements/${st.id}`;
    const denied = await withVersion(
      s.viewer,
      'PATCH',
      path,
      { reportedBilledBalance: bob('1125.30') },
      st.version,
    );
    problem(denied, 403, 'INSUFFICIENT_ROLE');
    const patched = checked(
      'updateCardStatement',
      200,
      await withVersion(
        s.owner,
        'PATCH',
        path,
        { reportedBilledBalance: bob('1125.30'), reportedMinimumDue: bob('56.30') },
        st.version,
      ),
    );
    expect(patched['reported']).toEqual({ billedBalance: bob('1125.30'), minimumDue: bob('56.30') });
    expect(patched['reportedDifference']).toEqual(bob('4.80'));
    expect(patched['remainingNoInterest']).toEqual(bob('1125.30'));
    expect(patched['minimumDue']).toEqual(bob('56.30'));
    // Con los montos del banco el plan espera lo que falta según el banco.
    expect((await occOn(s.owner, definitionId, '2026-11-15')).expected).toEqual({
      type: 'FIXED',
      amount: bob('1125.30'),
    });
    const cleared = checked(
      'updateCardStatement',
      200,
      await withVersion(
        s.owner,
        'PATCH',
        path,
        { reportedBilledBalance: null, reportedMinimumDue: null },
        patched['version'],
      ),
    );
    expect(cleared['reported']).toEqual({ billedBalance: null, minimumDue: null });
    expect(cleared['remainingNoInterest']).toEqual(bob('1120.50'));
    expect((await occOn(s.owner, definitionId, '2026-11-15')).expected).toEqual({
      type: 'FIXED',
      amount: bob('1120.50'),
    });
  });

  it('[TC-DEBT-CARD-015] [TC-DEBT-CARD-029] pagar con una transferencia deja PAID, no cambia gastos ni ahorro y se sugiere sin vincular', async () => {
    setDay('2026-11-14');
    const before = await monthFlows(s.owner, '2026-11');
    const paid = await transfer(s, s.bank, visa, '1120.50', '2026-11-14');
    // El matcher del worker propone la ocurrencia del plan (sin vincularla).
    const created = (await outboxOf(s.owner.ws, 'transactions.TransactionCreated')).find(
      (e) => (e.payload as { transactionId?: string }).transactionId === paid['id'],
    )!;
    expect(await deliver('commitments.occurrence-matcher', created)).toBe('applied');
    const suggestions = checked(
      'listMatchSuggestions',
      200,
      await get(s.owner, `/recurring/match-suggestions?limit=50&transactionId=${paid['id']}`),
    )['data'] as any[];
    const nov = await occOn(s.owner, definitionId, '2026-11-15');
    expect(suggestions.map((x) => x.occurrence?.id)).toContain(nov.id);
    expect(nov).toMatchObject({ status: 'SCHEDULED', transactionId: null });
    // Estado de cuenta pagado; los gastos y el ahorro del mes no cambian.
    const st = (await statementOf('2026-10-25'))!;
    expect(st.status).toBe('PAID');
    expect(st.remainingNoInterest).toEqual(bob('0.00'));
    expect(await monthFlows(s.owner, '2026-11')).toEqual(before);
    // Pagado fuera del plan: la red de seguridad del job omite la ocurrencia ("nada que pagar").
    await runDaily(s.owner.ws);
    const after = await occOn(s.owner, definitionId, '2026-11-15');
    expect(after).toMatchObject({ status: 'SKIPPED', skipReason: 'STATEMENT_PAID', transactionId: null });
  });
  it('[TC-DEBT-CARD-013] una compra con fecha del ciclo registrada después del cierre cambia lo recalculado, no lo emitido, y no republica la emisión', async () => {
    await spend(s, visa, '45.00', '2026-10-24');
    const st = (await statementOf('2026-10-25'))!;
    expect(st.issued.billedBalance).toEqual(bob('1120.50'));
    expect(st.current.billedBalance).toEqual(bob('1165.50'));
    expect(st.current.purchases).toEqual(bob('165.50'));
    expect(st.current.minimumDue).toEqual(bob('58.28'));
    expect(st.difference.billedBalance).toEqual(bob('45.00'));
    expect(st.difference.purchases).toEqual(bob('45.00'));
    expect(st.status).toBe('ISSUED');
    expect(st.remainingNoInterest).toEqual(bob('45.00'));
    expect(await runDaily(s.owner.ws)).toMatchObject({ issued: 0, failed: 0 });
    expect(await outboxOf(s.owner.ws, 'debt.CardStatementIssued')).toHaveLength(1);
  });
});

// ───────────────────────────────────────────── cuotas

describe('cuotas, utilización y calendario de cargos futuros (debt/credit-cards)', () => {
  let s: Scenario;
  let visa: string;
  let card: any;
  let definitionId: string;
  let laptop: string;
  let plan: any;

  beforeAll(async () => {
    setDay('2026-10-12');
    s = await scenario('cuotas');
    visa = await visaAccount(s.owner, 'Visa Oro BOB', 'BOB', '0.00');
    laptop = await spend(s, visa, '1000.00', '2026-10-12', { description: 'Laptop' });
    card = await registerCard(s.owner, {
      accounts: [
        {
          accountId: visa,
          creditLimit: bob('10000.00'),
          minimumRule: percent5,
          paymentPlan: { sourceAccountId: s.bank },
        },
      ],
    });
    definitionId = card.accounts[0].paymentPlan.definitionId;
  }, 180_000);

  it('[TC-DEBT-CARD-022] una compra de 1000.00 en 3 cuotas sin interés da 333.33, 333.33 y 333.34; un gasto de otra cuenta se rechaza', async () => {
    const elsewhere = await spend(s, s.bank, '80.00', '2026-10-12');
    problem(
      await post(s.owner, `/credit-cards/${card.id}/installment-plans`, {
        purchaseTransactionId: elsewhere,
        installmentCount: 3,
      }),
      422,
      'INSTALLMENT_PLAN_INVALID',
    );
    plan = checked(
      'createCardInstallmentPlan',
      201,
      await post(s.owner, `/credit-cards/${card.id}/installment-plans`, {
        purchaseTransactionId: laptop,
        installmentCount: 3,
      }),
    );
    expect(plan).toMatchObject({
      status: 'ACTIVE',
      principal: bob('1000.00'),
      installmentCount: 3,
      purchaseTransactionId: laptop,
    });
    expect(plan.installments.map((i: any) => i.principal.amount)).toEqual(['333.33', '333.33', '333.34']);
    expect(plan.installments.map((i: any) => i.interest.amount)).toEqual(['0.00', '0.00', '0.00']);
    expect(plan.installments.map((i: any) => i.billingClosingDate)).toEqual([
      '2026-10-25',
      '2026-11-25',
      '2026-12-25',
    ]);
    const listed = checked(
      'listCardInstallmentPlans',
      200,
      await get(s.owner, `/credit-cards/${card.id}/installment-plans`),
    );
    expect((listed['data'] as any[]).map((p) => p.id)).toEqual([plan.id]);
    // Una compra con plan activo no admite otro.
    problem(
      await post(s.owner, `/credit-cards/${card.id}/installment-plans`, {
        purchaseTransactionId: laptop,
        installmentCount: 2,
      }),
      422,
      'INSTALLMENT_PLAN_INVALID',
    );
  });

  it('[TC-DEBT-CARD-024] al cerrar el ciclo del 2026-10-25 el saldo facturado es 333.33 y la utilización 10.00 %', async () => {
    setDay('2026-10-26');
    expect(await runDaily(s.owner.ws)).toMatchObject({ issued: 1, failed: 0 });
    const statements = await statementsOf(s.owner, card.id);
    const st = statements.find((x) => x.closingDate === '2026-10-25')!;
    expect(st.issued).toMatchObject({
      closingBalance: bob('1000.00'),
      unbilledInstallments: bob('666.67'),
      billedBalance: bob('333.33'),
      noInterestPayment: bob('333.33'),
    });
    const view = await cardOf(s.owner, card.id);
    expect(view['accounts'][0].utilization).toMatchObject({ utilization: '10.00', used: bob('1000.00') });
    // El plan de pago espera exactamente lo facturado.
    expect((await occOn(s.owner, definitionId, '2026-11-15')).expected).toEqual({
      type: 'FIXED',
      amount: bob('333.33'),
    });
  });

  it('[TC-DEBT-CARD-033] [TC-DEBT-CARD-024] la segunda cuota aparece en los próximos 60 días como estimado por cuotas y en el calendario de cargos futuros', async () => {
    setDay('2026-11-01');
    const upcoming = checked(
      'getUpcomingPayments',
      200,
      await get(s.owner, '/reports/upcoming-payments?days=60'),
    );
    const items = upcoming['items'] as any[];
    const second = items.find((i) => i.name === 'Pago de tarjeta · Visa Oro' && i.date === '2026-12-15');
    expect(second, JSON.stringify(items)).toBeDefined();
    expect(second.amount).toEqual(bob('333.33'));
    expect(second.amountType).toBe('ESTIMATED');
    const charges = checked(
      'getCardFutureCharges',
      200,
      await get(s.owner, `/credit-cards/${card.id}/future-charges?months=6`),
    )['data'] as any[];
    expect(charges.map((c) => [c.dueDate, c.total.amount])).toEqual([
      ['2026-12-15', '333.33'],
      ['2027-01-15', '333.34'],
    ]);
  });

  it('[TC-DEBT-CARD-025] al anular la compra el plan queda cancelado y el calendario ya no lista sus cuotas', async () => {
    const tx = checked('getTransaction', 200, await get(s.owner, `/transactions/${laptop}`));
    const voided = await post(
      s.owner,
      `/transactions/${laptop}/void`,
      { reason: 'devuelta' },
      { 'if-match': `"${tx['version']}"` },
    );
    expect(voided.status, voided.text).toBe(200);
    const event = (await outboxOf(s.owner.ws, 'transactions.TransactionVoided')).find(
      (e) => (e.payload as { transactionId?: string }).transactionId === laptop,
    )!;
    expect(await deliver('debt.card-activity', event)).toBe('applied');
    const cancelled = (
      checked(
        'listCardInstallmentPlans',
        200,
        await get(s.owner, `/credit-cards/${card.id}/installment-plans`),
      )['data'] as any[]
    )[0];
    expect(cancelled).toMatchObject({ id: plan.id, status: 'CANCELLED', cancelReason: 'PURCHASE_VOIDED' });
    const charges = checked(
      'getCardFutureCharges',
      200,
      await get(s.owner, `/credit-cards/${card.id}/future-charges?months=6`),
    )['data'] as any[];
    expect(charges).toEqual([]);
    // Las cuotas ya facturadas siguen en el estado emitido, que conserva sus cifras.
    const st = (await statementsOf(s.owner, card.id)).find((x) => x.closingDate === '2026-10-25')!;
    expect(st.issued.billedBalance).toEqual(bob('333.33'));
    // El plan de pago deja de estimar por cuotas el ciclo del 2026-12-15.
    expect((await occOn(s.owner, definitionId, '2026-12-15')).expected.type).not.toBe('FIXED');
  });
});

// ───────────────────────────────────────────── comprometido y próximos pagos

describe('el pago de la tarjeta en el comprometido y en los próximos pagos (debt/credit-cards)', () => {
  let s: Scenario;
  let visa: string;
  let card: any;

  beforeAll(async () => {
    // El 2026-10-26 el ciclo del 10-25 ya cerró: el registro emite el estado y el plan espera el monto exacto.
    setDay('2026-10-26');
    s = await scenario('comprometido');
    visa = await visaAccount(s.owner, 'Visa Oro BOB', 'BOB', '1000.00');
    await spend(s, visa, '120.50', '2026-10-12');
    card = await registerCard(s.owner, {
      accounts: [
        {
          accountId: visa,
          creditLimit: bob('10000.00'),
          minimumRule: percent5,
          paymentPlan: { sourceAccountId: s.bank },
        },
      ],
    });
    await ok(
      post(s.owner, '/recurring', {
        name: 'Internet',
        kind: 'EXPENSE',
        template: {
          accountId: s.bank,
          amount: { type: 'FIXED', amount: bob('199.00') },
          categoryId: s.category,
          schedule: { cadence: 'MONTHLY', startDate: '2026-11-20' },
          materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
        },
      }),
    );
    setDay('2026-11-01');
  }, 180_000);

  it('[TC-DEBT-CARD-032] los próximos 30 días del 2026-11-01 listan "Pago de tarjeta · Visa Oro" por 1120.50 BOB', async () => {
    const upcoming = checked(
      'getUpcomingPayments',
      200,
      await get(s.owner, '/reports/upcoming-payments?days=30'),
    );
    const items = upcoming['items'] as any[];
    const pay = items.find((i) => i.name === 'Pago de tarjeta · Visa Oro');
    expect(pay, JSON.stringify(items)).toBeDefined();
    expect(pay).toMatchObject({ date: '2026-11-15', amount: bob('1120.50'), amountType: 'FIXED' });
  });

  it('[TC-DEBT-CARD-031] el comprometido de noviembre suma el pago de la tarjeta (1120.50) y el Internet (199.00): 1319.50 BOB', async () => {
    const period = (
      checked('listPeriods', 200, await get(s.owner, '/periods?containsDate=2026-11-15'))['data'] as any[]
    )[0];
    expect(period.label).toBe('2026-11');
    const committed = checked(
      'getCommittedAmount',
      200,
      await get(s.owner, `/recurring/committed?periodId=${period.id}`),
    );
    expect(committed['consolidated']).toMatchObject({ amount: bob('1319.50'), complete: true });
    expect(committed['byCurrency']).toEqual([
      { currency: 'BOB', occurrences: bob('1319.50'), pending: bob('0.00'), total: bob('1319.50') },
    ]);
    const names = (committed['items'] as any[]).map((i) => i.name ?? i.definitionName);
    expect(names).toEqual(expect.arrayContaining(['Pago de tarjeta · Visa Oro', 'Internet']));
    expect(card['id']).toBeDefined();
  });
});

// ───────────────────────────────────────────── conflicto con la transferencia del usuario y archivo

describe('el plan frente a la transferencia recurrente del usuario y el archivo de la tarjeta (debt/credit-cards)', () => {
  let s: Scenario;
  let visa: string;
  let card: any;
  let payVisa: { id: string; version: number };
  const accountsBody = () => [{ accountId: visa, creditLimit: bob('10000.00'), minimumRule: percent5 }];

  beforeAll(async () => {
    setDay('2026-10-20');
    s = await scenario('conflicto');
    visa = await visaAccount(s.owner, 'Visa Oro BOB', 'BOB', '1000.00');
    const created = await ok(
      post(s.owner, '/recurring', {
        name: 'Pago Visa',
        kind: 'TRANSFER',
        template: {
          accountId: s.bank,
          toAccountId: visa,
          categoryId: null,
          amount: { type: 'FIXED', amount: bob('500.00') },
          schedule: { cadence: 'MONTHLY', startDate: '2026-11-15' },
          materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
        },
      }),
    );
    payVisa = { id: created['id'] as string, version: Number(created['version']) };
  }, 180_000);

  it('[TC-DEBT-CARD-018] registrar con plan ante una transferencia activa del usuario registra la tarjeta sin plan e informa el conflicto', async () => {
    card = checked(
      'createCreditCard',
      201,
      await post(
        s.owner,
        '/credit-cards',
        cardBody({ accounts: [{ ...accountsBody()[0], paymentPlan: { sourceAccountId: s.bank } }] }),
      ),
    );
    expect(card['accounts'][0].paymentPlan).toBeNull();
    expect(card['paymentPlanConflicts']).toEqual([
      {
        accountId: visa,
        conflictingDefinitions: [{ definitionId: payVisa.id, name: 'Pago Visa' }],
      },
    ]);
  });

  it('[TC-DEBT-CARD-018] [TC-DEBT-CARD-029] activar el plan se rechaza con CARD_PAYMENT_PLAN_CONFLICT y "Pago Visa" sigue TRANSFER del usuario', async () => {
    const r = await withVersion(
      s.owner,
      'PUT',
      `/credit-cards/${card.id}/accounts/${visa}/payment-plan`,
      { sourceAccountId: s.bank },
      card.version,
    );
    problem(r, 409, 'CARD_PAYMENT_PLAN_CONFLICT');
    expect(r.body['details']).toEqual({
      conflictingDefinitions: [{ definitionId: payVisa.id, name: 'Pago Visa' }],
    });
    const def = await definitionOf(s.owner, payVisa.id);
    expect(def).toMatchObject({ kind: 'TRANSFER', managedBy: 'USER', status: 'ACTIVE' });
    expect((await cardOf(s.owner, card.id)).accounts[0].paymentPlan).toBeNull();
  });

  it('[TC-DEBT-CARD-018] tras terminar "Pago Visa" el plan se activa como CARD_PAYMENT administrado por DEBT', async () => {
    const def = await definitionOf(s.owner, payVisa.id);
    const ended = await post(
      s.owner,
      `/recurring/${payVisa.id}/end`,
      {},
      { 'if-match': `"${def['version']}"` },
    );
    expect(ended.status, ended.text).toBe(200);
    const current = await cardOf(s.owner, card.id);
    const enabled = checked(
      'enableCardPaymentPlan',
      200,
      await withVersion(
        s.owner,
        'PUT',
        `/credit-cards/${card.id}/accounts/${visa}/payment-plan`,
        { sourceAccountId: s.bank },
        current['version'],
      ),
    );
    const plan = enabled['accounts'][0].paymentPlan;
    expect(plan).toMatchObject({ sourceAccountId: s.bank, policy: 'NO_INTEREST' });
    expect(await definitionOf(s.owner, plan.definitionId)).toMatchObject({
      kind: 'CARD_PAYMENT',
      managedBy: 'DEBT',
      status: 'ACTIVE',
    });
    // La definición del usuario ya terminada no se reactiva ni cambia de dueño.
    expect(await definitionOf(s.owner, payVisa.id)).toMatchObject({ kind: 'TRANSFER', managedBy: 'USER' });
  });

  it('[TC-DEBT-CARD-027] archivar la tarjeta termina el plan, conserva el saldo de la cuenta y libera la cuenta', async () => {
    const current = await cardOf(s.owner, card.id);
    const planId = current['accounts'][0].paymentPlan.definitionId;
    const archived = checked(
      'archiveCreditCard',
      200,
      await withVersion(
        s.owner,
        'POST',
        `/credit-cards/${card.id}/archive`,
        undefined as unknown,
        current['version'],
      ),
    );
    expect(archived['status']).toBe('ARCHIVED');
    expect(archived['accounts'][0].balance).toEqual(bob('1000.00'));
    const def = await definitionOf(s.owner, planId);
    expect(def['status']).toBe('ENDED');
    const open = (await occurrencesOf(s.owner, planId)).filter((o) =>
      ['SCHEDULED', 'DUE', 'OVERDUE'].includes(o.status),
    );
    expect(open).toEqual([]);
    // La cuenta queda libre para una tarjeta nueva.
    const again = await post(
      s.owner,
      '/credit-cards',
      cardBody({ name: 'Visa Oro 2', accounts: accountsBody() }),
    );
    checked('createCreditCard', 201, again);
  });
});

// ───────────────────────────────────────────── permisos, auditoría, idempotencia y aislamiento

describe('permisos, auditoría y aislamiento de las tarjetas (debt/credit-cards)', () => {
  let s: Scenario;
  let outsider: User;
  let visa: string;
  let card: any;

  beforeAll(async () => {
    setDay('2026-10-20');
    s = await scenario('roles');
    outsider = await user(`kc-cards-out-${randomUUID()}`);
    visa = await visaAccount(s.owner, 'Visa Oro BOB', 'BOB', '1200.00');
    card = await registerCard(s.owner, {
      accounts: [{ accountId: visa, creditLimit: bob('10000.00'), minimumRule: percent5 }],
    });
  }, 180_000);

  it('[TC-DEBT-CARD-028] un VIEWER consulta pero no registra, edita ni archiva: INSUFFICIENT_ROLE', async () => {
    expect((await get(s.viewer, '/credit-cards')).status).toBe(200);
    expect((await get(s.viewer, `/credit-cards/${card.id}`)).status).toBe(200);
    const spare = await visaAccount(s.owner, 'Visa Plata BOB', 'BOB', '0.00');
    problem(
      await post(
        s.viewer,
        '/credit-cards',
        cardBody({
          name: 'Visa Plata',
          accounts: [{ accountId: spare, creditLimit: bob('100.00'), minimumRule: percent5 }],
        }),
      ),
      403,
      'INSUFFICIENT_ROLE',
    );
    problem(
      await withVersion(
        s.viewer,
        'PATCH',
        `/credit-cards/${card.id}`,
        { accounts: [{ accountId: visa, creditLimit: bob('12000.00') }] },
        card.version,
      ),
      403,
      'INSUFFICIENT_ROLE',
    );
    problem(
      await withVersion(
        s.viewer,
        'POST',
        `/credit-cards/${card.id}/archive`,
        undefined as unknown,
        card.version,
      ),
      403,
      'INSUFFICIENT_ROLE',
    );
    expect((await cardOf(s.owner, card.id)).accounts[0].creditLimit).toEqual(bob('10000.00'));
  });

  it('[TC-DEBT-CARD-028] el cambio de límite del EDITOR queda auditado con actor y diff 10000.00 → 12000.00 BOB', async () => {
    // Versión vencida: PRECONDITION_FAILED.
    problem(
      await withVersion(
        s.editor,
        'PATCH',
        `/credit-cards/${card.id}`,
        { accounts: [{ accountId: visa, creditLimit: bob('12000.00') }] },
        card.version + 5,
      ),
      412,
      'PRECONDITION_FAILED',
    );
    const updated = checked(
      'updateCreditCard',
      200,
      await withVersion(
        s.editor,
        'PATCH',
        `/credit-cards/${card.id}`,
        { accounts: [{ accountId: visa, creditLimit: bob('12000.00') }] },
        card.version,
      ),
    );
    expect(updated['accounts'][0].creditLimit).toEqual(bob('12000.00'));
    expect(updated['version']).toBeGreaterThan(card.version);
    const audits = (await auditOf(s.owner.ws, `aggregate_id = $1`, [card.id])).filter(
      (a) => a.action === 'debt.credit_card.updated',
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actor_user_id).toBe(s.editor.id);
    expect(audits[0]!.changes).toEqual([
      { field: 'creditLimit.BOB', before: bob('10000.00'), after: bob('12000.00') },
    ]);
  });

  it('[TC-DEBT-CARD-028] una tarjeta de otro workspace responde RESOURCE_NOT_FOUND', async () => {
    const theirs = await call('GET', `${W(outsider)}/credit-cards/${card.id}`, { token: outsider.token });
    problem(theirs, 404, 'RESOURCE_NOT_FOUND');
    problem(
      await call('PATCH', `${W(outsider)}/credit-cards/${card.id}`, {
        token: outsider.token,
        body: { name: 'Mía' },
        headers: { 'if-match': '"1"' },
      }),
      404,
      'RESOURCE_NOT_FOUND',
    );
    const listed = (
      checked('listCreditCards', 200, await get(outsider, '/credit-cards'))['data'] as any[]
    ).map((c) => c.id);
    expect(listed).not.toContain(card.id);
    // Y su propietario no puede usarla desde otro workspace.
    const bankOfOutsider = await account(outsider, 'Banco', 'BANK', 'BOB', '10.00');
    problem(
      await post(
        outsider,
        '/credit-cards',
        cardBody({
          name: 'Ajena',
          accounts: [{ accountId: visa, creditLimit: bob('1.00'), minimumRule: percent5 }],
        }),
      ),
      422,
      'CREDIT_CARD_ACCOUNT_INVALID',
    );
    expect(bankOfOutsider).toBeDefined();
  });

  it('el alta con la misma Idempotency-Key repite la respuesta y no crea otra tarjeta', async () => {
    const spare = await visaAccount(s.owner, 'Visa Idem BOB', 'BOB', '0.00');
    const key = randomUUID();
    const body = cardBody({
      name: 'Visa Idem',
      accounts: [{ accountId: spare, creditLimit: bob('500.00'), minimumRule: percent5 }],
    });
    const first = await post(s.owner, '/credit-cards', body, { 'idempotency-key': key });
    const second = await post(s.owner, '/credit-cards', body, { 'idempotency-key': key });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body['id']).toBe(first.body['id']);
    const names = (
      checked('listCreditCards', 200, await get(s.owner, '/credit-cards'))['data'] as any[]
    ).filter((c) => c.name === 'Visa Idem');
    expect(names).toHaveLength(1);
  });
});
