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

// Próximos pagos, comprometido del periodo, saldo proyectado y pagos sorpresa por HTTP contra PostgreSQL real
// (openspec add-upcoming-payments, tareas 5.2 y 7.1): definiciones recurrentes y transacciones pendientes reales leídas
// de la fuente de verdad por los contratos públicos de COMMITMENTS/TRANSACTIONS/LEDGER/PLANNING/FX, validación del
// OpenAPI, INVALID_FILTER, ETag/304, lectura inmediata tras omitir, rol VIEWER y aislamiento por workspace.
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
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const ok = (r: Reply, status = 200) => {
  expect(r.status, `${JSON.stringify(r.body)} ${apiErrors()}`).toBe(status);
  return r.body;
};
const m = (x: unknown) => {
  const money = x as { amount: string; currency: string } | null | undefined;
  return money ? `${money.amount} ${money.currency}` : null;
};

async function addMember(owner: User, member: User, role: 'VIEWER'): Promise<User> {
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
  category: string;
}
async function workspace(label: string): Promise<Setup> {
  const u = await user(`kc-upc-${label}-${randomUUID()}`);
  const acc = ok(
    await post(u, '/accounts', {
      name: 'Banco BOB',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: bob('4000.00'), date: '2026-09-01' },
    }),
    201,
  );
  const group = ok(await post(u, '/category-groups', { name: `Hogar ${label}`, kind: 'EXPENSE' }), 201);
  const cat = ok(await post(u, '/categories', { groupId: group['id'], name: `Servicios ${label}` }), 201);
  ok(await post(u, '/periods', { through: '2026-12-31' }));
  return { user: u, bank: acc['id'] as string, category: cat['id'] as string };
}

