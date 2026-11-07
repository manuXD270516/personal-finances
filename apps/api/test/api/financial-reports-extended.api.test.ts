/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ApiContract } from '@pf/platform/api';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Reportes ampliados por HTTP contra PostgreSQL real (openspec add-financial-reports-extended): gastos por etiqueta y por
// cuenta, tendencias, comisiones, metas, deudas, costos recurrentes, suscripciones y conversiones leídos de la fuente de
// verdad, más las vistas guardadas personales (RLS por workspace y usuario) y sus errores de contrato.
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
const usd = (amount: string) => ({ amount, currency: 'USD' });
const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect((r.body as any).code ?? (r.body as any).type).toContain(code);
};

async function addMember(owner: User, member: User, role: string): Promise<User> {
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

async function asApp<T>(u: User, fn: (c: Client) => Promise<T>): Promise<T> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, () => fn(app));
  } finally {
    await app.end();
  }
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

async function txn(
  u: User,
  date: string,
  accountId: string,
  amount: string,
  categoryId: string,
  extra: { tagIds?: string[]; kind?: string } = {},
) {
  return ok(
    await post(u, '/transactions', {
      kind: extra.kind ?? 'EXPENSE',
      transactionDate: date,
      accountId,
      amount: bob(amount),
      splits: [{ amount: bob(amount), categoryId, ...(extra.tagIds ? { tagIds: extra.tagIds } : {}) }],
    }),
    201,
  );
}

interface World {
  readonly owner: User;
  readonly ids: Record<string, string>;
}

/**
 * Octubre del viaje a Cusco: hotel de 800.00 con "Viaje Cusco" y "Trabajo", comida de 200.00 con "Viaje Cusco",
 * supermercado de 3300.00 desde el banco y 500.00 con la tarjeta; comisión bancaria de 15.00; un préstamo vehicular con
 * su primera cuota; la meta "Viaje"; compromisos recurrentes y una suscripción en dólares.
 */
