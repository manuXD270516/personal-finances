import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createLifecycleBackfill, findLifecycleDivergences } from '@pf/audit/interface/audit.module';
import { ApiContract } from '@pf/platform/api';
import { EventConsumerRuntime, EventSubscriptions, type EventEnvelope } from '@pf/platform/events';
import type { JobQueue } from '@pf/platform/queue';
import { reportingDataVersionConsumer } from '@pf/reporting/interface/reporting.module';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool, type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx, sqlState } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Recorrido del ciclo de vida por HTTP contra PostgreSQL real (openspec add-lifecycle-timeline, tareas 3.x, 4.x, 5.1):
// transición escrita en la misma transacción que el cambio, su auditoría y su outbox; inmutable (grants + PF003);
// consulta por agregado con contrato, roles (VIEWER, D28) y aislamiento; TransferRevised; reconstrucción y
// chequeo de consistencia.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';

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
let failLifecycle = false;
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
  return {
    status: res.status,
    headers: res.headers,
    body: text ? (JSON.parse(text) as Json) : {},
  };
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

/** Consulta como `pf_app` con el contexto RLS del workspace (rollback). */
async function asApp<T>(u: User, fn: (c: Client) => Promise<T>): Promise<T> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, () => fn(app));
  } finally {
    await app.end();
  }
}

/** Saldo contable (Σ postings) de una cuenta, sin ceros finales. */
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

async function outbox(u: User, aggregateId: string) {
  const worker = await connect(deps.workerDatabaseUrl);
  try {
    const { rows } = await worker.query<{ event_type: string; envelope: EventEnvelope }>(
      'SELECT event_type, envelope FROM platform.outbox WHERE workspace_id = $1 AND aggregate_id = $2 ORDER BY sequence',
      [u.ws, aggregateId],
    );
    return rows;
  } finally {
    await worker.end();
  }
}

const transitions = (body: Json) =>
  (body['items'] as Json[])
    .filter((i) => i['kind'] === 'TRANSITION')
    .map((i) => [i['transition'], i['fromState'], i['toState']]);

const apiLog = capturingLogger('finance-api', 'api');
let editor: User;
let viewer: User;
let outsider: User;
let bankA: string;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(apiConfig(baseEnv(deps)), apiLog.logger, {
    clock,
    identity: {
      jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
      // TC-AUDIT-LIFECYCLE-002: el adapter real, o un fallo a demanda al escribir la transición.
      lifecycle: (port) => ({
        record: async (entry, steps) => {
          if (failLifecycle && steps.length > 0) {
            await port.record(entry, []);
            throw new Error('lifecycle store unavailable (fault injected)');
          }
          await port.record(entry, steps);
        },
      }),
    },
  });
  baseUrl = await runtime.listen(0, '127.0.0.1');
  editor = await user(`kc-lc-editor-${randomUUID()}`);
  outsider = await user(`kc-lc-outsider-${randomUUID()}`);
  const v = await user(`kc-lc-viewer-${randomUUID()}`);
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

describe('Máquinas de estado (GET W/lifecycle-machines/{aggregateType})', () => {
  it('[TC-AUDIT-LIFECYCLE-001] la máquina Transaction declara estados, terminal y 9 transiciones; reconciliar un pendiente ⇒ 409 sin transición', async () => {
    const r = await get(viewer, '/lifecycle-machines/Transaction');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(contract().validateResponse('getLifecycleMachine', 200, r.body)).toEqual([]);
    expect((r.body['states'] as Json[]).filter((s) => s['terminal']).map((s) => s['code'])).toEqual([
      'VOIDED',
    ]);
    expect((r.body['transitions'] as Json[]).map((t) => t['code'])).toEqual([
      'RECORD',
      'POST',
      'CLEAR',
      'UNCLEAR',
      'RECONCILE',
      'RECONCILE_WITHOUT_STATEMENT',
      'UNRECONCILE',
      'REVISE',
      'VOID',
    ]);
    for (const type of ['Account', 'ExchangeRate']) {
      const m = await get(viewer, `/lifecycle-machines/${type}`);
      expect(m.body['aggregateType']).toBe(type);
    }
    expect((await get(viewer, '/lifecycle-machines/Budget')).status).toBe(400);

    const pending = await expense(editor, bankA, '80.00', 'PENDING');
    const rejected = await patch(editor, `/transactions/${pending.id}`, pending.version, {
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
    });
    expectProblem(rejected, 409, 'INVALID_STATUS_TRANSITION');
    const lc = await get(editor, `/transactions/${pending.id}/lifecycle`);
    expect(transitions(lc.body)).toEqual([['RECORD', null, 'PENDING']]);
  });
});

