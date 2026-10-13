import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { NotificationIntake } from '../../src/application/notification-intake.js';
import type { NotificationMetricsPort } from '../../src/application/ports/index.js';
import type { NotificationIntakeFact } from '../../src/contracts/index.js';
import {
  PgDeliveryRepository,
  PgNotificationRepository,
  PgNotificationsUnitOfWork,
  PgPreferencesRepository,
  uuidV7Ids,
} from '../../src/infrastructure/pg-notifications.js';

// NotificationIntakePort sobre PostgreSQL real (add-rate-feed-alerts, tareas 3.1 y 4.5; TC-NOTIFICATIONS-FX-002):
// el mismo hecho entregado dos veces, también desde dos transacciones a la vez, deja una sola notificación y una sola
// entrega por destinatario; el VIEWER no recibe nada; RLS por workspace.
declare module 'vitest' {
  export interface ProvidedContext {
    deps: { readonly databaseUrl: string; readonly migratorUrl: string; readonly workerDatabaseUrl: string };
  }
}

const deps = inject('deps');
let app: Pool;
let worker: Pool;
let migrator: Pool;
let superuser: Pool;
let appUow: PgUnitOfWork;
let owner: string;
let editor: string;
let viewer: string;
const ws = randomUUID();
const metrics: NotificationMetricsPort = {
  created: () => undefined,
  refreshed: () => undefined,
  emailDelivery: () => undefined,
  lagSeconds: () => undefined,
};
const scheduled: string[] = [];

async function provision(label: string): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/notify-intake', $1, $2, $3) AS id`,
    [`sub-${label}-${randomUUID()}`, `${label}-${randomUUID().slice(0, 8)}@demo.pfos.test`, label],
  );
  return rows[0]!.id;
}

function intake() {
  return new NotificationIntake({
    uow: new PgNotificationsUnitOfWork(worker),
    notifications: new PgNotificationRepository(),
    deliveries: new PgDeliveryRepository(),
    preferences: new PgPreferencesRepository(),
    recipients: {
      activeMembers: async () => [
        { userId: owner, role: 'OWNER', locale: 'es-BO', timeZone: 'America/La_Paz' },
        { userId: editor, role: 'EDITOR', locale: 'pt-BR', timeZone: 'America/La_Paz' },
        { userId: viewer, role: 'VIEWER', locale: 'es-BO', timeZone: 'America/La_Paz' },
      ],
    },
    scheduler: {
      schedule: async (job) => {
        scheduled.push(job.deliveryId);
      },
    },
    ids: uuidV7Ids,
    clock: new FixedClock(Instant.parse('2026-10-13T14:15:00Z')),
    metrics,
  });
}

const fact = (episodeId: string, over: Partial<NotificationIntakeFact> = {}): NotificationIntakeFact =>
  ({
    workspaceId: ws,
    type: 'FX_RATE_FEED_STALE',
    factKey: episodeId,
    sourceEventId: randomUUID(),
    occurredAt: '2026-10-13T14:15:00.000Z',
    payload: {
      episodeId,
      base: 'USDT',
      quote: 'BOB',
      lastRateAsOf: '2026-10-13T08:00:00.000Z',
      staleAfterSeconds: 21600,
      detectedAt: '2026-10-13T14:15:00.000Z',
      timeZone: 'America/La_Paz',
    },
    ...over,
  }) as unknown as NotificationIntakeFact;

const rows = (episodeId: string) =>
  superuser
    .query<{ user_id: string; type: string; severity: string; dedupe_key: string; link: { kind: string } }>(
      `SELECT user_id::text, notification_type AS type, severity, dedupe_key, link
         FROM notifications.notification WHERE workspace_id = $1 AND dedupe_key LIKE $2 ORDER BY user_id`,
      [ws, `%${episodeId}`],
    )
    .then((r) => r.rows);

const deliveriesOf = (episodeId: string) =>
  superuser
    .query<{ n: string }>(
      `SELECT count(*)::text AS n FROM notifications.notification_delivery d
         JOIN notifications.notification n ON n.id = d.notification_id
        WHERE n.workspace_id = $1 AND n.dedupe_key LIKE $2`,
      [ws, `%${episodeId}`],
    )
    .then((r) => Number(r.rows[0]?.n));

