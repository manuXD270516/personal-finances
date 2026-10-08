import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import { createCategoryCatalogQuery } from '@pf/classification/interface/classification.module';
import { createFxValuation } from '@pf/fx/interface/fx.module';
import {
  identityWorkspaceCalendarDirectory,
  identityWorkspaceTimeZones,
} from '@pf/identity/interface/identity.module';
import { ledgerActivityRange } from '@pf/ledger/interface/ledger.module';
import {
  createPlanningRuntime,
  planningEventConsumers,
  type PlanningRuntime,
} from '@pf/planning/interface/planning.module';
import { ApiContract, PgUnitOfWork } from '@pf/platform/api';
import {
  EventConsumerRuntime,
  EventSubscriptions,
  PgOutboxWriter,
  type EventConsumerDefinition,
  type EventEnvelope,
} from '@pf/platform/events';
import type { JobQueue } from '@pf/platform/queue';
import { FixedClock, Instant, dec } from '@pf/shared-kernel';
import { createNominalFlowQuery } from '@pf/transactions/interface/transactions.module';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { AUDIT_POLICIES, outboxPort } from '../../src/identity/identity-wiring.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, enableCurrencies, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Presupuestos por HTTP y por el worker contra PostgreSQL real (openspec add-budgets, tareas 4.1, 4.2 y 5.1): plan por
// periodo, líneas, roles, auditoría, periodo cerrado (TC-PLANNING-PLANGUARD-001 de punta a punta), gastado derivado de
// transacciones reales (reembolsos, pendientes, anuladas, transferencias con comisión, fecha de negocio, USD con tasa y
// EUR sin tasa) contrastado con el Home, y los umbrales con emisión única bajo reentregas y evaluaciones concurrentes.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const contract = ApiContract.fromFile(resolveContractPath());
// 2026-11-25 (11:00 en La Paz): las tasas de los gastos del 12 al 15 ya existen y el día 25 de 30 sirve a la proyección.
const clock = new FixedClock(Instant.parse('2026-11-25T15:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');
const workerLog = capturingLogger('finance-worker', 'worker');
const apiErrors = () =>
  JSON.stringify(apiLog.records().filter((r) => Number(r['level']) >= 50 || r['level'] === 'error'));

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
let worker: Pool;
let planning: PlanningRuntime;
let consumers: EventConsumerRuntime;
let definitions: Map<string, EventConsumerDefinition>;

interface Reply {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}
type Money = { amount: string; currency: string };
const bob = (amount: string): Money => ({ amount, currency: 'BOB' });
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
    headers['content-type'] ??= 'application/json';
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
// Todos operan sobre el workspace del owner (editor y viewer son miembros); el externo, sobre el suyo.
const W = (u: User) => `/api/v1/workspaces/${u === outsider ? outsider.ws : owner.ws}`;

async function join(owner: User, member: User, role: 'EDITOR' | 'VIEWER'): Promise<void> {
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
}

const post = (u: User, path: string, body: unknown, headers: Record<string, string> = {}) =>
  call('POST', `${W(u)}${path}`, {
    token: u.token,
    body,
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
const get = (u: User, path: string) => call('GET', `${W(u)}${path}`, { token: u.token });
const patch = (u: User, path: string, body: unknown, version: number) =>
  call('PATCH', `${W(u)}${path}`, {
    token: u.token,
    body,
    headers: { 'content-type': 'application/merge-patch+json', 'if-match': `"${version}"` },
  });
const ok = async (r: Promise<Reply>, status = 201) => {
  const reply = await r;
  expect(reply.status, `${JSON.stringify(reply.body)} ${apiErrors()}`).toBe(status);
  return reply.body;
};
const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.body['code']).toBe(code);
};

async function outboxOf(ws: string, eventType: string) {
  const { rows } = await worker.query<{ envelope: EventEnvelope }>(
    'SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = $2 ORDER BY sequence',
    [ws, eventType],
  );
  return rows.map((r) => r.envelope);
}

const deliver = (consumer: string, envelope: EventEnvelope) =>
  consumers.deliver(definitions.get(consumer)!, envelope);

/** Entrega al consumidor de umbrales el último hecho de transacción publicado (como lo haría el relay). */
async function settle(u: User) {
  const posted = (await outboxOf(u.ws, 'transactions.TransactionPosted')).at(-1)!;
  return deliver('planning.budget-thresholds', posted);
}

async function setPeriodStatus(ws: string, label: string, status: 'CLOSED' | 'REOPENED' | 'ACTIVE') {
  const admin = await connect(deps.superuserUrl);
  try {
    await admin.query(
      `UPDATE planning.financial_period
          SET status = $3, close_count = CASE WHEN $3 = 'ACTIVE' THEN 0 ELSE 1 END,
              latest_close_no = CASE WHEN $3 = 'ACTIVE' THEN NULL ELSE 1 END,
              reopen_count = CASE WHEN $3 = 'REOPENED' THEN 1 ELSE 0 END
        WHERE workspace_id = $1 AND label = $2`,
      [ws, label, status],
    );
  } finally {
    await admin.end();
  }
}

let owner: User;
let editor: User;
let viewer: User;
let outsider: User;
const ids: Record<string, string> = {};
let novBudget: { id: string; version: number } & Record<string, unknown>;

interface Line {
  id: string;
  version: number;
  planned: Money | null;
  target: { kind: string; id: string };
  thresholds: string[];
  progress: Record<string, unknown> & {
    actual: Money;
    remaining: Money;
    reference: Money;
    effectivePlanned: Money;
    utilization: string | null;
    projection: Money | null;
    status: string;
    actualComplete: boolean;
    unconverted: Money[];
    crossedThresholds: string[];
  };
}
const linesOf = (b: Record<string, unknown>) => b['lines'] as Line[];
const lineOf = (b: Record<string, unknown>, categoryId: string) =>
  linesOf(b).find((l) => l.target.id === categoryId)!;
const budgetOf = async (u: User, id: string) => {
  const r = await get(u, `/budgets/${id}`);
  expect(r.status, `${JSON.stringify(r.body)} ${apiErrors()}`).toBe(200);
  expect(contract.validateResponse('getBudget', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  return r.body;
};

async function category(u: User, groupId: string, name: string, parentId?: string) {
  const r = await ok(post(u, '/categories', { groupId, name, ...(parentId ? { parentId } : {}) }));
  return r['id'] as string;
}

async function account(u: User, name: string, currency: string, opening: string) {
  const r = await ok(
    post(u, '/accounts', {
      name,
      type: 'BANK',
      currency,
      openingBalance: { amount: { amount: opening, currency }, date: '2026-09-01' },
    }),
  );
  return r['id'] as string;
}

async function spend(
  u: User,
  accountId: string,
  categoryId: string,
  amount: string,
  date: string,
  extra: Record<string, unknown> = {},
  currency = 'BOB',
) {
  return ok(
    post(u, '/transactions', {
      kind: 'EXPENSE',
      transactionDate: date,
      accountId,
      amount: { amount, currency },
      splits: [{ amount: { amount, currency }, categoryId }],
      ...extra,
    }),
  );
}

beforeAll(async () => {
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 6 });
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
  owner = await user(`kc-bud-owner-${randomUUID()}`);
  editor = await user(`kc-bud-editor-${randomUUID()}`);
  viewer = await user(`kc-bud-viewer-${randomUUID()}`);
  outsider = await user(`kc-bud-out-${randomUUID()}`);
  await join(owner, editor, 'EDITOR');
  await join(owner, viewer, 'VIEWER');

  // Composición del worker (pf_worker): la misma que create-worker-runtime, con la ventana de Reporting (7 d).
  const audit = createAuditRuntime({
    pool: worker,
    clock,
    policies: AUDIT_POLICIES,
    timeZones: identityWorkspaceTimeZones(worker),
  });
  planning = createPlanningRuntime({
    pool: worker,
    clock,
    audit: audit.port,
    lifecycle: audit.lifecycle,
    outbox: outboxPort(new PgOutboxWriter(eventSchemaRegistry())),
    calendar: identityWorkspaceCalendarDirectory(worker),
    activity: ledgerActivityRange(),
    budgets: {
      flows: createNominalFlowQuery(worker),
      catalog: createCategoryCatalogQuery({ pool: worker, clock }),
      rates: createFxValuation({ pool: worker, clock, windowDays: 7 }),
      rateValidityWindowDays: 7,
    },
  });
  const defs = planningEventConsumers(planning);
  definitions = new Map(defs.map((d) => [d.consumer, d]));
  consumers = new EventConsumerRuntime({
    pool: worker,
    queue: {} as JobQueue,
    subscriptions: new EventSubscriptions(defs),
    logger: workerLog.logger,
  });

  // Catálogo propio, cuentas y periodos (el saldo inicial del 2026-09-01 hace cubrir desde "2026-09").
  const alim = (await ok(post(owner, '/category-groups', { name: 'Alimentación (pres)', kind: 'EXPENSE' })))[
    'id'
  ] as string;
  const viv = (await ok(post(owner, '/category-groups', { name: 'Vivienda (pres)', kind: 'EXPENSE' })))[
    'id'
  ] as string;
  const ing = (await ok(post(owner, '/category-groups', { name: 'Ingresos (pres)', kind: 'INCOME' })))[
    'id'
  ] as string;
  ids['grupoAlim'] = alim;
  ids['super'] = await category(owner, alim, 'Supermercado (pres)');
  ids['carnes'] = await category(owner, alim, 'Carnes (pres)', ids['super']);
  ids['rest'] = await category(owner, alim, 'Restaurantes (pres)');
  ids['taxis'] = await category(owner, viv, 'Taxis (pres)');
  ids['cine'] = await category(owner, viv, 'Cine (pres)');
  ids['cafe'] = await category(owner, viv, 'Café (pres)');
  ids['gym'] = await category(owner, viv, 'Gimnasio (pres)');
  ids['salario'] = await category(owner, ing, 'Salario (pres)');
  const cats = await get(owner, '/categories?limit=200');
  ids['fees'] = (cats.body['data'] as { id: string; systemCode: string | null }[]).find(
    (c) => c.systemCode === 'FEES',
  )!.id;
  await ok(
    call('POST', `${W(owner)}/categories/${ids['gym']}/archive`, {
      token: owner.token,
      headers: { 'if-match': '"1"' },
    }),
    200,
  );
  ids['tag'] = (await ok(post(owner, '/tags', { name: 'Viaje Santa Cruz (pres)' })))['id'] as string;

  await enableCurrencies(deps.databaseUrl, { userId: owner.id, workspaceId: owner.ws }, ['EUR']);
  ids['banco'] = await account(owner, 'Banco BOB', 'BOB', '20000.00');
  ids['caja'] = await account(owner, 'Caja BOB', 'BOB', '500.00');
  ids['usd'] = await account(owner, 'Banco USD', 'USD', '1000.00');
  ids['eur'] = await account(owner, 'Banco EUR', 'EUR', '1000.00');

  await ok(post(owner, '/periods', { through: '2026-12-31' }), 200);
  const periods = await get(owner, '/periods?limit=100');
  for (const p of periods.body['data'] as { id: string; label: string }[]) ids[`p${p.label}`] = p.id;
}, 240_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
});

