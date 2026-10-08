import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ApiContract } from '@pf/platform/api';
import type { EventEnvelope } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Custom fields por HTTP contra PostgreSQL real (openspec add-custom-fields, tareas 4.1, 4.2, 5.1, 5.2): definiciones
// (roles, clave, tipo, opciones, archivado), valores por split y por cuenta (validación por tipo, decimales exactos,
// obligatoriedad no retroactiva), INV-033 (sin efecto en el ledger, auditado y con evento), periodos cerrados y el
// filtro del listado de transacciones; respuestas validadas contra el OpenAPI.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const contract = ApiContract.fromFile(resolveContractPath());
const clock = new FixedClock(Instant.parse('2026-03-20T14:00:00Z'));
const apiLog = capturingLogger('finance-api', 'api');

type Json = Record<string, unknown>;
type Money = { amount: string; currency: string };
interface Reply {
  status: number;
  headers: Headers;
  body: Json;
}
interface User {
  token: string;
  id: string;
  ws: string;
}

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;

async function call(
  method: string,
  path: string,
  options: { token: string; body?: unknown; headers?: Record<string, string>; contentType?: string },
): Promise<Reply> {
  const headers: Record<string, string> = { authorization: `Bearer ${options.token}`, ...options.headers };
  let payload: string | undefined;
  if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] = options.contentType ?? 'application/json';
  }
  const res = await fetch(`${baseUrl}${path}`, { method, headers, ...(payload ? { body: payload } : {}) });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as Json) : {} };
}

const expectProblem = (r: Reply, status: number, code: string) => {
  expect(r.status, `${JSON.stringify(r.body)} ${JSON.stringify(apiLog.records().slice(-3))}`).toBe(status);
  expect(r.headers.get('content-type')).toContain('application/problem+json');
  expect(r.body['code']).toBe(code);
};

