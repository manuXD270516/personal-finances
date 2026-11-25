/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import { runCardDaily, type CardsRuntime } from '@pf/debt/interface/debt.module';
import { identityWorkspaceTimeZones } from '@pf/identity/interface/identity.module';
import { ApiContract } from '@pf/platform/api';
import { PgOutboxWriter } from '@pf/platform/events';
import { FixedClock, Instant, dec } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { AUDIT_POLICIES, financeRuntimes, LIFECYCLE_MACHINES } from '../../src/identity/identity-wiring.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Intereses y cargos de una tarjeta por HTTP contra PostgreSQL real (openspec add-card-interest-ledger-portions): registro
// de un cargo con una porción por componente, estado de cuenta con la diferencia del banco, anulación con la reversa del
// asiento, adopción de un gasto existente, permisos, idempotencia, auditoría, aislamiento y lo que cuentan los reportes de
// comisiones y de deudas. Las respuestas se validan contra el OpenAPI. Reloj fijo en America/La_Paz.
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
}, 240_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
});

// ───────────────────────────────────────────── escenario del ciclo de octubre

interface Octubre {
  s: Scenario;
  visa: string;
  card: any;
  cardId: string;
  statement: any;
}

/**
 * Visa Oro BOB con el ciclo del 2026-09-26 al 2026-10-25 (compras 350.00 + 820.50 = 1170.50; pago de 1200.00 el 10-10) ya
 * emitido, y "hoy" el 2026-10-28.
 */
async function octubre(label: string): Promise<Octubre> {
  setDay('2026-10-20');
  const s = await scenario(label);
  const visa = await visaAccount(s.owner, 'Visa Oro BOB', 'BOB', '1200.00');
  const card = await registerCard(s.owner, {
    accounts: [{ accountId: visa, creditLimit: bob('10000.00'), minimumRule: percent5 }],
  });
  await spend(s, visa, '350.00', '2026-10-03');
  await transfer(s, s.bank, visa, '1200.00', '2026-10-10');
  await spend(s, visa, '820.50', '2026-10-18');
  setDay('2026-10-26');
  await runDaily(s.owner.ws);
  const statement = (await statementsOf(s.owner, card['id'])).find((x) => x.closingDate === '2026-10-25');
  expect(statement, 'estado de cuenta del 2026-10-25').toBeDefined();
  setDay('2026-10-28');
  return { s, visa, card, cardId: card['id'], statement };
}

const chargeBody = (visa: string, over: Record<string, unknown> = {}) => ({
  accountId: visa,
  businessDate: '2026-10-25',
  interest: '4.00',
  insurance: '0.80',
  ...over,
});

const createCharge = async (o: Octubre, over: Record<string, unknown> = {}, headers = {}) =>
  post(o.s.owner, `/credit-cards/${o.cardId}/charges`, chargeBody(o.visa, over), headers);

const statementOf = async (o: Octubre) =>
  checked(
    'getCardStatement',
    200,
    await get(o.s.owner, `/credit-cards/${o.cardId}/statements/${o.statement.id}`),
  );

const owed = async (o: Octubre) => (await cardOf(o.s.owner, o.cardId)).accounts[0].balance.amount as string;

