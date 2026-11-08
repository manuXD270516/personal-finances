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

// Calendario de flujo de caja, riesgo de déficit, bloque `cashFlow` del Home y ajustes del disponible por HTTP contra
// PostgreSQL real (openspec add-cash-flow-forecast, tareas 5.1, 7.1; TC-REPORTING-FORECAST-001, -013, -017, -020, -027,
// -028): ocurrencias recurrentes y transacciones pendientes reales leídas de la fuente de verdad por los contratos
// públicos, validación del OpenAPI, INVALID_FILTER, ETag/304, lectura inmediata tras omitir, roles y aislamiento.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
// 2026-10-20 10:00 en La Paz.
const clock = new FixedClock(Instant.parse('2026-10-20T14:00:00Z'));
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
const apiErrors = () =>
  JSON.stringify(apiLog.records().filter((r) => Number(r['level']) >= 50 || r['level'] === 'error'));

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
const put = (u: User, path: string, body: unknown, headers: Record<string, string> = {}) =>
  call('PUT', `${W(u)}${path}`, { token: u.token, body, headers });
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const ok = (r: Reply, status = 200) => {
  expect(r.status, `${JSON.stringify(r.body)} ${apiErrors()}`).toBe(status);
  return r.body;
};
const m = (x: unknown) => {
  const money = x as { amount: string; currency: string } | null | undefined;
  return money ? `${money.amount} ${money.currency}` : null;
};

