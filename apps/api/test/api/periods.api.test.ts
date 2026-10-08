import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import {
  identityWorkspaceCalendarDirectory,
  identityWorkspaceTimeZones,
} from '@pf/identity/interface/identity.module';
import { ledgerActivityRange } from '@pf/ledger/interface/ledger.module';
import {
  createPlanningRuntime,
  planningEventConsumers,
  runEnsurePeriods,
  type PlanningRuntime,
} from '@pf/planning/interface/planning.module';
import { ApiContract } from '@pf/platform/api';
import {
  EventConsumerRuntime,
  EventSubscriptions,
  PgOutboxWriter,
  type EventConsumerDefinition,
  type EventEnvelope,
} from '@pf/platform/events';
import type { JobQueue } from '@pf/platform/queue';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { AUDIT_POLICIES, outboxPort } from '../../src/identity/identity-wiring.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Periodos financieros por HTTP y por el worker contra PostgreSQL real (openspec add-financial-periods, tareas 4.4,
// 5.1–5.3): consultas (VIEWER), creación anticipada y activación manual (EDITOR, If-Match), roles, respuestas validadas
// contra el OpenAPI, y los consumidores/job del worker (pf_worker) con auditoría, recorrido y outbox en la misma
// transacción y el proceso de periodos como actor.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const contract = ApiContract.fromFile(resolveContractPath());
const clock = new FixedClock(Instant.parse('2026-10-05T14:00:00Z'));
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
interface Period {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  pendingClosure: boolean;
  isTransition: boolean;
  version: number;
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
const W = (u: User, ws = u.ws) => `/api/v1/workspaces/${ws}`;

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

const periodsOf = async (u: User, query = '', ws = u.ws) => {
  const r = await call('GET', `${W(u, ws)}/periods${query}`, { token: u.token });
  expect(r.status, `${JSON.stringify(r.body)} ${apiErrors()}`).toBe(200);
  expect(contract.validateResponse('listPeriods', 200, r.body)).toEqual([]);
  return r.body['data'] as Period[];
};
const labelled = (ps: readonly Period[], label: string) => ps.find((p) => p.label === label)!;

async function outboxOf(ws: string, eventType: string) {
  const { rows } = await worker.query<{ envelope: EventEnvelope }>(
    'SELECT envelope FROM platform.outbox WHERE workspace_id = $1 AND event_type = $2 ORDER BY sequence',
    [ws, eventType],
  );
  return rows.map((r) => r.envelope);
}

async function auditOf(ws: string, actions: readonly string[]) {
  const client = await worker.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.workspace_id', $1, true)`,
      [ws],
    );
    const res = await client.query<{
      action: string;
      aggregate_id: string;
      actor_type: string;
      actor_process: string | null;
      changes: { field: string; before: unknown; after: unknown }[];
    }>(
      `SELECT action, aggregate_id::text, actor_type, actor_process, changes FROM audit.audit_log
        WHERE action = ANY ($1::text[]) ORDER BY occurred_at, id`,
      [actions],
    );
    const steps = await client.query<{ aggregate_id: string; transition: string | null; kind: string }>(
      `SELECT aggregate_id::text, transition, kind FROM audit.lifecycle_transition
        WHERE aggregate_type = 'FinancialPeriod' ORDER BY occurred_at, sequence`,
    );
    await client.query('COMMIT');
    return { audits: res.rows, steps: steps.rows };
  } finally {
    client.release();
  }
}

const deliver = (consumer: string, envelope: EventEnvelope) =>
  consumers.deliver(definitions.get(consumer)!, envelope);

const syntheticEvent = (ws: string, eventType: string, payload: Record<string, unknown>): EventEnvelope => ({
  eventId: randomUUID(),
  eventType,
  eventVersion: 1,
  occurredAt: clock.now().toString(),
  workspaceId: ws,
  aggregateType: 'Workspace',
  aggregateId: ws,
  aggregateVersion: 2,
  correlationId: randomUUID(),
  causationId: null,
  actor: { type: 'SYSTEM', id: null },
  payload,
});

let owner: User;
let viewer: User;
let editor: User;
let outsider: User;

