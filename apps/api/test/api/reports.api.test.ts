import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createFxMarketRateJobs, parseFxProviderSettings } from '@pf/fx/interface/fx.module';
import { ApiContract } from '@pf/platform/api';
import { EventConsumerRuntime, EventSubscriptions, PgOutboxWriter } from '@pf/platform/events';
import { uuidv7 } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';
import { reportingDataVersionConsumer } from '@pf/reporting/interface/reporting.module';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, enableCurrencies } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Resumen del Home por HTTP contra PostgreSQL real (Testcontainers): saldos, flujos y patrimonio leídos de la fuente
// de verdad vía los contratos públicos de LEDGER/TRANSACTIONS/ACCOUNTS/CLASSIFICATION/FX, tasas de provider
// registradas por la ingesta REAL del worker contra un servidor HTTP local con respuestas grabadas (sin red), ETag/304,
// lectura inmediata tras un POST y aislamiento entre workspaces (openspec add-basic-dashboard, tareas 4.2 y 5.1).
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const FIXTURES = fileURLToPath(
  new URL('../../../../packages/contexts/fx/test/fixtures/providers/', import.meta.url),
);
const fixture = (name: string) => readFileSync(`${FIXTURES}${name}`, 'utf8');

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
let providerServer: Server;
let providerUrl: string;
let worker: Pool;
const routes = new Map<string, string>();
// 2026-10-02T09:06:00Z = 05:06 en La Paz; paralelo.bo publicó 12.02 a las 08:53:07.532Z (hace 772 s).
const NOW = '2026-10-02T09:06:00Z';
const clock = new FixedClock(Instant.parse(NOW));
const contract = ApiContract.fromFile(resolveContractPath());
const apiLog = capturingLogger('finance-api', 'api');
const apiErrors = () =>
  JSON.stringify(apiLog.records().filter((r) => Number(r['level']) >= 50 || r['level'] === 'error'));

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}
type Money = { amount: string; currency: string };
const m = (x: Money | null | undefined) => (x ? `${x.amount} ${x.currency}` : null);

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

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId };
}
type User = Awaited<ReturnType<typeof user>>;
const W = (u: User) => `/api/v1/workspaces/${u.ws}`;

