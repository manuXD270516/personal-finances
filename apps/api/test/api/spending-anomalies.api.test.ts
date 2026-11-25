/* eslint-disable @typescript-eslint/no-explicit-any -- cuerpos JSON de respuestas validadas contra el contrato */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import { runForecastSchedule, type ForecastingRuntime } from '@pf/forecasting/interface/forecasting.module';
import { identityWorkspaceTimeZones } from '@pf/identity/interface/identity.module';
import { ApiContract } from '@pf/platform/api';
import { PgOutboxWriter } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { AUDIT_POLICIES, financeRuntimes, LIFECYCLE_MACHINES } from '../../src/identity/identity-wiring.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger, workerConfig } from '../support/harness.js';

// Gastos atípicos por HTTP contra PostgreSQL real (openspec add-spending-anomaly-detection, tareas 3 a 5): la pasada diaria del
// worker (mediana y MAD en TypeScript, sin el servicio de pronósticos), la lista, la marca por transactionId, el descarte y la
// restauración con roles, auditoría e idempotencia, el aislamiento entre workspaces y la nula intrusión en las transacciones.
// Las respuestas se validan contra el OpenAPI.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const contract = ApiContract.fromFile(resolveContractPath());
const clock = new FixedClock(Instant.parse('2026-11-12T16:00:00Z')); // 12:00 del 2026-11-12 en La Paz
const apiLog = capturingLogger('finance-api', 'api');
const workerLog = capturingLogger('finance-worker', 'worker');
const apiErrors = () =>
  JSON.stringify(apiLog.records().filter((r) => Number(r['level']) >= 50 || r['level'] === 'error'));

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let disabledRuntime: ApiRuntime;
let baseUrl: string;
let disabledUrl: string;
let worker: Pool;
let forecasting: ForecastingRuntime;

