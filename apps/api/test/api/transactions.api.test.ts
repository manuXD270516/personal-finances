import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ApiContract } from '@pf/platform/api';
import type { EventEnvelope } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Transacciones por HTTP contra PostgreSQL real (Testcontainers): If-Match/ETag (412/428/409) e Idempotency-Key
// sobre `/transactions`, problem+json con `errors[].pointer`, ida y vuelta de campos, fecha de negocio vs posteo,
// historial (GET …/history y GET /audit-log; VIEWER, D28), comisión de transferencia en otra moneda (D40) y contrato
// del productor: todo sobre del outbox emitido cumple su JSON Schema de `contracts/events` (openspec
// add-transaction-recording 1.3, 3.5, 5.1–5.3; add-transfers 2.4; add-audit-trail 9.2).
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
// 2026-04-05 10:00 en La Paz: posterior a todas las fechas de negocio de los TC (marzo y abril de 2026).
const clock = new FixedClock(Instant.parse('2026-04-05T14:00:00Z'));
const contract = ApiContract.fromFile(resolveContractPath());

interface Reply {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}
type Json = Record<string, unknown>;
type Money = { amount: string; currency: string };

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
const apiLog = capturingLogger('finance-api', 'api');

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
  options: { token?: string; body?: unknown; headers?: Record<string, string>; contentType?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
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
  expect(r.headers.get('content-type')).toContain('application/problem+json');
  expect(r.body['code']).toBe(code);
};

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId };
}
type User = Awaited<ReturnType<typeof user>>;

