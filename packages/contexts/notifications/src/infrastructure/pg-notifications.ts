import { currentRequestContext, PgUnitOfWork, unitOfWorkKysely } from '@pf/platform/api';
import { uuidv7 } from '@pf/platform/logging';
import { sql, type Kysely } from 'kysely';
import type { Pool } from 'pg';
import type {
  DeliveryRepository,
  DeliveryState,
  DeliveryStatus,
  IdGenerator,
  InboxPosition,
  NotificationRepository,
  PreferencesRepository,
  SuppressionReason,
  UnitOfWork,
} from '../application/ports/index.js';
import {
  NotificationPreferences,
  NOTIFICATION_CHANNELS,
  isNotificationType,
  type NotificationLink,
  type NotificationParams,
  type NotificationSeverity,
  type NotificationState,
  type NotificationStatus,
  type NotificationType,
  type TypePreference,
} from '../domain/index.js';

/** Los repositorios usan SQL crudo con `sql`: las tablas se acceden por nombre cualificado sobre la unidad de trabajo. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type NoDb = {};
const db = (): Kysely<NoDb> => unitOfWorkKysely<NoDb>();

/** Instante como texto RFC 3339 UTC con milisegundos (evita el parser `timestamptz` → `Date` local de `pg`). */
const instantText = (column: string) =>
  sql<string>`to_char(${sql.ref(column)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

const instantOrNull = (column: string) =>
  sql<string | null>`CASE WHEN ${sql.ref(column)} IS NULL THEN NULL ELSE ${instantText(column)} END`;

// ───────────────────────────────────────────────────────────────────────── notificaciones

interface NotificationRow {
  id: string;
  workspace_id: string;
  user_id: string;
  notification_type: string;
  severity: string;
  message_key: string;
  params: NotificationParams;
  link: NotificationLink;
  dedupe_key: string;
  source_event_id: string;
  status: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
}

const notificationColumns = sql`
  id, workspace_id, user_id, notification_type, severity, message_key, params, link, dedupe_key, source_event_id,
  status, ${instantText('created_at')} AS created_at, ${instantOrNull('read_at')} AS read_at,
  ${instantOrNull('archived_at')} AS archived_at`;

function toNotification(row: NotificationRow): NotificationState {
  if (!isNotificationType(row.notification_type)) {
    throw new Error(`unknown notification type ${row.notification_type}`);
  }
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    type: row.notification_type satisfies NotificationType,
    severity: row.severity as NotificationSeverity,
    messageKey: row.message_key,
    params: row.params,
    link: row.link,
    dedupeKey: row.dedupe_key,
    sourceEventId: row.source_event_id,
    status: row.status as NotificationStatus,
    createdAt: row.created_at,
    readAt: row.read_at,
    archivedAt: row.archived_at,
  };
}

/**
 * Repositorio de notificaciones sobre la unidad de trabajo en curso (RLS de workspace y de usuario ya fijada).
 * Las sentencias son atómicas (`UPDATE … WHERE status = …`): ningún leer-modificar-escribir en la aplicación.
 */
export class PgNotificationRepository implements NotificationRepository {
  async insertIfAbsent(n: NotificationState): Promise<boolean> {
    const { rows } = await sql<{ id: string }>`
      INSERT INTO notifications.notification
        (id, workspace_id, user_id, notification_type, severity, message_key, params, link, dedupe_key,
         source_event_id, status, created_at)
      VALUES (${n.id}, ${n.workspaceId}, ${n.userId}, ${n.type}, ${n.severity}, ${n.messageKey},
              ${JSON.stringify(n.params)}::jsonb, ${JSON.stringify(n.link)}::jsonb, ${n.dedupeKey},
              ${n.sourceEventId}, 'UNREAD', ${n.createdAt}::timestamptz)
      ON CONFLICT (workspace_id, user_id, dedupe_key) DO NOTHING
      RETURNING id`.execute(db());
    return rows.length > 0;
  }

  async findOwn(workspaceId: string, userId: string, id: string): Promise<NotificationState | null> {
    const { rows } = await sql<NotificationRow>`
      SELECT ${notificationColumns} FROM notifications.notification
       WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND id = ${id}`.execute(db());
    return rows[0] ? toNotification(rows[0]) : null;
  }

  async findById(workspaceId: string, id: string): Promise<NotificationState | null> {
    const { rows } = await sql<NotificationRow>`
      SELECT ${notificationColumns} FROM notifications.notification
       WHERE workspace_id = ${workspaceId} AND id = ${id}`.execute(db());
    return rows[0] ? toNotification(rows[0]) : null;
  }

  async list(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly statuses: readonly NotificationStatus[];
    readonly after?: InboxPosition;
    readonly limit: number;
  }): Promise<readonly NotificationState[]> {
    const after = input.after
      ? sql`AND (created_at, id) < (${input.after.createdAt}::timestamptz, ${input.after.id}::uuid)`
      : sql``;
    const { rows } = await sql<NotificationRow>`
      SELECT ${notificationColumns} FROM notifications.notification
       WHERE workspace_id = ${input.workspaceId} AND user_id = ${input.userId}
         AND status = ANY(${[...input.statuses]}::text[]) ${after}
       ORDER BY created_at DESC, id DESC
       LIMIT ${input.limit}`.execute(db());
    return rows.map(toNotification);
  }

  async unreadCount(workspaceId: string, userId: string): Promise<number> {
    const { rows } = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM notifications.notification
       WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND status = 'UNREAD'`.execute(db());
    return Number(rows[0]?.n ?? 0);
  }

  async markRead(workspaceId: string, userId: string, id: string, now: string): Promise<boolean> {
    const updated = await sql`
      UPDATE notifications.notification SET status = 'READ', read_at = ${now}::timestamptz
       WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND id = ${id} AND status = 'UNREAD'`.execute(
      db(),
    );
    if ((updated.numAffectedRows ?? 0n) > 0n) return true;
    return (await this.findOwn(workspaceId, userId, id)) !== null;
  }

  async markAllRead(workspaceId: string, userId: string, now: string): Promise<number> {
    const updated = await sql`
      UPDATE notifications.notification SET status = 'READ', read_at = ${now}::timestamptz
       WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND status = 'UNREAD'`.execute(db());
    return Number(updated.numAffectedRows ?? 0n);
  }

  async archive(workspaceId: string, userId: string, id: string, now: string): Promise<boolean> {
    const updated = await sql`
      UPDATE notifications.notification SET status = 'ARCHIVED', archived_at = ${now}::timestamptz
       WHERE workspace_id = ${workspaceId} AND user_id = ${userId} AND id = ${id} AND status <> 'ARCHIVED'`.execute(
      db(),
    );
    if ((updated.numAffectedRows ?? 0n) > 0n) return true;
    return (await this.findOwn(workspaceId, userId, id)) !== null;
  }

  async deleteCreatedBefore(workspaceId: string, cutoff: string): Promise<number> {
    await sql`
      DELETE FROM notifications.notification_delivery d
            USING notifications.notification n
        WHERE d.workspace_id = ${workspaceId} AND n.workspace_id = d.workspace_id AND n.id = d.notification_id
          AND n.created_at < ${cutoff}::timestamptz`.execute(db());
    const deleted = await sql`
      DELETE FROM notifications.notification
       WHERE workspace_id = ${workspaceId} AND created_at < ${cutoff}::timestamptz`.execute(db());
    return Number(deleted.numAffectedRows ?? 0n);
  }
}

