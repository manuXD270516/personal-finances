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

// Reconciliación por HTTP contra PostgreSQL real (openspec add-reconciliation, tareas 5.1–5.2, 7.1): sesiones por
// cuenta, saldo confirmado y diferencia en vivo, confirmar en la sesión, finalizar con diferencia 0 y con ajuste,
// cancelar, estado por cuenta, periodos cerrados, conciliación sin extracto con su marca y filtro, cotejo posterior,
// recorrido de la sesión y de sus transacciones, roles, aislamiento y contrato de los eventos.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
// 2026-04-05 10:00 en La Paz ("hoy" para la fecha del extracto, RISK-020).
const clock = new FixedClock(Instant.parse('2026-04-05T14:00:00Z'));
const contract = ApiContract.fromFile(resolveContractPath());

interface Reply {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
}
type Json = Record<string, unknown>;
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

/** Saldo contable de una cuenta (Σ postings). */
const balanceOf = (u: User, accountId: string) =>
  asApp(u, async (c) => {
    const { rows } = await c.query<{ balance: string }>(
      `SELECT (COALESCE(sum(p.amount), 0))::numeric(38,2)::text AS balance
         FROM ledger.posting p JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
        WHERE la.source_account_id = $1`,
      [accountId],
    );
    return rows[0]!.balance;
  });
const eventCountOf = (rows: { event_type: string }[], type: string) =>
  rows.filter((r) => r.event_type === type).length;
const entryCount = (u: User) =>
  asApp(u, async (c) =>
    Number((await c.query<{ n: string }>('SELECT count(*) AS n FROM ledger.journal_entry')).rows[0]!.n),
  );

/** Sobres del outbox del workspace, en orden. */
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

