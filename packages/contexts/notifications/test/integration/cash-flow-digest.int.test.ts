import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { InboxQueries } from '../../src/application/inbox.queries.js';
import { NotificationIntake } from '../../src/application/notification-intake.js';
import type { NotificationMetricsPort, NotifyDeps } from '../../src/application/ports/index.js';
import { PreferencesService } from '../../src/application/preferences.service.js';
import { SendHomeDigests } from '../../src/application/send-home-digests.js';
import type { HomeDigestSnapshot, NotificationIntakeFact } from '../../src/contracts/index.js';
import {
  PgDeliveryRepository,
  PgNotificationRepository,
  PgNotificationsUnitOfWork,
  PgPreferencesRepository,
  uuidV7Ids,
} from '../../src/infrastructure/pg-notifications.js';

// Riesgo de déficit y digest del Home sobre PostgreSQL real (add-cash-flow-forecast): TC-NOTIFICATIONS-SHORTFALL-002 y
// TC-NOTIFICATIONS-DIGEST-001, 003, 005, 006. Los repositorios son los reales; el contenido del Home (REPORTING) y el
// calendario del workspace son dobles.
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
const scheduled: { deliveryId: string; startAfter: Date | null }[] = [];

async function provision(label: string): Promise<string> {
  const { rows } = await migrator.query<{ id: string }>(
    `SELECT iam.provision_user('https://idp.test/notify-digest', $1, $2, $3) AS id`,
    [`sub-${label}-${randomUUID()}`, `${label}-${randomUUID().slice(0, 8)}@demo.pfos.test`, label],
  );
  return rows[0]!.id;
}

const members = () => [
  { userId: owner, role: 'OWNER' as const, locale: 'es-BO', timeZone: 'America/La_Paz' },
  { userId: editor, role: 'EDITOR' as const, locale: 'pt-BR', timeZone: 'America/La_Paz' },
  { userId: viewer, role: 'VIEWER' as const, locale: 'es-BO', timeZone: 'America/La_Paz' },
];

function notifyDeps(clock: FixedClock): NotifyDeps {
  return {
    uow: new PgNotificationsUnitOfWork(worker),
    notifications: new PgNotificationRepository(),
    deliveries: new PgDeliveryRepository(),
    preferences: new PgPreferencesRepository(),
    recipients: { activeMembers: () => Promise.resolve(members()) },
    scheduler: {
      schedule: (job) => {
        scheduled.push({ deliveryId: job.deliveryId, startAfter: job.startAfter });
        return Promise.resolve();
      },
    },
    ids: uuidV7Ids,
    clock,
    metrics,
  };
}

const empty = { counts: {}, percents: {}, dates: {}, states: {}, amounts: {} };
const snapshot = (): HomeDigestSnapshot => ({
  workspaceId: ws,
  generatedAt: '2026-11-02T12:05:00.000Z',
  timeZone: 'America/La_Paz',
  today: '2026-11-02',
  reportingCurrency: 'BOB',
  questions: (['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'] as const).map((question) => ({
    ...empty,
    question,
    status: 'AVAILABLE' as const,
    counts: question === 'Q8' ? { upcoming7d: 3 } : {},
    percents: question === 'Q6' ? { savingsRate: '41.5' } : {},
    amounts: question === 'Q5' ? { spendable: { amount: '5521.00', currency: 'BOB' } } : {},
  })),
});

let composed = 0;
function digests(clock: FixedClock, fiscalMonthStartDay = 1) {
  return new SendHomeDigests({
    ...notifyDeps(clock),
    calendar: { calendarOf: () => Promise.resolve({ timeZone: 'America/La_Paz', fiscalMonthStartDay }) },
    source: {
      compose: () => {
        composed += 1;
        return Promise.resolve(snapshot());
      },
    },
  });
}

/** Elige la frecuencia del digest en `user_setting` (como lo haría la API) con el rol de migración. */
async function chooseDigest(user: string, frequency: string, details = false): Promise<void> {
  await superuser.query(
    `INSERT INTO notifications.user_setting (workspace_id, user_id, include_details_in_email, digest_frequency)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET digest_frequency = $4, include_details_in_email = $3`,
    [ws, user, details, frequency],
  );
}

/** Unidad de trabajo de la API: transacción con RLS de workspace y del usuario de la petición. */
const userUow = (userId: string) => ({
  run: <T>(workspaceId: string, fn: () => Promise<T>) => appUow.run({ userId, workspaceId }, fn),
});

