import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import {
  identityWorkspaceCalendarDirectory,
  identityWorkspaceTimeZones,
} from '@pf/identity/interface/identity.module';
import { ledgerActivityRange } from '@pf/ledger/interface/ledger.module';
import { createPlanningRuntime } from '@pf/planning/interface/planning.module';
import { ApiContract } from '@pf/platform/api';
import { PgOutboxWriter } from '@pf/platform/events';
import { Pool } from 'pg';
import type { EventEnvelope } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import {
  AUDIT_POLICIES,
  financeRuntimes,
  LIFECYCLE_MACHINES,
  outboxPort,
} from '../../src/identity/identity-wiring.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Cierre de mes por HTTP contra PostgreSQL real (openspec add-month-closing, tareas 3.x–5.x y 7.x): checklist, política,
// cierre atómico y en orden, bloqueo del ledger por rango (la barrera de seguridad: ningún posteo, reversa, edición ni
// conciliación con fecha del periodo cerrado pasa), carrera cierre/posteo, snapshot inmutable (PF003/42501),
// reapertura por el OWNER, re-cierre n+1, comparación, reporte con variaciones y exportación, eventos y recorrido.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
// 2026-11-03 11:00 en La Paz: octubre ya terminó; noviembre no.
const clock = new FixedClock(Instant.parse('2026-11-03T15:00:00Z'));
const contract = ApiContract.fromFile(resolveContractPath());

type Json = Record<string, unknown>;
interface Reply {
  status: number;
  headers: Headers;
  body: Json;
  raw: ArrayBuffer;
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
  const raw = await res.arrayBuffer();
  const text = new TextDecoder().decode(raw);
  let body: Json = {};
  if ((res.headers.get('content-type') ?? '').includes('json') && text) body = JSON.parse(text) as Json;
  return { status: res.status, headers: res.headers, body, raw };
}