async function account(u: User, name: string, opening: string | null, type = 'BANK') {
  const r = await post(u, '/accounts', {
    name,
    type,
    currency: 'BOB',
    ...(opening ? { openingBalance: { amount: money(opening), date: '2026-02-28' } } : {}),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body['id'] as string;
}

async function movement(
  u: User,
  accountId: string,
  kind: 'EXPENSE' | 'INCOME',
  amount: string,
  transactionDate: string,
  status: 'POSTED' | 'CLEARED',
  description: string,
) {
  const r = await post(u, '/transactions', {
    kind,
    status,
    transactionDate,
    accountId,
    amount: money(amount),
    description,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number } & Json;
}

/** "Bank A" del change: saldo inicial 1000.00; G1 150.00 y I1 2500.00 cleared; G2 45.90 posted; G3 200.00 cleared. */
async function bankScenario(label: string) {
  const owner = await user(`kc-rec-${label}-${randomUUID()}`);
  const bank = await account(owner, 'Bank A', '1000.00');
  const g1 = await movement(owner, bank, 'EXPENSE', '150.00', '2026-03-05', 'CLEARED', 'G1');
  const i1 = await movement(owner, bank, 'INCOME', '2500.00', '2026-03-10', 'CLEARED', 'I1');
  const g2 = await movement(owner, bank, 'EXPENSE', '45.90', '2026-03-20', 'POSTED', 'G2');
  const g3 = await movement(owner, bank, 'EXPENSE', '200.00', '2026-04-02', 'CLEARED', 'G3');
  return { owner, bank, g1, i1, g2, g3 };
}

const startSession = (
  u: User,
  accountId: string,
  statementBalance = '3350.00',
  statementDate = '2026-03-31',
) => post(u, '/reconciliations', { accountId, statementDate, statementBalance });
const completeSession = (u: User, id: string, version: number, body: unknown = {}) =>
  post(u, `/reconciliations/${id}/complete`, body, { 'if-match': `"${version}"` });
type Session = { id: string; version: number } & Json;

let outsider: User;

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
  outsider = await user(`kc-rec-outsider-${randomUUID()}`);
}, 120_000);

afterAll(async () => {
  await runtime?.close();
});

describe('Sesiones de reconciliación: iniciar, calcular y confirmar', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-001] [TC-TRANSACTIONS-RECONCILIATION-003] iniciar la reconciliación de marzo: 201 con ETag, saldo confirmado 3350.00, diferencia 0.00 y saldo contable 3104.10', async () => {
    const { owner, bank } = await bankScenario('start');
    const r = await startSession(owner, bank);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(contract.validateResponse('startReconciliation', 201, r.body)).toEqual([]);
    const id = r.body['id'] as string;
    expect(r.headers.get('etag')).toBe('"1"');
    expect(r.headers.get('location')).toBe(`${W(owner)}/reconciliations/${id}`);
    expect(r.body).toMatchObject({
      status: 'IN_PROGRESS',
      accountId: bank,
      statementDate: '2026-03-31',
      statementBalance: money('3350.00'),
      clearedBalance: money('3350.00'),
      difference: money('0.00'),
      adjustmentTransactionId: null,
      version: 1,
    });
    const read = await get(owner, `/reconciliations/${id}`);
    expect(read.status).toBe(200);
    expect(contract.validateResponse('getReconciliation', 200, read.body)).toEqual([]);
    expect(await balanceOf(owner, bank)).toBe('3104.10');
    const list = await get(owner, `/reconciliations?accountId=${bank}`);
    expect(contract.validateResponse('listReconciliations', 200, list.body)).toEqual([]);
    expect((list.body['data'] as Json[]).map((x) => x['id'])).toEqual([id]);
    // Otro workspace: 404 idéntico a inexistente.
    expectProblem(
      await call('GET', `${W(owner)}/reconciliations/${id}`, { token: outsider.token }),
      403,
      'WORKSPACE_ACCESS_DENIED',
    );
    expectProblem(await get(outsider, `/reconciliations/${id}`), 404, 'RESOURCE_NOT_FOUND');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-002] segunda sesión en curso, fecha futura, escala excedida y VIEWER se rechazan sin crear sesiones', async () => {
    const { owner, bank } = await bankScenario('rules');
    const viewer = await addMember(owner, await user(`kc-rec-viewer-${randomUUID()}`), 'VIEWER');
    const first = await startSession(owner, bank);
    expect(first.status).toBe(201);
    expectProblem(await startSession(owner, bank), 409, 'RECONCILIATION_IN_PROGRESS');
    expectProblem(await startSession(viewer, bank), 403, 'INSUFFICIENT_ROLE');
    const cancelled = await post(owner, `/reconciliations/${String(first.body['id'])}/cancel`, undefined, {
      'if-match': '"1"',
    });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect(contract.validateResponse('cancelReconciliation', 200, cancelled.body)).toEqual([]);
    expectProblem(
      await startSession(owner, bank, '3350.00', '2026-04-06'),
      422,
      'RECONCILIATION_STATEMENT_DATE_INVALID',
    );
    const scale = await startSession(owner, bank, '3350.005');
    expectProblem(scale, 422, 'AMOUNT_SCALE_EXCEEDED');
    const viewerList = await get(viewer, '/reconciliations');
    expect(viewerList.status).toBe(200);
    expect((viewerList.body['data'] as Json[]).map((x) => x['status'])).toEqual(['CANCELLED']);
    // Borde de fecha (RISK-020): hoy en La Paz (2026-04-05) es válido.
    expect((await startSession(owner, bank, '3350.00', '2026-04-05')).status).toBe(201);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-005] confirmar G2 en la sesión: 200, diferencia 0.00, versión 2, mismo número de asientos y saldo contable', async () => {
    const { owner, bank, g2 } = await bankScenario('toggle');
    const session = (await startSession(owner, bank, '3304.10')).body as Session;
    expect((session['difference'] as Json)['amount']).toBe('-45.90');
    const entries = await entryCount(owner);
    const toggled = await post(
      owner,
      `/reconciliations/${session.id}/cleared`,
      { items: [{ id: g2.id, version: g2.version }], cleared: true },
      { 'if-match': '"1"' },
    );
    expect(toggled.status, JSON.stringify(toggled.body)).toBe(200);
    expect(contract.validateResponse('toggleReconciliationCleared', 200, toggled.body)).toEqual([]);
    expect(toggled.body).toMatchObject({
      version: 2,
      difference: money('0.00'),
      clearedBalance: money('3304.10'),
    });
    expect((await get(owner, `/transactions/${g2.id}`)).body['status']).toBe('CLEARED');
    expect(await entryCount(owner)).toBe(entries);
    expect(await balanceOf(owner, bank)).toBe('3104.10');
    // Una transacción posterior al extracto ⇒ VALIDATION_FAILED y sigue posted.
    const late = await movement(owner, bank, 'EXPENSE', '10.00', '2026-04-03', 'POSTED', 'tardía');
    const rejected = await post(
      owner,
      `/reconciliations/${session.id}/cleared`,
      { items: [{ id: late.id, version: late.version }], cleared: true },
      { 'if-match': '"2"' },
    );
    expectProblem(rejected, 400, 'VALIDATION_FAILED');
    expect((rejected.body['errors'] as { pointer: string }[])[0]?.pointer).toBe('/items/0/id');
    expect((await get(owner, `/transactions/${late.id}`)).body['status']).toBe('POSTED');
    // Versión obsoleta de la sesión ⇒ 412.
    const stale = await post(
      owner,
      `/reconciliations/${session.id}/cleared`,
      { items: [{ id: g2.id, version: 2 }], cleared: false },
      { 'if-match': '"1"' },
    );
    expectProblem(stale, 412, 'PRECONDITION_FAILED');
    expect(stale.body['currentVersion']).toBe(2);
  });
});