const W = (u: User) => `/api/v1/workspaces/${u.ws}`;
const post = (u: User, path: string, body: unknown, headers: Record<string, string> = {}) =>
  call('POST', `${W(u)}${path}`, {
    token: u.token,
    ...(body === undefined ? {} : { body }),
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
const patch = (u: User, path: string, body: unknown, headers: Record<string, string>) =>
  call('PATCH', `${W(u)}${path}`, {
    token: u.token,
    body,
    contentType: 'application/merge-patch+json',
    headers,
  });
const get = (u: User, path: string) => call('GET', `${W(u)}${path}`, { token: u.token });

async function account(
  u: User,
  name: string,
  currency = 'BOB',
  opening: string | null = null,
  type = 'BANK',
) {
  const r = await post(u, '/accounts', {
    name,
    type,
    currency,
    ...(opening ? { openingBalance: { amount: { amount: opening, currency }, date: '2026-03-01' } } : {}),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body['id'] as string;
}

async function expense(u: User, accountId: string, amount: string, extra: Json = {}) {
  const r = await post(u, '/transactions', {
    kind: 'EXPENSE',
    transactionDate: '2026-03-10',
    accountId,
    amount: { amount, currency: 'BOB' },
    ...extra,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number } & Json;
}

/** Consulta como `pf_app` con el contexto RLS del workspace (rollback). */
async function asApp<T>(u: User, fn: (c: Client) => Promise<T>): Promise<T> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, () => fn(app));
  } finally {
    await app.end();
  }
}

/** Saldo contable de una cuenta (Σ postings), opcionalmente a una fecha de asiento. */
const balanceOf = (u: User, accountId: string, scale = 2, asOf?: string) =>
  asApp(u, async (c) => {
    const { rows } = await c.query<{ balance: string }>(
      `SELECT (COALESCE(sum(p.amount), 0))::numeric(38,${scale})::text AS balance
         FROM ledger.posting p JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
        WHERE la.source_account_id = $1 AND ($2::date IS NULL OR p.entry_date <= $2::date)`,
      [accountId, asOf ?? null],
    );
    return rows[0]!.balance;
  });

/** Sobres del outbox del workspace (todas las filas o las de un agregado), en orden. */
async function outbox(u: User, aggregateId?: string) {
  const worker = await connect(deps.workerDatabaseUrl);
  try {
    const { rows } = await worker.query<{ event_type: string; envelope: EventEnvelope }>(
      `SELECT event_type, envelope FROM platform.outbox
        WHERE workspace_id = $1 AND ($2::uuid IS NULL OR aggregate_id = $2::uuid) ORDER BY sequence`,
      [u.ws, aggregateId ?? null],
    );
    return rows;
  } finally {
    await worker.end();
  }
}

async function addMember(owner: User, member: User, role: 'EDITOR' | 'VIEWER'): Promise<User> {
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

let editor: User;
let viewer: User;
let outsider: User;
let bankA: string;

beforeAll(async () => {
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
  editor = await user(`kc-txn-editor-${randomUUID()}`);
  outsider = await user(`kc-txn-outsider-${randomUUID()}`);
  viewer = await addMember(editor, await user(`kc-txn-viewer-${randomUUID()}`), 'VIEWER');
  bankA = await account(editor, 'Bank A', 'BOB', '1000.00');
}, 120_000);

afterAll(async () => {
  await runtime?.close();
});

describe('If-Match / ETag e Idempotency-Key sobre /transactions', () => {
  it('[TC-TRANSACTIONS-CONCURRENCY-001] PATCH con versión obsoleta ⇒ 412 con currentVersion; sin If-Match ⇒ 428; carrera ⇒ un solo ganador', async () => {
    const t1 = await expense(editor, bankA, '120.00');
    expect(t1.version).toBe(1);
    const entriesBefore = await asApp(editor, async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            'SELECT count(*) AS n FROM ledger.journal_entry WHERE source_id = $1',
            [t1.id],
          )
        ).rows[0]!.n,
      ),
    );

    const first = await patch(
      editor,
      `/transactions/${t1.id}`,
      { amount: { amount: '102.00', currency: 'BOB' } },
      { 'if-match': '"1"' },
    );
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.headers.get('etag')).toBe('"2"');
    expect(contract.validateResponse('updateTransaction', 200, first.body)).toEqual([]);
    const entriesAfterFirst = await asApp(editor, async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            'SELECT count(*) AS n FROM ledger.journal_entry WHERE source_id = $1',
            [t1.id],
          )
        ).rows[0]!.n,
      ),
    );

    const second = await patch(
      editor,
      `/transactions/${t1.id}`,
      { amount: { amount: '110.00', currency: 'BOB' } },
      { 'if-match': '"1"' },
    );
    expectProblem(second, 412, 'PRECONDITION_FAILED');
    expect(second.body['currentVersion']).toBe(2);
    const current = await get(editor, `/transactions/${t1.id}`);
    expect(current.headers.get('etag')).toBe('"2"');
    expect(current.body['amount']).toEqual({ amount: '102.00', currency: 'BOB' });
    // Sin asientos adicionales por el rechazo (la edición aceptada sí reversa y reemplaza).
    const entriesAfterSecond = await asApp(editor, async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            'SELECT count(*) AS n FROM ledger.journal_entry WHERE source_id = $1',
            [t1.id],
          )
        ).rows[0]!.n,
      ),
    );
    expect(entriesAfterFirst).toBeGreaterThan(entriesBefore);
    expect(entriesAfterSecond).toBe(entriesAfterFirst);

    const noIfMatch = await post(editor, `/transactions/${t1.id}/void`, { reason: 'sin versión' });
    expectProblem(noIfMatch, 428, 'PRECONDITION_REQUIRED');
    expect((await get(editor, `/transactions/${t1.id}`)).body['status']).toBe('POSTED');

    // Dos escritores simultáneos con la misma versión vigente: uno gana; el otro 412 (chequeo de If-Match) o
    // 409 CONCURRENCY_CONFLICT (carrera detectada en BD, docs/10 §6). Nunca dos ediciones aplicadas.
    const [a, b] = await Promise.all(
      ['104.00', '106.00'].map((amount) =>
        patch(
          editor,
          `/transactions/${t1.id}`,
          { amount: { amount, currency: 'BOB' } },
          { 'if-match': '"2"' },
        ),
      ),
    );
    const replies = [a!, b!];
    const winners = replies.filter((r) => r.status === 200);
    const losers = replies.filter((r) => r.status !== 200);
    expect(winners, JSON.stringify(replies.map((r) => [r.status, r.body['code']]))).toHaveLength(1);
    expect([
      [409, 'CONCURRENCY_CONFLICT'],
      [412, 'PRECONDITION_FAILED'],
    ]).toContainEqual([losers[0]!.status, losers[0]!.body['code']]);
    const final = await get(editor, `/transactions/${t1.id}`);
    expect(final.body['version']).toBe(3);
    expect(final.body['amount']).toEqual(winners[0]!.body['amount']);
  });

  it('[TC-TRANSACTIONS-IDEMPOTENCY-001] repetir POST /transactions con la misma clave devuelve el original sin duplicar', async () => {
    const owner = await user(`kc-txn-idem-${randomUUID()}`);
    const bank = await account(owner, 'Bank A', 'BOB', '1000.00');
    const cats = await get(owner, '/categories?kind=EXPENSE');
    const transport = (cats.body['data'] as { id: string; systemCode: string | null }[]).find(
      (c) => c.systemCode === null,
    )!.id;
    const key = '0191f0c2-7a1e-7c4e-9a51-3f2d7c1b9e01';
    const body = {
      kind: 'EXPENSE',
      transactionDate: '2026-03-15',
      accountId: bank,
      amount: { amount: '75.00', currency: 'BOB' },
      splits: [{ amount: { amount: '75.00', currency: 'BOB' }, categoryId: transport }],
    };
    const first = await post(owner, '/transactions', body, { 'idempotency-key': key });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(contract.validateResponse('createTransaction', 201, first.body)).toEqual([]);
    const id = first.body['id'] as string;
    expect(first.headers.get('location')).toBe(`${W(owner)}/transactions/${id}`);
    expect(first.headers.get('etag')).toBe('"1"');

    const replay = await post(owner, '/transactions', body, { 'idempotency-key': key });
    expect(replay.status).toBe(201);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(replay.headers.get('location')).toBe(first.headers.get('location'));
    expect(replay.headers.get('etag')).toBe(first.headers.get('etag'));

    const counts = await asApp(owner, async (c) => {
      const one = async (sql: string) => Number((await c.query<{ n: string }>(sql, [id])).rows[0]!.n);
      return {
        transactions: Number(
          (
            await c.query<{ n: string }>(
              `SELECT count(*) AS n FROM txn.transaction WHERE kind = 'EXPENSE' AND workspace_id = $1`,
              [owner.ws],
            )
          ).rows[0]!.n,
        ),
        entries: await one('SELECT count(*) AS n FROM ledger.journal_entry WHERE source_id = $1'),
        audit: await one('SELECT count(*) AS n FROM audit.audit_log WHERE aggregate_id = $1'),
      };
    });
    expect(counts).toEqual({ transactions: 1, entries: 1, audit: 1 });
    expect((await outbox(owner, id)).map((e) => e.event_type)).toEqual([
      'transactions.TransactionCreated',
      'transactions.TransactionPosted',
    ]);
    expect(await balanceOf(owner, bank)).toBe('925.00');
  });

  it('[TC-TRANSACTIONS-AMOUNT-001] 10.555 BOB ⇒ 422 AMOUNT_SCALE_EXCEEDED en /amount/amount sin persistir; 1.234567 USDT ⇒ 201', async () => {
    const owner = await user(`kc-txn-scale-${randomUUID()}`);
    const bank = await account(owner, 'Bank A', 'BOB', '1000.00');
    const wallet = await account(owner, 'USDT Wallet', 'USDT', '100.000000', 'CRYPTO_WALLET');
    const bad = await post(owner, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: '2026-03-15',
      accountId: bank,
      amount: { amount: '10.555', currency: 'BOB' },
    });
    expectProblem(bad, 422, 'AMOUNT_SCALE_EXCEEDED');
    expect(contract.validateResponse('createTransaction', 422, bad.body, 'application/problem+json')).toEqual(
      [],
    );
    expect((bad.body['errors'] as { pointer: string }[])[0]!.pointer).toBe('/amount/amount');
    const persisted = await asApp(owner, async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            `SELECT count(*) AS n FROM txn.transaction WHERE workspace_id = $1 AND kind = 'EXPENSE'`,
            [owner.ws],
          )
        ).rows[0]!.n,
      ),
    );
    expect(persisted).toBe(0);
    expect(await balanceOf(owner, bank)).toBe('1000.00');

    const ok = await post(owner, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: '2026-03-15',
      accountId: wallet,
      amount: { amount: '1.234567', currency: 'USDT' },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body['amount']).toEqual({ amount: '1.234567', currency: 'USDT' });
    expect(await balanceOf(owner, wallet, 6)).toBe('98.765433');
  });
});