describe('Registro de transición atómico (audit.lifecycle_transition)', () => {
  it('[TC-AUDIT-LIFECYCLE-002] postear 75.00 BOB deja asiento, auditoría, evento y transición POST que referencia asiento y auditLogId; con fallo inyectado nada persiste', async () => {
    const ok = await expense(editor, bankA, '75.00', 'PENDING');
    const posted = await post(editor, `/transactions/${ok.id}/post`, undefined, ok.version);
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    const rows = await asApp(
      editor,
      async (c) =>
        (
          await c.query<{
            transition: string;
            from_state: string;
            to_state: string;
            posted: string;
            audit_action: string | null;
            events: string[];
          }>(
            `SELECT t.transition, t.from_state, t.to_state, t.journal_entries->>'posted' AS posted,
                  (SELECT a.action FROM audit.audit_log a WHERE a.id = t.audit_log_id) AS audit_action,
                  t.event_types AS events
             FROM audit.lifecycle_transition t
            WHERE t.aggregate_id = $1 ORDER BY t.sequence`,
            [ok.id],
          )
        ).rows,
    );
    expect(rows.map((r) => [r.transition, r.from_state, r.to_state])).toEqual([
      ['RECORD', null, 'PENDING'],
      ['POST', 'PENDING', 'POSTED'],
    ]);
    expect(rows[1]).toMatchObject({
      posted: posted.body['activeJournalEntryId'],
      audit_action: 'transactions.transaction.posted',
      events: ['transactions.TransactionPosted.v1'],
    });
    const events = await outbox(editor, ok.id);
    const postedEvent = events.find((e) => e.event_type === 'transactions.TransactionPosted');
    expect(postedEvent?.envelope.payload).toMatchObject({ transition: 'POST' });
    expect(eventSchemaRegistry().validate(postedEvent!.envelope)).toBeUndefined();

    // Segunda corrida: la escritura de la transición falla ⇒ el comando entero hace rollback.
    const pending = await expense(editor, bankA, '75.00', 'PENDING');
    const balance = await balanceOf(editor, bankA);
    const outboxBefore = (await outbox(editor, pending.id)).length;
    failLifecycle = true;
    try {
      const failed = await post(editor, `/transactions/${pending.id}/post`, undefined, pending.version);
      expectProblem(failed, 500, 'INTERNAL_ERROR');
    } finally {
      failLifecycle = false;
    }
    const after = await get(editor, `/transactions/${pending.id}`);
    expect([after.body['status'], after.body['activeJournalEntryId']]).toEqual(['PENDING', null]);
    expect(await balanceOf(editor, bankA)).toBe(balance);
    expect(await outbox(editor, pending.id)).toHaveLength(outboxBefore);
    const audits = await asApp(editor, async (c) =>
      (
        await c.query<{ action: string }>('SELECT action FROM audit.audit_log WHERE aggregate_id = $1', [
          pending.id,
        ])
      ).rows.map((r) => r.action),
    );
    expect(audits).toEqual(['transactions.transaction.created']);
  });

  it('[TC-AUDIT-LIFECYCLE-012] UPDATE, DELETE y TRUNCATE sobre una transición fallan para pf_app y pf_worker y la fila queda igual', async () => {
    const tx = await expense(editor, bankA, '10.00');
    const statements = [
      `UPDATE audit.lifecycle_transition SET reason = 'x' WHERE aggregate_id = $1`,
      `DELETE FROM audit.lifecycle_transition WHERE aggregate_id = $1`,
      `TRUNCATE audit.lifecycle_transition`,
    ];
    for (const url of [deps.databaseUrl, deps.workerDatabaseUrl]) {
      const client = await connect(url);
      try {
        for (const sql of statements) {
          const state = await sqlState(() =>
            inTx(client, { userId: editor.id, workspaceId: editor.ws }, () =>
              client.query(sql, sql.includes('$1') ? [tx.id] : []),
            ),
          );
          expect(
            ['42501', 'PF003'],
            `${sql} (${url === deps.databaseUrl ? 'pf_app' : 'pf_worker'})`,
          ).toContain(state);
        }
      } finally {
        await client.end();
      }
    }
    // Ni el owner puede: el trigger de sentencia platform.forbid_mutation() responde PF003 (la RLS forzada ya le
    // oculta las filas para UPDATE/DELETE).
    const migrator = await connect(deps.migratorUrl);
    try {
      expect(await sqlState(() => migrator.query('TRUNCATE audit.lifecycle_transition'))).toBe('PF003');
    } finally {
      await migrator.end();
    }
    const lc = await get(editor, `/transactions/${tx.id}/lifecycle`);
    expect(transitions(lc.body)).toEqual([['RECORD', null, 'POSTED']]);
  });
});