async function world(sub: string): Promise<World> {
  const owner = await user(`${sub}-${randomUUID()}`);
  const ids: Record<string, string> = {};
  const group = async (name: string, kind: string) =>
    ok(await post(owner, '/category-groups', { name, kind }), 201)['id'] as string;
  const cat = async (groupId: string, name: string) =>
    ok(await post(owner, '/categories', { groupId, name }), 201)['id'] as string;
  const alim = await group('Alimentación (rex)', 'EXPENSE');
  ids['super'] = await cat(alim, 'Supermercado (rex)');
  ids['rest'] = await cat(alim, 'Restaurantes (rex)');
  ids['aloja'] = await cat(alim, 'Alojamiento (rex)');
  const cats = await get(owner, '/categories');
  ids['fees'] = (cats.body['data'] as { id: string; systemCode: string | null }[]).find(
    (c) => c.systemCode === 'FEES',
  )!.id;
  ids['viaje'] = ok(await post(owner, '/tags', { name: 'Viaje Cusco' }), 201)['id'] as string;
  ids['trabajo'] = ok(await post(owner, '/tags', { name: 'Trabajo' }), 201)['id'] as string;
  ids['banco'] = await account(owner, 'Banco BOB', 'BANK', 'BOB', '30000.00');
  ids['tarjeta'] = await account(owner, 'Tarjeta Andina', 'CREDIT_CARD', 'BOB', '0.00');
  ids['ahorro'] = await account(owner, 'Ahorro BOB', 'SAVINGS', 'BOB', '0.00');
  ids['visa'] = await account(owner, 'Visa USD', 'CREDIT_CARD', 'USD', '0.00');
  for (const [value, asOf] of [
    ['10.00', '2026-09-30T12:00:00Z'],
    ['10.20', '2026-11-14T12:00:00Z'],
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
  const both = [ids['viaje']!, ids['trabajo']!];
  await txn(owner, '2026-10-05', ids['banco']!, '800.00', ids['aloja']!, { tagIds: both });
  await txn(owner, '2026-10-06', ids['banco']!, '200.00', ids['rest']!, { tagIds: [ids['viaje']!] });
  await txn(owner, '2026-10-10', ids['banco']!, '3300.00', ids['super']!);
  await txn(owner, '2026-10-18', ids['tarjeta']!, '500.00', ids['rest']!);
  await txn(owner, '2026-10-20', ids['banco']!, '15.00', ids['fees']!);
  // Préstamo vehicular: 50000.00 BOB al 11.50 %, 24 cuotas; la cuota 1 (2342.02) paga 479.17 de interés.
  const loan = ok(
    await post(owner, '/loans', {
      name: 'Crédito auto',
      account: { create: { name: 'Crédito auto (rex)' } },
      disbursementAccountId: ids['banco'],
      principal: bob('50000.00'),
      annualRate: '0.115',
      termInstallments: 24,
      disbursementDate: '2026-09-15',
      firstDueDate: '2026-10-15',
    }),
    201,
  );
  ids['loan'] = loan['id'] as string;
  ok(await post(owner, `/loans/${ids['loan']}/disburse`, {}));
  ok(
    await post(owner, `/loans/${ids['loan']}/payments`, {
      amount: bob('2342.02'),
      businessDate: '2026-10-15',
      accountId: ids['banco'],
    }),
    201,
  );
  // Meta "Viaje" con reservas en julio, agosto y octubre.
  const goal = ok(
    await post(owner, '/goals', {
      name: 'Viaje',
      type: 'TRAVEL',
      target: bob('5000.00'),
      startDate: '2026-07-01',
      targetDate: '2027-06-30',
      linkedAccountIds: [ids['ahorro']],
    }),
    201,
  );
  ids['goal'] = goal['id'] as string;
  for (const [amount, businessDate] of [
    ['500.00', '2026-07-10'],
    ['500.00', '2026-08-10'],
    ['1000.00', '2026-10-05'],
  ] as const) {
    ok(
      await post(owner, `/goals/${ids['goal']}/contributions`, {
        fund: 'EARMARK',
        amount: bob(amount),
        sourceAccountId: ids['banco'],
        businessDate,
      }),
      201,
    );
  }
  for (const [name, amount, cadence] of [
    ['Streaming', '69.00', 'MONTHLY'],
    ['Seguro', '1200.00', 'ANNUAL'],
  ] as const) {
    ok(
      await post(owner, '/recurring', {
        name,
        kind: 'EXPENSE',
        template: {
          accountId: ids['banco'],
          amount: { type: 'FIXED', amount: bob(amount) },
          categoryId: ids['super'],
          schedule: { cadence, startDate: '2026-11-20' },
          materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
        },
      }),
      201,
    );
  }
  const cp = ok(await post(owner, '/counterparties', { name: 'Streamly (rex)' }), 201)['id'] as string;
  ok(
    await post(owner, '/subscriptions', {
      counterpartyId: cp,
      name: 'Streamly',
      planName: 'Premium',
      price: usd('10.00'),
      billingCycle: { cadence: 'MONTHLY' },
      firstRenewalOn: '2026-11-15',
      paymentAccountId: ids['visa'],
      materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      categoryId: ids['super'],
    }),
    201,
  );
  return { owner, ids };
}

let w1: World;
let w2: World;
let editor: User;
let viewer: User;
const OCT = 'from=2026-10-01&to=2026-10-31';
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
  w1 = await world('kc-rex-w1');
  editor = await addMember(w1.owner, await user(`kc-rex-editor-${randomUUID()}`), 'EDITOR');
  viewer = await addMember(w1.owner, await user(`kc-rex-viewer-${randomUUID()}`), 'VIEWER');
  w2 = await world('kc-rex-w2');
  await txn(w2.owner, '2026-10-25', w2.ids['banco']!, '999.00', w2.ids['super']!);
}, 360_000);

afterAll(async () => {
  await runtime?.close();
});

