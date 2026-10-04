import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ApiContract } from '@pf/platform/api';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Cambio de moneda base por HTTP con historia multi-moneda sembrada por la API real (openspec add-workspace-identity
// 7.3, TC-IDENTITY-WORKSPACE-004): la moneda base es de presentación; cambiarla no reescribe montos, asientos,
// postings, detalles de conversión ni tasas.
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
const contract = ApiContract.fromFile(resolveContractPath());

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

let token: string;
let userId: string;
let ws: string;

const W = () => `/api/v1/workspaces/${ws}`;
async function create(path: string, body: unknown): Promise<Json> {
  const r = await call('POST', `${W()}${path}`, {
    token,
    body,
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(r.status, `${path}: ${JSON.stringify(r.body)}`).toBe(201);
  return r.body;
}

/**
 * Conteos, sumas por moneda y huella fila a fila (como `pf_app` bajo RLS del workspace) de asientos, postings,
 * detalles de conversión y tasas.
 */
async function ledgerSnapshot(): Promise<Json> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId, workspaceId: ws }, async () => {
      const one = async (sql: string) => (await app.query<Json>(sql, [ws])).rows;
      return {
        entries: await one(
          `SELECT count(*)::int AS n, md5(string_agg(id::text || entry_date || entry_type || source_revision, ',' ORDER BY id)) AS h
             FROM ledger.journal_entry WHERE workspace_id = $1`,
        ),
        postingsByCurrency: await one(
          `SELECT currency, count(*)::int AS n, sum(amount)::text AS total,
                  sum(abs(amount))::text AS gross
             FROM ledger.posting WHERE workspace_id = $1 GROUP BY currency ORDER BY currency`,
        ),
        postings: await one(
          `SELECT md5(string_agg(id::text || ledger_account_id || currency || amount::text, ',' ORDER BY id)) AS h
             FROM ledger.posting WHERE workspace_id = $1`,
        ),
        conversionDetails: await one(
          `SELECT count(*)::int AS n, md5(string_agg(row_to_json(d)::text, ',' ORDER BY transaction_id, revision)) AS h
             FROM txn.conversion_detail d WHERE workspace_id = $1`,
        ),
        rates: await one(
          `SELECT count(*)::int AS n, md5(string_agg(row_to_json(r)::text, ',' ORDER BY id)) AS h
             FROM fx.exchange_rate r WHERE workspace_id = $1`,
        ),
      };
    });
  } finally {
    await app.end();
  }
}