// ───────────────────────────────────────────────────────────────────────────── aviso agrupado de muestras retenidas

const baselineId = randomUUID();
const groupFact = (
  anchor: string,
  over: { pending?: number; lastRetainedAt?: string; reviewRateId?: string } = {},
): NotificationIntakeFact => {
  const pending = over.pending ?? 3;
  const lastRetainedAt = over.lastRetainedAt ?? '2026-10-13T14:00:00.000Z';
  return {
    workspaceId: ws,
    type: 'FX_RATE_ANOMALY_RETAINED',
    factKey: anchor,
    sourceEventId: randomUUID(),
    occurredAt: lastRetainedAt,
    payload: {
      anchorRateId: anchor,
      base: 'USDT',
      quote: 'BOB',
      pendingCount: pending,
      retainedCount: pending,
      providers: ['PARALELO_BO'],
      reviewRateId: over.reviewRateId ?? anchor,
      peak: {
        rateId: anchor,
        base: 'USDT',
        quote: 'BOB',
        rateType: 'PARALLEL_SELL',
        provider: 'PARALELO_BO',
        value: '12.90',
        baselineRateId: baselineId,
        baselineValue: '12.10',
        variationPct: '6.6116',
        thresholdPct: '5',
        detectedAt: lastRetainedAt,
        timeZone: 'America/La_Paz',
      },
      firstRetainedAt: '2026-10-13T14:00:00.000Z',
      lastRetainedAt,
      detectedAt: lastRetainedAt,
      timeZone: 'America/La_Paz',
    },
  } as unknown as NotificationIntakeFact;
};

interface GroupRow {
  user_id: string;
  status: string;
  message_key: string;
  created_at: string;
  pending: number;
  last: string;
  review: string;
}
const groupRows = (anchor: string) =>
  superuser
    .query<GroupRow>(
      `SELECT user_id::text, status, message_key, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
              (params->>'pendingCount')::int AS pending, params->>'lastRetainedAt' AS last, link->>'fxRateId' AS review
         FROM notifications.notification WHERE workspace_id = $1 AND dedupe_key = $2 ORDER BY user_id`,
      [ws, `fx-rate-anomaly-retained:${anchor}`],
    )
    .then((r) => r.rows);

const markReadAsUser = (user: string, anchor: string) =>
  appUow.run({ userId: user, workspaceId: ws }, async () => {
    await requireSqlExecutor().query(
      `UPDATE notifications.notification SET status = 'READ', read_at = now()
        WHERE workspace_id = $1 AND user_id = $2 AND dedupe_key = $3`,
      [ws, user, `fx-rate-anomaly-retained:${anchor}`],
    );
  });

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 12 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
  // Superusuario del harness (ignora RLS): solo para contar filas en las pruebas.
  superuser = new Pool({
    connectionString: (deps as unknown as { superuserUrl: string }).superuserUrl,
    max: 2,
  });
  appUow = new PgUnitOfWork(app);
  owner = await provision('owner');
  editor = await provision('editor');
  viewer = await provision('viewer');
  await appUow.run({ userId: owner, workspaceId: ws }, async () => {
    const tx = requireSqlExecutor();
    await tx.query(
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Intake', 'BOB', 'America/La_Paz', 'es-BO')`,
      [ws],
    );
    for (const [user, role] of [
      [owner, 'OWNER'],
      [editor, 'EDITOR'],
      [viewer, 'VIEWER'],
    ] as const) {
      await tx.query(
        `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, $3)`,
        [ws, user, role],
      );
    }
  });
});

afterAll(async () => {
  await Promise.all([app?.end(), worker?.end(), migrator?.end(), superuser?.end()]);
});

