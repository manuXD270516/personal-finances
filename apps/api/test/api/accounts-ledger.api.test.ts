import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// ACCOUNTS integrado con Ledger y Transactions REALES por HTTP (openspec add-accounts-management 6.3): saldo derivado
// de los postings, moneda única por cuenta y cuentas archivadas/cerradas sin movimientos nuevos (incluida la
// anulación), sin pósters de prueba.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';

type Json = Record<string, unknown>;
interface Reply {
  status: number;
  headers: Headers;
  body: Json;
}

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
const clock = new FixedClock(Instant.parse('2026-03-15T14:00:00Z'));

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
  expect(r.headers.get('content-type')).toContain('application/problem+json');
  expect(r.body['code']).toBe(code);
};

interface User {
  token: string;
  id: string;
  ws: string;
}

async function user(): Promise<User> {
  const sub = `kc-accl-${randomUUID()}`;
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
const post = (u: User, path: string, body?: unknown, version?: number) =>
  call('POST', `${W(u)}${path}`, {
    token: u.token,
    ...(body === undefined ? {} : { body }),
    headers: {
      'idempotency-key': randomUUID(),
      ...(version !== undefined ? { 'if-match': `"${version}"` } : {}),
    },
  });

async function account(u: User, name: string, type: string, currency: string, opening: string | null) {
  const r = await post(u, '/accounts', {
    name,
    type,
    currency,
    ...(opening ? { openingBalance: { amount: { amount: opening, currency }, date: '2026-03-01' } } : {}),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number };
}

const expense = (u: User, accountId: string, amount: string, currency = 'BOB') =>
  post(u, '/transactions', {
    kind: 'EXPENSE',
    status: 'POSTED',
    transactionDate: '2026-03-10',
    accountId,
    amount: { amount, currency },
    description: 'Gasto de prueba',
  });

async function asApp<T>(u: User, fn: (c: Client) => Promise<T>): Promise<T> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, () => fn(app));
  } finally {
    await app.end();
  }
}

/** Σ postings del ledger account de la cuenta (2 decimales). */
const ledgerBalance = (u: User, accountId: string) =>
  asApp(u, async (c) => {
    const { rows } = await c.query<{ balance: string }>(
      `SELECT (COALESCE(sum(p.amount), 0))::numeric(38,2)::text AS balance
         FROM ledger.posting p JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
        WHERE la.source_account_id = $1`,
      [accountId],
    );
    return rows[0]!.balance;
  });

/** Conteo de todo lo que un comando puede escribir en el workspace (transacciones, asientos, auditoría, outbox). */
async function footprint(u: User): Promise<Json> {
  const counts = await asApp(u, async (c) => {
    const n = async (sql: string) => (await c.query<{ n: number }>(sql, [u.ws])).rows[0]!.n;
    return {
      transactions: await n('SELECT count(*)::int AS n FROM txn.transaction WHERE workspace_id = $1'),
      entries: await n('SELECT count(*)::int AS n FROM ledger.journal_entry WHERE workspace_id = $1'),
      postings: await n('SELECT count(*)::int AS n FROM ledger.posting WHERE workspace_id = $1'),
      audit: await n('SELECT count(*)::int AS n FROM audit.audit_log WHERE workspace_id = $1'),
    };
  });
  const worker = await connect(deps.workerDatabaseUrl);
  try {
    const { rows } = await worker.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM platform.outbox WHERE workspace_id = $1',
      [u.ws],
    );
    return { ...counts, outbox: rows[0]!.n };
  } finally {
    await worker.end();
  }
}

const balanceOf = async (u: User, accountId: string) =>
  (await call('GET', `${W(u)}/accounts/${accountId}`, { token: u.token })).body['balance'];

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

describe('respuesta de apertura', () => {
  it('201 de createAccount lleva el createdAt real de la fila (antes 1970-01-01)', async () => {
    const u = await user();
    const created = await account(u, 'Bank C', 'BANK', 'BOB', null);
    const createdAt = (created as unknown as Json)['createdAt'] as string;
    expect(createdAt).not.toBe('1970-01-01T00:00:00.000Z');
    const read = await call('GET', `${W(u)}/accounts/${created.id}`, { token: u.token });
    expect(read.body['createdAt']).toBe(createdAt);
  });
});

describe('saldo derivado del ledger', () => {
  it('[TC-ACCOUNTS-BALANCE-001] el saldo es Σ postings (925.00 BOB) y no se puede fijar por PATCH', async () => {
    const u = await user();
    const bankA = await account(u, 'Bank A', 'BANK', 'BOB', '1000.00');
    expect((await expense(u, bankA.id, '75.00')).status).toBe(201);
    const read = await call('GET', `${W(u)}/accounts/${bankA.id}`, { token: u.token });
    expect(read.body['balance']).toEqual({ amount: '925.00', currency: 'BOB' });
    expect(await ledgerBalance(u, bankA.id)).toBe('925.00');

    const before = await footprint(u);
    const r = await call('PATCH', `${W(u)}/accounts/${bankA.id}`, {
      token: u.token,
      body: { balance: { amount: '2000.00', currency: 'BOB' } },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': read.headers.get('etag')! },
    });
    expectProblem(r, 400, 'VALIDATION_FAILED');
    expect(await balanceOf(u, bankA.id)).toEqual({ amount: '925.00', currency: 'BOB' });
    expect(await ledgerBalance(u, bankA.id)).toBe('925.00');
    expect(await footprint(u)).toEqual(before);
  });
});