describe('Finalizar una sesión', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-006] [TC-TRANSACTIONS-RECONCILIATION-011] finalizar con diferencia 0 reconcilia G1 e I1 (modo extracto) y publica ReconciliationCompleted y TransactionCleared conformes a su schema', async () => {
    const { owner, bank, g1, i1, g2, g3 } = await bankScenario('complete');
    // Evento dedicado al confirmar G2 en la sesión (además del TransactionUpdated).
    const session = (await startSession(owner, bank, '3304.10')).body as Session;
    await post(
      owner,
      `/reconciliations/${session.id}/cleared`,
      { items: [{ id: g2.id, version: g2.version }], cleared: true },
      { 'if-match': '"1"' },
    );
    const entries = await entryCount(owner);
    const done = await completeSession(owner, session.id, 2);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(contract.validateResponse('completeReconciliation', 200, done.body)).toEqual([]);
    expect(done.body).toMatchObject({
      status: 'COMPLETED',
      clearedBalance: money('3304.10'),
      difference: money('0.00'),
      version: 3,
    });
    const items = done.body['items'] as { transactionId: string; verifiedWithoutStatement: boolean }[];
    expect(items.map((i) => i.transactionId).sort()).toEqual([g1.id, i1.id, g2.id].sort());
    for (const t of [g1, i1, g2]) {
      const tx = (await get(owner, `/transactions/${t.id}`)).body;
      expect(tx).toMatchObject({ status: 'RECONCILED', reconciliationMode: 'STATEMENT', systemFlags: [] });
    }
    expect((await get(owner, `/transactions/${g3.id}`)).body['status']).toBe('CLEARED');
    expect(await entryCount(owner)).toBe(entries);
    expect(await balanceOf(owner, bank)).toBe('3104.10');
    // Contrato de los eventos publicados.
    const rows = await outbox(owner);
    const registry = eventSchemaRegistry();
    for (const row of rows) registry.validate(row.envelope);
    const completed = rows.filter((r) => r.event_type === 'transactions.ReconciliationCompleted');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.envelope.payload).toMatchObject({
      reconciliationId: session.id,
      statementDate: '2026-03-31',
      transactionCount: 3,
      adjustmentTransactionId: null,
    });
    const cleared = rows.filter((r) => r.event_type === 'transactions.TransactionCleared');
    expect(cleared.map((r) => (r.envelope.payload as Json)['reconciliationId'])).toContain(session.id);
    const sessionEvent = cleared.find((r) => (r.envelope.payload as Json)['transactionId'] === g2.id);
    expect(sessionEvent?.envelope.payload).toMatchObject({ cleared: true, previousStatus: 'POSTED' });
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-007] [TC-TRANSACTIONS-RECONCILIATION-013] diferencia −5.00 sin ajuste ⇒ 422 con la extensión difference; versión obsoleta ⇒ 412; la sesión sigue en curso', async () => {
    const { owner, bank, g1 } = await bankScenario('difference');
    const session = (await startSession(owner, bank, '3345.00')).body as Session;
    const stale = await completeSession(owner, session.id, 7);
    expectProblem(stale, 412, 'PRECONDITION_FAILED');
    const rejected = await completeSession(owner, session.id, 1);
    expectProblem(rejected, 422, 'RECONCILIATION_DIFFERENCE_NOT_ZERO');
    expect(rejected.body['difference']).toEqual(money('-5.00'));
    expect((await get(owner, `/reconciliations/${session.id}`)).body['status']).toBe('IN_PROGRESS');
    expect((await get(owner, `/transactions/${g1.id}`)).body['status']).toBe('CLEARED');
    // Ajuste sin motivo ⇒ VALIDATION_FAILED y nada se crea.
    const entries = await entryCount(owner);
    expectProblem(
      await completeSession(owner, session.id, 1, { adjustment: { reason: '   ' } }),
      400,
      'VALIDATION_FAILED',
    );
    expect(await entryCount(owner)).toBe(entries);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-013] dos finalizaciones simultáneas de la misma sesión (SERIALIZABLE con reintento): una gana, la otra recibe 409/412 y nada se reconcilia dos veces', async () => {
    const { owner, bank, g1, i1 } = await bankScenario('race');
    const session = (await startSession(owner, bank)).body as Session;
    const replies = await Promise.all([
      completeSession(owner, session.id, 1),
      completeSession(owner, session.id, 1),
    ]);
    const won = replies.filter((r) => r.status === 200);
    const lost = replies.filter((r) => r.status !== 200);
    expect(won, JSON.stringify(replies.map((r) => [r.status, r.body['code']]))).toHaveLength(1);
    expect([
      [409, 'INVALID_STATUS_TRANSITION'],
      [409, 'CONCURRENCY_CONFLICT'],
      [412, 'PRECONDITION_FAILED'],
    ]).toContainEqual([lost[0]!.status, lost[0]!.body['code']]);
    const final = (await get(owner, `/reconciliations/${session.id}`)).body;
    expect(final).toMatchObject({ status: 'COMPLETED', version: 2 });
    expect((final['items'] as unknown[]).length).toBe(2);
    for (const t of [g1, i1]) {
      expect((await get(owner, `/transactions/${t.id}`)).body).toMatchObject({
        status: 'RECONCILED',
        version: 2,
      });
    }
    expect(eventCountOf(await outbox(owner), 'transactions.ReconciliationCompleted')).toBe(1);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-008] el ajuste de 5.00 BOB cuadra la diferencia: asiento balanceado contra el ajuste de patrimonio, saldo 3099.10, recorrido RECORD y RECONCILE', async () => {
    const { owner, bank, g1 } = await bankScenario('adjust');
    const session = (await startSession(owner, bank, '3345.00')).body as Session;
    const done = await completeSession(owner, session.id, 1, {
      adjustment: { reason: 'comisión bancaria no registrada' },
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({
      status: 'COMPLETED',
      clearedBalance: money('3345.00'),
      difference: money('0.00'),
    });
    const adjustmentId = done.body['adjustmentTransactionId'] as string;
    const adjustment = (await get(owner, `/transactions/${adjustmentId}`)).body;
    expect(adjustment).toMatchObject({
      kind: 'ADJUSTMENT',
      status: 'RECONCILED',
      reconciliationMode: 'STATEMENT',
      adjustmentDirection: 'DECREASE',
      adjustmentReason: 'comisión bancaria no registrada',
      transactionDate: '2026-03-31',
      amount: money('5.00'),
    });
    expect(await balanceOf(owner, bank)).toBe('3099.10');
    const adjustments = await asApp(owner, async (c) => {
      const { rows } = await c.query<{ balance: string }>(
        `SELECT (COALESCE(sum(p.amount), 0))::numeric(38,2)::text AS balance
           FROM ledger.posting p JOIN ledger.ledger_account la ON la.id = p.ledger_account_id
          WHERE la.system_kind = 'ADJUSTMENTS'`,
      );
      return rows[0]!.balance;
    });
    expect(adjustments).toBe('5.00');
    expect((await get(owner, `/transactions/${g1.id}`)).body['status']).toBe('RECONCILED');
    // [TC-AUDIT-LIFECYCLE-026] recorrido del ajuste y del gasto reconciliado en la sesión.
    const adjLife = await get(owner, `/transactions/${adjustmentId}/lifecycle`);
    expect(contract.validateResponse('getTransactionLifecycle', 200, adjLife.body)).toEqual([]);
    expect((adjLife.body['items'] as Json[]).map((i) => i['transition'])).toEqual(['RECORD', 'RECONCILE']);
    expect(adjLife.body['reconciliations']).toEqual([
      {
        reconciliationId: session.id,
        accountId: bank,
        statementDate: '2026-03-31',
        statementBalance: money('3345.00'),
      },
    ]);
    const g1Life = await get(owner, `/transactions/${g1.id}/lifecycle`);
    expect((g1Life.body['items'] as Json[]).map((i) => i['transition'])).toEqual(['RECORD', 'RECONCILE']);
    expect(((g1Life.body['items'] as Json[])[1]!['detailRefs'] as Json)['reconciliationId']).toBe(session.id);
    // [TC-AUDIT-LIFECYCLE-025] recorrido de la sesión y su máquina.
    const life = await get(owner, `/reconciliations/${session.id}/lifecycle`);
    expect(life.status, JSON.stringify(life.body)).toBe(200);
    expect(contract.validateResponse('getReconciliationLifecycle', 200, life.body)).toEqual([]);
    expect(life.body['aggregateType']).toBe('Reconciliation');
    expect((life.body['items'] as Json[]).map((i) => i['transition'])).toEqual(['START', 'COMPLETE']);
    expect(((life.body['items'] as Json[])[1]!['detailRefs'] as Json)['adjustmentTransactionId']).toBe(
      adjustmentId,
    );
    expect(life.body['reconciliation']).toMatchObject({
      statementBalance: money('3345.00'),
      difference: money('0.00'),
      adjustmentTransactionId: adjustmentId,
    });
    // Exportación CSV/PDF del recorrido como el resto de los agregados (docs/31 D52).
    const csv = await fetch(
      `${baseUrl}${W(owner)}/reconciliations/${session.id}/lifecycle/export?format=csv`,
      {
        headers: { authorization: `Bearer ${owner.token}` },
      },
    );
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-disposition')).toMatch(/attachment/);
    const csvText = await csv.text();
    expect(csvText).toContain('START');
    expect(csvText).toContain('COMPLETE');
    const pdf = await fetch(
      `${baseUrl}${W(owner)}/reconciliations/${session.id}/lifecycle/export?format=pdf`,
      {
        headers: { authorization: `Bearer ${owner.token}` },
      },
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toContain('application/pdf');
    const other = await call('GET', `${W(owner)}/reconciliations/${session.id}/lifecycle/export?format=csv`, {
      token: outsider.token,
    });
    expect([403, 404]).toContain(other.status);
    const machine = await get(owner, '/lifecycle-machines/Reconciliation');
    expect(machine.status).toBe(200);
    expect(
      (machine.body['states'] as { code: string; terminal: boolean }[]).map((s) => [s.code, s.terminal]),
    ).toEqual([
      ['IN_PROGRESS', false],
      ['COMPLETED', true],
      ['CANCELLED', true],
    ]);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-009] cancelar conserva el cleared de G2; una sesión completada no se cancela (409)', async () => {
    const { owner, bank, g2 } = await bankScenario('cancel');
    const session = (await startSession(owner, bank, '3304.10')).body as Session;
    await post(
      owner,
      `/reconciliations/${session.id}/cleared`,
      { items: [{ id: g2.id, version: g2.version }], cleared: true },
      { 'if-match': '"1"' },
    );
    const cancelled = await post(owner, `/reconciliations/${session.id}/cancel`, undefined, {
      'if-match': '"2"',
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body['status']).toBe('CANCELLED');
    expect((await get(owner, `/transactions/${g2.id}`)).body['status']).toBe('CLEARED');
    expectProblem(await completeSession(owner, session.id, 3), 409, 'INVALID_STATUS_TRANSITION');
    const second = (await startSession(owner, bank, '3304.10')).body as Session;
    const done = await completeSession(owner, second.id, 1);
    expect(done.status).toBe(200);
    expectProblem(
      await post(owner, `/reconciliations/${second.id}/cancel`, undefined, { 'if-match': '"2"' }),
      409,
      'INVALID_STATUS_TRANSITION',
    );
  });
});