const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, `${JSON.stringify(r.body)} ${JSON.stringify(apiLog.records().slice(-3))}`).toBe(status);
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
const post = (u: User, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  call('POST', `${W(u)}${path}`, {
    token: u.token,
    ...(body === undefined ? {} : { body }),
    headers: { 'idempotency-key': randomUUID(), ...headers },
  });
const get = (u: User, path: string) => call('GET', `${W(u)}${path}`, { token: u.token });
const put = (u: User, path: string, body: unknown, version: number) =>
  call('PUT', `${W(u)}${path}`, { token: u.token, body, headers: { 'if-match': `"${version}"` } });
const patch = (u: User, path: string, body: unknown, version: number) =>
  call('PATCH', `${W(u)}${path}`, {
    token: u.token,
    body,
    headers: { 'content-type': 'application/merge-patch+json', 'if-match': `"${version}"` },
  });
const money = (amount: string, currency = 'BOB') => ({ amount, currency });

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

async function outbox(u: User) {
  const worker = await connect(deps.workerDatabaseUrl);
  try {
    const { rows } = await worker.query<{ event_type: string; envelope: EventEnvelope }>(
      `SELECT event_type, envelope FROM platform.outbox WHERE workspace_id = $1 ORDER BY sequence`,
      [u.ws],
    );
    return rows;
  } finally {
    await worker.end();
  }
}

interface Scenario {
  owner: User;
  editor: User;
  viewer: User;
  bank: string;
  periods: Record<string, { id: string; version: number }>;
}

/** Workspace propio: "Bank A" con saldo inicial 5000.00 BOB (por defecto el 2026-10-01: octubre es el primer periodo) y periodos hasta 2026-12. */
async function scenario(label: string, opening = '2026-10-01'): Promise<Scenario> {
  const owner = await user(`kc-mc-${label}-${randomUUID()}`);
  const editor = await addMember(owner, await user(`kc-mc-ed-${randomUUID()}`), 'EDITOR');
  const viewer = await addMember(owner, await user(`kc-mc-vw-${randomUUID()}`), 'VIEWER');
  const acc = await post(owner, '/accounts', {
    name: 'Bank A',
    type: 'BANK',
    currency: 'BOB',
    openingBalance: { amount: money('5000.00'), date: opening },
  });
  expect(acc.status, JSON.stringify(acc.body)).toBe(201);
  const ensured = await post(owner, '/periods', { through: '2026-12-31' });
  expect(ensured.status, JSON.stringify(ensured.body)).toBe(200);
  const s: Scenario = { owner, editor, viewer, bank: acc.body['id'] as string, periods: {} };
  await refresh(s);
  return s;
}

async function refresh(s: Scenario): Promise<void> {
  const list = await get(s.owner, '/periods?limit=100');
  for (const p of list.body['data'] as { id: string; label: string; version: number }[]) {
    s.periods[p.label] = { id: p.id, version: p.version };
  }
}

async function expense(
  u: User,
  accountId: string,
  amount: string,
  date: string,
  extra: Json = {},
  currency = 'BOB',
): Promise<Reply> {
  return post(u, '/transactions', {
    kind: 'EXPENSE',
    transactionDate: date,
    accountId,
    amount: money(amount, currency),
    ...extra,
  });
}

const SEP = '2026-09-15';
const closeReq = (s: Scenario, u: User, label: string, body: Json = {}) =>
  post(u, `/periods/${s.periods[label]!.id}/close`, body, { 'if-match': `"${s.periods[label]!.version}"` });
const reopenReq = (s: Scenario, u: User, label: string, reason: string) =>
  post(
    u,
    `/periods/${s.periods[label]!.id}/reopen`,
    { reason },
    { 'if-match': `"${s.periods[label]!.version}"` },
  );
const checklist = async (s: Scenario, u: User, label: string) => {
  const r = await get(u, `/periods/${s.periods[label]!.id}/close-checklist`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(contract.validateResponse('getCloseChecklist', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  return r.body as Json & { items: Json[]; canClose: boolean; requiresAcknowledgement: boolean };
};
const item = (c: { items: Json[] }, kind: string) => c.items.find((i) => i['kind'] === kind)!;

/** El OWNER relaja las cuentas sin conciliar a advertencia (para cerrar sin sesiones de reconciliación). */
async function relaxReconciliation(s: Scenario): Promise<void> {
  const policy = await get(s.owner, '/planning/closing-policy');
  const severities = { ...(policy.body['severities'] as Json), UNRECONCILED_ACCOUNTS: 'WARNING' };
  const r = await put(s.owner, '/planning/closing-policy', { severities }, policy.body['version'] as number);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

/** Cierra reconociendo advertencias y actualiza la versión local. */
async function closeAck(s: Scenario, label: string, u = s.editor): Promise<Reply> {
  const r = await closeReq(s, u, label, { acknowledgeWarnings: true });
  await refresh(s);
  return r;
}

async function reconcile(
  s: Scenario,
  accountId: string,
  statementDate: string,
  statementBalance: string,
  clear: { id: string; version: number }[] = [],
): Promise<Json> {
  const started = await post(s.owner, '/reconciliations', {
    accountId,
    statementDate,
    statementBalance: money(statementBalance).amount,
  });
  expect(started.status, JSON.stringify(started.body)).toBe(201);
  const id = started.body['id'] as string;
  if (clear.length > 0) {
    const cleared = await post(s.owner, `/reconciliations/${id}/cleared`, { items: clear, cleared: true });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
  }
  const current = await get(s.owner, `/reconciliations/${id}`);
  const done = await post(
    s.owner,
    `/reconciliations/${id}/complete`,
    {},
    { 'if-match': `"${current.body['version']}"` },
  );
  expect(done.status, JSON.stringify(done.body)).toBe(200);
  return done.body;
}

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

describe('Checklist y política de cierre', () => {
  it('[TC-PLANNING-CHECKLIST-001] informa pendientes (sin contar noviembre), cuenta sin conciliar y porciones sin categoría; no cambia nada ni audita', async () => {
    const s = await scenario('chk');
    await expense(s.owner, s.bank, '120.00', '2026-10-28', { status: 'PENDING' });
    await expense(s.owner, s.bank, '45.00', '2026-10-30', { status: 'PENDING' });
    await expense(s.owner, s.bank, '60.00', '2026-11-01', { status: 'PENDING' });
    for (const [a, d] of [
      ['70.00', '2026-10-05'],
      ['70.00', '2026-10-06'],
      ['70.00', '2026-10-07'],
    ] as const) {
      expect((await expense(s.owner, s.bank, a, d)).status).toBe(201);
    }
    const auditBefore = await get(s.owner, '/audit-log?limit=100');
    const c = await checklist(s, s.viewer, '2026-10');
    expect(item(c, 'PENDING_TRANSACTIONS')).toMatchObject({
      count: 2,
      severity: 'BLOCKING',
      amounts: [money('165.00')],
    });
    expect(item(c, 'UNRECONCILED_ACCOUNTS')).toMatchObject({ count: 1, severity: 'BLOCKING' });
    expect(item(c, 'UNCATEGORIZED')).toMatchObject({
      count: 3,
      severity: 'WARNING',
      amounts: [money('210.00')],
    });
    expect(item(c, 'UNRESOLVED_RECURRING')).toMatchObject({ availability: 'NOT_AVAILABLE' });
    expect(c.canClose).toBe(false);
    const after = await get(s.owner, '/periods?limit=100');
    const period = (after.body['data'] as Json[]).find((p) => p['label'] === '2026-10');
    expect(period).toMatchObject({ status: 'ACTIVE', closeCount: 0 });
    const auditAfter = await get(s.owner, '/audit-log?limit=100');
    expect((auditAfter.body['data'] as unknown[]).length).toBe(
      (auditBefore.body['data'] as unknown[]).length,
    );
  });

  it('[TC-PLANNING-CHECKLIST-002] política por defecto, el OWNER la cambia (auditado) y el EDITOR recibe 403', async () => {
    const s = await scenario('pol');
    const def = await get(s.viewer, '/planning/closing-policy');
    expect(contract.validateResponse('getClosingPolicy', 200, def.body), JSON.stringify(def.body)).toEqual(
      [],
    );
    expect(def.body['severities']).toEqual({
      PENDING_TRANSACTIONS: 'BLOCKING',
      UNRECONCILED_ACCOUNTS: 'BLOCKING',
      UNRESOLVED_DUPLICATES: 'WARNING',
      UNCATEGORIZED: 'WARNING',
      UNRESOLVED_RECURRING: 'WARNING',
    });
    const severities = def.body['severities'] as Json;
    problem(
      await put(
        s.editor,
        '/planning/closing-policy',
        { severities: { ...severities, UNRECONCILED_ACCOUNTS: 'WARNING' } },
        1,
      ),
      403,
      'INSUFFICIENT_ROLE',
    );
    const updated = await put(
      s.owner,
      '/planning/closing-policy',
      { severities: { ...severities, UNCATEGORIZED: 'BLOCKING' } },
      1,
    );
    expect(updated.status, JSON.stringify(updated.body)).toBe(200);
    expect(updated.body['version']).toBe(2);
    expect((await get(s.owner, '/planning/closing-policy')).body['severities']).toMatchObject({
      UNCATEGORIZED: 'BLOCKING',
    });
    problem(
      await put(
        s.owner,
        '/planning/closing-policy',
        { severities: { ...severities, UNCATEGORIZED: 'WARNING' } },
        1,
      ),
      412,
      'PRECONDITION_FAILED',
    );
    const audit = await get(s.owner, '/audit-log?limit=100');
    const entry = (audit.body['data'] as Json[]).find(
      (e) => e['action'] === 'planning.closing_policy.updated',
    );
    expect(JSON.stringify(entry)).toContain('UNCATEGORIZED');
    expect(JSON.stringify(entry)).toContain('BLOCKING');
  });

  it('[TC-PLANNING-CHECKLIST-003] cuentas conciliadas, pendientes y exentas; un gasto retroactivo posteado deja la cuenta sin conciliar', async () => {
    const s = await scenario('cov');
    await reconcile(s, s.bank, '2026-10-31', '5000.00');
    const chica = await post(s.owner, '/accounts', { name: 'Caja chica', type: 'CASH', currency: 'BOB' });
    expect(chica.status).toBe(201);
    const c1 = await checklist(s, s.owner, '2026-10');
    expect(item(c1, 'UNRECONCILED_ACCOUNTS')['count']).toBe(0);
    expect((await expense(s.owner, s.bank, '50.00', '2026-10-15')).status).toBe(201);
    const c2 = await checklist(s, s.owner, '2026-10');
    const unreconciled = item(c2, 'UNRECONCILED_ACCOUNTS');
    expect(unreconciled['count']).toBe(1);
    expect((unreconciled['details'] as Json[]).map((d) => d['label'])).toEqual(['Bank A']);
  }, 60_000);
});

describe('Cierre', () => {
  it('[TC-PLANNING-CLOSE-002] ítems bloqueantes ⇒ 409 MONTH_CLOSING_BLOCKED con blockingItems; sin snapshot, sin lock, y el gasto del 2026-10-20 se acepta', async () => {
    const s = await scenario('blk');
    await relaxReconciliation(s);
    await expense(s.owner, s.bank, '120.00', '2026-10-28', { status: 'PENDING' });
    const r = await closeReq(s, s.editor, '2026-10', { acknowledgeWarnings: true });
    problem(r, 409, 'MONTH_CLOSING_BLOCKED');
    expect((r.body['blockingItems'] as Json[]).map((i) => i['kind'])).toEqual(['PENDING_TRANSACTIONS']);
    expect(contract.validateResponse('closePeriod', 409, r.body, 'application/problem+json')).toEqual([]);
    expect(
      (await get(s.owner, `/periods/${s.periods['2026-10']!.id}/close-snapshots`)).body['items'],
    ).toEqual([]);
    expect((await expense(s.owner, s.bank, '30.00', '2026-10-20')).status).toBe(201);
    const events = await outbox(s.owner);
    expect(events.filter((e) => e.event_type === 'planning.MonthClosed')).toHaveLength(0);
  });

  it('[TC-PLANNING-CLOSE-003] advertencias sin reconocer ⇒ 409; reconocidas ⇒ closed y el snapshot registra quién las reconoció', async () => {
    const s = await scenario('ack');
    await relaxReconciliation(s);
    for (const d of ['2026-10-05', '2026-10-06', '2026-10-07']) await expense(s.owner, s.bank, '70.00', d);
    const no = await closeReq(s, s.editor, '2026-10', { acknowledgeWarnings: false });
    problem(no, 409, 'MONTH_CLOSING_WARNINGS_NOT_ACKNOWLEDGED');
    const kinds = (no.body['warningItems'] as Json[]).map((i) => i['kind']);
    expect(kinds).toContain('UNCATEGORIZED');
    const ok = await closeAck(s, '2026-10');
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(contract.validateResponse('closePeriod', 200, ok.body), JSON.stringify(ok.body)).toEqual([]);
    expect(ok.body).toMatchObject({ status: 'CLOSED', closeCount: 1, latestCloseNo: 1 });
    const snap = await get(s.viewer, `/periods/${s.periods['2026-10']!.id}/close-snapshots/1`);
    expect(contract.validateResponse('getCloseSnapshot', 200, snap.body), JSON.stringify(snap.body)).toEqual(
      [],
    );
    const ack = snap.body['acknowledgedWarnings'] as { items: string[]; by: string };
    expect(ack.items).toContain('UNCATEGORIZED');
    expect(ack.by).toBe(s.editor.id);
  });

  it('[TC-PLANNING-CLOSE-004] cerrar noviembre con octubre abierto ⇒ PERIOD_PREVIOUS_NOT_CLOSED; el primer periodo se cierra; [TC-PLANNING-CLOSE-005] un periodo no terminado ⇒ PERIOD_NOT_ENDED', async () => {
    const s = await scenario('ord', SEP);
    await relaxReconciliation(s);
    problem(
      await closeReq(s, s.editor, '2026-11', { acknowledgeWarnings: true }),
      409,
      'PERIOD_PREVIOUS_NOT_CLOSED',
    );
    problem(
      await closeReq(s, s.editor, '2026-12', { acknowledgeWarnings: true }),
      409,
      'INVALID_STATUS_TRANSITION',
    );
    const sep = await closeAck(s, '2026-09');
    expect(sep.status, JSON.stringify(sep.body)).toBe(200);
    problem(await closeAck(s, '2026-09'), 409, 'INVALID_STATUS_TRANSITION');
    await closeAck(s, '2026-10');
    // 2026-11-03 11:00 en La Paz: noviembre sigue en curso.
    problem(await closeAck(s, '2026-11'), 409, 'PERIOD_NOT_ENDED');
  });

  it('[TC-PLANNING-ROLE-002] un VIEWER no cierra (403 INSUFFICIENT_ROLE) pero consulta el checklist', async () => {
    const s = await scenario('role', SEP);
    await relaxReconciliation(s);
    problem(await closeReq(s, s.viewer, '2026-09', { acknowledgeWarnings: true }), 403, 'INSUFFICIENT_ROLE');
    expect((await get(s.viewer, `/periods/${s.periods['2026-09']!.id}/close-checklist`)).status).toBe(200);
    const list = await get(s.owner, '/periods?limit=100');
    expect((list.body['data'] as Json[]).find((p) => p['label'] === '2026-09')).toMatchObject({
      status: 'ACTIVE',
    });
  });
});

describe('Bloqueo del ledger y alcance de la edición en periodos cerrados', () => {
  it('[TC-PLANNING-LOCK-001][TC-PLANNING-LOCK-004][TC-TRANSACTIONS-PENDINGCLOSED-001] cerrado octubre, NADA con fecha de octubre pasa; noviembre sí; las notas siguen editables', async () => {
    const s = await scenario('lock', SEP);
    await relaxReconciliation(s);
    const e80 = await expense(s.owner, s.bank, '80.00', '2026-10-10', {
      description: 'Cena',
      notes: 'original',
    });
    expect(e80.status).toBe(201);
    const e5 = await expense(s.owner, s.bank, '25.00', '2026-10-05');
    const tag = await post(s.owner, '/tags', { name: `viaje-${randomUUID().slice(0, 6)}` });
    await closeAck(s, '2026-09');
    expect((await closeAck(s, '2026-10')).status).toBe(200);
    const balances = async () =>
      asApp(
        s.owner,
        async (c) =>
          (
            await c.query<{ b: string }>(
              `SELECT (COALESCE(sum(p.amount), 0))::numeric(38,2)::text AS b FROM ledger.posting p
               JOIN ledger.journal_entry j ON j.id = p.journal_entry_id
               JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
              WHERE la.source_account_id = $1 AND j.entry_date <= '2026-10-31'`,
              [s.bank],
            )
          ).rows[0]!.b,
      );
    const before = await balances();

    problem(await expense(s.owner, s.bank, '45.00', '2026-10-15'), 409, 'PERIOD_CLOSED');
    problem(
      await expense(s.owner, s.bank, '45.00', '2026-10-29', { status: 'PENDING' }),
      409,
      'PERIOD_CLOSED',
    );
    problem(await expense(s.owner, s.bank, '45.00', '2026-09-20'), 409, 'PERIOD_CLOSED');
    const body = e80.body as Json & { id: string; version: number };
    problem(
      await patch(s.owner, `/transactions/${body.id}`, { amount: money('85.00') }, body.version),
      409,
      'PERIOD_CLOSED',
    );
    const e5b = e5.body as Json & { id: string; version: number };
    const tagId = tag.body['id'] as string;
    const cats = (await get(s.owner, '/categories?limit=200')).body['data'] as {
      id: string;
      systemCode: string | null;
      kind: string;
    }[];
    const anyExpense =
      cats.find((c) => c.kind === 'EXPENSE' && c.systemCode === null) ??
      cats.find((c) => c.systemCode === 'UNCATEGORIZED')!;
    problem(
      await patch(
        s.owner,
        `/transactions/${e5b.id}`,
        { splits: [{ amount: money('25.00'), categoryId: anyExpense.id, tagIds: [tagId] }] },
        e5b.version,
      ),
      409,
      'PERIOD_CLOSED',
    );
    expect(await balances()).toBe(before);

    // Descriptivas: notas y descripción siguen editables y auditadas; el saldo no cambia.
    const notes = await patch(
      s.owner,
      `/transactions/${body.id}`,
      { notes: 'corregida', description: 'Cena 2' },
      body.version,
    );
    expect(notes.status, JSON.stringify(notes.body)).toBe(200);
    expect(await balances()).toBe(before);

    // Noviembre se acepta; la anulación corregida en el periodo actual se fecha el primer día abierto.
    expect((await expense(s.owner, s.bank, '45.00', '2026-11-01')).status).toBe(201);
    expect((await expense(s.owner, s.bank, '60.00', '2026-11-02', { status: 'PENDING' })).status).toBe(201);
    const fresh = await get(s.owner, `/transactions/${body.id}`);
    problem(
      await post(
        s.owner,
        `/transactions/${body.id}/void`,
        { reason: 'error' },
        { 'if-match': `"${fresh.body['version']}"` },
      ),
      409,
      'PERIOD_CLOSED',
    );
    const voided = await post(
      s.owner,
      `/transactions/${body.id}/void`,
      { reason: 'error', correctInCurrentPeriod: true },
      { 'if-match': `"${fresh.body['version']}"` },
    );
    expect(voided.status, JSON.stringify(voided.body)).toBe(200);
    const reversalDate = await asApp(s.owner, async (c) =>
      (
        await c.query<{ d: string }>(
          `SELECT entry_date::text AS d FROM ledger.journal_entry WHERE entry_type = 'REVERSAL'`,
        )
      ).rows.map((r) => r.d),
    );
    expect(reversalDate).toEqual(['2026-11-01']);
    expect(await balances()).toBe(before);
  });

  it('[TC-LEDGER-PERIOD-003][TC-PLANNING-LOCK-003] la base de datos rechaza (PF004) el asiento directo con fecha del periodo cerrado y de lo anterior al primer cierre', async () => {
    const s = await scenario('pf004', SEP);
    await relaxReconciliation(s);
    await closeAck(s, '2026-09');
    const locks = await asApp(
      s.owner,
      async (c) =>
        (
          await c.query<{ year_month: string; ps: string; pe: string }>(
            `SELECT year_month, period_start::text AS ps, period_end::text AS pe FROM ledger.period_lock ORDER BY period_start`,
          )
        ).rows,
    );
    expect(locks).toEqual([{ year_month: '2026-09', ps: '-infinity', pe: '2026-09-30' }]);
    for (const date of ['2026-09-20', '2026-09-30', '2026-06-15']) {
      const state = await asApp(s.owner, async (c) => {
        await c.query('SAVEPOINT s');
        try {
          await c.query(
            `INSERT INTO ledger.journal_entry (id, workspace_id, entry_date, entry_type, source_context, source_type, source_id, source_revision)
             VALUES ($1, $2, $3, 'POSTING', 'TRANSACTIONS', 'TRANSACTION', $4, 1)`,
            [randomUUID(), s.owner.ws, date, randomUUID()],
          );
          return 'inserted';
        } catch (err) {
          return (err as { code?: string }).code;
        }
      });
      expect(state, date).toBe('PF004');
    }
    // El mes siguiente sí se acepta y no se crean periodos anteriores al primer cierre.
    expect((await expense(s.owner, s.bank, '10.00', '2026-10-01')).status).toBe(201);
    problem(await expense(s.owner, s.bank, '10.00', '2026-06-15'), 409, 'PERIOD_CLOSED');
    expect((await post(s.owner, '/periods', { through: '2026-12-31' })).status).toBe(200);
    const labels = ((await get(s.owner, '/periods?limit=100')).body['data'] as { label: string }[]).map(
      (p) => p.label,
    );
    expect(labels.filter((l) => l < '2026-09')).toEqual([]);
  });

  it('[TC-PLANNING-LOCK-002] cierre y posteo concurrentes: o el gasto está en el snapshot o se rechazó con PERIOD_CLOSED (nunca un asiento fuera del snapshot)', async () => {
    const outcomes = { posted: 0, rejected: 0 };
    for (let i = 0; i < 12; i += 1) {
      const s = await scenario(`race${i}`, SEP);
      await relaxReconciliation(s);
      await closeAck(s, '2026-09');
      const run = async () =>
        i % 2 === 0
          ? await Promise.all([
              expense(s.owner, s.bank, '30.00', '2026-10-31'),
              closeReq(s, s.editor, '2026-10', { acknowledgeWarnings: true }),
            ])
          : (
              await Promise.all([
                closeReq(s, s.editor, '2026-10', { acknowledgeWarnings: true }),
                expense(s.owner, s.bank, '30.00', '2026-10-31'),
              ])
            ).reverse();
      const [spend, close] = (await run()) as [Reply, Reply];
      expect(close.status, JSON.stringify(close.body)).toBe(200);
      const inLedger = await asApp(
        s.owner,
        async (c) =>
          (
            await c.query<{ b: string }>(
              `SELECT (COALESCE(sum(p.amount), 0))::numeric(38,2)::text AS b FROM ledger.posting p
               JOIN ledger.journal_entry j ON j.id = p.journal_entry_id
               JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
              WHERE la.source_account_id = $1 AND j.entry_date <= '2026-10-31'`,
              [s.bank],
            )
          ).rows[0]!.b,
      );
      const inSnapshot = await asApp(
        s.owner,
        async (c) =>
          (
            await c.query<{ b: string }>(
              `SELECT b.balance::numeric(38,2)::text AS b FROM planning.close_snapshot_balance b
               JOIN planning.close_snapshot sn ON sn.id = b.snapshot_id
              WHERE b.account_id = $1 AND sn.label = '2026-10' ORDER BY sn.close_no DESC LIMIT 1`,
              [s.bank],
            )
          ).rows[0]!.b,
      );
      expect(inSnapshot).toBe(inLedger);
      if (spend.status === 201) {
        outcomes.posted += 1;
        expect(inSnapshot).toBe('4970.00');
      } else {
        problem(spend, 409, 'PERIOD_CLOSED');
        outcomes.rejected += 1;
        expect(inSnapshot).toBe('5000.00');
      }
    }
    expect(outcomes.posted + outcomes.rejected).toBe(12);
  }, 240_000);
});

describe('Snapshot, reapertura y re-cierre', () => {
  it('[TC-PLANNING-SNAPSHOT-001][TC-PLANNING-SNAPSHOT-002][TC-PLANNING-REOPEN-001][TC-PLANNING-RECLOSE-001][TC-PLANNING-RECLOSE-002][TC-PLANNING-REPORT-001][TC-PLANNING-REPORT-002][TC-PLANNING-REPORT-003][TC-PLANNING-EVENT-002][TC-PLANNING-EVENT-003][TC-AUDIT-PERIODLIFECYCLE-001] snapshot inmutable; reapertura OWNER; re-cierre n+1 sin tocar el 1; comparación', async () => {
    const s = await scenario('cycle', SEP);
    await relaxReconciliation(s);
    await expense(s.owner, s.bank, '80.00', '2026-10-10', { description: 'Cena' });
    await closeAck(s, '2026-09');
    const first = await closeAck(s, '2026-10');
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const oct = s.periods['2026-10']!;
    expect(first.headers.get('location')).toContain(`/periods/${oct.id}/close-snapshots/1`);
    const snap1 = await get(s.viewer, `/periods/${oct.id}/close-snapshots/1`);
    const bank1 = (snap1.body['balances'] as Json[]).find((b) => b['accountName'] === 'Bank A')!;
    expect(bank1['balance']).toEqual(money('4920.00'));
    expect(snap1.body['netWorth']).toMatchObject({ amount: money('4920.00'), complete: true });
    expect(snap1.body['budgetVsActual']).toBeNull();
    expect(snap1.body['goalContributions']).toBeNull();
    expect((snap1.body['flows'] as Json)['consolidated']).toMatchObject({ expense: money('80.00') });

    // Inmutable: la base de datos rechaza UPDATE y DELETE con el rol de aplicación (grants → 42501 o PF003).
    for (const sqlText of [
      `UPDATE planning.close_snapshot_balance SET balance = 5000.00 WHERE snapshot_id = '${String(snap1.body['snapshotId'])}'`,
      `DELETE FROM planning.close_snapshot_balance WHERE snapshot_id = '${String(snap1.body['snapshotId'])}'`,
      `UPDATE planning.close_snapshot SET label = '2026-99' WHERE id = '${String(snap1.body['snapshotId'])}'`,
      `DELETE FROM planning.close_snapshot WHERE id = '${String(snap1.body['snapshotId'])}'`,
    ]) {
      const code = await asApp(s.owner, async (c) => {
        await c.query('SAVEPOINT x');
        try {
          await c.query(sqlText);
          return 'ok';
        } catch (err) {
          return (err as { code?: string }).code;
        }
      });
      expect(['42501', 'PF003'], sqlText).toContain(code);
    }

    // Reapertura: solo OWNER, con motivo.
    problem(await reopenReq(s, s.editor, '2026-10', 'Faltó la comisión'), 403, 'INSUFFICIENT_ROLE');
    problem(await reopenReq(s, s.owner, '2026-10', ''), 400, 'VALIDATION_FAILED');
    const reopened = await reopenReq(s, s.owner, '2026-10', 'Faltó registrar la comisión bancaria');
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect(
      contract.validateResponse('reopenPeriod', 200, reopened.body),
      JSON.stringify(reopened.body),
    ).toEqual([]);
    expect(reopened.body).toMatchObject({ status: 'REOPENED', reopenCount: 1, closeCount: 1 });
    await refresh(s);
    expect((await expense(s.owner, s.bank, '15.00', '2026-10-31', { description: 'Comisión' })).status).toBe(
      201,
    );
    const reclose = await closeAck(s, '2026-10');
    expect(reclose.status, JSON.stringify(reclose.body)).toBe(200);
    expect(reclose.body).toMatchObject({ status: 'CLOSED', closeCount: 2, reopenCount: 1, latestCloseNo: 2 });

    const versions = (await get(s.viewer, `/periods/${oct.id}/close-snapshots`)).body['items'] as Json[];
    expect(versions.map((v) => [v['closeNo'], v['isCurrent']])).toEqual([
      [1, false],
      [2, true],
    ]);
    expect(versions[1]!['previousSnapshotId']).toBe(versions[0]!['snapshotId']);
    const snap1Again = await get(s.viewer, `/periods/${oct.id}/close-snapshots/1`);
    expect({ ...snap1Again.body, isCurrent: null }).toEqual({ ...snap1.body, isCurrent: null });
    const snap2 = await get(s.viewer, `/periods/${oct.id}/close-snapshots/2`);
    expect((snap2.body['balances'] as Json[]).find((b) => b['accountName'] === 'Bank A')!['balance']).toEqual(
      money('4905.00'),
    );

    const diff = await get(s.viewer, `/periods/${oct.id}/close-snapshots/compare?from=1&to=2`);
    expect(
      contract.validateResponse('compareCloseSnapshots', 200, diff.body),
      JSON.stringify(diff.body),
    ).toEqual([]);
    expect((diff.body['balances'] as Json[]).find((b) => b['currency'] === 'BOB')!['delta']).toEqual(
      money('-15.00'),
    );
    expect((diff.body['flows'] as Json)['consolidated']).toMatchObject({
      expense: money('15.00'),
      savings: money('-15.00'),
    });
    expect(diff.body['netWorth']).toEqual({ delta: money('-15.00') });

    // Reporte: versión vigente + variación contra septiembre; exportación CSV y PDF.
    const report = await get(s.viewer, `/periods/${oct.id}/close-report`);
    expect(
      contract.validateResponse('getCloseReport', 200, report.body),
      JSON.stringify(report.body),
    ).toEqual([]);
    expect((report.body['snapshot'] as Json)['closeNo']).toBe(2);
    expect((report.body['versions'] as Json[]).length).toBe(2);
    expect(report.body['comparison']).toMatchObject({ previousLabel: '2026-09', previousCloseNo: 1 });
    const csv = await call(
      'GET',
      `${W(s.viewer)}/periods/${oct.id}/close-report/export?format=csv&closeNo=1`,
      { token: s.viewer.token },
    );
    expect(csv.status).toBe(200);
    const csvText = new TextDecoder().decode(csv.raw);
    expect(csvText).toContain('BALANCE,Bank A,BOB,4920.00');
    expect(csvText).toContain('VERSION,2026-10,,1');
    const pdf = await call('GET', `${W(s.owner)}/periods/${oct.id}/close-report/export?format=pdf`, {
      token: s.owner.token,
    });
    expect(pdf.status).toBe(200);
    expect(new TextDecoder().decode(pdf.raw.slice(0, 5))).toBe('%PDF-');
    const sepReport = await get(s.viewer, `/periods/${s.periods['2026-09']!.id}/close-report`);
    expect(sepReport.body['comparison']).toBeNull();
    expect(sepReport.body['comparisonUnavailableReason']).toBe('NO_PREVIOUS_PERIOD');
    problem(
      await get(s.viewer, `/periods/${s.periods['2026-12']!.id}/close-report`),
      404,
      'REFERENCE_NOT_FOUND',
    );

    // Eventos en orden y recorrido.
    const events = (await outbox(s.owner)).filter(
      (e) =>
        e.event_type.startsWith('planning.MonthClosed') || e.event_type.startsWith('planning.PeriodReopened'),
    );
    const forOct = events.filter((e) => (e.envelope.payload as Json)['periodId'] === oct.id);
    expect(
      forOct.map((e) => [
        e.event_type,
        (e.envelope.payload as Json)['closeNo'] ?? (e.envelope.payload as Json)['reopenNo'],
      ]),
    ).toEqual([
      ['planning.MonthClosed', 1],
      ['planning.PeriodReopened', 1],
      ['planning.MonthClosed', 2],
    ]);
    for (const e of forOct) expect(() => eventSchemaRegistry().validate(e.envelope)).not.toThrow();
    const life = await get(s.viewer, `/periods/${oct.id}/lifecycle`);
    expect(life.status, JSON.stringify(life.body)).toBe(200);
    const transitions = (life.body['items'] as Json[])
      .filter((t) => t['kind'] === 'TRANSITION')
      .map((t) => t['transition']);
    expect(transitions).toEqual(['CREATE', 'CLOSE', 'REOPEN', 'CLOSE']);
    expect(life.body['path']).toEqual(['ACTIVE', 'CLOSED', 'REOPENED', 'CLOSED']);
    expect(
      contract.validateResponse('getPeriodLifecycle', 200, life.body),
      JSON.stringify(life.body),
    ).toEqual([]);
    expect(life.body['currentState']).toBe('CLOSED');
    const lifeCsv = await call('GET', `${W(s.viewer)}/periods/${oct.id}/lifecycle/export?format=csv`, {
      token: s.viewer.token,
    });
    expect(lifeCsv.status).toBe(200);
  }, 120_000);

  it('[TC-PLANNING-REOPEN-002] reabrir octubre con noviembre... septiembre con octubre cerrado ⇒ PERIOD_NEXT_CLOSED; en orden inverso sí', async () => {
    const s = await scenario('rev', SEP);
    await relaxReconciliation(s);
    await closeAck(s, '2026-09');
    await closeAck(s, '2026-10');
    problem(await reopenReq(s, s.owner, '2026-09', 'x'), 409, 'PERIOD_NEXT_CLOSED');
    expect((await reopenReq(s, s.owner, '2026-10', 'primero octubre')).status).toBe(200);
    await refresh(s);
    expect((await reopenReq(s, s.owner, '2026-09', 'luego septiembre')).status).toBe(200);
  });

  it('[TC-PLANNING-EXIT-001] cierre de un mes real con la cuenta conciliada a diferencia 0: el saldo del snapshot es el del extracto y referencia la conciliación', async () => {
    const s = await scenario('exit', SEP);
    // Septiembre: la cuenta se concilia al 2026-09-30 (saldo inicial 5000.00) y se cierra SIN reconocer nada.
    const sepSession = await reconcile(s, s.bank, '2026-09-30', '5000.00');
    expect(sepSession['status']).toBe('COMPLETED');
    const cSep = await checklist(s, s.owner, '2026-09');
    expect(item(cSep, 'UNRECONCILED_ACCOUNTS')['count']).toBe(0);
    expect((await closeReq(s, s.editor, '2026-09', {})).status).toBe(200);
    await refresh(s);

    const g = await expense(s.owner, s.bank, '80.00', '2026-10-10', {
      status: 'CLEARED',
      description: 'Cena',
    });
    const gb = g.body as Json & { id: string; version: number };
    const cBlocked = await checklist(s, s.owner, '2026-10');
    expect(item(cBlocked, 'UNRECONCILED_ACCOUNTS')['count']).toBe(1);
    problem(await closeReq(s, s.editor, '2026-10', {}), 409, 'MONTH_CLOSING_BLOCKED');
    const session = await reconcile(s, s.bank, '2026-10-31', '4920.00', []);
    expect(session['status']).toBe('COMPLETED');
    void gb;
    const c = await checklist(s, s.owner, '2026-10');
    expect(c.canClose).toBe(true);
    const closed = await closeReq(s, s.editor, '2026-10', { acknowledgeWarnings: true });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    await refresh(s);
    const snap = await get(s.owner, `/periods/${s.periods['2026-10']!.id}/close-snapshots/1`);
    const bank = (snap.body['balances'] as Json[]).find((b) => b['accountName'] === 'Bank A')! as Json & {
      reconciliation: { reconciliationId: string; statementBalance: { amount: string } };
    };
    expect(bank['balance']).toEqual(money('4920.00'));
    expect(bank.reconciliation.statementBalance.amount).toBe('4920.00');
    expect(bank.reconciliation.reconciliationId).toBe(session['id']);
    expect(bank['reconciliationBasis']).toBe('STATEMENT');
  }, 120_000);
});

describe('Conciliadas sin extracto, aviso de cierre pendiente y verificador', () => {
  it('[TC-PLANNING-CLOSE-006][TC-PLANNING-CLOSE-007] "Caja BOB" conciliada solo sin extracto: INFO sin bloqueo; el snapshot registra la base y la fila WS-RO; el filtro devuelve el mismo gasto', async () => {
    const s = await scenario('nostmt');
    // "Bank A" conciliada contra el extracto del 2026-10-31 (saldo inicial 5000.00, sin movimientos).
    const bankSession = await reconcile(s, s.bank, '2026-10-31', '5000.00');
    const caja = await post(s.owner, '/accounts', { name: 'Caja BOB', type: 'CASH', currency: 'BOB' });
    expect(caja.status, JSON.stringify(caja.body)).toBe(201);
    const grp = await post(s.owner, '/category-groups', {
      name: `Comida ${randomUUID().slice(0, 4)}`,
      kind: 'EXPENSE',
    });
    const cat = await post(s.owner, '/categories', {
      groupId: grp.body['id'],
      name: `Cenas ${randomUUID().slice(0, 4)}`,
    });
    const c1 = await expense(s.owner, caja.body['id'] as string, '80.00', '2026-10-12', {
      status: 'CLEARED',
      splits: [{ amount: money('80.00'), categoryId: cat.body['id'] }],
    });
    const c1b = c1.body as Json & { id: string; version: number };
    const marked = await patch(
      s.owner,
      `/transactions/${c1b.id}`,
      { status: 'RECONCILED', reconciliationMode: 'WITHOUT_STATEMENT' },
      c1b.version,
    );
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);

    const c = await checklist(s, s.owner, '2026-10');
    expect(c.canClose).toBe(true);
    expect(c.requiresAcknowledgement).toBe(false);
    const info = item(c, 'RECONCILED_WITHOUT_STATEMENT');
    expect(info).toMatchObject({ severity: 'INFO', count: 1 });
    expect((info['details'] as Json[]).map((d) => d['refId'])).toContain(c1b.id);
    expect(item(c, 'UNRECONCILED_ACCOUNTS')['count']).toBe(0);

    const closed = await closeReq(s, s.editor, '2026-10', {});
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    await refresh(s);
    const snap = await get(s.viewer, `/periods/${s.periods['2026-10']!.id}/close-snapshots/1`);
    const byName = Object.fromEntries((snap.body['balances'] as Json[]).map((b) => [b['accountName'], b]));
    expect(byName['Bank A']).toMatchObject({ reconciliationBasis: 'STATEMENT' });
    expect((byName['Bank A'] as { reconciliation: Json }).reconciliation['reconciliationId']).toBe(
      bankSession['id'],
    );
    expect(byName['Caja BOB']).toMatchObject({
      reconciliationBasis: 'WITHOUT_STATEMENT',
      reconciledWithoutStatementTransactionIds: [c1b.id],
    });
    const rows = await asApp(
      s.owner,
      async (c2) =>
        (
          await c2.query<{ transaction_id: string; amount: string }>(
            `SELECT transaction_id, amount::numeric(38,2)::text AS amount FROM planning.close_snapshot_without_statement`,
          )
        ).rows,
    );
    expect(rows).toEqual([{ transaction_id: c1b.id, amount: '-80.00' }]);
    const code = await asApp(s.owner, async (c2) => {
      await c2.query('SAVEPOINT x');
      try {
        await c2.query('DELETE FROM planning.close_snapshot_without_statement');
        return 'ok';
      } catch (err) {
        return (err as { code?: string }).code;
      }
    });
    expect(['42501', 'PF003']).toContain(code);

    // Seguimiento: el filtro devuelve el mismo gasto de octubre que lista el snapshot.
    const listed = await get(
      s.owner,
      '/transactions?systemFlag=RECONCILED_WITHOUT_STATEMENT&dateFrom=2026-10-01&dateTo=2026-10-31',
    );
    expect(listed.status, JSON.stringify(listed.body)).toBe(200);
    expect((listed.body['data'] as Json[]).map((t) => t['id'])).toEqual([c1b.id]);
  }, 120_000);

  it('[TC-PLANNING-EVENT-004] el aviso de cierre pendiente se publica una sola vez por periodo (aun con reintentos, cierre y reapertura posteriores)', async () => {
    const s = await scenario('pend');
    await relaxReconciliation(s);
    const worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 4 });
    try {
      const audit = createAuditRuntime({
        pool: worker,
        clock,
        policies: AUDIT_POLICIES,
        timeZones: identityWorkspaceTimeZones(worker),
      });
      const planning = createPlanningRuntime({
        pool: worker,
        clock,
        audit: audit.port,
        lifecycle: audit.lifecycle,
        outbox: outboxPort(new PgOutboxWriter(eventSchemaRegistry())),
        calendar: identityWorkspaceCalendarDirectory(worker),
        activity: ledgerActivityRange(),
      });
      const first = await planning.closePending.publishDue(s.owner.ws);
      const parallel = await Promise.all([
        planning.closePending.publishDue(s.owner.ws),
        planning.closePending.publishDue(s.owner.ws),
      ]);
      expect(first).toEqual([s.periods['2026-10']!.id]);
      expect(parallel.flat()).toEqual([]);
      await closeAck(s, '2026-10');
      await reopenReq(s, s.owner, '2026-10', 'otra vez');
      expect(await planning.closePending.publishDue(s.owner.ws)).toEqual([]);
      const pending = (await outbox(s.owner)).filter((e) => e.event_type === 'planning.MonthClosePending');
      expect(pending).toHaveLength(1);
      expect(pending[0]!.envelope.payload).toEqual({
        workspaceId: s.owner.ws,
        periodId: s.periods['2026-10']!.id,
        periodLabel: '2026-10',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        pendingSince: '2026-11-01',
        delayDays: 3,
      });
      expect(() => eventSchemaRegistry().validate(pending[0]!.envelope)).not.toThrow();
    } finally {
      await worker.end();
    }
  }, 120_000);

  it('el verificador compara el snapshot con el ledger y el bloqueo: detecta un candado perdido', async () => {
    const s = await scenario('verify');
    await relaxReconciliation(s);
    await expense(s.owner, s.bank, '80.00', '2026-10-10');
    expect((await closeAck(s, '2026-10')).status).toBe(200);
    const pool = new Pool({ connectionString: deps.databaseUrl, max: 4 });
    try {
      const audit = createAuditRuntime({
        pool,
        clock,
        policies: AUDIT_POLICIES,
        timeZones: identityWorkspaceTimeZones(pool),
        machines: LIFECYCLE_MACHINES,
      });
      const r = financeRuntimes({
        pool,
        clock,
        audit: audit.port,
        lifecycle: audit.lifecycle,
        lifecycleQuery: audit.lifecycleQuery,
        history: audit.history,
        logger: apiLog.logger,
        config: apiConfig(baseEnv(deps)),
      });
      const verifier = r.planning.verifier!;
      expect(await verifier.verify(s.owner.ws)).toEqual([]);
      // Sin bloqueo en el ledger, el periodo CERRADO se reporta.
      const admin = await connect(deps.superuserUrl);
      try {
        await admin.query(`DELETE FROM ledger.period_lock WHERE workspace_id = $1`, [s.owner.ws]);
      } finally {
        await admin.end();
      }
      expect((await verifier.verify(s.owner.ws)).map((v) => v.check)).toContain('LOCK_MISSING');
    } finally {
      await pool.end();
    }
  }, 120_000);
});

describe('Día de inicio distinto de 1 (ADR-0028)', () => {
  it('[TC-LEDGER-PERIOD-003] con día de inicio 25 el bloqueo sigue el rango financiero: el 10-24 cerrado, el 10-25 y el 10-31 de un periodo abierto se aceptan', async () => {
    const owner = await user(`kc-mc-day25-${randomUUID()}`);
    const set = await call('PATCH', `${W(owner)}`, {
      token: owner.token,
      headers: { 'if-match': '"1"', 'content-type': 'application/merge-patch+json' },
      body: { fiscalMonthStartDay: 25 },
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const acc = await post(owner, '/accounts', {
      name: 'Bank A',
      type: 'BANK',
      currency: 'BOB',
      openingBalance: { amount: money('1000.00'), date: '2026-09-26' },
    });
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    expect((await post(owner, '/periods', { through: '2026-12-31' })).status).toBe(200);
    const list = (await get(owner, '/periods?limit=100')).body['data'] as {
      label: string;
      id: string;
      version: number;
      periodStart: string;
      periodEnd: string;
    }[];
    const sep = list.find((p) => p.label === '2026-09')!;
    expect([sep.periodStart, sep.periodEnd]).toEqual(['2026-09-25', '2026-10-24']);
    const policy = await get(owner, '/planning/closing-policy');
    const severities = { ...(policy.body['severities'] as Json), UNRECONCILED_ACCOUNTS: 'WARNING' };
    expect((await put(owner, '/planning/closing-policy', { severities }, 1)).status).toBe(200);
    const closed = await post(
      owner,
      `/periods/${sep.id}/close`,
      { acknowledgeWarnings: true },
      { 'if-match': `"${sep.version}"` },
    );
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const bank = acc.body['id'] as string;
    problem(await expense(owner, bank, '20.00', '2026-10-24'), 409, 'PERIOD_CLOSED');
    problem(await expense(owner, bank, '20.00', '2026-09-25'), 409, 'PERIOD_CLOSED');
    problem(await expense(owner, bank, '20.00', '2026-08-01'), 409, 'PERIOD_CLOSED');
    expect((await expense(owner, bank, '20.00', '2026-10-25')).status).toBe(201);
    // 2026-10-31 es el último día de octubre calendario, pero pertenece al periodo abierto "2026-10" (10-25..11-24).
    expect((await expense(owner, bank, '20.00', '2026-10-31')).status).toBe(201);
    expect((await expense(owner, bank, '20.00', '2026-11-24')).status).toBe(201);
  });
});