beforeAll(async () => {
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 4 });
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
  owner = await user(`kc-per-owner-${randomUUID()}`);
  viewer = await user(`kc-per-viewer-${randomUUID()}`);
  editor = await user(`kc-per-editor-${randomUUID()}`);
  outsider = await user(`kc-per-out-${randomUUID()}`);
  await join(owner, viewer, 'VIEWER');
  await join(owner, editor, 'EDITOR');

  // Composición del worker (pf_worker): misma que create-worker-runtime.
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
  });
  const defs = planningEventConsumers(planning);
  definitions = new Map(defs.map((d) => [d.consumer, d]));
  consumers = new EventConsumerRuntime({
    pool: worker,
    queue: {} as JobQueue,
    subscriptions: new EventSubscriptions(defs),
    logger: workerLog.logger,
  });
}, 180_000);

afterAll(async () => {
  await runtime?.close();
  await worker?.end();
});

describe('Worker: provisión asíncrona, job y consumidores (pf_worker)', () => {
  it('identity.WorkspaceCreated.v1 ⇒ periodos iniciales (docs/33 D64, asíncrono); la re-entrega es un duplicado', async () => {
    const created = (await outboxOf(owner.ws, 'identity.WorkspaceCreated'))[0]!;
    expect(created).toBeDefined();
    expect(await deliver('planning.workspace-created', created)).toBe('applied');
    expect(await deliver('planning.workspace-created', created)).toBe('duplicate');
    const ps = await periodsOf(owner);
    expect(ps.map((p) => `${p.label}:${p.status}`)).toEqual([
      '2027-01:DRAFT',
      '2026-12:DRAFT',
      '2026-11:DRAFT',
      '2026-10:ACTIVE',
    ]);
    const { audits } = await auditOf(owner.ws, ['planning.period.created']);
    expect(audits).toHaveLength(4);
    expect(
      audits.every((a) => a.actor_type === 'WORKER' && a.actor_process === 'planning.workspace-created'),
    ).toBe(true);
  });

  it('[TC-PLANNING-COVERAGE-001] (integración) el JournalEntryPosted de un saldo inicial del 2026-07-01 crea "2026-07".."2026-09" ACTIVE', async () => {
    const r = await call('POST', `${W(owner)}/accounts`, {
      token: owner.token,
      headers: { 'idempotency-key': randomUUID() },
      body: {
        name: 'Bank C',
        type: 'BANK',
        currency: 'BOB',
        openingBalance: { amount: { amount: '2500.00', currency: 'BOB' }, date: '2026-07-01' },
      },
    });
    expect(r.status, `${JSON.stringify(r.body)} ${apiErrors()}`).toBe(201);
    const posted = (await outboxOf(owner.ws, 'ledger.JournalEntryPosted')).at(-1)!;
    expect((posted.payload as { entryDate: string }).entryDate).toBe('2026-07-01');
    expect(await deliver('planning.journal-entry-posted', posted)).toBe('applied');
    const ps = await periodsOf(owner, '?status=ACTIVE');
    expect(ps.map((p) => `${p.label}:${String(p.pendingClosure)}`)).toEqual([
      '2026-10:false',
      '2026-09:true',
      '2026-08:true',
      '2026-07:true',
    ]);
    expect(labelled(ps, '2026-07')).toMatchObject({ periodStart: '2026-07-01', periodEnd: '2026-07-31' });
  });

  it('[TC-PLANNING-AUDIT-001] [TC-PLANNING-EVENT-001] (integración) el job activa "2026-11" a las 04:05Z con el proceso como actor, su transición y UN evento; la siguiente ejecución no escribe nada', async () => {
    const only = { list: async () => [{ workspaceId: owner.ws }] };
    clock.set(Instant.parse('2026-11-01T03:30:00Z'));
    await runEnsurePeriods(planning.service, only, workerLog.logger, 'cron');
    expect(labelled(await periodsOf(owner), '2026-11').status).toBe('DRAFT');

    clock.set(Instant.parse('2026-11-01T04:05:00Z'));
    await runEnsurePeriods(planning.service, only, workerLog.logger, 'cron');
    const nov = labelled(await periodsOf(owner), '2026-11');
    expect([nov.status, nov.version]).toEqual(['ACTIVE', 2]);
    const { audits, steps } = await auditOf(owner.ws, ['planning.period.activated']);
    expect(audits).toMatchObject([
      {
        aggregate_id: nov.id,
        actor_type: 'WORKER',
        actor_process: 'planning.ensure-periods:cron',
        changes: [
          { field: 'status', before: 'DRAFT', after: 'ACTIVE' },
          { field: 'activation', before: null, after: 'AUTOMATIC' },
        ],
      },
    ]);
    expect(steps.filter((s) => s.aggregate_id === nov.id).map((s) => s.transition)).toEqual([
      'CREATE',
      'ACTIVATE',
    ]);
    const events = await outboxOf(owner.ws, 'planning.PeriodActivated');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      aggregateType: 'FinancialPeriod',
      aggregateId: nov.id,
      payload: {
        label: '2026-11',
        periodStart: '2026-11-01',
        periodEnd: '2026-11-30',
        activation: 'AUTOMATIC',
      },
    });
    // El outbox valida el envelope y el payload contra contracts/events/planning/PeriodActivated.v1.schema.json.
    expect(() => eventSchemaRegistry().validate(events[0]!)).not.toThrow();

    await runEnsurePeriods(planning.service, only, workerLog.logger, 'cron');
    expect((await auditOf(owner.ws, ['planning.period.activated'])).audits).toHaveLength(1);
    expect(await outboxOf(owner.ws, 'planning.PeriodActivated')).toHaveLength(1);
    clock.set(Instant.parse('2026-10-05T14:00:00Z'));
  });

  it('[TC-PLANNING-FISCALDAY-001] (integración) WorkspaceSettingsChanged (día 1 → 25) recalcula los DRAFT conservando id y audita el rango anterior y el nuevo', async () => {
    const u = await user(`kc-per-fiscal-${randomUUID()}`);
    await deliver('planning.workspace-created', (await outboxOf(u.ws, 'identity.WorkspaceCreated'))[0]!);
    const before = await periodsOf(u);
    const patch = await call('PATCH', `${W(u)}`, {
      token: u.token,
      headers: { 'if-match': '"1"', 'content-type': 'application/merge-patch+json' },
      body: { fiscalMonthStartDay: 25 },
    });
    expect(patch.status, JSON.stringify(patch.body)).toBe(200);
    const changed = (await outboxOf(u.ws, 'identity.WorkspaceSettingsChanged')).at(-1)!;
    expect(await deliver('planning.settings-changed', changed)).toBe('applied');
    const after = await periodsOf(u);
    expect(after.map((p) => `${p.label}:${p.periodStart}..${p.periodEnd}:${String(p.isTransition)}`)).toEqual(
      [
        '2027-01:2027-01-25..2027-02-24:false',
        '2026-12:2026-12-25..2027-01-24:false',
        '2026-11:2026-11-01..2026-12-24:true',
        '2026-10:2026-10-01..2026-10-31:false',
      ],
    );
    for (const p of after) expect(p.id).toBe(labelled(before, p.label).id);
    const dec = labelled(after, '2026-12');
    const { audits } = await auditOf(u.ws, ['planning.period.rescheduled']);
    expect(audits.find((a) => a.aggregate_id === dec.id)?.changes).toEqual(
      expect.arrayContaining([
        { field: 'periodStart', before: '2026-12-01', after: '2026-12-25' },
        { field: 'periodEnd', before: '2026-12-31', after: '2027-01-24' },
      ]),
    );
    // Un cambio de otro campo (nombre) no dispara recálculos.
    const other = syntheticEvent(u.ws, 'identity.WorkspaceSettingsChanged', {
      workspaceId: u.ws,
      changes: [{ field: 'name', before: 'Personal', after: 'Casa' }],
    });
    expect(await deliver('planning.settings-changed', other)).toBe('applied');
    expect(await periodsOf(u)).toEqual(after);
  });
});