describe('una sola moneda por cuenta', () => {
  it('[TC-ACCOUNTS-CURRENCY-001] gasto en BOB sobre USD Savings ⇒ CURRENCY_MISMATCH sin persistir nada; EUR no habilitada', async () => {
    const u = await user();
    const usd = await account(u, 'USD Savings', 'SAVINGS', 'USD', '500.00');
    const before = await footprint(u);
    expectProblem(await expense(u, usd.id, '50.00', 'BOB'), 422, 'CURRENCY_MISMATCH');
    expect(await footprint(u)).toEqual(before);
    expect(await balanceOf(u, usd.id)).toEqual({ amount: '500.00', currency: 'USD' });
    expect(await ledgerBalance(u, usd.id)).toBe('500.00');
    // "No habilitada" = inexistente o inactiva en el catálogo global (add-manual-conversions, decisión 11: en Phase 1
    // no hay habilitación por workspace; EUR está activa desde 20261003220000, así que se usa un código inexistente).
    expectProblem(
      await post(u, '/accounts', { name: 'Euro Cash', type: 'CASH', currency: 'XYZ' }),
      422,
      'CURRENCY_NOT_ENABLED',
    );
    expect(await footprint(u)).toEqual(before);
  });
});

describe('cuentas archivadas y cerradas', () => {
  it('[TC-ACCOUNTS-ARCHIVE-002] gasto, anulación, ingreso y transferencia rechazados contra Transactions real; nada se escribe', async () => {
    const u = await user();
    const bankA = await account(u, 'Bank A', 'BANK', 'BOB', '1000.00');
    const oldBank = await account(u, 'Old Bank', 'BANK', 'BOB', '350.00');
    const bankB = await account(u, 'Bank B', 'SAVINGS', 'BOB', null);
    const t9 = await expense(u, oldBank.id, '50.00');
    expect(t9.status).toBe(201);
    const archived = await post(u, `/accounts/${oldBank.id}/archive`, undefined, oldBank.version);
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect(archived.body['balance']).toEqual({ amount: '300.00', currency: 'BOB' });
    const closed = await post(u, `/accounts/${bankB.id}/close`, { closedOn: '2026-03-15' }, bankB.version);
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);

    const before = await footprint(u);
    expectProblem(await expense(u, oldBank.id, '20.00'), 409, 'ACCOUNT_ARCHIVED');
    expectProblem(
      await post(
        u,
        `/transactions/${String(t9.body['id'])}/void`,
        { reason: 'error de carga' },
        t9.body['version'] as number,
      ),
      409,
      'ACCOUNT_ARCHIVED',
    );
    expectProblem(
      await post(u, '/transactions', {
        kind: 'INCOME',
        status: 'POSTED',
        transactionDate: '2026-03-15',
        accountId: bankB.id,
        amount: { amount: '10.00', currency: 'BOB' },
      }),
      409,
      'ACCOUNT_CLOSED',
    );
    expectProblem(
      await post(u, '/transfers', {
        transactionDate: '2026-03-15',
        fromAccountId: bankA.id,
        toAccountId: oldBank.id,
        amount: { amount: '5.00', currency: 'BOB' },
      }),
      409,
      'ACCOUNT_ARCHIVED',
    );
    expect(await footprint(u)).toEqual(before);
    expect(await ledgerBalance(u, oldBank.id)).toBe('300.00');
    expect(await ledgerBalance(u, bankB.id)).toBe('0.00');
    expect(await ledgerBalance(u, bankA.id)).toBe('1000.00');
  });

  it('[TC-ACCOUNTS-ARCHIVE-002] carrera archivo ↔ gasto: o el gasto entra antes del archivo o se rechaza; nunca después', async () => {
    const u = await user();
    for (let i = 0; i < 5; i++) {
      const acc = await account(u, `Race ${i}`, 'BANK', 'BOB', '100.00');
      const [spent, archived] = await Promise.all([
        expense(u, acc.id, '10.00'),
        post(u, `/accounts/${acc.id}/archive`, undefined, acc.version),
      ]);
      expect(archived.status, JSON.stringify(archived.body)).toBe(200);
      if (spent.status === 201) {
        // El gasto se confirmó antes: el archivo ya lo ve en el saldo.
        expect(archived.body['balance']).toEqual({ amount: '90.00', currency: 'BOB' });
        expect(await ledgerBalance(u, acc.id)).toBe('90.00');
      } else {
        expectProblem(spent, 409, 'ACCOUNT_ARCHIVED');
        expect(archived.body['balance']).toEqual({ amount: '100.00', currency: 'BOB' });
        expect(await ledgerBalance(u, acc.id)).toBe('100.00');
      }
    }
  });
});