describe('Plan por periodo (HTTP)', () => {
  it('[TC-PLANNING-BUDGET-001] crea el plan vacío en BOB (201 con Location y ETag) y un segundo plan responde 409 BUDGET_ALREADY_EXISTS sin cambiarlo', async () => {
    const first = await post(editor, '/budgets', { periodId: ids['p2026-11'], source: { kind: 'EMPTY' } });
    expect(first.status, `${JSON.stringify(first.body)} ${apiErrors()}`).toBe(201);
    expect(contract.validateResponse('createBudget', 201, first.body), JSON.stringify(first.body)).toEqual(
      [],
    );
    expect(first.body).toMatchObject({ currency: 'BOB', origin: 'EMPTY', periodLabel: '2026-11', lines: [] });
    expect(first.headers.get('location')).toBe(`${W(owner)}/budgets/${String(first.body['id'])}`);
    expect(first.headers.get('etag')).toBe('"1"');
    novBudget = first.body as typeof novBudget;
    const again = await post(editor, '/budgets', { periodId: ids['p2026-11'] });
    problem(again, 409, 'BUDGET_ALREADY_EXISTS');
    expect(contract.validateResponse('createBudget', 409, again.body, 'application/problem+json')).toEqual(
      [],
    );
    const byPeriod = await get(viewer, `/periods/${ids['p2026-11']}/budget`);
    expect(byPeriod.status).toBe(200);
    expect(byPeriod.body['id']).toBe(novBudget.id);
    expect(contract.validateResponse('getBudgetByPeriod', 200, byPeriod.body)).toEqual([]);
    problem(await get(viewer, `/periods/${ids['p2026-12']}/budget`), 404, 'RESOURCE_NOT_FOUND');
  });

  it('[TC-PLANNING-BUDGET-002] no se crea el plan de un periodo cerrado (409 PERIOD_CLOSED)', async () => {
    await setPeriodStatus(owner.ws, '2026-09', 'CLOSED');
    problem(await post(editor, '/budgets', { periodId: ids['p2026-09'] }), 409, 'PERIOD_CLOSED');
    expect((await get(owner, '/budgets?periodTo=2026-09')).body['data']).toEqual([]);
    await setPeriodStatus(owner.ws, '2026-09', 'ACTIVE');
  });

  it('[TC-PLANNING-BUDGET-007] montos, moneda, escala, archivada y repetida se rechazan con su código y sin cambiar el plan', async () => {
    const line = (target: string, planned: Money) => ({
      target: { kind: 'CATEGORY', id: target },
      kind: 'MAXIMUM',
      planned,
    });
    const add = (body: unknown) => post(editor, `/budgets/${novBudget.id}/lines`, body);
    const sup = await add(line(ids['super']!, bob('1500.00')));
    expect(sup.status, JSON.stringify(sup.body)).toBe(201);
    expect(contract.validateResponse('addBudgetLine', 201, sup.body), JSON.stringify(sup.body)).toEqual([]);
    expect(sup.body['thresholds']).toEqual(['50', '75', '90', '100']);
    problem(await add(line(ids['rest']!, bob('-100.00'))), 422, 'BUDGET_INVALID_AMOUNTS');
    problem(
      await add({
        target: { kind: 'CATEGORY', id: ids['rest'] },
        kind: 'RANGE',
        min: bob('700.00'),
        max: bob('600.00'),
      }),
      422,
      'BUDGET_INVALID_AMOUNTS',
    );
    problem(await add(line(ids['rest']!, { amount: '100.00', currency: 'USD' })), 422, 'CURRENCY_MISMATCH');
    problem(await add(line(ids['rest']!, bob('100.005'))), 422, 'AMOUNT_SCALE_EXCEEDED');
    problem(await add(line(ids['gym']!, bob('200.00'))), 409, 'CATEGORY_ARCHIVED');
    problem(await add(line(ids['super']!, bob('900.00'))), 409, 'BUDGET_LINE_DUPLICATE_TARGET');
    problem(
      await add({ ...line(ids['rest']!, bob('100.00')), thresholds: ['0'] }),
      422,
      'BUDGET_THRESHOLD_INVALID',
    );
    problem(
      await add({
        target: { kind: 'CATEGORY', id: ids['salario'] },
        kind: 'MAXIMUM',
        planned: bob('8000.00'),
      }),
      422,
      'BUDGET_INVALID_LINE_KIND',
    );
    expect(linesOf(await budgetOf(owner, novBudget.id))).toHaveLength(1);
  });

  it('[TC-PLANNING-BUDGET-008] la subcategoría de una categoría presupuestada y la categoría de un grupo presupuestado se rechazan (409 BUDGET_TARGET_OVERLAP)', async () => {
    problem(
      await post(editor, `/budgets/${novBudget.id}/lines`, {
        target: { kind: 'CATEGORY', id: ids['carnes'] },
        kind: 'MAXIMUM',
        planned: bob('300.00'),
      }),
      409,
      'BUDGET_TARGET_OVERLAP',
    );
    const other = await ok(post(owner, '/budgets', { periodId: ids['p2026-12'] }));
    await ok(
      post(owner, `/budgets/${String(other['id'])}/lines`, {
        target: { kind: 'GROUP', id: ids['grupoAlim'] },
        kind: 'MAXIMUM',
        planned: bob('2500.00'),
      }),
    );
    problem(
      await post(owner, `/budgets/${String(other['id'])}/lines`, {
        target: { kind: 'CATEGORY', id: ids['rest'] },
        kind: 'MAXIMUM',
        planned: bob('600.00'),
      }),
      409,
      'BUDGET_TARGET_OVERLAP',
    );
  });

  it('[TC-PLANNING-BUDGET-013] el VIEWER lee el plan y no edita (403 INSUFFICIENT_ROLE); el cambio del EDITOR queda auditado con antes y después en el historial', async () => {
    const supLine = lineOf(await budgetOf(viewer, novBudget.id), ids['super']!);
    problem(
      await post(viewer, `/budgets/${novBudget.id}/lines`, {
        target: { kind: 'CATEGORY', id: ids['rest'] },
        kind: 'MAXIMUM',
        planned: bob('600.00'),
      }),
      403,
      'INSUFFICIENT_ROLE',
    );
    problem(
      await patch(viewer, `/budgets/${novBudget.id}/lines/${supLine.id}`, { planned: bob('1.00') }, 1),
      403,
      'INSUFFICIENT_ROLE',
    );
    const changed = await patch(
      editor,
      `/budgets/${novBudget.id}/lines/${supLine.id}`,
      { planned: bob('1400.00') },
      supLine.version,
    );
    expect(changed.status, `${JSON.stringify(changed.body)} ${apiErrors()}`).toBe(200);
    expect(contract.validateResponse('updateBudgetLine', 200, changed.body)).toEqual([]);
    expect(m(changed.body['planned'] as Money)).toBe('1400.00 BOB');
    // Sin If-Match => 428; versión vieja => 412.
    const noMatch = await call('PATCH', `${W(editor)}/budgets/${novBudget.id}/lines/${supLine.id}`, {
      token: editor.token,
      body: { planned: bob('1.00') },
      headers: { 'content-type': 'application/merge-patch+json' },
    });
    problem(noMatch, 428, 'PRECONDITION_REQUIRED');
    problem(
      await patch(
        editor,
        `/budgets/${novBudget.id}/lines/${supLine.id}`,
        { planned: bob('1.00') },
        supLine.version,
      ),
      412,
      'PRECONDITION_FAILED',
    );
    const history = await get(viewer, `/budgets/${novBudget.id}/history`);
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    expect(contract.validateResponse('getBudgetHistory', 200, history.body)).toEqual([]);
    const entries = history.body['data'] as {
      action: string;
      actor: { userId: string | null };
      changes: { field: string; before: unknown; after: unknown }[];
    }[];
    const update = entries.find((e) => e.action === 'planning.budget.line_updated')!;
    expect(update.actor.userId).toBe(editor.id);
    const planned = update.changes.find((c) => c.field === 'planned')!;
    expect([m(planned.before as Money), m(planned.after as Money)]).toEqual(['1500.00 BOB', '1400.00 BOB']);
    expect(update.changes.find((c) => c.field === 'line')!.after).toBe(supLine.id);
    // Otro workspace no ve el plan (RLS, 404 idéntico a inexistente).
    expect((await get(outsider, `/budgets/${novBudget.id}`)).status).toBe(404);
    const foreign = await call('GET', `/api/v1/workspaces/${owner.ws}/budgets/${novBudget.id}`, {
      token: outsider.token,
    });
    expect([403, 404]).toContain(foreign.status);
  });
});