describe('registro de un cargo (debt/credit-cards)', () => {
  let o: Octubre;
  beforeAll(async () => {
    o = await octubre('reg');
  }, 180_000);

  it('[TC-DEBT-CARD-043] interés 4.00 y seguro 0.80: gasto de 4.80 con una porción por componente, la deuda sube y las compras pasan a 1175.30', async () => {
    const before = await statementOf(o);
    expect(before.current.purchases.amount).toBe('1170.50');
    const owedBefore = await owed(o);
    const charge = checked('createCardCharge', 201, await createCharge(o));
    expect(charge).toMatchObject({
      accountId: o.visa,
      businessDate: '2026-10-25',
      origin: 'RECORDED',
      status: 'ACTIVE',
      total: bob('4.80'),
      interest: bob('4.00'),
      insurance: bob('0.80'),
      fees: bob('0.00'),
    });
    const owedAfter = await owed(o);
    expect(dec(owedAfter).minus(owedBefore).toFixed(2)).toBe('4.80');
    const after = await statementOf(o);
    expect(after.current.purchases.amount).toBe('1175.30');
    // La transacción es un gasto administrado por la tarjeta, con una porción por componente.
    const tx = checked(
      'getTransaction',
      200,
      await get(o.s.owner, `/transactions/${charge['transactionId']}`),
    );
    expect(tx).toMatchObject({
      kind: 'EXPENSE',
      source: 'DEBT',
      status: 'POSTED',
      debtRole: 'CARD_CHARGE',
      debtCardId: o.cardId,
    });
    expect(tx['amount']).toEqual(bob('4.80'));
    expect((tx['splits'] as any[]).map((x) => x.amount.amount).sort()).toEqual(['0.80', '4.00']);
    const cats = (await get(o.s.owner, '/categories?limit=200')).body['data'] as any[];
    const bySystem = (code: string) => cats.find((c) => c.systemCode === code)!.id;
    expect(Object.fromEntries((tx['splits'] as any[]).map((x) => [x.categoryId, x.amount.amount]))).toEqual({
      [bySystem('INTEREST')]: '4.00',
      [bySystem('INSURANCE')]: '0.80',
    });
  });

  it('[TC-DEBT-CARD-045] sin componentes positivos, con fecha futura o de otra cuenta se rechaza sin crear nada', async () => {
    const postings = await postingCount(o.s.owner);
    problem(await createCharge(o, { interest: '0.00', insurance: '0.00' }), 422, 'CARD_CHARGE_INVALID');
    problem(await createCharge(o, { businessDate: '2026-10-30' }), 422, 'CARD_CHARGE_INVALID');
    problem(await createCharge(o, { accountId: o.s.bank }), 422, 'CARD_CHARGE_INVALID');
    problem(await createCharge(o, { fees: '-1.00' }), 422, 'AMOUNT_NOT_POSITIVE');
    expect(await postingCount(o.s.owner)).toBe(postings);
  });

  it('[TC-DEBT-CARD-046] 1.255 de interés con más decimales que la moneda ⇒ AMOUNT_SCALE_EXCEEDED', async () => {
    problem(await createCharge(o, { interest: '1.255' }), 422, 'AMOUNT_SCALE_EXCEEDED');
  });

  it('[TC-DEBT-CARD-055] reintentar con la misma Idempotency-Key devuelve el mismo cargo y una sola transacción', async () => {
    const key = randomUUID();
    const first = checked(
      'createCardCharge',
      201,
      await createCharge(o, { interest: '2.00' }, { 'idempotency-key': key }),
    );
    const postings = await postingCount(o.s.owner);
    const second = await createCharge(o, { interest: '2.00' }, { 'idempotency-key': key });
    expect(second.status, second.text).toBe(201);
    expect(second.body['id']).toBe(first['id']);
    expect(await postingCount(o.s.owner)).toBe(postings);
  });

  it('[TC-DEBT-CARD-053] un VIEWER no puede registrar cargos pero sí consultarlos; un cargo de otro workspace no existe', async () => {
    const postings = await postingCount(o.s.owner);
    problem(
      await post(o.s.viewer, `/credit-cards/${o.cardId}/charges`, chargeBody(o.visa)),
      403,
      'INSUFFICIENT_ROLE',
    );
    expect(await postingCount(o.s.owner)).toBe(postings);
    const list = checked('listCardCharges', 200, await get(o.s.viewer, `/credit-cards/${o.cardId}/charges`));
    expect((list['items'] as any[]).length).toBeGreaterThan(0);
    expect(list['nextCursor']).toBeNull();
    const stranger = await user(`kc-cards-extraño-${randomUUID()}`);
    problem(await get(stranger, `/credit-cards/${o.cardId}/charges`), 404, 'RESOURCE_NOT_FOUND');
    const another = await user(`kc-cards-otro-${randomUUID()}`);
    const foreign = await call('GET', `/api/v1/workspaces/${o.s.owner.ws}/credit-cards/${o.cardId}/charges`, {
      token: another.token,
    });
    expect([403, 404]).toContain(foreign.status);
  });

  it('[TC-DEBT-CARD-054] el registro se audita con el actor y los componentes en la misma unidad de trabajo', async () => {
    const charge = checked(
      'createCardCharge',
      201,
      await createCharge(o, { interest: '3.00', insurance: '0.50' }),
    );
    const rows = await auditOf(o.s.owner.ws, `aggregate_id = $1`, [charge['id']]);
    expect(rows.map((r) => r.action)).toEqual(['debt.card_charge.recorded']);
    expect(rows[0]!.actor_user_id).toBe(o.s.owner.id);
    const changes = Object.fromEntries(rows[0]!.changes.map((c) => [c.field, c.after]));
    expect(changes['interest']).toMatchObject({ amount: '3.00', currency: 'BOB' });
    expect(changes['insurance']).toMatchObject({ amount: '0.50', currency: 'BOB' });
    // La transacción del ledger audita su propio alta en la misma unidad de trabajo.
    const tx = await auditOf(o.s.owner.ws, `aggregate_id = $1`, [charge['transactionId']]);
    expect(tx.map((r) => r.action)).toContain('transactions.transaction.created');
  });

  it('[TC-TRANSACTIONS-CARDCHARGE-002] cambiar el monto del cargo desde transacciones ⇒ TRANSACTION_MANAGED_EXTERNALLY con la tarjeta; la nota sí', async () => {
    const charge = checked(
      'createCardCharge',
      201,
      await createCharge(o, { interest: '6.00', insurance: '0' }),
    );
    const tx = await get(o.s.owner, `/transactions/${charge['transactionId']}`);
    const version = tx.body['version'] as number;
    const patch = (body: unknown) =>
      call('PATCH', `${W(o.s.owner)}/transactions/${charge['transactionId']}`, {
        token: o.s.owner.token,
        body,
        headers: { 'content-type': 'application/merge-patch+json', 'if-match': `"${version}"` },
      });
    const bad = await patch({ amount: bob('7.00') });
    problem(bad, 409, 'TRANSACTION_MANAGED_EXTERNALLY');
    expect(bad.body['details']).toEqual({ managedBy: 'CREDIT_CARD', cardId: o.cardId });
    const voidIt = await call('POST', `${W(o.s.owner)}/transactions/${charge['transactionId']}/void`, {
      token: o.s.owner.token,
      body: { reason: 'error' },
      headers: { 'if-match': `"${version}"`, 'idempotency-key': randomUUID() },
    });
    problem(voidIt, 409, 'TRANSACTION_MANAGED_EXTERNALLY');
    // [TC-TRANSACTIONS-CARDCHARGE-003] La nota queda registrada y el asiento no cambia.
    const postings = await postingCount(o.s.owner);
    const noted = await patch({ notes: 'interés por pago parcial de septiembre' });
    expect(noted.status, noted.text).toBe(200);
    expect(noted.body['notes']).toBe('interés por pago parcial de septiembre');
    expect(await postingCount(o.s.owner)).toBe(postings);
  });
});