/** Vacía el estado del digest del workspace compartido: cada prueba parte sin suscriptores ni digests previos. */
async function resetDigest(): Promise<void> {
  await superuser.query(
    `DELETE FROM notifications.notification_delivery WHERE workspace_id = $1 AND notification_id IN
       (SELECT id FROM notifications.notification WHERE workspace_id = $1 AND notification_type = 'HOME_DIGEST')`,
    [ws],
  );
  await superuser.query(
    `DELETE FROM notifications.notification WHERE workspace_id = $1 AND notification_type = 'HOME_DIGEST'`,
    [ws],
  );
  await superuser.query(`DELETE FROM notifications.user_setting WHERE workspace_id = $1`, [ws]);
}

const digestRows = (user: string) =>
  superuser
    .query<{
      status: string;
      dedupe_key: string;
      archived_at: string | null;
      params: Record<string, unknown>;
    }>(
      `SELECT status, dedupe_key, archived_at::text, params FROM notifications.notification
        WHERE workspace_id = $1 AND user_id = $2 AND notification_type = 'HOME_DIGEST' ORDER BY dedupe_key`,
      [ws, user],
    )
    .then((r) => r.rows);

const shortfall = (episodeId: string, over: Record<string, unknown> = {}): NotificationIntakeFact =>
  ({
    workspaceId: ws,
    type: 'CASH_FLOW_SHORTFALL_RISK',
    factKey: episodeId,
    sourceEventId: randomUUID(),
    occurredAt: '2026-10-20T12:25:00.000Z',
    payload: {
      episodeId,
      currency: 'BOB',
      horizonDays: 30,
      firstShortfallDate: '2026-11-01',
      lowest: { amount: '-679.00', currency: 'BOB' },
      lowestDate: '2026-11-01',
      threshold: { amount: '1500.00', currency: 'BOB' },
      belowZero: true,
      detectedAt: '2026-10-20T12:25:00.000Z',
      timeZone: 'America/La_Paz',
      ...over,
    },
  }) as unknown as NotificationIntakeFact;

beforeAll(async () => {
  app = new Pool({ connectionString: deps.databaseUrl, max: 4 });
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 12 });
  migrator = new Pool({ connectionString: deps.migratorUrl, max: 2 });
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
      `INSERT INTO iam.workspace (id, name, base_currency, time_zone, locale) VALUES ($1, 'Digest', 'BOB', 'America/La_Paz', 'es-BO')`,
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

describe('Riesgo de déficit sobre PostgreSQL', () => {
  it('[TC-NOTIFICATIONS-SHORTFALL-002] el mismo episodio entregado dos veces y desde ocho transacciones a la vez deja una notificación crítica por OWNER y EDITOR', async () => {
    const clock = new FixedClock(Instant.parse('2026-10-20T12:25:00Z'));
    const intake = () => new NotificationIntake(notifyDeps(clock));
    const episodeId = randomUUID();
    expect(await intake().notify(shortfall(episodeId))).toEqual({ created: 2, refreshed: 0, deliveries: 2 });
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () => intake().notify(shortfall(episodeId))),
    );
    expect(concurrent.reduce((n, o) => n + o.created, 0)).toBe(0);
    const { rows } = await superuser.query<{
      user_id: string;
      severity: string;
      dedupe_key: string;
      link: { kind: string; currency: string; horizonDays: number };
    }>(
      `SELECT user_id::text, severity, dedupe_key, link FROM notifications.notification
        WHERE workspace_id = $1 AND dedupe_key = $2 ORDER BY user_id`,
      [ws, `CASH_FLOW_SHORTFALL_RISK:${episodeId}`],
    );
    expect(rows.map((r) => r.user_id).sort()).toEqual([owner, editor].sort());
    expect(rows.every((r) => r.severity === 'CRITICAL')).toBe(true);
    expect(rows[0]?.link).toMatchObject({ kind: 'CASH_FLOW_CALENDAR', currency: 'BOB', horizonDays: 30 });
  });

  it('[TC-NOTIFICATIONS-SHORTFALL-002] un episodio cerrado no notifica y uno nuevo genera una notificación nueva por destinatario', async () => {
    const clock = new FixedClock(Instant.parse('2026-10-20T12:25:00Z'));
    const intake = new NotificationIntake(notifyDeps(clock));
    const first = randomUUID();
    const second = randomUUID();
    await intake.notify(shortfall(first));
    // El cierre no pasa por NOTIFY: solo hay un episodio nuevo después.
    expect(
      await intake.notify(
        shortfall(second, { lowest: { amount: '621.00', currency: 'BOB' }, belowZero: false }),
      ),
    ).toEqual({
      created: 2,
      refreshed: 0,
      deliveries: 2,
    });
    const { rows } = await superuser.query<{ severity: string }>(
      `SELECT severity FROM notifications.notification WHERE workspace_id = $1 AND dedupe_key = $2 AND user_id = $3`,
      [ws, `CASH_FLOW_SHORTFALL_RISK:${second}`, owner],
    );
    expect(rows).toEqual([{ severity: 'WARNING' }]);
  });
});