describe('catálogo y reportes ampliados por HTTP (reporting/financial-reports)', () => {
  it('[TC-REPORTING-REPORTS-048] el catálogo informa 15 reportes disponibles con su endpoint y el pronóstico planificado para Phase 8', async () => {
    const r = await get(viewer, '/reports/catalog');
    validate('getReportCatalog', r);
    const reports = r.body['reports'] as { number: number; status: string; endpoint: string | null }[];
    expect(reports.filter((x) => x.status === 'AVAILABLE').map((x) => x.number)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    ]);
    expect(reports[3]?.endpoint).toBe('/reports/expenses/by-tag');
    expect(reports[15]).toMatchObject({ status: 'PLANNED', phase: 8 });
  });

  it('[TC-REPORTING-REPORTS-039] gastos por etiqueta: Viaje Cusco 1000.00 y Trabajo 800.00 con aviso de no aditividad; con todas, 800.00', async () => {
    const r = await get(viewer, `/reports/expenses/by-tag?${OCT}`);
    validate('getExpensesByTagReport', r);
    expect(r.body['nonAdditive']).toBe(true);
    const tags = r.body['tags'] as any[];
    expect(tags.map((t) => [t.name, t.amount.consolidated.amount])).toEqual([
      ['Viaje Cusco', '1000.00'],
      ['Trabajo', '800.00'],
    ]);
    const all = await get(
      viewer,
      `/reports/expenses/by-tag?${OCT}&tagId=${w1.ids['viaje']}&tagId=${w1.ids['trabajo']}&tagMatch=ALL`,
    );
    validate('getExpensesByTagReport', all);
    expect((all.body['tags'] as any[]).map((t) => t.amount.consolidated.amount)).toEqual([
      '800.00',
      '800.00',
    ]);
    // El drill-down de la etiqueta lista las porciones que suman la celda.
    const drill = await get(
      viewer,
      `/reports/drill-down?${OCT}&report=EXPENSES_BY_TAG&tagId=${w1.ids['viaje']}&limit=50`,
    );
    expect(drill.status, drill.text).toBe(200);
    expect(drill.body['count']).toBe(2);
    expect((drill.body['totals'] as any).consolidated.amount).toBe('1000.00');
  });

  it('[TC-REPORTING-REPORTS-040] gastos por cuenta: Banco BOB y Tarjeta Andina suman el gasto total del rango', async () => {
    const r = await get(viewer, `/reports/expenses/by-account?${OCT}`);
    validate('getExpensesByAccountReport', r);
    const accounts = r.body['accounts'] as any[];
    expect(accounts.map((a) => [a.name, a.type, a.amount.consolidated.amount])).toEqual([
      ['Banco BOB', 'BANK', '4794.17'],
      ['Tarjeta Andina', 'CREDIT_CARD', '500.00'],
    ]);
    expect((r.body['total'] as any).consolidated.amount).toBe('5294.17');
    const byCategory = await get(viewer, `/reports/expenses/by-category?${OCT}`);
    expect((byCategory.body['total'] as any).consolidated.amount).toBe('5294.17');
  });

  it('[TC-REPORTING-REPORTS-041] tendencias: una serie por categoría con su celda de octubre y la normalización por día', async () => {
    const r = await get(viewer, `/reports/trends?${OCT}&grouping=CALENDAR_MONTH`);
    validate('getTrendsReport', r);
    const series = r.body['series'] as any[];
    expect(series[0]).toMatchObject({ name: 'Supermercado (rex)' });
    expect(series[0].cells[0].amount.consolidated.amount).toBe('3300.00');
    const perDay = await get(viewer, `/reports/trends?${OCT}&grouping=CALENDAR_MONTH&normalize=PER_DAY`);
    expect((perDay.body['series'] as any[])[0].cells[0].amount.consolidated.amount).toBe('106.45');
  });

  it('[TC-REPORTING-REPORTS-042] comisiones: el gasto en la categoría de comisiones del sistema es el tipo FEE_CATEGORY', async () => {
    const r = await get(viewer, `/reports/fees?${OCT}`);
    validate('getFeesReport', r);
    const month = (r.body['months'] as any[])[0];
    expect(month.byType.map((b: any) => [b.type, b.amount.consolidated.amount])).toEqual([
      ['CONVERSION', '0.00'],
      ['TRANSFER', '0.00'],
      ['LOAN', '479.17'],
      ['FEE_CATEGORY', '15.00'],
    ]);
    expect(month.total.consolidated.amount).toBe('494.17');
  });

  it('[TC-REPORTING-REPORTS-043] metas: acumulados de 500.00, 1000.00, 1000.00 y 2000.00 BOB con el seguimiento de GOALS', async () => {
    const r = await get(viewer, `/reports/goals?from=2026-07-01&to=2026-10-31`);
    validate('getGoalsReport', r);
    const goal = (r.body['goals'] as any[])[0];
    expect(goal).toMatchObject({ name: 'Viaje', currency: 'BOB' });
    expect(goal.months.map((m: any) => m.accumulated.amount)).toEqual([
      '500.00',
      '1000.00',
      '1000.00',
      '2000.00',
    ]);
    expect(goal.months.map((m: any) => m.contributions.amount)).toEqual([
      '500.00',
      '500.00',
      '0.00',
      '1000.00',
    ]);
    expect(goal.months[0].expected.amount).toBe('412.09');
    const only = await get(viewer, `/reports/goals?from=2026-07-01&to=2026-07-31&goalId=${randomUUID()}`);
    expect(only.body['goals']).toEqual([]);
  });

  it('[TC-REPORTING-REPORTS-044] deudas: el crédito auto informa el pendiente del ledger y el interés pagado de la cuota', async () => {
    const r = await get(viewer, `/reports/debts?from=2026-09-01&to=2026-10-31`);
    validate('getDebtsReport', r);
    const debt = (r.body['debts'] as any[]).find((d) => d.name === 'Crédito auto')!;
    expect(debt.kind).toBe('LOAN');
    expect(debt.months.map((m: any) => m.outstanding.amount)).toEqual(['50000.00', '48137.15']);
    expect(debt.months.map((m: any) => m.interestPaid.amount)).toEqual(['0.00', '479.17']);
    expect(debt.months.map((m: any) => m.principalPaid.amount)).toEqual(['0.00', '1862.85']);
    const cards = await get(viewer, `/reports/debts?from=2026-10-01&to=2026-10-31&debtKind=CARD`);
    expect(
      (cards.body['debts'] as any[]).every((d) => d.kind === 'CARD' && d.months[0].principalPaid === null),
    ).toBe(true);
  });

  it('[TC-REPORTING-REPORTS-045] costos recurrentes: streaming, seguro y la suscripción en dólares suman 271.00 al mes y 3252.00 al año', async () => {
    const r = await get(viewer, `/reports/recurring`);
    validate('getRecurringCostsReport', r);
    // Streaming 69.00 + Seguro 100.00 + Streamly 10.00 USD x 10.20 = 271.00 (la suscripción es un compromiso recurrente).
    expect((r.body['totals'] as any).monthly.consolidated.amount).toBe('271.00');
    expect((r.body['totals'] as any).annual.consolidated.amount).toBe('3252.00');
    expect((r.body['items'] as any[]).map((i) => i.name)).toEqual(['Streamly', 'Seguro', 'Streaming']);
    expect(r.body['variableCount']).toBe(0);
  });

  it('[TC-REPORTING-REPORTS-046] suscripciones: Streamly en dólares se valora con la tasa del cierre y su alta figura como evento', async () => {
    const r = await get(viewer, `/reports/subscriptions?from=2026-10-01&to=2026-11-30`);
    validate('getSubscriptionsReport', r);
    const months = r.body['months'] as any[];
    expect(months).toHaveLength(2);
    expect(months[0].active).toBe(0);
    expect(months[1].active).toBe(1);
    expect(months[1].monthlyCost.byCurrency).toEqual([usd('10.00')]);
    expect(months[1].events.map((e: any) => e.kind)).toEqual(['STARTED']);
  });

  it('[TC-REPORTING-REPORTS-047] conversiones: sin conversiones el reporte responde vacío y válido', async () => {
    const r = await get(viewer, `/reports/conversions?${OCT}`);
    validate('getConversionsReport', r);
    expect(r.body['points']).toEqual([]);
    expect((r.body['costTotal'] as any).amount).toBe('0.00');
  });

  it('[TC-REPORTING-REPORTS-025] W2 gasta 999.00 y no aparece en W1; los reportes ampliados solo leen datos de su workspace', async () => {
    const r = await get(w1.owner, `/reports/expenses/by-account?${OCT}`);
    expect((r.body['total'] as any).consolidated.amount).toBe('5294.17');
    const other = await get(w2.owner, `/reports/expenses/by-account?${OCT}`);
    expect((other.body['total'] as any).consolidated.amount).toBe('6293.17');
    const stranger = await call('GET', `${W(w1.owner)}/reports/expenses/by-tag?${OCT}`, {
      token: w2.owner.token,
    });
    expect(stranger.status).toBe(403);
  });

  it('[TC-REPORTING-REPORTS-024] el ETag permite un 304 y los parámetros malformados se rechazan', async () => {
    const first = await get(viewer, `/reports/fees?${OCT}`);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    expect((await get(viewer, `/reports/fees?${OCT}`, { 'if-none-match': etag! })).status).toBe(304);
    expect(
      (await get(viewer, `/reports/trends?from=2024-01-01&to=2026-10-31&grouping=CALENDAR_MONTH`)).status,
    ).toBe(400);
    expect((await get(viewer, `/reports/expenses/by-tag?${OCT}&tagMatch=ALL`)).status).toBe(400);
  });

  it('[TC-REPORTING-REPORTS-021] el CSV de gastos por cuenta lo exporta el VIEWER, queda auditado sin contenido y supera el tope con error', async () => {
    const r = await get(viewer, `/reports/expenses/by-account/export?${OCT}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/csv');
    expect(r.text).toContain('account,account_type,institution_id,category,row_kind');
    expect(r.text).toContain('Banco BOB,BANK,');
    const audit = await asApp(w1.owner, async (c) => {
      const { rows } = await c.query(
        `SELECT action FROM audit.audit_log WHERE action = 'reporting.report.exported' AND aggregate_type = 'ReportExport'`,
      );
      return rows.length;
    });
    expect(audit).toBeGreaterThan(0);
  });
});

describe('vistas guardadas por HTTP (reporting/financial-reports)', () => {
  const view = (over: Json = {}) => ({
    reportId: 'EXPENSES_BY_TAG',
    name: 'Gastos del viaje',
    params: { tagIds: [] as string[], range: { kind: 'LAST_N_PERIODS', periods: 3 } },
    ...over,
  });

  it('[TC-REPORTING-REPORTS-049] guarda "Gastos del viaje", la lista y al abrirla calcula el rango desde hoy; nombre repetido y vista 51 se rechazan', async () => {
    const body = view({
      params: { tagIds: [w1.ids['viaje']], range: { kind: 'LAST_N_PERIODS', periods: 3 } },
    });
    const created = await post(editor, '/reports/saved-views', body);
    ok(created, 201);
    expect(contract.validateResponse('createSavedReportView', 201, created.body)).toEqual([]);
    expect(created.headers.get('etag')).toBe('"1"');
    const id = created.body['id'] as string;
    const list = await get(editor, '/reports/saved-views');
    validate('listSavedReportViews', list);
    expect((list.body['data'] as any[]).map((v) => v.name)).toEqual(['Gastos del viaje']);
    const opened = await get(editor, `/reports/saved-views/${id}`);
    validate('getSavedReportView', opened);
    const query = opened.body['query'] as Record<string, any>;
    expect(query['to']).toBe('2026-11-30');
    expect(query['tagId']).toEqual([w1.ids['viaje']]);
    expect(opened.body['warnings']).toEqual([]);
    problem(await post(editor, '/reports/saved-views', body), 409, 'SAVED_VIEW_NAME_TAKEN');
    for (let i = 1; i < 50; i += 1)
      ok(await post(editor, '/reports/saved-views', view({ name: `Vista ${i}` })), 201);
    problem(
      await post(editor, '/reports/saved-views', view({ name: 'Vista 51' })),
      422,
      'SAVED_VIEW_LIMIT_EXCEEDED',
    );
    // Solo ids y filtros: un monto en los parámetros se rechaza.
    expect(
      (await post(viewer, '/reports/saved-views', view({ params: { total: bob('10.00') } }))).status,
    ).toBe(400);
  }, 120_000);

  it('[TC-REPORTING-REPORTS-049] renombrar exige If-Match y borrar quita la vista', async () => {
    const created = ok(await post(viewer, '/reports/saved-views', view({ name: 'Mi vista' })), 201);
    const id = created['id'] as string;
    const renamed = await call('PATCH', `${W(viewer)}/reports/saved-views/${id}`, {
      token: viewer.token,
      body: { name: 'Mi vista renombrada' },
      headers: { 'if-match': '"1"' },
    });
    ok(renamed);
    expect(renamed.body['version']).toBe(2);
    const stale = await call('PATCH', `${W(viewer)}/reports/saved-views/${id}`, {
      token: viewer.token,
      body: { name: 'otra' },
      headers: { 'if-match': '"1"' },
    });
    expect(stale.status).toBe(412);
    const deleted = await call('DELETE', `${W(viewer)}/reports/saved-views/${id}`, { token: viewer.token });
    expect(deleted.status).toBe(204);
    expect((await get(viewer, `/reports/saved-views/${id}`)).status).toBe(404);
  });

  it('[TC-REPORTING-REPORTS-050] otro miembro del workspace no la lista ni la abre; un usuario de otro workspace la recibe inexistente', async () => {
    const mine = ok(await post(w1.owner, '/reports/saved-views', view({ name: 'Solo del owner' })), 201);
    const id = mine['id'] as string;
    const theirs = await get(viewer, '/reports/saved-views');
    expect((theirs.body['data'] as any[]).some((v) => v.id === id)).toBe(false);
    expect((await get(viewer, `/reports/saved-views/${id}`)).status).toBe(404);
    expect(
      (
        await call('PATCH', `${W(viewer)}/reports/saved-views/${id}`, {
          token: viewer.token,
          body: { name: 'x' },
          headers: { 'if-match': '"1"' },
        })
      ).status,
    ).toBe(404);
    expect(
      (await call('DELETE', `${W(viewer)}/reports/saved-views/${id}`, { token: viewer.token })).status,
    ).toBe(404);
    const stranger = await call('GET', `${W(w1.owner)}/reports/saved-views/${id}`, { token: w2.owner.token });
    expect(stranger.status).toBe(403);
    // La RLS por usuario: ni siquiera con SQL directo en el contexto del viewer aparece la fila del owner.
    const visible = await asApp(viewer, async (c) => {
      const { rows } = await c.query(`SELECT id FROM reporting.saved_report_view WHERE id = $1`, [id]);
      return rows.length;
    });
    expect(visible).toBe(0);
  });

  it('[TC-REPORTING-REPORTS-050] una etiqueta archivada se avisa al abrir la vista sin fallar', async () => {
    const tag = ok(await post(w1.owner, '/tags', { name: 'Efímera' }), 201);
    const created = ok(
      await post(
        w1.owner,
        '/reports/saved-views',
        view({ name: 'Con etiqueta efímera', params: { tagIds: [tag['id']] } }),
      ),
      201,
    );
    const archived = await call('POST', `${W(w1.owner)}/tags/${tag['id']}/archive`, {
      token: w1.owner.token,
      headers: { 'if-match': `"${tag['version']}"` },
    });
    expect(archived.status, archived.text).toBe(200);
    const opened = await get(w1.owner, `/reports/saved-views/${created['id']}`);
    ok(opened);
    expect((opened.body['warnings'] as any[]).map((w) => [w.code, w.kind])).toEqual([
      ['ARCHIVED_FILTER', 'TAG'],
    ]);
  });
});
