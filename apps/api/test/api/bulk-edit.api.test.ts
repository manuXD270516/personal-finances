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
import { createPlanningRuntime, planningEventConsumers } from '@pf/planning/interface/planning.module';
import { ApiContract } from '@pf/platform/api';
import {
  EventConsumerRuntime,
  EventSubscriptions,
  PgOutboxWriter,
  type EventEnvelope,
} from '@pf/platform/events';
import type { JobQueue } from '@pf/platform/queue';
import { reportingDataVersionConsumer } from '@pf/reporting/interface/reporting.module';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { createNominalFlowQuery } from '@pf/transactions/interface/transactions.module';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool, type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { AUDIT_POLICIES, outboxPort } from '../../src/identity/identity-wiring.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Edición masiva por HTTP contra PostgreSQL real (openspec add-bulk-edit, tareas 3.x, 5.2 y 7.1): recategorizar y
// etiquetar con versión por ítem, vista previa por filtro sin efectos, todo o nada con errores por ítem y prioridad de
// código, ledger intacto (INV-033), aplicabilidad, `cleared` en lote, auditoría/recorrido/eventos con el
// `bulkOperationId` como correlación, periodos cerrados (D65), idempotencia, límite de 500, custom fields, roles y
// aislamiento entre workspaces.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
// 2026-11-03 (11:00 en La Paz).
const clock = new FixedClock(Instant.parse('2026-11-03T15:00:00Z'));
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
  options: { token?: string; body?: unknown; headers?: Record<string, string>; contentType?: string } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers['authorization'] = `Bearer ${options.token}`;
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
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.headers.get('content-type')).toContain('application/problem+json');
  expect(r.body['code']).toBe(code);
};
const errorsOf = (r: Reply) => (r.body['errors'] ?? []) as { pointer: string; code: string }[];

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
const patch = (u: User, path: string, body: unknown, version: number) =>
  call('PATCH', `${W(u)}${path}`, {
    token: u.token,
    body,
    contentType: 'application/merge-patch+json',
    headers: { 'if-match': `"${version}"` },
  });
const get = (u: User, path: string) => call('GET', `${W(u)}${path}`, { token: u.token });
const money = (amount: string) => ({ amount, currency: 'BOB' });

async function addMember(owner: User, member: User, role: 'EDITOR' | 'VIEWER'): Promise<User> {
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

async function asApp<T>(u: User, fn: (c: Client) => Promise<T>, commit = false): Promise<T> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, () => fn(app), commit);
  } finally {
    await app.end();
  }
}

/** Cierre del mes (lo escribe Planning en producción vía `LedgerPeriodLockPort`; aquí directo con `pf_app`). */
const lockMonth = (u: User, month: string, end: string) =>
  asApp(
    u,
    (c) =>
      c.query(
        `INSERT INTO ledger.period_lock (workspace_id, year_month, period_start, period_end) VALUES ($1, $2, $3, $4)`,
        [u.ws, month, `${month}-01`, end],
      ),
    true,
  );

/** Asientos y postings del workspace: huella para comprobar que el ledger no cambia (INV-033). */
const ledger = (u: User) =>
  asApp(u, async (c) => {
    const { rows } = await c.query<{ n: number; h: string | null }>(
      `SELECT (SELECT count(*)::int FROM ledger.journal_entry WHERE workspace_id = $1) AS n,
              md5((SELECT string_agg(row_to_json(p)::text, ',' ORDER BY id) FROM ledger.posting p WHERE workspace_id = $1)) AS h`,
      [u.ws],
    );
    return rows[0]!;
  });

const balanceOf = async (u: User, accountId: string) =>
  (await get(u, `/accounts/${accountId}`)).body['balance'];

const auditRows = (u: User) =>
  asApp(u, async (c) => {
    const { rows } = await c.query<{
      action: string;
      aggregate_type: string;
      aggregate_id: string;
      correlation_id: string;
      changes: { field: string; before: unknown; after: unknown }[];
    }>(
      `SELECT action, aggregate_type, aggregate_id, correlation_id::text, changes
         FROM audit.audit_log WHERE workspace_id = $1 ORDER BY occurred_at, id`,
      [u.ws],
    );
    return rows;
  });

async function outbox(u: User) {
  const worker = await connect(deps.workerDatabaseUrl);
  try {
    const { rows } = await worker.query<{
      event_type: string;
      correlation_id: string;
      envelope: EventEnvelope;
    }>(
      `SELECT event_type, correlation_id::text, envelope FROM platform.outbox WHERE workspace_id = $1 ORDER BY sequence`,
      [u.ws],
    );
    return rows;
  } finally {
    await worker.end();
  }
}

const summary = async (u: User) => {
  const r = await get(u, '/reports/summary?month=2026-03&topCategories=20&compare=NONE');
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
};
const categoryTotal = (s: Json, categoryId: string): string =>
  (s['topExpenseCategories'] as { categoryId: string; amount: { amount: string } }[]).find(
    (c) => c.categoryId === categoryId,
  )?.amount.amount ?? '0.00';

// ──────────────────────────────────────────────────────────────────────────── fixtures