async function user(): Promise<User> {
  const sub = `kc-cf-${randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
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
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  return {
    token,
    id: me.body['id'] as string,
    ws: (me.body['memberships'] as { workspaceId: string }[])[0]!.workspaceId,
  };
}

const W = (u: User, ws = u.ws) => `/api/v1/workspaces/${ws}`;
const money = (amount: string, currency = 'BOB'): Money => ({ amount, currency });

async function create(u: User, path: string, body: unknown): Promise<Json> {
  const r = await call('POST', `${W(u)}${path}`, {
    token: u.token,
    body,
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(r.status, `${path}: ${JSON.stringify(r.body)}`).toBe(201);
  return r.body;
}
const postRaw = (u: User, path: string, body: unknown, token = u.token) =>
  call('POST', `${W(u)}${path}`, { token, body, headers: { 'idempotency-key': randomUUID() } });
const patch = (u: User, path: string, resource: Json, body: unknown, token = u.token) =>
  call('PATCH', `${W(u)}${path}/${String(resource['id'])}`, {
    token,
    body,
    contentType: 'application/merge-patch+json',
    headers: { 'if-match': `"${String(resource['version'])}"` },
  });
const action = (u: User, path: string, resource: Json, verb: 'archive' | 'unarchive', token = u.token) =>
  call('POST', `${W(u)}${path}/${String(resource['id'])}/${verb}`, {
    token,
    headers: { 'if-match': `"${String(resource['version'])}"` },
  });
const getOne = async (u: User, path: string, id: unknown): Promise<Json> => {
  const r = await call('GET', `${W(u)}${path}/${String(id)}`, { token: u.token });
  expect(r.status).toBe(200);
  return r.body;
};

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

async function asApp<T>(u: User, fn: (c: Client) => Promise<T>): Promise<T> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, () => fn(app));
  } finally {
    await app.end();
  }
}

/** Cierra un mes (lo hará Planning en Phase 2 vía LedgerPeriodLockPort; aquí directo con pf_app y commit). */
async function closeMonth(u: User, yearMonth: string): Promise<void> {
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: u.id, workspaceId: u.ws },
      () =>
        app.query(
          `INSERT INTO ledger.period_lock (workspace_id, year_month, period_start, period_end)
           VALUES ($1, $2::text, to_date($2::text || '-01', 'YYYY-MM-DD'), (to_date($2::text || '-01', 'YYYY-MM-DD') + INTERVAL '1 month - 1 day')::date)`,
          [u.ws, yearMonth],
        ),
      true,
    );
  } finally {
    await app.end();
  }
}

const defineField = async (u: User, body: Json): Promise<Json> => {
  const r = await postRaw(u, '/custom-fields', body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(contract.validateResponse('createCustomField', 201, r.body)).toEqual([]);
  return r.body;
};
const CENTRO_COSTO = {
  key: 'centro_costo',
  label: 'Centro de costo',
  dataType: 'SELECT',
  target: 'TRANSACTION',
  required: false,
  options: [
    { key: 'casa', label: 'Casa' },
    { key: 'oficina', label: 'Oficina' },
  ],
};
const textField = (key: string, target: 'TRANSACTION' | 'ACCOUNT' = 'TRANSACTION', extra: Json = {}) => ({
  key,
  label: key,
  dataType: 'TEXT',
  target,
  ...extra,
});

async function account(u: User, name: string, opening = '2000.00', extra: Json = {}) {
  return await create(u, '/accounts', {
    name,
    type: 'BANK',
    currency: 'BOB',
    openingBalance: { amount: money(opening), date: '2026-03-01' },
    ...extra,
  });
}

const rawExpense = async (
  u: User,
  accountId: string,
  amount: string,
  customFields?: Json,
  extra: Json = {},
): Promise<Reply> =>
  postRaw(u, '/transactions', {
    kind: 'EXPENSE',
    status: 'POSTED',
    transactionDate: '2026-03-10',
    accountId,
    amount: money(amount),
    ...(customFields
      ? { splits: [{ amount: money(amount), categoryId: await category(u), customFields }] }
      : {}),
    ...extra,
  });
async function expenseReply(
  u: User,
  accountId: string,
  amount: string,
  customFields?: Json,
  extra: Json = {},
): Promise<Json> {
  const r = await rawExpense(u, accountId, amount, customFields, extra);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

const categoryCache = new Map<string, string>();
async function category(u: User): Promise<string> {
  const cached = categoryCache.get(u.ws);
  if (cached) return cached;
  const r = await call('GET', `${W(u)}/categories?kind=EXPENSE&limit=200`, { token: u.token });
  const id = (r.body['data'] as { id: string; name: string }[]).find((c) => c.name === 'Supermercado')!.id;
  categoryCache.set(u.ws, id);
  return id;
}

const splitValues = (tx: Json): Json[] =>
  (tx['splits'] as { customFields: Json }[]).map((s) => s.customFields);

const ledger = (u: User) =>
  asApp(u, async (c) => {
    const { rows } = await c.query<{ n: number; h: string | null }>(
      `SELECT (SELECT count(*)::int FROM ledger.journal_entry WHERE workspace_id = $1) AS n,
              md5((SELECT string_agg(row_to_json(p)::text, ',' ORDER BY id) FROM ledger.posting p WHERE workspace_id = $1)) AS h`,
      [u.ws],
    );
    return rows[0]!;
  });

async function eventsOf(u: User, aggregateId: string): Promise<EventEnvelope[]> {
  const worker = await connect(deps.workerDatabaseUrl);
  try {
    const { rows } = await worker.query<{ envelope: EventEnvelope }>(
      'SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND aggregate_id = $2 ORDER BY sequence',
      [u.ws, aggregateId],
    );
    return rows.map((r) => r.envelope);
  } finally {
    await worker.end();
  }
}

const auditChanges = (u: User, aggregateId: string) =>
  asApp(u, async (c) => {
    const { rows } = await c.query<{
      action: string;
      changes: { field: string; before: unknown; after: unknown }[];
    }>(`SELECT action, changes FROM audit.audit_log WHERE aggregate_id = $1 ORDER BY occurred_at, id`, [
      aggregateId,
    ]);
    return rows;
  });

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
}, 180_000);

afterAll(async () => {
  await runtime?.close();
});

describe('Definiciones (tarea 5.1)', () => {
  it('[TC-CLASSIFICATION-CUSTOMFIELD-001] define "centro_costo" (SELECT) y lo lista por objetivo; un SELECT sin opciones ⇒ 400 VALIDATION_FAILED', async () => {
    const u = await user();
    const f = await defineField(u, CENTRO_COSTO);
    expect(f).toMatchObject({
      key: 'centro_costo',
      dataType: 'SELECT',
      target: 'TRANSACTION',
      required: false,
      archivedAt: null,
      version: 1,
      options: [
        { key: 'casa', label: 'Casa', position: 0 },
        { key: 'oficina', label: 'Oficina', position: 1 },
      ],
    });
    const list = await call('GET', `${W(u)}/custom-fields?target=TRANSACTION`, { token: u.token });
    expect(list.status).toBe(200);
    expect(contract.validateResponse('listCustomFields', 200, list.body)).toEqual([]);
    expect((list.body['data'] as Json[]).map((x) => x['key'])).toEqual(['centro_costo']);
    const none = await call('GET', `${W(u)}/custom-fields?target=ACCOUNT`, { token: u.token });
    expect(none.body['data']).toEqual([]);
    const bad = await postRaw(u, '/custom-fields', {
      key: 'proyecto',
      label: 'Proyecto',
      dataType: 'SELECT',
      target: 'TRANSACTION',
      options: [],
    });
    expectProblem(bad, 400, 'VALIDATION_FAILED');
    // MULTI_SELECT y MONEY están fuera de Phase 2 (docs/33 D96).
    const money_ = await postRaw(u, '/custom-fields', {
      key: 'precio',
      label: 'Precio',
      dataType: 'MONEY',
      target: 'TRANSACTION',
    });
    expectProblem(money_, 400, 'VALIDATION_FAILED');
    const got = await call('GET', `${W(u)}/custom-fields/${String(f['id'])}`, { token: u.token });
    expect(contract.validateResponse('getCustomField', 200, got.body)).toEqual([]);
    const del = await call('DELETE', `${W(u)}/custom-fields/${String(f['id'])}`, { token: u.token });
    expectProblem(del, 405, 'METHOD_NOT_ALLOWED');
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-002] clave única entre activas e inmutable; la etiqueta cambia sin tocar los valores', async () => {
    const u = await user();
    const a = await account(u, 'Bank A');
    const f = await defineField(u, CENTRO_COSTO);
    const tx = await expenseReply(u, a['id'] as string, '45.90', { centro_costo: 'oficina' });
    const dup = await postRaw(u, '/custom-fields', CENTRO_COSTO);
    expectProblem(dup, 409, 'CUSTOM_FIELD_KEY_TAKEN');
    expectProblem(await patch(u, '/custom-fields', f, { key: 'cc' }), 400, 'VALIDATION_FAILED');
    expectProblem(
      await postRaw(u, '/custom-fields', { ...CENTRO_COSTO, key: 'Centro Costo' }),
      400,
      'VALIDATION_FAILED',
    );
    const renamed = await patch(u, '/custom-fields', f, { label: 'Centro de gasto' });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    expect(renamed.body).toMatchObject({ key: 'centro_costo', label: 'Centro de gasto', version: 2 });
    expect(splitValues(await getOne(u, '/transactions', tx['id']))).toEqual([{ centro_costo: 'oficina' }]);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-009] con valores: tipo/objetivo bloqueados (409), opción en uso protegida, agregar y renombrar opciones permitido', async () => {
    const u = await user();
    const a = await account(u, 'Bank A');
    const f = await defineField(u, CENTRO_COSTO);
    // Sin valores el tipo todavía puede cambiar (solo catálogo): se verifica con otra definición.
    const spare = await defineField(u, textField('sobrante'));
    expect((await patch(u, '/custom-fields', spare, { dataType: 'BOOLEAN' })).status).toBe(200);
    await expenseReply(u, a['id'] as string, '45.90', { centro_costo: 'oficina' });
    expectProblem(await patch(u, '/custom-fields', f, { dataType: 'TEXT' }), 409, 'CUSTOM_FIELD_TYPE_LOCKED');
    expectProblem(
      await patch(u, '/custom-fields', f, { target: 'ACCOUNT' }),
      409,
      'CUSTOM_FIELD_TYPE_LOCKED',
    );
    expectProblem(
      await patch(u, '/custom-fields', f, { options: [{ key: 'casa', label: 'Casa' }] }),
      409,
      'CUSTOM_FIELD_OPTION_IN_USE',
    );
    const ok = await patch(u, '/custom-fields', f, {
      options: [
        { key: 'casa', label: 'Hogar' },
        { key: 'oficina', label: 'Oficina' },
        { key: 'taller', label: 'Taller' },
      ],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((ok.body['options'] as Json[]).map((o) => o['key'])).toEqual(['casa', 'oficina', 'taller']);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-011] un VIEWER lista y consulta pero no define, edita ni archiva (403 INSUFFICIENT_ROLE)', async () => {
    const owner = await user();
    const viewer = await user();
    await join(owner, viewer, 'VIEWER');
    const f = await defineField(owner, CENTRO_COSTO);
    const list = await call('GET', `${W(owner)}/custom-fields`, { token: viewer.token });
    expect(list.status).toBe(200);
    expect((list.body['data'] as Json[]).map((x) => x['key'])).toEqual(['centro_costo']);
    expect(
      (await call('GET', `${W(owner)}/custom-fields/${String(f['id'])}`, { token: viewer.token })).status,
    ).toBe(200);
    expectProblem(
      await postRaw(owner, '/custom-fields', textField('proyecto'), viewer.token),
      403,
      'INSUFFICIENT_ROLE',
    );
    expectProblem(
      await patch(owner, '/custom-fields', f, { label: 'X' }, viewer.token),
      403,
      'INSUFFICIENT_ROLE',
    );
    expectProblem(
      await action(owner, '/custom-fields', f, 'archive', viewer.token),
      403,
      'INSUFFICIENT_ROLE',
    );
    expect((await getOne(owner, '/custom-fields', f['id']))['archivedAt']).toBeNull();
  });
});

describe('Valores en transacciones (tareas 4.2, 5.2)', () => {
  it('[TC-TRANSACTIONS-CUSTOMFIELD-001] ida y vuelta: el split devuelve exactamente "centro_costo" y "factura"', async () => {
    const u = await user();
    const a = await account(u, 'Bank A');
    await defineField(u, CENTRO_COSTO);
    await defineField(u, textField('factura'));
    const tx = await expenseReply(
      u,
      a['id'] as string,
      '45.90',
      { centro_costo: 'casa', factura: 'F-001234' },
      {
        description: 'Compra semanal',
        transactionDate: '2026-03-10',
      },
    );
    expect(contract.validateResponse('createTransaction', 201, tx)).toEqual([]);
    const got = await getOne(u, '/transactions', tx['id']);
    expect(splitValues(got)).toEqual([{ centro_costo: 'casa', factura: 'F-001234' }]);
    expect(got).toMatchObject({ amount: money('45.90'), source: 'MANUAL', description: 'Compra semanal' });
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-003] los decimales se conservan exactos y los valores inválidos ⇒ 422 sin registrar el gasto', async () => {
    const u = await user();
    const a = await account(u, 'Bank A');
    await defineField(u, { key: 'litros', label: 'Litros', dataType: 'DECIMAL', target: 'TRANSACTION' });
    await defineField(u, { key: 'cuota', label: 'Cuota', dataType: 'NUMBER', target: 'TRANSACTION' });
    await defineField(u, {
      key: 'garantia_hasta',
      label: 'Garantía',
      dataType: 'DATE',
      target: 'TRANSACTION',
    });
    await defineField(u, textField('factura'));
    await defineField(u, {
      key: 'deducible',
      label: 'Deducible',
      dataType: 'BOOLEAN',
      target: 'TRANSACTION',
    });
    const ok = await expenseReply(u, a['id'] as string, '120.00', {
      litros: '35.1250',
      cuota: '3',
      garantia_hasta: '2028-02-29',
      deducible: true,
    });
    expect(splitValues(await getOne(u, '/transactions', ok['id']))).toEqual([
      { litros: '35.125', cuota: '3', garantia_hasta: '2028-02-29', deducible: true },
    ]);
    const before = (await call('GET', `${W(u)}/transactions?limit=50`, { token: u.token })).body[
      'data'
    ] as Json[];
    for (const bad of [
      { cuota: '3.5' },
      { garantia_hasta: '2026-02-30' },
      { factura: '' },
      { deducible: 'si' },
      { litros: '3,5' },
    ]) {
      const r = await postRaw(u, '/transactions', {
        kind: 'EXPENSE',
        status: 'POSTED',
        transactionDate: '2026-03-10',
        accountId: a['id'],
        amount: money('120.00'),
        splits: [{ amount: money('120.00'), categoryId: await category(u), customFields: bad }],
      });
      expectProblem(r, 422, 'CUSTOM_FIELD_VALUE_INVALID');
    }
    const after = (await call('GET', `${W(u)}/transactions?limit=50`, { token: u.token })).body[
      'data'
    ] as Json[];
    expect(after).toHaveLength(before.length);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-004] cada split guarda su valor y un campo de cuenta en una transacción ⇒ 422 CUSTOM_FIELD_TARGET_MISMATCH', async () => {
    const u = await user();
    const a = await account(u, 'Bank A');
    await defineField(u, CENTRO_COSTO);
    await defineField(u, textField('sucursal', 'ACCOUNT'));
    const cat = await category(u);
    const tx = await create(u, '/transactions', {
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: '2026-03-10',
      accountId: a['id'],
      amount: money('300.00'),
      splits: [
        { amount: money('200.00'), categoryId: cat, customFields: { centro_costo: 'casa' } },
        { amount: money('100.00'), categoryId: cat, customFields: { centro_costo: 'oficina' } },
      ],
    });
    expect(splitValues(tx)).toEqual([{ centro_costo: 'casa' }, { centro_costo: 'oficina' }]);
    expect((tx['splits'] as { amount: Money }[]).map((s) => s.amount.amount)).toEqual(['200.00', '100.00']);
    expectProblem(
      await rawExpense(u, a['id'] as string, '45.90', { sucursal: 'Centro' }),
      422,
      'CUSTOM_FIELD_TARGET_MISMATCH',
    );
    // Las transferencias no llevan custom fields (docs/33 D97): el contrato solo los admite en splits de ingresos/gastos.
    expect(
      contract.validateResponse('getTransaction', 200, await getOne(u, '/transactions', tx['id'])),
    ).toEqual([]);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-006] obligatorio: se exige en gastos nuevos y al editar custom fields, no retroactivamente', async () => {
    const u = await user();
    const a = await account(u, 'Bank A');
    const f = await defineField(u, CENTRO_COSTO);
    const g0 = await expenseReply(u, a['id'] as string, '150.00');
    expect(splitValues(g0)).toEqual([{}]);
    expect((await patch(u, '/custom-fields', f, { required: true })).status).toBe(200);
    expectProblem(await rawExpense(u, a['id'] as string, '45.90'), 422, 'CUSTOM_FIELD_REQUIRED');
    const edited = await patch(u, '/transactions', g0, { description: 'Compra mensual' });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(splitValues(edited.body)).toEqual([{}]);
    // Editar sus custom fields sí lo exige.
    const cat = await category(u);
    const bad = await patch(u, '/transactions', edited.body, {
      splits: [{ amount: money('150.00'), categoryId: cat, customFields: { centro_costo: null } }],
    });
    expectProblem(bad, 422, 'CUSTOM_FIELD_REQUIRED');
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-007] cambiar casa → oficina no toca el ledger: mismos asientos y saldo, auditoría antes/después y TransactionUpdated[customFields]', async () => {
    const u = await user();
    const a = await account(u, 'Bank A', '2150.00');
    await defineField(u, CENTRO_COSTO);
    const tx = await expenseReply(u, a['id'] as string, '150.00', { centro_costo: 'casa' });
    const cat = await category(u);
    const before = await ledger(u);
    const r = await patch(u, '/transactions', tx, {
      splits: [{ amount: money('150.00'), categoryId: cat, customFields: { centro_costo: 'oficina' } }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(splitValues(r.body)).toEqual([{ centro_costo: 'oficina' }]);
    expect(await ledger(u)).toEqual(before);
    expect((await getOne(u, '/accounts', a['id']))['balance']).toEqual(money('2000.00'));
    const audit = (await auditChanges(u, tx['id'] as string)).at(-1)!;
    expect(audit.action).toBe('transactions.transaction.updated');
    expect(audit.changes).toEqual([{ field: 'customFields.centro_costo', before: 'casa', after: 'oficina' }]);
    const last = (await eventsOf(u, tx['id'] as string)).at(-1)!;
    expect(last.eventType).toBe('transactions.TransactionUpdated');
    expect(eventSchemaRegistry().validate(last)).toBeUndefined();
    expect(last.payload).toMatchObject({ changedFields: ['customFields'], ledgerImpact: false });
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-008] archivar conserva los valores históricos, bloquea valores nuevos y libera la clave', async () => {
    const u = await user();
    const a = await account(u, 'Bank A');
    const f = await defineField(u, CENTRO_COSTO);
    const tx = await expenseReply(u, a['id'] as string, '45.90', { centro_costo: 'oficina' });
    const archived = await action(u, '/custom-fields', f, 'archive');
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    expect(archived.body['archivedAt']).not.toBeNull();
    expect(splitValues(await getOne(u, '/transactions', tx['id']))).toEqual([{ centro_costo: 'oficina' }]);
    expect(
      ((await call('GET', `${W(u)}/custom-fields`, { token: u.token })).body['data'] as Json[]).length,
    ).toBe(0);
    expect(
      (
        (await call('GET', `${W(u)}/custom-fields?includeArchived=true`, { token: u.token })).body[
          'data'
        ] as Json[]
      ).length,
    ).toBe(1);
    expectProblem(
      await rawExpense(u, a['id'] as string, '45.90', { centro_costo: 'casa' }),
      409,
      'CUSTOM_FIELD_ARCHIVED',
    );
    const again = await defineField(u, CENTRO_COSTO);
    expect(again['id']).not.toBe(f['id']);
    expectProblem(
      await action(u, '/custom-fields', archived.body, 'unarchive'),
      409,
      'CUSTOM_FIELD_KEY_TAKEN',
    );
    // El gasto con el valor histórico sigue editable en otros campos sin perderlo.
    const edited = await patch(u, '/transactions', tx, { description: 'sigue con oficina' });
    expect(splitValues(edited.body)).toEqual([{ centro_costo: 'oficina' }]);
  });

  it('[TC-CLASSIFICATION-CUSTOMFIELD-010] marzo cerrado ⇒ 409 PERIOD_CLOSED: el valor no cambia y no hay auditoría ni evento nuevos', async () => {
    const u = await user();
    const a = await account(u, 'Bank A');
    await defineField(u, CENTRO_COSTO);
    const tx = await expenseReply(
      u,
      a['id'] as string,
      '150.00',
      { centro_costo: 'casa' },
      {
        transactionDate: '2026-03-15',
      },
    );
    await closeMonth(u, '2026-03');
    const audits = (await auditChanges(u, tx['id'] as string)).length;
    const events = (await eventsOf(u, tx['id'] as string)).length;
    const r = await patch(u, '/transactions', tx, {
      splits: [
        { amount: money('150.00'), categoryId: await category(u), customFields: { centro_costo: 'oficina' } },
      ],
    });
    expectProblem(r, 409, 'PERIOD_CLOSED');
    const after = await getOne(u, '/transactions', tx['id']);
    expect(splitValues(after)).toEqual([{ centro_costo: 'casa' }]);
    expect(after['version']).toBe(tx['version']);
    expect((await auditChanges(u, tx['id'] as string)).length).toBe(audits);
    expect((await eventsOf(u, tx['id'] as string)).length).toBe(events);
    // La edición descriptiva (descripción) sigue permitida en periodo cerrado (D65).
    expect((await patch(u, '/transactions', tx, { description: 'Compra de marzo' })).status).toBe(200);
  });

  it('al regenerar los splits (nuevos montos) los valores se copian por posición y los splits reemplazados conservan los suyos', async () => {
    const u = await user();
    const a = await account(u, 'Bank A');
    await defineField(u, CENTRO_COSTO);
    const cat = await category(u);
    const tx = await create(u, '/transactions', {
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: '2026-03-10',
      accountId: a['id'],
      amount: money('300.00'),
      splits: [
        { amount: money('200.00'), categoryId: cat, customFields: { centro_costo: 'casa' } },
        { amount: money('100.00'), categoryId: cat, customFields: { centro_costo: 'oficina' } },
      ],
    });
    const revised = await patch(u, '/transactions', tx, {
      splits: [
        { amount: money('180.00'), categoryId: cat },
        { amount: money('120.00'), categoryId: cat },
      ],
    });
    expect(revised.status, JSON.stringify(revised.body)).toBe(200);
    expect(revised.body['revision']).toBe(2);
    expect(splitValues(revised.body)).toEqual([{ centro_costo: 'casa' }, { centro_costo: 'oficina' }]);
    const kept = await asApp(u, async (c) => {
      const { rows } = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM txn.split_custom_field_value v
           JOIN txn.transaction_split s ON s.id = v.split_id AND s.workspace_id = v.workspace_id
          WHERE s.transaction_id = $1`,
        [tx['id']],
      );
      return rows[0]!.n;
    });
    expect(kept).toBe(4);
  });
});