describe('estado de cuenta, diferencia del banco y anulación (debt/credit-cards)', () => {
  let o: Octubre;
  beforeAll(async () => {
    o = await octubre('est');
  }, 180_000);

  it('[TC-DEBT-CARD-048] propone registrar la diferencia con el banco sin crear asientos; [TC-DEBT-CARD-047] tras registrarla la lista y la diferencia queda en cero', async () => {
    const current = await statementOf(o);
    const reportedBilled = dec(current.current.billedBalance.amount).plus('4.80').toFixed(2);
    const patched = await withVersion(
      o.s.owner,
      'PATCH',
      `/credit-cards/${o.cardId}/statements/${o.statement.id}`,
      { reportedBilledBalance: bob(reportedBilled) },
      current.version,
    );
    expect(patched.status, patched.text).toBe(200);
    const postings = await postingCount(o.s.owner);
    const proposed = await statementOf(o);
    expect(proposed.chargeProposal).toEqual({ businessDate: '2026-10-25', total: bob('4.80') });
    expect(proposed.charges).toEqual([]);
    expect(await postingCount(o.s.owner)).toBe(postings);
    checked('createCardCharge', 201, await createCharge(o));
    const after = await statementOf(o);
    expect(after.charges).toHaveLength(1);
    expect(after.charges[0].total).toEqual(bob('4.80'));
    expect(after.current.billedBalance.amount).toBe(reportedBilled);
    expect(after.reportedDifference.amount).toBe('0.00');
    expect(after.chargeProposal).toBeNull();
  });

  it('[TC-DEBT-CARD-049] anular revierte el asiento: la deuda y las compras vuelven a su valor y el cargo deja de listarse', async () => {
    const charge = checked(
      'createCardCharge',
      201,
      await createCharge(o, { interest: '1.00', insurance: '0' }),
    );
    const owedWith = await owed(o);
    const postings = await postingCount(o.s.owner);
    const voided = checked(
      'voidCardCharge',
      200,
      await withVersion(
        o.s.owner,
        'POST',
        `/credit-cards/${o.cardId}/charges/${charge['id']}/void`,
        { reason: 'monto equivocado' },
        charge['version'],
      ),
    );
    expect(voided).toMatchObject({ status: 'VOIDED', voidReason: 'monto equivocado' });
    expect(
      dec(owedWith)
        .minus(await owed(o))
        .toFixed(2),
    ).toBe('1.00');
    expect(await postingCount(o.s.owner)).toBeGreaterThan(postings);
    const tx = await get(o.s.owner, `/transactions/${charge['transactionId']}`);
    expect(tx.body['status']).toBe('VOIDED');
    const after = await statementOf(o);
    expect(after.charges.map((c: any) => c.id)).not.toContain(charge['id']);
    // Anular un cargo ya anulado es idempotente.
    const again = await withVersion(
      o.s.owner,
      'POST',
      `/credit-cards/${o.cardId}/charges/${charge['id']}/void`,
      { reason: 'otra vez' },
      voided['version'],
    );
    expect(again.status, again.text).toBe(200);
    expect(again.body['version']).toBe(voided['version']);
    const voidedList = checked(
      'listCardCharges',
      200,
      await get(o.s.owner, `/credit-cards/${o.cardId}/charges?status=VOIDED`),
    );
    expect((voidedList['items'] as any[]).map((c) => c.id)).toContain(charge['id']);
  });

  it('[TC-DEBT-CARD-053] un VIEWER no puede anular un cargo', async () => {
    const charge = checked(
      'createCardCharge',
      201,
      await createCharge(o, { interest: '1.50', insurance: '0' }),
    );
    problem(
      await withVersion(
        o.s.viewer,
        'POST',
        `/credit-cards/${o.cardId}/charges/${charge['id']}/void`,
        { reason: 'x' },
        charge['version'],
      ),
      403,
      'INSUFFICIENT_ROLE',
    );
  });
});

