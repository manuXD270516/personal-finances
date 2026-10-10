import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { identityWorkspaceRecipients } from '@pf/identity/interface/identity.module';
import {
  createNotificationsWorkerRuntime,
  notificationEventConsumers,
  type EmailSender,
} from '@pf/notifications/interface/notifications.module';
import { ApiContract } from '@pf/platform/api';
import {
  EventConsumerRuntime,
  EventSubscriptions,
  buildEnvelope,
  type DomainEventDraft,
  type EventConsumerDefinition,
  type EventEnvelope,
} from '@pf/platform/events';
import { uuidv7 } from '@pf/platform/logging';
import { otelCounters, otelHistograms } from '@pf/platform/otel';
import type { JobQueue } from '@pf/platform/queue';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { Pool, type Client } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { resolveContractPath } from '../../src/api/api-conventions.js';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { connect, inTx, sqlState } from '../support/db.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Centro de notificaciones y preferencias por HTTP contra PostgreSQL real (openspec add-alerts, tareas 3.3, 5.1 y 7):
// bandeja con estados y contador, privacidad por usuario y workspace (404 y RLS), idioma del perfil, ETag/If-Match,
// preferencias auditadas y su efecto sobre las notificaciones nuevas. Los hechos de origen los procesa el MISMO
// consumidor del worker (inbox + dedupe) sobre el rol `pf_worker`.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const clock = new FixedClock(Instant.parse('2026-11-12T15:20:00Z'));
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
let workerPool: Pool;
let consumers: EventConsumerRuntime;
let definitions: readonly EventConsumerDefinition[];
const apiLog = capturingLogger('finance-api', 'api');
const workerLog = capturingLogger('finance-worker', 'worker', 'warn');

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

const problem = (r: Reply, status: number, code: string) => {
  expect(r.status, `${JSON.stringify(r.body)} ${JSON.stringify(apiLog.records().slice(-3))}`).toBe(status);
  expect(r.body['code']).toBe(code);
};

async function user(sub: string) {
  const token = await tokenFor(sub);
  const me = await call('GET', '/api/v1/me', { token });
  expect(me.status).toBe(200);
  const memberships = me.body['memberships'] as { workspaceId: string }[];
  return { token, id: me.body['id'] as string, ws: memberships[0]!.workspaceId, sub };
}
type User = Awaited<ReturnType<typeof user>>;
const W = (u: User) => `/api/v1/workspaces/${u.ws}`;
const get = (u: User, path: string, headers: Record<string, string> = {}) =>
  call('GET', `${W(u)}${path}`, { token: u.token, headers });
/** GET sobre el workspace de OTRO usuario (para probar la pertenencia). */
const getIn = (u: User, ws: string, path: string) =>
  call('GET', `/api/v1/workspaces/${ws}${path}`, { token: u.token });
const post = (u: User, path: string, body?: unknown) =>
  call('POST', `${W(u)}${path}`, { token: u.token, ...(body === undefined ? {} : { body }) });
const put = (u: User, path: string, body: unknown, version: number | null) =>
  call('PUT', `${W(u)}${path}`, {
    token: u.token,
    body,
    headers: version === null ? {} : { 'if-match': `"${version}"` },
  });

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