describe('Gasto real derivado de transacciones reales (INV-034)', () => {
  it('[TC-PLANNING-BUDGET-003] [TC-PLANNING-BUDGET-009] Supermercado incluye a Carnes y solo el periodo; 550.00 de 1400.00 el día 25 proyecta 660.00', async () => {
    await spend(owner, ids['banco']!, ids['super']!, '400.00', '2026-11-03');
    await spend(owner, ids['banco']!, ids['carnes']!, '150.00', '2026-11-04');
    await spend(owner, ids['banco']!, ids['rest']!, '200.00', '2026-11-05');
    await spend(owner, ids['banco']!, ids['super']!, '90.00', '2026-10-31');
    const line = lineOf(await budgetOf(viewer, novBudget.id), ids['super']!);
    expect(m(line.progress.actual)).toBe('550.00 BOB');
    expect(m(line.progress.remaining)).toBe('850.00 BOB');
    expect(line.progress.utilization).toBe('39.3');
    expect(m(line.progress.projection)).toBe('660.00 BOB');
    expect(line.progress.status).toBe('WITHIN');
  });

  it('[TC-PLANNING-ACTUAL-001] 300.00 posteado − 50.00 reembolso, sin el pendiente de 80.00 ni el anulado de 120.00 => Restaurantes 250.00 (con los 200.00 previos: 450.00)', async () => {
    const cafe = await category(
      owner,
      (await ok(post(owner, '/category-groups', { name: 'Salidas (pres)', kind: 'EXPENSE' })))[
        'id'
      ] as string,
      'Cafetería (pres)',
    );
    ids['cafeteria'] = cafe;
    await ok(
      post(owner, `/budgets/${novBudget.id}/lines`, {
        target: { kind: 'CATEGORY', id: cafe },
        kind: 'MAXIMUM',
        planned: bob('600.00'),
      }),
    );
    const base = await spend(owner, ids['banco']!, cafe, '300.00', '2026-11-06');
    await ok(
      post(owner, '/transactions', {
        kind: 'REFUND',
        transactionDate: '2026-11-07',
        accountId: ids['banco'],
        amount: bob('50.00'),
        refundOfTransactionId: base['id'],
        splits: [{ amount: bob('50.00'), categoryId: cafe }],
      }),
    );
    await spend(owner, ids['banco']!, cafe, '80.00', '2026-11-08', { status: 'PENDING' });
    const voided = await spend(owner, ids['banco']!, cafe, '120.00', '2026-11-09');
    await ok(
      post(
        owner,
        `/transactions/${String(voided['id'])}/void`,
        { reason: 'duplicado' },
        { 'if-match': `"${String(voided['version'])}"` },
      ),
      200,
    );
    const line = lineOf(await budgetOf(owner, novBudget.id), cafe);
    expect(m(line.progress.actual)).toBe('250.00 BOB');
  });

  it('[TC-PLANNING-ACTUAL-002] una transferencia solo afecta por su comisión: 2.00 BOB en la categoría de comisiones', async () => {
    await ok(
      post(owner, `/budgets/${novBudget.id}/lines`, {
        target: { kind: 'CATEGORY', id: ids['fees'] },
        kind: 'MAXIMUM',
        planned: bob('50.00'),
      }),
    );
    const before = linesOf(await budgetOf(owner, novBudget.id)).map((l) => [
      l.target.id,
      m(l.progress.actual),
    ]);
    await ok(
      post(owner, '/transfers', {
        transactionDate: '2026-11-05',
        fromAccountId: ids['banco'],
        toAccountId: ids['caja'],
        amount: bob('500.00'),
        fee: { amount: bob('2.00') },
      }),
    );
    const after = linesOf(await budgetOf(owner, novBudget.id)).map((l) => [
      l.target.id,
      m(l.progress.actual),
    ]);
    const changed = after.filter((row, i) => row[1] !== before[i]![1]);
    expect(changed).toEqual([[ids['fees'], '2.00 BOB']]);
  });

  it('[TC-PLANNING-ACTUAL-003] el gasto del 2026-11-30 cuenta en noviembre y no en diciembre (fecha de negocio)', async () => {
    const decBudget = (await get(owner, `/periods/${ids['p2026-12']}/budget`)).body;
    await ok(
      post(owner, `/budgets/${String(decBudget['id'])}/lines`, {
        target: { kind: 'CATEGORY', id: ids['cine'] },
        kind: 'MAXIMUM',
        planned: bob('400.00'),
      }),
    );
    await ok(
      post(owner, `/budgets/${novBudget.id}/lines`, {
        target: { kind: 'CATEGORY', id: ids['cine'] },
        kind: 'MAXIMUM',
        planned: bob('400.00'),
      }),
    );
    await spend(owner, ids['banco']!, ids['cine']!, '40.00', '2026-11-30');
    expect(m(lineOf(await budgetOf(owner, novBudget.id), ids['cine']!).progress.actual)).toBe('40.00 BOB');
    expect(m(lineOf(await budgetOf(owner, String(decBudget['id'])), ids['cine']!).progress.actual)).toBe(
      '0.00 BOB',
    );
  });

  it('[TC-PLANNING-ACTUAL-004] [TC-PLANNING-ACTUAL-005] [TC-PLANNING-ACTUAL-006] 20.00 USD a 12.05 + 100.00 BOB = 341.00; la tasa posterior no recalcula; 5.00 EUR sin tasa quedan sin convertir; coincide con el Home', async () => {
    await ok(
      post(owner, '/fx-rates', {
        base: 'USD',
        quote: 'BOB',
        value: '12.05',
        rateType: 'PARALLEL',
        asOf: '2026-11-12T10:00:00Z',
        sourceLabel: 'Casa de cambio',
      }),
    );
    await ok(
      post(owner, `/budgets/${novBudget.id}/lines`, {
        target: { kind: 'CATEGORY', id: ids['taxis'] },
        kind: 'MAXIMUM',
        planned: bob('1000.00'),
      }),
    );
    await spend(owner, ids['usd']!, ids['taxis']!, '20.00', '2026-11-12', {}, 'USD');
    await spend(owner, ids['banco']!, ids['taxis']!, '100.00', '2026-11-13');
    const first = await budgetOf(owner, novBudget.id);
    const taxis = lineOf(first, ids['taxis']!);
    expect(m(taxis.progress.actual)).toBe('341.00 BOB');
    expect(taxis.progress.actualComplete).toBe(true);
    const meta = first['meta'] as {
      ratesUsed: { rate: { base: string; value: string }; rateType: string }[];
      rateWindowDays: number;
    };
    expect(meta.rateWindowDays).toBe(7);
    expect(meta.ratesUsed.map((r) => [r.rate.base, r.rate.value, r.rateType])).toEqual([
      ['USD', '12.05', 'PARALLEL'],
    ]);

    // Tasa registrada después (12.40, 2026-11-20): el gasto del día 12 conserva su valoración.
    await ok(
      post(owner, '/fx-rates', {
        base: 'USD',
        quote: 'BOB',
        value: '12.40',
        rateType: 'PARALLEL',
        asOf: '2026-11-20T10:00:00Z',
      }),
    );
    expect(m(lineOf(await budgetOf(owner, novBudget.id), ids['taxis']!).progress.actual)).toBe('341.00 BOB');

    // EUR sin tasa: la parte sin convertir se informa aparte y el gastado queda incompleto (nunca 346.00).
    await spend(owner, ids['eur']!, ids['taxis']!, '5.00', '2026-11-14', {}, 'EUR');
    const incomplete = await budgetOf(owner, novBudget.id);
    const withEur = lineOf(incomplete, ids['taxis']!);
    expect(m(withEur.progress.actual)).toBe('341.00 BOB');
    expect(withEur.progress.actualComplete).toBe(false);
    expect(withEur.progress.unconverted.map(m)).toEqual(['5.00 EUR']);
    expect((incomplete['totals'] as { complete: boolean }).complete).toBe(false);

    // Cruzado Home <-> presupuesto: el monto de la categoría en /reports/summary del mismo rango es el mismo.
    const home = await get(
      owner,
      '/reports/summary?dateFrom=2026-11-01&dateTo=2026-11-30&compare=NONE&topCategories=20',
    );
    expect(home.status, JSON.stringify(home.body)).toBe(200);
    const top = home.body['topExpenseCategories'] as { categoryId: string; amount: Money }[];
    for (const key of ['taxis', 'cafeteria', 'cine', 'fees']) {
      const id = ids[key]!;
      const budgetActual = lineOf(incomplete, id).progress.actual;
      expect(m(top.find((c) => c.categoryId === id)?.amount), key).toBe(m(budgetActual));
    }
  });

  it('[TC-PLANNING-BUDGET-021] un tag suma gastos de varias categorías y no entra al disponible para gastar', async () => {
    const before = (await budgetOf(owner, novBudget.id))['totals'] as { availableToSpend: Money };
    await ok(
      post(owner, `/budgets/${novBudget.id}/lines`, {
        target: { kind: 'TAG', id: ids['tag'] },
        kind: 'MAXIMUM',
        planned: bob('2000.00'),
      }),
    );
    await spend(owner, ids['banco']!, ids['taxis']!, '30.00', '2026-11-15', {
      splits: [{ amount: bob('30.00'), categoryId: ids['taxis'], tagIds: [ids['tag']] }],
    });
    await spend(owner, ids['banco']!, ids['rest']!, '70.00', '2026-11-15', {
      splits: [{ amount: bob('70.00'), categoryId: ids['rest'], tagIds: [ids['tag']] }],
    });
    const after = await budgetOf(owner, novBudget.id);
    const tagLine = linesOf(after).find((l) => l.target.kind === 'TAG')!;
    expect(m(tagLine.progress.actual)).toBe('100.00 BOB');
    // El gasto con tag también cuenta en su categoría; el tag no suma al disponible ni a los totales de gasto.
    const available = (after['totals'] as { availableToSpend: Money }).availableToSpend;
    expect(dec(available.amount).lt(dec(before.availableToSpend.amount))).toBe(true);
    expect(m(tagLine.progress.reference)).toBe('2000.00 BOB');
  });
});