async function definition(
  s: Setup,
  name: string,
  startDate: string,
  amount: Json,
  extra: Json = {},
): Promise<string> {
  const body = ok(
    await post(s.user, '/recurring', {
      name,
      kind: 'EXPENSE',
      template: {
        accountId: s.bank,
        amount,
        categoryId: s.category,
        schedule: { cadence: 'MONTHLY', startDate },
        materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
        ...extra,
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

const upcoming = async (u: User, query = '', headers: Record<string, string> = {}) => {
  const r = await get(u, `/reports/upcoming-payments${query}`, headers);
  if (r.status === 200) {
    expect(contract.validateResponse('getUpcomingPayments', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  }
  return r;
};
const names = (r: Reply) => (r.body['items'] as { name: string }[]).map((i) => i.name);

let main: Setup;
let viewer: User;
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
  viewer = await addMember(main.user, await user(`kc-upc-vw-${randomUUID()}`), 'VIEWER');
  other = await workspace('other');

  await definition(main, 'Internet', '2026-10-22', { type: 'FIXED', amount: bob('199.00') });
  luz = await definition(main, 'Luz', '2026-10-28', { type: 'ESTIMATED', amount: bob('180.00') });
  await definition(main, 'Alquiler', '2026-11-01', { type: 'FIXED', amount: bob('2500.00') });
  await definition(main, 'Seguro anual', '2026-12-15', { type: 'FIXED', amount: bob('900.00') });
  // Gasto pendiente "Cena" del 2026-10-18 en el banco.
  ok(
    await post(main.user, '/transactions', {
      kind: 'EXPENSE',
      status: 'PENDING',
      transactionDate: '2026-10-18',
      accountId: main.bank,
      description: 'Cena',
      amount: bob('300.00'),
      splits: [{ amount: bob('300.00'), categoryId: main.category }],
    }),
    201,
  );
  // Otro workspace: "Hosting" no debe aparecer en el de main (RLS, TC-REPORTING-UPCOMING-020).
  await definition(other, 'Hosting', '2026-10-23', { type: 'FIXED', amount: bob('80.00') });
}, 240_000);

afterAll(async () => {
  await runtime?.close();
});

describe('GET /reports/upcoming-payments (reporting/cash-flow-calendar)', () => {
  it('[TC-REPORTING-UPCOMING-001] la lista de 30 días trae Cena, Internet, Luz y Alquiler, sin Seguro anual, con total 3179.00 BOB', async () => {
    const r = await upcoming(main.user, '?days=30');
    expect(r.status).toBe(200);
    expect(names(r)).toEqual(['Cena', 'Internet', 'Luz', 'Alquiler']);
    expect(r.body['window']).toEqual({ from: '2026-10-20', to: '2026-11-19', days: 30 });
    const totals = r.body['totals'] as { consolidated: { amount: unknown; complete: boolean } };
    expect(m(totals.consolidated.amount)).toBe('3179.00 BOB');
    expect(totals.consolidated.complete).toBe(true);
    const cena = (r.body['items'] as Json[])[0]!;
    expect(cena).toMatchObject({ kind: 'PENDING_TRANSACTION', status: 'PENDING', accountName: 'Banco BOB' });
  });

  it('[TC-REPORTING-UPCOMING-004] 91 días se rechaza con 400 INVALID_FILTER; 0 también', async () => {
    for (const days of [91, 0]) {
      const r = await get(main.user, `/reports/upcoming-payments?days=${days}`);
      expect([r.status, r.body['code']], JSON.stringify(r.body)).toEqual([400, 'INVALID_FILTER']);
    }
  });

  it('una moneda de reporte no habilitada se rechaza con 422 CURRENCY_NOT_ENABLED', async () => {
    const r = await get(main.user, '/reports/upcoming-payments?reportingCurrency=BTC');
    expect([r.status, r.body['code']], JSON.stringify(r.body)).toEqual([422, 'CURRENCY_NOT_ENABLED']);
  });

  it('[TC-REPORTING-UPCOMING-016] el saldo proyectado de Banco BOB es 3700.00 (4000.00 menos la pendiente Cena) y el contable no cambia', async () => {
    const r = await upcoming(main.user);
    const balances = r.body['projectedBalances'] as Json[];
    expect(balances).toHaveLength(1);
    expect(balances[0]).toMatchObject({
      accountName: 'Banco BOB',
      booked: bob('4000.00'),
      pendingOut: bob('300.00'),
      projected: bob('3700.00'),
    });
    const summary = await get(main.user, '/reports/summary');
    const bank = (summary.body['accounts'] as Json[]).find((a) => a['name'] === 'Banco BOB');
    expect(bank?.['balance']).toEqual(bob('4000.00'));
  });

  it('[TC-REPORTING-UPCOMING-013] el comprometido del periodo 2026-10 incluye Internet, Luz y la pendiente Cena; Alquiler (noviembre) no suma', async () => {
    const r = await upcoming(main.user);
    const committed = r.body['committed'] as Json;
    expect(committed).toMatchObject({ label: '2026-10', from: '2026-10-01', to: '2026-10-31' });
    const total = committed['total'] as { consolidated: { amount: unknown } };
    expect(m(total.consolidated.amount)).toBe('679.00 BOB');
    expect(m((committed['fromPending'] as { consolidated: { amount: unknown } }).consolidated.amount)).toBe(
      '300.00 BOB',
    );
    expect(
      m((committed['fromCommitments'] as { consolidated: { amount: unknown } }).consolidated.amount),
    ).toBe('379.00 BOB');
    expect(committed['overdueFromPreviousPeriods']).toMatchObject({ count: 0 });
  });

  it('[TC-REPORTING-UPCOMING-019] ETag/304; omitir Luz se refleja de inmediato (200, no 304) con ventana, moneda y frescura', async () => {
    const first = await upcoming(main.user, '?days=30');
    const etag = first.headers.get('etag')!;
    expect(etag).toBeTruthy();
    const again = await get(main.user, '/reports/upcoming-payments?days=30', { 'if-none-match': etag });
    expect(again.status).toBe(304);

    const occ = await occurrenceOn(main, luz, '2026-10-28');
    ok(await post(main.user, `/recurring/occurrences/${occ.id}/skip`, { reason: 'lo pago el próximo mes' }));

    const after = await upcoming(main.user, '?days=30', { 'if-none-match': etag });
    expect(after.status).toBe(200);
    expect(names(after)).toEqual(['Cena', 'Internet', 'Alquiler']);
    expect(m((after.body['totals'] as { consolidated: { amount: unknown } }).consolidated.amount)).toBe(
      '2999.00 BOB',
    );
    expect(after.body['window']).toEqual({ from: '2026-10-20', to: '2026-11-19', days: 30 });
    expect(after.body['meta']).toMatchObject({
      reportingCurrency: 'BOB',
      timeZone: 'America/La_Paz',
      generatedAt: '2026-10-20T14:00:00.000Z',
    });
    expect(after.body['meta']).toHaveProperty('dataFreshness');
    expect(after.headers.get('etag')).not.toBe(etag);
  });

  it('[TC-REPORTING-UPCOMING-020] un VIEWER recibe la misma lista y los mismos totales que el OWNER, sin Hosting de otro workspace', async () => {
    const owner = await upcoming(main.user, '?days=30');
    const view = await upcoming(viewer, '?days=30');
    expect(view.status).toBe(200);
    expect(view.body['items']).toEqual(owner.body['items']);
    expect(view.body['totals']).toEqual(owner.body['totals']);
    expect(names(view)).not.toContain('Hosting');
    const theirs = await upcoming(other.user, '?days=30');
    expect(names(theirs)).toEqual(['Hosting']);
  });

  it('el resumen del Home habilita Q4 y Q8 (AVAILABLE) en un workspace con compromisos', async () => {
    const s = await get(main.user, '/reports/summary');
    const q = Object.fromEntries((s.body['questions'] as Json[]).map((x) => [x['question'], x]));
    expect(q['Q4']).toMatchObject({ status: 'AVAILABLE', actionHint: null });
    expect(q['Q8']).toMatchObject({ status: 'AVAILABLE', actionHint: null });
    expect(q['Q5']).toMatchObject({ status: 'NOT_AVAILABLE_IN_PHASE' });
  });

  it('[TC-REPORTING-UPCOMING-018] un workspace con cuentas pero sin compromisos ni pendientes declara Q4 y Q8 NO_DATA con CREATE_COMMITMENT', async () => {
    const empty = await user(`kc-upc-empty-${randomUUID()}`);
    ok(
      await post(empty, '/accounts', {
        name: 'Caja',
        type: 'CASH',
        currency: 'BOB',
        openingBalance: { amount: bob('10.00'), date: '2026-09-01' },
      }),
      201,
    );
    const s = await get(empty, '/reports/summary');
    expect(contract.validateResponse('getReportSummary', 200, s.body)).toEqual([]);
    const q = Object.fromEntries((s.body['questions'] as Json[]).map((x) => [x['question'], x]));
    for (const key of ['Q4', 'Q8'])
      expect(q[key]).toEqual({ question: key, status: 'NO_DATA', actionHint: 'CREATE_COMMITMENT' });
    const r = await upcoming(empty, '?days=7');
    expect(r.body['hasCommitments']).toBe(false);
    expect(r.body['items']).toEqual([]);
  });
});

describe('GET /reports/surprise-payments (SM-07)', () => {
  it('[TC-REPORTING-UPCOMING-021] un gasto vinculado a una ocurrencia generada después de pagarlo cuenta como sorpresa; el periodo en curso es parcial', async () => {
    const seguro = await definition(main, 'Seguro auto', '2026-10-05', {
      type: 'FIXED',
      amount: bob('350.00'),
    });
    const occ = await occurrenceOn(main, seguro, '2026-10-05');
    const txn = ok(
      await post(main.user, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: '2026-10-05',
        accountId: main.bank,
        description: 'Seguro auto',
        amount: bob('350.00'),
        splits: [{ amount: bob('350.00'), categoryId: main.category }],
      }),
      201,
    );
    ok(await post(main.user, `/recurring/occurrences/${occ.id}/link`, { transactionId: txn['id'] }));

    const r = await get(main.user, '/reports/surprise-payments?period=2026-10');
    expect(r.status, `${JSON.stringify(r.body)} ${apiErrors()}`).toBe(200);
    expect(contract.validateResponse('getSurprisePayments', 200, r.body), JSON.stringify(r.body)).toEqual([]);
    expect(r.body).toMatchObject({
      label: '2026-10',
      partial: true,
      count: 1,
      note: 'UNLINKED_PAYMENTS_NOT_DETECTED',
    });
    expect((r.body['items'] as Json[])[0]).toMatchObject({
      name: 'Seguro auto',
      date: '2026-10-05',
      amount: bob('350.00'),
      generatedOn: '2026-10-20',
    });
    // Sin parámetro: el periodo que contiene hoy; el VIEWER también lo consulta.
    const current = await get(viewer, '/reports/surprise-payments');
    expect(current.body['label']).toBe('2026-10');
  });

  it('un periodo inexistente responde 404 RESOURCE_NOT_FOUND', async () => {
    const r = await get(main.user, '/reports/surprise-payments?period=2030-01');
    expect([r.status, r.body['code']]).toEqual([404, 'RESOURCE_NOT_FOUND']);
  });
});