// ───────────────────────────────────────────────────────────────────────── entregas

interface DeliveryRow {
  id: string;
  workspace_id: string;
  notification_id: string;
  status: DeliveryStatus;
  suppression_reason: SuppressionReason | null;
  not_before: string;
  attempts: number;
  lease_until: string | null;
  provider_message_id: string | null;
  last_error_code: string | null;
}

const deliveryColumns = sql`
  id, workspace_id, notification_id, status, suppression_reason, ${instantText('not_before')} AS not_before,
  attempts, ${instantOrNull('lease_until')} AS lease_until, provider_message_id, last_error_code`;

const toDelivery = (row: DeliveryRow): DeliveryState => ({
  id: row.id,
  workspaceId: row.workspace_id,
  notificationId: row.notification_id,
  status: row.status,
  suppressionReason: row.suppression_reason,
  notBefore: row.not_before,
  attempts: Number(row.attempts),
  leaseUntil: row.lease_until,
  providerMessageId: row.provider_message_id,
  lastErrorCode: row.last_error_code,
});

/**
 * Repositorio de entregas por email (solo el worker, salvo `statuses`). Todo cambio de estado es una sola sentencia
 * `UPDATE` y el *claim* es el árbitro de la entrega única: `status IN ('PENDING','RETRY')` vencida o `SENDING` con el
 * lease expirado ⇒ `SENDING`, `attempts + 1` y lease nuevo. Los instantes vienen del reloj de la aplicación.
 */
