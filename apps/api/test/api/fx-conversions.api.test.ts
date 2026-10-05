import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ApiContract } from '@pf/platform/api';
import { EventConsumerRuntime, EventSubscriptions, type EventEnvelope } from '@pf/platform/events';
import type { JobQueue } from '@pf/platform/queue';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool, type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx, sqlState } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// FX (tasas manuales, catálogo, preferencias) y conversiones por HTTP contra PostgreSQL real (Testcontainers):
// contrato, roles, ETag/If-Match, idempotencia, ledger + ConversionDetail + auditoría + outbox en la misma
// transacción, inmutabilidad (grants) y no-recálculo (openspec add-manual-conversions, tareas 2.4–2.5, 4.3–4.4, 5.1–5.2).
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const EXECUTED = '2026-09-30T18:42:00Z'; // 2026-09-30T14:42:00-04:00

interface Reply {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
const clock = new FixedClock(Instant.parse('2026-10-01T14:00:00Z'));
let cachedContract: ApiContract | undefined;
const contract = () => (cachedContract ??= ApiContract.fromFile(resolveContractPath()));

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
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
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
const post = (u: User, path: string, body: unknown, key: string | null = randomUUID()) =>
  call('POST', `${W(u)}${path}`, { token: u.token, body, headers: key ? { 'idempotency-key': key } : {} });

async function account(u: User, name: string, type: string, currency: string, opening: string) {
  const r = await post(u, '/accounts', {
    name,
    type,
    currency,
    openingBalance: { amount: { amount: opening, currency }, date: '2026-09-01' },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body['id'] as string;
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

/** Postings legibles de los asientos de una transacción, en orden: `[código o cuenta, monto]`. */
const postingsOf = (u: User, transactionId: string) =>
  asApp(
    u,
    async (c) =>
      (
        await c.query<{ entry: string; who: string; amount: string }>(
          `SELECT e.id::text AS entry, COALESCE(la.source_account_id::text, la.code) AS who,
                  (trim_scale(p.amount))::text AS amount
             FROM ledger.posting p
             JOIN ledger.journal_entry e ON e.id = p.journal_entry_id
             JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
            WHERE e.source_id = $1 ORDER BY e.sequence, p.line_no`,
          [transactionId],
        )
      ).rows,
  );

/** Saldo contable (Σ postings) de una cuenta del usuario, en la escala de su moneda. */
const balanceOf = (u: User, accountId: string) =>
  asApp(u, async (c) => {
    const { rows } = await c.query<{ balance: string }>(
      `SELECT (COALESCE(sum(p.amount), 0))::numeric(38,18)::text AS balance
         FROM ledger.posting p JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
        WHERE la.source_account_id = $1`,
      [accountId],
    );
    return rows[0]!.balance.replace(/0+$/, '').replace(/\.$/, '');
  });

async function outbox(u: User, aggregateId: string) {
  const worker = await connect(deps.workerDatabaseUrl);
  try {
    const { rows } = await worker.query<{ event_type: string; envelope: EventEnvelope }>(
      'SELECT event_type, envelope FROM platform.outbox WHERE workspace_id = $1 AND aggregate_id = $2 ORDER BY sequence',
      [u.ws, aggregateId],
    );
    return rows;
  } finally {
    await worker.end();
  }
}

const audits = (u: User, aggregateId: string) =>
  asApp(
    u,
    async (c) =>
      (
        await c.query<{ action: string; reason: string | null }>(
          'SELECT action, reason FROM audit.audit_log WHERE aggregate_id = $1 ORDER BY occurred_at, id',
          [aggregateId],
        )
      ).rows,
  );

const apiLog = capturingLogger('finance-api', 'api');
/** Errores registrados por la API (diagnóstico de respuestas 500 en las aserciones). */
const apiErrors = () =>
  JSON.stringify(apiLog.records().filter((r) => Number(r['level']) >= 50 || r['level'] === 'error'));

let fxUser: User;
let viewer: User;
let other: User;

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
  fxUser = await user(`kc-fx-editor-${randomUUID()}`);
  other = await user(`kc-fx-other-${randomUUID()}`);
  const v = await user(`kc-fx-viewer-${randomUUID()}`);
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: fxUser.id, workspaceId: fxUser.ws },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'VIEWER', 'ACTIVE')`,
          [fxUser.ws, v.id],
        ),
      true,
    );
  } finally {
    await app.end();
  }
  viewer = { ...v, ws: fxUser.ws };
});

afterAll(async () => {
  await runtime?.close();
});

describe('FX: catálogo, tasas manuales y preferencias (fx/market-rates)', () => {
  it('[TC-FX-CURRENCY-001] el catálogo expone tipo y escala; el filtro CRYPTO excluye fiat; responde con ETag', async () => {
    const all = await call('GET', `${W(viewer)}/currencies`, { token: viewer.token });
    expect(all.status).toBe(200);
    expect(all.headers.get('etag')).toBe('"1"');
    expect(contract().validateResponse('listCurrencies', 200, all.body)).toEqual([]);
    const byCode = new Map(
      (all.body['data'] as { code: string; kind: string; scale: number }[]).map((c) => [c.code, c]),
    );
    expect(
      ['BOB', 'USD', 'USDT', 'BTC', 'ETH'].map((c) => [c, byCode.get(c)?.kind, byCode.get(c)?.scale]),
    ).toEqual([
      ['BOB', 'FIAT', 2],
      ['USD', 'FIAT', 2],
      ['USDT', 'CRYPTO', 6],
      ['BTC', 'CRYPTO', 8],
      ['ETH', 'CRYPTO', 18],
    ]);
    const crypto = await call('GET', `${W(viewer)}/currencies?kind=CRYPTO`, { token: viewer.token });
    const codes = (crypto.body['data'] as { code: string }[]).map((c) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['USDT', 'BTC', 'ETH']));
    expect(codes).not.toContain('BOB');
    expect(codes).not.toContain('USD');
    const enabled = await call('GET', `${W(viewer)}/currencies?enabled=true`, { token: viewer.token });
    expect((enabled.body['data'] as { code: string }[]).map((c) => c.code).sort()).toEqual([
      'BOB',
      'USD',
      'USDT',
    ]);
  });

  it('[TC-FX-RATE-001] registra USDT/BOB 6.95 P2P (valor exacto, fuente, instante) y emite fx.RateRecorded.v1 válido', async () => {
    const r = await post(fxUser, '/fx-rates', {
      base: 'USDT',
      quote: 'BOB',
      value: '6.95',
      rateType: 'P2P',
      asOf: '2026-09-29T19:00:00Z',
      sourceLabel: 'Mediana Binance P2P',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(contract().validateResponse('createFxRate', 201, r.body)).toEqual([]);
    expect(r.headers.get('location')).toBe(`${W(fxUser)}/fx-rates/${String(r.body['id'])}`);
    expect(r.body).toMatchObject({
      value: '6.95',
      source: 'MANUAL',
      rateType: 'P2P',
      sourceLabel: 'Mediana Binance P2P',
      asOf: '2026-09-29T19:00:00.000Z',
      effectiveDate: '2026-09-29',
      supersedesRateId: null,
      supersededByRateId: null,
    });
    const read = await call('GET', `${W(viewer)}/fx-rates/${String(r.body['id'])}`, { token: viewer.token });
    expect(read.body).toMatchObject({ id: r.body['id'], value: '6.95', base: 'USDT', quote: 'BOB' });
    const events = await outbox(fxUser, r.body['id'] as string);
    expect(events.map((e) => e.event_type)).toEqual(['fx.RateRecorded']);
    expect(eventSchemaRegistry().validate(events[0]!.envelope)).toBeUndefined();
    const precise = await post(fxUser, '/fx-rates', {
      base: 'USD',
      quote: 'BOB',
      value: '6.965432109876543210',
      rateType: 'PARALLEL',
      asOf: '2026-09-30T12:00:00Z',
    });
    expect(precise.body['value']).toBe('6.96543210987654321');
  });

  it('[TC-FX-RATE-002] tasa 0.00 o con base = quote ⇒ VALIDATION_FAILED; VIEWER no registra tasas', async () => {
    const base = { base: 'USDT', quote: 'BOB', rateType: 'P2P', asOf: '2026-09-29T19:00:00Z' };
    expectProblem(await post(fxUser, '/fx-rates', { ...base, value: '0.00' }), 400, 'VALIDATION_FAILED');
    expectProblem(
      await post(fxUser, '/fx-rates', { ...base, base: 'BOB', value: '1.00' }),
      400,
      'VALIDATION_FAILED',
    );
    expectProblem(await post(viewer, '/fx-rates', { ...base, value: '6.95' }), 403, 'INSUFFICIENT_ROLE');
  });

  it('[TC-FX-HISTORICAL-002] [TC-FX-RATE-003] corregir R1 por R2 con motivo; R1 consultable; doble reemplazo 409; as-of usa R2', async () => {
    const r1 = await post(fxUser, '/fx-rates', {
      base: 'USDT',
      quote: 'BOB',
      value: '9.65',
      rateType: 'CUSTOM',
      asOf: '2026-09-29T19:00:00Z',
    });
    const r1Id = r1.body['id'] as string;
    const r2 = await post(fxUser, `/fx-rates/${r1Id}/supersede`, { value: '6.95', reason: 'error de tipeo' });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    expect(contract().validateResponse('supersedeFxRate', 201, r2.body)).toEqual([]);
    expect(r2.body).toMatchObject({
      supersedesRateId: r1Id,
      asOf: '2026-09-29T19:00:00.000Z',
      value: '6.95',
    });
    const old = await call('GET', `${W(fxUser)}/fx-rates/${r1Id}`, { token: fxUser.token });
    expect(old.body).toMatchObject({ value: '9.65', supersededByRateId: r2.body['id'] });
    expectProblem(
      await post(fxUser, `/fx-rates/${r1Id}/supersede`, { value: '6.94', reason: 'otra vez' }),
      409,
      'FX_RATE_ALREADY_SUPERSEDED',
    );
    expect((await audits(fxUser, r2.body['id'] as string)).map((a) => [a.action, a.reason])).toEqual([
      ['fx.exchange_rate.superseded', 'error de tipeo'],
    ]);
    const latest = await call(
      'GET',
      `${W(fxUser)}/fx-rates/latest?base=USDT&quote=BOB&rateType=CUSTOM&asOf=2026-10-01T03:59:59Z`,
      { token: fxUser.token },
    );
    expect(latest.status, JSON.stringify(latest.body)).toBe(200);
    expect(contract().validateResponse('getLatestFxRate', 200, latest.body)).toEqual([]);
    expect(latest.body).toMatchObject({
      fxRateId: r2.body['id'],
      derivation: 'DIRECT',
      rate: { value: '6.95' },
    });
    expectProblem(
      await call(
        'GET',
        `${W(fxUser)}/fx-rates/latest?base=USDT&quote=BOB&rateType=CUSTOM&asOf=2026-10-10T16:00:00Z`,
        {
          token: fxUser.token,
        },
      ),
      422,
      'FX_RATE_NOT_FOUND',
    );
    const listed = await call('GET', `${W(fxUser)}/fx-rates?includeSuperseded=true&rateType=CUSTOM`, {
      token: fxUser.token,
    });
    expect(contract().validateResponse('listFxRates', 200, listed.body)).toEqual([]);
    expect((listed.body['data'] as unknown[]).length).toBe(2);
    // Aislamiento por workspace: otro workspace no ve la tasa.
    expectProblem(
      await call('GET', `${W(other)}/fx-rates/${r1Id}`, { token: other.token }),
      404,
      'RESOURCE_NOT_FOUND',
    );
  });

  it('[TC-FX-RATE-004] la preferencia por par se reemplaza con If-Match y la consulta usa el tipo preferido', async () => {
    const u = await user(`kc-fx-pref-${randomUUID()}`);
    for (const [value, rateType] of [
      ['6.96', 'OFFICIAL'],
      ['9.80', 'PARALLEL'],
    ] as const) {
      await post(u, '/fx-rates', {
        base: 'USD',
        quote: 'BOB',
        value,
        rateType,
        asOf: '2026-09-30T12:00:00Z',
      });
    }
    const initial = await call('GET', `${W(u)}/fx-rate-preferences`, { token: u.token });
    expect([initial.status, initial.headers.get('etag'), initial.body['data']]).toEqual([200, '"1"', []]);
    const put = (version: string, rateType: string) =>
      call('PUT', `${W(u)}/fx-rate-preferences`, {
        token: u.token,
        body: { data: [{ base: 'USD', quote: 'BOB', rateType }] },
        headers: { 'if-match': version },
      });
    const saved = await put('"1"', 'OFFICIAL');
    expect([saved.status, saved.headers.get('etag')], apiErrors()).toEqual([200, '"2"']);
    expect(contract().validateResponse('replaceFxRatePreferences', 200, saved.body)).toEqual([]);
    const latest = () =>
      call('GET', `${W(u)}/fx-rates/latest?base=USD&quote=BOB&asOf=2026-10-01T03:00:00Z`, { token: u.token });
    expect((await latest()).body).toMatchObject({ rateType: 'OFFICIAL', rate: { value: '6.96' } });
    const stale = await put('"1"', 'PARALLEL');
    expectProblem(stale, 412, 'PRECONDITION_FAILED');
    expect(stale.body['currentVersion']).toBe(2);
    await put('"2"', 'PARALLEL');
    expect((await latest()).body).toMatchObject({ rateType: 'PARALLEL', rate: { value: '9.8' } });
  });
});

describe('Conversiones por HTTP (transactions/conversions, fx/conversion-pricing)', () => {
  let u: User;
  let walletUsdt: string;
  let bankBob: string;
  let cashBob: string;
  let walletBtc: string;
  let walletTrx: string;
  let r2: string;
  let conversionId: string;

  const canonical = (over: Record<string, unknown> = {}) => ({
    transactionDate: '2026-09-30',
    sourceAccountId: walletUsdt,
    targetAccountId: bankBob,
    sourceAmount: { amount: '100.000000', currency: 'USDT' },
    targetAmount: { amount: '685.00', currency: 'BOB' },
    quotedRate: { base: 'USDT', quote: 'BOB', value: '6.90' },
    fees: [{ type: 'PROVIDER', amount: { amount: '5.00', currency: 'BOB' } }],
    provider: { name: 'Binance P2P' },
    executedAt: EXECUTED,
    ...over,
  });

  beforeAll(async () => {
    u = await user(`kc-conv-${randomUUID()}`);
    walletUsdt = await account(u, 'Wallet USDT', 'CRYPTO_WALLET', 'USDT', '1100.000000');
    bankBob = await account(u, 'Banco BOB', 'BANK', 'BOB', '0.00');
    cashBob = await account(u, 'Caja BOB', 'CASH', 'BOB', '0.00');
    walletBtc = await account(u, 'Wallet BTC', 'CRYPTO_WALLET', 'BTC', '0.00000000');
    walletTrx = await account(u, 'Wallet TRX', 'CRYPTO_WALLET', 'TRX', '50.000000');
    const rate = await post(u, '/fx-rates', {
      base: 'USDT',
      quote: 'BOB',
      value: '6.95',
      rateType: 'P2P',
      asOf: '2026-09-29T19:00:00Z',
      sourceLabel: 'Mediana Binance P2P',
    });
    r2 = rate.body['id'] as string;
  });

  it('[TC-TRANSACTIONS-CONVERSION-001] canónica USDT→BOB: una transacción, un asiento por moneda, saldos y detalle', async () => {
    const key = randomUUID();
    const r = await post(u, '/conversions', canonical(), key);
    expect(r.status, `${JSON.stringify(r.body)} ${apiErrors()}`).toBe(201);
    expect(contract().validateResponse('createConversion', 201, r.body)).toEqual([]);
    conversionId = r.body['id'] as string;
    expect(r.headers.get('location')).toBe(`${W(u)}/conversions/${conversionId}`);
    // createdAt del 201 = el persistido (ni epoch ni nulo), igual al de la consulta.
    expect(new Date(r.body['createdAt'] as string).getTime()).toBeGreaterThan(
      Date.parse('2000-01-01T00:00:00Z'),
    );
    expect(
      (await call('GET', `${W(u)}/conversions/${conversionId}`, { token: u.token })).body['createdAt'],
    ).toBe(r.body['createdAt']);
    const postings = await postingsOf(u, conversionId);
    expect(new Set(postings.map((p) => p.entry)).size).toBe(1);
    expect(postings.map((p) => [p.who, p.amount])).toEqual([
      [walletUsdt, '-100'],
      ['EQUITY:FX_TRADING:USDT', '100'],
      ['EQUITY:FX_TRADING:BOB', '-690'],
      [bankBob, '685'],
      ['EXPENSE:BOB', '5'],
    ]);
    expect(await balanceOf(u, walletUsdt)).toBe('1000');
    expect(await balanceOf(u, bankBob)).toBe('685');
    expect(r.body['conversion']).toMatchObject({
      revision: 1,
      sourceAmount: { amount: '100.000000', currency: 'USDT' },
      convertedSourceAmount: { amount: '100.000000', currency: 'USDT' },
      grossTargetAmount: { amount: '690.00', currency: 'BOB' },
      targetAmount: { amount: '685.00', currency: 'BOB' },
      effectiveRate: { base: 'USDT', quote: 'BOB', value: '6.850000000000000000' },
      referenceRate: { fxRateId: r2, rate: { value: '6.95' }, rateType: 'P2P', source: 'MANUAL' },
      spread: { percentage: '0.719424460431654676', amount: { amount: '5.00', currency: 'BOB' } },
      quotedRateDeviation: null,
      totalCost: { amount: { amount: '10.00', currency: 'BOB' }, complete: true },
      fees: [{ type: 'PROVIDER', amount: { amount: '5.00', currency: 'BOB' }, paidFromAccountId: null }],
      provider: { name: 'Binance P2P' },
      executedAt: '2026-09-30T18:42:00.000Z',
    });
    // Idempotency-Key: el reintento reproduce la respuesta sin duplicar la conversión.
    const replay = await post(u, '/conversions', canonical(), key);
    expect([replay.status, replay.headers.get('idempotent-replayed'), replay.body['id']]).toEqual([
      201,
      'true',
      conversionId,
    ]);
    expect((await audits(u, conversionId)).map((a) => a.action)).toEqual(['transactions.conversion.created']);
  });

  it('[TC-TRANSACTIONS-CONVERSION-011] un único ConversionRecorded válido por revisión; su reentrega es idempotente', async () => {
    const events = await outbox(u, conversionId);
    expect(events.map((e) => e.event_type)).toEqual([
      'transactions.TransactionCreated',
      'transactions.TransactionPosted',
      'transactions.ConversionRecorded',
    ]);
    const recorded = events[2]!.envelope;
    expect(eventSchemaRegistry().validate(recorded)).toBeUndefined();
    expect(recorded.payload).toMatchObject({
      source: { amount: { amount: '100.000000', currency: 'USDT' } },
      target: { amount: { amount: '685.00', currency: 'BOB' } },
      effectiveRate: { value: '6.850000000000000000' },
      referenceRate: { fxRateId: r2, rate: { value: '6.95' } },
      fees: [{ type: 'PROVIDER', amount: { amount: '5.00', currency: 'BOB' } }],
      spread: { percentage: '0.719424460431654676' },
    });
    const workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
    try {
      let applied = 0;
      const def = {
        consumer: 'it.conversion-recorded',
        events: [{ type: 'transactions.ConversionRecorded', version: 1 }],
        handler: async () => {
          applied += 1;
        },
      };
      const consumers = new EventConsumerRuntime({
        pool: workerPool,
        queue: {} as JobQueue,
        subscriptions: new EventSubscriptions([def]),
        logger: capturingLogger('finance-worker', 'worker').logger,
      });
      expect(await consumers.deliver(def, recorded)).toBe('applied');
      expect(await consumers.deliver(def, recorded)).toBe('duplicate');
      expect(applied).toBe(1);
    } finally {
      await workerPool.end();
    }
  });

  it('[TC-TRANSACTIONS-CONVERSION-008] el detalle se lee completo y no admite UPDATE ni DELETE con el rol de aplicación', async () => {
    const r = await call('GET', `${W(u)}/conversions/${conversionId}`, { token: u.token });
    expect(r.status).toBe(200);
    expect(contract().validateResponse('getConversion', 200, r.body)).toEqual([]);
    expect(r.body['kind']).toBe('CONVERSION');
    for (const sql of [
      `UPDATE txn.conversion_detail SET target_amount = 1 WHERE transaction_id = $1`,
      `DELETE FROM txn.conversion_detail WHERE transaction_id = $1`,
      `UPDATE txn.conversion_fee SET amount = 1 WHERE transaction_id = $1`,
    ]) {
      expect(await sqlState(() => asApp(u, (c) => c.query(sql, [conversionId]))), sql).toBe('42501');
    }
  });

  it('[TC-FX-HISTORICAL-001] [TC-FX-PRICING-006] tasas nuevas, correcciones y UPDATE/DELETE directos no cambian la conversión ni sus postings', async () => {
    const before = await postingsOf(u, conversionId);
    await post(u, '/fx-rates', {
      base: 'USDT',
      quote: 'BOB',
      value: '7.10',
      rateType: 'P2P',
      asOf: '2026-10-15T16:00:00Z',
    });
    const r3 = await post(u, `/fx-rates/${r2}/supersede`, { value: '6.97', reason: 'corrección de fuente' });
    expect(r3.status).toBe(201);
    for (const sql of [
      `UPDATE fx.exchange_rate SET rate = 7.00 WHERE id = $1`,
      `DELETE FROM fx.exchange_rate WHERE id = $1`,
    ]) {
      expect(await sqlState(() => asApp(u, (c) => c.query(sql, [r2]))), sql).toBe('42501');
    }
    expect((await call('GET', `${W(u)}/fx-rates/${r2}`, { token: u.token })).body['value']).toBe('6.95');
    const r = await call('GET', `${W(u)}/conversions/${conversionId}`, { token: u.token });
    expect(r.body['conversion']).toMatchObject({
      quotedRate: { value: '6.9' },
      effectiveRate: { value: '6.850000000000000000' },
      referenceRate: { fxRateId: r2, rate: { value: '6.95' } },
      spread: { percentage: '0.719424460431654676' },
      totalCost: { amount: { amount: '10.00', currency: 'BOB' } },
    });
    expect(await postingsOf(u, conversionId)).toEqual(before);
  });

  it('[TC-TRANSACTIONS-CONVERSION-010] corregir a 686.00 BOB (fee 4.00): reversa, asiento nuevo, revisión 2 y la 1 consultable', async () => {
    const current = await call('GET', `${W(u)}/conversions/${conversionId}`, { token: u.token });
    const r = await call('PUT', `${W(u)}/conversions/${conversionId}`, {
      token: u.token,
      body: {
        ...canonical({
          targetAmount: { amount: '686.00', currency: 'BOB' },
          fees: [{ type: 'PROVIDER', amount: { amount: '4.00', currency: 'BOB' } }],
          referenceFxRateId: r2,
        }),
        reason: 'monto real según extracto',
      },
      headers: { 'if-match': `"${String(current.body['version'])}"` },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(contract().validateResponse('amendConversion', 200, r.body)).toEqual([]);
    expect(r.body).toMatchObject({
      revision: 2,
      conversion: { revision: 2, effectiveRate: { value: '6.860000000000000000' } },
    });
    const postings = await postingsOf(u, conversionId);
    const entries = [...new Set(postings.map((p) => p.entry))];
    expect(entries).toHaveLength(3);
    const byEntry = (id: string) => postings.filter((p) => p.entry === id).map((p) => [p.who, p.amount]);
    expect(byEntry(entries[1]!)).toEqual(
      byEntry(entries[0]!).map(([w, a]) => [w, a!.startsWith('-') ? a!.slice(1) : `-${a!}`]),
    );
    expect(byEntry(entries[2]!)).toEqual([
      [walletUsdt, '-100'],
      ['EQUITY:FX_TRADING:USDT', '100'],
      ['EQUITY:FX_TRADING:BOB', '-690'],
      [bankBob, '686'],
      ['EXPENSE:BOB', '4'],
    ]);
    expect(await balanceOf(u, bankBob)).toBe('686');
    const revisions = await call('GET', `${W(u)}/conversions/${conversionId}/revisions`, { token: u.token });
    expect(contract().validateResponse('listConversionRevisions', 200, revisions.body)).toEqual([]);
    expect(
      (
        revisions.body['data'] as {
          revision: number;
          active: boolean;
          detail: { targetAmount: { amount: string } };
        }[]
      ).map((x) => [x.revision, x.active, x.detail.targetAmount.amount]),
    ).toEqual([
      [1, false, '685.00'],
      [2, true, '686.00'],
    ]);
    expect((await audits(u, conversionId)).map((a) => [a.action, a.reason])).toEqual([
      ['transactions.conversion.created', null],
      ['transactions.conversion.amended', 'monto real según extracto'],
    ]);
    const recorded = (await outbox(u, conversionId)).filter(
      (e) => e.event_type === 'transactions.ConversionRecorded',
    );
    expect(recorded.map((e) => (e.envelope.payload as { revision: number }).revision)).toEqual([1, 2]);
  });

  it('[TC-TRANSACTIONS-CONVERSION-005] USDT→BTC con fee de red en TRX desde Wallet TRX: un asiento que cuadra en tres monedas', async () => {
    const r = await post(
      u,
      '/conversions',
      canonical({
        targetAccountId: walletBtc,
        sourceAmount: { amount: '1000.000000', currency: 'USDT' },
        targetAmount: { amount: '0.01600000', currency: 'BTC' },
        quotedRate: { base: 'BTC', quote: 'USDT', value: '62375' },
        fees: [
          { type: 'PROVIDER', amount: { amount: '2.000000', currency: 'USDT' } },
          { type: 'NETWORK', amount: { amount: '15.000000', currency: 'TRX' }, paidFromAccountId: walletTrx },
        ],
      }),
    );
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const postings = await postingsOf(u, r.body['id'] as string);
    expect(postings.map((p) => [p.who, p.amount])).toEqual([
      [walletUsdt, '-1000'],
      ['EQUITY:FX_TRADING:USDT', '998'],
      ['EQUITY:FX_TRADING:BTC', '-0.016'],
      [walletBtc, '0.016'],
      ['EXPENSE:USDT', '2'],
      [walletTrx, '-15'],
      ['EXPENSE:TRX', '15'],
    ]);
    expect(await balanceOf(u, walletTrx)).toBe('35');
    expect(r.body['conversion']).toMatchObject({
      effectiveRate: { base: 'BTC', quote: 'USDT', value: '62500.000000000000000000' },
      totalCost: { complete: false },
    });
  });

  it('[TC-TRANSACTIONS-CONVERSION-003] [TC-TRANSACTIONS-CONVERSION-007] validaciones por HTTP: misma moneda, moneda distinta y escala', async () => {
    expectProblem(
      await post(
        u,
        '/conversions',
        canonical({
          sourceAccountId: bankBob,
          targetAccountId: cashBob,
          sourceAmount: { amount: '100.00', currency: 'BOB' },
          targetAmount: { amount: '100.00', currency: 'BOB' },
          fees: [],
        }),
      ),
      422,
      'CONVERSION_SAME_CURRENCY',
    );
    expectProblem(
      await post(u, '/conversions', canonical({ sourceAmount: { amount: '100.00', currency: 'USD' } })),
      422,
      'CURRENCY_MISMATCH',
    );
    expectProblem(
      await post(u, '/conversions', canonical({ sourceAmount: { amount: '100.0000001', currency: 'USDT' } })),
      422,
      'AMOUNT_SCALE_EXCEEDED',
    );
    expectProblem(
      await post(
        u,
        '/conversions',
        canonical({ fees: [{ type: 'PROVIDER', amount: { amount: '5.001', currency: 'BOB' } }] }),
      ),
      422,
      'AMOUNT_SCALE_EXCEEDED',
    );
    expectProblem(
      await post(
        u,
        '/conversions',
        canonical({ fees: [{ type: 'NETWORK', amount: { amount: '15.000000', currency: 'TRX' } }] }),
      ),
      422,
      'CONVERSION_AMOUNTS_INCONSISTENT',
    );
  });

  it('vista previa sin efectos, listado por moneda y autorización (VIEWER no registra; otro workspace no ve)', async () => {
    const preview = await call('POST', `${W(u)}/conversions/preview`, {
      token: u.token,
      body: {
        sourceCurrency: 'USDT',
        targetCurrency: 'BOB',
        sourceAmount: { amount: '100.000000', currency: 'USDT' },
        quotedRate: { base: 'USDT', quote: 'BOB', value: '6.90' },
        fees: [{ type: 'PROVIDER', amount: { amount: '5.00', currency: 'BOB' } }],
        executedAt: EXECUTED,
        referenceFxRateId: r2,
      },
    });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(contract().validateResponse('previewConversion', 200, preview.body)).toEqual([]);
    expect(preview.body).toMatchObject({
      targetAmount: { amount: '685.00', currency: 'BOB' },
      effectiveRate: { value: '6.850000000000000000' },
      totalCost: { amount: { amount: '10.00', currency: 'BOB' }, complete: true },
    });
    const listed = await call('GET', `${W(u)}/conversions?sourceCurrency=USDT&targetCurrency=BTC`, {
      token: u.token,
    });
    expect(contract().validateResponse('listConversions', 200, listed.body)).toEqual([]);
    expect((listed.body['data'] as { kind: string }[]).map((t) => t.kind)).toEqual(['CONVERSION']);
    expectProblem(await post(other, '/conversions', canonical()), 422, 'REFERENCE_NOT_FOUND');
    expectProblem(
      await call('GET', `${W(other)}/conversions/${conversionId}`, { token: other.token }),
      404,
      'RESOURCE_NOT_FOUND',
    );
    const viewerOfU = await user(`kc-conv-viewer-${randomUUID()}`);
    const app = await connect(deps.databaseUrl);
    try {
      await inTx(
        app,
        { userId: u.id, workspaceId: u.ws },
        () =>
          app.query(
            `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'VIEWER', 'ACTIVE')`,
            [u.ws, viewerOfU.id],
          ),
        true,
      );
    } finally {
      await app.end();
    }
    const asViewer = { ...viewerOfU, ws: u.ws };
    expectProblem(await post(asViewer, '/conversions', canonical()), 403, 'INSUFFICIENT_ROLE');
    expect(
      (await call('GET', `${W(asViewer)}/conversions/${conversionId}`, { token: asViewer.token })).status,
    ).toBe(200);
  });
});