describe('Umbrales: emisión única (worker, pf_worker)', () => {
  const thresholdEvents = async (categoryId: string) =>
    (await outboxOf(owner.ws, 'planning.BudgetThresholdReached')).filter(
      (e) => (e.payload as { target: { id: string } }).target.id === categoryId,
    );

  it('[TC-PLANNING-THRESHOLD-003] [TC-PLANNING-THRESHOLD-004] [TC-PLANNING-THRESHOLD-005] cruzar el 50 % emite un solo hecho aunque el evento se entregue dos veces y dos workers evalúen a la vez; bajar y subir no re-emite', async () => {
    const taxi = ids['cafe']!;
    await ok(
      post(owner, `/budgets/${novBudget.id}/lines`, {
        target: { kind: 'CATEGORY', id: taxi },
        kind: 'MAXIMUM',
        planned: bob('600.00'),
      }),
    );
    const firstSpend = await spend(owner, ids['banco']!, taxi, '280.00', '2026-11-08');
    await settle(owner);
    expect(await thresholdEvents(taxi)).toHaveLength(0);

    await spend(owner, ids['banco']!, taxi, '30.00', '2026-11-09');
    const posted = (await outboxOf(owner.ws, 'transactions.TransactionPosted')).at(-1)!;
    const outcomes = await Promise.all([
      deliver('planning.budget-thresholds', posted),
      planning.budgets!.thresholds.evaluateWorkspace(owner.ws),
      planning.budgets!.thresholds.evaluateWorkspace(owner.ws),
    ]);
    expect(outcomes[0]).toBe('applied');
    expect(await deliver('planning.budget-thresholds', posted)).toBe('duplicate');
    const events = await thresholdEvents(taxi);
    expect(events).toHaveLength(1);
    expect(eventSchemaRegistry().validate(events[0]!)).toBeUndefined();
    expect(events[0]!.payload).toMatchObject({
      threshold: '50',
      alsoCrossed: [],
      reference: bob('600.00'),
      actual: bob('310.00'),
      periodLabel: '2026-11',
      actualComplete: true,
    });

    // Reembolso de 40.00 (270.00) y gasto de 60.00 (330.00): sin hechos nuevos del 50 %.
    await ok(
      post(owner, '/transactions', {
        kind: 'REFUND',
        transactionDate: '2026-11-10',
        accountId: ids['banco'],
        amount: bob('40.00'),
        refundOfTransactionId: firstSpend['id'],
        splits: [{ amount: bob('40.00'), categoryId: taxi }],
      }),
    );
    await settle(owner);
    await spend(owner, ids['banco']!, taxi, '60.00', '2026-11-10');
    await settle(owner);
    expect((await thresholdEvents(taxi)).map((e) => (e.payload as { threshold: string }).threshold)).toEqual([
      '50',
    ]);
  });

  it('[TC-PLANNING-THRESHOLD-006] de 280.00 a 550.00 emite un solo hecho del 90 % con alsoCrossed 50 y 75; luego solo el del 100 %', async () => {
    const cat = ids['cine']!;
    // "Cine" ya tiene 40.00 en noviembre: el máximo se fija en 600.00 para llevarlo a 280.00 y luego a 550.00.
    const line = lineOf(await budgetOf(owner, novBudget.id), cat);
    await ok(
      patch(owner, `/budgets/${novBudget.id}/lines/${line.id}`, { planned: bob('600.00') }, line.version),
      200,
    );
    await spend(owner, ids['banco']!, cat, '240.00', '2026-11-11');
    await settle(owner);
    expect(await thresholdEvents(cat)).toHaveLength(0);
    await spend(owner, ids['banco']!, cat, '270.00', '2026-11-11');
    await settle(owner);
    let events = await thresholdEvents(cat);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      threshold: '90',
      alsoCrossed: ['50', '75'],
      actual: bob('550.00'),
    });
    await spend(owner, ids['banco']!, cat, '50.00', '2026-11-12');
    await settle(owner);
    events = await thresholdEvents(cat);
    expect(
      events.map((e) => [
        (e.payload as { threshold: string }).threshold,
        (e.payload as { alsoCrossed: string[] }).alsoCrossed,
      ]),
    ).toEqual([
      ['90', ['50', '75']],
      ['100', []],
    ]);
  });
});