describe('Estado de reconciliación por cuenta', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-010] Bank A reconciliada al 2026-03-31 con G2 posted: última sesión, 1 sin reconciliar, no reconciliada al corte; VIEWER puede leerlo', async () => {
    const { owner, bank } = await bankScenario('status');
    const viewer = await addMember(owner, await user(`kc-rec-sviewer-${randomUUID()}`), 'VIEWER');
    const session = (await startSession(owner, bank)).body as Session;
    expect((await completeSession(owner, session.id, 1)).status).toBe(200);
    const status = await get(viewer, `/accounts/${bank}/reconciliation-status?asOf=2026-03-31`);
    expect(status.status, JSON.stringify(status.body)).toBe(200);
    expect(contract.validateResponse('getReconciliationStatus', 200, status.body)).toEqual([]);
    expect(status.body).toMatchObject({
      accountId: bank,
      lastCompleted: {
        reconciliationId: session.id,
        statementDate: '2026-03-31',
        statementBalance: money('3350.00'),
      },
      inProgressReconciliationId: null,
      unreconciledPostedCountThrough: 1,
      reconciledWithoutStatementCount: 0,
      reconciledThrough: false,
      reconciliationBasis: null,
    });
    expectProblem(await get(outsider, `/accounts/${bank}/reconciliation-status`), 404, 'RESOURCE_NOT_FOUND');
  });
});