describe('API /periods (planning/financial-periods)', () => {
  it('[TC-PLANNING-AUTOCREATE-003] el EDITOR pide periodos hasta 2027-12-31 (idempotente); hasta 2029-01-01 ⇒ 400 VALIDATION_FAILED sin crear', async () => {
    const first = await call('POST', `${W(editor, owner.ws)}/periods`, {
      token: editor.token,
      body: { through: '2027-12-31' },
    });
    expect(first.status, `${JSON.stringify(first.body)} ${apiErrors()}`).toBe(200);
    expect(contract.validateResponse('ensurePeriods', 200, first.body)).toEqual([]);
    const data = first.body['data'] as Period[];
    expect(data[0]?.label).toBe('2026-10');
    expect(data.at(-1)?.label).toBe('2027-12');
    expect(data.filter((p) => p.label >= '2027-02').every((p) => p.status === 'DRAFT')).toBe(true);
    const count = (await periodsOf(owner, '?limit=100')).length;
    const again = await call('POST', `${W(editor, owner.ws)}/periods`, {
      token: editor.token,
      headers: { 'idempotency-key': randomUUID() },
      body: { through: '2027-12-31' },
    });
    expect(again.status).toBe(200);
    expect(await periodsOf(owner, '?limit=100')).toHaveLength(count);
    const tooFar = await call('POST', `${W(editor, owner.ws)}/periods`, {
      token: editor.token,
      body: { through: '2029-01-01' },
    });
    expect([tooFar.status, tooFar.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
    expect(await periodsOf(owner, '?limit=100')).toHaveLength(count);
  });

  it('[TC-PLANNING-ACTIVATION-002] con hoy 2026-12-01 en La Paz el EDITOR activa "2026-12" (If-Match) una vez; "2027-01" ⇒ 409 PERIOD_NOT_STARTED; sin If-Match 428, versión vieja 412', async () => {
    clock.set(Instant.parse('2026-12-01T10:00:00Z'));
    try {
      const ps = await periodsOf(owner, '?limit=100');
      const dec = labelled(ps, '2026-12');
      const jan = labelled(ps, '2027-01');
      expect(dec.status).toBe('DRAFT');
      const path = (p: Period) => `${W(editor, owner.ws)}/periods/${p.id}/activate`;
      expect((await call('POST', path(dec), { token: editor.token })).status).toBe(428);
      const stale = await call('POST', path(dec), { token: editor.token, headers: { 'if-match': '"9"' } });
      expect([stale.status, stale.body['code']]).toEqual([412, 'PRECONDITION_FAILED']);
      const ok = await call('POST', path(dec), {
        token: editor.token,
        headers: { 'if-match': `"${dec.version}"` },
      });
      expect(ok.status, `${JSON.stringify(ok.body)} ${apiErrors()}`).toBe(200);
      expect(contract.validateResponse('activatePeriod', 200, ok.body)).toEqual([]);
      expect(ok.body).toMatchObject({
        status: 'ACTIVE',
        version: dec.version + 1,
        activatedAt: '2026-12-01T10:00:00.000Z',
      });
      expect(ok.headers.get('etag')).toBe(`"${dec.version + 1}"`);
      const twice = await call('POST', path(dec), {
        token: editor.token,
        headers: { 'if-match': `"${dec.version + 1}"` },
      });
      expect([twice.status, twice.body['code']]).toEqual([409, 'INVALID_STATUS_TRANSITION']);
      const early = await call('POST', path(jan), {
        token: editor.token,
        headers: { 'if-match': `"${jan.version}"` },
      });
      expect([early.status, early.body['code']]).toEqual([409, 'PERIOD_NOT_STARTED']);
      expect(labelled(await periodsOf(owner, '?limit=100'), '2027-01').status).toBe('DRAFT');

      // El proceso posterior no lo modifica ni publica otro evento.
      await runEnsurePeriods(
        planning.service,
        { list: async () => [{ workspaceId: owner.ws }] },
        workerLog.logger,
        'cron',
      );
      expect(labelled(await periodsOf(owner, '?limit=100'), '2026-12').version).toBe(dec.version + 1);
      const events = (await outboxOf(owner.ws, 'planning.PeriodActivated')).filter(
        (e) => e.aggregateId === dec.id,
      );
      expect(events.map((e) => (e.payload as { activation: string }).activation)).toEqual(['MANUAL']);
      const { audits } = await auditOf(owner.ws, ['planning.period.activated']);
      expect(audits.find((a) => a.aggregate_id === dec.id)).toMatchObject({
        actor_type: 'USER',
        actor_process: null,
      });
    } finally {
      clock.set(Instant.parse('2026-10-05T14:00:00Z'));
    }
  });

  it('[TC-PLANNING-QUERY-001] un VIEWER obtiene el periodo de una fecha, los ACTIVE con su marca de pendiente de cierre y 404 para una fecha sin periodo', async () => {
    clock.set(Instant.parse('2026-11-03T12:00:00Z'));
    try {
      const oct = await periodsOf(viewer, '?containsDate=2026-10-31', owner.ws);
      expect(oct.map((p) => [p.label, p.periodStart, p.periodEnd, p.status])).toEqual([
        ['2026-10', '2026-10-01', '2026-10-31', 'ACTIVE'],
      ]);
      const active = await periodsOf(viewer, '?status=ACTIVE&limit=2', owner.ws);
      expect(active.map((p) => `${p.label}:${String(p.pendingClosure)}`)).toEqual([
        '2026-12:false',
        '2026-11:false',
      ]);
      const all = await periodsOf(viewer, '?status=ACTIVE', owner.ws);
      expect(labelled(all, '2026-10').pendingClosure).toBe(true);
      expect(labelled(all, '2026-11').pendingClosure).toBe(false);
      const none = await call('GET', `${W(viewer, owner.ws)}/periods?containsDate=2031-01-01`, {
        token: viewer.token,
      });
      expect([none.status, none.body['code']]).toEqual([404, 'RESOURCE_NOT_FOUND']);
      const both = await call('GET', `${W(viewer, owner.ws)}/periods?containsDate=2026-10-31&status=ACTIVE`, {
        token: viewer.token,
      });
      expect([both.status, both.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
      const one = await call('GET', `${W(viewer, owner.ws)}/periods/${oct[0]!.id}`, { token: viewer.token });
      expect(one.status).toBe(200);
      expect(contract.validateResponse('getPeriod', 200, one.body)).toEqual([]);
      const etag = one.headers.get('etag')!;
      const cached = await call('GET', `${W(viewer, owner.ws)}/periods/${oct[0]!.id}`, {
        token: viewer.token,
        headers: { 'if-none-match': etag },
      });
      expect(cached.status).toBe(304);
      const missing = await call('GET', `${W(viewer, owner.ws)}/periods/${randomUUID()}`, {
        token: viewer.token,
      });
      expect([missing.status, missing.body['code']]).toEqual([404, 'RESOURCE_NOT_FOUND']);
      // Paginación por cursor (orden por inicio descendente).
      const page = await call('GET', `${W(viewer, owner.ws)}/periods?limit=2`, { token: viewer.token });
      const cursor = (page.body['page'] as { nextCursor: string }).nextCursor;
      const next = await call(
        'GET',
        `${W(viewer, owner.ws)}/periods?limit=2&cursor=${encodeURIComponent(cursor)}`,
        {
          token: viewer.token,
        },
      );
      const labels = [...(page.body['data'] as Period[]), ...(next.body['data'] as Period[])].map(
        (p) => p.label,
      );
      expect(labels).toEqual([...labels].sort().reverse());
    } finally {
      clock.set(Instant.parse('2026-10-05T14:00:00Z'));
    }
  });

  it('[TC-PLANNING-ROLE-001] VIEWER que activa ⇒ 403 INSUFFICIENT_ROLE sin cambios; un no miembro que lista ⇒ 403 WORKSPACE_ACCESS_DENIED', async () => {
    clock.set(Instant.parse('2027-01-02T12:00:00Z'));
    try {
      const jan = labelled(await periodsOf(owner, '?limit=100'), '2027-01');
      expect(jan.status).toBe('DRAFT');
      const denied = await call('POST', `${W(viewer, owner.ws)}/periods/${jan.id}/activate`, {
        token: viewer.token,
        headers: { 'if-match': `"${jan.version}"` },
      });
      expect([denied.status, denied.body['code']]).toEqual([403, 'INSUFFICIENT_ROLE']);
      expect(labelled(await periodsOf(owner, '?limit=100'), '2027-01')).toEqual(jan);
      const ensure = await call('POST', `${W(viewer, owner.ws)}/periods`, {
        token: viewer.token,
        body: { through: '2027-03-01' },
      });
      expect([ensure.status, ensure.body['code']]).toEqual([403, 'INSUFFICIENT_ROLE']);
      const foreign = await call('GET', `${W(outsider, owner.ws)}/periods`, { token: outsider.token });
      expect([foreign.status, foreign.body['code']]).toEqual([403, 'WORKSPACE_ACCESS_DENIED']);
      expect(foreign.body['data']).toBeUndefined();
    } finally {
      clock.set(Instant.parse('2026-10-05T14:00:00Z'));
    }
  });

  it('GET lifecycle-machines/FinancialPeriod publica la máquina declarada (CREATE, ACTIVATE, CLOSE, REOPEN)', async () => {
    const r = await call('GET', `${W(viewer, owner.ws)}/lifecycle-machines/FinancialPeriod`, {
      token: viewer.token,
    });
    expect(r.status).toBe(200);
    expect((r.body['transitions'] as { code: string }[]).map((t) => t.code)).toEqual([
      'CREATE',
      'ACTIVATE',
      'CLOSE',
      'REOPEN',
    ]);
  });
});