describe('Plan de un periodo cerrado de solo lectura', () => {
  it('[TC-PLANNING-PLANGUARD-001] [TC-PLANNING-BUDGET-012] cerrado => PERIOD_CLOSED y el plan sigue igual; reabierto => se acepta; un borrador siempre se acepta', async () => {
    const sepBudget = await ok(post(owner, '/budgets', { periodId: ids['p2026-10'] }));
    const sepId = String(sepBudget['id']);
    const supLine = (await ok(
      post(owner, `/budgets/${sepId}/lines`, {
        target: { kind: 'CATEGORY', id: ids['super'] },
        kind: 'MAXIMUM',
        planned: bob('1500.00'),
      }),
    )) as unknown as Line;
    const draftBudget = (await get(owner, `/periods/${ids['p2026-12']}/budget`)).body;
    const draftLine = linesOf(draftBudget)[0]!;
    const crossingsBefore = (await outboxOf(owner.ws, 'planning.BudgetThresholdReached')).length;

    await setPeriodStatus(owner.ws, '2026-10', 'CLOSED');
    problem(
      await patch(
        editor,
        `/budgets/${sepId}/lines/${supLine.id}`,
        { planned: bob('1800.00') },
        supLine.version,
      ),
      409,
      'PERIOD_CLOSED',
    );
    problem(
      await post(editor, `/budgets/${sepId}/lines`, {
        target: { kind: 'CATEGORY', id: ids['rest'] },
        kind: 'MAXIMUM',
        planned: bob('600.00'),
      }),
      409,
      'PERIOD_CLOSED',
    );
    problem(
      await call('DELETE', `${W(editor)}/budgets/${sepId}/lines/${supLine.id}`, { token: editor.token }),
      409,
      'PERIOD_CLOSED',
    );
    expect(m(lineOf(await budgetOf(owner, sepId), ids['super']!).planned)).toBe('1500.00 BOB');
    // Un periodo cerrado nunca se evalúa: no hay hechos de umbral nuevos.
    await planning.budgets!.thresholds.evaluateWorkspace(owner.ws);
    expect((await outboxOf(owner.ws, 'planning.BudgetThresholdReached')).length).toBe(crossingsBefore);
    // La lectura sigue disponible.
    expect((await get(viewer, `/budgets/${sepId}`)).status).toBe(200);

    await setPeriodStatus(owner.ws, '2026-10', 'REOPENED');
    const changed = await patch(
      editor,
      `/budgets/${sepId}/lines/${supLine.id}`,
      { planned: bob('1800.00') },
      supLine.version,
    );
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(m(changed.body['planned'] as Money)).toBe('1800.00 BOB');
    const draft = await patch(
      editor,
      `/budgets/${String(draftBudget['id'])}/lines/${draftLine.id}`,
      { planned: bob('1600.00') },
      draftLine.version,
    );
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);
    await setPeriodStatus(owner.ws, '2026-10', 'ACTIVE');
  });

  it('[TC-PLANNING-BUDGET-018] (integración) el finalizador congela el remanente de octubre (CARRY_POSITIVE) en el plan de noviembre al cerrar y lo vuelve provisional al reabrir', async () => {
    const rest = ids['rest']!;
    const octBudget = (await get(owner, `/periods/${ids['p2026-10']}/budget`)).body;
    const octLine = await ok(
      post(owner, `/budgets/${String(octBudget['id'])}/lines`, {
        target: { kind: 'CATEGORY', id: rest },
        kind: 'MAXIMUM',
        planned: bob('600.00'),
        rolloverPolicy: 'CARRY_POSITIVE',
      }),
    );
    expect(octLine['rolloverPolicy']).toBe('CARRY_POSITIVE');
    await spend(owner, ids['banco']!, rest, '520.00', '2026-10-10');
    await ok(
      post(owner, `/budgets/${novBudget.id}/lines`, {
        target: { kind: 'CATEGORY', id: rest },
        kind: 'MAXIMUM',
        planned: bob('600.00'),
      }),
    );
    let nov = lineOf(await budgetOf(owner, novBudget.id), rest);
    expect(m(nov.progress.effectivePlanned)).toBe('680.00 BOB');
    expect((nov.progress as { rolloverStatus?: string }).rolloverStatus).toBe('PROVISIONAL');

    await setPeriodStatus(owner.ws, '2026-10', 'CLOSED');
    const closedEvent: EventEnvelope = {
      eventId: randomUUID(),
      eventType: 'planning.MonthClosed',
      eventVersion: 1,
      occurredAt: clock.now().toString(),
      workspaceId: owner.ws,
      aggregateType: 'FinancialPeriod',
      aggregateId: ids['p2026-10']!,
      aggregateVersion: 3,
      correlationId: randomUUID(),
      causationId: null,
      actor: { type: 'SYSTEM', id: null },
      payload: { periodId: ids['p2026-10'] },
    };
    expect(await deliver('planning.rollover-finalizer', closedEvent)).toBe('applied');
    expect(await deliver('planning.rollover-finalizer', closedEvent)).toBe('duplicate');
    nov = lineOf(await budgetOf(owner, novBudget.id), rest);
    expect((nov.progress as { rolloverStatus?: string }).rolloverStatus).toBe('FINAL');
    expect(m(nov.progress.effectivePlanned)).toBe('680.00 BOB');

    await setPeriodStatus(owner.ws, '2026-10', 'REOPENED');
    const reopened: EventEnvelope = {
      ...closedEvent,
      eventId: randomUUID(),
      eventType: 'planning.PeriodReopened',
    };
    expect(await deliver('planning.rollover-finalizer', reopened)).toBe('applied');
    nov = lineOf(await budgetOf(owner, novBudget.id), rest);
    expect((nov.progress as { rolloverStatus?: string }).rolloverStatus).toBe('PROVISIONAL');
    await setPeriodStatus(owner.ws, '2026-10', 'ACTIVE');
  });
});