describe('Periodos cerrados (INV-015, docs/33 D65)', () => {
  const closeMarch = (u: User) =>
    asApp(
      u,
      (c) =>
        c.query(
          `INSERT INTO ledger.period_lock (workspace_id, year_month, period_start, period_end) VALUES ($1, '2026-03', '2026-03-01', '2026-03-31')`,
          [u.ws],
        ),
      true,
    );

  it('[TC-TRANSACTIONS-RECONCILIATION-012] finalizar con un gasto cleared de un mes cerrado ⇒ 409 PERIOD_CLOSED por transacción y nada se reconcilia', async () => {
    const owner = await user(`kc-rec-closed-${randomUUID()}`);
    const bank = await account(owner, 'Bank A', '1000.00');
    const march = await movement(owner, bank, 'EXPENSE', '80.00', '2026-03-28', 'CLEARED', 'marzo');
    const posted = await movement(owner, bank, 'EXPENSE', '10.00', '2026-03-05', 'POSTED', 'posted marzo');
    await closeMarch(owner);
    const session = (await startSession(owner, bank, '920.00', '2026-04-04')).body as Session;
    const rejected = await completeSession(owner, session.id, 1);
    expectProblem(rejected, 409, 'PERIOD_CLOSED');
    expect((rejected.body['errors'] as { pointer: string }[]).map((e) => e.pointer)).toEqual([
      `/transactions/${march.id}`,
    ]);
    expect((await get(owner, `/reconciliations/${session.id}`)).body['status']).toBe('IN_PROGRESS');
    expect((await get(owner, `/transactions/${march.id}`)).body['status']).toBe('CLEARED');
    // Confirmar y des-reconciliar en el mes cerrado también se rechazan.
    const toggled = await post(
      owner,
      `/reconciliations/${session.id}/cleared`,
      { items: [{ id: posted.id, version: posted.version }], cleared: true },
      { 'if-match': '"1"' },
    );
    expectProblem(toggled, 409, 'PERIOD_CLOSED');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-021] [TC-TRANSACTIONS-RECONCILIATION-022] conciliar sin extracto en un mes cerrado ⇒ 409; el cotejo omite las de un mes cerrado sin impedir la sesión', async () => {
    const owner = await user(`kc-rec-closed2-${randomUUID()}`);
    const bank = await account(owner, 'Bank A', '1000.00');
    const cash = await account(owner, 'Caja BOB', '500.00', 'CASH');
    const cashExpense = await movement(owner, cash, 'EXPENSE', '80.00', '2026-03-12', 'CLEARED', 'efectivo');
    const bankExpense = await movement(owner, bank, 'EXPENSE', '30.00', '2026-03-28', 'CLEARED', 'banco');
    // El gasto del banco se concilia sin extracto ANTES del cierre.
    const reconciled = await patch(
      owner,
      `/transactions/${bankExpense.id}`,
      { status: 'RECONCILED', reconciliationMode: 'WITHOUT_STATEMENT' },
      bankExpense.version,
    );
    expect(reconciled.status, JSON.stringify(reconciled.body)).toBe(200);
    await closeMarch(owner);
    const rejected = await patch(
      owner,
      `/transactions/${cashExpense.id}`,
      { status: 'RECONCILED', reconciliationMode: 'WITHOUT_STATEMENT' },
      cashExpense.version,
    );
    expectProblem(rejected, 409, 'PERIOD_CLOSED');
    const after = (await get(owner, `/transactions/${cashExpense.id}`)).body;
    expect(after).toMatchObject({ status: 'CLEARED', reconciliationMode: null, systemFlags: [] });
    const session = (await startSession(owner, bank, '970.00', '2026-04-04')).body as Session;
    const done = await completeSession(owner, session.id, 1);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await get(owner, `/transactions/${bankExpense.id}`)).body).toMatchObject({
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
      systemFlags: ['RECONCILED_WITHOUT_STATEMENT'],
    });
  });
});