interface Reply {
  status: number;
  body: Record<string, any>;
  headers: Headers;
  text: string;
}

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
  base: string,
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
  const res = await fetch(`${base}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  const text = await res.text();
  let parsed: Record<string, any> = {};
  try {
    parsed = text ? (JSON.parse(text) as Record<string, any>) : {};
  } catch {
    /* cuerpo no JSON */
  }
  return { status: res.status, headers: res.headers, body: parsed, text };
}

async function user(sub: string, base = baseUrl) {
  const token = await tokenFor(sub);
  const me = await call(base, 'GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId, base };
}
type User = Awaited<ReturnType<typeof user>>;
const W = (u: User) => `/api/v1/workspaces/${u.ws}`;

async function join(owner: User, member: User, role: 'EDITOR' | 'VIEWER'): Promise<User> {
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

const post = (u: User, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call(u.base, 'POST', `${W(u)}${path}`, {
    token: u.token,
    ...(body !== undefined ? { body } : {}),
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
const get = (u: User, path: string) => call(u.base, 'GET', `${W(u)}${path}`, { token: u.token });
const ok = async (r: Promise<Reply>, status = 201) => {
  const reply = await r;
  expect(reply.status, `${reply.text} ${apiErrors()}`).toBe(status);
  return reply.body;
};
const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, `${r.text} ${apiErrors()}`).toBe(status);
  expect(r.body['code'], r.text).toBe(code);
};
const checked = (operation: string, status: number, r: Reply) => {
  expect(r.status, `${r.text} ${apiErrors()}`).toBe(status);
  expect(contract.validateResponse(operation, status, r.body), r.text).toEqual([]);
  return r.body;
};

const bob = (amount: string) => ({ amount, currency: 'BOB' });
/** Los 12 gastos de «Restaurantes» de TC-FORECAST-ANOMALY-001: mediana 80.00 y MAD 7.50, todos antes del 2026-11-01. */
const HISTORY = [
  '60.00',
  '65.00',
  '70.00',
  '75.00',
  '78.00',
  '80.00',
  '80.00',
  '82.00',
  '85.00',
  '90.00',
  '95.00',
  '100.00',
];

interface Scenario {
  owner: User;
  editor: User;
  viewer: User;
  account: string;
  category: string;
  /** Gastos atípicos creados: id de la transacción por fecha. */
  older: { id: string; version: number };
  newer: { id: string; version: number };
}

/** Workspace con la historia de «Restaurantes» y dos gastos atípicos (304.00 el 2026-11-10 y 400.00 el 2026-11-12). */
async function scenario(label: string): Promise<Scenario> {
  const owner = await user(`kc-an-${label}-${randomUUID()}`);
  const editor = await join(owner, await user(`kc-an-${label}-ed-${randomUUID()}`), 'EDITOR');
  const viewer = await join(owner, await user(`kc-an-${label}-vw-${randomUUID()}`), 'VIEWER');
  const account = (
    await ok(
      post(owner, '/accounts', {
        name: 'Banco BOB',
        type: 'BANK',
        currency: 'BOB',
        openingBalance: { amount: bob('50000.00'), date: '2026-01-01' },
      }),
    )
  )['id'] as string;
  const group = (await ok(post(owner, '/category-groups', { name: 'Vida diaria', kind: 'EXPENSE' })))[
    'id'
  ] as string;
  const category = (await ok(post(owner, '/categories', { groupId: group, name: 'Restaurantes' })))[
    'id'
  ] as string;
  await ok(post(owner, '/periods', { through: '2027-03-31' }), 200);
  const spend = async (date: string, amount: string) => {
    const tx = await ok(
      post(owner, '/transactions', {
        kind: 'EXPENSE',
        transactionDate: date,
        accountId: account,
        amount: bob(amount),
        splits: [{ amount: bob(amount), categoryId: category }],
      }),
    );
    return { id: tx['id'] as string, version: tx['version'] as number };
  };
  for (const [i, amount] of HISTORY.entries()) {
    await spend(`2026-0${(i % 9) + 1}-1${(i % 8) + 1}`, amount);
  }
  const older = await spend('2026-11-10', '304.00');
  const newer = await spend('2026-11-12', '400.00');
  return { owner, editor, viewer, account, category, older, newer };
}

beforeAll(async () => {
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 6 });
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  const identity = {
    jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
  };
  // La API con la detección habilitada (por omisión) y otra con la detección deshabilitada.
  runtime = await createApiRuntime(apiConfig(baseEnv(deps)), apiLog.logger, { clock, identity });
  baseUrl = await runtime.listen(0, '127.0.0.1');
  disabledRuntime = await createApiRuntime(
    apiConfig(baseEnv(deps, { FORECASTING_ANOMALIES_ENABLED: 'false' })),
    apiLog.logger,
    { clock, identity },
  );
  disabledUrl = await disabledRuntime.listen(0, '127.0.0.1');

  // Composición del worker (pf_worker): la misma que create-worker-runtime, con los pronósticos DESHABILITADOS.
  const audit = createAuditRuntime({
    pool: worker,
    clock,
    policies: AUDIT_POLICIES,
    timeZones: identityWorkspaceTimeZones(worker),
    machines: LIFECYCLE_MACHINES,
  });
  const finance = financeRuntimes({
    pool: worker,
    clock,
    audit: audit.port,
    lifecycle: audit.lifecycle,
    lifecycleQuery: audit.lifecycleQuery,
    history: audit.history,
    logger: workerLog.logger,
    config: workerConfig(baseEnv(deps)),
    outbox: new PgOutboxWriter(eventSchemaRegistry()),
  });
  forecasting = finance.forecasting;
}, 240_000);

afterAll(async () => {
  await runtime?.close();
  await disabledRuntime?.close();
  await worker?.end();
});

/** El trabajo diario `forecasting.schedule` del worker (con los pronósticos deshabilitados). */
const dailyPass = () => runForecastSchedule(forecasting, workerLog.logger, 'manual');

async function inWorkspace<T>(ws: string, fn: (q: Pool['query']) => Promise<T>): Promise<T> {
  const client = await worker.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.workspace_id', $1, true)`,
      [ws],
    );
    const out = await fn(client.query.bind(client) as Pool['query']);
    await client.query('COMMIT');
    return out;
  } finally {
    client.release();
  }
}