describe('NotificationIntake sobre PostgreSQL', () => {
  it('[TC-NOTIFICATIONS-FX-002] el mismo episodio entregado dos veces, y desde ocho transacciones a la vez, deja una notificación y una entrega por destinatario', async () => {
    const episodeId = randomUUID();
    expect(await intake().notify(fact(episodeId))).toEqual({ created: 2, refreshed: 0, deliveries: 2 });
    expect(await intake().notify(fact(episodeId))).toEqual({ created: 0, refreshed: 0, deliveries: 0 });
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => intake().notify(fact(episodeId))));
    expect(concurrent.reduce((n, o) => n + o.created, 0)).toBe(0);
    const rowsNow = await rows(episodeId);
    expect(rowsNow.map((r) => r.user_id).sort()).toEqual([owner, editor].sort());
    expect(rowsNow.every((r) => r.type === 'FX_RATE_FEED_STALE' && r.severity === 'WARNING')).toBe(true);
    expect(rowsNow[0]?.link.kind).toBe('FX_FEED_STATUS');
    expect(await deliveriesOf(episodeId)).toBe(2);
  });

  it('[TC-NOTIFICATIONS-FX-002] ocho transacciones a la vez con un episodio NUEVO crean exactamente una notificación por destinatario', async () => {
    const episodeId = randomUUID();
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => intake().notify(fact(episodeId))));
    expect(outcomes.reduce((n, o) => n + o.created, 0)).toBe(2);
    expect((await rows(episodeId)).length).toBe(2);
    expect(await deliveriesOf(episodeId)).toBe(2);
  });

  it('[TC-NOTIFICATIONS-FX-009] un hecho mal formado lanza y no deja nada escrito', async () => {
    const episodeId = randomUUID();
    await expect(
      intake().notify(fact(episodeId, { payload: { episodeId, base: 'usdt' } as never })),
    ).rejects.toThrow(/base|detectedAt/);
    expect(await rows(episodeId)).toHaveLength(0);
  });

  it('[TC-NOTIFICATIONS-FX-001] la notificación de un workspace no se ve desde el contexto de otro (RLS)', async () => {
    const episodeId = randomUUID();
    await intake().notify(fact(episodeId));
    const other = randomUUID();
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.workspace_id', $1, true), set_config('app.user_id', $2, true)`, [
        other,
        owner,
      ]);
      const r = await c.query(`SELECT 1 FROM notifications.notification WHERE dedupe_key LIKE $1`, [
        `%${episodeId}`,
      ]);
      expect(r.rowCount).toBe(0);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});