async function post(u: User, path: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await call('POST', `${W(u)}${path}`, {
    token: u.token,
    body,
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
  expect(r.status, `${path} ${JSON.stringify(r.body)} ${apiErrors()}`).toBeLessThan(300);
  return r.body;
}

async function account(u: User, name: string, type: string, currency: string, opening: string, extra = {}) {
  const body = await post(u, '/accounts', {
    name,
    type,
    currency,
    openingBalance: { amount: { amount: opening, currency }, date: '2026-09-01' },
    ...extra,
  });
  return body['id'] as string;
}

const summary = async (u: User, query = '', headers: Record<string, string> = {}) => {
  const r = await call('GET', `${W(u)}/reports/summary${query}`, { token: u.token, headers });
  if (r.status === 200) {
    expect(contract.validateResponse('getReportSummary', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  }
  return r;
};

/** Un ciclo de la ingesta del worker (pf_worker) con el reloj en `at`; siembra las preferencias PARALLEL. */
async function poll(at: string, workspaces: readonly User[]) {
  const previous = clock.now();
  clock.set(Instant.parse(at));
  const writer = new PgOutboxWriter(eventSchemaRegistry());
  const jobs = createFxMarketRateJobs({
    pool: worker,
    clock,
    outbox: { append: async (e) => void (await writer.append(e)) },
    workspaces: {
      list: async () => workspaces.map((u) => ({ workspaceId: u.ws, timeZone: 'America/La_Paz' })),
    },
    settings: parseFxProviderSettings({}),
    endpoints: {
      baseUrls: { PARALELO_BO: providerUrl, DOLARAPI_BO: providerUrl },
      allowedHosts: ['127.0.0.1'],
    },
  });
  for (const u of workspaces) await jobs.ingestion.seedPreferences(u.ws);
  await jobs.ingestion.poll();
  clock.set(previous);
}

let canonical: User;
let flows: User;
let empty: User;
let lifecycle: User;
const ids: Record<string, string> = {};

beforeAll(async () => {
  providerServer = createServer((req, res) => {
    const body = routes.get(req.url ?? '');
    if (body === undefined) res.writeHead(503).end('{"error":"down"}');
    else res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(body);
  });
  await new Promise<void>((r) => providerServer.listen(0, '127.0.0.1', r));
  providerUrl = `http://127.0.0.1:${(providerServer.address() as AddressInfo).port}`;
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(
      baseEnv(deps, {
        FX_PROVIDER_PRIMARY: 'paralelo_bo',
        FX_PROVIDER_FALLBACK: 'dolarapi_bo',
        FX_PROVIDER_OFFICIAL: 'dolarapi_bo',
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
  canonical = await user(`kc-rep-a-${randomUUID()}`);
  flows = await user(`kc-rep-b-${randomUUID()}`);
  empty = await user(`kc-rep-c-${randomUUID()}`);
  lifecycle = await user(`kc-rep-d-${randomUUID()}`);
  routes.set('/api/v1/rate', fixture('paralelo-bo/rate.ok.json'));
  routes.set('/v1/dolares', fixture('dolarapi-bo/dolares.ok.json'));
  await poll('2026-10-02T09:00:00Z', [canonical, flows, empty, lifecycle]);

  // Workspace A (ejemplo canónico de los TC): saldos y patrimonio.
  ids['banco'] = await account(canonical, 'Banco BOB', 'BANK', 'BOB', '685.00');
  ids['caja'] = await account(canonical, 'Caja BOB', 'CASH', 'BOB', '120.50');
  ids['wallet'] = await account(canonical, 'Wallet USDT', 'CRYPTO_WALLET', 'USDT', '50.000000');
  ids['visa'] = await account(canonical, 'Visa', 'CREDIT_CARD', 'BOB', '400.00');
  ids['oficina'] = await account(canonical, 'Caja oficina', 'CASH', 'BOB', '1000.00', {
    includeInNetWorth: false,
    liquidity: 'ILLIQUID',
  });
  ids['inversion'] = await account(canonical, 'Inversión', 'INVESTMENT', 'BOB', '5000.00', {
    includeInNetWorth: false,
  });
  // Gasto PENDIENTE de 30.00 BOB en Banco BOB: no altera el saldo (INV-023).
  await post(canonical, '/transactions', {
    kind: 'EXPENSE',
    status: 'PENDING',
    transactionDate: '2026-10-01',
    accountId: ids['banco'],
    amount: { amount: '30.00', currency: 'BOB' },
  });
}, 180_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
  await new Promise<void>((r) => providerServer?.close(() => r()));
});

describe('GET /reports/summary — saldos, dinero disponible y patrimonio (PG real)', () => {
  it('[TC-REPORTING-DASHBOARD-001] saldos por cuenta y totales por moneda solo con transacciones posteadas', async () => {
    const r = await summary(canonical, '?month=2026-10');
    expect(r.status, `${JSON.stringify(r.body)} ${apiErrors()}`).toBe(200);
    const accounts = r.body['accounts'] as { name: string; balance: Money; liquid: boolean }[];
    expect(accounts.map((a) => [a.name, m(a.balance)])).toEqual([
      ['Banco BOB', '685.00 BOB'],
      ['Caja BOB', '120.50 BOB'],
      ['Wallet USDT', '50.000000 USDT'],
      ['Visa', '400.00 BOB'],
      ['Caja oficina', '1000.00 BOB'],
      ['Inversión', '5000.00 BOB'],
    ]);
    const byCurrency = r.body['byCurrency'] as { currency: string; liquidBalance: Money }[];
    expect(byCurrency.map((c) => m(c.liquidBalance))).toEqual(['805.50 BOB', '50.000000 USDT']);
  });

  it('[TC-REPORTING-DASHBOARD-002] consolida 1406.50 BOB con USDT/BOB 12.02 PARALLEL de paralelo.bo (PRIMARY) y su atribución', async () => {
    const r = await summary(canonical);
    const consolidated = r.body['consolidated'] as { liquidBalance: Money; complete: boolean };
    expect(m(consolidated.liquidBalance)).toBe('1406.50 BOB');
    expect(consolidated.complete).toBe(true);
    const meta = r.body['meta'] as { ratesUsed: Record<string, unknown>[]; attributions: unknown[] };
    expect(meta.ratesUsed).toHaveLength(1);
    expect(meta.ratesUsed[0]).toMatchObject({
      rate: { base: 'USDT', quote: 'BOB', value: '12.02' },
      rateType: 'PARALLEL',
      source: 'PROVIDER',
      provider: 'PARALELO_BO',
      selection: 'PRIMARY',
      asOf: '2026-10-02T08:53:07.532Z',
      ageSeconds: 772,
      stale: false,
    });
    expect(meta.attributions).toEqual([
      {
        provider: 'PARALELO_BO',
        text: 'Fuente: paralelo.bo',
        url: 'https://paralelo.bo',
        license: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      },
    ]);
  });

  it('[TC-REPORTING-NETWORTH-001] [TC-REPORTING-NETWORTH-003] patrimonio 1006.50 BOB; las cuentas excluidas no suman', async () => {
    const r = await summary(canonical);
    const nw = r.body['netWorth'] as {
      assets: Money;
      liabilities: Money;
      netWorth: Money;
      complete: boolean;
      byAccountType: { type: string; amount: Money }[];
    };
    expect([m(nw.assets), m(nw.liabilities), m(nw.netWorth), nw.complete]).toEqual([
      '1406.50 BOB',
      '400.00 BOB',
      '1006.50 BOB',
      true,
    ]);
    expect(nw.byAccountType.map((t) => `${t.type} ${m(t.amount)}`).sort()).toEqual(
      ['BANK 685.00 BOB', 'CASH 120.50 BOB', 'CREDIT_CARD -400.00 BOB', 'CRYPTO_WALLET 601.00 BOB'].sort(),
    );
  });

  it('[TC-REPORTING-NETWORTH-001] (regresión) una cuenta BTC sin postings con BTC no habilitada no rompe el resumen (escala 8 del catálogo, no 18)', async () => {
    const btc = await user(`kc-rep-e-${randomUUID()}`);
    // docs/31 D45: abrir cuentas BTC exige BTC habilitada; luego se deshabilita (datos previos a la deshabilitación,
    // sin endpoint en Phase 1: directo en la BD) para conservar la regresión "cuenta en moneda no habilitada".
    await enableCurrencies(deps.databaseUrl, { userId: btc.id, workspaceId: btc.ws }, ['BTC']);
    await account(btc, 'Cold Wallet BTC', 'CRYPTO_WALLET', 'BTC', '0.01000000');
    await post(btc, '/accounts', { name: 'Exchange BTC', type: 'CRYPTO_WALLET', currency: 'BTC' });
    const admin = await connect(deps.superuserUrl);
    try {
      await admin.query(
        `DELETE FROM fx.workspace_currency WHERE workspace_id = $1 AND currency_code = 'BTC'`,
        [btc.ws],
      );
    } finally {
      await admin.end();
    }
    const currencies = await call('GET', `${W(btc)}/currencies?enabled=true`, { token: btc.token });
    expect(currencies.status).toBe(200);
    expect(JSON.stringify(currencies.body)).not.toContain('"BTC"');

    const r = await summary(btc);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const lines = r.body['accounts'] as { name: string; balance: Money }[];
    expect(lines.map((l) => [l.name, m(l.balance)])).toEqual([
      ['Cold Wallet BTC', '0.01000000 BTC'],
      ['Exchange BTC', '0.00000000 BTC'],
    ]);
    const byCurrency = r.body['byCurrency'] as { currency: string; liquidBalance: Money; netWorth: Money }[];
    expect(byCurrency.map((c) => [c.currency, m(c.liquidBalance), m(c.netWorth)])).toEqual([
      ['BTC', '0.01000000 BTC', '0.01000000 BTC'],
    ]);
  });

  it('[TC-REPORTING-DASHBOARD-007] con providers caídos usa la última tasa marcada obsoleta y luego una manual más reciente', async () => {
    clock.set(Instant.parse('2026-10-02T17:00:00Z')); // 8 h 6 min 52 s después de la última tasa de provider
    try {
      let r = await summary(canonical);
      expect(m((r.body['consolidated'] as { liquidBalance: Money }).liquidBalance)).toBe('1406.50 BOB');
      let rate = (r.body['meta'] as { ratesUsed: Record<string, unknown>[] }).ratesUsed[0];
      expect(rate).toMatchObject({ selection: 'LAST_KNOWN_STALE', stale: true, ageSeconds: 29212 });
      await post(canonical, '/fx-rates', {
        base: 'USDT',
        quote: 'BOB',
        value: '11.98',
        // Manual de OTRO tipo (P2P) que compite en el último recurso por fresca (1 h <= 24 h) y confiable (desvío
        // 0.33 % <= 5 %) (docs/31 D34/D38; antes se automatizaba como PARALLEL).
        rateType: 'P2P',
        asOf: '2026-10-02T16:00:00Z',
        sourceLabel: 'Casa de cambio centro',
      });
      r = await summary(canonical);
      expect(m((r.body['consolidated'] as { liquidBalance: Money }).liquidBalance)).toBe('1404.50 BOB');
      rate = (r.body['meta'] as { ratesUsed: Record<string, unknown>[] }).ratesUsed[0];
      expect(rate).toMatchObject({
        rate: { base: 'USDT', quote: 'BOB', value: '11.98' },
        rateType: 'P2P',
        source: 'MANUAL',
        selection: 'MANUAL',
        sourceLabel: 'Casa de cambio centro',
        attribution: null,
      });
      expect((r.body['meta'] as { attributions: unknown[] }).attributions).toEqual([]);
    } finally {
      clock.set(Instant.parse(NOW));
    }
  });
});

describe('GET /reports/summary — cuentas cerradas/archivadas y último recurso con manuales de otro tipo (D34, D35)', () => {
  const acc: Record<string, string> = {};
  const action = async (accountId: string, name: 'close' | 'archive', body: unknown) => {
    const current = await call('GET', `${W(lifecycle)}/accounts/${accountId}`, { token: lifecycle.token });
    const r = await call('POST', `${W(lifecycle)}/accounts/${accountId}/${name}`, {
      token: lifecycle.token,
      body,
      headers: { 'idempotency-key': randomUUID(), 'if-match': `"${String(current.body['version'])}"` },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };
  const bare = async (name: string, type: string) =>
    (await post(lifecycle, '/accounts', { name, type, currency: 'BOB', openedOn: '2026-01-02' }))[
      'id'
    ] as string;

  beforeAll(async () => {
    acc['banco'] = await account(lifecycle, 'Banco BOB', 'BANK', 'BOB', '685.00');
    acc['caja'] = await account(lifecycle, 'Caja BOB', 'CASH', 'BOB', '120.50');
    acc['wallet'] = await account(lifecycle, 'Wallet USDT', 'CRYPTO_WALLET', 'USDT', '50.000000');
    acc['viejo'] = await bare('Banco Viejo', 'BANK');
    acc['antigua'] = await bare('Caja Antigua', 'CASH');
    expect((await action(acc['viejo'], 'close', { closedOn: '2026-08-31' }))['status']).toBe('CLOSED');
    expect((await action(acc['antigua'], 'archive', { reason: 'ya no se usa' }))['status']).toBe('ARCHIVED');
  }, 60_000);

  it('[TC-REPORTING-DASHBOARD-008] el resumen lista la cuenta CLOSED no archivada con 0.00 BOB y excluye la archivada; totales 805.50 BOB y 50.000000 USDT', async () => {
    const r = await summary(lifecycle);
    expect(r.status, `${JSON.stringify(r.body)} ${apiErrors()}`).toBe(200);
    const accounts = r.body['accounts'] as { accountId: string; name: string; balance: Money }[];
    expect(accounts.map((a) => [a.name, m(a.balance)])).toEqual([
      ['Banco BOB', '685.00 BOB'],
      ['Caja BOB', '120.50 BOB'],
      ['Wallet USDT', '50.000000 USDT'],
      ['Banco Viejo', '0.00 BOB'],
    ]);
    expect(accounts.find((a) => a.name === 'Banco Viejo')?.accountId).toBe(acc['viejo']);
    const closed = await call('GET', `${W(lifecycle)}/accounts/${acc['viejo']}`, { token: lifecycle.token });
    expect(closed.body['status']).toBe('CLOSED');
    const byCurrency = r.body['byCurrency'] as { currency: string; liquidBalance: Money }[];
    expect(byCurrency.map((c) => m(c.liquidBalance))).toEqual(['805.50 BOB', '50.000000 USDT']);
  });

  it('[TC-REPORTING-DASHBOARD-009] con providers caídos una manual P2P vieja (31 h) o anómala (8.49 %) se descarta y se usa la última del provider marcada obsoleta', async () => {
    // Última tasa del provider: USDT/BOB PARALLEL 12.02 de 2026-10-02T08:53:07.532Z; ahora 2026-10-03T17:00Z (32 h).
    clock.set(Instant.parse('2026-10-03T17:00:00Z'));
    try {
      const expectLastKnown = async () => {
        const r = await summary(lifecycle);
        expect(r.status, `${JSON.stringify(r.body)} ${apiErrors()}`).toBe(200);
        expect(m((r.body['consolidated'] as { liquidBalance: Money }).liquidBalance)).toBe('1406.50 BOB');
        const rates = (r.body['meta'] as { ratesUsed: Record<string, unknown>[] }).ratesUsed;
        expect(rates).toHaveLength(1);
        expect(rates[0]).toMatchObject({
          rate: { base: 'USDT', quote: 'BOB', value: '12.02' },
          rateType: 'PARALLEL',
          source: 'PROVIDER',
          provider: 'PARALELO_BO',
          selection: 'LAST_KNOWN_STALE',
          stale: true,
        });
      };
      await expectLastKnown();
      // Caso A: manual P2P más reciente que la del provider pero con 31 h (> 24 h, FX_MANUAL_FALLBACK_MAX_AGE).
      await post(lifecycle, '/fx-rates', {
        base: 'USDT',
        quote: 'BOB',
        value: '11.98',
        rateType: 'P2P',
        asOf: '2026-10-02T10:00:00Z',
        sourceLabel: 'Casa de cambio centro',
      });
      await expectLastKnown();
      // Caso B: manual P2P fresca (1 h) pero con desvío |11.00 - 12.02| / 12.02 = 8.49 % (> 5 %).
      await post(lifecycle, '/fx-rates', {
        base: 'USDT',
        quote: 'BOB',
        value: '11.00',
        rateType: 'P2P',
        asOf: '2026-10-03T16:00:00Z',
        sourceLabel: 'Casa de cambio centro',
      });
      await expectLastKnown();
      // Contraste: manual P2P fresca (30 min) y confiable (0.33 %) => se usa (variante de TC-REPORTING-DASHBOARD-007).
      await post(lifecycle, '/fx-rates', {
        base: 'USDT',
        quote: 'BOB',
        value: '11.98',
        rateType: 'P2P',
        asOf: '2026-10-03T16:30:00Z',
        sourceLabel: 'Casa de cambio centro',
      });
      const r = await summary(lifecycle);
      expect(m((r.body['consolidated'] as { liquidBalance: Money }).liquidBalance)).toBe('1404.50 BOB');
      expect((r.body['meta'] as { ratesUsed: Record<string, unknown>[] }).ratesUsed[0]).toMatchObject({
        rate: { base: 'USDT', quote: 'BOB', value: '11.98' },
        rateType: 'P2P',
        source: 'MANUAL',
        selection: 'MANUAL',
      });
    } finally {
      clock.set(Instant.parse(NOW));
    }
  });
});

describe('GET /reports/summary — flujos del mes (PG real)', () => {
  let banco: string;
  let caja: string;
  let visa: string;
  let wallet: string;
  let sup: string;
  let res: string;

  beforeAll(async () => {
    banco = await account(flows, 'Banco BOB', 'BANK', 'BOB', '20000.00');
    caja = await account(flows, 'Caja BOB', 'CASH', 'BOB', '0.00');
    visa = await account(flows, 'Visa', 'CREDIT_CARD', 'BOB', '400.00');
    wallet = await account(flows, 'Wallet USDT', 'CRYPTO_WALLET', 'USDT', '500.000000');
    const cats = await call('GET', `${W(flows)}/categories?kind=EXPENSE`, { token: flows.token });
    const expense = (cats.body['data'] as { id: string; systemCode: string | null }[]).filter(
      (c) => c.systemCode === null,
    );
    sup = expense[0]!.id;
    res = expense[1]!.id;
    const tx = (body: Record<string, unknown>) => post(flows, '/transactions', body);
    const bob = (amount: string) => ({ amount, currency: 'BOB' });
    await tx({ kind: 'INCOME', transactionDate: '2026-10-01', accountId: banco, amount: bob('8000.00') });
    await tx({
      kind: 'EXPENSE',
      transactionDate: '2026-10-01',
      accountId: banco,
      amount: bob('1200.00'),
      splits: [{ amount: bob('1200.00'), categoryId: sup }],
    });
    const resto = await tx({
      kind: 'EXPENSE',
      transactionDate: '2026-10-01',
      accountId: banco,
      amount: bob('300.00'),
      splits: [{ amount: bob('300.00'), categoryId: res }],
    });
    await tx({
      kind: 'REFUND',
      transactionDate: '2026-10-02',
      accountId: banco,
      amount: bob('200.00'),
      refundOfTransactionId: resto['id'],
      splits: [{ amount: bob('200.00'), categoryId: res }],
    });
    // Transferencia entre cuentas propias y pago de tarjeta: no son gasto (INV-030).
    await post(flows, '/transfers', {
      transactionDate: '2026-10-01',
      fromAccountId: banco,
      toAccountId: caja,
      amount: bob('1000.00'),
    });
    await post(flows, '/transfers', {
      transactionDate: '2026-10-02',
      fromAccountId: banco,
      toAccountId: visa,
      amount: bob('400.00'),
    });
    // Conversión 100 USDT → 1195.00 BOB con fee 5.00 BOB: solo el fee es gasto.
    await post(flows, '/conversions', {
      transactionDate: '2026-10-02',
      sourceAccountId: wallet,
      targetAccountId: banco,
      sourceAmount: { amount: '100.000000', currency: 'USDT' },
      targetAmount: bob('1195.00'),
      quotedRate: { base: 'USDT', quote: 'BOB', value: '12.00' },
      fees: [{ type: 'PROVIDER', amount: bob('5.00') }],
      executedAt: '2026-10-02T09:00:00Z',
    });
    // Estados: CLEARED suma; PENDING y VOIDED no (INV-023).
    await tx({
      kind: 'EXPENSE',
      status: 'CLEARED',
      transactionDate: '2026-10-02',
      accountId: banco,
      amount: bob('100.00'),
    });
    await tx({
      kind: 'EXPENSE',
      status: 'PENDING',
      transactionDate: '2026-10-02',
      accountId: banco,
      amount: bob('300.00'),
    });
    const voided = await tx({
      kind: 'EXPENSE',
      transactionDate: '2026-10-02',
      accountId: banco,
      amount: bob('50.00'),
    });
    const v = await call('POST', `${W(flows)}/transactions/${String(voided['id'])}/void`, {
      token: flows.token,
      body: { reason: 'cargado por error' },
      headers: { 'idempotency-key': randomUUID(), 'if-match': `"${String(voided['version'])}"` },
    });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    // Fecha de negocio 30-sep registrada el 2026-10-01T02:30:00Z (aún 30-sep en La Paz).
    clock.set(Instant.parse('2026-10-01T02:30:00Z'));
    try {
      await tx({ kind: 'EXPENSE', transactionDate: '2026-09-30', accountId: banco, amount: bob('150.00') });
    } finally {
      clock.set(Instant.parse(NOW));
    }
  }, 120_000);

  it('[TC-REPORTING-KPI-001] [TC-REPORTING-KPI-002] [TC-REPORTING-KPI-005] ingresos 8000.00 y gastos 1405.00 (fee incluido, reembolso, transferencias, pendiente y anulado excluidos)', async () => {
    const r = await summary(flows, '?month=2026-10');
    expect(r.status, `${JSON.stringify(r.body)} ${apiErrors()}`).toBe(200);
    const c = r.body['consolidated'] as { income: Money; expense: Money; net: Money; savingsRate: string };
    // 1200.00 + 300.00 − 200.00 + 5.00 (fee) + 100.00 (CLEARED) = 1405.00
    expect([m(c.income), m(c.expense), m(c.net), c.savingsRate]).toEqual([
      '8000.00 BOB',
      '1405.00 BOB',
      '6595.00 BOB',
      '82.4',
    ]);
    const top = r.body['topExpenseCategories'] as { categoryId: string; amount: Money }[];
    expect(top[0]).toMatchObject({ categoryId: sup, amount: { amount: '1200.00', currency: 'BOB' } });
    expect(top.find((t) => t.categoryId === res)?.amount).toEqual({ amount: '100.00', currency: 'BOB' });
  });

  it('[TC-REPORTING-KPI-008] el gasto con fecha de negocio 30-sep registrado a las 02:30Z cuenta en septiembre y no en octubre', async () => {
    const sep = await summary(flows, '?month=2026-09&compare=NONE');
    expect(m((sep.body['consolidated'] as { expense: Money }).expense)).toBe('150.00 BOB');
    expect(sep.body['comparison']).toBeNull();
    const oct = await summary(flows, '?month=2026-10');
    const cmp = oct.body['comparison'] as { previousPeriod: unknown; expense: { previous: Money } };
    // Comparación a la fecha: 1..2 de octubre contra 1..2 de septiembre (el 30-sep queda fuera).
    expect(cmp.previousPeriod).toEqual({ from: '2026-09-01', to: '2026-09-02' });
    expect(m(cmp.expense.previous)).toBe('0.00 BOB');
  });

  it('[TC-REPORTING-DASHBOARD-006] un gasto recién posteado aparece en la siguiente lectura; ETag e If-None-Match', async () => {
    const first = await summary(flows, '?month=2026-10');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^W\/".+"$/);
    expect((await summary(flows, '?month=2026-10', { 'if-none-match': etag! })).status).toBe(304);
    await post(flows, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: '2026-10-02',
      accountId: banco,
      amount: { amount: '50.00', currency: 'BOB' },
      splits: [{ amount: { amount: '50.00', currency: 'BOB' }, categoryId: sup }],
    });
    const after = await summary(flows, '?month=2026-10', { 'if-none-match': etag! });
    expect(after.status).toBe(200);
    expect(m((after.body['consolidated'] as { expense: Money }).expense)).toBe('1455.00 BOB');
    expect(after.body['period']).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(after.body['meta']).toMatchObject({
      reportingCurrency: 'BOB',
      generatedAt: '2026-10-02T09:06:00.000Z',
      timeZone: 'America/La_Paz',
    });
    expect((after.body['meta'] as { dataFreshness?: string }).dataFreshness).toEqual(expect.any(String));
    expect(after.headers.get('etag')).not.toBe(etag);
  });

  it('[TC-REPORTING-KPI-006] topCategories = 21 se rechaza con 400 VALIDATION_FAILED; reportingCurrency no habilitada 422', async () => {
    const bad = await summary(flows, '?topCategories=21');
    expect(bad.status).toBe(400);
    expect(bad.body['code']).toBe('VALIDATION_FAILED');
    const ccy = await summary(flows, '?reportingCurrency=EUR');
    expect(ccy.status, JSON.stringify(ccy.body)).toBe(422);
    expect(ccy.body['code']).toBe('CURRENCY_NOT_ENABLED');
  });
});

describe('GET /reports/summary — aislamiento y preguntas del Home', () => {
  it('[TC-REPORTING-DASHBOARD-005] workspace sin cuentas: Q1 NO_DATA; Q4, Q5, Q8 y Q9 NOT_AVAILABLE_IN_PHASE', async () => {
    const r = await summary(empty);
    expect(r.status).toBe(200);
    const q = Object.fromEntries(
      (r.body['questions'] as { question: string; status: string }[]).map((x) => [x.question, x.status]),
    );
    expect(q).toMatchObject({
      Q1: 'NO_DATA',
      Q4: 'NOT_AVAILABLE_IN_PHASE',
      Q5: 'NOT_AVAILABLE_IN_PHASE',
      Q8: 'NOT_AVAILABLE_IN_PHASE',
      Q9: 'NOT_AVAILABLE_IN_PHASE',
    });
    expect(r.body['accounts']).toEqual([]);
  });

  it('aislamiento: un workspace no ve cuentas ni flujos de otro y no puede leer su resumen', async () => {
    const r = await summary(empty, '?month=2026-10');
    expect(m((r.body['consolidated'] as { income: Money }).income)).toBe('0.00 BOB');
    const foreign = await call('GET', `${W(canonical)}/reports/summary`, { token: empty.token });
    expect([403, 404]).toContain(foreign.status);
  });
});

describe('Consumidor reporting.data-version (platform.inbox)', () => {
  it('un evento duplicado no incrementa dos veces la versión; el ETag del resumen cambia con la versión', async () => {
    const def = reportingDataVersionConsumer();
    expect(def.events.map((e) => `${e.type}.v${e.version}`)).toEqual([
      'ledger.JournalEntryPosted.v1',
      'transactions.TransactionPosted.v1',
      'transactions.TransactionVoided.v1',
      'transactions.TransactionCategorized.v1',
      'transactions.TransferRevised.v1',
      'transactions.ConversionRevised.v1',
      'accounts.AccountOpened.v1',
      'accounts.AccountArchived.v1',
      'fx.RateRecorded.v1',
      'identity.DemoDataLoaded.v1',
    ]);
    const consumers = new EventConsumerRuntime({
      pool: worker,
      queue: {} as JobQueue,
      subscriptions: new EventSubscriptions([def]),
      logger: apiLog.logger,
    });
    const before = (await summary(empty)).headers.get('etag');
    expect(before).toMatch(/^W\/"0-/);
    const event = {
      eventId: uuidv7(),
      eventType: 'accounts.AccountOpened',
      eventVersion: 1,
      occurredAt: '2026-10-02T09:05:00.000Z',
      workspaceId: empty.ws,
      aggregateType: 'Account',
      aggregateId: randomUUID(),
      aggregateVersion: 1,
      correlationId: randomUUID(),
      causationId: null,
      actor: { type: 'USER' as const, id: empty.id },
      payload: {},
    };
    expect(await consumers.deliver(def, event)).toBe('applied');
    expect(await consumers.deliver(def, event)).toBe('duplicate');
    const client = await worker.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id', '', true), set_config('app.workspace_id', $1, true)`,
        [empty.ws],
      );
      const { rows } = await client.query<{ version: string }>(
        'SELECT version::text AS version FROM reporting.workspace_data_version WHERE workspace_id = $1',
        [empty.ws],
      );
      await client.query('COMMIT');
      expect(rows).toEqual([{ version: '1' }]);
    } finally {
      client.release();
    }
    const after = await summary(empty, '', { 'if-none-match': before! });
    expect(after.status).toBe(200);
    expect(after.headers.get('etag')).toMatch(/^W\/"1-/);
  });
});