export class PgDeliveryRepository implements DeliveryRepository {
  async insert(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly notificationId: string;
    readonly notBefore: string;
    readonly now: string;
  }): Promise<void> {
    await sql`
      INSERT INTO notifications.notification_delivery
        (id, workspace_id, notification_id, channel, status, not_before, attempts, created_at, updated_at)
      VALUES (${input.id}, ${input.workspaceId}, ${input.notificationId}, 'EMAIL', 'PENDING',
              ${input.notBefore}::timestamptz, 0, ${input.now}::timestamptz, ${input.now}::timestamptz)`.execute(
      db(),
    );
  }

  async find(workspaceId: string, id: string): Promise<DeliveryState | null> {
    const { rows } = await sql<DeliveryRow>`
      SELECT ${deliveryColumns} FROM notifications.notification_delivery
       WHERE workspace_id = ${workspaceId} AND id = ${id}`.execute(db());
    return rows[0] ? toDelivery(rows[0]) : null;
  }

  async claim(input: {
    readonly workspaceId: string;
    readonly id: string;
    readonly now: string;
    readonly leaseUntil: string;
  }): Promise<DeliveryState | null> {
    const { rows } = await sql<DeliveryRow>`
      UPDATE notifications.notification_delivery
         SET status = 'SENDING', attempts = attempts + 1, lease_until = ${input.leaseUntil}::timestamptz,
             updated_at = ${input.now}::timestamptz
       WHERE workspace_id = ${input.workspaceId} AND id = ${input.id}
         AND ((status IN ('PENDING', 'RETRY') AND not_before <= ${input.now}::timestamptz)
              OR (status = 'SENDING' AND lease_until < ${input.now}::timestamptz))
      RETURNING ${deliveryColumns}`.execute(db());
    return rows[0] ? toDelivery(rows[0]) : null;
  }

  async markSent(input: {
    readonly id: string;
    readonly provider: string;
    readonly providerMessageId: string;
    readonly now: string;
  }): Promise<void> {
    await sql`
      UPDATE notifications.notification_delivery
         SET status = 'SENT', provider = ${input.provider}, provider_message_id = ${input.providerMessageId},
             sent_at = ${input.now}::timestamptz, lease_until = NULL, last_error_code = NULL,
             updated_at = ${input.now}::timestamptz
       WHERE id = ${input.id}`.execute(db());
  }

  async release(input: {
    readonly id: string;
    readonly notBefore: string;
    readonly now: string;
  }): Promise<void> {
    await sql`
      UPDATE notifications.notification_delivery
         SET status = 'PENDING', attempts = greatest(attempts - 1, 0), not_before = ${input.notBefore}::timestamptz,
             lease_until = NULL, updated_at = ${input.now}::timestamptz
       WHERE id = ${input.id}`.execute(db());
  }

  async markRetry(input: {
    readonly id: string;
    readonly notBefore: string;
    readonly errorCode: string;
    readonly now: string;
  }): Promise<void> {
    await sql`
      UPDATE notifications.notification_delivery
         SET status = 'RETRY', not_before = ${input.notBefore}::timestamptz, lease_until = NULL,
             last_error_code = ${input.errorCode}, updated_at = ${input.now}::timestamptz
       WHERE id = ${input.id}`.execute(db());
  }

  async markFailed(input: {
    readonly id: string;
    readonly errorCode: string;
    readonly now: string;
  }): Promise<void> {
    await sql`
      UPDATE notifications.notification_delivery
         SET status = 'FAILED', lease_until = NULL, last_error_code = ${input.errorCode},
             updated_at = ${input.now}::timestamptz
       WHERE id = ${input.id}`.execute(db());
  }

  async markSuppressed(input: {
    readonly id: string;
    readonly reason: SuppressionReason;
    readonly now: string;
  }): Promise<void> {
    await sql`
      UPDATE notifications.notification_delivery
         SET status = 'SUPPRESSED', suppression_reason = ${input.reason}, lease_until = NULL,
             updated_at = ${input.now}::timestamptz
       WHERE id = ${input.id}`.execute(db());
  }

  async due(workspaceId: string, olderThan: string, limit: number): Promise<readonly DeliveryState[]> {
    const { rows } = await sql<DeliveryRow>`
      SELECT ${deliveryColumns} FROM notifications.notification_delivery
       WHERE workspace_id = ${workspaceId}
         AND ((status IN ('PENDING', 'RETRY') AND not_before <= ${olderThan}::timestamptz)
              OR (status = 'SENDING' AND lease_until < ${olderThan}::timestamptz))
       ORDER BY not_before
       LIMIT ${limit}`.execute(db());
    return rows.map(toDelivery);
  }

  /** Solo columnas visibles para `pf_app` (estado agregado de las entregas de SUS notificaciones). */
  async statuses(
    workspaceId: string,
    notificationIds: readonly string[],
  ): Promise<ReadonlyMap<string, DeliveryStatus>> {
    if (notificationIds.length === 0) return new Map();
    const { rows } = await sql<{ notification_id: string; status: DeliveryStatus }>`
      SELECT notification_id, status FROM notifications.notification_delivery
       WHERE workspace_id = ${workspaceId} AND channel = 'EMAIL'
         AND notification_id = ANY(${[...notificationIds]}::uuid[])`.execute(db());
    return new Map(rows.map((r) => [r.notification_id, r.status]));
  }
}