describe('Campos, fechas e historial a nivel API', () => {
  it('[TC-TRANSACTIONS-FIELDS-001] ida y vuelta de todos los campos (montos como string) y listado por contraparte', async () => {
    const owner = await user(`kc-txn-fields-${randomUUID()}`);
    const bank = await account(owner, 'Bank A', 'BOB', '1000.00');
    const counterparty = await post(owner, '/counterparties', { name: 'Supermercado Demo' });
    expect(counterparty.status, JSON.stringify(counterparty.body)).toBe(201);
    const tag = await post(owner, '/tags', { name: 'familia' });
    expect(tag.status, JSON.stringify(tag.body)).toBe(201);
    const cats = await get(owner, '/categories?kind=EXPENSE');
    const groceries = (cats.body['data'] as { id: string; systemCode: string | null }[]).find(
      (c) => c.systemCode === null,
    )!.id;
    const created = await post(owner, '/transactions', {
      kind: 'EXPENSE',
      accountId: bank,
      amount: { amount: '45.90', currency: 'BOB' },
      transactionDate: '2026-03-10',
      postingDate: '2026-03-11',
      description: 'Compra semanal',
      counterpartyId: counterparty.body['id'],
      notes: 'con factura',
      externalRef: { namespace: 'bank-csv', id: 'TX-998' },
      splits: [
        {
          amount: { amount: '45.90', currency: 'BOB' },
          categoryId: groceries,
          tagIds: [tag.body['id']],
        },
      ],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(contract.validateResponse('createTransaction', 201, created.body)).toEqual([]);
    const id = created.body['id'] as string;
    const fetched = await get(owner, `/transactions/${id}`);
    expect(fetched.status).toBe(200);
    expect(contract.validateResponse('getTransaction', 200, fetched.body)).toEqual([]);
    for (const body of [created.body, fetched.body]) {
      expect(body).toMatchObject({
        kind: 'EXPENSE',
        status: 'POSTED',
        source: 'MANUAL',
        transactionDate: '2026-03-10',
        postingDate: '2026-03-11',
        description: 'Compra semanal',
        notes: 'con factura',
        counterpartyId: counterparty.body['id'],
        externalRef: { namespace: 'bank-csv', id: 'TX-998' },
        amount: { amount: '45.90', currency: 'BOB' },
      });
      const splits = body['splits'] as { amount: Money; categoryId: string; tagIds: string[] }[];
      expect(splits).toHaveLength(1);
      expect(splits[0]).toMatchObject({
        amount: { amount: '45.90', currency: 'BOB' },
        categoryId: groceries,
        tagIds: [tag.body['id']],
      });
    }
    const listed = await get(owner, `/transactions?counterpartyId=${String(counterparty.body['id'])}`);
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect((listed.body['data'] as { id: string }[]).map((t) => t.id)).toEqual([id]);
  });

  it('[TC-TRANSACTIONS-FIELDS-001] el 201 de createTransaction y createTransfer devuelve el createdAt persistido (ni epoch ni nulo), igual al del GET', async () => {
    const owner = await user(`kc-txn-created-at-${randomUUID()}`);
    const a = await account(owner, 'Bank A', 'BOB', '1000.00');
    const b = await account(owner, 'Bank B', 'BOB');
    const transfer = await post(owner, '/transfers', {
      transactionDate: '2026-03-15',
      fromAccountId: a,
      toAccountId: b,
      amount: { amount: '100.00', currency: 'BOB' },
    });
    expect(transfer.status, JSON.stringify(transfer.body)).toBe(201);
    expect(contract.validateResponse('createTransfer', 201, transfer.body)).toEqual([]);
    for (const created of [await expense(owner, a, '45.90'), transfer.body]) {
      const createdAt = created['createdAt'] as string;
      expect(createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(new Date(createdAt).getTime()).toBeGreaterThan(Date.parse('2000-01-01T00:00:00Z'));
      const fetched = await get(owner, `/transactions/${String(created['id'])}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body['createdAt']).toBe(createdAt);
    }
  });

  it('[TC-TRANSACTIONS-DATES-001] el asiento usa la fecha de negocio (2026-03-31) y no la de posteo bancaria (2026-04-02)', async () => {
    const owner = await user(`kc-txn-dates-${randomUUID()}`);
    const bank = await account(owner, 'Bank A', 'BOB', '1000.00');
    const tx = await expense(owner, bank, '200.00', {
      transactionDate: '2026-03-31',
      postingDate: '2026-04-02',
    });
    const entryDates = await asApp(owner, async (c) =>
      (
        await c.query<{ entry_date: string }>(
          `SELECT entry_date::text AS entry_date FROM ledger.journal_entry WHERE source_id = $1`,
          [tx.id],
        )
      ).rows.map((r) => r.entry_date),
    );
    expect(entryDates).toEqual(['2026-03-31']);
    expect(await balanceOf(owner, bank, 2, '2026-03-31')).toBe('800.00');
    expect(await balanceOf(owner, bank, 2, '2026-03-30')).toBe('1000.00');
    const expenseOf = async (month: string) => {
      const r = await get(owner, `/reports/summary?month=${month}&compare=NONE`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return (r.body['consolidated'] as { expense: Money }).expense;
    };
    expect(await expenseOf('2026-03')).toEqual({ amount: '200.00', currency: 'BOB' });
    expect(await expenseOf('2026-04')).toEqual({ amount: '0.00', currency: 'BOB' });
  });

  it('[TC-TRANSACTIONS-HISTORY-001] historial de crear → editar → anular en orden, legible por VIEWER y aislado por workspace', async () => {
    const tx = await expense(editor, bankA, '120.00');
    const edited = await patch(
      editor,
      `/transactions/${tx.id}`,
      { amount: { amount: '102.00', currency: 'BOB' } },
      { 'if-match': `"${tx.version}"` },
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const voided = await post(
      editor,
      `/transactions/${tx.id}/void`,
      { reason: 'duplicado' },
      { 'if-match': `"${String(edited.body['version'])}"` },
    );
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);

    const history = await get(viewer, `/transactions/${tx.id}/history`);
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    expect(contract.validateResponse('getTransactionHistory', 200, history.body)).toEqual([]);
    // El historial de la transacción incluye también la auditoría de sus asientos (ledger.journal_entry.*).
    const items = (
      history.body['data'] as {
        aggregateType: string;
        action: string;
        actor: Json;
        occurredAt: string;
        aggregateVersion: number | null;
        correlationId: string;
        reason: string | null;
        changes: { field: string; before: unknown; after: unknown }[];
      }[]
    ).filter((i) => i.aggregateType === 'Transaction');
    expect(
      (history.body['data'] as { action: string }[]).some(
        (i) => i.action === 'ledger.journal_entry.reversed',
      ),
    ).toBe(true);
    expect(items.map((i) => i.action)).toEqual([
      'transactions.transaction.created',
      'transactions.transaction.updated',
      'transactions.transaction.voided',
    ]);
    expect(items.map((i) => i.aggregateVersion)).toEqual([1, 2, 3]);
    const amountChange = items[1]!.changes.find((c) => c.field === 'amount');
    expect(amountChange).toMatchObject({
      before: { amount: '120.00', currency: 'BOB' },
      after: { amount: '102.00', currency: 'BOB' },
    });
    expect(items[2]!.reason).toBe('duplicado');
    for (const i of items) {
      expect(i.actor).toMatchObject({ type: 'USER', userId: editor.id });
      expect(i.occurredAt).toMatch(/Z$/);
      expect(i.correlationId).toEqual(expect.any(String));
    }
    expect([...items.map((i) => i.occurredAt)]).toEqual([...items.map((i) => i.occurredAt)].sort());

    // Mismo historial por GET W/audit-log (EDITOR) filtrando por el agregado.
    const log = await get(editor, `/audit-log?aggregateType=Transaction&aggregateId=${tx.id}`);
    expect(log.status, JSON.stringify(log.body)).toBe(200);
    expect(contract.validateResponse('listAuditLog', 200, log.body)).toEqual([]);
    expect((log.body['data'] as { action: string }[]).map((i) => i.action)).toEqual(
      items.map((i) => i.action),
    );

    // Otro workspace: el historial ajeno es inexistente.
    const foreign = await call('GET', `/api/v1/workspaces/${outsider.ws}/transactions/${tx.id}/history`, {
      token: outsider.token,
    });
    expectProblem(foreign, 404, 'RESOURCE_NOT_FOUND');
  });

  it('[TC-AUDIT-ACCESS-002] el VIEWER obtiene el historial del gasto editado de 45.90 BOB pero /audit-log responde 403 INSUFFICIENT_ROLE', async () => {
    const tx = await expense(editor, bankA, '50.00');
    const edited = await patch(
      editor,
      `/transactions/${tx.id}`,
      { amount: { amount: '45.90', currency: 'BOB' } },
      { 'if-match': `"${tx.version}"` },
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const history = await get(viewer, `/transactions/${tx.id}/history`);
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    expect(
      (history.body['data'] as { aggregateType: string; action: string }[])
        .filter((i) => i.aggregateType === 'Transaction')
        .map((i) => i.action),
    ).toEqual(['transactions.transaction.created', 'transactions.transaction.updated']);
    const log = await get(viewer, '/audit-log');
    expectProblem(log, 403, 'INSUFFICIENT_ROLE');
    const filtered = await get(viewer, `/audit-log?aggregateType=Transaction&aggregateId=${tx.id}`);
    expectProblem(filtered, 403, 'INSUFFICIENT_ROLE');
  });
});

describe('Transferencias y advertencias', () => {
  it('[TC-TRANSACTIONS-TRANSFERFEE-001] comisión de 1.50 USD sobre 1000.00 BOB ⇒ 422 TRANSFER_CURRENCY_MISMATCH en /fee/amount/currency; nada persiste', async () => {
    const owner = await user(`kc-txn-fee-${randomUUID()}`);
    const a = await account(owner, 'Bank A', 'BOB', '2000.00');
    const b = await account(owner, 'Bank B', 'BOB');
    const r = await post(owner, '/transfers', {
      transactionDate: '2026-03-15',
      fromAccountId: a,
      toAccountId: b,
      amount: { amount: '1000.00', currency: 'BOB' },
      fee: { amount: { amount: '1.50', currency: 'USD' } },
    });
    expectProblem(r, 422, 'TRANSFER_CURRENCY_MISMATCH');
    expect(contract.validateResponse('createTransfer', 422, r.body, 'application/problem+json')).toEqual([]);
    expect((r.body['errors'] as { pointer: string }[]).map((e) => e.pointer)).toEqual([
      '/fee/amount/currency',
    ]);
    expect([await balanceOf(owner, a), await balanceOf(owner, b)]).toEqual(['2000.00', '0.00']);
    const transfers = await asApp(owner, async (c) =>
      Number(
        (
          await c.query<{ n: string }>(
            `SELECT count(*) AS n FROM txn.transaction WHERE workspace_id = $1 AND kind = 'TRANSFER'`,
            [owner.ws],
          )
        ).rows[0]!.n,
      ),
    );
    expect(transfers).toBe(0);
    expect((await outbox(owner)).map((e) => e.event_type)).not.toContain('transactions.TransferCompleted');
  });

  it('createTransaction devuelve warnings[] POSSIBLE_DUPLICATE no bloqueante con el id del candidato', async () => {
    const owner = await user(`kc-txn-dup-${randomUUID()}`);
    const bank = await account(owner, 'Bank A', 'BOB', '1000.00');
    const first = await expense(owner, bank, '85.00', { description: 'Farmacia Chávez' });
    expect(first['warnings']).toEqual([]);
    const second = await expense(owner, bank, '85.00', {
      description: 'farmacia chavez',
      transactionDate: '2026-03-11',
    });
    expect(contract.validateResponse('createTransaction', 201, second)).toEqual([]);
    expect(second['warnings']).toEqual([
      { code: 'POSSIBLE_DUPLICATE', transactionIds: [first.id], detail: expect.any(String) },
    ]);
  });
});

describe('Contrato del productor: eventos de TRANSACTIONS emitidos al outbox (Ajv strict)', () => {
  it('Created, Posted, Updated, Categorized, Voided, TransferCompleted y TransferRevised cumplen contracts/events/transactions', async () => {
    const owner = await user(`kc-txn-events-${randomUUID()}`);
    const a = await account(owner, 'Bank A', 'BOB', '1000.00');
    const b = await account(owner, 'Bank B', 'BOB');
    const cats = await get(owner, '/categories?kind=EXPENSE');
    const [cat1, cat2] = (cats.body['data'] as { id: string; systemCode: string | null }[])
      .filter((c) => c.systemCode === null)
      .map((c) => c.id);
    // Pendiente → posteado; edición descriptiva y financiera; recategorización; cleared; anulación.
    const pending = await expense(owner, a, '60.00', { status: 'PENDING' });
    const posted = await post(owner, `/transactions/${pending.id}/post`, undefined, {
      'if-match': `"${pending.version}"`,
    });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    let version = posted.body['version'] as number;
    const steps: Json[] = [
      { description: 'Almuerzo', notes: 'con factura' },
      { amount: { amount: '65.00', currency: 'BOB' } },
      { splits: [{ amount: { amount: '65.00', currency: 'BOB' }, categoryId: cat2 }] },
      { status: 'CLEARED' },
    ];
    for (const body of steps) {
      const r = await patch(owner, `/transactions/${pending.id}`, body, { 'if-match': `"${version}"` });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      version = r.body['version'] as number;
    }
    const voided = await post(
      owner,
      `/transactions/${pending.id}/void`,
      { reason: 'cargado por error' },
      { 'if-match': `"${version}"` },
    );
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    // Transferencia con comisión y su edición financiera (TransferRevised, D37).
    const transfer = await post(owner, '/transfers', {
      transactionDate: '2026-03-12',
      fromAccountId: a,
      toAccountId: b,
      amount: { amount: '300.00', currency: 'BOB' },
      fee: { amount: { amount: '2.00', currency: 'BOB' }, categoryId: cat1 },
    });
    expect(transfer.status, JSON.stringify(transfer.body)).toBe(201);
    const revised = await patch(
      owner,
      `/transactions/${String(transfer.body['id'])}`,
      { amount: { amount: '350.00', currency: 'BOB' } },
      { 'if-match': `"${String(transfer.body['version'])}"` },
    );
    expect(revised.status, JSON.stringify(revised.body)).toBe(200);

    const rows = (await outbox(owner)).filter((r) => r.event_type.startsWith('transactions.'));
    const registry = eventSchemaRegistry();
    const failures: string[] = [];
    for (const row of rows) {
      try {
        registry.validate(row.envelope);
      } catch (err) {
        failures.push((err as Error).message);
      }
    }
    expect(failures).toEqual([]);
    expect(new Set(rows.map((r) => r.event_type))).toEqual(
      new Set([
        'transactions.TransactionCreated',
        'transactions.TransactionPosted',
        'transactions.TransactionUpdated',
        'transactions.TransactionCategorized',
        'transactions.TransactionVoided',
        'transactions.TransferCompleted',
        'transactions.TransferRevised',
      ]),
    );
    // Montos siempre como string decimal (nunca number) en los payloads.
    const numbers: string[] = [];
    const scan = (node: unknown, path: string) => {
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (k === 'amount' && typeof v === 'number') numbers.push(path);
          scan(v, `${path}/${k}`);
        }
      }
    };
    for (const row of rows) scan(row.envelope.payload, row.event_type);
    expect(numbers).toEqual([]);
  });
});