async function addMember(owner: User, member: User, role: 'VIEWER' | 'EDITOR'): Promise<User> {
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

interface Setup {
  user: User;
  bank: string;
  cash: string;
  fixedDeposit: string;
  expenseCategory: string;
  incomeCategory: string;
}
async function workspace(label: string): Promise<Setup> {
  const u = await user(`kc-cff-${label}-${randomUUID()}`);
  const account = async (name: string, type: string, amount: string) =>
    ok(
      await post(u, '/accounts', {
        name,
        type,
        currency: 'BOB',
        openingBalance: { amount: bob(amount), date: '2026-09-01' },
      }),
      201,
    )['id'] as string;
  const bank = await account('Banco BOB', 'BANK', '4000.00');
  const cash = await account('Efectivo BOB', 'CASH', '500.00');
  const fixedDeposit = await account('Plazo fijo', 'INVESTMENT', '10000.00');
  const expenseGroup = ok(
    await post(u, '/category-groups', { name: `Hogar ${label}`, kind: 'EXPENSE' }),
    201,
  );
  const expense = ok(
    await post(u, '/categories', { groupId: expenseGroup['id'], name: `Servicios ${label}` }),
    201,
  );
  const incomeGroup = ok(
    await post(u, '/category-groups', { name: `Ingresos ${label}`, kind: 'INCOME' }),
    201,
  );
  const income = ok(
    await post(u, '/categories', { groupId: incomeGroup['id'], name: `Salario ${label}` }),
    201,
  );
  ok(await post(u, '/periods', { through: '2026-12-31' }));
  return {
    user: u,
    bank,
    cash,
    fixedDeposit,
    expenseCategory: expense['id'] as string,
    incomeCategory: income['id'] as string,
  };
}

async function definition(
  s: Setup,
  name: string,
  startDate: string,
  amount: Json,
  over: { kind?: string; extra?: Json; categoryId?: string | null } = {},
): Promise<string> {
  const kind = over.kind ?? 'EXPENSE';
  const body = ok(
    await post(s.user, '/recurring', {
      name,
      kind,
      template: {
        accountId: s.bank,
        amount,
        ...(kind === 'EXPENSE' ? { categoryId: over.categoryId ?? s.expenseCategory } : {}),
        schedule: { cadence: 'MONTHLY', startDate },
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
        ...over.extra,
      },
    }),
    201,
  );
  return body['id'] as string;
}

async function occurrenceOn(s: Setup, definitionId: string, date: string) {
  const r = await get(s.user, `/recurring/${definitionId}/occurrences?limit=50`);
  ok(r);
  return (r.body['data'] as { id: string; occurrenceDate: string }[]).find((o) => o.occurrenceDate === date)!;
}

const calendar = async (u: User, query = '', headers: Record<string, string> = {}) => {
  const r = await get(u, `/reports/cash-flow-calendar${query}`, headers);
  if (r.status === 200) {
    expect(contract.validateResponse('getCashFlowCalendar', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  }
  return r;
};
const bobCurrency = (r: Reply) =>
  (r.body['currencies'] as Json[]).find((c) => c['currency'] === 'BOB') as {
    series: { date: string; balance: unknown }[];
    lowest: { amount: unknown; date: string };
    startBalance: unknown;
    endBalance: unknown;
    risk: string;
  };
const balanceOn = (r: Reply, date: string) => m(bobCurrency(r).series.find((p) => p.date === date)?.balance);
const eventNames = (r: Reply) => (r.body['events'] as { name: string }[]).map((e) => e.name);

let main: Setup;
let viewer: User;
let editor: User;
let other: Setup;
let luz: string;

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

  main = await workspace('main');
  viewer = await addMember(main.user, await user(`kc-cff-vw-${randomUUID()}`), 'VIEWER');
  editor = await addMember(main.user, await user(`kc-cff-ed-${randomUUID()}`), 'EDITOR');
  other = await workspace('other');

  // "Saldo esperado de octubre y noviembre": pendiente Cena, Internet, Luz estimada, Sueldo, Alquiler, un aporte a un
  // plazo fijo (no líquido) y "Seguro anual" fuera del horizonte.
  await definition(main, 'Internet', '2026-10-22', { type: 'FIXED', amount: bob('199.00') });
  luz = await definition(main, 'Luz', '2026-10-28', { type: 'ESTIMATED', amount: bob('180.00') });
  await definition(
    main,
    'Sueldo',
    '2026-10-31',
    { type: 'FIXED', amount: bob('8000.00') },
    { kind: 'INCOME', extra: { categoryId: main.incomeCategory } },
  );
  await definition(main, 'Alquiler', '2026-11-01', { type: 'FIXED', amount: bob('2500.00') });
  await definition(main, 'Seguro anual', '2026-12-15', { type: 'FIXED', amount: bob('900.00') });
  ok(
    await post(main.user, '/transactions', {
      kind: 'EXPENSE',
      status: 'PENDING',
      transactionDate: '2026-10-18',
      accountId: main.bank,
      description: 'Cena',
      amount: bob('300.00'),
      splits: [{ amount: bob('300.00'), categoryId: main.expenseCategory }],
    }),
    201,
  );
  await definition(other, 'Hosting', '2026-10-23', { type: 'FIXED', amount: bob('80.00') });
}, 300_000);

afterAll(async () => {
  await runtime?.close();
});

describe('GET /reports/cash-flow-calendar (reporting/cash-flow-calendar)', () => {
  it('[TC-REPORTING-FORECAST-001] el calendario de 30 días va del 2026-10-20 al 2026-11-19 con 31 puntos y el saldo esperado de las fuentes reales', async () => {
    const r = await calendar(main.user);
    expect(r.status, `${JSON.stringify(r.body)} ${apiErrors()}`).toBe(200);
    expect(r.body).toMatchObject({
      horizonDays: 30,
      today: '2026-10-20',
      from: '2026-10-20',
      to: '2026-11-19',
      reportingCurrency: 'BOB',
    });
    expect(bobCurrency(r).series).toHaveLength(31);
    expect(m(bobCurrency(r).startBalance)).toBe('4500.00 BOB');
    expect(balanceOn(r, '2026-10-20')).toBe('4200.00 BOB');
    expect(balanceOn(r, '2026-10-22')).toBe('4001.00 BOB');
    expect(balanceOn(r, '2026-10-28')).toBe('3821.00 BOB');
    expect(balanceOn(r, '2026-10-31')).toBe('11821.00 BOB');
    expect(balanceOn(r, '2026-11-01')).toBe('9321.00 BOB');
    expect(m(bobCurrency(r).endBalance)).toBe('9321.00 BOB');
    expect(m(bobCurrency(r).lowest.amount)).toBe('3821.00 BOB');
    expect(bobCurrency(r).lowest.date).toBe('2026-10-28');
    expect(eventNames(r)).toEqual(['Cena', 'Internet', 'Luz', 'Sueldo', 'Alquiler']);
    expect(eventNames(r)).not.toContain('Seguro anual');
    expect(r.body['coverage']).toEqual({ through: '2026-11-19', complete: true });
    expect(r.body['meta']).toMatchObject({ generatedAt: '2026-10-20T14:00:00.000Z' });
  });

  it('[TC-REPORTING-FORECAST-001] un horizonte no admitido se rechaza con 400 INVALID_FILTER; 7, 60 y 90 se aceptan', async () => {
    for (const horizon of [45, 0, 91]) {
      const r = await get(main.user, `/reports/cash-flow-calendar?horizon=${horizon}`);
      expect([r.status, r.body['code']], JSON.stringify(r.body)).toEqual([400, 'INVALID_FILTER']);
    }
    for (const horizon of [7, 60, 90]) {
      const r = await calendar(main.user, `?horizon=${horizon}`);
      expect(r.status).toBe(200);
      expect(r.body['horizonDays']).toBe(horizon);
    }
    const bad = await get(main.user, '/reports/cash-flow-calendar?reportingCurrency=BTC');
    expect([bad.status, bad.body['code']]).toEqual([422, 'CURRENCY_NOT_ENABLED']);
  });

  it('[TC-REPORTING-FORECAST-013] la serie diaria solo llega al pedir una cuenta líquida y una cuenta no líquida o ajena se rechaza', async () => {
    const without = await calendar(main.user);
    expect((without.body['accounts'] as Json[]).every((a) => a['series'] === null)).toBe(true);
    expect((without.body['accounts'] as Json[]).map((a) => a['name']).sort()).toEqual([
      'Banco BOB',
      'Efectivo BOB',
    ]);
    const one = await calendar(main.user, `?accountId=${main.bank}`);
    const bank = (one.body['accounts'] as Json[]).find((a) => a['accountId'] === main.bank)!;
    expect((bank['series'] as unknown[]).length).toBe(31);
    expect(m(bank['endBalance'])).toBe('8821.00 BOB');
    for (const accountId of [main.fixedDeposit, other.bank, randomUUID()]) {
      const r = await get(main.user, `/reports/cash-flow-calendar?accountId=${accountId}`);
      expect([r.status, r.body['code']], JSON.stringify(r.body)).toEqual([400, 'INVALID_FILTER']);
    }
  });

  it('[TC-REPORTING-FORECAST-017] el resumen del Home trae el bloque cashFlow de 30 días y un workspace sin cuentas líquidas no', async () => {
    const s = await get(main.user, '/reports/summary');
    expect(contract.validateResponse('getReportSummary', 200, s.body), JSON.stringify(s.body)).toEqual([]);
    const block = s.body['cashFlow'] as Json;
    expect(block).toMatchObject({ horizonDays: 30, worst: null, complete: true });
    expect(m((block['consolidatedLowest'] as Json)['amount'])).toBe('3821.00 BOB');
    expect((block['consolidatedLowest'] as Json)['date']).toBe('2026-10-28');
    const lonely = await user(`kc-cff-empty-${randomUUID()}`);
    const empty = await get(lonely, '/reports/summary');
    expect(empty.body['cashFlow']).toBeNull();
  });

  it('[TC-REPORTING-FORECAST-017] una reserva mínima mayor al mínimo esperado abre el riesgo alto en el calendario y en el Home', async () => {
    const before = await call('GET', W(main.user), { token: main.user.token });
    const patched = await call('PATCH', W(main.user), {
      token: main.user.token,
      body: { minimumLiquidityReserve: bob('5000.00') },
      headers: {
        'content-type': 'application/merge-patch+json',
        'if-match': `"${String(before.body['version'])}"`,
      },
    });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const r = await calendar(main.user);
    const b = bobCurrency(r) as unknown as Json;
    expect(b).toMatchObject({ risk: 'HIGH', firstShortfallDate: '2026-10-20', belowZero: false });
    expect(m(b['shortfallAmount'])).toBe('1179.00 BOB');
    expect((b['threshold'] as Json)['source']).toBe('MINIMUM_RESERVE');
    const s = await get(main.user, '/reports/summary');
    expect(s.body['cashFlow']).toMatchObject({
      worst: { currency: 'BOB', risk: 'HIGH', lowestDate: '2026-10-28' },
    });
    // La reserva vuelve a nada para no afectar a las demás pruebas.
    const cleared = await call('PATCH', W(main.user), {
      token: main.user.token,
      body: { minimumLiquidityReserve: null },
      headers: {
        'content-type': 'application/merge-patch+json',
        'if-match': `"${String(patched.body['version'])}"`,
      },
    });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
  });

  it('[TC-REPORTING-FORECAST-020] ETag/304; omitir Luz se refleja de inmediato; el VIEWER ve lo mismo que el OWNER y nunca Hosting de otro workspace', async () => {
    const first = await calendar(main.user, '?horizon=30');
    const etag = first.headers.get('etag')!;
    expect(etag).toBeTruthy();
    expect(
      (await get(main.user, '/reports/cash-flow-calendar?horizon=30', { 'if-none-match': etag })).status,
    ).toBe(304);
    const occ = await occurrenceOn(main, luz, '2026-10-28');
    ok(await post(main.user, `/recurring/occurrences/${occ.id}/skip`, { reason: 'lo pago el próximo mes' }));
    const after = await calendar(main.user, '?horizon=30', { 'if-none-match': etag });
    expect(after.status).toBe(200);
    expect(balanceOn(after, '2026-10-28')).toBe('4001.00 BOB');
    expect(m(bobCurrency(after).endBalance)).toBe('9501.00 BOB');
    expect(after.body['meta']).toHaveProperty('dataFreshness');
    expect(after.headers.get('etag')).not.toBe(etag);

    const owner = await calendar(main.user, '?horizon=30');
    const seen = await calendar(viewer, '?horizon=30');
    expect(seen.status).toBe(200);
    expect(seen.body['currencies']).toEqual(owner.body['currencies']);
    expect(seen.body['events']).toEqual(owner.body['events']);
    expect(eventNames(seen)).not.toContain('Hosting');
    expect(eventNames(await calendar(other.user, '?horizon=30'))).toEqual(['Hosting']);
  });
});

describe('GET/PUT /reports/spendable/settings (reporting/dashboard)', () => {
  const settingsInput = (over: Json = {}) => ({
    horizonMode: 'NEXT_INCOME',
    subtractEssentials: true,
    essentialCategoryIds: [] as string[],
    ...over,
  });

  it('[TC-REPORTING-FORECAST-027] sin guardar nada los ajustes son los de omisión en versión 1 y todo miembro los lee', async () => {
    for (const u of [main.user, viewer, editor]) {
      const r = await get(u, '/reports/spendable/settings');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(contract.validateResponse('getSpendableSettings', 200, r.body)).toEqual([]);
      expect(r.body).toEqual({
        horizonMode: 'FINANCIAL_PERIOD',
        subtractEssentials: false,
        essentialCategoryIds: [],
        version: 1,
      });
      expect(r.headers.get('etag')).toBe('"1"');
    }
  });

  it('[TC-REPORTING-FORECAST-028] un EDITOR o un VIEWER no pueden cambiar los ajustes (403 INSUFFICIENT_ROLE) y sin If-Match es 428', async () => {
    for (const u of [editor, viewer]) {
      const r = await put(u, '/reports/spendable/settings', settingsInput(), { 'if-match': '"1"' });
      expect([r.status, r.body['code']], JSON.stringify(r.body)).toEqual([403, 'INSUFFICIENT_ROLE']);
    }
    const noMatch = await put(main.user, '/reports/spendable/settings', settingsInput());
    expect(noMatch.status).toBe(428);
    expect((await get(main.user, '/reports/spendable/settings')).body['version']).toBe(1);
  });

  it('[TC-REPORTING-FORECAST-028] una categoría de ingreso se rechaza con 422 CATEGORY_KIND_MISMATCH y una archivada con 409 CATEGORY_ARCHIVED', async () => {
    const income = await put(
      main.user,
      '/reports/spendable/settings',
      settingsInput({ essentialCategoryIds: [main.expenseCategory, main.incomeCategory] }),
      { 'if-match': '"1"' },
    );
    expect([income.status, income.body['code']], JSON.stringify(income.body)).toEqual([
      422,
      'CATEGORY_KIND_MISMATCH',
    ]);
    const group = ok(
      await post(main.user, '/category-groups', { name: `Viejos ${randomUUID()}`, kind: 'EXPENSE' }),
      201,
    );
    const old = ok(
      await post(main.user, '/categories', { groupId: group['id'], name: `Vieja ${randomUUID()}` }),
      201,
    );
    ok(
      await call('POST', `${W(main.user)}/categories/${String(old['id'])}/archive`, {
        token: main.user.token,
        headers: { 'if-match': '"1"' },
      }),
      200,
    );
    const archived = await put(
      main.user,
      '/reports/spendable/settings',
      settingsInput({ essentialCategoryIds: [old['id']] }),
      { 'if-match': '"1"' },
    );
    expect([archived.status, archived.body['code']], JSON.stringify(archived.body)).toEqual([
      409,
      'CATEGORY_ARCHIVED',
    ]);
    expect((await get(main.user, '/reports/spendable/settings')).body['version']).toBe(1);
  });

  it('[TC-REPORTING-FORECAST-027] el OWNER guarda el modo y los esenciales: versión 2, auditoría con anterior y nuevo y el disponible usa el horizonte', async () => {
    const saved = await put(
      main.user,
      '/reports/spendable/settings',
      settingsInput({ essentialCategoryIds: [main.expenseCategory] }),
      { 'if-match': '"1"' },
    );
    expect(saved.status, `${JSON.stringify(saved.body)} ${apiErrors()}`).toBe(200);
    expect(contract.validateResponse('updateSpendableSettings', 200, saved.body)).toEqual([]);
    expect(saved.body).toMatchObject({
      horizonMode: 'NEXT_INCOME',
      subtractEssentials: true,
      essentialCategoryIds: [main.expenseCategory],
      version: 2,
    });
    expect(saved.headers.get('etag')).toBe('"2"');

    const admin = await connect(deps.superuserUrl);
    try {
      const { rows } = await admin.query<{ changes: { field: string; before: unknown; after: unknown }[] }>(
        `SELECT changes FROM audit.audit_log WHERE workspace_id = $1 AND action = 'reporting.spendable_settings.updated'`,
        [main.user.ws],
      );
      expect(rows).toHaveLength(1);
      const byField = Object.fromEntries(rows[0]!.changes.map((c) => [c.field, c]));
      expect(byField['horizonMode']).toMatchObject({ before: 'FINANCIAL_PERIOD', after: 'NEXT_INCOME' });
      expect(byField['essentialCategoryIds']).toMatchObject({
        before: '[]',
        after: JSON.stringify([main.expenseCategory]),
      });
    } finally {
      await admin.end();
    }

    const spendable = await get(main.user, '/reports/spendable');
    expect(
      contract.validateResponse('getSpendable', 200, spendable.body),
      JSON.stringify(spendable.body),
    ).toEqual([]);
    expect(spendable.body['horizon']).toMatchObject({
      mode: 'NEXT_INCOME',
      from: '2026-10-20',
      to: '2026-10-31',
      fallback: false,
    });
    expect((spendable.body['horizon'] as Json)['nextIncome']).toMatchObject({
      name: 'Sueldo',
      date: '2026-10-31',
    });
    // Sin plan del periodo, el esencial no resta y se indica.
    expect(spendable.body['essentialWarnings']).toEqual([
      { categoryId: main.expenseCategory, reason: 'NO_PLAN', periodLabel: '2026-10' },
    ]);

    // Una versión vencida se rechaza sin cambiar nada y guardar lo mismo es idempotente.
    const stale = await put(
      main.user,
      '/reports/spendable/settings',
      settingsInput({ horizonMode: 'FINANCIAL_PERIOD' }),
      {
        'if-match': '"1"',
      },
    );
    expect([stale.status, stale.body['code']]).toEqual([412, 'PRECONDITION_FAILED']);
    const same = await put(
      main.user,
      '/reports/spendable/settings',
      settingsInput({ essentialCategoryIds: [main.expenseCategory] }),
      { 'if-match': '"2"' },
    );
    expect(same.status).toBe(200);
    expect(same.body['version']).toBe(2);
    expect((await get(viewer, '/reports/spendable/settings')).body).toMatchObject({ version: 2 });
    // El otro workspace conserva los suyos.
    expect((await get(other.user, '/reports/spendable/settings')).body['version']).toBe(1);
  });
});