describe('detección diaria y lista de gastos atípicos', () => {
  let s: Scenario;
  let beforeTx: Record<string, any>;
  beforeAll(async () => {
    s = await scenario('flow');
    beforeTx = (await get(s.owner, `/transactions/${s.older.id}`)).body;
  }, 240_000);

  it('[TC-FORECAST-ANOMALY-011] con los pronósticos deshabilitados la pasada marca los gastos y no crea corridas', async () => {
    const summary = await dailyPass();
    expect(summary.anomalies, JSON.stringify(workerLog.records().slice(-5))).not.toBeNull();
    expect(summary.anomalies?.errors).toEqual([]);
    expect(summary.created).toBe(0);
    const runs = await inWorkspace(s.owner.ws, (q) =>
      q(`SELECT count(*)::int AS n FROM forecasting.forecast_run WHERE workspace_id = $1`, [s.owner.ws]),
    );
    expect(runs.rows[0]).toMatchObject({ n: 0 });
    const flagged = await inWorkspace(s.owner.ws, (q) =>
      q(`SELECT count(*)::int AS n FROM forecasting.spending_anomaly WHERE workspace_id = $1`, [s.owner.ws]),
    );
    expect(flagged.rows[0]).toMatchObject({ n: 2 });
  });

  it('[TC-FORECAST-ANOMALY-016] un VIEWER ve primero el gasto atípico más reciente, con sus motivos y featureStatus ENABLED', async () => {
    const page = checked('listSpendingAnomalies', 200, await get(s.viewer, '/spending-anomalies'));
    expect(page['featureStatus']).toBe('ENABLED');
    expect(page['nextCursor']).toBeNull();
    const items = page['items'] as any[];
    expect(items.map((i) => i.transactionDate)).toEqual(['2026-11-12', '2026-11-10']);
    expect(items[1]).toMatchObject({
      transactionId: s.older.id,
      status: 'OPEN',
      transactionChanged: false,
      amount: bob('304.00'),
      reportingAmount: bob('304.00'),
      categoryIds: [s.category],
    });
    expect(items[1].reasons[0]).toMatchObject({
      kind: 'CATEGORY_OUTLIER',
      categoryId: s.category,
      ratio: '3.8',
      reference: bob('80.00'),
      sampleSize: 12,
    });
    expect(items[0].reasons[0]).toMatchObject({ ratio: '5.0' });
  });

  it('[TC-FORECAST-ANOMALY-016] pagina con cursor y filtra por rango de fechas y por estado', async () => {
    const first = checked('listSpendingAnomalies', 200, await get(s.viewer, '/spending-anomalies?limit=1'));
    expect(first['items']).toHaveLength(1);
    expect(first['nextCursor']).toEqual(expect.any(String));
    const second = checked(
      'listSpendingAnomalies',
      200,
      await get(s.viewer, `/spending-anomalies?limit=1&cursor=${String(first['nextCursor'])}`),
    );
    expect((second['items'] as any[]).map((i) => i.transactionDate)).toEqual(['2026-11-10']);
    expect(second['nextCursor']).toBeNull();
    const ranged = checked(
      'listSpendingAnomalies',
      200,
      await get(s.viewer, '/spending-anomalies?from=2026-11-11'),
    );
    expect((ranged['items'] as any[]).map((i) => i.transactionDate)).toEqual(['2026-11-12']);
    const none = checked(
      'listSpendingAnomalies',
      200,
      await get(s.viewer, '/spending-anomalies?status=DISMISSED'),
    );
    expect(none['items']).toEqual([]);
    problem(await get(s.viewer, '/spending-anomalies?status=NOPE'), 400, 'VALIDATION_FAILED');
    problem(await get(s.viewer, '/spending-anomalies?from=2026-11-12&to=2026-11-01'), 400, 'INVALID_FILTER');
    problem(await get(s.viewer, '/spending-anomalies?cursor=!!'), 400, 'INVALID_CURSOR');
  });

  it('[TC-FORECAST-ANOMALY-017] la consulta por transactionId devuelve la marca de las filas visibles', async () => {
    const found = checked(
      'listSpendingAnomalies',
      200,
      await get(s.viewer, `/spending-anomalies?transactionId=${s.older.id}&transactionId=${randomUUID()}`),
    );
    expect((found['items'] as any[]).map((i) => i.transactionId)).toEqual([s.older.id]);
    problem(await get(s.viewer, '/spending-anomalies?transactionId=no-es-uuid'), 400, 'VALIDATION_FAILED');
  });

  it('[TC-FORECAST-ANOMALY-015] marcar un gasto no cambia la transacción: misma versión, estado y asientos', async () => {
    const after = (await get(s.owner, `/transactions/${s.older.id}`)).body;
    expect(after['version']).toBe(beforeTx['version']);
    expect(after['status']).toBe(beforeTx['status']);
    expect(after['amount']).toEqual(beforeTx['amount']);
  });

  it('[TC-FORECAST-ANOMALY-011] repetir el trabajo diario no duplica gastos atípicos', async () => {
    await dailyPass();
    const page = checked('listSpendingAnomalies', 200, await get(s.viewer, '/spending-anomalies'));
    expect(page['items']).toHaveLength(2);
  });

  it('[TC-FORECAST-ANOMALY-022] un VIEWER no puede descartar: 403 y el gasto atípico sigue abierto', async () => {
    const id = ((await get(s.viewer, '/spending-anomalies')).body['items'] as any[])[0].id as string;
    problem(await post(s.viewer, `/spending-anomalies/${id}/dismiss`, {}), 403, 'INSUFFICIENT_ROLE');
    const page = (await get(s.viewer, '/spending-anomalies')).body;
    expect((page['items'] as any[]).map((i) => i.status)).toEqual(['OPEN', 'OPEN']);
  });

  it('[TC-FORECAST-ANOMALY-018] el EDITOR descarta con un motivo, repetir es inocuo y queda una sola auditoría', async () => {
    const items = (await get(s.viewer, '/spending-anomalies')).body['items'] as any[];
    const target = items.find((i) => i.transactionId === s.older.id);
    const first = await post(s.editor, `/spending-anomalies/${target.id}/dismiss`, {
      reason: 'EXPECTED_ONE_OFF',
    });
    expect(first.status, `${first.text} ${apiErrors()}`).toBe(204);
    const again = await post(s.editor, `/spending-anomalies/${target.id}/dismiss`, {
      reason: 'EXPECTED_ONE_OFF',
    });
    expect(again.status).toBe(204);
    const open = checked('listSpendingAnomalies', 200, await get(s.viewer, '/spending-anomalies'));
    expect((open['items'] as any[]).map((i) => i.transactionId)).toEqual([s.newer.id]);
    const dismissed = checked(
      'listSpendingAnomalies',
      200,
      await get(s.viewer, '/spending-anomalies?status=DISMISSED'),
    );
    expect((dismissed['items'] as any[])[0]).toMatchObject({
      transactionId: s.older.id,
      status: 'DISMISSED',
      decidedBy: s.editor.id,
      dismissReason: 'EXPECTED_ONE_OFF',
    });
    expect((dismissed['items'] as any[])[0].decidedAt).toEqual(expect.any(String));
    const audits = await inWorkspace(s.owner.ws, (q) =>
      q<{ actor_user_id: string }>(
        `SELECT actor_user_id FROM audit.audit_log WHERE action = 'forecasting.spending_anomaly.dismissed' AND aggregate_id = $1`,
        [target.id],
      ),
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]?.actor_user_id).toBe(s.editor.id);
  });

  it('[TC-FORECAST-ANOMALY-018] un gasto descartado no se marca otra vez en la misma versión tras el trabajo diario', async () => {
    await dailyPass();
    const all = checked('listSpendingAnomalies', 200, await get(s.viewer, '/spending-anomalies?status=ALL'));
    expect(all['items']).toHaveLength(2);
  });

  it('[TC-FORECAST-ANOMALY-019] restaurar vuelve a abrir el gasto con su marca y queda auditado', async () => {
    const dismissed = (await get(s.viewer, '/spending-anomalies?status=DISMISSED')).body['items'] as any[];
    const id = dismissed[0].id as string;
    expect((await post(s.editor, `/spending-anomalies/${id}/restore`)).status).toBe(204);
    expect((await post(s.editor, `/spending-anomalies/${id}/restore`)).status).toBe(204);
    const open = checked('listSpendingAnomalies', 200, await get(s.viewer, '/spending-anomalies'));
    expect((open['items'] as any[]).map((i) => [i.transactionId, i.status, i.dismissReason])).toEqual([
      [s.newer.id, 'OPEN', null],
      [s.older.id, 'OPEN', null],
    ]);
    const audits = await inWorkspace(s.owner.ws, (q) =>
      q(
        `SELECT count(*)::int AS n FROM audit.audit_log WHERE action = 'forecasting.spending_anomaly.restored' AND aggregate_id = $1`,
        [id],
      ),
    );
    expect(audits.rows[0]).toMatchObject({ n: 1 });
  });

  it('[TC-FORECAST-ANOMALY-023] el OWNER de otro workspace recibe 404 RESOURCE_NOT_FOUND y el gasto no cambia', async () => {
    const id = ((await get(s.viewer, '/spending-anomalies')).body['items'] as any[])[0].id as string;
    const stranger = await user(`kc-an-other-${randomUUID()}`);
    problem(await post(stranger, `/spending-anomalies/${id}/dismiss`, {}), 404, 'RESOURCE_NOT_FOUND');
    problem(await post(stranger, `/spending-anomalies/${id}/restore`), 404, 'RESOURCE_NOT_FOUND');
    const empty = checked('listSpendingAnomalies', 200, await get(stranger, '/spending-anomalies'));
    expect(empty['items']).toEqual([]);
    const page = (await get(s.viewer, '/spending-anomalies')).body;
    expect((page['items'] as any[]).map((i) => i.status)).toEqual(['OPEN', 'OPEN']);
  });

  it('[TC-FORECAST-ANOMALY-023] la tabla tiene RLS forzada y está registrada en workspace_scoped_table', async () => {
    const { rows } = await worker.query<{ relforcerowsecurity: boolean; relrowsecurity: boolean }>(
      `SELECT relforcerowsecurity, relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'forecasting' AND c.relname IN ('spending_anomaly', 'spending_anomaly_scan')`,
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.relforcerowsecurity && r.relrowsecurity)).toBe(true);
    const migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
    try {
      const registered = await migrator.query<{ table_name: string }>(
        `SELECT table_name FROM platform.workspace_scoped_table
          WHERE schema_name = 'forecasting' AND table_name IN ('spending_anomaly', 'spending_anomaly_scan')`,
      );
      expect(registered.rows.map((r) => r.table_name).sort()).toEqual([
        'spending_anomaly',
        'spending_anomaly_scan',
      ]);
    } finally {
      await migrator.end();
    }
  });

  it('[TC-FORECAST-ANOMALY-016] con la detección deshabilitada la lista informa featureStatus DISABLED', async () => {
    const viewer = await user(`kc-an-dis-${randomUUID()}`, disabledUrl);
    const page = checked('listSpendingAnomalies', 200, await get(viewer, '/spending-anomalies'));
    expect(page).toMatchObject({ featureStatus: 'DISABLED', items: [], nextCursor: null });
  });
});