describe('Conciliación sin extracto (docs/33 D74, D77, D111)', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-016] [TC-TRANSACTIONS-RECONCILIATION-017] conciliar sin extracto un gasto en efectivo: modo, marca y mismo saldo; sin modo ⇒ 400; sobre un posted ⇒ 409; systemFlags en el request ⇒ 400', async () => {
    const owner = await user(`kc-rec-cash-${randomUUID()}`);
    const cash = await account(owner, 'Caja BOB', '500.00', 'CASH');
    const spend = await movement(owner, cash, 'EXPENSE', '80.00', '2026-03-12', 'CLEARED', 'efectivo');
    const posted = await movement(owner, cash, 'EXPENSE', '45.90', '2026-03-20', 'POSTED', 'posted');
    expect(await balanceOf(owner, cash)).toBe('374.10');
    const entries = await entryCount(owner);
    // Sin el modo explícito ⇒ VALIDATION_FAILED y sigue cleared.
    const missing = await patch(owner, `/transactions/${spend.id}`, { status: 'RECONCILED' }, spend.version);
    expectProblem(missing, 400, 'VALIDATION_FAILED');
    expect((missing.body['errors'] as { pointer: string }[])[0]?.pointer).toBe('/reconciliationMode');
    expectProblem(
      await patch(
        owner,
        `/transactions/${spend.id}`,
        { status: 'RECONCILED', reconciliationMode: 'STATEMENT' },
        spend.version,
      ),
      400,
      'VALIDATION_FAILED',
    );
    expectProblem(
      await patch(owner, `/transactions/${spend.id}`, { systemFlags: [] }, spend.version),
      400,
      'VALIDATION_FAILED',
    );
    expectProblem(
      await patch(
        owner,
        `/transactions/${posted.id}`,
        { status: 'RECONCILED', reconciliationMode: 'WITHOUT_STATEMENT' },
        posted.version,
      ),
      409,
      'INVALID_STATUS_TRANSITION',
    );
    expect((await get(owner, `/transactions/${spend.id}`)).body['status']).toBe('CLEARED');
    const ok = await patch(
      owner,
      `/transactions/${spend.id}`,
      { status: 'RECONCILED', reconciliationMode: 'WITHOUT_STATEMENT' },
      spend.version,
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(contract.validateResponse('updateTransaction', 200, ok.body)).toEqual([]);
    expect(ok.body).toMatchObject({
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
      systemFlags: ['RECONCILED_WITHOUT_STATEMENT'],
    });
    expect(await entryCount(owner)).toBe(entries);
    expect(await balanceOf(owner, cash)).toBe('374.10');
    // Auditoría y recorrido: acción y transición propias.
    const history = await get(owner, `/transactions/${spend.id}/history`);
    const last = (
      history.body['data'] as { action: string; changes: { field: string; after: unknown }[] }[]
    ).at(-1)!;
    expect(last.action).toBe('transactions.transaction.reconciled_without_statement');
    expect(last.changes.find((c) => c.field === 'reconciliationMode')?.after).toBe('WITHOUT_STATEMENT');
    const life = await get(owner, `/transactions/${spend.id}/lifecycle`);
    expect((life.body['items'] as Json[]).map((i) => i['transition'])).toEqual([
      'RECORD',
      'RECONCILE_WITHOUT_STATEMENT',
    ]);
    // [TC-AUDIT-LIFECYCLE-027] la máquina distingue las dos vías hacia reconciled.
    const machine = await get(owner, '/lifecycle-machines/Transaction');
    const transitions = machine.body['transitions'] as {
      code: string;
      from: string[];
      to: string[];
      guard: string;
    }[];
    expect(machine.body['machineVersion']).toBe(2);
    expect(transitions.find((t) => t.code === 'RECONCILE_WITHOUT_STATEMENT')).toMatchObject({
      from: ['CLEARED'],
      to: ['RECONCILED'],
    });
    expect(transitions.find((t) => t.code === 'RECONCILE')?.guard).not.toBe(
      transitions.find((t) => t.code === 'RECONCILE_WITHOUT_STATEMENT')?.guard,
    );
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-018] el filtro systemFlag devuelve solo la conciliada sin extracto de Caja BOB, no la reconciliada en sesión de Bank A', async () => {
    const { owner, bank } = await bankScenario('flag');
    const cash = await account(owner, 'Caja BOB', '500.00', 'CASH');
    const spend = await movement(owner, cash, 'EXPENSE', '80.00', '2026-03-12', 'CLEARED', 'efectivo');
    await patch(
      owner,
      `/transactions/${spend.id}`,
      { status: 'RECONCILED', reconciliationMode: 'WITHOUT_STATEMENT' },
      spend.version,
    );
    const session = (await startSession(owner, bank)).body as Session;
    expect((await completeSession(owner, session.id, 1)).status).toBe(200);
    const flagged = await get(owner, '/transactions?systemFlag=RECONCILED_WITHOUT_STATEMENT');
    expect(flagged.status, JSON.stringify(flagged.body)).toBe(200);
    expect(contract.validateResponse('listTransactions', 200, flagged.body)).toEqual([]);
    expect((flagged.body['data'] as { id: string }[]).map((t) => t.id)).toEqual([spend.id]);
    const byAccount = await get(
      owner,
      `/transactions?systemFlag=RECONCILED_WITHOUT_STATEMENT&accountId=${bank}`,
    );
    expect(byAccount.body['data']).toEqual([]);
    const reconciled = await get(owner, `/transactions?status=RECONCILED&accountId=${bank}`);
    expect(
      (reconciled.body['data'] as { systemFlags: string[] }[]).every((t) => t.systemFlags.length === 0),
    ).toBe(true);
    // [TC-TRANSACTIONS-RECONCILIATION-020] Caja BOB conciliada sin extracto cuenta como conciliada (base "sin extracto").
    const status = await get(
      owner,
      `/accounts/${cash}/reconciliation-status?from=2026-03-01&asOf=2026-03-31`,
    );
    expect(status.body).toMatchObject({
      lastCompleted: null,
      unreconciledPostedCountThrough: 0,
      unreconciledClearedCountThrough: 0,
      reconciledWithoutStatementCount: 1,
      reconciledThrough: true,
      reconciliationBasis: 'WITHOUT_STATEMENT',
    });
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-019] la sesión posterior coteja G2 (conciliada sin extracto): modo extracto, sin marca, sin cambios en el ledger y con la anotación de cotejo en su recorrido', async () => {
    const { owner, bank, g2 } = await bankScenario('verify');
    const cleared = await post(owner, '/transactions/mark-cleared', {
      items: [{ id: g2.id, version: g2.version }],
      cleared: true,
    });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    const g2Cleared = (cleared.body['data'] as { version: number }[])[0]!;
    const without = await patch(
      owner,
      `/transactions/${g2.id}`,
      { status: 'RECONCILED', reconciliationMode: 'WITHOUT_STATEMENT' },
      g2Cleared.version,
    );
    expect(without.status).toBe(200);
    const session = (await startSession(owner, bank, '3304.10')).body as Session;
    expect(session['difference']).toEqual(money('0.00'));
    const entries = await entryCount(owner);
    const done = await completeSession(owner, session.id, 1);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(await entryCount(owner)).toBe(entries);
    expect((await get(owner, `/transactions/${g2.id}`)).body).toMatchObject({
      status: 'RECONCILED',
      reconciliationMode: 'STATEMENT',
      systemFlags: [],
    });
    const items = done.body['items'] as { transactionId: string; verifiedWithoutStatement: boolean }[];
    expect(items.find((i) => i.transactionId === g2.id)?.verifiedWithoutStatement).toBe(true);
    const life = await get(owner, `/transactions/${g2.id}/lifecycle`);
    const timeline = life.body['items'] as Json[];
    expect(
      timeline.map((i) =>
        i['kind'] === 'TRANSITION' ? i['transition'] : (i['changedFields'] as string[])[0],
      ),
    ).toEqual(['RECORD', 'CLEAR', 'RECONCILE_WITHOUT_STATEMENT', 'RECONCILIATION_VERIFIED']);
    expect(timeline.at(-1)!['detailRefs']).toEqual({ reconciliationId: session.id });
    expect((life.body['reconciliations'] as Json[]).map((r) => r['reconciliationId'])).toEqual([session.id]);
    expect(contract.validateResponse('getTransactionLifecycle', 200, life.body)).toEqual([]);
  });
});