let bank: string;
let wallet: string;
let expenseId: string;
let conversionId: string;

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

  const sub = `kc-ws004-${randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  token = await new SignJWT({
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
  userId = me.body['id'] as string;
  ws = (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId;

  // Historia multi-moneda: gasto de 685.00 BOB y conversión de 100.000000 USDT a 685.00 BOB (con tasa P2P previa).
  const opening = (amount: string, currency: string) => ({
    amount: { amount, currency },
    date: '2026-03-01',
  });
  bank = (
    await create('/accounts', {
      name: 'Banco BOB',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: opening('2000.00', 'BOB'),
    })
  )['id'] as string;
  wallet = (
    await create('/accounts', {
      name: 'Wallet USDT',
      type: 'CRYPTO_WALLET',
      currency: 'USDT',
      openingBalance: opening('500.000000', 'USDT'),
    })
  )['id'] as string;
  await create('/fx-rates', {
    base: 'USDT',
    quote: 'BOB',
    value: '6.85',
    rateType: 'P2P',
    asOf: '2026-03-09T19:00:00Z',
  });
  expenseId = (
    await create('/transactions', {
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: '2026-03-10',
      accountId: bank,
      amount: { amount: '685.00', currency: 'BOB' },
      description: 'Alquiler',
    })
  )['id'] as string;
  conversionId = (
    await create('/conversions', {
      transactionDate: '2026-03-10',
      sourceAccountId: wallet,
      targetAccountId: bank,
      sourceAmount: { amount: '100.000000', currency: 'USDT' },
      targetAmount: { amount: '685.00', currency: 'BOB' },
      quotedRate: { base: 'USDT', quote: 'BOB', value: '6.85' },
      executedAt: '2026-03-10T18:00:00Z',
    })
  )['id'] as string;
});

afterAll(async () => {
  await runtime?.close();
});

describe('[TC-IDENTITY-WORKSPACE-004] cambiar la moneda base de BOB a USD no altera montos, asientos ni tasas', () => {
  it('PATCH baseCurrency USD como OWNER: 200 y la historia queda idéntica al snapshot', async () => {
    const before = await ledgerSnapshot();
    // La historia sembrada existe de verdad (no se compara un snapshot vacío).
    expect((before['entries'] as { n: number }[])[0]!.n).toBeGreaterThanOrEqual(4);
    expect((before['conversionDetails'] as { n: number }[])[0]!.n).toBe(1);
    expect((before['rates'] as { n: number }[])[0]!.n).toBeGreaterThanOrEqual(1);
    expect((before['postingsByCurrency'] as { currency: string }[]).map((p) => p.currency)).toEqual([
      'BOB',
      'USDT',
    ]);
    const accountsBefore = await call('GET', `${W()}/accounts`, { token });

    const current = await call('GET', W(), { token });
    expect(current.body['baseCurrency']).toBe('BOB');
    const r = await call('PATCH', W(), {
      token,
      body: { baseCurrency: 'USD' },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': current.headers.get('etag')! },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body['baseCurrency']).toBe('USD');

    // El gasto sigue en 685.00 BOB y la conversión en 100.000000 USDT → 685.00 BOB.
    const expense = await call('GET', `${W()}/transactions/${expenseId}`, { token });
    expect(expense.body['amount']).toEqual({ amount: '685.00', currency: 'BOB' });
    const conversion = await call('GET', `${W()}/conversions/${conversionId}`, { token });
    expect(conversion.body['conversion']).toMatchObject({
      sourceAmount: { amount: '100.000000', currency: 'USDT' },
      targetAmount: { amount: '685.00', currency: 'BOB' },
    });
    // Saldos por cuenta en su moneda, sin cambios (banco: 2000.00 − 685.00 + 685.00).
    const accountsAfter = await call('GET', `${W()}/accounts`, { token });
    const balances = (b: Json) =>
      (b['data'] as { id: string; balance: unknown }[]).map((a) => [a.id, a.balance]).sort();
    expect(balances(accountsAfter.body)).toEqual(balances(accountsBefore.body));
    expect(balances(accountsAfter.body)).toContainEqual([bank, { amount: '2000.00', currency: 'BOB' }]);
    expect(balances(accountsAfter.body)).toContainEqual([wallet, { amount: '400.000000', currency: 'USDT' }]);

    // Conteos, sumas por moneda y filas de asientos, postings, detalles y tasas idénticos.
    expect(await ledgerSnapshot()).toEqual(before);
  });
});

describe('validación de respuestas de /me y /workspaces contra el contrato (add-workspace-identity 7.3)', () => {
  it('[TC-IDENTITY-AUTH-006] [TC-IDENTITY-WORKSPACE-006] getMe, updateMe, listWorkspaces, createWorkspace, getWorkspace y updateWorkspace cumplen el schema', async () => {
    const me = await call('GET', '/api/v1/me', { token });
    expect(contract.validateResponse('getMe', 200, me.body)).toEqual([]);
    const updatedMe = await call('PATCH', '/api/v1/me', {
      token,
      body: { displayName: 'Owner Contrato' },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': me.headers.get('etag')! },
    });
    expect(updatedMe.status, JSON.stringify(updatedMe.body)).toBe(200);
    expect(contract.validateResponse('updateMe', 200, updatedMe.body)).toEqual([]);
    const created = await call('POST', '/api/v1/workspaces', {
      token,
      body: { name: 'Contrato', baseCurrency: 'BOB', seedDefaultCategories: false },
      headers: { 'idempotency-key': randomUUID() },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(contract.validateResponse('createWorkspace', 201, created.body)).toEqual([]);
    const list = await call('GET', '/api/v1/workspaces?limit=1', { token });
    expect(contract.validateResponse('listWorkspaces', 200, list.body)).toEqual([]);
    const id = created.body['id'] as string;
    const ws1 = await call('GET', `/api/v1/workspaces/${id}`, { token });
    expect(contract.validateResponse('getWorkspace', 200, ws1.body)).toEqual([]);
    const patched = await call('PATCH', `/api/v1/workspaces/${id}`, {
      token,
      body: { name: 'Contrato 2' },
      contentType: 'application/merge-patch+json',
      headers: { 'if-match': ws1.headers.get('etag')! },
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(contract.validateResponse('updateWorkspace', 200, patched.body)).toEqual([]);
  });
});
