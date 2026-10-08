import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { EventEnvelope } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// CLASSIFICATION integrada con Transactions, Ledger y Reporting REALES por HTTP (openspec add-classification 7.1–7.3 y
// KIND-002): clasificar (categoría, tags, counterparty) nunca toca el ledger (INV-033) y los totales por tag no
// duplican el gasto.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';

type Json = Record<string, unknown>;
type Money = { amount: string; currency: string };
interface Reply {
  status: number;
  headers: Headers;
  body: Json;
}

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
const clock = new FixedClock(Instant.parse('2026-03-20T14:00:00Z'));

async function call(
  method: string,
  path: string,
  options: { token: string; body?: unknown; headers?: Record<string, string>; contentType?: string },
): Promise<Reply> {
  const headers: Record<string, string> = { authorization: `Bearer ${options.token}`, ...options.headers };
  let payload: string | undefined;
  if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] = options.contentType ?? 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as Json) : {} };
}

const expectProblem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.body['code']).toBe(code);
};

interface User {
  token: string;
  id: string;
  ws: string;
}

async function user(): Promise<User> {
  const sub = `kc-clsl-${randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub,
    iat: now - 5,
    exp: now + 600,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `${sub}@pfos.test`,
    email_verified: true,
    name: sub,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(signingKey);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  return {
    token,
    id: me.body['id'] as string,
    ws: (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId,
  };
}

const W = (u: User) => `/api/v1/workspaces/${u.ws}`;
async function create(u: User, path: string, body: unknown): Promise<Json> {
  const r = await call('POST', `${W(u)}${path}`, {
    token: u.token,
    body,
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(r.status, `${path}: ${JSON.stringify(r.body)}`).toBe(201);
  return r.body;
}
const patchTx = (u: User, tx: Json, body: unknown) =>
  call('PATCH', `${W(u)}/transactions/${String(tx['id'])}`, {
    token: u.token,
    body,
    contentType: 'application/merge-patch+json',
    headers: { 'if-match': `"${String(tx['version'])}"` },
  });

async function account(u: User, name: string, type: string, currency: string, opening: string) {
  return (
    await create(u, '/accounts', {
      name,
      type,
      currency,
      openingBalance: { amount: { amount: opening, currency }, date: '2026-03-01' },
    })
  )['id'] as string;
}

/** Categoría de gasto del catálogo es-BO por nombre (el workspace personal nace con el catálogo sugerido). */
async function expenseCategory(u: User, name: string): Promise<string> {
  const r = await call('GET', `${W(u)}/categories?kind=EXPENSE&limit=200`, { token: u.token });
  const hit = (r.body['data'] as { id: string; name: string }[]).find((c) => c.name === name);
  expect(hit, `categoría ${name}`).toBeDefined();
  return hit!.id;
}

const money = (amount: string, currency = 'BOB'): Money => ({ amount, currency });

async function asApp<T>(u: User, fn: (c: Client) => Promise<T>): Promise<T> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, () => fn(app));
  } finally {
    await app.end();
  }
}

/** Asientos y postings del workspace, fila a fila (huella) y en conteo. */
const ledger = (u: User) =>
  asApp(u, async (c) => {
    const one = async (sql: string) => (await c.query<Json>(sql, [u.ws])).rows[0]!;
    return {
      entries: await one(
        `SELECT count(*)::int AS n, md5(string_agg(row_to_json(e)::text, ',' ORDER BY id)) AS h
           FROM ledger.journal_entry e WHERE workspace_id = $1`,
      ),
      postings: await one(
        `SELECT count(*)::int AS n, md5(string_agg(row_to_json(p)::text, ',' ORDER BY id)) AS h
           FROM ledger.posting p WHERE workspace_id = $1`,
      ),
    };
  });

const balanceOf = async (u: User, accountId: string) =>
  (await call('GET', `${W(u)}/accounts/${accountId}`, { token: u.token })).body['balance'];

async function lastEvent(u: User, aggregateId: string): Promise<EventEnvelope> {
  const worker = await connect(deps.workerDatabaseUrl);
  try {
    const { rows } = await worker.query<{ envelope: EventEnvelope }>(
      'SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND aggregate_id = $2 ORDER BY sequence DESC LIMIT 1',
      [u.ws, aggregateId],
    );
    return rows[0]!.envelope;
  } finally {
    await worker.end();
  }
}

/** Última entrada de auditoría de la transacción (texto, para buscar los ids antes/después). */
const lastAudit = (u: User, aggregateId: string) =>
  asApp(u, async (c) => {
    const { rows } = await c.query<{ changes: unknown }>(
      `SELECT changes FROM audit.audit_log WHERE aggregate_id = $1 ORDER BY occurred_at DESC, id DESC LIMIT 1`,
      [aggregateId],
    );
    return JSON.stringify(rows[0]?.changes ?? null);
  });

const summary = async (u: User) => {
  const r = await call('GET', `${W(u)}/reports/summary?month=2026-03&topCategories=20&compare=NONE`, {
    token: u.token,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const categoryTotal = (s: Json, categoryId: string): string =>
  (s['topExpenseCategories'] as { categoryId: string; amount: Money }[]).find(
    (c) => c.categoryId === categoryId,
  )?.amount.amount ?? '0.00';
const monthExpense = (s: Json): string =>
  ((s['byCurrency'] as { currency: string; expense: Money }[]).find((c) => c.currency === 'BOB')?.expense
    .amount ?? '0.00') as string;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(apiConfig(baseEnv(deps)), capturingLogger('finance-api', 'api').logger, {
    clock,
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
    },
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
});

afterAll(async () => {
  await runtime?.close();
});

describe('clasificar no toca el ledger (INV-033)', () => {
  it('[TC-CLASSIFICATION-RECATEGORIZE-001] recategorizar un gasto de 150.00 BOB: asientos, postings y saldo idénticos', async () => {
    const u = await user();
    const banco = await account(u, 'Banco BOB', 'BANK', 'BOB', '2150.00');
    const supermercado = await expenseCategory(u, 'Supermercado');
    const hogar = await expenseCategory(u, 'Hogar');
    const t1 = await create(u, '/transactions', {
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: '2026-03-10',
      accountId: banco,
      amount: money('150.00'),
      splits: [{ amount: money('150.00'), categoryId: supermercado }],
    });
    expect(await balanceOf(u, banco)).toEqual(money('2000.00'));
    const before = await ledger(u);
    const reportBefore = await summary(u);
    expect(categoryTotal(reportBefore, supermercado)).toBe('150.00');

    const r = await patchTx(u, t1, { splits: [{ amount: money('150.00'), categoryId: hogar }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect((r.body['splits'] as { categoryId: string }[]).map((s) => s.categoryId)).toEqual([hogar]);

    expect(await ledger(u)).toEqual(before);
    expect(await balanceOf(u, banco)).toEqual(money('2000.00'));
    const reportAfter = await summary(u);
    expect(categoryTotal(reportAfter, supermercado)).toBe('0.00');
    expect(categoryTotal(reportAfter, hogar)).toBe('150.00');
    expect(monthExpense(reportAfter)).toBe(monthExpense(reportBefore));
    const audit = await lastAudit(u, t1['id'] as string);
    expect(audit).toContain(supermercado);
    expect(audit).toContain(hogar);
    const event = await lastEvent(u, t1['id'] as string);
    expect(event.eventType).toBe('transactions.TransactionCategorized');
    expect(eventSchemaRegistry().validate(event)).toBeUndefined();
    expect((event.payload as { changes: Json[] }).changes[0]).toMatchObject({
      previousCategoryId: supermercado,
      newCategoryId: hogar,
    });
  });

  it('[TC-CLASSIFICATION-RECATEGORIZE-002] recategorizar un gasto de un mes cerrado ⇒ 409 PERIOD_CLOSED sin escribir nada (docs/31 D49)', async () => {
    const u = await user();
    const banco = await account(u, 'Banco BOB', 'BANK', 'BOB', '2150.00');
    const supermercado = await expenseCategory(u, 'Supermercado');
    const hogar = await expenseCategory(u, 'Hogar');
    const t1 = await create(u, '/transactions', {
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: '2026-03-15',
      accountId: banco,
      amount: money('150.00'),
      splits: [{ amount: money('150.00'), categoryId: supermercado }],
    });
    // Cierre del mes 2026-03 (lo escribirá Planning en Phase 2 vía LedgerPeriodLockPort; aquí directo con pf_app).
    const app = await connect(deps.databaseUrl);
    try {
      await inTx(
        app,
        { userId: u.id, workspaceId: u.ws },
        () =>
          app.query(
            `INSERT INTO ledger.period_lock (workspace_id, year_month, period_start, period_end) VALUES ($1, '2026-03', '2026-03-01', '2026-03-31')`,
            [u.ws],
          ),
        true,
      );
    } finally {
      await app.end();
    }
    const before = await ledger(u);
    const reportBefore = await summary(u);
    const auditBefore = await lastAudit(u, t1['id'] as string);
    const eventBefore = await lastEvent(u, t1['id'] as string);

    const r = await patchTx(u, t1, { splits: [{ amount: money('150.00'), categoryId: hogar }] });
    expectProblem(r, 409, 'PERIOD_CLOSED');

    const after = await call('GET', `${W(u)}/transactions/${String(t1['id'])}`, { token: u.token });
    expect(after.body['version']).toBe(t1['version']);
    expect((after.body['splits'] as { categoryId: string }[]).map((s) => s.categoryId)).toEqual([
      supermercado,
    ]);
    const reportAfter = await summary(u);
    expect([categoryTotal(reportAfter, supermercado), categoryTotal(reportAfter, hogar)]).toEqual([
      categoryTotal(reportBefore, supermercado),
      categoryTotal(reportBefore, hogar),
    ]);
    expect(categoryTotal(reportAfter, supermercado)).toBe('150.00');
    expect(await ledger(u)).toEqual(before);
    expect(await balanceOf(u, banco)).toEqual(money('2000.00'));
    expect(await lastAudit(u, t1['id'] as string)).toBe(auditBefore);
    expect((await lastEvent(u, t1['id'] as string)).eventId).toBe(eventBefore.eventId);
  });

  it('[TC-CLASSIFICATION-TAG-006] añadir el tag "Trabajo" a un gasto de 100.000000 USDT no crea asientos ni cambia el saldo', async () => {
    const u = await user();
    const wallet = await account(u, 'Wallet USDT', 'CRYPTO_WALLET', 'USDT', '600.000000');
    const category = await expenseCategory(u, 'Varios');
    const trabajo = (await create(u, '/tags', { name: 'Trabajo' }))['id'] as string;
    const tx = await create(u, '/transactions', {
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: '2026-03-10',
      accountId: wallet,
      amount: money('100.000000', 'USDT'),
      splits: [{ amount: money('100.000000', 'USDT'), categoryId: category }],
    });
    expect(await balanceOf(u, wallet)).toEqual(money('500.000000', 'USDT'));
    const before = await ledger(u);
    const r = await patchTx(u, tx, {
      splits: [{ amount: money('100.000000', 'USDT'), categoryId: category, tagIds: [trabajo] }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await ledger(u)).toEqual(before);
    expect(await balanceOf(u, wallet)).toEqual(money('500.000000', 'USDT'));
    const event = await lastEvent(u, tx['id'] as string);
    expect(event.eventType).toBe('transactions.TransactionCategorized');
    expect(eventSchemaRegistry().validate(event)).toBeUndefined();
    expect((event.payload as { changes: Json[] }).changes[0]).toMatchObject({
      addedTagIds: [trabajo],
      removedTagIds: [],
    });
  });

  it('[TC-CLASSIFICATION-COUNTERPARTY-005] cambiar la counterparty Hipermaxi → Fidalga no crea asientos ni cambia el saldo', async () => {
    const u = await user();
    const efectivo = await account(u, 'Efectivo USD', 'CASH', 'USD', '345.00');
    const hipermaxi = (await create(u, '/counterparties', { name: 'Hipermaxi' }))['id'] as string;
    const fidalga = (await create(u, '/counterparties', { name: 'Fidalga' }))['id'] as string;
    const tx = await create(u, '/transactions', {
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: '2026-03-10',
      accountId: efectivo,
      amount: money('45.00', 'USD'),
      counterpartyId: hipermaxi,
    });
    expect(await balanceOf(u, efectivo)).toEqual(money('300.00', 'USD'));
    const before = await ledger(u);
    const r = await patchTx(u, tx, { counterpartyId: fidalga });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body['counterpartyId']).toBe(fidalga);
    expect(await ledger(u)).toEqual(before);
    expect(await balanceOf(u, efectivo)).toEqual(money('300.00', 'USD'));
    const audit = await lastAudit(u, tx['id'] as string);
    expect(audit).toContain(hipermaxi);
    expect(audit).toContain(fidalga);
  });
});

describe('tags y tipo de categoría en reportes', () => {
  it('[TC-CLASSIFICATION-TAG-002] un gasto de 230.00 BOB con dos tags suma 230.00 en cada tag y el total del mes sube 230.00', async () => {
    const u = await user();
    const banco = await account(u, 'Banco BOB', 'BANK', 'BOB', '5000.00');
    const restaurantes = await expenseCategory(u, 'Restaurantes');
    const viaje = (await create(u, '/tags', { name: 'Viaje Santa Cruz 2026' }))['id'] as string;
    const trabajo = (await create(u, '/tags', { name: 'Trabajo' }))['id'] as string;
    await create(u, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: '2026-03-05',
      accountId: banco,
      amount: money('1000.00'),
      splits: [{ amount: money('1000.00'), categoryId: await expenseCategory(u, 'Alquiler') }],
    });
    expect(monthExpense(await summary(u))).toBe('1000.00');
    const expense = (tagIds: string[]) => ({
      kind: 'EXPENSE',
      transactionDate: '2026-03-12',
      accountId: banco,
      amount: money('230.00'),
      splits: [{ amount: money('230.00'), categoryId: restaurantes, tagIds }],
    });
    // "Trabajo" repetido: el contrato (`uniqueItems`) lo rechaza; nunca queda un tag duplicado en la porción.
    const dup = await call('POST', `${W(u)}/transactions`, {
      token: u.token,
      body: expense([viaje, trabajo, trabajo]),
      headers: { 'idempotency-key': randomUUID() },
    });
    expectProblem(dup, 400, 'VALIDATION_FAILED');
    const tx = await create(u, '/transactions', expense([viaje, trabajo]));
    expect(((tx['splits'] as { tagIds: string[] }[])[0]!.tagIds ?? []).sort()).toEqual(
      [trabajo, viaje].sort(),
    );

    // Totales por tag sobre las porciones vigentes: cada tag suma la porción completa.
    const byTag = await asApp(u, async (c) =>
      Object.fromEntries(
        (
          await c.query<{ tag_id: string; total: string }>(
            `SELECT st.tag_id, sum(s.amount)::numeric(38,2)::text AS total
               FROM txn.split_tag st
               JOIN txn.transaction_split s ON s.workspace_id = st.workspace_id AND s.id = st.split_id
              WHERE st.workspace_id = $1 AND s.superseded_in_revision IS NULL
              GROUP BY st.tag_id`,
            [u.ws],
          )
        ).rows.map((r) => [r.tag_id, r.total]),
      ),
    );
    expect(byTag).toEqual({ [viaje]: '230.00', [trabajo]: '230.00' });
    for (const tag of [viaje, trabajo]) {
      const listed = await call('GET', `${W(u)}/transactions?tagId=${tag}`, { token: u.token });
      expect((listed.body['data'] as { id: string }[]).map((t) => t.id)).toEqual([tx['id']]);
    }
    // El gasto del mes aumenta exactamente 230.00 (sin contar la porción una vez por tag).
    expect(monthExpense(await summary(u))).toBe('1230.00');
  });

  it('[TC-CLASSIFICATION-KIND-002] ingreso con categoría de gasto ⇒ CATEGORY_KIND_MISMATCH sin escribir; el reembolso la acepta (500.00 → 450.00)', async () => {
    const u = await user();
    const banco = await account(u, 'Banco BOB', 'BANK', 'BOB', '10000.00');
    const supermercado = await expenseCategory(u, 'Supermercado');
    const original = await create(u, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: '2026-03-08',
      accountId: banco,
      amount: money('500.00'),
      splits: [{ amount: money('500.00'), categoryId: supermercado }],
    });
    expect(categoryTotal(await summary(u), supermercado)).toBe('500.00');
    const before = await ledger(u);
    const txCount = () =>
      asApp(
        u,
        async (c) =>
          (
            await c.query<{ n: number }>(
              'SELECT count(*)::int AS n FROM txn.transaction WHERE workspace_id = $1',
              [u.ws],
            )
          ).rows[0]!.n,
      );
    const count = await txCount();
    const income = await call('POST', `${W(u)}/transactions`, {
      token: u.token,
      body: {
        kind: 'INCOME',
        transactionDate: '2026-03-15',
        accountId: banco,
        amount: money('3500.00'),
        splits: [{ amount: money('3500.00'), categoryId: supermercado }],
      },
      headers: { 'idempotency-key': randomUUID() },
    });
    expectProblem(income, 422, 'CATEGORY_KIND_MISMATCH');
    expect(await txCount()).toBe(count);
    expect(await ledger(u)).toEqual(before);

    await create(u, '/transactions', {
      kind: 'REFUND',
      transactionDate: '2026-03-16',
      accountId: banco,
      amount: money('50.00'),
      refundOfTransactionId: original['id'],
      splits: [{ amount: money('50.00'), categoryId: supermercado }],
    });
    expect(categoryTotal(await summary(u), supermercado)).toBe('450.00');
  });
});