describe('Aislamiento y eventos publicados', () => {
  it('[TC-PLANNING-ISOLATION-001] otro workspace no ve ni lista los planes', async () => {
    const mine = await get(outsider, '/budgets');
    expect(mine.status).toBe(200);
    expect(mine.body['data']).toEqual([]);
    expect((await get(owner, '/budgets')).body['data'] as unknown[]).not.toHaveLength(0);
  });

  it('planning.BudgetCreated.v1 cumple su schema y se publicó una vez por plan', async () => {
    const created = await outboxOf(owner.ws, 'planning.BudgetCreated');
    expect(created.length).toBeGreaterThanOrEqual(2);
    for (const e of created) expect(eventSchemaRegistry().validate(e)).toBeUndefined();
    const ids2 = created.map((e) => e.aggregateId);
    expect(new Set(ids2).size).toBe(ids2.length);
  });

  it('el listado devuelve resúmenes validados contra el contrato, del periodo más reciente al más antiguo', async () => {
    const r = await get(viewer, '/budgets');
    expect(r.status).toBe(200);
    expect(contract.validateResponse('listBudgets', 200, r.body), JSON.stringify(r.body)).toEqual([]);
    const labels = (r.body['data'] as { periodLabel: string }[]).map((b) => b.periodLabel);
    expect(labels).toEqual([...labels].sort().reverse());
  });
});