describe('Frecuencia del digest sobre PostgreSQL', () => {
  it('[TC-NOTIFICATIONS-DIGEST-001] la frecuencia se guarda, se audita con el valor anterior y una inválida no cambia nada', async () => {
    const user = await provision('prefs');
    await superuser.query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'EDITOR')`,
      [ws, user],
    );
    const audit: { changes?: readonly { field: string; before: unknown; after: unknown }[] }[] = [];
    const service = new PreferencesService({
      uow: userUow(user),
      preferences: new PgPreferencesRepository(),
      audit: { append: (entry) => Promise.resolve(void audit.push(entry)) },
      clock: new FixedClock(Instant.parse('2026-11-02T12:05:00Z')),
    });
    const as = <T>(fn: () => Promise<T>) => fn();
    const saved = await as(() =>
      service.update({
        workspaceId: ws,
        userId: user,
        expectedVersion: 1,
        preferences: { types: [], quietHours: null, includeDetailsInEmail: false, digestFrequency: 'WEEKLY' },
      }),
    );
    expect(saved).toMatchObject({ digestFrequency: 'WEEKLY', version: 2 });
    expect(audit[0]?.changes).toEqual([{ field: 'digestFrequency', before: 'OFF', after: 'WEEKLY' }]);
    await expect(
      as(() =>
        service.update({
          workspaceId: ws,
          userId: user,
          expectedVersion: 2,
          preferences: {
            types: [],
            quietHours: null,
            includeDetailsInEmail: false,
            digestFrequency: 'DAILY',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await as(() => service.get(ws, user))).digestFrequency).toBe('WEEKLY');
    // La restricción de la columna también la protege contra un valor ajeno.
    await expect(
      superuser.query(`UPDATE notifications.user_setting SET digest_frequency = 'DAILY' WHERE user_id = $1`, [
        user,
      ]),
    ).rejects.toMatchObject({ code: '23514' });
    const subscribers = await new PgNotificationsUnitOfWork(worker).run(ws, () =>
      new PgPreferencesRepository().digestSubscribers(ws),
    );
    expect(subscribers).toContainEqual({ userId: user, frequency: 'WEEKLY' });
  });
});

describe('Digest del Home sobre PostgreSQL', () => {
  it('[TC-NOTIFICATIONS-DIGEST-005] el lunes crea un digest ARCHIVED por destinatario, fuera del centro y del contador, y un segundo pase no lo duplica', async () => {
    await resetDigest();
    await chooseDigest(owner, 'WEEKLY');
    await chooseDigest(viewer, 'WEEKLY');
    const clock = new FixedClock(Instant.parse('2026-11-02T12:05:00Z'));
    const before = composed;
    const unreadBefore = await new PgNotificationsUnitOfWork(worker).run(ws, () =>
      new PgNotificationRepository().unreadCount(ws, owner),
    );
    expect(await digests(clock).run(ws)).toMatchObject({ created: 2 });
    clock.set(Instant.parse('2026-11-02T13:05:00Z'));
    expect(await digests(clock).run(ws)).toEqual({ created: 0, deliveries: 0 });
    expect(composed - before).toBe(1);
    for (const user of [owner, viewer]) {
      const rows = await digestRows(user);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'ARCHIVED', dedupe_key: 'HOME_DIGEST:WEEKLY:2026-W45' });
      expect(rows[0]?.archived_at).not.toBeNull();
      expect(JSON.stringify(rows[0]?.params)).not.toMatch(/5521/);
    }
    // Ni el centro (por omisión solo UNREAD/READ) ni el contador lo muestran.
    const inbox = new InboxQueries({
      uow: userUow(owner),
      notifications: new PgNotificationRepository(),
      deliveries: new PgDeliveryRepository(),
      locales: { localeOf: () => Promise.resolve('es-BO') },
      catalog: { categoryTree: () => Promise.resolve({ groups: [], categories: [], tags: [] }) },
      clock,
    });
    const listed = await inbox.list({ workspaceId: ws, userId: owner, limit: 50 });
    expect(listed.filter((n) => n.type === 'HOME_DIGEST')).toEqual([]);
    const unread = await inbox.getUnreadCount(ws, owner);
    // El contador solo cuenta UNREAD (los avisos de déficit de las pruebas anteriores): el digest no suma.
    expect(unread).toBe(unreadBefore);
  });

  it('[TC-NOTIFICATIONS-DIGEST-006] el digest no enviado se recupera el miércoles de la misma semana y el lunes siguiente solo sale el de la semana nueva', async () => {
    await resetDigest();
    await chooseDigest(owner, 'WEEKLY');
    // El worker estuvo caído el lunes: el miércoles 10:00 se recupera el digest de la semana W45.
    const clock = new FixedClock(Instant.parse('2026-11-04T14:00:00Z'));
    expect(await digests(clock).run(ws)).toMatchObject({ created: 1 });
    // Recién el lunes siguiente vuelve: sale el de la semana nueva y el de W45 sigue siendo uno solo.
    clock.set(Instant.parse('2026-11-09T12:05:00Z'));
    expect(await digests(clock).run(ws)).toMatchObject({ created: 1 });
    expect((await digestRows(owner)).map((r) => r.dedupe_key)).toEqual([
      'HOME_DIGEST:WEEKLY:2026-W45',
      'HOME_DIGEST:WEEKLY:2026-W46',
    ]);
  });

  it('[TC-NOTIFICATIONS-DIGEST-003] el digest mensual con día de inicio 25 sale el 2026-10-25 y no se repite el 2026-11-01', async () => {
    await resetDigest();
    await chooseDigest(editor, 'MONTHLY', true);
    const clock = new FixedClock(Instant.parse('2026-10-25T12:05:00Z'));
    expect(await digests(clock, 25).run(ws)).toMatchObject({ created: 1 });
    clock.set(Instant.parse('2026-11-01T12:05:00Z'));
    expect(await digests(clock, 25).run(ws)).toEqual({ created: 0, deliveries: 0 });
    const rows = await digestRows(editor);
    expect(rows.map((r) => r.dedupe_key)).toEqual(['HOME_DIGEST:MONTHLY:2026-10']);
    // Con el opt-in de detalles el contenido guardado lleva los montos del Home.
    expect(JSON.stringify(rows[0]?.params)).toContain('5521.00');
  });

  it('[TC-NOTIFICATIONS-DIGEST-005] con silencio de 22:00 a 09:00 la entrega del digest queda programada a las 09:00 de La Paz', async () => {
    await resetDigest();
    const quiet = await provision('quiet');
    await superuser.query(
      `INSERT INTO iam.workspace_membership (workspace_id, user_id, role) VALUES ($1, $2, 'VIEWER')`,
      [ws, quiet],
    );
    await superuser.query(
      `INSERT INTO notifications.user_setting (workspace_id, user_id, quiet_hours_start, quiet_hours_end, digest_frequency)
       VALUES ($1, $2, '22:00', '09:00', 'WEEKLY')`,
      [ws, quiet],
    );
    const clock = new FixedClock(Instant.parse('2026-11-02T12:05:00Z'));
    scheduled.length = 0;
    const service = new SendHomeDigests({
      ...notifyDeps(clock),
      recipients: {
        activeMembers: () =>
          Promise.resolve([{ userId: quiet, role: 'VIEWER', locale: 'es-BO', timeZone: 'America/La_Paz' }]),
      },
      calendar: { calendarOf: () => Promise.resolve({ timeZone: 'America/La_Paz', fiscalMonthStartDay: 1 }) },
      source: { compose: () => Promise.resolve(snapshot()) },
    });
    expect(await service.run(ws)).toEqual({ created: 1, deliveries: 1 });
    expect(scheduled.at(-1)?.startAfter?.toISOString()).toBe('2026-11-02T13:00:00.000Z');
  });
});
