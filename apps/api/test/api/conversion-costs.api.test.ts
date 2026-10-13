import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createUserConversionObservations, userConversionConsumers } from '@pf/fx/interface/fx.module';
import { ApiContract } from '@pf/platform/api';
import { PgOutboxWriter, type EventEnvelope } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { createConversionDetailQuery } from '@pf/transactions/interface/transactions.module';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool, type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { conversionBackfillSource } from '../../src/worker/fx-jobs.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Análisis de costo de conversiones por HTTP contra PostgreSQL real (openspec add-conversion-cost-analysis, tareas 5.3 y
// 6.2): conversiones reales (ledger + ConversionDetail), revisión vigente, anulación, aislamiento por workspace, solo
// lectura, roles, validación del rango, CSV y cuota de operaciones costosas.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const COSTLY = 10;
// 2026-10-20 12:00 en La Paz.
const clock = new FixedClock(Instant.parse('2026-10-20T16:00:00Z'));
const contract = ApiContract.fromFile(resolveContractPath());

type Json = Record<string, unknown>;
interface Reply {
  status: number;
  headers: Headers;
  body: Json;
  text: string;
}
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
    exp: now + 600,
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
  let body: Json = {};
  if ((res.headers.get('content-type') ?? '').includes('json') && text) body = JSON.parse(text) as Json;
  return { status: res.status, headers: res.headers, body, text };
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
const post = (u: User, path: string, body: unknown) =>
  call('POST', `${W(u)}${path}`, { token: u.token, body, headers: { 'idempotency-key': randomUUID() } });
const get = (u: User, path: string) => call('GET', `${W(u)}${path}`, { token: u.token });
const ok = (r: Reply, status = 200) => {
  expect(r.status, `${JSON.stringify(r.body)} ${JSON.stringify(apiLog.records().slice(-3))}`).toBe(status);
  return r.body;
};

async function asApp<T>(u: User, fn: (c: Client) => Promise<T>): Promise<T> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, () => fn(app));
  } finally {
    await app.end();
  }
}