interface Tx {
  id: string;
  version: number;
}
interface Scenario {
  owner: User;
  editor: User;
  viewer: User;
  bank: string;
  sup: string;
  hogar: string;
  sueldo: string;
  familia: string;
  /** T1 45.90 (v2), T2 150.00 (v1), T3 200.00 (v4), todos "Supermercado" de marzo de 2026. */
  t: [Tx, Tx, Tx];
}

async function categoryNamed(u: User, kind: 'EXPENSE' | 'INCOME', name?: string) {
  const r = await get(u, `/categories?kind=${kind}&limit=200`);
  const list = r.body['data'] as { id: string; name: string; groupId: string }[];
  const hit = name ? list.find((c) => c.name === name) : list[0];
  expect(hit, `categoría ${name ?? kind}`).toBeDefined();
  return hit!;
}

async function expense(
  u: User,
  accountId: string,
  amount: string,
  date: string,
  categoryId: string,
  extra: Json = {},
): Promise<Tx & Json> {
  const r = await post(u, '/transactions', {
    kind: 'EXPENSE',
    transactionDate: date,
    accountId,
    amount: money(amount),
    splits: [{ amount: money(amount), categoryId }],
    ...extra,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as Tx & Json;
}

/** Edita las notas `times` veces (descriptivo, sube la versión). */
async function touch(u: User, tx: Tx, times: number): Promise<Tx> {
  let current = tx;
  for (let i = 0; i < times; i++) {
    const r = await patch(u, `/transactions/${current.id}`, { notes: `edición ${i}` }, current.version);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    current = r.body as unknown as Tx;
  }
  return current;
}

async function scenario(label: string): Promise<Scenario> {
  const owner = await user(`kc-bulk-${label}-${randomUUID()}`);
  const editor = await addMember(owner, await user(`kc-bulk-ed-${randomUUID()}`), 'EDITOR');
  const viewer = await addMember(owner, await user(`kc-bulk-vw-${randomUUID()}`), 'VIEWER');
  const acc = await post(owner, '/accounts', {
    name: 'Bank A',
    type: 'BANK',
    currency: 'BOB',
    openingBalance: { amount: money('2395.90'), date: '2026-02-28' },
  });
  expect(acc.status, JSON.stringify(acc.body)).toBe(201);
  const bank = acc.body['id'] as string;
  const sup = await categoryNamed(owner, 'EXPENSE', 'Supermercado');
  const hogar = await categoryNamed(owner, 'EXPENSE', 'Hogar');
  const sueldo = await categoryNamed(owner, 'INCOME');
  const tag = await post(owner, '/tags', { name: 'familia' });
  expect(tag.status, JSON.stringify(tag.body)).toBe(201);
  const t1 = await touch(owner, await expense(owner, bank, '45.90', '2026-03-10', sup.id), 1);
  const t2 = await expense(owner, bank, '150.00', '2026-03-12', sup.id);
  const t3 = await touch(owner, await expense(owner, bank, '200.00', '2026-03-14', sup.id), 3);
  expect([t1.version, t2.version, t3.version]).toEqual([2, 1, 4]);
  return {
    owner,
    editor,
    viewer,
    bank,
    sup: sup.id,
    hogar: hogar.id,
    sueldo: sueldo.id,
    familia: tag.body['id'] as string,
    t: [t1, t2, t3],
  };
}

const items = (txs: readonly Tx[]) => txs.map((t) => ({ id: t.id, version: t.version }));
const bulk = (u: User, txs: readonly Tx[], changes: Json, headers: Record<string, string> = {}) =>
  post(u, '/transactions/bulk-edit', { items: items(txs), changes }, headers);
const txOf = async (u: User, id: string) => (await get(u, `/transactions/${id}`)).body;
const splitOf = (tx: Json) => (tx['splits'] as { categoryId: string; tagIds: string[] }[])[0]!;

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
}, 120_000);

afterAll(async () => {
  await runtime?.close();
});

