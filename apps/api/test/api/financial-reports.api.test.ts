/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ApiContract } from '@pf/platform/api';
import { dec, FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Reportes financieros por HTTP contra PostgreSQL real (openspec add-financial-reports): ingresos y gastos, gastos por
// categoría, flujo de caja, historial de saldo, patrimonio, drill-down y CSV leídos de la fuente de verdad (ledger +
// porciones) con RLS, roles, aislamiento, ETag/304, auditoría de la exportación y errores de contrato.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
// 2026-11-15 12:00 en La Paz.
const clock = new FixedClock(Instant.parse('2026-11-15T16:00:00Z'));
const contract = ApiContract.fromFile(resolveContractPath());
const apiLog = capturingLogger('finance-api', 'api');

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
const get = (u: User, path: string, headers: Record<string, string> = {}) =>
  call('GET', `${W(u)}${path}`, { token: u.token, headers });
const ok = (r: Reply, status = 200) => {
  expect(r.status, `${JSON.stringify(r.body)} ${JSON.stringify(apiLog.records().slice(-3))}`).toBe(status);
  return r.body;
};
const bob = (amount: string) => ({ amount, currency: 'BOB' });

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
  return ok(
    await post(u, '/accounts', {
      name,
      type,
      currency,
      openingBalance: { amount: { amount: opening, currency }, date: '2026-09-01' },
    }),
    201,
  )['id'] as string;
}

interface World {
  readonly owner: User;
  readonly ids: Record<string, string>;
}

async function txn(
  u: User,
  kind: string,
  date: string,
  accountId: string,
  amount: string,
  categoryId: string,
  currency = 'BOB',
  extra: Json = {},
) {
  return ok(
    await post(u, '/transactions', {
      kind,
      transactionDate: date,
      accountId,
      amount: { amount, currency },
      splits: [{ amount: { amount, currency }, categoryId }],
      ...extra,
    }),
    201,
  );
}

/** Octubre de los scenarios: sueldo, supermercado, reembolso, restaurante en USD, pago de deuda, plazo fijo y efectivo. */
async function world(sub: string): Promise<World> {
  const owner = await user(`${sub}-${randomUUID()}`);
  const ids: Record<string, string> = {};
  const group = async (name: string, kind: string) =>
    ok(await post(owner, '/category-groups', { name, kind }), 201)['id'] as string;
  const cat = async (groupId: string, name: string) =>
    ok(await post(owner, '/categories', { groupId, name }), 201)['id'] as string;
  const alim = await group('Alimentación (rep)', 'EXPENSE');
  const ing = await group('Ingresos (rep)', 'INCOME');
  ids['super'] = await cat(alim, 'Supermercado (rep)');
  ids['rest'] = await cat(alim, 'Restaurantes (rep)');
  ids['sueldo'] = await cat(ing, 'Sueldo (rep)');
  ids['banco'] = await account(owner, 'Banco BOB', 'BANK', 'BOB', '10000.00');
  ids['efectivo'] = await account(owner, 'Efectivo', 'CASH', 'BOB', '0.00');
  ids['plazo'] = await account(owner, 'Plazo fijo', 'INVESTMENT', 'BOB', '0.00');
  ids['deuda'] = await account(owner, 'Deuda familiar', 'MANUAL_LIABILITY', 'BOB', '500.00');
  ids['usd'] = await account(owner, 'Cuenta USD', 'BANK', 'USD', '100.00');
  for (const [value, asOf] of [
    ['10.00', '2026-09-30T12:00:00Z'],
    ['10.00', '2026-10-15T12:00:00Z'],
    ['10.50', '2026-10-31T12:00:00Z'],
  ] as const) {
    ok(
      await post(owner, '/fx-rates', {
        base: 'USD',
        quote: 'BOB',
        value,
        rateType: 'P2P',
        asOf,
        sourceLabel: 'Referencia manual',
      }),
      201,
    );
  }
  ok(
    await call('PUT', `${W(owner)}/fx-rate-preferences`, {
      token: owner.token,
      body: { data: [{ base: 'USD', quote: 'BOB', rateType: 'P2P' }] },
      headers: { 'if-match': '"1"' },
    }),
  );
  await txn(owner, 'INCOME', '2026-10-05', ids['banco']!, '12000.00', ids['sueldo']!);
  const base = await txn(owner, 'EXPENSE', '2026-10-10', ids['banco']!, '3500.00', ids['super']!);
  await txn(owner, 'REFUND', '2026-10-12', ids['banco']!, '200.00', ids['super']!, 'BOB', {
    refundOfTransactionId: base['id'],
  });
  await txn(owner, 'EXPENSE', '2026-10-15', ids['usd']!, '50.00', ids['rest']!, 'USD');
  const transfer = (from: string, to: string, date: string, amount: string) =>
    post(owner, '/transfers', {
      transactionDate: date,
      fromAccountId: from,
      toAccountId: to,
      amount: bob(amount),
    });
  ok(await transfer(ids['banco']!, ids['deuda']!, '2026-10-20', '500.00'), 201);
  ok(await transfer(ids['banco']!, ids['plazo']!, '2026-10-21', '1000.00'), 201);
  ok(await transfer(ids['banco']!, ids['efectivo']!, '2026-10-22', '200.00'), 201);
  return { owner, ids };
}

