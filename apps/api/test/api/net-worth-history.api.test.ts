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

// Evolución del patrimonio por HTTP contra PostgreSQL real (openspec add-net-worth-evolution, tareas 5.1 y 7.1): serie
// por periodo financiero con saldos a cada fecha (ledger real, backdated), tasas vigentes a cada fecha (FX real, tasas
// manuales con fecha), snapshot de cierre de PLANNING (month-closing real), cuentas archivadas, validación del rango,
// ETag/304 y rol VIEWER.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
// 2026-04-12 12:00 en La Paz: abril está en curso.
const clock = new FixedClock(Instant.parse('2026-04-12T16:00:00Z'));
const contract = ApiContract.fromFile(resolveContractPath());

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
  return { status: res.status, headers: res.headers, body };
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
const post = (u: User, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call('POST', `${W(u)}${path}`, {
    token: u.token,
    ...(body === undefined ? {} : { body }),
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
const get = (u: User, path: string, headers: Record<string, string> = {}) =>
  call('GET', `${W(u)}${path}`, { token: u.token, headers });
const put = (u: User, path: string, body: unknown, version: number) =>
  call('PUT', `${W(u)}${path}`, { token: u.token, body, headers: { 'if-match': `"${version}"` } });
const money = (amount: string, currency = 'BOB') => ({ amount, currency });
const ok = (r: Reply, status = 200) => {
  expect(r.status, `${JSON.stringify(r.body)} ${JSON.stringify(apiLog.records().slice(-3))}`).toBeLessThan(
    300,
  );
  expect(r.status).toBe(status);
  return r.body;
};

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

async function account(u: User, name: string, type: string, currency: string, opening: string, date: string) {
  const body = ok(
    await post(u, '/accounts', {
      name,
      type,
      currency,
      openingBalance: { amount: money(opening, currency), date },
    }),
    201,
  );
  return { id: body['id'] as string, version: body['version'] as number };
}

const tx = async (
  u: User,
  kind: 'INCOME' | 'EXPENSE',
  accountId: string,
  amount: string,
  date: string,
  currency = 'BOB',
) =>
  ok(
    await post(u, '/transactions', {
      kind,
      transactionDate: date,
      accountId,
      amount: money(amount, currency),
    }),
    201,
  );
const transfer = async (u: User, from: string, to: string, amount: string, date: string) =>
  ok(
    await post(u, '/transfers', {
      transactionDate: date,
      fromAccountId: from,
      toAccountId: to,
      amount: money(amount),
    }),
    201,
  );
const rate = async (u: User, value: string, asOf: string) =>
  ok(
    await post(u, '/fx-rates', {
      base: 'USDT',
      quote: 'BOB',
      value,
      rateType: 'PARALLEL',
      asOf,
      sourceLabel: 'Casa de cambio centro',
    }),
    201,
  );

const history = async (u: User, query = '', headers: Record<string, string> = {}) => {
  const r = await get(u, `/reports/net-worth/history${query}`, headers);
  if (r.status === 200) {
    expect(contract.validateResponse('getNetWorthHistory', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  }
  return r;
};
interface Point {
  period: string;
  asOf: string;
  assets: string;
  liabilities: string;
  netWorth: string;
  change: string | null;
  comparable: boolean;
  complete: boolean;
  unconverted: { amount: string; currency: string }[];
  source: string;
  closed: boolean;
  partial: boolean;
  ratesUsed: { rate: { value: string } }[];
}
const points = (r: Reply) => r.body['points'] as Point[];

let main: User;
let viewer: User;
let bank: { id: string; version: number };

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

  // Ejemplo canónico de tres meses (TC-REPORTING-NETWORTH-006): Banco BOB, Wallet USDT y tarjeta Visa.
  main = await user(`kc-nw-${randomUUID()}`);
  viewer = await addViewer(main, await user(`kc-nw-vw-${randomUUID()}`));
  bank = await account(main, 'Banco BOB', 'BANK', 'BOB', '2000.00', '2026-01-01');
  const wallet = await account(main, 'Wallet USDT', 'CRYPTO_WALLET', 'USDT', '100.000000', '2026-01-01');
  const visa = await account(main, 'Visa', 'CREDIT_CARD', 'BOB', '300.00', '2026-01-01');
  await tx(main, 'INCOME', bank.id, '800.00', '2026-02-05');
  await transfer(main, bank.id, visa.id, '300.00', '2026-02-12'); // paga la tarjeta: deuda 0.00
  await tx(main, 'EXPENSE', bank.id, '100.00', '2026-03-10');
  await tx(main, 'INCOME', wallet.id, '20.000000', '2026-03-15', 'USDT');
  await tx(main, 'EXPENSE', visa.id, '150.00', '2026-03-20');
  await rate(main, '10.00', '2026-01-31T20:00:00Z');
  await rate(main, '10.50', '2026-02-28T20:00:00Z');
  await rate(main, '11.00', '2026-03-31T20:00:00Z');
  await rate(main, '11.40', '2026-04-12T15:00:00Z');
  ok(await post(main, '/periods', { through: '2026-12-31' }), 200);
}, 240_000);

afterAll(async () => {
  await runtime?.close();
});

describe('GET /reports/net-worth/history — serie por periodo financiero (PG real)', () => {
  it('[TC-REPORTING-NETWORTH-006] enero a marzo: 2700.00, 3550.00 y 3570.00 BOB; marzo con activos 3720.00 y pasivos 150.00; abril parcial a hoy', async () => {
    const r = await history(main, '?from=2026-01&to=2026-04');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body['reportingCurrency']).toBe('BOB');
    const p = points(r);
    expect(p.map((x) => [x.period, x.asOf, x.netWorth, x.partial, x.complete])).toEqual([
      ['2026-01', '2026-01-31', '2700.00', false, true],
      ['2026-02', '2026-02-28', '3550.00', false, true],
      ['2026-03', '2026-03-31', '3570.00', false, true],
      // Abril a hoy (2026-04-12) con la tasa 11.40: 2400.00 + 120 × 11.40 − 150.00.
      ['2026-04', '2026-04-12', '3618.00', true, true],
    ]);
    expect([p[2]!.assets, p[2]!.liabilities]).toEqual(['3720.00', '150.00']);
    expect(p.every((x) => x.source === 'COMPUTED' && !x.closed)).toBe(true);
  });

  it('[TC-REPORTING-NETWORTH-007] cada punto usa la tasa de su fin de mes (10.00, 10.50, 11.00) y no la de hoy (11.40)', async () => {
    const r = await history(main, '?from=2026-01&to=2026-03');
    expect(points(r).map((x) => x.ratesUsed.map((u) => u.rate.value))).toEqual([['10'], ['10.5'], ['11']]);
    const meta = r.body['meta'] as { rateWindowDays: number; ratesUsed: unknown[] };
    expect(meta.rateWindowDays).toBe(7);
    expect(meta.ratesUsed).toHaveLength(3);
  });

  it('[TC-REPORTING-NETWORTH-011] la variación de febrero es +850.00 y la de marzo +20.00; enero no tiene', async () => {
    const r = await history(main, '?from=2026-01&to=2026-03');
    expect(points(r).map((x) => [x.change, x.comparable])).toEqual([
      [null, false],
      ['850.00', true],
      ['20.00', true],
    ]);
  });

  it('[TC-REPORTING-NETWORTH-008] sin tasa dentro de la ventana de 7 días el punto queda incompleto y lista el USDT como no valorado', async () => {
    const u = await user(`kc-nw-inc-${randomUUID()}`);
    await account(u, 'Banco BOB', 'BANK', 'BOB', '1800.00', '2026-01-01');
    await account(u, 'Wallet USDT', 'CRYPTO_WALLET', 'USDT', '100.000000', '2026-01-01');
    await rate(u, '9.90', '2026-01-10T12:00:00Z'); // 21 días antes del corte: fuera de la ventana
    ok(await post(u, '/periods', { through: '2026-12-31' }), 200);
    const r = await history(u, '?from=2026-01&to=2026-02');
    const p = points(r);
    expect(p[0]).toMatchObject({
      period: '2026-01',
      netWorth: '1800.00',
      complete: false,
      unconverted: [{ amount: '100.000000', currency: 'USDT' }],
      ratesUsed: [],
    });
    expect(p[1]).toMatchObject({ comparable: false });
  });

  it('[TC-REPORTING-NETWORTH-010] una cuenta archivada con saldo histórico cuenta en su fecha; una abierta después no', async () => {
    const u = await user(`kc-nw-acc-${randomUUID()}`);
    const vieja = await account(u, 'Caja vieja', 'CASH', 'BOB', '300.00', '2026-01-01');
    const nuevo = await account(u, 'Banco nuevo', 'BANK', 'BOB', '0.00', '2026-02-10');
    await transfer(u, vieja.id, nuevo.id, '300.00', '2026-02-10');
    await tx(u, 'INCOME', nuevo.id, '200.00', '2026-02-11');
    const archived = await post(u, `/accounts/${vieja.id}/archive`, undefined, {
      'if-match': `"${vieja.version}"`,
    });
    ok(archived, 200);
    ok(await post(u, '/periods', { through: '2026-12-31' }), 200);
    const r = await history(u, '?from=2026-01&to=2026-02');
    expect(points(r).map((x) => x.netWorth)).toEqual(['300.00', '500.00']);
  });

  it('[TC-REPORTING-NETWORTH-009] un mes cerrado muestra el snapshot de cierre y una tasa registrada después no lo altera', async () => {
    const u = await user(`kc-nw-close-${randomUUID()}`);
    await account(u, 'Banco BOB', 'BANK', 'BOB', '2000.00', '2026-01-01');
    await account(u, 'Wallet USDT', 'CRYPTO_WALLET', 'USDT', '100.000000', '2026-01-01');
    await rate(u, '10.00', '2026-01-31T20:00:00Z');
    ok(await post(u, '/periods', { through: '2026-12-31' }), 200);
    // El OWNER relaja la conciliación a advertencia y cierra enero reconociendo advertencias.
    const policy = await get(u, '/planning/closing-policy');
    const severities = { ...(policy.body['severities'] as Json), UNRECONCILED_ACCOUNTS: 'WARNING' };
    ok(await put(u, '/planning/closing-policy', { severities }, policy.body['version'] as number), 200);
    const periods = (await get(u, '/periods?limit=100')).body['data'] as {
      id: string;
      label: string;
      version: number;
    }[];
    const jan = periods.find((p) => p.label === '2026-01')!;
    ok(
      await post(
        u,
        `/periods/${jan.id}/close`,
        { acknowledgeWarnings: true },
        { 'if-match': `"${jan.version}"` },
      ),
      200,
    );
    // Tasa registrada DESPUÉS del cierre, con fecha del 2026-01-31, que haría valer otra cifra al recalcular.
    await rate(u, '10.80', '2026-01-31T23:00:00Z');
    const r = await history(u, '?from=2026-01&to=2026-01');
    expect(points(r)[0]).toMatchObject({
      period: '2026-01',
      netWorth: '3000.00',
      source: 'SNAPSHOT',
      closed: true,
      ratesUsed: [],
    });
    // Febrero (abierto) se calcula con las tasas vigentes a su fecha y no es un punto cerrado.
    const both = await history(u, '?from=2026-01&to=2026-02');
    expect(points(both).map((x) => [x.period, x.source, x.closed])).toEqual([
      ['2026-01', 'SNAPSHOT', true],
      ['2026-02', 'COMPUTED', false],
    ]);
  });

  it('[TC-REPORTING-NETWORTH-012] meses futuros, rango invertido y más de 120 meses: 400 VALIDATION_FAILED; EUR no habilitada: 422', async () => {
    for (const query of [
      '?from=2026-01&to=2026-06',
      '?from=2026-03&to=2026-01',
      '?from=2016-01&to=2026-04',
    ]) {
      const r = await history(main, query);
      expect(r.status, query).toBe(400);
      expect(r.body['code']).toBe('VALIDATION_FAILED');
    }
    const eur = await history(main, '?reportingCurrency=EUR');
    expect(eur.status).toBe(422);
    expect(eur.body['code']).toBe('CURRENCY_NOT_ENABLED');
  });

  it('[TC-REPORTING-NETWORTH-012] sin rango termina en el periodo actual (hoy 2026-04-12) con un punto por periodo existente', async () => {
    const r = await history(main);
    expect(r.status).toBe(200);
    const p = points(r);
    expect(p.map((x) => x.period)).toEqual(['2026-01', '2026-02', '2026-03', '2026-04']);
    expect(p.at(-1)).toMatchObject({ partial: true, asOf: '2026-04-12' });
  });

  it('ETag/304: la misma lectura devuelve 304 con If-None-Match; un VIEWER puede leer la serie', async () => {
    const first = await history(main, '?from=2026-01&to=2026-03');
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^W\/"/);
    const again = await get(main, '/reports/net-worth/history?from=2026-01&to=2026-03', {
      'if-none-match': etag!,
    });
    expect(again.status).toBe(304);
    const asViewer = await history(viewer, '?from=2026-01&to=2026-03');
    expect(asViewer.status).toBe(200);
    expect(points(asViewer).map((x) => x.netWorth)).toEqual(['2700.00', '3550.00', '3570.00']);
  });

  it('aislamiento: un usuario sin membresía no puede leer la serie de otro workspace', async () => {
    const stranger = await user(`kc-nw-out-${randomUUID()}`);
    const r = await call('GET', `${W(main)}/reports/net-worth/history`, { token: stranger.token });
    expect([403, 404]).toContain(r.status);
  });
});