describe('adopción de un gasto como cargo (debt/credit-cards)', () => {
  let o: Octubre;
  beforeAll(async () => {
    o = await octubre('adopt');
  }, 180_000);

  it('[TC-DEBT-CARD-051] adoptar un gasto manual no cambia el saldo ni crea transacciones; [TC-DEBT-CARD-052] componentes que no suman se rechazan', async () => {
    const cats = (await get(o.s.owner, '/categories?limit=200')).body['data'] as any[];
    const interest = cats.find((c) => c.systemCode === 'INTEREST').id as string;
    const manual = await ok(
      post(o.s.owner, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-10-25',
        accountId: o.visa,
        amount: bob('4.80'),
        description: 'Interés Visa',
        splits: [{ amount: bob('4.80'), categoryId: interest }],
      }),
    );
    const txId = manual['id'] as string;
    const owedBefore = await owed(o);
    const postingsBefore = await postingCount(o.s.owner);
    const txCount = async () =>
      ((await get(o.s.owner, '/transactions?limit=200')).body['data'] as any[]).length;
    const txBefore = await txCount();
    problem(
      await createCharge(o, {
        adoptTransactionId: txId,
        businessDate: undefined,
        interest: '4.00',
        insurance: '1.00',
      }),
      422,
      'CARD_CHARGE_INVALID',
    );
    const view = checked(
      'createCardCharge',
      201,
      await createCharge(o, {
        adoptTransactionId: txId,
        businessDate: undefined,
        interest: '4.80',
        insurance: undefined,
      }),
    );
    expect(view).toMatchObject({
      origin: 'ADOPTED',
      transactionId: txId,
      businessDate: '2026-10-25',
      total: bob('4.80'),
    });
    expect(await owed(o)).toBe(owedBefore);
    expect(await txCount()).toBe(txBefore);
    // Solo se reclasifica: sin reversa ni asiento nuevo cuando la forma de las porciones no cambia.
    expect(await postingCount(o.s.owner)).toBe(postingsBefore);
    const tx = checked('getTransaction', 200, await get(o.s.owner, `/transactions/${txId}`));
    expect(tx).toMatchObject({ debtRole: 'CARD_CHARGE', debtCardId: o.cardId, source: 'MANUAL' });
    // Adoptarlo otra vez se rechaza.
    problem(
      await createCharge(o, {
        adoptTransactionId: txId,
        businessDate: undefined,
        interest: '4.80',
        insurance: undefined,
      }),
      422,
      'CARD_CHARGE_INVALID',
    );
  });

  it('adoptar un gasto sin categoría de componentes lo reparte (revisión con el mismo neto) y anular el cargo anula la transacción', async () => {
    const manual = await ok(
      post(o.s.owner, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-10-24',
        accountId: o.visa,
        amount: bob('5.00'),
        description: 'Cobro del banco',
        splits: [{ amount: bob('5.00'), categoryId: o.s.category }],
      }),
    );
    const owedBefore = await owed(o);
    const view = checked(
      'createCardCharge',
      201,
      await createCharge(o, {
        adoptTransactionId: manual['id'],
        businessDate: undefined,
        interest: '3.50',
        fees: '1.50',
        insurance: undefined,
      }),
    );
    expect(await owed(o)).toBe(owedBefore);
    const tx = await get(o.s.owner, `/transactions/${manual['id']}`);
    expect((tx.body['splits'] as any[]).map((s) => s.amount.amount).sort()).toEqual(['1.50', '3.50']);
    expect(tx.body['revision']).toBeGreaterThanOrEqual(1);
    const voided = await withVersion(
      o.s.owner,
      'POST',
      `/credit-cards/${o.cardId}/charges/${view['id']}/void`,
      { reason: 'duplicado' },
      view['version'],
    );
    expect(voided.status, voided.text).toBe(200);
    expect(
      dec(owedBefore)
        .minus(await owed(o))
        .toFixed(2),
    ).toBe('5.00');
    expect((await get(o.s.owner, `/transactions/${manual['id']}`)).body['status']).toBe('VOIDED');
  });
});