describe('Des-reconciliar tras completar', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-015] la sesión sigue COMPLETED, registra la des-reconciliación como anotación y el estado de la cuenta deja de contar la transacción', async () => {
    const { owner, bank, g1 } = await bankScenario('unreconcile');
    const session = (await startSession(owner, bank)).body as Session;
    expect((await completeSession(owner, session.id, 1)).status).toBe(200);
    const reconciled = (await get(owner, `/transactions/${g1.id}`)).body as { version: number };
    const un = await post(
      owner,
      `/transactions/${g1.id}/unreconcile`,
      { reason: 'duplicado en extracto' },
      {
        'if-match': `"${reconciled.version}"`,
      },
    );
    expect(un.status, JSON.stringify(un.body)).toBe(200);
    expect(un.body).toMatchObject({ status: 'CLEARED', reconciliationMode: null, systemFlags: [] });
    const after = (await get(owner, `/reconciliations/${session.id}`)).body;
    expect(after).toMatchObject({ status: 'COMPLETED', clearedBalance: money('3350.00') });
    const item = (
      after['items'] as {
        transactionId: string;
        unreconciledAt: string | null;
        unreconcileReason: string | null;
      }[]
    ).find((i) => i.transactionId === g1.id);
    expect(item?.unreconciledAt).not.toBeNull();
    expect(item?.unreconcileReason).toBe('duplicado en extracto');
    const life = await get(owner, `/reconciliations/${session.id}/lifecycle`);
    const annotation = (life.body['items'] as Json[]).find((i) => i['kind'] === 'ANNOTATION');
    expect(annotation).toMatchObject({
      changedFields: ['TRANSACTION_UNRECONCILED'],
      detailRefs: { transactionId: g1.id },
    });
    const status = await get(owner, `/accounts/${bank}/reconciliation-status?asOf=2026-03-31`);
    expect(status.body['unreconciledClearedCountThrough']).toBe(1);
    expect(status.body['reconciledThrough']).toBe(false);
  });
});