// ───────────────────────────────────────────────────────────────────────── preferencias

interface PreferenceRow {
  user_id: string;
  notification_type: string;
  channel: string;
  enabled: boolean;
}

interface SettingRow {
  user_id: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  include_details_in_email: boolean;
  version: number;
}

function buildPreferences(
  workspaceId: string,
  userId: string,
  settings: SettingRow | undefined,
  rows: readonly PreferenceRow[],
): NotificationPreferences {
  if (!settings && rows.length === 0) return NotificationPreferences.defaults(userId, workspaceId);
  const byType: Partial<Record<NotificationType, TypePreference>> = {};
  for (const row of rows) {
    if (!isNotificationType(row.notification_type)) continue; // tipo retirado del catálogo: se ignora
    const current = byType[row.notification_type] ?? { inApp: true, email: true };
    byType[row.notification_type] =
      row.channel === 'IN_APP' ? { ...current, inApp: row.enabled } : { ...current, email: row.enabled };
  }
  return NotificationPreferences.restore({
    userId,
    workspaceId,
    byType,
    quietHours:
      settings?.quiet_hours_start && settings.quiet_hours_end
        ? { start: settings.quiet_hours_start, end: settings.quiet_hours_end }
        : null,
    includeDetailsInEmail: settings?.include_details_in_email ?? false,
    version: Number(settings?.version ?? 1),
  });
}

/**
 * Preferencias (`notification_preference` + `user_setting`): la ausencia de fila equivale a "activado". El ETag es la
 * versión de `user_setting` (se crea en el primer guardado); el bloqueo optimista es `UPDATE … WHERE version = …`.
 */
export class PgPreferencesRepository implements PreferencesRepository {
  async load(workspaceId: string, userId: string): Promise<NotificationPreferences> {
    return (
      (await this.loadMany(workspaceId, [userId])).get(userId) ??
      NotificationPreferences.defaults(userId, workspaceId)
    );
  }