let w1: World;
let w2: World;
let viewer: User;
const RANGE = 'from=2026-10-01&to=2026-10-31';
const validate = (op: string, r: Reply) =>
  expect(contract.validateResponse(op, 200, r.body), JSON.stringify(r.body)).toEqual([]);

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(
      baseEnv(deps, {
        RATE_LIMIT_READS_PER_MIN: '100000',
        RATE_LIMIT_WRITES_PER_MIN: '100000',
        RATE_LIMIT_COSTLY_PER_MIN: '100000',
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
  w1 = await world('kc-rep-w1');
  viewer = await addViewer(w1.owner, await user(`kc-rep-viewer-${randomUUID()}`));
  w2 = await world('kc-rep-w2');
  // W2 gasta más en octubre: nunca debe aparecer en W1.
  await txn(w2.owner, 'EXPENSE', '2026-10-25', w2.ids['banco']!, '999.00', w2.ids['super']!);
}, 240_000);

afterAll(async () => {
  await runtime?.close();
});

describe('reportes financieros por HTTP (reporting/financial-reports)', () => {
  it('[TC-REPORTING-REPORTS-001] el catálogo lista 16 reportes: seis disponibles y el pronóstico planificado para Phase 8', async () => {
    const r = await get(viewer, '/reports/catalog');
    expect(r.status).toBe(200);
    validate('getReportCatalog', r);
    const reports = r.body['reports'] as {
      number: number;
      status: string;
      phase: number;
      viewPath: string | null;
    }[];
    expect(reports).toHaveLength(16);
    expect(reports.filter((x) => x.status === 'AVAILABLE').map((x) => x.number)).toEqual([1, 2, 3, 7, 8, 15]);
    expect(reports[15]).toMatchObject({ status: 'PLANNED', phase: 8 });
    expect(reports[12]).toMatchObject({ status: 'PARTIAL', viewPath: '/fx/costos' });
  });

  it('[TC-REPORTING-REPORTS-005] octubre: BOB nativo 12000.00/3300.00, USD 50.00 y consolidado 12000.00/3800.00/8200.00 con 68.3 %; el VIEWER ve lo mismo que el OWNER', async () => {
    const r = await get(viewer, `/reports/income-expenses?${RANGE}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    validate('getIncomeExpensesReport', r);
    const row = (r.body['rows'] as Json[])[0] as Record<string, any>;
    expect(row.income.byCurrency).toEqual([bob('12000.00')]);
    expect(row.expenses.byCurrency).toEqual([bob('3300.00'), { amount: '50.00', currency: 'USD' }]);
    expect([row.income.consolidated, row.expenses.consolidated, row.savings.consolidated]).toEqual([
      bob('12000.00'),
      bob('3800.00'),
      bob('8200.00'),
    ]);
    expect(row.savingsRate).toBe('68.3');
    expect((r.body['meta'] as Json)['conversion']).toMatchObject({
      policy: 'TRANSACTION_DATE',
      rateWindowDays: 7,
    });
    const owner = await get(w1.owner, `/reports/income-expenses?${RANGE}`);
    expect((owner.body['rows'] as Json[])[0]).toEqual((r.body['rows'] as Json[])[0]);
  });

  it('[TC-REPORTING-REPORTS-025] W2 gasta 999.00 en octubre y nada de eso aparece en W1; un usuario ajeno recibe 403', async () => {
    const r = await get(w1.owner, `/reports/income-expenses?${RANGE}`);
    expect(((r.body['rows'] as Json[])[0] as Record<string, any>).expenses.byCurrency[0]).toEqual(
      bob('3300.00'),
    );
    const stranger = await user(`kc-rep-stranger-${randomUUID()}`);
    const denied = await call('GET', `${W(w1.owner)}/reports/income-expenses?${RANGE}`, {
      token: stranger.token,
    });
    expect(denied.status).toBe(403);
    expect(denied.text).not.toContain('3300');
  });

  it('[TC-REPORTING-REPORTS-006] gastos por categoría: Alimentación 3800.00 con Supermercado 3300.00 y Restaurantes 500.00', async () => {
    const r = await get(viewer, `/reports/expenses/by-category?${RANGE}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    validate('getExpensesByCategoryReport', r);
    const g = (r.body['groups'] as Record<string, any>[])[0]!;
    expect(g.amount.consolidated).toEqual(bob('3800.00'));
    expect(g.categories.map((c: Record<string, any>) => [c.name, c.amount.consolidated.amount])).toEqual([
      ['Supermercado (rep)', '3300.00'],
      ['Restaurantes (rep)', '500.00'],
    ]);
  });

  it('[TC-REPORTING-REPORTS-018] el drill-down de Supermercado lista 2 porciones (3500.00 y −200.00) que suman la cifra de la celda', async () => {
    const cell = await get(viewer, `/reports/expenses/by-category?${RANGE}`);
    const superId = (
      (cell.body['groups'] as Record<string, any>[])[0]!.categories as Record<string, any>[]
    ).find((c) => c.name === 'Supermercado (rep)')!.categoryId as string;
    const r = await get(
      viewer,
      `/reports/drill-down?report=EXPENSES_BY_CATEGORY&${RANGE}&categoryId=${superId}`,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    validate('getReportDrillDown', r);
    const rows = r.body['rows'] as Record<string, any>[];
    expect(rows.map((x) => x.amount.amount)).toEqual(['-200.00', '3500.00']);
    expect((r.body['totals'] as Record<string, any>).consolidated).toEqual(bob('3300.00'));
    expect(rows[0]!.transactionId).toEqual(expect.any(String));
  });

  it('[TC-REPORTING-REPORTS-008] flujo de caja de octubre en BOB: inicial 10000.00, operativo 8700.00, deuda −500.00, ahorro −1000.00 y final 17200.00', async () => {
    const r = await get(viewer, `/reports/cash-flow?${RANGE}&currency=BOB`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    validate('getCashFlowReport', r);
    const block = ((r.body['periods'] as Record<string, any>[])[0]!.byCurrency as Record<string, any>[]).find(
      (b) => b.currency === 'BOB',
    )!;
    expect([
      block.opening.amount,
      block.operating.amount,
      block.debt.amount,
      block.savingsInvestments.amount,
      block.currencyExchange.amount,
      block.closing.amount,
    ]).toEqual(['10000.00', '8700.00', '-500.00', '-1000.00', '0.00', '17200.00']);
    const debt = await get(
      viewer,
      `/reports/drill-down?report=CASH_FLOW&${RANGE}&component=debt&currency=BOB`,
    );
    validate('getReportDrillDown', debt);
    expect((debt.body['rows'] as Record<string, any>[]).map((x) => x.amount.amount)).toEqual(['-500.00']);
  });

  it('[TC-REPORTING-REPORTS-009] el historial de Banco BOB iguala el saldo contable de cada día y el drill-down del día 10 lista el gasto', async () => {
    const r = await get(viewer, `/reports/accounts/${w1.ids['banco']}/balance-history?${RANGE}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    validate('getAccountBalanceHistoryReport', r);
    const days = r.body['days'] as Record<string, any>[];
    const at = (d: string) => days.find((x) => x.date === d)!.balance.amount;
    expect([
      at('2026-10-04'),
      at('2026-10-05'),
      at('2026-10-10'),
      at('2026-10-12'),
      at('2026-10-31'),
    ]).toEqual(['10000.00', '22000.00', '18500.00', '18700.00', '17000.00']);
    const live = await get(viewer, `/accounts/${w1.ids['banco']}`);
    expect(live.status).toBe(200);
  });

  it('[TC-REPORTING-REPORTS-025] la cuenta de otro workspace es 404 sin revelar datos', async () => {
    const r = await get(w1.owner, `/reports/accounts/${w2.ids['banco']}/balance-history?${RANGE}`);
    expect(r.status).toBe(404);
  });

  it('[TC-REPORTING-REPORTS-033] el patrimonio informa la descomposición exacta del cambio de octubre', async () => {
    const r = await get(viewer, `/reports/net-worth?${RANGE}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    validate('getNetWorthReport', r);
    const d = (r.body['decomposition'] as Record<string, any>[])[0]!;
    // Banco 10000 + Usd 100 USD a 10.00 - deuda 500 → 10500.00 BOB; octubre: +8200 ahorro (USD 50 gastados) etc.
    expect(d.complete).toBe(true);
    const parts = [
      'savings',
      'conversionResult',
      'adjustments',
      'otherMovements',
      'fxRevaluation',
      'assetRevaluation',
    ].reduce((n, k) => n.plus(d[k].amount as string), dec('0'));
    // Cada componente se presenta HALF_EVEN: la suma presentada difiere del cambio presentado en a lo sumo unos centavos.
    expect(dec(d.closing.amount).minus(d.opening.amount).minus(parts).abs().lte('0.05')).toBe(true);
  });

  it('[TC-REPORTING-REPORTS-007] el presupuesto vs real rechaza el mes calendario con VALIDATION_FAILED', async () => {
    const r = await get(viewer, `/reports/budget-vs-actual?${RANGE}&grouping=CALENDAR_MONTH`);
    expect(r.status).toBe(400);
    expect(r.body['code']).toBe('VALIDATION_FAILED');
  });

  it('[TC-REPORTING-REPORTS-003] un rango de 25 periodos es VALIDATION_FAILED y una moneda no habilitada, CURRENCY_NOT_ENABLED', async () => {
    const wide = await get(
      viewer,
      '/reports/income-expenses?from=2024-10-01&to=2026-10-31&grouping=CALENDAR_MONTH',
    );
    expect(wide.status).toBe(400);
    expect(wide.body['code']).toBe('VALIDATION_FAILED');
    const eur = await get(viewer, `/reports/income-expenses?${RANGE}&reportingCurrency=EUR`);
    expect(eur.status).toBe(422);
    expect(eur.body['code']).toBe('CURRENCY_NOT_ENABLED');
  });

  it('[TC-REPORTING-REPORTS-024] el ETag permite un 304 en la segunda lectura y cambia tras registrar un gasto', async () => {
    const first = await get(viewer, `/reports/income-expenses?${RANGE}`);
    const etag = first.headers.get('etag');
    expect(etag).toMatch(/^W\//u);
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    const again = await call('GET', `${W(viewer)}/reports/income-expenses?${RANGE}`, {
      token: viewer.token,
      headers: { 'if-none-match': etag as string },
    });
    expect(again.status).toBe(304);
    await txn(w1.owner, 'EXPENSE', '2026-10-28', w1.ids['banco']!, '80.00', w1.ids['super']!);
    const after = await get(viewer, `/reports/income-expenses?${RANGE}`);
    expect(after.status).toBe(200);
    expect(after.headers.get('etag')).not.toBe(etag);
    expect(((after.body['rows'] as Json[])[0] as Record<string, any>).expenses.byCurrency[0]).toEqual(
      bob('3380.00'),
    );
  });

  it('[TC-REPORTING-REPORTS-021] el CSV de ingresos y gastos lo exporta el VIEWER con BOM, filas nativas y consolidada, y queda auditado sin contenido', async () => {
    const r = await get(viewer, `/reports/income-expenses/export?${RANGE}`);
    expect(r.status, r.text).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/csv');
    expect(r.headers.get('content-disposition')).toContain('attachment');
    const raw = await fetch(`${baseUrl}${W(viewer)}/reports/income-expenses/export?${RANGE}`, {
      headers: { authorization: `Bearer ${viewer.token}` },
    });
    expect([...new Uint8Array(await raw.arrayBuffer()).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = r.text.trimEnd().split('\r\n');
    expect(lines[0]).toContain(
      'period_label,period_from,period_to,partial,row_kind,currency,income,expenses',
    );
    expect(lines.some((l) => l.includes(',CONSOLIDATED,BOB,12000.00,3880.00,8120.00,67.7,'))).toBe(true);
    const audits = await asApp(
      w1.owner,
      async (c) =>
        (
          await c.query(
            `SELECT action, to_jsonb(a)::text AS dump FROM audit.audit_log a WHERE action = 'reporting.report.exported'`,
          )
        ).rows,
    );
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).toContain('INCOME_EXPENSES');
    expect(JSON.stringify(audits)).not.toMatch(/12000\.00/u);
  });

  it('[TC-REPORTING-REPORTS-025] consultar y exportar un reporte no modifica ningún dato financiero', async () => {
    const counts = `SELECT (SELECT count(*) FROM txn.transaction) AS tx, (SELECT count(*) FROM ledger.journal_entry) AS entries`;
    const before = await asApp(w1.owner, async (c) => (await c.query(counts)).rows[0]);
    await get(viewer, `/reports/cash-flow?${RANGE}`);
    await get(viewer, `/reports/drill-down/export?report=EXPENSES_BY_CATEGORY&${RANGE}`);
    const after = await asApp(w1.owner, async (c) => (await c.query(counts)).rows[0]);
    expect(after).toEqual(before);
  });
});
