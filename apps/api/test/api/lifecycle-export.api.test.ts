import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createLifecycleBackfill, findLifecycleDivergences } from '@pf/audit/interface/audit.module';
import { ApiContract } from '@pf/platform/api';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool, type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';
import { pdfPageCount, pdfVisibleText } from '../support/pdf-text.js';

// Recorrido de categorías y contrapartes y exportación CSV/PDF del recorrido por HTTP contra PostgreSQL real (docs/31
// D52; openspec add-lifecycle-timeline § Ampliación D52, tareas 9.2–9.5): máquinas, transiciones en la misma UoW,
// cascada atómica, provisión con CREATE de origen sistema, reconstrucción, contrato, roles (VIEWER, D28), aislamiento
// y la descarga (tipo de contenido, adjunto, CSV RFC 4180 seguro, PDF legible, auditoría de la exportación).
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';

interface Reply {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}
interface Download {
  status: number;
  headers: Headers;
  bytes: Uint8Array;
  text: string;
}
type Json = Record<string, unknown>;

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
/** Fallo inyectado en la escritura de la N-ésima transición desde que se arma (TC-AUDIT-LIFECYCLE-016). */
let failOnRecord: number | null = null;
/** Simula datos anteriores a D52: se audita pero no se escribe el recorrido (TC-AUDIT-LIFECYCLE-019). */
let skipSteps = false;
const clock = new FixedClock(Instant.parse('2026-03-10T14:00:00Z')); // 10:00 en La Paz
let cachedContract: ApiContract | undefined;
const contract = () => (cachedContract ??= ApiContract.fromFile(resolveContractPath()));

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

async function download(u: User, path: string, headers: Record<string, string> = {}): Promise<Download> {
  const res = await fetch(`${baseUrl}${W(u)}${path}`, {
    headers: { authorization: `Bearer ${u.token}`, ...headers },
  });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, bytes, text: new TextDecoder().decode(bytes) };
}

const expectProblem = (r: Reply, status: number, code: string) => {
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  expect(r.headers.get('content-type')).toContain('application/problem+json');
  expect(r.body['code']).toBe(code);
};

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId };
}
type User = Awaited<ReturnType<typeof user>>;

const W = (u: User) => `/api/v1/workspaces/${u.ws}`;
const post = (u: User, path: string, body: unknown, version?: number) =>
  call('POST', `${W(u)}${path}`, {
    token: u.token,
    ...(body === undefined ? {} : { body }),
    headers: {
      'idempotency-key': randomUUID(),
      ...(version !== undefined ? { 'if-match': `"${version}"` } : {}),
    },
  });
const patch = (u: User, path: string, version: number, body: unknown) =>
  call('PATCH', `${W(u)}${path}`, {
    token: u.token,
    body,
    contentType: 'application/merge-patch+json',
    headers: { 'if-match': `"${version}"` },
  });
const get = (u: User, path: string) => call('GET', `${W(u)}${path}`, { token: u.token });

/** Consulta como `pf_app` con el contexto RLS del workspace (rollback). */
async function asApp<T>(u: User, fn: (c: Client) => Promise<T>): Promise<T> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, () => fn(app));
  } finally {
    await app.end();
  }
}

const transitions = (body: Json) =>
  (body['items'] as Json[])
    .filter((i) => i['kind'] === 'TRANSITION')
    .map((i) => [i['transition'], i['fromState'], i['toState']]);
const steps = (body: Json) =>
  (body['items'] as Json[]).map((i) =>
    i['kind'] === 'TRANSITION'
      ? [i['transition'], i['fromState'], i['toState']]
      : ['ANNOTATION', (i['changedFields'] as string[]).join(',')],
  );