describe('periodo cerrado y reportes (debt/credit-cards, reporting/financial-reports)', () => {
  let o: Octubre;
  beforeAll(async () => {
    o = await octubre('rep');
  }, 180_000);

  it('[TC-REPORTING-REPORTS-058] [TC-REPORTING-REPORTS-060] los cargos entran al reporte de comisiones y al de deudas; [TC-REPORTING-REPORTS-061] un gasto manual en «Intereses pagados» no', async () => {
    const cats = (await get(o.s.owner, '/categories?limit=200')).body['data'] as any[];
    const interest = cats.find((c) => c.systemCode === 'INTEREST').id as string;
    await ok(
      post(o.s.owner, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-10-26',
        accountId: o.visa,
        amount: bob('9.99'),
        description: 'Interés manual',
        splits: [{ amount: bob('9.99'), categoryId: interest }],
      }),
    );
    checked('createCardCharge', 201, await createCharge(o));
    const fees = checked(
      'getFeesReport',
      200,
      await get(o.s.owner, '/reports/fees?from=2026-10-01&to=2026-10-31'),
    );
    const month = (fees['months'] as any[])[0];
    const byType = Object.fromEntries(month.byType.map((b: any) => [b.type, b.amount.consolidated.amount]));
    expect(byType['CARD']).toBe('4.80');
    expect(byType['FEE_CATEGORY']).toBe('0.00');
    expect(month.total.consolidated.amount).toBe('4.80');
    const debts = checked(
      'getDebtsReport',
      200,
      await get(o.s.owner, '/reports/debts?from=2026-09-01&to=2026-10-31&debtKind=CARD'),
    );
    const card = (debts['debts'] as any[])[0];
    expect(card.months.map((m: any) => [m.interestCharged.amount, m.chargesCharged.amount])).toEqual([
      ['0.00', '0.00'],
      ['4.00', '0.80'],
    ]);
    expect(card.months.map((m: any) => m.principalPaid)).toEqual([null, null]);
    expect((debts['consolidated'] as any[]).map((c) => c.interestCharged.consolidated.amount)).toEqual([
      '0.00',
      '4.00',
    ]);
  });

  it('[TC-REPORTING-REPORTS-062] un cargo anulado deja de contarse en el reporte de comisiones', async () => {
    const o2 = await octubre('rep2');
    const charge = checked('createCardCharge', 201, await createCharge(o2));
    const before = await get(o2.s.owner, '/reports/fees?from=2026-10-01&to=2026-10-31');
    expect(
      (before.body['months'] as any[])[0].byType.find((b: any) => b.type === 'CARD').amount.consolidated
        .amount,
    ).toBe('4.80');
    expect(
      (
        await withVersion(
          o2.s.owner,
          'POST',
          `/credit-cards/${o2.cardId}/charges/${charge['id']}/void`,
          { reason: 'error' },
          charge['version'],
        )
      ).status,
    ).toBe(200);
    const after = await get(o2.s.owner, '/reports/fees?from=2026-10-01&to=2026-10-31');
    expect(
      (after.body['months'] as any[])[0].byType.find((b: any) => b.type === 'CARD').amount.consolidated
        .amount,
    ).toBe('0.00');
  });

  it('[TC-DEBT-CARD-050] anular un cargo de un mes cerrado ⇒ PERIOD_CLOSED y el cargo sigue vigente', async () => {
    const o3 = await octubre('cerrado');
    const charge = checked('createCardCharge', 201, await createCharge(o3));
    // Cierre del mes (lo escribe Planning en producción vía `LedgerPeriodLockPort`; aquí directo con `pf_app`).
    const app = await connect(deps.databaseUrl);
    try {
      await inTx(
        app,
        { userId: o3.s.owner.id, workspaceId: o3.s.owner.ws },
        () =>
          app.query(
            `INSERT INTO ledger.period_lock (workspace_id, year_month, period_start, period_end) VALUES ($1, $2, $3, $4)`,
            [o3.s.owner.ws, '2026-10', '2026-10-01', '2026-10-31'],
          ),
        true,
      );
    } finally {
      await app.end();
    }
    const attempt = await withVersion(
      o3.s.owner,
      'POST',
      `/credit-cards/${o3.cardId}/charges/${charge['id']}/void`,
      { reason: 'x' },
      charge['version'],
    );
    problem(attempt, 409, 'PERIOD_CLOSED');
    const list = checked('listCardCharges', 200, await get(o3.s.owner, `/credit-cards/${o3.cardId}/charges`));
    expect((list['items'] as any[]).find((c) => c.id === charge['id'])).toMatchObject({ status: 'ACTIVE' });
  });
});