describe('Consulta del recorrido (GET …/lifecycle)', () => {
  let tx: { id: string; version: number };
  let revisedBy: string;

  it('[TC-AUDIT-LIFECYCLE-005] pendiente 80.00 → postear → cleared → corregir a 85.00 → anular ("duplicado"): 5 transiciones, camino y saldo final', async () => {
    const bank = await account(editor, `Bank L ${randomUUID().slice(0, 6)}`, '1000.00');
    const step = () => clock.advance(60 * 60 * 1000);
    tx = await expense(editor, bank, '80.00', 'PENDING');
    step();
    let r = await post(editor, `/transactions/${tx.id}/post`, undefined, tx.version);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    step();
    r = await post(editor, '/transactions/mark-cleared', {
      items: [{ id: tx.id, version: r.body['version'] }],
      cleared: true,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
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

    const lc = await get(editor, `/transactions/${tx.id}/lifecycle`);
    expect(lc.status, JSON.stringify(lc.body)).toBe(200);
    expect(contract().validateResponse('getTransactionLifecycle', 200, lc.body)).toEqual([]);
    expect(transitions(lc.body)).toEqual([
      ['RECORD', null, 'PENDING'],
      ['POST', 'PENDING', 'POSTED'],
      ['CLEAR', 'POSTED', 'CLEARED'],
      ['REVISE', 'CLEARED', 'POSTED'],
      ['VOID', 'POSTED', 'VOIDED'],
    ]);
    expect(lc.body).toMatchObject({
      aggregateType: 'Transaction',
      currentState: 'VOIDED',
      path: ['PENDING', 'POSTED', 'CLEARED', 'POSTED', 'VOIDED'],
      historyComplete: true,
      machine: { aggregateType: 'Transaction', machineVersion: 2 },
    });
    const items = lc.body['items'] as Json[];
    expect(items.map((i) => i['occurredAt'])).toEqual([
      '2026-03-10T14:00:00.000Z',
      '2026-03-10T15:00:00.000Z',
      '2026-03-10T16:00:00.000Z',
      '2026-03-10T17:00:00.000Z',
      '2026-03-10T18:00:00.000Z',
    ]);
    expect(items[3]).toMatchObject({ revisionFrom: 1, revisionTo: 2 });
    expect(items[4]).toMatchObject({ reason: 'duplicado' });
    for (const i of items) {
      expect(i['actor']).toMatchObject({ type: 'USER', id: editor.id });
      expect(i['auditLogId']).toEqual(expect.any(String));
      expect(i['origin']).toBe('api');
    }
    expect((lc.body['revisions'] as Json[]).map((x) => [x['revision'], x['amount']])).toEqual([
      [1, { amount: '80.00', currency: 'BOB' }],
      [2, { amount: '85.00', currency: 'BOB' }],
    ]);
    expect(await balanceOf(editor, bank)).toBe('1000.00');
    revisedBy = editor.id;
  });

  it('[TC-AUDIT-LIFECYCLE-006] un VIEWER ve el recorrido con la revisión y su actor; un usuario de otro workspace recibe el mismo 404 que un id inexistente', async () => {
    const lc = await get(viewer, `/transactions/${tx.id}/lifecycle`);
    expect(lc.status).toBe(200);
    const revise = (lc.body['items'] as Json[]).find((i) => i['transition'] === 'REVISE');
    expect(revise).toMatchObject({ actor: { type: 'USER', id: revisedBy }, occurredAt: expect.any(String) });
    const foreign = await call('GET', `${W(editor)}/transactions/${tx.id}/lifecycle`, {
      token: outsider.token,
    });
    const missing = await call('GET', `${W(editor)}/transactions/${randomUUID()}/lifecycle`, {
      token: outsider.token,
    });
    expect(foreign.status).toBe(missing.status);
    expect([403, 404]).toContain(foreign.status);
    const strip = (b: Json) => ({ ...b, instance: null, requestId: null, traceId: null });
    expect(strip(foreign.body)).toEqual(strip(missing.body));
    const ownMissing = await get(outsider, `/transactions/${tx.id}/lifecycle`);
    expectProblem(ownMissing, 404, 'RESOURCE_NOT_FOUND');
    const neverExisted = await get(outsider, `/transactions/${randomUUID()}/lifecycle`);
    expect({ ...ownMissing.body, detail: null, instance: null, traceId: null, requestId: null }).toEqual({
      ...neverExisted.body,
      detail: null,
      instance: null,
      traceId: null,
      requestId: null,
    });
  });
});

describe('Transferencias: TransferCompleted una sola vez y TransferRevised (docs/31 D37)', () => {
  it('[TC-AUDIT-LIFECYCLE-007] [TC-TRANSACTIONS-TRANSFER-009] 300.00 → 250.00 BOB: recorrido RECORD/REVISE, un TransferCompleted, un TransferRevised y el consumidor lo aplica una sola vez', async () => {
    const a = await account(editor, `A ${randomUUID().slice(0, 6)}`, '1000.00');
    const b = await account(editor, `B ${randomUUID().slice(0, 6)}`, null);
    const t = await post(editor, '/transfers', {
      transactionDate: '2026-03-15',
      fromAccountId: a,
      toAccountId: b,
      amount: { amount: '300.00', currency: 'BOB' },
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const id = t.body['id'] as string;
    const r = await patch(editor, `/transactions/${id}`, t.body['version'] as number, {
      amount: { amount: '250.00', currency: 'BOB' },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect([await balanceOf(editor, a), await balanceOf(editor, b)]).toEqual(['750.00', '250.00']);

    const lc = await get(editor, `/transactions/${id}/lifecycle`);
    expect(contract().validateResponse('getTransactionLifecycle', 200, lc.body)).toEqual([]);
    const items = lc.body['items'] as Json[];
    expect(items.map((i) => [i['transition'], i['fromState'], i['toState'], i['revisionTo']])).toEqual([
      ['RECORD', null, 'POSTED', 1],
      ['REVISE', 'POSTED', 'POSTED', 2],
    ]);
    expect(items[0]?.['events']).toContain('transactions.TransferCompleted.v1');
    expect(items[1]?.['events']).toContain('transactions.TransferRevised.v1');
    expect((lc.body['revisions'] as Json[]).map((x) => [x['revision'], x['amount'], x['fee']])).toEqual([
      [1, { amount: '300.00', currency: 'BOB' }, null],
      [2, { amount: '250.00', currency: 'BOB' }, null],
    ]);

    const events = await outbox(editor, id);
    const completed = events.filter((e) => e.event_type === 'transactions.TransferCompleted');
    const revised = events.filter((e) => e.event_type === 'transactions.TransferRevised');
    expect(completed).toHaveLength(1);
    expect(revised).toHaveLength(1);
    for (const e of [...completed, ...revised])
      expect(eventSchemaRegistry().validate(e.envelope)).toBeUndefined();
    const firstEntry = (items[0]?.['journalEntries'] as Json)['posted'];
    expect(firstEntry).toEqual(expect.any(String));
    expect(revised[0]?.envelope.payload).toMatchObject({
      revisionFrom: 1,
      revisionTo: 2,
      amount: { amount: '250.00', currency: 'BOB' },
      reversedJournalEntryId: firstEntry,
      reversalJournalEntryId: (items[1]?.['journalEntries'] as Json)['reversal'],
      journalEntryId: (items[1]?.['journalEntries'] as Json)['posted'],
    });
    expect((items[1]?.['journalEntries'] as Json)['reversed']).toBe(firstEntry);

    // Reentrega: el consumidor reporting.data-version aplica TransferRevised una sola vez (platform.inbox).
    const workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
    try {
      const def = reportingDataVersionConsumer();
      expect(def.events).toContainEqual({ type: 'transactions.TransferRevised', version: 1 });
      const consumers = new EventConsumerRuntime({
        pool: workerPool,
        queue: {} as JobQueue,
        subscriptions: new EventSubscriptions([def]),
        logger: capturingLogger('finance-worker', 'worker').logger,
      });
      expect(await consumers.deliver(def, revised[0]!.envelope)).toBe('applied');
      expect(await consumers.deliver(def, revised[0]!.envelope)).toBe('duplicate');
    } finally {
      await workerPool.end();
    }
  });
});

describe('Recorrido de cuentas y tasas', () => {
  it('[TC-AUDIT-LIFECYCLE-009] Bank C: abrir con 500.00 BOB, archivar ("sin uso"), reactivar, transferir el saldo y cerrar el 2026-03-31', async () => {
    const c = await account(editor, `Bank C ${randomUUID().slice(0, 6)}`, '500.00');
    let r = await post(editor, `/accounts/${c}/archive`, { reason: 'sin uso' }, 1);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    r = await post(editor, `/accounts/${c}/reactivate`, undefined, 2);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const t = await post(editor, '/transfers', {
      transactionDate: '2026-03-10', // «hoy» del FixedClock: el cierre valida el saldo a la fecha
      fromAccountId: c,
      toAccountId: bankA,
      amount: { amount: '500.00', currency: 'BOB' },
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(await balanceOf(editor, c)).toBe('0.00');
    r = await post(editor, `/accounts/${c}/close`, { closedOn: '2026-03-31' }, 3);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const lc = await get(viewer, `/accounts/${c}/lifecycle`);
    expect(lc.status, JSON.stringify(lc.body)).toBe(200);
    expect(contract().validateResponse('getAccountLifecycle', 200, lc.body)).toEqual([]);
    expect(transitions(lc.body)).toEqual([
      ['OPEN', null, 'ACTIVE'],
      ['ARCHIVE', 'ACTIVE', 'ARCHIVED'],
      ['REACTIVATE', 'ARCHIVED', 'ACTIVE'],
      ['CLOSE', 'ACTIVE', 'CLOSED'],
    ]);
    const items = lc.body['items'] as Json[];
    expect((items[0]?.['journalEntries'] as Json)['posted']).toEqual(expect.any(String));
    expect(items[1]).toMatchObject({ reason: 'sin uso' });
    expect(lc.body['currentState']).toBe('CLOSED');
  });

  it('[TC-AUDIT-LIFECYCLE-010] USDT/BOB P2P 6.95 corregida a 6.96: RECORD y SUPERSEDE enlazada a la nueva; la original no cambia', async () => {
    const r1 = await post(editor, '/fx-rates', {
      base: 'USDT',
      quote: 'BOB',
      value: '6.95',
      rateType: 'P2P',
      asOf: '2026-03-15T16:00:00Z',
    });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    const r2 = await post(editor, `/fx-rates/${String(r1.body['id'])}/supersede`, {
      value: '6.96',
      reason: 'error de tipeo',
    });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    const lc = await get(viewer, `/fx-rates/${String(r1.body['id'])}/lifecycle`);
    expect(lc.status, JSON.stringify(lc.body)).toBe(200);
    expect(contract().validateResponse('getRateLifecycle', 200, lc.body)).toEqual([]);
    expect(transitions(lc.body)).toEqual([
      ['RECORD', null, 'RECORDED'],
      ['SUPERSEDE', 'RECORDED', 'SUPERSEDED'],
    ]);
    expect((lc.body['items'] as Json[])[1]).toMatchObject({
      detailRefs: { supersededByRateId: r2.body['id'] },
    });
    expect((await get(viewer, `/fx-rates/${String(r1.body['id'])}`)).body['value']).toBe('6.95');
  });
});

describe('Reconstrucción desde la auditoría y consistencia (worker)', () => {
  it('[TC-AUDIT-LIFECYCLE-011] un gasto de 60.00 BOB con auditoría de creación y anulación se reconstruye con transiciones derivadas; sin creación no se inventa; idempotente', async () => {
    const g1 = randomUUID();
    const g2 = randomUUID();
    const audit = (
      id: string,
      aggregateId: string,
      action: string,
      at: string,
      changes: unknown[],
      reason?: string,
    ) =>
      asAppCommit(editor, (c) =>
        c.query(
          `INSERT INTO audit.audit_log (id, occurred_at, workspace_id, actor_type, actor_user_id, action, aggregate_type,
                                        aggregate_id, aggregate_version, changes, reason, origin, correlation_id)
           VALUES ($1, $2, $3, 'USER', $4, $5, 'Transaction', $6, 1, $7::jsonb, $8, 'ui', $1)`,
          [id, at, editor.ws, editor.id, action, aggregateId, JSON.stringify(changes), reason ?? null],
        ),
      );
    const e1 = randomUUID();
    const e2 = randomUUID();
    await audit(randomUUID(), g1, 'transactions.transaction.created', '2026-01-05T12:00:00Z', [
      { field: 'status', before: null, after: 'POSTED' },
      { field: 'amount', before: null, after: { amount: '60.00', currency: 'BOB' } },
      { field: 'journalEntryId', before: null, after: e1 },
    ]);
    await audit(
      randomUUID(),
      g1,
      'transactions.transaction.voided',
      '2026-01-06T12:00:00Z',
      [
        { field: 'status', before: 'POSTED', after: 'VOIDED' },
        { field: 'journalEntryId', before: e1, after: e2 },
      ],
      'duplicado',
    );
    await audit(randomUUID(), g2, 'transactions.transaction.updated', '2026-01-07T12:00:00Z', [
      { field: 'description', before: 'a', after: 'b' },
    ]);
    const workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
    try {
      const job = createLifecycleBackfill(workerPool);
      const first = await job.run(editor.ws);
      expect(first.derived).toBeGreaterThanOrEqual(3);
      expect(await job.run(editor.ws)).toEqual({ aggregates: 0, derived: 0 });
      const rows = (id: string) =>
        asApp(
          editor,
          async (c) =>
            (
              await c.query<{
                kind: string;
                transition: string | null;
                from_state: string | null;
                to_state: string | null;
                derived: boolean;
              }>(
                `SELECT kind, transition, from_state, to_state, derived FROM audit.lifecycle_transition
                WHERE aggregate_id = $1 ORDER BY occurred_at, sequence`,
                [id],
              )
            ).rows,
        );
      expect(await rows(g1)).toEqual([
        { kind: 'TRANSITION', transition: 'RECORD', from_state: null, to_state: 'POSTED', derived: true },
        { kind: 'TRANSITION', transition: 'VOID', from_state: 'POSTED', to_state: 'VOIDED', derived: true },
      ]);
      expect(await rows(g2)).toEqual([
        { kind: 'ANNOTATION', transition: null, from_state: null, to_state: null, derived: true },
      ]);
      // Consistencia (decisión 6): los agregados reales del workspace coinciden con su última transición.
      expect(await findLifecycleDivergences(workerPool, editor.ws)).toEqual([]);
    } finally {
      await workerPool.end();
    }
  });

  it('[TC-AUDIT-LIFECYCLE-002] el chequeo de consistencia detecta un agregado cuyo estado difiere de su última transición', async () => {
    const tx = await expense(editor, bankA, '5.00');
    await asAppCommit(editor, (c) =>
      c.query(
        `INSERT INTO audit.lifecycle_transition (id, workspace_id, aggregate_type, aggregate_id, sequence, kind,
                                                 transition, from_state, to_state, machine_version, occurred_at,
                                                 actor_type, actor_id, origin, correlation_id)
         VALUES ($1, $2, 'Transaction', $3, 99, 'TRANSITION', 'VOID', 'POSTED', 'VOIDED', 1, '2026-12-31T00:00:00Z',
                 'USER', $4, 'api', $1)`,
        [randomUUID(), editor.ws, tx.id, editor.id],
      ),
    );
    const workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 2 });
    try {
      expect(await findLifecycleDivergences(workerPool, editor.ws)).toEqual([
        {
          workspaceId: editor.ws,
          aggregateType: 'Transaction',
          aggregateId: tx.id,
          recordedState: 'VOIDED',
          actualState: 'POSTED',
        },
      ]);
    } finally {
      await workerPool.end();
    }
  });
});

/** Escribe como `pf_app` con el contexto RLS del workspace (COMMIT). */
async function asAppCommit<T>(u: User, fn: (c: Client) => Promise<T>): Promise<T> {
  const app = await connect(deps.databaseUrl);
  try {
    return await inTx(app, { userId: u.id, workspaceId: u.ws }, () => fn(app), true);
  } finally {
    await app.end();
  }
}