async function account(u: User, name: string, opening: string | null) {
  const r = await post(u, '/accounts', {
    name,
    type: 'BANK',
    currency: 'BOB',
    ...(opening
      ? { openingBalance: { amount: { amount: opening, currency: 'BOB' }, date: '2026-03-01' } }
      : {}),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body['id'] as string;
}

async function expense(u: User, accountId: string, amount: string, status = 'POSTED') {
  const r = await post(u, '/transactions', {
    kind: 'EXPENSE',
    status,
    transactionDate: '2026-03-10',
    accountId,
    amount: { amount, currency: 'BOB' },
    description: 'Hipermaxi',
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number };
}

async function expenseGroup(u: User, name: string) {
  const r = await post(u, '/category-groups', { name, kind: 'EXPENSE' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body['id'] as string;
}

async function category(u: User, groupId: string, name: string, parentId?: string) {
  const r = await post(u, '/categories', { groupId, name, ...(parentId ? { parentId } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body['id'] as string;
}

/** Parser RFC 4180 mínimo. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += ch;
  }
  return rows;
}

/** Filas del CSV como objetos por encabezado (sin BOM). */
const csvRecords = (text: string) => {
  const [header, ...rows] = parseCsv(text.replace(/^\uFEFF/u, ''));
  return rows.map((r) => Object.fromEntries(header!.map((h, i) => [h, r[i] ?? ''])));
};

async function exportAudits(u: User, aggregateId: string) {
  return asApp(
    u,
    async (c) =>
      (
        await c.query<{ action: string; aggregate_type: string; changes: unknown }>(
          `SELECT action, aggregate_type, changes FROM audit.audit_log
            WHERE aggregate_id = $1 AND action = 'audit.lifecycle.exported' ORDER BY occurred_at, id`,
          [aggregateId],
        )
      ).rows,
  );
}

const apiLog = capturingLogger('finance-api', 'api');
let editor: User;
let viewer: User;
let outsider: User;
let bankA: string;
let recordCalls = 0;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(apiConfig(baseEnv(deps)), apiLog.logger, {
    clock,
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
      lifecycle: (port) => ({
        record: async (entry, s) => {
          if (skipSteps) return port.record(entry, []);
          recordCalls += 1;
          if (failOnRecord !== null && recordCalls === failOnRecord) {
            throw new Error('lifecycle store unavailable (fault injected)');
          }
          return port.record(entry, s);
        },
      }),
    },
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
  editor = await user(`kc-lcx-editor-${randomUUID()}`);
  outsider = await user(`kc-lcx-outsider-${randomUUID()}`);
  const v = await user(`kc-lcx-viewer-${randomUUID()}`);
  const app = await connect(deps.databaseUrl);
  try {
    await inTx(
      app,
      { userId: editor.id, workspaceId: editor.ws },
      () =>
        app.query(
          `INSERT INTO iam.workspace_membership (workspace_id, user_id, role, status) VALUES ($1, $2, 'VIEWER', 'ACTIVE')`,
          [editor.ws, v.id],
        ),
      true,
    );
  } finally {
    await app.end();
  }
  viewer = { ...v, ws: editor.ws };
  bankA = await account(editor, 'Bank A', '1000.00');
});

afterAll(async () => {
  await runtime?.close();
});

describe('Máquinas Category y Counterparty (GET W/lifecycle-machines/{aggregateType})', () => {
  it('[TC-AUDIT-LIFECYCLE-014] ACTIVE/ARCHIVED sin terminales, CREATE/ARCHIVE/UNARCHIVE con guarda, sin MERGE; contrato válido', async () => {
    for (const type of ['Category', 'Counterparty']) {
      const r = await get(viewer, `/lifecycle-machines/${type}`);
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(contract().validateResponse('getLifecycleMachine', 200, r.body)).toEqual([]);
      expect(r.body).toMatchObject({
        aggregateType: type,
        machineVersion: 1,
        states: [
          { code: 'ACTIVE', terminal: false },
          { code: 'ARCHIVED', terminal: false },
        ],
      });
      const ts = r.body['transitions'] as Json[];
      expect(ts.map((t) => [t['code'], t['from'], t['to']])).toEqual([
        ['CREATE', [], ['ACTIVE']],
        ['ARCHIVE', ['ACTIVE'], ['ARCHIVED']],
        ['UNARCHIVE', ['ARCHIVED'], ['ACTIVE']],
      ]);
      expect(ts.every((t) => typeof t['guard'] === 'string' && (t['guard'] as string).length > 0)).toBe(true);
      expect((ts.find((t) => t['code'] === 'ARCHIVE') as Json)['events']).toEqual(
        type === 'Category' ? ['classification.CategoryArchived.v1'] : [],
      );
    }
    expect((await get(viewer, '/lifecycle-machines/Tag')).status).toBe(400);
  });
});

describe('Recorrido de categorías y contrapartes (docs/31 D52)', () => {
  it('[TC-AUDIT-LIFECYCLE-015] "Super" → renombrar → archivar → desarchivar: CREATE, anotación [name], ARCHIVE con su evento y UNARCHIVE', async () => {
    const g = await expenseGroup(editor, `Alimentación ${randomUUID().slice(0, 4)}`);
    const id = await category(editor, g, 'Super');
    expect((await patch(editor, `/categories/${id}`, 1, { name: 'Supermercado' })).status).toBe(200);
    expect((await post(editor, `/categories/${id}/archive`, undefined, 2)).status).toBe(200);
    expect((await post(editor, `/categories/${id}/unarchive`, undefined, 3)).status).toBe(200);
    const lc = await get(viewer, `/categories/${id}/lifecycle`);
    expect(lc.status, JSON.stringify(lc.body)).toBe(200);
    expect(contract().validateResponse('getCategoryLifecycle', 200, lc.body)).toEqual([]);
    expect(steps(lc.body)).toEqual([
      ['CREATE', null, 'ACTIVE'],
      ['ANNOTATION', 'name'],
      ['ARCHIVE', 'ACTIVE', 'ARCHIVED'],
      ['UNARCHIVE', 'ARCHIVED', 'ACTIVE'],
    ]);
    expect(lc.body).toMatchObject({
      aggregateType: 'Category',
      currentState: 'ACTIVE',
      path: ['ACTIVE', 'ARCHIVED', 'ACTIVE'],
      historyComplete: true,
    });
    for (const i of lc.body['items'] as Json[]) {
      expect(i).toMatchObject({ actor: { type: 'USER', id: editor.id }, origin: 'api' });
      expect(i['auditLogId']).toEqual(expect.any(String));
    }
    const archive = (lc.body['items'] as Json[]).find((i) => i['transition'] === 'ARCHIVE');
    expect(archive?.['events']).toEqual(['classification.CategoryArchived.v1']);
  });

  it('[TC-AUDIT-LIFECYCLE-016] archivar "Servicios básicos" registra ARCHIVE en ella, "Luz" y "Agua" con la misma correlación; con fallo nada se archiva', async () => {
    const g = await expenseGroup(editor, `Vivienda ${randomUUID().slice(0, 4)}`);
    const sb = await category(editor, g, 'Servicios básicos');
    const luz = await category(editor, g, 'Luz', sb);
    const agua = await category(editor, g, 'Agua', sb);

    recordCalls = 0;
    failOnRecord = 3; // la 2.ª subcategoría
    const failed = await post(editor, `/categories/${sb}/archive`, undefined, 1);
    failOnRecord = null;
    expect(failed.status).toBe(500);
    for (const id of [sb, luz, agua]) {
      const c = await get(editor, `/categories/${id}`);
      expect(c.body['archivedAt'] ?? null, id).toBeNull();
      expect(transitions((await get(editor, `/categories/${id}/lifecycle`)).body)).toEqual([
        ['CREATE', null, 'ACTIVE'],
      ]);
    }

    expect((await post(editor, `/categories/${sb}/archive`, undefined, 1)).status).toBe(200);
    for (const id of [sb, luz, agua]) {
      const lc = await get(viewer, `/categories/${id}/lifecycle`);
      expect(transitions(lc.body).at(-1)).toEqual(['ARCHIVE', 'ACTIVE', 'ARCHIVED']);
      expect(lc.body['currentState']).toBe('ARCHIVED');
    }
    const shared = await asApp(
      editor,
      async (c) =>
        (
          await c.query<{ n: string }>(
            `SELECT count(DISTINCT (actor_id, occurred_at, correlation_id))::text AS n
               FROM audit.lifecycle_transition WHERE aggregate_id = ANY($1::uuid[]) AND transition = 'ARCHIVE'`,
            [[sb, luz, agua]],
          )
        ).rows[0]!.n,
    );
    expect(shared).toBe('1');
  });

  it('[TC-AUDIT-LIFECYCLE-017] la categoría de sistema "Comisiones" nace con CREATE (origen sistema); archivarla ⇒ SYSTEM_CATEGORY_IMMUTABLE sin pasos nuevos', async () => {
    const list = await get(editor, '/categories?includeArchived=true&limit=200');
    const fees = (list.body['data'] as Json[]).find((c) => c['systemCode'] === 'FEES')!;
    const rejected = await post(editor, `/categories/${fees['id'] as string}/archive`, undefined, 1);
    expectProblem(rejected, 409, 'SYSTEM_CATEGORY_IMMUTABLE');
    const lc = await get(viewer, `/categories/${fees['id'] as string}/lifecycle`);
    expect(lc.status, JSON.stringify(lc.body)).toBe(200);
    expect(steps(lc.body)).toEqual([['CREATE', null, 'ACTIVE']]);
    expect((lc.body['items'] as Json[])[0]).toMatchObject({ origin: 'system', derived: false });
    expect(lc.body).toMatchObject({ currentState: 'ACTIVE', historyComplete: true });
    const catalog = await asApp(
      editor,
      async (c) =>
        (
          await c.query<{ action: string; origin: string }>(
            `SELECT a.action, a.origin FROM audit.audit_log a
               JOIN audit.lifecycle_transition t ON t.audit_log_id = a.id WHERE t.aggregate_id = $1`,
            [fees['id']],
          )
        ).rows,
    );
    expect(catalog).toEqual([{ action: 'classification.catalog.applied', origin: 'system' }]);
  });

  it('[TC-AUDIT-LIFECYCLE-018] "Entel" creada en línea: CREATE, anotación [aliases], ARCHIVE, UNARCHIVE; el gasto no cambia; otro workspace ⇒ 404', async () => {
    const bank = await account(editor, `Bank E ${randomUUID().slice(0, 6)}`, '1000.00');
    const cp = await post(editor, '/counterparties', { name: `Entel ${randomUUID().slice(0, 4)}` });
    expect(cp.status, JSON.stringify(cp.body)).toBe(201);
    const id = cp.body['id'] as string;
    const r = await post(editor, '/transactions', {
      kind: 'EXPENSE',
      status: 'POSTED',
      transactionDate: '2026-03-10',
      accountId: bank,
      counterpartyId: id,
      amount: { amount: '120.00', currency: 'BOB' },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await patch(editor, `/counterparties/${id}`, 1, { aliases: ['ENTEL S.A.'] })).status).toBe(200);
    expect((await post(editor, `/counterparties/${id}/archive`, undefined, 2)).status).toBe(200);
    expect((await post(editor, `/counterparties/${id}/unarchive`, undefined, 3)).status).toBe(200);
    const lc = await get(viewer, `/counterparties/${id}/lifecycle`);
    expect(lc.status, JSON.stringify(lc.body)).toBe(200);
    expect(contract().validateResponse('getCounterpartyLifecycle', 200, lc.body)).toEqual([]);
    expect(steps(lc.body)).toEqual([
      ['CREATE', null, 'ACTIVE'],
      ['ANNOTATION', 'aliases'],
      ['ARCHIVE', 'ACTIVE', 'ARCHIVED'],
      ['UNARCHIVE', 'ARCHIVED', 'ACTIVE'],
    ]);
    expect(lc.body).toMatchObject({ currentState: 'ACTIVE', path: ['ACTIVE', 'ARCHIVED', 'ACTIVE'] });
    const txn = await get(editor, `/transactions/${r.body['id'] as string}`);
    expect(txn.body).toMatchObject({ revision: 1, version: r.body['version'] });
    const own = await get(outsider, `/counterparties/${id}/lifecycle`);
    expectProblem(own, 404, 'RESOURCE_NOT_FOUND');
    const missing = await get(outsider, `/counterparties/${randomUUID()}/lifecycle`);
    expect({ ...own.body, detail: null, instance: null, traceId: null, requestId: null }).toEqual({
      ...missing.body,
      detail: null,
      instance: null,
      traceId: null,
      requestId: null,
    });
  });

  it('[TC-AUDIT-LIFECYCLE-019] una contraparte creada y archivada antes del registro se reconstruye con CREATE y ARCHIVE derivadas; idempotente y consistente', async () => {
    skipSteps = true;
    let id: string;
    try {
      const cp = await post(editor, '/counterparties', { name: `Viejo ${randomUUID().slice(0, 4)}` });
      expect(cp.status, JSON.stringify(cp.body)).toBe(201);
      id = cp.body['id'] as string;
      expect((await post(editor, `/counterparties/${id}/archive`, undefined, 1)).status).toBe(200);
    } finally {
      skipSteps = false;
    }
    expect(transitions((await get(editor, `/counterparties/${id}/lifecycle`)).body)).toEqual([]);
    const workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
    try {
      const job = createLifecycleBackfill(workerPool);
      expect((await job.run(editor.ws)).derived).toBeGreaterThanOrEqual(2);
      expect(await job.run(editor.ws)).toEqual({ aggregates: 0, derived: 0 });
      const lc = await get(viewer, `/counterparties/${id}/lifecycle`);
      expect(transitions(lc.body)).toEqual([
        ['CREATE', null, 'ACTIVE'],
        ['ARCHIVE', 'ACTIVE', 'ARCHIVED'],
      ]);
      expect((lc.body['items'] as Json[]).every((i) => i['derived'] === true)).toBe(true);
      expect(lc.body).toMatchObject({ historyComplete: true, currentState: 'ARCHIVED' });
      // Consistencia (decisión 4 de la ampliación): categorías y contrapartes coinciden con su última transición.
      expect(await findLifecycleDivergences(workerPool, editor.ws)).toEqual([]);
    } finally {
      await workerPool.end();
    }
  });
});

describe('Exportación del recorrido (GET …/lifecycle/export?format=csv|pdf)', () => {
  let tx: { id: string; version: number };

  it('[TC-AUDIT-LIFECYCLE-021] gasto 80.00 → postear → cleared → 85.00 → anular: CSV con BOM, adjunto, 5 filas, hora -04:00 y montos exactos; auditado', async () => {
    const bank = await account(editor, `Bank X ${randomUUID().slice(0, 6)}`, '1000.00');
    const step = () => clock.advance(60 * 60 * 1000);
    clock.set(Instant.parse('2026-03-10T14:00:00Z'));
    tx = await expense(editor, bank, '80.00', 'PENDING');
    const start = (await get(editor, `/transactions/${tx.id}/lifecycle`)).body['items'] as Json[];
    step();
    let r = await post(editor, `/transactions/${tx.id}/post`, undefined, tx.version);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    step();
    r = await post(editor, '/transactions/mark-cleared', {
      items: [{ id: tx.id, version: r.body['version'] }],
      cleared: true,
    });
    const clearedVersion = ((r.body['data'] as Json[])[0] as Json)['version'] as number;
    step();
    r = await patch(editor, `/transactions/${tx.id}`, clearedVersion, {
      amount: { amount: '85.00', currency: 'BOB' },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    step();
    r = await post(
      editor,
      `/transactions/${tx.id}/void`,
      { reason: 'duplicado' },
      r.body['version'] as number,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const before = await get(editor, `/transactions/${tx.id}/lifecycle`);

    const d = await download(editor, `/transactions/${tx.id}/lifecycle/export?format=csv`);
    expect(d.status, d.text).toBe(200);
    expect(d.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(d.headers.get('content-disposition')).toBe(
      `attachment; filename="recorrido-Transaction-${tx.id}.csv"`,
    );
    expect(d.headers.get('cache-control')).toContain('no-store');
    expect([...d.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(d.text.includes('\r\n')).toBe(true);
    const rows = csvRecords(d.text);
    expect(rows.map((x) => x['transition'])).toEqual(['RECORD', 'POST', 'CLEAR', 'REVISE', 'VOID']);
    const t0 = start[0]?.['occurredAt'] as string;
    const hourOf = (iso: string) => new Date(iso).getTime();
    rows.forEach((x, i) => {
      expect(x['occurredAt']).toMatch(/^2026-03-10T\d{2}:00:00-04:00$/u);
      expect(hourOf(x['occurredAt']!)).toBe(hourOf(t0) + i * 3_600_000);
    });
    expect(rows[3]).toMatchObject({ revisionFrom: '1', revisionTo: '2', amount: '85.00', currency: 'BOB' });
    expect(rows[0]).toMatchObject({ amount: '80.00', currency: 'BOB' });
    expect(rows[4]).toMatchObject({ reason: 'duplicado', kind: 'TRANSITION', derived: 'false' });
    // Exportar no cambia el recorrido; la exportación queda auditada (sin contenido del archivo).
    expect((await get(editor, `/transactions/${tx.id}/lifecycle`)).body).toEqual(before.body);
    const audits = await exportAudits(editor, tx.id);
    expect(audits.map((a) => [a.action, a.aggregate_type])).toEqual([
      ['audit.lifecycle.exported', 'LifecycleExport'],
    ]);
    expect(JSON.stringify(audits[0]?.changes)).toContain('csv');
    expect(JSON.stringify(audits[0]?.changes)).not.toContain('85.00');
  });

  it('[TC-AUDIT-LIFECYCLE-022] un motivo "=SUM(A1:A9)" sale como \'=SUM(A1:A9)', async () => {
    const e = await expense(editor, bankA, '40.00');
    const v = await post(editor, `/transactions/${e.id}/void`, { reason: '=SUM(A1:A9)' }, e.version);
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    const d = await download(editor, `/transactions/${e.id}/lifecycle/export?format=csv`);
    expect(d.status).toBe(200);
    const voided = csvRecords(d.text).find((x) => x['transition'] === 'VOID');
    expect(voided?.['reason']).toBe("'=SUM(A1:A9)");
  });

  it('[TC-AUDIT-LIFECYCLE-023] PDF de "Bank C": application/pdf adjunto, %PDF, ≥ 1 página, estado actual CLOSED, camino y línea de tiempo', async () => {
    const name = `Bank C ${randomUUID().slice(0, 6)}`;
    const c = await account(editor, name, '500.00');
    let r = await post(editor, `/accounts/${c}/archive`, { reason: 'sin uso' }, 1);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    r = await post(editor, `/accounts/${c}/reactivate`, undefined, 2);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const t = await post(editor, '/transfers', {
      transactionDate: '2026-03-10',
      fromAccountId: c,
      toAccountId: bankA,
      amount: { amount: '500.00', currency: 'BOB' },
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    r = await post(editor, `/accounts/${c}/close`, { closedOn: '2026-03-31' }, 3);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = await download(viewer, `/accounts/${c}/lifecycle/export?format=pdf`, {
      'accept-language': 'es-BO',
    });
    expect(d.status, d.text.slice(0, 300)).toBe(200);
    expect(d.headers.get('content-type')).toBe('application/pdf');
    expect(d.headers.get('content-disposition')).toBe(`attachment; filename="recorrido-Account-${c}.pdf"`);
    expect(Buffer.from(d.bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(pdfPageCount(d.bytes)).toBeGreaterThan(0);
    const text = pdfVisibleText(d.bytes);
    for (const expected of [
      name,
      'Cerrada (CLOSED)',
      'Activa (ACTIVE) -> Archivada (ARCHIVED) -> Activa (ACTIVE) -> Cerrada (CLOSED)',
      'Abrir',
      'Archivar',
      'sin uso',
      'Reactivar',
      'Cerrar',
      'America/La_Paz',
    ]) {
      expect(text, expected).toContain(expected);
    }
    expect(text).toMatch(/\d{2}\/\d{2}\/2026 \d{2}:\d{2}/u);
    expect((await exportAudits(editor, c)).length).toBe(1);
  });

  it('[TC-AUDIT-LIFECYCLE-024] un VIEWER exporta CSV y PDF; otro workspace recibe 404 idéntico a inexistente; formato inválido ⇒ 400', async () => {
    const csv = await download(viewer, `/transactions/${tx.id}/lifecycle/export?format=csv`);
    expect(csv.status).toBe(200);
    expect(csvRecords(csv.text)).toHaveLength(5);
    for (const format of ['csv', 'pdf']) {
      const own = await call(
        'GET',
        `${W(outsider)}/transactions/${tx.id}/lifecycle/export?format=${format}`,
        {
          token: outsider.token,
        },
      );
      expectProblem(own, 404, 'RESOURCE_NOT_FOUND');
      const missing = await call(
        'GET',
        `${W(outsider)}/transactions/${randomUUID()}/lifecycle/export?format=${format}`,
        { token: outsider.token },
      );
      expect({ ...own.body, detail: null, instance: null, traceId: null, requestId: null }).toEqual({
        ...missing.body,
        detail: null,
        instance: null,
        traceId: null,
        requestId: null,
      });
      expect(JSON.stringify(own.body)).not.toContain('Hipermaxi');
      // Por el workspace ajeno (sin membresía) responde el guard de identidad, igual para existente o no.
      const foreign = await call(
        'GET',
        `${W(editor)}/transactions/${tx.id}/lifecycle/export?format=${format}`,
        {
          token: outsider.token,
        },
      );
      expect([403, 404]).toContain(foreign.status);
    }
    expectProblem(await get(viewer, `/transactions/${tx.id}/lifecycle/export`), 400, 'VALIDATION_FAILED');
    expectProblem(
      await get(viewer, `/transactions/${tx.id}/lifecycle/export?format=xlsx`),
      400,
      'VALIDATION_FAILED',
    );
    expect((await exportAudits(editor, tx.id)).length).toBe(2); // editor (021) + viewer CSV
  });

  it('[TC-AUDIT-LIFECYCLE-020] categoría y contraparte también se exportan (CSV y PDF) con el mismo contrato', async () => {
    const g = await expenseGroup(editor, `Ocio ${randomUUID().slice(0, 4)}`);
    const id = await category(editor, g, 'Cine');
    expect((await post(editor, `/categories/${id}/archive`, undefined, 1)).status).toBe(200);
    const csv = await download(viewer, `/categories/${id}/lifecycle/export?format=csv`);
    expect(csv.status).toBe(200);
    expect(csvRecords(csv.text).map((x) => [x['transition'], x['fromState'], x['toState']])).toEqual([
      ['CREATE', '', 'ACTIVE'],
      ['ARCHIVE', 'ACTIVE', 'ARCHIVED'],
    ]);
    const pdf = await download(viewer, `/categories/${id}/lifecycle/export?format=pdf`);
    expect(pdf.status).toBe(200);
    expect(pdfVisibleText(pdf.bytes)).toContain('Categoría "Cine"');
    const cp = await post(editor, '/counterparties', { name: `Cinecenter ${randomUUID().slice(0, 4)}` });
    const cpId = cp.body['id'] as string;
    const cpPdf = await download(viewer, `/counterparties/${cpId}/lifecycle/export?format=pdf`, {
      'accept-language': 'en',
    });
    expect(cpPdf.status).toBe(200);
    expect(pdfVisibleText(cpPdf.bytes)).toContain('Lifecycle: Counterparty');
    const rate = await post(editor, '/fx-rates', {
      base: 'USDT',
      quote: 'BOB',
      value: '6.95',
      rateType: 'P2P',
      asOf: '2026-03-10T13:00:00Z',
    });
    expect(rate.status, JSON.stringify(rate.body)).toBe(201);
    const rd = await download(viewer, `/fx-rates/${rate.body['id'] as string}/lifecycle/export?format=csv`);
    expect(rd.status).toBe(200);
    expect(csvRecords(rd.text)[0]).toMatchObject({ transition: 'RECORD', toState: 'RECORDED' });
    const acc = await download(viewer, `/accounts/${bankA}/lifecycle/export?format=csv`);
    expect(csvRecords(acc.text)[0]).toMatchObject({ transition: 'OPEN', toState: 'ACTIVE' });
  });
});
