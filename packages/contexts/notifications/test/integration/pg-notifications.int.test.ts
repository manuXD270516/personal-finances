import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { NotificationPreferences, type NotificationState } from '../../src/domain/index.js';
import {
  PgDeliveryRepository,
  PgNotificationRepository,
  PgPreferencesRepository,
} from '../../src/infrastructure/pg-notifications.js';

// Repositorios de NOTIFY contra PostgreSQL real (Testcontainers + `migrate` real; openspec add-alerts, tareas 4.1 y
// 7): unicidad de `dedupe_key` con workers concurrentes, entrega única por *claim* con lease, bloqueo optimista de las
// preferencias, purga por retención y RLS por workspace y por usuario.
declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
let app: Pool;
let worker: Pool;
let migrator: Pool;
let appUow: PgUnitOfWork;
let workerUow: PgUnitOfWork;
let owner: string;
let viewer: string;
const notifications = new PgNotificationRepository();
const deliveries = new PgDeliveryRepository();
const preferences = new PgPreferencesRepository();

const inWorker = <T>(ws: string, fn: () => Promise<T>) =>
  workerUow.run({ userId: null, workspaceId: ws }, fn);
const asUser = <T>(userId: string, ws: string, fn: () => Promise<T>) =>
  appUow.run({ userId, workspaceId: ws }, fn);

async function provision(label: string): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/notify-repo', $1, $2, $3) AS id`,
    [`sub-${label}-${randomUUID()}`, `${label}-${randomUUID().slice(0, 8)}@demo.pfos.test`, label],
  );
  return rows[0]!.id;
}

async function newWorkspace(): Promise<string> {
  const ws = randomUUID();
  await appUow.run({ userId: owner, workspaceId: ws }, async () => {
    const tx = requireSqlExecutor();
    await tx.query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Repo', 'BOB', 'America/La_Paz', 'es-BO')`,
      [ws],
    );
    await tx.query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'OWNER')`,
      [ws, owner],
    );
    await tx.query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'VIEWER')`,
      [ws, viewer],
    );
  });
  return ws;
}

function notification(ws: string, userId: string, over: Partial<NotificationState> = {}): NotificationState {
  return {
    id: randomUUID(),
    workspaceId: ws,
    userId,
    type: 'BUDGET_THRESHOLD',
    severity: 'INFO',
    messageKey: 'notifications.budget_threshold.v1',
    params: { periodLabel: '2026-11', threshold: '90' },
    link: { kind: 'PERIOD_CLOSE', periodId: randomUUID(), periodLabel: '2026-11' },
    dedupeKey: `budget-threshold:${randomUUID()}:90`,
    sourceEventId: randomUUID(),
    status: 'UNREAD',
    createdAt: '2026-11-12T15:20:00.000Z',
    readAt: null,
    archivedAt: null,
    ...over,
  };
}

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 12 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  appUow = new PgUnitOfWork(app);
  workerUow = new PgUnitOfWork(worker);
  owner = await provision('owner');
  viewer = await provision('viewer');
});

afterAll(async () => {
  await Promise.all([app?.end(), worker?.end(), migrator?.end()]);
});