describe('Aviso agrupado de muestras retenidas sobre PostgreSQL (refine-rate-anomaly-alert-grouping)', () => {
  it('[TC-NOTIFICATIONS-FX-011] la foto siguiente del grupo actualiza el aviso de cada destinatario sin crear otro ni programar otro email', async () => {
    const anchor = randomUUID();
    expect(await intake().notify(groupFact(anchor, { pending: 3 }))).toEqual({
      created: 2,
      refreshed: 0,
      deliveries: 2,
    });
    const reviewRateId = randomUUID();
    const next = await intake().notify(
      groupFact(anchor, { pending: 5, lastRetainedAt: '2026-10-13T14:00:01.000Z', reviewRateId }),
    );
    expect(next).toEqual({ created: 0, refreshed: 2, deliveries: 0 });
    const after = await groupRows(anchor);
    expect(after).toHaveLength(2);
    for (const row of after) {
      expect(row).toMatchObject({
        status: 'UNREAD',
        message_key: 'notifications.fx_rate_anomaly_retained.v2',
        pending: 5,
        review: reviewRateId,
      });
    }
    expect(await deliveriesOf(anchor)).toBe(2);
  });

  it('[TC-NOTIFICATIONS-FX-016] la misma foto entregada otra vez deja la fila igual y una foto más vieja no retrocede la cantidad', async () => {
    const anchor = randomUUID();
    await intake().notify(groupFact(anchor, { pending: 4, lastRetainedAt: '2026-10-13T14:10:00.000Z' }));
    const before = await groupRows(anchor);
    const same = await intake().notify(
      groupFact(anchor, { pending: 4, lastRetainedAt: '2026-10-13T14:10:00.000Z' }),
    );
    expect(same.created).toBe(0);
    expect(await groupRows(anchor)).toEqual(before);
    // Foto fuera de orden: más vieja, con menos muestras.
    const stale = await intake().notify(
      groupFact(anchor, { pending: 2, lastRetainedAt: '2026-10-13T14:05:00.000Z' }),
    );
    expect(stale).toEqual({ created: 0, refreshed: 0, deliveries: 0 });
    expect((await groupRows(anchor)).map((r) => r.pending)).toEqual([4, 4]);
  });

  it('[TC-NOTIFICATIONS-FX-017] actualizar un aviso ya leído conserva su estado de lectura y su fecha de creación', async () => {
    const anchor = randomUUID();
    await intake().notify(groupFact(anchor, { pending: 3 }));
    await markReadAsUser(editor, anchor);
    const before = (await groupRows(anchor)).find((r) => r.user_id === editor);
    expect(before?.status).toBe('READ');
    const out = await intake().notify(
      groupFact(anchor, { pending: 6, lastRetainedAt: '2026-10-13T14:20:00.000Z' }),
    );
    expect(out.refreshed).toBe(2);
    const after = await groupRows(anchor);
    const editorRow = after.find((r) => r.user_id === editor);
    expect(editorRow).toMatchObject({ status: 'READ', pending: 6, created_at: before?.created_at });
    expect(after.find((r) => r.user_id === owner)?.status).toBe('UNREAD');
  });

  it('[TC-NOTIFICATIONS-FX-011] ocho transacciones a la vez con el mismo grupo dejan un aviso por destinatario y un solo email', async () => {
    const anchor = randomUUID();
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        intake().notify(groupFact(anchor, { pending: 3, lastRetainedAt: `2026-10-13T14:00:0${i}.000Z` })),
      ),
    );
    expect(outcomes.reduce((n, o) => n + o.created, 0)).toBe(2);
    expect(outcomes.reduce((n, o) => n + o.deliveries, 0)).toBe(2);
    expect(await groupRows(anchor)).toHaveLength(2);
    expect(await deliveriesOf(anchor)).toBe(2);
    expect(new Set((await groupRows(anchor)).map((r) => r.last))).toEqual(
      new Set(['2026-10-13T14:00:07.000Z']),
    );
  });

  it('[TC-NOTIFICATIONS-FX-018] el aviso v1 de la muestra más antigua pasa a ser el aviso del grupo sin crear otro ni otro email', async () => {
    const anchor = randomUUID();
    const user = owner;
    // Aviso v1 (una por muestra, anterior a la agrupación): misma dedupeKey `fx-rate-anomaly-retained:<rateId>`.
    await superuser.query(
      `INSERT INTO notifications.notification
         (id, workspace_id, user_id, notification_type, severity, message_key, params, link, dedupe_key, source_event_id, status, created_at)
       VALUES ($1, $2, $3, 'FX_RATE_ANOMALY_RETAINED', 'WARNING', 'notifications.fx_rate_anomaly_retained.v1',
               '{"rateId": "x", "base": "USDT", "quote": "BOB"}'::jsonb, $4::jsonb, $5, $6, 'UNREAD', '2026-10-13T13:00:00Z')`,
      [
        randomUUID(),
        ws,
        user,
        JSON.stringify({ kind: 'FX_RATE', fxRateId: anchor, periodId: anchor, periodLabel: '2026-10' }),
        `fx-rate-anomaly-retained:${anchor}`,
        randomUUID(),
      ],
    );
    const out = await intake().notify(groupFact(anchor, { pending: 4 }));
    // El OWNER ya tenía el v1: se actualiza; el EDITOR no lo tenía: se crea con su email.
    expect(out).toEqual({ created: 1, refreshed: 1, deliveries: 1 });
    const ownerRow = (await groupRows(anchor)).find((r) => r.user_id === owner);
    expect(ownerRow).toMatchObject({
      message_key: 'notifications.fx_rate_anomaly_retained.v2',
      pending: 4,
      created_at: '2026-10-13T13:00:00.000Z',
    });
  });

  it('[TC-NOTIFICATIONS-FX-017] el worker solo puede actualizar params, message_key y link: nunca el estado de lectura', async () => {
    const anchor = randomUUID();
    await intake().notify(groupFact(anchor, { pending: 3 }));
    const c = await worker.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.workspace_id', $1, true)`, [ws]);
      await expect(
        c.query(
          `UPDATE notifications.notification SET status = 'READ', read_at = now() WHERE workspace_id = $1`,
          [ws],
        ),
      ).rejects.toThrow(/permission denied/);
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});