async function setLocale(u: User, locale: string): Promise<void> {
  const me = await call('GET', '/api/v1/me', { token: u.token });
  const r = await call('PATCH', '/api/v1/me', {
    token: u.token,
    body: { locale },
    headers: {
      'content-type': 'application/merge-patch+json',
      'if-match': `"${String(me.body['version'])}"`,
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}

async function setLocaleSql(u: User, locale: string): Promise<void> {
  const migrator = await connect(deps.migratorUrl);
  try {
    await migrator.query('UPDATE iam."user" SET locale = $2 WHERE id = $1', [u.id, locale]);
  } finally {
    await migrator.end();
  }
}

async function asWorker<T>(ws: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = await connect(deps.workerDatabaseUrl);
  try {
    return await inTx(c, { workspaceId: ws }, () => fn(c), true);
  } finally {
    await c.end();
  }
}

// ───────────────────────────────────────────────────────────────────────── escenario

interface Scenario {
  owner: User;
  editor: User;
  viewer: User;
  outsider: User;
  restaurants: string;
}

async function scenario(label: string): Promise<Scenario> {
  const owner = await user(`kc-nt-${label}-${randomUUID()}`);
  const editor = await addMember(owner, await user(`kc-nt-ed-${randomUUID()}`), 'EDITOR');
  const viewer = await addMember(owner, await user(`kc-nt-vw-${randomUUID()}`), 'VIEWER');
  const outsider = await user(`kc-nt-out-${randomUUID()}`);
  // fr-FR no es un locale del perfil admitido por la API (es-BO, en-US, pt-BR): llega de datos previos o del IdP.
  await setLocaleSql(viewer, 'fr-FR');
  // El catálogo inicial del workspace ya trae "Restaurantes" (grupo Alimentación).
  const categories = await get(owner, '/categories?limit=200');
  expect(categories.status, JSON.stringify(categories.body)).toBe(200);
  const cat = (categories.body['data'] as { id: string; name: string }[]).find(
    (c) => c.name === 'Restaurantes',
  );
  expect(cat, 'el catálogo inicial debe incluir Restaurantes').toBeDefined();
  return { owner, editor, viewer, outsider, restaurants: cat!.id };
}

const PERIOD = '01928c4e-0000-7000-8000-0000000fa011';
const BUDGET = '01928c4e-0000-7000-8000-0000000fb001';
const LINE = '01928c4e-0000-7000-8000-0000000fb101';

function thresholdEnvelope(s: Scenario, threshold: string, version: number): EventEnvelope {
  const draft: DomainEventDraft = {
    eventId: uuidv7(),
    eventType: 'planning.BudgetThresholdReached',
    eventVersion: 1,
    occurredAt: clock.now().toString(),
    workspaceId: s.owner.ws,
    aggregateType: 'Budget',
    aggregateId: BUDGET,
    aggregateVersion: version,
    actor: { type: 'SYSTEM', id: null },
    payload: {
      budgetId: BUDGET,
      budgetLineId: LINE,
      periodId: PERIOD,
      periodLabel: '2026-11',
      periodStart: '2026-11-01',
      periodEnd: '2026-11-30',
      target: { kind: 'CATEGORY', id: s.restaurants },
      threshold,
      alsoCrossed: threshold === '90' ? ['50', '75'] : [],
      reference: { amount: '600.00', currency: 'BOB' },
      actual: { amount: '550.00', currency: 'BOB' },
      utilization: '91.7',
      actualComplete: true,
      crossedAt: clock.now().toString(),
    },
  };
  const envelope = buildEnvelope(draft);
  eventSchemaRegistry().validate(envelope);
  return envelope;
}

const consumerOf = (name: string): EventConsumerDefinition => {
  const def = definitions.find((d) => d.consumer === name);
  if (!def) throw new Error(`consumer ${name} missing`);
  return def;
};

/** Procesa un umbral con el consumidor real del worker (inbox + dedupe + preferencias). */
async function fireThreshold(s: Scenario, threshold: string, version = 1): Promise<void> {
  clock.advance(60_000);
  await consumers.deliver(
    consumerOf('notifications.budget-threshold'),
    thresholdEnvelope(s, threshold, version),
  );
}

const list = async (u: User, query = '') => {
  const r = await get(u, `/notifications${query}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(contract.validateResponse('listNotifications', 200, r.body), JSON.stringify(r.body)).toEqual([]);
  return r.body as { data: Json[]; page: { limit: number; hasMore: boolean; nextCursor: string | null } };
};
const unread = async (u: User) => {
  const r = await get(u, '/notifications/unread-count');
  expect(r.status).toBe(200);
  expect(contract.validateResponse('getUnreadNotificationCount', 200, r.body)).toEqual([]);
  return r.body['unread'] as number;
};

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

  // Worker de NOTIFY en proceso (rol pf_worker): consumidores reales; el email no se envía aquí (sin cola real).
  workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 6 });
  const sender: EmailSender = {
    driver: 'none',
    send: () => Promise.reject(new Error('el canal email no se usa en las pruebas de la API')),
  };
  const queue = {
    enqueueInTransaction: () => Promise.resolve(),
  } as unknown as JobQueue;
  const notifications = createNotificationsWorkerRuntime({
    pool: workerPool,
    clock,
    queue,
    logger: workerLog.logger,
    recipients: identityWorkspaceRecipients(workerPool),
    catalog: { categoryTree: () => Promise.resolve({ groups: [], categories: [], tags: [] }) },
    sender,
    counters: otelCounters('@pf/notifications'),
    histograms: otelHistograms('@pf/notifications'),
    appPublicUrl: 'http://localhost:23000',
    emailFrom: 'PFOS <notificaciones@pfos.local>',
    maxAttempts: 5,
    retentionMonths: 12,
  });
  definitions = notificationEventConsumers(notifications);
  consumers = new EventConsumerRuntime({
    pool: workerPool,
    queue: queue,
    subscriptions: new EventSubscriptions(definitions),
    logger: workerLog.logger,
  });
}, 180_000);

afterAll(async () => {
  await runtime?.close();
  await workerPool?.end();
});

describe('Preferencias de notificaciones', () => {
  it('[TC-NOTIFICATIONS-PREFS-003] por defecto ambos canales activos, sin detalles y sin horario de silencio; cualquier rol las lee', async () => {
    const s = await scenario('prefs-default');
    for (const u of [s.owner, s.editor, s.viewer]) {
      const r = await get(u, '/notification-preferences');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body).toEqual({
        types: [
          { type: 'BUDGET_THRESHOLD', inApp: true, email: true },
          { type: 'MONTH_CLOSE_PENDING', inApp: true, email: true },
          { type: 'RECURRING_PAYMENT_UPCOMING', inApp: true, email: true },
          { type: 'RECURRING_APPROVAL_REQUIRED', inApp: true, email: true },
        ],
        quietHours: null,
        includeDetailsInEmail: false,
        version: 1,
      });
      expect(r.headers.get('etag')).toBe('"1"');
      expect(contract.validateResponse('getNotificationPreferences', 200, r.body)).toEqual([]);
    }
    problem(await call('GET', `${W(s.owner)}/notification-preferences`), 401, 'UNAUTHENTICATED');
    problem(await getIn(s.outsider, s.owner.ws, '/notification-preferences'), 403, 'WORKSPACE_ACCESS_DENIED');
  });

  it('[TC-NOTIFICATIONS-PREFS-001] desactivar el email de umbrales: se audita, y el siguiente umbral solo crea la notificación in-app (sin entrega por email)', async () => {
    const s = await scenario('prefs-email-off');
    const saved = await put(
      s.owner,
      '/notification-preferences',
      {
        types: [{ type: 'BUDGET_THRESHOLD', inApp: true, email: false }],
        quietHours: null,
        includeDetailsInEmail: false,
      },
      1,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.headers.get('etag')).toBe('"2"');
    expect(saved.body['version']).toBe(2);
    expect(contract.validateResponse('updateNotificationPreferences', 200, saved.body)).toEqual([]);
    expect((saved.body['types'] as Json[])[0]).toEqual({
      type: 'BUDGET_THRESHOLD',
      inApp: true,
      email: false,
    });

    // Auditoría: el cambio queda registrado campo a campo, en el historial del workspace.
    const audit = await get(s.owner, '/audit-log?limit=50');
    const entry = (audit.body['data'] as Json[]).find(
      (e) => e['action'] === 'notifications.preferences.updated',
    );
    expect(entry, JSON.stringify(audit.body)).toBeDefined();
    expect(entry).toMatchObject({
      aggregateType: 'NotificationPreferences',
      aggregateId: s.owner.id,
      actor: { type: 'USER', userId: s.owner.id },
    });
    expect(entry?.['changes']).toEqual([
      { field: 'byType.BUDGET_THRESHOLD.EMAIL', before: true, after: false },
    ]);

    await fireThreshold(s, '100');
    const mine = await list(s.owner);
    expect(mine.data).toHaveLength(1);
    const deliveries = await asWorker(s.owner.ws, async (c) => {
      const { rows } = await c.query<{ user_id: string }>(
        `SELECT n.user_id FROM notifications.notification_delivery d
           JOIN notifications.notification n ON n.workspace_id = d.workspace_id AND n.id = d.notification_id`,
      );
      return rows.map((r) => r.user_id);
    });
    // EDITOR y VIEWER sí tienen entrega por email; el OWNER (que la desactivó) no.
    expect(deliveries.sort()).toEqual([s.editor.id, s.viewer.id].sort());
  });

  it('el PUT exige If-Match (428), rechaza una versión desactualizada (412) y un PUT idéntico no cambia la versión', async () => {
    const s = await scenario('prefs-etag');
    const body = {
      types: [{ type: 'MONTH_CLOSE_PENDING', inApp: true, email: false }],
      quietHours: null,
      includeDetailsInEmail: false,
    };
    problem(await put(s.editor, '/notification-preferences', body, null), 428, 'PRECONDITION_REQUIRED');
    expect((await put(s.editor, '/notification-preferences', body, 1)).status).toBe(200);
    const stale = await put(s.editor, '/notification-preferences', body, 1);
    problem(stale, 412, 'PRECONDITION_FAILED');
    const same = await put(s.editor, '/notification-preferences', body, 2);
    expect(same.status).toBe(200);
    expect(same.body['version']).toBe(2);
    expect(same.headers.get('etag')).toBe('"2"');
  });

  it('[TC-NOTIFICATIONS-PREFS-002] el horario de silencio y el opt-in de detalles se guardan por usuario; un horario inválido responde 400', async () => {
    const s = await scenario('prefs-quiet');
    const saved = await put(
      s.owner,
      '/notification-preferences',
      {
        types: [],
        quietHours: { start: '22:00', end: '07:00' },
        includeDetailsInEmail: true,
      },
      1,
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({
      quietHours: { start: '22:00', end: '07:00' },
      includeDetailsInEmail: true,
      version: 2,
    });
    // Otro miembro no ve ni hereda esas preferencias.
    expect((await get(s.editor, '/notification-preferences')).body).toMatchObject({
      quietHours: null,
      includeDetailsInEmail: false,
    });
    const reread = await get(s.owner, '/notification-preferences');
    expect(reread.body['quietHours']).toEqual({ start: '22:00', end: '07:00' });

    for (const quietHours of [
      { start: '22:00', end: '22:00' },
      { start: '25:00', end: '07:00' },
      { start: '7:00', end: '08:00' },
    ]) {
      const bad = await put(
        s.owner,
        '/notification-preferences',
        { types: [], quietHours, includeDetailsInEmail: true },
        2,
      );
      problem(bad, 400, 'VALIDATION_FAILED');
    }
    // Quitarlo: quietHours null.
    const cleared = await put(
      s.owner,
      '/notification-preferences',
      { types: [], quietHours: null, includeDetailsInEmail: true },
      2,
    );
    expect(cleared.body['quietHours']).toBeNull();
    // Un tipo desconocido es VALIDATION_FAILED.
    const unknown = await put(
      s.owner,
      '/notification-preferences',
      {
        types: [{ type: 'GOAL_REACHED', inApp: true, email: true }],
        quietHours: null,
        includeDetailsInEmail: true,
      },
      3,
    );
    problem(unknown, 400, 'VALIDATION_FAILED');
  });
});

describe('Centro de notificaciones', () => {
  it('[TC-NOTIFICATIONS-INAPP-001] cada miembro (VIEWER incluido) recibe la notificación con objetivo, periodo, umbrales y montos; el cierre pendiente solo OWNER y EDITOR', async () => {
    const s = await scenario('inapp-one');
    await fireThreshold(s, '90');
    for (const u of [s.owner, s.editor, s.viewer]) {
      const { data } = await list(u);
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({
        type: 'BUDGET_THRESHOLD',
        severity: 'INFO',
        status: 'UNREAD',
        readAt: null,
        link: {
          kind: 'BUDGET_LINE',
          periodLabel: '2026-11',
          targetKind: 'CATEGORY',
          targetId: s.restaurants,
        },
        params: { threshold: '90', alsoCrossed: ['50', '75'] },
        emailStatus: 'PENDING',
      });
    }
    // OWNER (es-BO): objetivo por nombre vigente, periodo, umbral y montos en formato es-BO.
    const owner = (await list(s.owner)).data[0]!;
    expect(owner['title']).toBe('Alerta de presupuesto: Restaurantes alcanzó el 90 %');
    expect(owner['body']).toContain('2026-11');
    expect(owner['body']).toContain('550,00 de 600,00 BOB');
    expect(owner['body']).toContain('50 % y 75 %');

    // El cierre pendiente: solo OWNER y EDITOR.
    const closeEvent = buildEnvelope({
      eventId: uuidv7(),
      eventType: 'planning.MonthClosePending',
      eventVersion: 1,
      occurredAt: clock.now().toString(),
      workspaceId: s.owner.ws,
      aggregateType: 'FinancialPeriod',
      aggregateId: PERIOD,
      aggregateVersion: 2,
      payload: {
        workspaceId: s.owner.ws,
        periodId: PERIOD,
        periodLabel: '2026-10',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        pendingSince: '2026-11-01',
        delayDays: 3,
      },
    });
    const def = consumerOf('notifications.month-close-pending');
    expect(await consumers.deliver(def, closeEvent)).toBe('applied');
    expect(await consumers.deliver(def, closeEvent)).toBe('duplicate');
    expect((await list(s.owner)).data.map((n) => n['type'])).toContain('MONTH_CLOSE_PENDING');
    expect((await list(s.editor)).data.map((n) => n['type'])).toContain('MONTH_CLOSE_PENDING');
    expect((await list(s.viewer)).data.map((n) => n['type'])).not.toContain('MONTH_CLOSE_PENDING');
    const close = (await list(s.owner)).data.find((n) => n['type'] === 'MONTH_CLOSE_PENDING')!;
    expect(close).toMatchObject({ severity: 'WARNING', link: { kind: 'PERIOD_CLOSE', periodId: PERIOD } });
    expect(close['title']).toBe('El mes 2026-10 está pendiente de cierre');
  });

  it('[TC-NOTIFICATIONS-INAPP-002] un miembro que desactivó el tipo in-app no recibe la notificación', async () => {
    const s = await scenario('inapp-off');
    const r = await put(
      s.viewer,
      '/notification-preferences',
      {
        types: [{ type: 'BUDGET_THRESHOLD', inApp: false, email: true }],
        quietHours: null,
        includeDetailsInEmail: false,
      },
      1,
    );
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await fireThreshold(s, '90');
    expect((await list(s.viewer)).data).toHaveLength(0);
    expect((await list(s.owner)).data).toHaveLength(1);
  });

  it('[TC-NOTIFICATIONS-INAPP-003] leer y archivar actualizan lista y contador (de la más reciente a la más antigua); las archivadas solo al filtrar; leer es idempotente', async () => {
    const s = await scenario('inapp-states');
    await fireThreshold(s, '50');
    await fireThreshold(s, '75');
    await fireThreshold(s, '90');
    expect(await unread(s.owner)).toBe(3);
    const all = (await list(s.owner)).data;
    expect(all.map((n) => (n['params'] as Json)['threshold'])).toEqual(['90', '75', '50']);
    const [c, b, a] = all as [Json, Json, Json];

    const readA = await post(s.owner, `/notifications/${String(a['id'])}/read`);
    expect(readA.status, JSON.stringify(readA.body)).toBe(200);
    expect(contract.validateResponse('markNotificationRead', 200, readA.body)).toEqual([]);
    expect(readA.body).toMatchObject({ id: a['id'], status: 'READ' });
    const readAgain = await post(s.owner, `/notifications/${String(a['id'])}/read`);
    expect(readAgain.body).toEqual(readA.body);
    const archiveB = await post(s.owner, `/notifications/${String(b['id'])}/archive`);
    expect(archiveB.status).toBe(200);
    expect(contract.validateResponse('archiveNotification', 200, archiveB.body)).toEqual([]);
    expect((await post(s.owner, `/notifications/${String(b['id'])}/archive`)).body).toEqual(archiveB.body);

    const unreadRes = await get(s.owner, '/notifications/unread-count');
    expect(unreadRes.body).toEqual({ unread: 1 });
    expect(unreadRes.headers.get('etag')).toBe('"1"');
    const notModified = await get(s.owner, '/notifications/unread-count', { 'if-none-match': '"1"' });
    expect(notModified.status).toBe(304);

    const def = (await list(s.owner)).data;
    expect(def.map((n) => n['id'])).toEqual([c['id'], a['id']]);
    expect(def.map((n) => n['status'])).toEqual(['UNREAD', 'READ']);
    const archived = (await list(s.owner, '?status=ARCHIVED')).data;
    expect(archived.map((n) => n['id'])).toEqual([b['id']]);
    expect((await list(s.owner, '?status=UNREAD')).data.map((n) => n['id'])).toEqual([c['id']]);
    problem(await get(s.owner, '/notifications?status=DISMISSED'), 400, 'VALIDATION_FAILED');
    // Archivar o leer no toca las notificaciones de los demás.
    expect(await unread(s.viewer)).toBe(3);
    // El detalle (destino del enlace del email) devuelve una notificación propia.
    const one = await get(s.owner, `/notifications/${String(c['id'])}`);
    expect(one.status).toBe(200);
    expect(contract.validateResponse('getNotification', 200, one.body)).toEqual([]);
    expect(one.body['id']).toBe(c['id']);
  });

  it('[TC-NOTIFICATIONS-INAPP-004] marcar todas como leídas deja el contador en cero e informa cuántas cambió', async () => {
    const s = await scenario('inapp-readall');
    await fireThreshold(s, '75');
    expect(await unread(s.owner)).toBe(1);
    const r = await post(s.owner, '/notifications/read-all');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ updated: 1 });
    expect(contract.validateResponse('markAllNotificationsRead', 200, r.body)).toEqual([]);
    expect(await unread(s.owner)).toBe(0);
    expect((await post(s.owner, '/notifications/read-all')).body).toEqual({ updated: 0 });
    // Las del VIEWER siguen sin leer.
    expect(await unread(s.viewer)).toBe(1);
  });

  it('pagina con cursor firmado: la segunda página continúa donde terminó la primera y un cursor ajeno se rechaza', async () => {
    const s = await scenario('inapp-page');
    await fireThreshold(s, '50');
    await fireThreshold(s, '75');
    await fireThreshold(s, '90');
    const first = await list(s.owner, '?limit=2');
    expect(first.data).toHaveLength(2);
    expect(first.page).toMatchObject({ limit: 2, hasMore: true });
    const second = await list(s.owner, `?limit=2&cursor=${encodeURIComponent(first.page.nextCursor ?? '')}`);
    expect(second.data).toHaveLength(1);
    expect(second.page.hasMore).toBe(false);
    expect((second.data[0]!['params'] as Json)['threshold']).toBe('50');
    // El cursor del OWNER no sirve a otro usuario.
    problem(
      await get(s.viewer, `/notifications?limit=2&cursor=${encodeURIComponent(first.page.nextCursor ?? '')}`),
      400,
      'INVALID_CURSOR',
    );
  });

  it('[TC-NOTIFICATIONS-INAPP-006] la notificación de otro usuario o de otro workspace responde 404 y sigue sin leer; RLS por usuario en la base', async () => {
    const s = await scenario('inapp-private');
    await fireThreshold(s, '90');
    const target = (await list(s.owner)).data[0]!['id'] as string;

    // Otro miembro (VIEWER): inexistente, igual que un id aleatorio.
    problem(await post(s.viewer, `/notifications/${target}/read`), 404, 'RESOURCE_NOT_FOUND');
    problem(await post(s.viewer, `/notifications/${target}/archive`), 404, 'RESOURCE_NOT_FOUND');
    problem(await get(s.viewer, `/notifications/${target}`), 404, 'RESOURCE_NOT_FOUND');
    problem(await post(s.viewer, `/notifications/${randomUUID()}/read`), 404, 'RESOURCE_NOT_FOUND');
    // Usuario de otro workspace: sobre su propio workspace es inexistente; sobre el ajeno, no es miembro.
    problem(await post(s.outsider, `/notifications/${target}/read`), 404, 'RESOURCE_NOT_FOUND');
    problem(
      await call('POST', `/api/v1/workspaces/${s.owner.ws}/notifications/${target}/read`, {
        token: s.outsider.token,
      }),
      403,
      'WORKSPACE_ACCESS_DENIED',
    );
    expect((await get(s.owner, `/notifications/${target}`)).body['status']).toBe('UNREAD');

    // SQL como pf_app con el contexto del VIEWER: no ve la fila; sin app.user_id falla con PF002; no inserta ni borra.
    const app = await connect(deps.databaseUrl);
    try {
      const seen = await inTx(
        app,
        { userId: s.viewer.id, workspaceId: s.owner.ws },
        async () =>
          (await app.query('SELECT id FROM notifications.notification WHERE id = $1', [target])).rows,
      );
      expect(seen).toEqual([]);
      const mine = await inTx(
        app,
        { userId: s.owner.id, workspaceId: s.owner.ws },
        async () =>
          (await app.query('SELECT id FROM notifications.notification WHERE id = $1', [target])).rows,
      );
      expect(mine).toHaveLength(1);
      expect(
        await sqlState(() =>
          inTx(app, { workspaceId: s.owner.ws }, () => app.query('SELECT 1 FROM notifications.notification')),
        ),
      ).toBe('PF002');
      // Otro workspace en contexto: ni siquiera el dueño ve la fila.
      const elsewhere = await inTx(
        app,
        { userId: s.owner.id, workspaceId: s.outsider.ws },
        async () =>
          (await app.query('SELECT id FROM notifications.notification WHERE id = $1', [target])).rows,
      );
      expect(elsewhere).toEqual([]);
      // Una UPDATE del VIEWER sobre la fila ajena no la toca.
      const hijack = await inTx(app, { userId: s.viewer.id, workspaceId: s.owner.ws }, async () =>
        app.query(`UPDATE notifications.notification SET status = 'READ', read_at = now() WHERE id = $1`, [
          target,
        ]),
      );
      expect(hijack.rowCount).toBe(0);
      // pf_app no inserta ni borra notificaciones (solo el worker).
      expect(
        await sqlState(() =>
          inTx(app, { userId: s.owner.id, workspaceId: s.owner.ws }, () =>
            app.query('DELETE FROM notifications.notification WHERE id = $1', [target]),
          ),
        ),
      ).toBe('42501');
      // pf_app no lee las entregas completas (solo estado agregado de las propias).
      expect(
        await sqlState(() =>
          inTx(app, { userId: s.owner.id, workspaceId: s.owner.ws }, () =>
            app.query('SELECT provider_message_id FROM notifications.notification_delivery'),
          ),
        ),
      ).toBe('42501');
    } finally {
      await app.end();
    }
  });

  it('[TC-NOTIFICATIONS-I18N-002] fr-FR cae a español y cambiar el locale del perfil traduce la misma notificación', async () => {
    const s = await scenario('i18n');
    await fireThreshold(s, '90');
    // VIEWER con un locale sin traducción (fr-FR, solo alcanzable por datos previos): español.
    const before = (await list(s.viewer)).data[0]!;
    expect(before['title']).toBe('Alerta de presupuesto: Restaurantes alcanzó el 90 %');
    await setLocaleSql(s.viewer, 'en-US');
    const after = (await list(s.viewer)).data[0]!;
    expect(after['id']).toBe(before['id']);
    expect(after['title']).toBe('Budget alert: Restaurantes reached 90 %');
    expect(after['body']).toContain('550.00 of 600.00 BOB');
    expect(after['messageKey']).toBe(before['messageKey']);
    // Por la API (PATCH /me): el EDITOR pasa de pt-BR a en-US y la misma notificación se traduce.
    await setLocale(s.editor, 'pt-BR');
    const ptBefore = (await list(s.editor)).data[0]!;
    expect(ptBefore['title']).toBe('Alerta de orçamento: Restaurantes atingiu 90 %');
    await setLocale(s.editor, 'en-US');
    const enAfter = (await list(s.editor)).data[0]!;
    expect(enAfter['id']).toBe(ptBefore['id']);
    expect(enAfter['title']).toBe('Budget alert: Restaurantes reached 90 %');
    // El OWNER (es-BO) no cambia.
    expect((await list(s.owner)).data[0]!['title']).toBe(
      'Alerta de presupuesto: Restaurantes alcanzó el 90 %',
    );
  });

  it('el estado del email se pliega a PENDING/SENT/FAILED/SUPPRESSED y la respuesta nunca incluye la dirección de email', async () => {
    const s = await scenario('email-status');
    await fireThreshold(s, '90');
    const id = (await list(s.owner)).data[0]!['id'] as string;
    const deliveryId = await asWorker(s.owner.ws, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        `SELECT d.id FROM notifications.notification_delivery d WHERE d.notification_id = $1`,
        [id],
      );
      return rows[0]!.id;
    });
    const states: [string, string][] = [
      ['SENDING', 'PENDING'],
      ['RETRY', 'PENDING'],
      ['FAILED', 'FAILED'],
      ['SUPPRESSED', 'SUPPRESSED'],
      ['SENT', 'SENT'],
    ];
    for (const [status, expected] of states) {
      await asWorker(s.owner.ws, (c) =>
        c.query(
          `UPDATE notifications.notification_delivery
              SET status = $2, suppression_reason = CASE WHEN $2 = 'SUPPRESSED' THEN 'NO_EMAIL' END,
                  sent_at = CASE WHEN $2 = 'SENT' THEN now() END
            WHERE id = $1`,
          [deliveryId, status],
        ),
      );
      const n = (await list(s.owner)).data[0]!;
      expect(n['emailStatus']).toBe(expected);
      expect(JSON.stringify(n)).not.toContain('@');
    }
  });

  it('[TC-NOTIFICATIONS-INAPP-006] la API no expone notificaciones sin sesión (401) y exige membresía activa (403)', async () => {
    const s = await scenario('inapp-auth');
    problem(await call('GET', `${W(s.owner)}/notifications`), 401, 'UNAUTHENTICATED');
    problem(
      await getIn(s.outsider, s.owner.ws, '/notifications/unread-count'),
      403,
      'WORKSPACE_ACCESS_DENIED',
    );
    problem(
      await call('POST', `/api/v1/workspaces/${s.owner.ws}/notifications/read-all`, {
        token: s.outsider.token,
      }),
      403,
      'WORKSPACE_ACCESS_DENIED',
    );
  });
});