describe('cambios de la transacción después de la detección', () => {
  let s: Scenario;
  beforeAll(async () => {
    s = await scenario('changes');
    await dailyPass();
  }, 240_000);

  const patch = async (id: string, body: unknown) => {
    const read = await get(s.owner, `/transactions/${id}`);
    return call(s.owner.base, 'PATCH', `${W(s.owner)}/transactions/${id}`, {
      token: s.owner.token,
      body,
      headers: {
        'content-type': 'application/merge-patch+json',
        'idempotency-key': randomUUID(),
        'if-match': read.headers.get('etag')!,
      },
    });
  };

  it('[TC-FORECAST-ANOMALY-020] corregir el monto reemplaza el gasto atípico y la versión nueva no se marca', async () => {
    const fix = await patch(s.older.id, {
      amount: bob('30.40'),
      splits: [{ amount: bob('30.40'), categoryId: s.category }],
    });
    expect(fix.status, `${fix.text} ${apiErrors()}`).toBe(200);
    // Antes de la pasada siguiente la lista indica que la transacción cambió.
    const before = checked('listSpendingAnomalies', 200, await get(s.viewer, '/spending-anomalies'));
    expect((before['items'] as any[]).find((i) => i.transactionId === s.older.id)).toMatchObject({
      transactionChanged: true,
    });
    await dailyPass();
    const after = checked('listSpendingAnomalies', 200, await get(s.viewer, '/spending-anomalies'));
    expect((after['items'] as any[]).map((i) => i.transactionId)).toEqual([s.newer.id]);
    const states = await inWorkspace(s.owner.ws, (q) =>
      q<{ status: string; transaction_version: number }>(
        `SELECT status, transaction_version FROM forecasting.spending_anomaly
          WHERE workspace_id = $1 AND transaction_id = $2 ORDER BY transaction_version`,
        [s.owner.ws, s.older.id],
      ),
    );
    expect(states.rows.map((r) => r.status)).toEqual(['SUPERSEDED']);
  });

  it('[TC-FORECAST-ANOMALY-021] anular la transacción de un gasto atípico abierto lo oculta de la lista y de la consulta por id', async () => {
    const read = await get(s.owner, `/transactions/${s.newer.id}`);
    const voided = await post(
      s.owner,
      `/transactions/${s.newer.id}/void`,
      { reason: 'duplicado' },
      {
        'if-match': read.headers.get('etag')!,
      },
    );
    expect(voided.status, `${voided.text} ${apiErrors()}`).toBe(200);
    const page = checked('listSpendingAnomalies', 200, await get(s.viewer, '/spending-anomalies'));
    expect(page['items']).toEqual([]);
    const byId = checked(
      'listSpendingAnomalies',
      200,
      await get(s.viewer, `/spending-anomalies?transactionId=${s.newer.id}`),
    );
    expect(byId['items']).toEqual([]);
  });
});

describe('gastos que no se evalúan', () => {
  it('[TC-FORECAST-ANOMALY-009] un cargo de tarjeta (debtRole CARD_CHARGE) con un monto que superaría los umbrales no se evalúa', async () => {
    const s = await scenario('managed');
    // El cargo de tarjeta que administra DEBT: se marca con la columna de la migración de D465.
    const updated = await inWorkspace(s.owner.ws, (q) =>
      q(
        `UPDATE txn.transaction SET debt_role = 'CARD_CHARGE', debt_card_id = $2 WHERE workspace_id = $1 AND id = $3`,
        [s.owner.ws, randomUUID(), s.newer.id],
      ),
    );
    expect(updated.rowCount).toBe(1);
    await dailyPass();
    const page = checked('listSpendingAnomalies', 200, await get(s.viewer, '/spending-anomalies'));
    expect((page['items'] as any[]).map((i) => i.transactionId)).toEqual([s.older.id]);
  }, 240_000);
});