async function addViewer(owner: User, member: User): Promise<User> {
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: owner.id, workspaceId: owner.ws },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'VIEWER', 'ACTIVE')`,
          [owner.ws, member.id],
        ),
      true,
    );
  } finally {
    await app.end();
  }
  return { ...member, ws: owner.ws };
}

async function account(u: User, name: string, type: string, currency: string, opening: string) {
  const body = ok(
    await post(u, '/accounts', {
      name,
      type,
      currency,
      openingBalance: { amount: { amount: opening, currency }, date: '2026-09-01' },
    }),
    201,
  );
  return body['id'] as string;
}

interface World {
  readonly owner: User;
  readonly walletUsdt: string;
  readonly bankBob: string;
}

/** Workspace con Wallet USDT, Banco BOB y la referencia USDT/BOB P2P 12.00 (preferencia P2P del par). */
async function world(sub: string): Promise<World> {
  const owner = await user(`${sub}-${randomUUID()}`);
  const walletUsdt = await account(owner, 'Wallet USDT', 'CRYPTO_WALLET', 'USDT', '2000.000000');
  const bankBob = await account(owner, 'Banco BOB', 'BANK', 'BOB', '5000.00');
  ok(
    await post(owner, '/fx-rates', {
      base: 'USDT',
      quote: 'BOB',
      value: '12.00',
      rateType: 'P2P',
      asOf: '2026-10-01T12:00:00Z',
      sourceLabel: 'Referencia manual',
    }),
    201,
  );
  ok(
    await call('PUT', `${W(owner)}/fx-rate-preferences`, {
      token: owner.token,
      body: { data: [{ base: 'USDT', quote: 'BOB', rateType: 'P2P' }] },
      headers: { 'if-match': '"1"' },
    }),
  );
  return { owner, walletUsdt, bankBob };
}

/** Venta de `qty` USDT a `quoted` (referencia 12.00) por "Binance P2P", con fee opcional en BOB. */
async function sell(w: World, qty: string, quoted: string, fee?: string): Promise<string> {
  const gross = (Number(qty) * Number(quoted)).toFixed(2);
  const net = (Number(gross) - Number(fee ?? '0')).toFixed(2);
  const r = await post(w.owner, '/conversions', {
    transactionDate: '2026-10-05',
    sourceAccountId: w.walletUsdt,
    targetAccountId: w.bankBob,
    sourceAmount: { amount: qty, currency: 'USDT' },
    targetAmount: { amount: net, currency: 'BOB' },
    quotedRate: { base: 'USDT', quote: 'BOB', value: quoted },
    ...(fee ? { fees: [{ type: 'PROVIDER', amount: { amount: fee, currency: 'BOB' } }] } : {}),
    provider: { name: 'Binance P2P' },
    executedAt: '2026-10-05T14:00:00Z',
  });
  return ok(r, 201)['id'] as string;
}

/** Compra de `qty` USDT pagando `paid` BOB a `quoted`, sin contraparte. */
async function buy(w: World, qty: string, paid: string, quoted: string): Promise<string> {
  const r = await post(w.owner, '/conversions', {
    transactionDate: '2026-10-06',
    sourceAccountId: w.bankBob,
    targetAccountId: w.walletUsdt,
    sourceAmount: { amount: paid, currency: 'BOB' },
    targetAmount: { amount: qty, currency: 'USDT' },
    quotedRate: { base: 'USDT', quote: 'BOB', value: quoted },
    executedAt: '2026-10-06T14:00:00Z',
  });
  return ok(r, 201)['id'] as string;
}

const analysis = (u: User, query = 'from=2026-10-01&to=2026-10-31') =>
  get(u, `/reports/conversion-costs?${query}`);

interface Group {
  channel: { kind: string; name: string | null };
  sourceAccountName: string;
  targetAccountName: string;
  conversions: number;
  converted: { amount: string };
  spreadPct: string | null;
  spreadAmount: { amount: string };
  fees: { amount: string };
  costTotal: { amount: string };
  excluded: { reason: string; count: number }[];
}
const groupsOf = (r: Reply) => (r.body['groups'] as Group[]) ?? [];
const binanceOf = (r: Reply) => groupsOf(r).find((g) => g.channel.name === 'Binance P2P');

const COUNTS = `
  SELECT (SELECT count(*) FROM txn.transaction) AS tx,
         (SELECT count(*) FROM txn.conversion_detail) AS details,
         (SELECT count(*) FROM fx.exchange_rate WHERE workspace_id = platform.current_workspace_id()) AS rates,
         (SELECT count(*) FROM ledger.journal_entry) AS entries`;

let w1: World;
let viewer: User;
let w2: World;
let saleA: string;
let saleB: string;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(
      baseEnv(deps, {
        RATE_LIMIT_READS_PER_MIN: '100000',
        RATE_LIMIT_WRITES_PER_MIN: '100000',
        RATE_LIMIT_COSTLY_PER_MIN: String(COSTLY),
      }),
    ),
    apiLog.logger,
    {
      clock,
      identity: {
        jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
      },
    },
  );
  baseUrl = await runtime.listen(0, '127.0.0.1');
  w1 = await world('kc-cost-w1');
  viewer = await addViewer(w1.owner, await user(`kc-cost-viewer-${randomUUID()}`));
  saleA = await sell(w1, '100.000000', '11.90');
  saleB = await sell(w1, '300.000000', '11.94', '2.00');
  await buy(w1, '50.000000', '610.00', '12.20');
  // W2 también convierte por "Binance P2P" en octubre: nunca aparece en el análisis de W1.
  w2 = await world('kc-cost-w2');
  await sell(w2, '1000.000000', '11.50');
}, 180_000);

afterAll(async () => {
  await runtime?.close();
});

describe('GET /reports/conversion-costs (fx/conversion-pricing)', () => {
  it('[TC-FX-COST-005] el VIEWER y el OWNER ven los grupos de W1 con las mismas cifras y ninguna conversión de W2', async () => {
    const asViewer = await analysis(viewer);
    expect(asViewer.status, JSON.stringify(asViewer.body)).toBe(200);
    expect(contract.validateResponse('getConversionCostAnalysis', 200, asViewer.body)).toEqual([]);
    const binance = binanceOf(asViewer);
    expect(binance).toMatchObject({
      sourceAccountName: 'Wallet USDT',
      targetAccountName: 'Banco BOB',
      conversions: 2,
      converted: { amount: '4800.00' },
      spreadPct: '0.5833',
      spreadAmount: { amount: '28.00' },
      fees: { amount: '2.00' },
      costTotal: { amount: '30.00' },
    });
    const none = groupsOf(asViewer).find((g) => g.channel.kind === 'NONE');
    expect(none).toMatchObject({
      sourceAccountName: 'Banco BOB',
      targetAccountName: 'Wallet USDT',
      converted: { amount: '600.00' },
      spreadPct: '1.6667',
      spreadAmount: { amount: '10.00' },
    });
    expect(groupsOf(asViewer)).toHaveLength(2);
    const asOwner = await analysis(w1.owner);
    expect(asOwner.body['groups']).toEqual(asViewer.body['groups']);
    expect(asOwner.body['totals']).toEqual(asViewer.body['totals']);
    // W2 convirtió 1000 USDT: de haberse mezclado, el convertido de Binance no sería 4800.00.
    expect(binance?.converted.amount).toBe('4800.00');
  });

  it('[TC-FX-COST-005] la consulta no modifica ninguna conversión, tasa ni asiento', async () => {
    const before = await asApp(w1.owner, async (c) => (await c.query(COUNTS)).rows[0]);
    await analysis(w1.owner);
    await analysis(
      w1.owner,
      'from=2026-10-01&to=2026-10-31&grouping=CALENDAR_MONTH&compareWith=PARALLEL_SIDE',
    );
    const after = await asApp(w1.owner, async (c) => (await c.query(COUNTS)).rows[0]);
    expect(after).toEqual(before);
  });

  it('[TC-FX-COST-010] una conversión pendiente no cuenta en el análisis', async () => {
    const before = binanceOf(await analysis(w1.owner));
    const pending = await post(w1.owner, '/conversions', {
      status: 'PENDING',
      transactionDate: '2026-10-07',
      sourceAccountId: w1.walletUsdt,
      targetAccountId: w1.bankBob,
      sourceAmount: { amount: '10.000000', currency: 'USDT' },
      targetAmount: { amount: '119.00', currency: 'BOB' },
      quotedRate: { base: 'USDT', quote: 'BOB', value: '11.90' },
      provider: { name: 'Binance P2P' },
      executedAt: '2026-10-07T14:00:00Z',
    });
    expect(pending.status, JSON.stringify(pending.body)).toBe(201);
    const after = binanceOf(await analysis(w1.owner));
    expect(after).toEqual(before);
  });

  it('[TC-FX-COST-004] el mes calendario y el periodo financiero agrupan la conversión de octubre', async () => {
    const calendar = await analysis(w1.owner, 'from=2026-10-01&to=2026-10-31&grouping=CALENDAR_MONTH');
    expect(calendar.status, JSON.stringify(calendar.body)).toBe(200);
    expect((groupsOf(calendar)[0] as unknown as { period: { label: string } }).period.label).toBe('2026-10');
    const financial = await analysis(w1.owner, 'from=2026-10-01&to=2026-10-31&grouping=FINANCIAL_PERIOD');
    expect(financial.status, JSON.stringify(financial.body)).toBe(200);
  });

  it('[TC-FX-COST-005] un rango de más de 24 periodos o invertido responde 400 VALIDATION_FAILED', async () => {
    for (const q of ['from=2024-01-01&to=2026-10-31', 'from=2026-10-31&to=2026-10-01']) {
      const r = await analysis(w1.owner, q);
      expect(r.status, JSON.stringify(r.body)).toBe(400);
      expect(r.body['code']).toBe('VALIDATION_FAILED');
    }
  });

  it('[TC-FX-COST-010] la revisión vigente reemplaza a la anterior: la venta de 300 USDT revisada a 250 USDT', async () => {
    const before = binanceOf(await analysis(w1.owner));
    expect(before?.converted.amount).toBe('4800.00');
    const current = await get(w1.owner, `/conversions/${saleB}`);
    const revised = await call('PUT', `${W(w1.owner)}/conversions/${saleB}`, {
      token: w1.owner.token,
      body: {
        transactionDate: '2026-10-05',
        sourceAccountId: w1.walletUsdt,
        targetAccountId: w1.bankBob,
        sourceAmount: { amount: '250.000000', currency: 'USDT' },
        targetAmount: { amount: '2983.00', currency: 'BOB' },
        quotedRate: { base: 'USDT', quote: 'BOB', value: '11.94' },
        fees: [{ type: 'PROVIDER', amount: { amount: '2.00', currency: 'BOB' } }],
        provider: { name: 'Binance P2P' },
        executedAt: '2026-10-05T14:00:00Z',
        reason: 'monto real según extracto',
      },
      headers: { 'if-match': `"${String(current.body['version'])}"` },
    });
    expect(revised.status, JSON.stringify(revised.body)).toBe(200);
    const after = binanceOf(await analysis(w1.owner));
    // Solo cuenta la revisión vigente: 100 × 12.00 + 250 × 12.00 = 4200.00 BOB; spread 10.00 + 15.00 = 25.00 BOB.
    expect(after).toMatchObject({
      conversions: 2,
      converted: { amount: '4200.00' },
      spreadAmount: { amount: '25.00' },
    });
  });

  it('[TC-FX-COST-010] una conversión anulada no cuenta: anulada la venta de 100 USDT queda 1 conversión', async () => {
    const current = await get(w1.owner, `/transactions/${saleA}`);
    const voided = await call('POST', `${W(w1.owner)}/transactions/${saleA}/void`, {
      token: w1.owner.token,
      body: { reason: 'error de carga' },
      headers: {
        'idempotency-key': randomUUID(),
        'if-match': `"${String(current.body['version'])}"`,
      },
    });
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    const after = binanceOf(await analysis(w1.owner));
    expect(after).toMatchObject({ conversions: 1, converted: { amount: '3000.00' } });
  });
});

describe('GET /reports/conversion-costs/export (CSV)', () => {
  it('[TC-FX-COST-006] el VIEWER exporta una fila por grupo con montos decimales y cabeceras de descarga', async () => {
    const r = await get(viewer, '/reports/conversion-costs/export?from=2026-10-01&to=2026-10-31');
    expect(r.status, r.text).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/csv');
    expect(r.headers.get('content-disposition')).toBe(
      'attachment; filename="conversion-costs-2026-10-01-2026-10-31.csv"',
    );
    const lines = r.text
      .replace(/^\uFEFF/u, '')
      .trimEnd()
      .split('\r\n');
    expect(lines[0]).toContain('periodo,canal,cuenta_origen');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(
      lines.some((l) =>
        /^2026-10,Sin canal,Banco BOB,Wallet USDT,USDT\/BOB,1,600\.00,1\.6667,10\.00,/u.test(l),
      ),
    ).toBe(true);
  });

  it('[TC-FX-COST-006] la 11.ª exportación del minuto responde 429 RATE_LIMITED (cuota costosa)', async () => {
    const fresh = await user(`kc-cost-limit-${randomUUID()}`);
    for (let i = 0; i < COSTLY; i += 1) {
      const r = await get(fresh, '/reports/conversion-costs/export?from=2026-10-01&to=2026-10-31');
      expect(r.status, `exportación ${i + 1}: ${r.text}`).toBe(200);
    }
    const limited = await get(fresh, '/reports/conversion-costs/export?from=2026-10-01&to=2026-10-31');
    expect(limited.status).toBe(429);
    expect(limited.body['code']).toBe('RATE_LIMITED');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Observaciones USER_CONVERSION (fx/market-rates, D231): el consumidor real de FX sobre PostgreSQL con los eventos que
// publica TRANSACTIONS (leídos del outbox), sin pg-boss (la entrega se invoca directamente en su unidad de trabajo).

describe('Observaciones de conversiones propias (fx/market-rates)', () => {
  let workerPool: Pool;
  let w: World;
  const writer = new PgOutboxWriter(eventSchemaRegistry());
  const observations = () =>
    createUserConversionObservations({
      pool: workerPool,
      clock,
      outbox: {
        append: async (event) => {
          await writer.append(event);
        },
      },
    });
  const handler = () => {
    const [consumer] = userConversionConsumers(observations());
    return async (envelope: EventEnvelope) => {
      await consumer!.handler(envelope, {
        consumer: consumer!.consumer,
        attempt: 1,
        tx: undefined as never,
        signal: new AbortController().signal,
      });
    };
  };

  async function envelopes(u: User, aggregateId: string, type: string): Promise<EventEnvelope[]> {
    const client = await workerPool.connect();
    try {
      const { rows } = await client.query<{ envelope: EventEnvelope }>(
        'SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND aggregate_id = $2 AND event_type = $3 ORDER BY sequence',
        [u.ws, aggregateId, type],
      );
      return rows.map((r) => r.envelope);
    } finally {
      client.release();
    }
  }

  const observationsOf = async (u: User, extra = '') => {
    const r = await get(u, `/fx-rates?source=USER_CONVERSION&limit=100${extra}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(contract.validateResponse('listFxRates', 200, r.body)).toEqual([]);
    return r.body['data'] as {
      id: string;
      value: string;
      rateType: string;
      source: string;
      asOf: string;
      supersedesRateId: string | null;
      supersededByRateId: string | null;
      supersedeReason: string | null;
      conversionRef: { transactionId: string; revision: number };
      withdrawn: { at: string; reason: string } | null;
    }[];
  };

  beforeAll(async () => {
    workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
    w = await world('kc-obs');
  }, 120_000);

  afterAll(async () => {
    await workerPool?.end();
  });

  it('[TC-FX-USERCONV-001] la venta de USDT queda como observación idempotente: valor, vigencia y conversión de origen', async () => {
    const id = await sell(w, '100.000000', '11.90');
    const [recorded] = await envelopes(w.owner, id, 'transactions.ConversionRecorded');
    const deliver = handler();
    await deliver(recorded!);
    await deliver(recorded!);
    const found = await observationsOf(w.owner);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      value: '11.9',
      rateType: 'CUSTOM',
      source: 'USER_CONVERSION',
      asOf: '2026-10-05T14:00:00.000Z',
      conversionRef: { transactionId: id, revision: 1 },
      withdrawn: null,
      supersededByRateId: null,
    });
    // fx.RateRecorded.v1 de la observación válido contra su esquema, una sola vez.
    const rateEvents = await envelopes(w.owner, found[0]!.id, 'fx.RateRecorded');
    expect(rateEvents).toHaveLength(1);
    expect(eventSchemaRegistry().validate(rateEvents[0]!)).toBeUndefined();
    expect(rateEvents[0]!.payload).toMatchObject({ source: 'USER_CONVERSION', rateType: 'CUSTOM' });
  });

  it('[TC-FX-USERCONV-002] la observación más reciente no valora: la última tasa y la referencia siguen siendo las de la manual', async () => {
    const latest = await get(w.owner, '/fx-rates/latest?base=USDT&quote=BOB&asOf=2026-10-05T14:05:00Z');
    expect(latest.status, JSON.stringify(latest.body)).toBe(200);
    expect((latest.body['rate'] as { value: string }).value).toBe('12');
    expect(latest.body['source']).toBe('MANUAL');
  });

  it('[TC-FX-USERCONV-003] una conversión revisada reemplaza su observación y la anterior sigue consultable', async () => {
    const [first] = await observationsOf(w.owner);
    const txId = first!.conversionRef.transactionId;
    const current = await get(w.owner, `/conversions/${txId}`);
    const revised = await call('PUT', `${W(w.owner)}/conversions/${txId}`, {
      token: w.owner.token,
      body: {
        transactionDate: '2026-10-05',
        sourceAccountId: w.walletUsdt,
        targetAccountId: w.bankBob,
        sourceAmount: { amount: '100.000000', currency: 'USDT' },
        targetAmount: { amount: '1188.00', currency: 'BOB' },
        quotedRate: { base: 'USDT', quote: 'BOB', value: '11.88' },
        provider: { name: 'Binance P2P' },
        executedAt: '2026-10-05T14:00:00Z',
        reason: 'monto real según extracto',
      },
      headers: { 'if-match': `"${String(current.body['version'])}"` },
    });
    expect(revised.status, JSON.stringify(revised.body)).toBe(200);
    const [event] = await envelopes(w.owner, txId, 'transactions.ConversionRevised');
    const deliver = handler();
    await deliver(event!);
    await deliver(event!);
    const all = await observationsOf(w.owner, '&includeSuperseded=true');
    expect(all).toHaveLength(2);
    const next = all.find((o) => o.conversionRef.revision === 2);
    const previous = all.find((o) => o.conversionRef.revision === 1);
    expect(next).toMatchObject({
      value: '11.88',
      supersedesRateId: previous?.id,
      supersedeReason: 'conversión revisada',
    });
    expect(previous).toMatchObject({ value: '11.9', supersededByRateId: next?.id });
    // Solo la vigente aparece sin `includeSuperseded`.
    expect((await observationsOf(w.owner)).map((o) => o.value)).toEqual(['11.88']);
  });

  it('[TC-FX-USERCONV-003] una conversión anulada marca su observación como anulada sin cambiar su valor', async () => {
    const id = await buy(w, '10.000000', '121.00', '12.10');
    const [recorded] = await envelopes(w.owner, id, 'transactions.ConversionRecorded');
    const deliver = handler();
    await deliver(recorded!);
    const current = await get(w.owner, `/transactions/${id}`);
    const voided = await call('POST', `${W(w.owner)}/transactions/${id}/void`, {
      token: w.owner.token,
      body: { reason: 'error de carga' },
      headers: { 'idempotency-key': randomUUID(), 'if-match': `"${String(current.body['version'])}"` },
    });
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    const [voidEvent] = await envelopes(w.owner, id, 'transactions.TransactionVoided');
    await deliver(voidEvent!);
    await deliver(voidEvent!);
    const mine = (await observationsOf(w.owner)).find((o) => o.conversionRef.transactionId === id);
    expect(mine).toMatchObject({ value: '12.1', withdrawn: { reason: 'conversión anulada' } });
  });

  it('[TC-FX-USERCONV-001] la carga inicial registra las conversiones anteriores y repetirla no registra ninguna más', async () => {
    const legacy = await world('kc-obs-legacy');
    for (let i = 0; i < 12; i += 1) await sell(legacy, '1.000000', '11.90');
    const source = conversionBackfillSource(createConversionDetailQuery(workerPool));
    const run = () => observations().backfill(legacy.owner.ws, source);
    expect(await run()).toEqual({ recorded: 12, withdrawn: 0 });
    expect(await run()).toEqual({ recorded: 0, withdrawn: 0 });
    expect(await observationsOf(legacy.owner)).toHaveLength(12);
  }, 120_000);

  it('[TC-FX-USERCONV-004] el historial filtra por origen y las observaciones no aparecen en el filtro MANUAL', async () => {
    const manual = await get(w.owner, '/fx-rates?source=MANUAL&base=USDT&quote=BOB');
    expect(manual.status).toBe(200);
    expect((manual.body['data'] as { source: string }[]).every((r) => r.source === 'MANUAL')).toBe(true);
    const all = await get(w.owner, '/fx-rates?base=USDT&quote=BOB&limit=100');
    const sources = new Set((all.body['data'] as { source: string }[]).map((r) => r.source));
    expect(sources).toEqual(new Set(['MANUAL', 'USER_CONVERSION']));
  });
});