describe('Ampliaciones aditivas de contratos entre módulos (tarea 3.4)', () => {
  const inWorkspace = <T>(fn: () => Promise<T>) =>
    new PgUnitOfWork(worker).run({ userId: null, workspaceId: owner.ws }, fn);

  it('NominalFlowQuery: `categoryIds` filtra por categoría exacta y `withTags` parte las filas por el conjunto de tags', async () => {
    const flows = createNominalFlowQuery(worker);
    const range = { workspaceId: owner.ws, dateFrom: '2026-11-01', dateTo: '2026-11-30' };
    const all = await inWorkspace(() => flows.summarizeNominalFlows(range));
    expect(all.every((r) => r.tagIds === undefined)).toBe(true);
    const onlyTaxis = await inWorkspace(() =>
      flows.summarizeNominalFlows({ ...range, categoryIds: [ids['taxis']!] }),
    );
    expect(onlyTaxis.length).toBeGreaterThan(0);
    expect(onlyTaxis.every((r) => r.categoryId === ids['taxis'])).toBe(true);
    const withTags = await inWorkspace(() => flows.summarizeNominalFlows({ ...range, withTags: true }));
    expect(withTags.every((r) => Array.isArray(r.tagIds))).toBe(true);
    const tagged = withTags.filter((r) => r.tagIds!.includes(ids['tag']!));
    expect(tagged.map((r) => [r.categoryId, m(r.amount)]).sort()).toEqual(
      [
        [ids['taxis'], '30.00 BOB'],
        [ids['rest'], '70.00 BOB'],
      ].sort(),
    );
    // Los totales por categoría no cambian por partir las filas: Σ con y sin tags coincide.
    const sum = (rows: readonly { categoryId: string; amount: Money }[], id: string) =>
      rows
        .filter((r) => r.categoryId === id && r.amount.currency === 'BOB')
        .reduce((a, r) => a.plus(r.amount.amount), dec('0'))
        .toFixed();
    expect(sum(withTags, ids['taxis']!)).toBe(sum(all, ids['taxis']!));
  });

  it('CategoryCatalogQuery.categoryTree: grupos, categorías con su grupo y subcategoría, tags y archivadas', async () => {
    const catalog = createCategoryCatalogQuery({ pool: worker, clock });
    const tree = await inWorkspace(() => catalog.categoryTree({ userId: '', workspaceId: owner.ws }));
    const byId = new Map(tree.categories.map((c) => [c.categoryId, c]));
    expect(byId.get(ids['carnes']!)).toMatchObject({
      parentId: ids['super'],
      groupId: ids['grupoAlim'],
      kind: 'EXPENSE',
      archived: false,
    });
    expect(byId.get(ids['gym']!)?.archived).toBe(true);
    expect(byId.get(ids['salario']!)?.kind).toBe('INCOME');
    expect(tree.groups.find((g) => g.groupId === ids['grupoAlim'])).toMatchObject({
      kind: 'EXPENSE',
      archived: false,
    });
    expect(tree.tags.find((t) => t.tagId === ids['tag'])).toMatchObject({ archived: false });
  });
});