describe('Valores en cuentas (tarea 5.2)', () => {
  it('[TC-CLASSIFICATION-CUSTOMFIELD-005] "sucursal" en "Bank A": se devuelve, el saldo sigue en 1000.00 BOB y se emite AccountUpdated[customFields]', async () => {
    const u = await user();
    await defineField(u, textField('sucursal', 'ACCOUNT'));
    const a = await account(u, 'Bank A', '1000.00');
    expect(a['customFields']).toEqual({});
    const before = await ledger(u);
    const r = await patch(u, '/accounts', a, { customFields: { sucursal: 'Sucursal Centro' } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(contract.validateResponse('updateAccount', 200, r.body)).toEqual([]);
    expect(r.body['customFields']).toEqual({ sucursal: 'Sucursal Centro' });
    expect(r.body['balance']).toEqual(money('1000.00'));
    expect(await ledger(u)).toEqual(before);
    expect((await getOne(u, '/accounts', a['id']))['customFields']).toEqual({ sucursal: 'Sucursal Centro' });
    const last = (await eventsOf(u, a['id'] as string)).at(-1)!;
    expect(last.eventType).toBe('accounts.AccountUpdated');
    expect(eventSchemaRegistry().validate(last)).toBeUndefined();
    expect(last.payload).toMatchObject({ changedFields: ['customFields'] });
    const audit = (await auditChanges(u, a['id'] as string)).at(-1)!;
    expect(audit.changes).toEqual([
      { field: 'customFields.sucursal', before: null, after: 'Sucursal Centro' },
    ]);
  });

  it('un campo de transacción en una cuenta ⇒ 422 TARGET_MISMATCH; obligatorio de cuenta se exige en cuentas nuevas', async () => {
    const u = await user();
    await defineField(u, CENTRO_COSTO);
    const f = await defineField(u, textField('sucursal', 'ACCOUNT', { required: true }));
    const bad = await postRaw(u, '/accounts', {
      name: 'Bank A',
      type: 'BANK',
      currency: 'BOB',
      customFields: { centro_costo: 'casa', sucursal: 'x' },
    });
    expectProblem(bad, 422, 'CUSTOM_FIELD_TARGET_MISMATCH');
    expectProblem(
      await postRaw(u, '/accounts', { name: 'Bank A', type: 'BANK', currency: 'BOB' }),
      422,
      'CUSTOM_FIELD_REQUIRED',
    );
    const ok = await postRaw(u, '/accounts', {
      name: 'Bank A',
      type: 'BANK',
      currency: 'BOB',
      customFields: { sucursal: 'Centro' },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body['customFields']).toEqual({ sucursal: 'Centro' });
    // Archivar el campo conserva el valor de la cuenta.
    await action(u, '/custom-fields', f, 'archive');
    expect((await getOne(u, '/accounts', ok.body['id']))['customFields']).toEqual({ sucursal: 'Centro' });
  });
});

describe('Filtro del listado (tarea 4.2)', () => {
  it('[TC-TRANSACTIONS-CUSTOMFIELD-002] customField[centro_costo]=oficina devuelve solo los gastos de 45.90 y 150.00 BOB', async () => {
    const u = await user();
    const a = await account(u, 'Bank A', '5000.00');
    await defineField(u, CENTRO_COSTO);
    await expenseReply(u, a['id'] as string, '45.90', { centro_costo: 'oficina' });
    await expenseReply(u, a['id'] as string, '150.00', { centro_costo: 'oficina' });
    await expenseReply(u, a['id'] as string, '200.00', { centro_costo: 'casa' });
    await expenseReply(u, a['id'] as string, '10.00');
    const q = `customField[centro_costo]=oficina&dateFrom=2026-03-01&dateTo=2026-03-31`;
    const r = await call('GET', `${W(u)}/transactions?${q}`, { token: u.token });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(contract.validateResponse('listTransactions', 200, r.body)).toEqual([]);
    expect((r.body['data'] as { amount: Money }[]).map((t) => t.amount.amount).sort()).toEqual([
      '150.00',
      '45.90',
    ]);
    // Paginación estable con el filtro (cursor firmado con el filtro).
    const p1 = await call('GET', `${W(u)}/transactions?${q}&limit=1`, { token: u.token });
    const cursor = (p1.body['page'] as { nextCursor?: string }).nextCursor;
    expect(cursor).toBeDefined();
    const p2 = await call('GET', `${W(u)}/transactions?${q}&limit=1&cursor=${cursor!}`, { token: u.token });
    expect([...(p1.body['data'] as Json[]), ...(p2.body['data'] as Json[])]).toHaveLength(2);
    // Una clave desconocida no coincide con nada.
    const none = await call('GET', `${W(u)}/transactions?customField[no_existe]=x`, { token: u.token });
    expect(none.status).toBe(200);
    expect(none.body['data']).toEqual([]);
  });

  it('rangos para DECIMAL y DATE (gte/lte), igualdad para BOOLEAN y valores inválidos ⇒ 400', async () => {
    const u = await user();
    const a = await account(u, 'Bank A', '5000.00');
    await defineField(u, { key: 'litros', label: 'Litros', dataType: 'DECIMAL', target: 'TRANSACTION' });
    await defineField(u, {
      key: 'garantia_hasta',
      label: 'Garantía',
      dataType: 'DATE',
      target: 'TRANSACTION',
    });
    await defineField(u, {
      key: 'deducible',
      label: 'Deducible',
      dataType: 'BOOLEAN',
      target: 'TRANSACTION',
    });
    await expenseReply(u, a['id'] as string, '10.00', {
      litros: '8.5',
      garantia_hasta: '2027-01-15',
      deducible: true,
    });
    await expenseReply(u, a['id'] as string, '20.00', {
      litros: '35.125',
      garantia_hasta: '2028-06-01',
      deducible: false,
    });
    await expenseReply(u, a['id'] as string, '30.00', { litros: '60', garantia_hasta: '2029-03-31' });
    const amounts = async (q: string) => {
      const r = await call('GET', `${W(u)}/transactions?${q}`, { token: u.token });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return (r.body['data'] as { amount: Money }[]).map((t) => t.amount.amount).sort();
    };
    expect(await amounts('customField[litros][gte]=10&customField[litros][lte]=40')).toEqual(['20.00']);
    expect(await amounts('customField[litros]=35.125000')).toEqual(['20.00']);
    expect(await amounts('customField[litros][gte]=8.5')).toEqual(['10.00', '20.00', '30.00']);
    expect(await amounts('customField[garantia_hasta][lte]=2028-12-31')).toEqual(['10.00', '20.00']);
    expect(await amounts('customField[deducible]=true')).toEqual(['10.00']);
    for (const bad of [
      'customField[litros]=abc',
      'customField[garantia_hasta]=2026-02-30',
      'customField[deducible]=si',
      'customField[deducible][gte]=true',
    ]) {
      expect((await call('GET', `${W(u)}/transactions?${bad}`, { token: u.token })).status, bad).toBe(400);
    }
  });
});

describe('Aislamiento (tarea 4.1)', () => {
  it('otro workspace no ve las definiciones ni los valores (RLS) y no puede referenciarlas', async () => {
    const a = await user();
    const b = await user();
    const f = await defineField(a, CENTRO_COSTO);
    const acc = await account(a, 'Bank A');
    await expenseReply(a, acc['id'] as string, '45.90', { centro_costo: 'casa' });
    expect((await call('GET', `${W(b)}/custom-fields`, { token: b.token })).body['data']).toEqual([]);
    expect((await call('GET', `${W(b)}/custom-fields/${String(f['id'])}`, { token: b.token })).status).toBe(
      404,
    );
    const accB = await account(b, 'Bank B');
    expectProblem(
      await rawExpense(b, accB['id'] as string, '10.00', { centro_costo: 'casa' }),
      422,
      'REFERENCE_NOT_FOUND',
    );
    const rows = await asApp(b, async (c) => {
      const t = await c.query(`SELECT count(*)::int AS n FROM txn.split_custom_field_value`);
      const d = await c.query(`SELECT count(*)::int AS n FROM classification.custom_field_definition`);
      return [t.rows[0].n, d.rows[0].n];
    });
    expect(rows).toEqual([0, 0]);
  });
});