describe('PgNotificationRepository', () => {
  it('[TC-NOTIFICATIONS-DEDUP-001] ocho workers concurrentes con la misma clave de negocio insertan exactamente una notificación', async () => {
    const ws = await newWorkspace();
    const dedupeKey = `budget-threshold:${randomUUID()}:CATEGORY:${randomUUID()}:90`;
    const inserted = await Promise.all(
      Array.from({ length: 8 }, () =>
        inWorker(ws, () => notifications.insertIfAbsent(notification(ws, owner, { dedupeKey }))),
      ),
    );
    expect(inserted.filter(Boolean)).toHaveLength(1);
    const rows = await asUser(owner, ws, () =>
      notifications.list({ workspaceId: ws, userId: owner, statuses: ['UNREAD'], limit: 10 }),
    );
    expect(rows).toHaveLength(1);
    // La misma clave para OTRO usuario del workspace sí es otra notificación.
    expect(
      await inWorker(ws, () => notifications.insertIfAbsent(notification(ws, viewer, { dedupeKey }))),
    ).toBe(true);
  });

  it('[TC-NOTIFICATIONS-INAPP-003] estados, contador y bandeja paginada por posición (created_at, id)', async () => {
    const ws = await newWorkspace();
    const [a, b, c] = [
      '2026-11-12T10:00:00.000Z',
      '2026-11-12T11:00:00.000Z',
      '2026-11-12T12:00:00.000Z',
    ].map((createdAt) => notification(ws, owner, { createdAt }));
    for (const n of [a!, b!, c!]) await inWorker(ws, () => notifications.insertIfAbsent(n));
    const now = '2026-11-12T13:00:00.000Z';
    await asUser(owner, ws, async () => {
      expect(await notifications.unreadCount(ws, owner)).toBe(3);
      expect(await notifications.markRead(ws, owner, a!.id, now)).toBe(true);
      expect(await notifications.markRead(ws, owner, a!.id, '2026-11-12T14:00:00.000Z')).toBe(true);
      expect(await notifications.archive(ws, owner, b!.id, now)).toBe(true);
      expect(await notifications.archive(ws, owner, b!.id, '2026-11-12T14:00:00.000Z')).toBe(true);
      expect(await notifications.unreadCount(ws, owner)).toBe(1);
      const first = await notifications.list({
        workspaceId: ws,
        userId: owner,
        statuses: ['UNREAD', 'READ'],
        limit: 1,
      });
      expect(first.map((n) => n.id)).toEqual([c!.id]);
      const next = await notifications.list({
        workspaceId: ws,
        userId: owner,
        statuses: ['UNREAD', 'READ'],
        after: { createdAt: first[0]!.createdAt, id: first[0]!.id },
        limit: 5,
      });
      expect(next.map((n) => n.id)).toEqual([a!.id]);
      // Conserva la primera lectura y la fecha de archivo.
      expect((await notifications.findOwn(ws, owner, a!.id))?.readAt).toBe(now);
      expect((await notifications.findOwn(ws, owner, b!.id))?.archivedAt).toBe(now);
      expect(await notifications.markAllRead(ws, owner, now)).toBe(1);
      expect(await notifications.markAllRead(ws, owner, now)).toBe(0);
    });
  });

  it('[TC-NOTIFICATIONS-INAPP-006] el usuario solo ve y cambia las suyas; el worker lee las del workspace pero no cambia su estado', async () => {
    const ws = await newWorkspace();
    const mine = notification(ws, owner);
    await inWorker(ws, () => notifications.insertIfAbsent(mine));
    await asUser(viewer, ws, async () => {
      expect(await notifications.findOwn(ws, viewer, mine.id)).toBeNull();
      expect(await notifications.findById(ws, mine.id)).toBeNull();
      expect(await notifications.markRead(ws, viewer, mine.id, '2026-11-12T16:00:00.000Z')).toBe(false);
      expect(await notifications.archive(ws, viewer, mine.id, '2026-11-12T16:00:00.000Z')).toBe(false);
      expect(await notifications.unreadCount(ws, viewer)).toBe(0);
    });
    // El worker (sin usuario en contexto) lee por workspace, p. ej. para renderizar el email.
    expect((await inWorker(ws, () => notifications.findById(ws, mine.id)))?.status).toBe('UNREAD');
    // Pero no puede cambiar el estado de lectura de nadie: la política de UPDATE exige el usuario.
    await expect(
      inWorker(ws, () => notifications.markRead(ws, owner, mine.id, '2026-11-12T16:00:00.000Z')),
    ).rejects.toMatchObject({ code: 'PF002' });
    // Otro workspace: ni el worker con su contexto ve la fila.
    const other = await newWorkspace();
    expect(await inWorker(other, () => notifications.findById(other, mine.id))).toBeNull();
    expect((await asUser(owner, ws, () => notifications.findOwn(ws, owner, mine.id)))?.status).toBe('UNREAD');
  });

  it('[TC-NOTIFICATIONS-INAPP-006] sin contexto de usuario, pf_app falla con PF002 (cierre seguro)', async () => {
    const ws = await newWorkspace();
    await inWorker(ws, () => notifications.insertIfAbsent(notification(ws, owner)));
    await expect(
      appUow.run({ userId: null, workspaceId: ws }, () =>
        notifications.list({ workspaceId: ws, userId: owner, statuses: ['UNREAD'], limit: 1 }),
      ),
    ).rejects.toMatchObject({ code: 'PF002' });
  });

  it('el estado de lectura es coherente (CHECK): no se puede archivar sin fecha ni leer con fecha de archivo', async () => {
    const ws = await newWorkspace();
    const n = notification(ws, owner);
    await inWorker(ws, () => notifications.insertIfAbsent(n));
    await expect(
      asUser(owner, ws, () =>
        requireSqlExecutor().query(
          `UPDATE notifications.notification SET status = 'ARCHIVED' WHERE id = $1`,
          [n.id],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('[TC-NOTIFICATIONS-INAPP-001] la purga por retención borra las notificaciones antiguas (archivadas incluidas) y sus entregas, y conserva las recientes', async () => {
    const ws = await newWorkspace();
    const old = notification(ws, owner, { createdAt: '2025-10-01T10:00:00.000Z' });
    const oldArchived = notification(ws, owner, { createdAt: '2025-09-01T10:00:00.000Z' });
    const recent = notification(ws, owner, { createdAt: '2026-11-01T10:00:00.000Z' });
    for (const n of [old, oldArchived, recent]) await inWorker(ws, () => notifications.insertIfAbsent(n));
    await asUser(owner, ws, () =>
      notifications.archive(ws, owner, oldArchived.id, '2025-09-02T00:00:00.000Z'),
    );
    await inWorker(ws, async () => {
      for (const n of [old, recent]) {
        await deliveries.insert({
          id: randomUUID(),
          workspaceId: ws,
          notificationId: n.id,
          notBefore: n.createdAt,
          now: n.createdAt,
        });
      }
    });
    expect(await inWorker(ws, () => notifications.deleteCreatedBefore(ws, '2025-11-12T00:00:00.000Z'))).toBe(
      2,
    );
    const left = await asUser(owner, ws, () =>
      notifications.list({
        workspaceId: ws,
        userId: owner,
        statuses: ['UNREAD', 'READ', 'ARCHIVED'],
        limit: 10,
      }),
    );
    expect(left.map((n) => n.id)).toEqual([recent.id]);
    const remaining = await inWorker(
      ws,
      async () =>
        (await requireSqlExecutor().query('SELECT notification_id FROM notifications.notification_delivery'))
          .rows,
    );
    expect(remaining).toEqual([{ notification_id: recent.id }]);
  });
});

describe('PgDeliveryRepository', () => {
  async function pending(notBefore = '2026-11-12T15:20:00.000Z') {
    const ws = await newWorkspace();
    const n = notification(ws, owner);
    const deliveryId = randomUUID();
    await inWorker(ws, async () => {
      await notifications.insertIfAbsent(n);
      await deliveries.insert({
        id: deliveryId,
        workspaceId: ws,
        notificationId: n.id,
        notBefore,
        now: notBefore,
      });
    });
    return { ws, n, deliveryId };
  }
  const claim = (ws: string, id: string, now: string, leaseUntil: string) =>
    inWorker(ws, () => deliveries.claim({ workspaceId: ws, id, now, leaseUntil }));

  it('[TC-NOTIFICATIONS-EMAIL-005] seis instancias a la vez: solo una obtiene el claim (attempts = 1); una entrega SENT no se reclama más', async () => {
    const { ws, deliveryId } = await pending();
    const now = '2026-11-12T15:20:00.000Z';
    const claimed = await Promise.all(
      Array.from({ length: 6 }, () => claim(ws, deliveryId, now, '2026-11-12T15:22:00.000Z')),
    );
    expect(claimed.filter((c) => c !== null)).toHaveLength(1);
    expect(claimed.find((c) => c)).toMatchObject({
      status: 'SENDING',
      attempts: 1,
      leaseUntil: '2026-11-12T15:22:00.000Z',
    });
    await inWorker(ws, () =>
      deliveries.markSent({
        id: deliveryId,
        provider: 'smtp',
        providerMessageId: `<${deliveryId}@pfos.local>`,
        now,
      }),
    );
    expect(await claim(ws, deliveryId, '2026-11-12T16:00:00.000Z', '2026-11-12T16:02:00.000Z')).toBeNull();
    expect(await inWorker(ws, () => deliveries.find(ws, deliveryId))).toMatchObject({
      status: 'SENT',
      attempts: 1,
      providerMessageId: `<${deliveryId}@pfos.local>`,
      leaseUntil: null,
    });
  });

  it('un claim antes de not_before no obtiene nada; con el lease vigente tampoco; con el lease expirado se reclama (attempts + 1)', async () => {
    const { ws, deliveryId } = await pending('2026-11-13T11:00:00.000Z');
    expect(await claim(ws, deliveryId, '2026-11-13T10:59:59.000Z', '2026-11-13T11:02:00.000Z')).toBeNull();
    expect(await claim(ws, deliveryId, '2026-11-13T11:00:00.000Z', '2026-11-13T11:02:00.000Z')).toMatchObject(
      {
        attempts: 1,
      },
    );
    expect(await claim(ws, deliveryId, '2026-11-13T11:01:00.000Z', '2026-11-13T11:03:00.000Z')).toBeNull();
    expect(await claim(ws, deliveryId, '2026-11-13T11:02:01.000Z', '2026-11-13T11:04:00.000Z')).toMatchObject(
      {
        attempts: 2,
      },
    );
  });

  it('[TC-NOTIFICATIONS-EMAIL-006] retry, failed y release actualizan estado, intentos y fecha; due() lista solo lo vencido', async () => {
    const { ws, deliveryId } = await pending();
    await claim(ws, deliveryId, '2026-11-12T15:20:00.000Z', '2026-11-12T15:22:00.000Z');
    await inWorker(ws, () =>
      deliveries.markRetry({
        id: deliveryId,
        notBefore: '2026-11-12T15:21:00.000Z',
        errorCode: 'SMTP_ECONNREFUSED',
        now: '2026-11-12T15:20:01.000Z',
      }),
    );
    expect(await inWorker(ws, () => deliveries.due(ws, '2026-11-12T15:20:30.000Z', 10))).toEqual([]);
    const due = await inWorker(ws, () => deliveries.due(ws, '2026-11-12T15:21:00.000Z', 10));
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ status: 'RETRY', attempts: 1, lastErrorCode: 'SMTP_ECONNREFUSED' });
    await claim(ws, deliveryId, '2026-11-12T15:21:00.000Z', '2026-11-12T15:23:00.000Z');
    await inWorker(ws, () =>
      deliveries.release({
        id: deliveryId,
        notBefore: '2026-11-13T11:00:00.000Z',
        now: '2026-11-12T15:21:01.000Z',
      }),
    );
    expect(await inWorker(ws, () => deliveries.find(ws, deliveryId))).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      notBefore: '2026-11-13T11:00:00.000Z',
    });
    // Un SENDING con el lease expirado también aparece como vencido (el proceso cayó).
    await claim(ws, deliveryId, '2026-11-13T11:00:00.000Z', '2026-11-13T11:02:00.000Z');
    expect(await inWorker(ws, () => deliveries.due(ws, '2026-11-13T11:05:00.000Z', 10))).toHaveLength(1);
    await inWorker(ws, () =>
      deliveries.markFailed({ id: deliveryId, errorCode: 'SMTP_550', now: '2026-11-13T11:06:00.000Z' }),
    );
    expect(await inWorker(ws, () => deliveries.find(ws, deliveryId))).toMatchObject({
      status: 'FAILED',
      lastErrorCode: 'SMTP_550',
    });
    expect(await inWorker(ws, () => deliveries.due(ws, '2026-11-14T00:00:00.000Z', 10))).toEqual([]);
  });

  it('[TC-NOTIFICATIONS-EMAIL-007] una entrega suprimida guarda el motivo; no se puede suprimir sin motivo (CHECK)', async () => {
    const { ws, deliveryId } = await pending();
    await claim(ws, deliveryId, '2026-11-12T15:20:00.000Z', '2026-11-12T15:22:00.000Z');
    await inWorker(ws, () =>
      deliveries.markSuppressed({
        id: deliveryId,
        reason: 'CHANNEL_DISABLED',
        now: '2026-11-12T15:20:01.000Z',
      }),
    );
    expect(await inWorker(ws, () => deliveries.find(ws, deliveryId))).toMatchObject({
      status: 'SUPPRESSED',
      suppressionReason: 'CHANNEL_DISABLED',
    });
    await expect(
      inWorker(ws, () =>
        requireSqlExecutor().query(
          `UPDATE notifications.notification_delivery SET status = 'SUPPRESSED', suppression_reason = NULL WHERE id = $1`,
          [deliveryId],
        ),
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('una sola entrega por notificación y canal (UNIQUE), y el estado agregado solo lo ve el dueño de la notificación', async () => {
    const { ws, n, deliveryId } = await pending();
    await expect(
      inWorker(ws, () =>
        deliveries.insert({
          id: randomUUID(),
          workspaceId: ws,
          notificationId: n.id,
          notBefore: n.createdAt,
          now: n.createdAt,
        }),
      ),
    ).rejects.toMatchObject({ code: '23505' });
    expect((await asUser(owner, ws, () => deliveries.statuses(ws, [n.id]))).get(n.id)).toBe('PENDING');
    expect((await asUser(viewer, ws, () => deliveries.statuses(ws, [n.id]))).size).toBe(0);
    // pf_app no lee columnas internas de la entrega (lease, proveedor, error).
    await expect(
      asUser(owner, ws, () =>
        requireSqlExecutor().query(
          'SELECT lease_until FROM notifications.notification_delivery WHERE id = $1',
          [deliveryId],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    // El worker sin el contexto del workspace no ve nada.
    const other = await newWorkspace();
    expect(await inWorker(other, () => deliveries.find(other, deliveryId))).toBeNull();
  });
});

describe('PgPreferencesRepository', () => {
  it('[TC-NOTIFICATIONS-PREFS-003] sin filas devuelve los valores por defecto (versión 1)', async () => {
    const ws = await newWorkspace();
    const prefs = await asUser(owner, ws, () => preferences.load(ws, owner));
    expect(prefs.toView()).toEqual({
      types: [
        { type: 'BUDGET_THRESHOLD', inApp: true, email: true },
        { type: 'MONTH_CLOSE_PENDING', inApp: true, email: true },
      ],
      quietHours: null,
      includeDetailsInEmail: false,
    });
    expect(prefs.version).toBe(1);
    expect(prefs.persistedVersion).toBe(0);
  });

  it('[TC-NOTIFICATIONS-PREFS-001] guarda tipo × canal, horario y detalles, y el worker las lee por workspace', async () => {
    const ws = await newWorkspace();
    await asUser(owner, ws, async () => {
      const prefs = await preferences.load(ws, owner);
      prefs.update({
        types: [{ type: 'BUDGET_THRESHOLD', inApp: true, email: false }],
        quietHours: { start: '22:00', end: '07:00' },
        includeDetailsInEmail: true,
      });
      expect(await preferences.save(prefs)).toBe(true);
    });
    const seenByWorker = await inWorker(ws, () => preferences.loadMany(ws, [owner, viewer]));
    const ownerPrefs = seenByWorker.get(owner)!;
    expect(ownerPrefs.isEnabled('BUDGET_THRESHOLD', 'EMAIL')).toBe(false);
    expect(ownerPrefs.isEnabled('BUDGET_THRESHOLD', 'IN_APP')).toBe(true);
    expect(ownerPrefs.isEnabled('MONTH_CLOSE_PENDING', 'EMAIL')).toBe(true);
    expect(ownerPrefs.snapshot.quietHours).toEqual({ start: '22:00', end: '07:00' });
    expect(ownerPrefs.includeDetailsInEmail).toBe(true);
    expect(ownerPrefs.version).toBe(2);
    // El VIEWER no tiene filas: valores por defecto, no los del OWNER.
    expect(seenByWorker.get(viewer)!.isEnabled('BUDGET_THRESHOLD', 'EMAIL')).toBe(true);
    // El VIEWER, como usuario, no puede leer las del OWNER.
    const spied = await asUser(viewer, ws, () => preferences.load(ws, owner));
    expect(spied.snapshot.quietHours).toBeNull();
  });

  it('bloqueo optimista: dos guardados con la misma versión, solo uno gana', async () => {
    const ws = await newWorkspace();
    // Ambos leen la misma versión y luego guardan a la vez. Esa versión depende de si el workspace ya tenía
    // fila de ajustes (0 = valores por defecto sin persistir), así que el test no la fija.
    const loaded = await Promise.all(
      [true, false].map(async (email) => {
        const prefs = await asUser(owner, ws, () => preferences.load(ws, owner));
        prefs.update({
          types: [{ type: 'MONTH_CLOSE_PENDING', inApp: true, email }],
          quietHours: null,
          includeDetailsInEmail: false,
        });
        return prefs;
      }),
    );
    const readVersion = loaded[0]!.persistedVersion;
    expect(loaded[1]!.persistedVersion).toBe(readVersion);
    const results = await Promise.all(
      loaded.map((prefs) => asUser(owner, ws, () => preferences.save(prefs))),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = loaded[results.indexOf(true)]!;
    expect(winner.version).toBeGreaterThan(readVersion);
    expect((await asUser(owner, ws, () => preferences.load(ws, owner))).version).toBe(winner.version);
    // El perdedor, con la versión desactualizada, se rechaza también en un segundo intento.
    const stale = NotificationPreferences.restore({
      userId: owner,
      workspaceId: ws,
      byType: {},
      quietHours: null,
      includeDetailsInEmail: true,
      version: readVersion,
    });
    stale.update({ types: [], quietHours: null, includeDetailsInEmail: false });
    expect(await asUser(owner, ws, () => preferences.save(stale))).toBe(false);
  });

  it('no se aceptan filas para otro usuario ni otro workspace (WITH CHECK)', async () => {
    const ws = await newWorkspace();
    await expect(
      asUser(viewer, ws, () =>
        requireSqlExecutor().query(
          `INSERT INTO notifications.user_setting (workspace_id, user_id) VALUES ($1, $2)`,
          [ws, owner],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