describe('Recategorizar y etiquetar en lote', () => {
  it('[TC-TRANSACTIONS-BULK-001] tres gastos a "Hogar" con el tag "familia": 200, versiones 3, 2 y 5 y el informe mueve 395.90 BOB; categoría archivada o de ingreso se rechazan sin cambios', async () => {
    const s = await scenario('cat');
    const before = await summary(s.owner);
    expect(categoryTotal(before, s.sup)).toBe('395.90');
    const r = await bulk(s.editor, s.t, { categoryId: s.hogar, addTagIds: [s.familia] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(contract.validateResponse('bulkEditTransactions', 200, r.body), JSON.stringify(r.body)).toEqual(
      [],
    );
    const data = r.body['data'] as (Json & { version: number })[];
    expect(data.map((d) => d.version)).toEqual([3, 2, 5]);
    expect(data.map((d) => splitOf(d).categoryId)).toEqual([s.hogar, s.hogar, s.hogar]);
    expect(data.map((d) => splitOf(d).tagIds)).toEqual([[s.familia], [s.familia], [s.familia]]);
    expect(r.body['bulkOperationId']).toMatch(/^[0-9a-f-]{36}$/);
    const after = await summary(s.owner);
    expect(categoryTotal(after, s.sup)).toBe('0.00');
    expect(categoryTotal(after, s.hogar)).toBe('395.90');

    // Categoría archivada y de ingreso: nada cambia.
    const group = (await categoryNamed(s.owner, 'EXPENSE', 'Supermercado')).groupId;
    const pets = await post(s.owner, '/categories', { groupId: group, name: 'Mascotas' });
    expect(pets.status, JSON.stringify(pets.body)).toBe(201);
    const archived = await call('POST', `${W(s.owner)}/categories/${String(pets.body['id'])}/archive`, {
      token: s.owner.token,
      headers: { 'if-match': '"1"' },
    });
    expect(archived.status).toBe(200);
    const fresh = [s.t[0], s.t[1]].map((x, i) => ({
      id: x.id,
      version: (data[i] as { version: number }).version,
    }));
    const archivedTry = await bulk(s.editor, fresh, { categoryId: pets.body['id'] });
    expectProblem(archivedTry, 409, 'CATEGORY_ARCHIVED');
    expect(
      contract.validateResponse('bulkEditTransactions', 409, archivedTry.body, 'application/problem+json'),
    ).toEqual([]);
    const kindTry = await bulk(s.editor, fresh, { categoryId: s.sueldo });
    expectProblem(kindTry, 422, 'CATEGORY_KIND_MISMATCH');
    expect(errorsOf(kindTry).map((e) => e.pointer)).toEqual(['/items/0', '/items/1']);
    expect(splitOf(await txOf(s.owner, s.t[0].id)).categoryId).toBe(s.hogar);
    expect((await txOf(s.owner, s.t[0].id))['version']).toBe(3);
  });
});

describe('Vista previa', () => {
  it('[TC-TRANSACTIONS-BULK-002] por filtro informa 4 transacciones con su versión, 3 aplicables y 1 no aplicable; no cambia versiones ni escribe auditoría', async () => {
    const s = await scenario('prev');
    const t4 = await expense(s.owner, s.bank, '300.00', '2026-03-20', s.sup, {
      splits: [
        { amount: money('200.00'), categoryId: s.sup },
        { amount: money('100.00'), categoryId: s.sup },
      ],
    });
    const auditBefore = (await auditRows(s.owner)).length;
    const eventsBefore = (await outbox(s.owner)).length;
    const r = await post(s.editor, '/transactions/bulk-edit/preview', {
      selection: {
        filter: {
          accountId: [s.bank],
          kind: ['EXPENSE'],
          categoryId: [s.sup],
          dateFrom: '2026-03-01',
          dateTo: '2026-03-31',
        },
      },
      changes: { categoryId: s.hogar },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(
      contract.validateResponse('previewBulkEditTransactions', 200, r.body),
      JSON.stringify(r.body),
    ).toEqual([]);
    expect(r.body).toMatchObject({ count: 4, truncated: false });
    const rows = r.body['items'] as { id: string; version: number; applicable: boolean; reasons: string[] }[];
    const byId = new Map(rows.map((x) => [x.id, x]));
    for (const t of s.t)
      expect(byId.get(t.id)).toMatchObject({ version: t.version, applicable: true, reasons: [] });
    expect(byId.get(t4.id)).toMatchObject({
      version: 1,
      applicable: false,
      reasons: ['BULK_EDIT_NOT_APPLICABLE'],
    });
    expect((await auditRows(s.owner)).length).toBe(auditBefore);
    expect((await outbox(s.owner)).length).toBe(eventsBefore);
    expect((await txOf(s.owner, s.t[0].id))['version']).toBe(2);

    // Por selección explícita: un id inexistente se informa sin fallar.
    const bySelection = await post(s.viewer, '/transactions/bulk-edit/preview', {
      selection: { items: [{ id: s.t[1].id }, { id: randomUUID() }] },
      changes: { cleared: true },
    });
    expectProblem(bySelection, 403, 'INSUFFICIENT_ROLE');
    const ok = await post(s.owner, '/transactions/bulk-edit/preview', {
      selection: { items: [{ id: s.t[1].id }, { id: randomUUID() }] },
      changes: { cleared: true },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((ok.body['items'] as Json[]).map((x) => [x['applicable'], x['reasons']])).toEqual([
      [true, []],
      [false, ['RESOURCE_NOT_FOUND']],
    ]);
  });
});

describe('Todo o nada', () => {
  it('[TC-TRANSACTIONS-BULK-003] una versión obsoleta ⇒ 412 con un error por ítem; un id inexistente ⇒ 404; no cambia ninguna transacción', async () => {
    const s = await scenario('atomic');
    // T2 se edita antes de enviar el lote (versión 2) ⇒ el lote lleva la versión 1.
    const stale = s.t[1];
    await touch(s.owner, stale, 1);
    const r = await bulk(s.editor, s.t, { categoryId: s.hogar });
    expectProblem(r, 412, 'PRECONDITION_FAILED');
    expect(
      contract.validateResponse('bulkEditTransactions', 412, r.body, 'application/problem+json'),
    ).toEqual([]);
    expect(errorsOf(r)).toEqual([
      expect.objectContaining({ pointer: '/items/1/version', code: 'PRECONDITION_FAILED' }),
    ]);
    for (const t of s.t) expect(splitOf(await txOf(s.owner, t.id)).categoryId).toBe(s.sup);
    expect((await txOf(s.owner, s.t[0].id))['version']).toBe(2);

    const missing = await bulk(s.editor, [s.t[0], { id: randomUUID(), version: 1 }], { categoryId: s.hogar });
    expectProblem(missing, 404, 'RESOURCE_NOT_FOUND');
    expect(errorsOf(missing).map((e) => e.pointer)).toEqual(['/items/1/id']);
    expect(splitOf(await txOf(s.owner, s.t[0].id)).categoryId).toBe(s.sup);
  });

  it('[TC-TRANSACTIONS-BULK-004] no cambia saldo ni asientos; monto, cuenta, fecha y systemFlags ⇒ 400 VALIDATION_FAILED sin cambios', async () => {
    const s = await scenario('ledger');
    expect(await balanceOf(s.owner, s.bank)).toEqual(money('2000.00'));
    const before = await ledger(s.owner);
    const r = await bulk(s.editor, s.t, { categoryId: s.hogar });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await ledger(s.owner)).toEqual(before);
    expect(await balanceOf(s.owner, s.bank)).toEqual(money('2000.00'));
    const fresh = (r.body['data'] as Tx[]).map((x) => ({ id: x.id, version: x.version }));
    for (const bad of [
      { amount: money('100.00') },
      { accountId: s.bank },
      { businessDate: '2026-03-01' },
      { transactionDate: '2026-03-01' },
      { systemFlags: ['RECONCILED_WITHOUT_STATEMENT'] },
      { categoryId: s.sup, splits: [] },
    ]) {
      const rejected = await post(s.editor, '/transactions/bulk-edit', { items: fresh, changes: bad });
      expectProblem(rejected, 400, 'VALIDATION_FAILED');
    }
    expectProblem(
      await post(s.editor, '/transactions/bulk-edit', { items: fresh, changes: {} }),
      400,
      'VALIDATION_FAILED',
    );
    expect(await ledger(s.owner)).toEqual(before);
    expect((await txOf(s.owner, fresh[0]!.id))['version']).toBe(3);
  });
});

describe('Aplicabilidad', () => {
  it('[TC-TRANSACTIONS-BULK-005] categoría sobre un gasto de dos splits o una transferencia ⇒ 422 BULK_EDIT_NOT_APPLICABLE; el tag se aplica a todos los splits sin tocar las sumas', async () => {
    const s = await scenario('na');
    const t4 = await expense(s.owner, s.bank, '300.00', '2026-03-20', s.sup, {
      splits: [
        { amount: money('200.00'), categoryId: s.sup },
        { amount: money('100.00'), categoryId: s.sup },
      ],
    });
    const caja = await post(s.owner, '/accounts', { name: 'Caja', type: 'CASH', currency: 'BOB' });
    expect(caja.status, JSON.stringify(caja.body)).toBe(201);
    const transfer = await post(s.owner, '/transfers', {
      transactionDate: '2026-03-21',
      fromAccountId: s.bank,
      toAccountId: caja.body['id'],
      amount: money('100.00'),
    });
    expect(transfer.status, JSON.stringify(transfer.body)).toBe(201);
    const r = await bulk(s.editor, [s.t[0], t4], { categoryId: s.hogar });
    expectProblem(r, 422, 'BULK_EDIT_NOT_APPLICABLE');
    expect(
      contract.validateResponse('bulkEditTransactions', 422, r.body, 'application/problem+json'),
    ).toEqual([]);
    expect(errorsOf(r).map((e) => e.pointer)).toEqual(['/items/1']);
    expect(splitOf(await txOf(s.owner, s.t[0].id)).categoryId).toBe(s.sup);
    expectProblem(
      await bulk(s.editor, [transfer.body as unknown as Tx], { categoryId: s.hogar }),
      422,
      'BULK_EDIT_NOT_APPLICABLE',
    );

    const tag = await post(s.owner, '/tags', { name: 'viaje' });
    const ok = await bulk(s.editor, [s.t[0], t4], { addTagIds: [tag.body['id']] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const [a, b] = ok.body['data'] as Json[];
    expect(splitOf(a!).tagIds).toEqual([tag.body['id']]);
    expect(
      (b!['splits'] as { tagIds: string[]; amount: { amount: string } }[]).map((x) => [
        x.tagIds,
        x.amount.amount,
      ]),
    ).toEqual([
      [[tag.body['id']], '200.00'],
      [[tag.body['id']], '100.00'],
    ]);
    expect((b!['amount'] as { amount: string }).amount).toBe('300.00');
  });
});

describe('Estado cleared en lote', () => {
  it('[TC-TRANSACTIONS-BULK-006] confirmar y etiquetar publica un TransactionCleared por transacción con el bulkOperationId; desconfirmar uno reconciliado ⇒ 409 TRANSACTION_RECONCILED', async () => {
    const s = await scenario('cleared');
    const tag = await post(s.owner, '/tags', { name: 'revisado' });
    const r = await bulk(s.editor, [s.t[0], s.t[1]], { cleared: true, addTagIds: [tag.body['id']] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const data = r.body['data'] as Json[];
    expect(data.map((d) => d['status'])).toEqual(['CLEARED', 'CLEARED']);
    expect(data.map((d) => splitOf(d).tagIds)).toEqual([[tag.body['id']], [tag.body['id']]]);
    const bulkId = r.body['bulkOperationId'] as string;
    const events = (await outbox(s.owner)).filter((e) => e.event_type === 'transactions.TransactionCleared');
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.envelope.payload).toMatchObject({
        bulkOperationId: bulkId,
        cleared: true,
        transition: 'CLEAR',
      });
      expect(e.correlation_id).toBe(bulkId);
      expect(eventSchemaRegistry().validate(e.envelope)).toBeUndefined();
    }

    // Reconciliada (marcado directo sin extracto): no se desconfirma en lote.
    const reconciled = await patch(
      s.owner,
      `/transactions/${s.t[1].id}`,
      { status: 'RECONCILED', reconciliationMode: 'WITHOUT_STATEMENT' },
      (data[1] as { version: number }).version,
    );
    expect(reconciled.status, JSON.stringify(reconciled.body)).toBe(200);
    const rejected = await bulk(
      s.editor,
      [
        { id: s.t[0].id, version: (data[0] as { version: number }).version },
        { id: s.t[1].id, version: reconciled.body['version'] as number },
      ],
      { cleared: false },
    );
    expectProblem(rejected, 409, 'TRANSACTION_RECONCILED');
    expect(errorsOf(rejected).map((e) => e.pointer)).toEqual(['/items/1']);
    expect((await txOf(s.owner, s.t[0].id))['status']).toBe('CLEARED');
    // Una posted no se puede desconfirmar.
    expectProblem(await bulk(s.editor, [s.t[2]], { cleared: false }), 409, 'INVALID_STATUS_TRANSITION');
  });
});

describe('Auditoría con identificador común', () => {
  it('[TC-TRANSACTIONS-BULK-007] 3 registros por transacción + 1 agregado, el recorrido y los eventos comparten el bulkOperationId como correlación', async () => {
    const s = await scenario('audit');
    const baseline = (await auditRows(s.owner)).length;
    const r = await bulk(s.editor, s.t, { categoryId: s.hogar });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const bulkId = r.body['bulkOperationId'] as string;
    const rows = (await auditRows(s.owner)).slice(baseline);
    const perTx = rows.filter((a) => a.action === 'transactions.transaction.updated');
    expect(perTx).toHaveLength(3);
    for (const a of perTx) {
      expect(a.correlation_id).toBe(bulkId);
      expect(a.aggregate_type).toBe('Transaction');
      expect(a.changes.find((c) => c.field === 'bulkOperationId')?.after).toBe(bulkId);
      const splits = a.changes.find((c) => c.field === 'splits')!;
      expect(JSON.parse(String(splits.before))[0].categoryId).toBe(s.sup);
      expect(JSON.parse(String(splits.after))[0].categoryId).toBe(s.hogar);
    }
    const aggregate = rows.filter((a) => a.action === 'transactions.transaction.bulk_edited');
    expect(aggregate).toHaveLength(1);
    expect(aggregate[0]).toMatchObject({
      aggregate_type: 'TransactionBulkOperation',
      aggregate_id: bulkId,
      correlation_id: bulkId,
    });
    expect(aggregate[0]!.changes.find((c) => c.field === 'count')?.after).toBe(3);
    // Recorrido y eventos con la misma correlación.
    const steps = await asApp(s.owner, async (c) => {
      const { rows: r2 } = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit.lifecycle_transition WHERE workspace_id = $1 AND correlation_id = $2`,
        [s.owner.ws, bulkId],
      );
      return r2[0]!.n;
    });
    expect(steps).toBe(3);
    const events = (await outbox(s.owner)).filter((e) => e.correlation_id === bulkId);
    expect(events.filter((e) => e.event_type === 'transactions.TransactionCategorized')).toHaveLength(3);
    for (const e of events) {
      expect(eventSchemaRegistry().validate(e.envelope)).toBeUndefined();
      expect((e.envelope.payload as Json)['bulkOperationId']).toBe(bulkId);
    }
    // Lo que no cambió no audita: repetir la misma categoría no escribe nada.
    const again = await bulk(s.editor, r.body['data'] as Tx[], { categoryId: s.hogar });
    expect(again.status).toBe(200);
    expect((await auditRows(s.owner)).slice(baseline + rows.length).map((a) => a.action)).toEqual([
      'transactions.transaction.bulk_edited',
    ]);
  });
});

describe('Periodos cerrados (D65)', () => {
  it('[TC-TRANSACTIONS-BULK-008] un gasto de un mes cerrado bloquea toda la edición masiva: 409 PERIOD_CLOSED por ese gasto, sin cambios, auditoría ni eventos', async () => {
    const s = await scenario('closed');
    await lockMonth(s.owner, '2026-03', '2026-03-31');
    const april = await expense(s.owner, s.bank, '45.90', '2026-04-02', s.sup);
    const auditBefore = (await auditRows(s.owner)).length;
    const eventsBefore = (await outbox(s.owner)).length;
    const r = await bulk(s.editor, [s.t[1], april], { categoryId: s.hogar });
    expectProblem(r, 409, 'PERIOD_CLOSED');
    expect(
      contract.validateResponse('bulkEditTransactions', 409, r.body, 'application/problem+json'),
    ).toEqual([]);
    expect(errorsOf(r).map((e) => [e.pointer, e.code])).toEqual([['/items/0', 'PERIOD_CLOSED']]);
    expect(splitOf(await txOf(s.owner, april.id)).categoryId).toBe(s.sup);
    expect((await auditRows(s.owner)).length).toBe(auditBefore);
    expect((await outbox(s.owner)).length).toBe(eventsBefore);
  });

  it('[TC-PLANNING-LOCK-004] octubre cerrado: tags, contraparte, custom field y confirmación en lote ⇒ PERIOD_CLOSED señalando el gasto del 2026-10-10; las notas se aceptan y el saldo no cambia', async () => {
    const owner = await user(`kc-bulk-lock-${randomUUID()}`);
    const acc = await post(owner, '/accounts', {
      name: 'Bank A',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: money('1000.00'), date: '2026-09-30' },
    });
    const bank = acc.body['id'] as string;
    const cat = await categoryNamed(owner, 'EXPENSE', 'Restaurantes');
    const cp = await post(owner, '/counterparties', { name: 'Café Central' });
    const other = await post(owner, '/counterparties', { name: 'Panadería Norte' });
    const tag = await post(owner, '/tags', { name: 'viaje' });
    const field = await post(owner, '/custom-fields', {
      key: 'centro_costo',
      label: 'Centro de costo',
      dataType: 'SELECT',
      target: 'TRANSACTION',
      required: false,
      options: [
        { key: 'casa', label: 'Casa' },
        { key: 'oficina', label: 'Oficina' },
      ],
    });
    expect(field.status, JSON.stringify(field.body)).toBe(201);
    const oct = await expense(owner, bank, '80.00', '2026-10-10', cat.id, {
      status: 'CLEARED',
      counterpartyId: cp.body['id'],
    });
    const nov = await expense(owner, bank, '30.00', '2026-11-02', cat.id, { status: 'CLEARED' });
    await lockMonth(owner, '2026-10', '2026-10-31');
    const balance = await balanceOf(owner, bank);
    const auditBefore = (await auditRows(owner)).length;
    const batch = [oct, nov];
    for (const changes of [
      { addTagIds: [tag.body['id']] },
      { counterpartyId: other.body['id'] },
      { customFields: [{ key: 'centro_costo', value: 'oficina' }] },
      { cleared: false },
    ]) {
      const r = await bulk(owner, batch, changes);
      expectProblem(r, 409, 'PERIOD_CLOSED');
      expect(
        errorsOf(r).map((e) => e.pointer),
        JSON.stringify(changes),
      ).toEqual(['/items/0']);
    }
    expect((await auditRows(owner)).length).toBe(auditBefore);
    const notes = await bulk(owner, batch, { notes: 'Revisado con el extracto' });
    expect(notes.status, JSON.stringify(notes.body)).toBe(200);
    expect((notes.body['data'] as Json[]).map((d) => d['notes'])).toEqual([
      'Revisado con el extracto',
      'Revisado con el extracto',
    ]);
    expect(await balanceOf(owner, bank)).toEqual(balance);
    expect((await auditRows(owner)).length).toBeGreaterThan(auditBefore);
    // La edición individual descriptiva sigue permitida y la de clasificación, rechazada (mismo alcance).
    const current = (notes.body['data'] as Json[])[0] as { version: number };
    expect(
      (await patch(owner, `/transactions/${oct.id}`, { description: 'Cena', notes: 'otra' }, current.version))
        .status,
    ).toBe(200);
  });
});

describe('Idempotencia y límite', () => {
  it('[TC-TRANSACTIONS-BULK-009] el reenvío con la misma clave devuelve el resultado original sin versiones ni auditoría nuevas; otra carga con la clave ⇒ 422 IDEMPOTENCY_KEY_REUSED; 501 ítems ⇒ 400; sin clave ⇒ 428', async () => {
    const s = await scenario('idem');
    const key = randomUUID();
    const first = await bulk(s.editor, s.t, { categoryId: s.hogar }, { 'idempotency-key': key });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    const auditAfterFirst = (await auditRows(s.owner)).length;
    const replay = await bulk(s.editor, s.t, { categoryId: s.hogar }, { 'idempotency-key': key });
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotent-replayed')).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect((await auditRows(s.owner)).length).toBe(auditAfterFirst);
    expect((await txOf(s.owner, s.t[0].id))['version']).toBe(3);
    const other = await bulk(s.editor, s.t, { categoryId: s.sup }, { 'idempotency-key': key });
    expectProblem(other, 422, 'IDEMPOTENCY_KEY_REUSED');
    const many = Array.from({ length: 501 }, () => ({ id: randomUUID(), version: 1 }));
    expectProblem(
      await post(s.editor, '/transactions/bulk-edit', { items: many, changes: { categoryId: s.hogar } }),
      400,
      'VALIDATION_FAILED',
    );
    const noKey = await call('POST', `${W(s.editor)}/transactions/bulk-edit`, {
      token: s.editor.token,
      body: { items: items(s.t), changes: { categoryId: s.hogar } },
    });
    expectProblem(noKey, 428, 'IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('Custom fields en lote', () => {
  it('[TC-TRANSACTIONS-BULK-010] fija "oficina" en dos gastos sin tocar el saldo; "taller" ⇒ 422 CUSTOM_FIELD_VALUE_INVALID sin cambios; null quita el valor', async () => {
    const s = await scenario('cf');
    const field = await post(s.owner, '/custom-fields', {
      key: 'centro_costo',
      label: 'Centro de costo',
      dataType: 'SELECT',
      target: 'TRANSACTION',
      required: false,
      options: [
        { key: 'casa', label: 'Casa' },
        { key: 'oficina', label: 'Oficina' },
      ],
    });
    expect(field.status, JSON.stringify(field.body)).toBe(201);
    const two = [s.t[0], s.t[1]];
    const ok = await bulk(s.editor, two, { customFields: [{ key: 'centro_costo', value: 'oficina' }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const data = ok.body['data'] as Json[];
    expect(data.map((d) => (d['splits'] as { customFields: Json }[])[0]!.customFields)).toEqual([
      { centro_costo: 'oficina' },
      { centro_costo: 'oficina' },
    ]);
    expect(await balanceOf(s.owner, s.bank)).toEqual(money('2000.00'));
    const fresh = data.map((d) => ({ id: d['id'] as string, version: d['version'] as number }));
    const bad = await bulk(s.editor, fresh, { customFields: [{ key: 'centro_costo', value: 'taller' }] });
    expectProblem(bad, 422, 'CUSTOM_FIELD_VALUE_INVALID');
    expect((await txOf(s.owner, fresh[0]!.id))['version']).toBe(fresh[0]!.version);
    const byId = await bulk(s.editor, fresh, {
      customFields: [{ fieldId: field.body['id'], value: null }],
    });
    expect(byId.status, JSON.stringify(byId.body)).toBe(200);
    expect(
      (byId.body['data'] as Json[]).map((d) => (d['splits'] as { customFields: Json }[])[0]!.customFields),
    ).toEqual([{}, {}]);
  });
});

describe('Roles y aislamiento', () => {
  it('[TC-TRANSACTIONS-BULK-011] un VIEWER ⇒ 403 INSUFFICIENT_ROLE; un id de otro workspace ⇒ 404 idéntico a uno inexistente y nada cambia en ninguno', async () => {
    const s = await scenario('rbac');
    const other = await scenario('rbac-other');
    const viewerTry = await bulk(s.viewer, [s.t[0], s.t[1]], { categoryId: s.hogar });
    expectProblem(viewerTry, 403, 'INSUFFICIENT_ROLE');
    expect(
      contract.validateResponse('bulkEditTransactions', 403, viewerTry.body, 'application/problem+json'),
    ).toEqual([]);
    expect(splitOf(await txOf(s.owner, s.t[0].id)).categoryId).toBe(s.sup);

    const foreign = await bulk(s.editor, [s.t[0], other.t[0]], { categoryId: s.hogar });
    expectProblem(foreign, 404, 'RESOURCE_NOT_FOUND');
    expect(errorsOf(foreign).map((e) => e.pointer)).toEqual(['/items/1/id']);
    const nonexistent = await bulk(s.editor, [s.t[0], { id: randomUUID(), version: 1 }], {
      categoryId: s.hogar,
    });
    expect(errorsOf(nonexistent).map((e) => [e.pointer, e.code])).toEqual(
      errorsOf(foreign).map((e) => [e.pointer, e.code]),
    );
    expect(splitOf(await txOf(s.owner, s.t[0].id)).categoryId).toBe(s.sup);
    expect(splitOf(await txOf(other.owner, other.t[0].id)).categoryId).toBe(other.sup);
    // Un EDITOR de W1 no opera sobre W2.
    expectProblem(
      await call('POST', `${W(other.owner)}/transactions/bulk-edit`, {
        token: s.editor.token,
        body: { items: items(other.t), changes: { categoryId: other.hogar } },
        headers: { 'idempotency-key': randomUUID() },
      }),
      403,
      'WORKSPACE_ACCESS_DENIED',
    );
  });
});

describe('Ráfaga de 500 recategorizaciones', () => {
  it('[TC-TRANSACTIONS-BULK-001] [TC-TRANSACTIONS-BULK-007] 500 ítems en una operación: un TransactionCategorized por transacción y los consumidores (umbrales de presupuesto y versión de datos del Home) son idempotentes ante la ráfaga', async () => {
    const owner = await user(`kc-bulk-burst-${randomUUID()}`);
    const acc = await post(owner, '/accounts', {
      name: 'Bank A',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: money('20000.00'), date: '2026-09-01' },
    });
    const bank = acc.body['id'] as string;
    const sup = await categoryNamed(owner, 'EXPENSE', 'Supermercado');
    const hogar = await categoryNamed(owner, 'EXPENSE', 'Hogar');
    expect((await post(owner, '/periods', { through: '2026-12-31' })).status).toBe(200);
    const periods = await get(owner, '/periods?limit=100');
    const november = (periods.body['data'] as { id: string; label: string }[]).find(
      (p) => p.label === '2026-11',
    )!;
    const budget = await post(owner, '/budgets', { periodId: november.id, source: { kind: 'EMPTY' } });
    expect(budget.status, JSON.stringify(budget.body)).toBe(201);
    const line = await post(owner, `/budgets/${String(budget.body['id'])}/lines`, {
      target: { kind: 'CATEGORY', id: hogar.id },
      kind: 'MAXIMUM',
      planned: money('2500.00'),
    });
    expect(line.status, JSON.stringify(line.body)).toBe(201);

    // 500 gastos de 10.00 BOB en "Supermercado" (por tandas en paralelo para acortar la preparación).
    const txs: Tx[] = [];
    for (let batch = 0; batch < 20; batch++) {
      const made = await Promise.all(
        Array.from({ length: 25 }, () => expense(owner, bank, '10.00', '2026-11-10', sup.id)),
      );
      txs.push(...made.map((m) => ({ id: m.id, version: m.version })));
    }
    expect(txs).toHaveLength(500);

    const started = performance.now();
    const r = await bulk(owner, txs, { categoryId: hogar.id });
    const elapsed = Math.round(performance.now() - started);
    expect(r.status, JSON.stringify(r.body).slice(0, 400)).toBe(200);
    // Objetivo p95 ≤ 2 s (design decisión 9): aquí se mide una corrida con margen para CI compartido.
    console.info(`[bulk-edit] 500 ítems recategorizados en ${elapsed} ms`);
    expect(elapsed).toBeLessThan(10_000);
    const bulkId = r.body['bulkOperationId'] as string;
    expect((r.body['data'] as Json[]).every((d) => splitOf(d).categoryId === hogar.id)).toBe(true);

    const workerDb = await connect(deps.workerDatabaseUrl);
    let categorized: EventEnvelope[];
    try {
      const { rows } = await workerDb.query<{ envelope: EventEnvelope }>(
        `SELECT envelope FROM platform.outbox
          WHERE workspace_id = $1 AND event_type = 'transactions.TransactionCategorized' AND correlation_id = $2
          ORDER BY sequence`,
        [owner.ws, bulkId],
      );
      categorized = rows.map((x) => x.envelope);
    } finally {
      await workerDb.end();
    }
    expect(categorized).toHaveLength(500);
    expect(new Set(categorized.map((e) => e.aggregateId)).size).toBe(500);
    expect(eventSchemaRegistry().validate(categorized[0]!)).toBeUndefined();

    // Consumidores como los del worker (pf_worker): umbrales de presupuesto y versión de datos del Home.
    const pool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 6 });
    try {
      const audit = createAuditRuntime({
        pool,
        clock,
        policies: AUDIT_POLICIES,
        timeZones: identityWorkspaceTimeZones(pool),
      });
      const planning = createPlanningRuntime({
        pool,
        clock,
        audit: audit.port,
        lifecycle: audit.lifecycle,
        outbox: outboxPort(new PgOutboxWriter(eventSchemaRegistry())),
        calendar: identityWorkspaceCalendarDirectory(pool),
        activity: ledgerActivityRange(),
        budgets: {
          flows: createNominalFlowQuery(pool),
          catalog: createCategoryCatalogQuery({ pool, clock }),
          rates: createFxValuation({ pool, clock, windowDays: 7 }),
          rateValidityWindowDays: 7,
        },
      });
      const defs = [...planningEventConsumers(planning), reportingDataVersionConsumer()];
      const byName = new Map(defs.map((d) => [d.consumer, d]));
      const consumers = new EventConsumerRuntime({
        pool,
        queue: {} as JobQueue,
        subscriptions: new EventSubscriptions(defs),
        logger: capturingLogger('finance-worker', 'worker').logger,
      });
      const version = async () => {
        const client = await connect(deps.workerDatabaseUrl);
        try {
          return await inTx(client, { workspaceId: owner.ws }, async () => {
            const { rows } = await client.query<{ version: string }>(
              `SELECT version::text FROM reporting.workspace_data_version WHERE workspace_id = $1`,
              [owner.ws],
            );
            return Number(rows[0]?.version ?? 0);
          });
        } finally {
          await client.end();
        }
      };
      const thresholdFacts = async () => {
        const { rows } = await pool.query<{ envelope: EventEnvelope }>(
          `SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = 'planning.BudgetThresholdReached'`,
          [owner.ws],
        );
        return rows.map((x) => x.envelope.payload as { threshold: string; alsoCrossed: string[] });
      };
      const versionBefore = await version();
      const deliverAll = async (consumer: string) => {
        const outcomes: string[] = [];
        for (const envelope of categorized) {
          outcomes.push(await consumers.deliver(byName.get(consumer)!, envelope));
        }
        return outcomes;
      };

      const t0 = performance.now();
      const firstThresholds = await deliverAll('planning.budget-thresholds');
      const firstReporting = await deliverAll('reporting.data-version');
      console.info(
        `[bulk-edit] consumidores procesaron la ráfaga de 500 en ${Math.round(performance.now() - t0)} ms`,
      );
      expect(new Set(firstThresholds)).toEqual(new Set(['applied']));
      expect(new Set(firstReporting)).toEqual(new Set(['applied']));
      expect(await version()).toBe(versionBefore + 500);
      // 5000.00 BOB sobre un máximo de 2500.00: se cruzan 50/75/90/100 una sola vez (emisión única por umbral).
      const facts = await thresholdFacts();
      expect(facts).toHaveLength(1);
      expect([facts[0]!.threshold, ...facts[0]!.alsoCrossed].sort()).toEqual(['100', '50', '75', '90']);

      // Reentrega de toda la ráfaga: duplicados (inbox) sin efecto.
      expect(new Set(await deliverAll('planning.budget-thresholds'))).toEqual(new Set(['duplicate']));
      expect(new Set(await deliverAll('reporting.data-version'))).toEqual(new Set(['duplicate']));
      expect(await version()).toBe(versionBefore + 500);
      expect(await thresholdFacts()).toHaveLength(1);
    } finally {
      await pool.end();
    }
  }, 600_000);
});