  async loadMany(
    workspaceId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, NotificationPreferences>> {
    const out = new Map<string, NotificationPreferences>();
    if (userIds.length === 0) return out;
    const ids = [...userIds];
    const [settings, prefs] = await Promise.all([
      sql<SettingRow>`
        SELECT user_id, to_char(quiet_hours_start, 'HH24:MI') AS quiet_hours_start,
               to_char(quiet_hours_end, 'HH24:MI') AS quiet_hours_end, include_details_in_email, version
          FROM notifications.user_setting
         WHERE workspace_id = ${workspaceId} AND user_id = ANY(${ids}::uuid[])`.execute(db()),
      sql<PreferenceRow>`
        SELECT user_id, notification_type, channel, enabled FROM notifications.notification_preference
         WHERE workspace_id = ${workspaceId} AND user_id = ANY(${ids}::uuid[])`.execute(db()),
    ]);
    for (const userId of ids) {
      out.set(
        userId,
        buildPreferences(
          workspaceId,
          userId,
          settings.rows.find((r) => r.user_id === userId),
          prefs.rows.filter((r) => r.user_id === userId),
        ),
      );
    }
    return out;
  }

  async save(preferences: NotificationPreferences): Promise<boolean> {
    const s = preferences.snapshot;
    const quiet = s.quietHours;
    if (preferences.persistedVersion === 0) {
      const inserted = await sql`
        INSERT INTO notifications.user_setting
          (workspace_id, user_id, quiet_hours_start, quiet_hours_end, include_details_in_email, version)
        VALUES (${s.workspaceId}, ${s.userId}, ${quiet?.start ?? null}::time, ${quiet?.end ?? null}::time,
                ${s.includeDetailsInEmail}, ${s.version})
        ON CONFLICT (workspace_id, user_id) DO NOTHING`.execute(db());
      if ((inserted.numAffectedRows ?? 0n) === 0n) return false;
    } else {
      const updated = await sql`
        UPDATE notifications.user_setting
           SET quiet_hours_start = ${quiet?.start ?? null}::time, quiet_hours_end = ${quiet?.end ?? null}::time,
               include_details_in_email = ${s.includeDetailsInEmail}, version = ${s.version}, updated_at = now()
         WHERE workspace_id = ${s.workspaceId} AND user_id = ${s.userId} AND version = ${preferences.persistedVersion}`.execute(
        db(),
      );
      if ((updated.numAffectedRows ?? 0n) === 0n) return false;
    }
    for (const [type, pref] of Object.entries(s.byType)) {
      for (const channel of NOTIFICATION_CHANNELS) {
        const enabled = channel === 'IN_APP' ? pref.inApp : pref.email;
        await sql`
          INSERT INTO notifications.notification_preference
            (workspace_id, user_id, notification_type, channel, enabled)
          VALUES (${s.workspaceId}, ${s.userId}, ${type}, ${channel}, ${enabled})
          ON CONFLICT (workspace_id, user_id, notification_type, channel)
          DO UPDATE SET enabled = EXCLUDED.enabled,
                        version = notifications.notification_preference.version + 1, updated_at = now()`.execute(
          db(),
        );
      }
    }
    return true;
  }
}

// ───────────────────────────────────────────────────────────────────────── unidad de trabajo

/**
 * Unidad de trabajo de NOTIFY: transacción PG con el contexto RLS del workspace y del usuario de la petición (sin
 * usuario en el worker); reutiliza la transacción del llamador (consumidor con inbox).
 */
export class PgNotificationsUnitOfWork implements UnitOfWork {
  private readonly uow: PgUnitOfWork;

  constructor(pool: Pool) {
    this.uow = new PgUnitOfWork(pool);
  }

  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const actor = currentRequestContext()?.actor;
    const userId = actor && actor.type === 'USER' ? actor.userId : null;
    return this.uow.run({ userId, workspaceId }, fn);
  }
}

export const uuidV7Ids: IdGenerator = { next: () => uuidv7() };
