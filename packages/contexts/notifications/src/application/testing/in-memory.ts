import type { AuditEntry } from '@pf/audit/contracts';
import type { CategoryTreeDto } from '@pf/classification/contracts';
import type { WorkspaceRecipientDto } from '@pf/identity/contracts';
import { FixedClock, Instant } from '@pf/shared-kernel';
import {
  NotificationPreferences,
  archive as archiveState,
  markRead as markReadState,
  type NotificationState,
  type NotificationStatus,
} from '../../domain/index.js';
import {
  PermanentEmailError,
  RetryableEmailError,
  DEFAULT_BACKOFF_MS,
  DEFAULT_LEASE_MS,
  type DeliveryRepository,
  type DeliveryState,
  type DeliveryStatus,
  type DispatchConfig,
  type DispatchDeps,
  type EmailMessage,
  type EmailSender,
  type InboxDeps,
  type InboxPosition,
  type NotificationMetricsPort,
  type NotificationRepository,
  type NotifyDeps,
  type PreferencesDeps,
  type PreferencesRepository,
  type SuppressionReason,
} from '../ports/index.js';

/** Dobles en memoria de los puertos de NOTIFY (mismas garantías que PostgreSQL: unicidad, claim y lease). */

export const WS = '01928c4e-0000-7000-8000-00000000a001';
export const OWNER = '01928c4e-0000-7000-8000-0000000ea001';
export const EDITOR = '01928c4e-0000-7000-8000-0000000ea002';
export const VIEWER = '01928c4e-0000-7000-8000-0000000ea003';

export class InMemoryNotifications implements NotificationRepository {
  readonly rows = new Map<string, NotificationState>();
  /** Notificaciones borradas por la purga (para verificar el borrado en cascada de entregas). */
  constructor(private readonly onDelete: (ids: readonly string[]) => void = () => undefined) {}

  insertIfAbsent(n: NotificationState): Promise<boolean> {
    const exists = [...this.rows.values()].some(
      (r) => r.workspaceId === n.workspaceId && r.userId === n.userId && r.dedupeKey === n.dedupeKey,
    );
    if (exists) return Promise.resolve(false);
    this.rows.set(n.id, n);
    return Promise.resolve(true);
  }

  findOwn(workspaceId: string, userId: string, id: string): Promise<NotificationState | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row && row.workspaceId === workspaceId && row.userId === userId ? row : null);
  }

  findById(workspaceId: string, id: string): Promise<NotificationState | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row && row.workspaceId === workspaceId ? row : null);
  }

  list(input: {
    workspaceId: string;
    userId: string;
    statuses: readonly NotificationStatus[];
    after?: InboxPosition;
    limit: number;
  }): Promise<readonly NotificationState[]> {
    const rows = [...this.rows.values()]
      .filter(
        (r) =>
          r.workspaceId === input.workspaceId &&
          r.userId === input.userId &&
          input.statuses.includes(r.status),
      )
      .sort((a, b) =>
        a.createdAt === b.createdAt ? b.id.localeCompare(a.id) : b.createdAt.localeCompare(a.createdAt),
      )
      .filter((r) => {
        const after = input.after;
        if (!after) return true;
        return r.createdAt < after.createdAt || (r.createdAt === after.createdAt && r.id < after.id);
      });
    return Promise.resolve(rows.slice(0, input.limit));
  }

  unreadCount(workspaceId: string, userId: string): Promise<number> {
    return Promise.resolve(
      [...this.rows.values()].filter(
        (r) => r.workspaceId === workspaceId && r.userId === userId && r.status === 'UNREAD',
      ).length,
    );
  }

  markRead(workspaceId: string, userId: string, id: string, now: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.workspaceId !== workspaceId || row.userId !== userId) return Promise.resolve(false);
    this.rows.set(id, markReadState(row, now));
    return Promise.resolve(true);
  }

  markAllRead(workspaceId: string, userId: string, now: string): Promise<number> {
    let updated = 0;
    for (const [id, row] of this.rows) {
      if (row.workspaceId === workspaceId && row.userId === userId && row.status === 'UNREAD') {
        this.rows.set(id, markReadState(row, now));
        updated += 1;
      }
    }
    return Promise.resolve(updated);
  }

  archive(workspaceId: string, userId: string, id: string, now: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.workspaceId !== workspaceId || row.userId !== userId) return Promise.resolve(false);
    this.rows.set(id, archiveState(row, now));
    return Promise.resolve(true);
  }

  deleteCreatedBefore(workspaceId: string, cutoff: string): Promise<number> {
    const doomed = [...this.rows.values()].filter(
      (r) => r.workspaceId === workspaceId && r.createdAt < cutoff,
    );
    for (const r of doomed) this.rows.delete(r.id);
    this.onDelete(doomed.map((r) => r.id));
    return Promise.resolve(doomed.length);
  }
}

interface MutableDelivery {
  id: string;
  workspaceId: string;
  notificationId: string;
  status: DeliveryStatus;
  suppressionReason: SuppressionReason | null;
  notBefore: string;
  attempts: number;
  leaseUntil: string | null;
  providerMessageId: string | null;
  lastErrorCode: string | null;
}

export class InMemoryDeliveries implements DeliveryRepository {
  readonly rows = new Map<string, MutableDelivery>();

  insert(input: {
    id: string;
    workspaceId: string;
    notificationId: string;
    notBefore: string;
  }): Promise<void> {
    if ([...this.rows.values()].some((d) => d.notificationId === input.notificationId)) {
      return Promise.reject(new Error('unique (notification_id, channel) violated'));
    }
    this.rows.set(input.id, {
      id: input.id,
      workspaceId: input.workspaceId,
      notificationId: input.notificationId,
      status: 'PENDING',
      suppressionReason: null,
      notBefore: input.notBefore,
      attempts: 0,
      leaseUntil: null,
      providerMessageId: null,
      lastErrorCode: null,
    });
    return Promise.resolve();
  }

  find(workspaceId: string, id: string): Promise<DeliveryState | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row && row.workspaceId === workspaceId ? { ...row } : null);
  }

  /** Atómico: JS es monohilo entre `await`s, igual que el `UPDATE … WHERE` de PostgreSQL. */
  claim(input: {
    workspaceId: string;
    id: string;
    now: string;
    leaseUntil: string;
  }): Promise<DeliveryState | null> {
    const row = this.rows.get(input.id);
    if (!row || row.workspaceId !== input.workspaceId) return Promise.resolve(null);
    const claimable =
      ((row.status === 'PENDING' || row.status === 'RETRY') && row.notBefore <= input.now) ||
      (row.status === 'SENDING' && row.leaseUntil !== null && row.leaseUntil < input.now);
    if (!claimable) return Promise.resolve(null);
    row.status = 'SENDING';
    row.attempts += 1;
    row.leaseUntil = input.leaseUntil;
    return Promise.resolve({ ...row });
  }

  markSent(input: { id: string; providerMessageId: string }): Promise<void> {
    const row = this.mustGet(input.id);
    row.status = 'SENT';
    row.providerMessageId = input.providerMessageId;
    row.leaseUntil = null;
    row.lastErrorCode = null;
    return Promise.resolve();
  }

  release(input: { id: string; notBefore: string }): Promise<void> {
    const row = this.mustGet(input.id);
    row.status = 'PENDING';
    row.attempts = Math.max(0, row.attempts - 1);
    row.notBefore = input.notBefore;
    row.leaseUntil = null;
    return Promise.resolve();
  }

  markRetry(input: { id: string; notBefore: string; errorCode: string }): Promise<void> {
    const row = this.mustGet(input.id);
    row.status = 'RETRY';
    row.notBefore = input.notBefore;
    row.leaseUntil = null;
    row.lastErrorCode = input.errorCode;
    return Promise.resolve();
  }

  markFailed(input: { id: string; errorCode: string }): Promise<void> {
    const row = this.mustGet(input.id);
    row.status = 'FAILED';
    row.leaseUntil = null;
    row.lastErrorCode = input.errorCode;
    return Promise.resolve();
  }

  markSuppressed(input: { id: string; reason: SuppressionReason }): Promise<void> {
    const row = this.mustGet(input.id);
    row.status = 'SUPPRESSED';
    row.suppressionReason = input.reason;
    row.leaseUntil = null;
    return Promise.resolve();
  }

  due(workspaceId: string, olderThan: string, limit: number): Promise<readonly DeliveryState[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter(
          (d) =>
            d.workspaceId === workspaceId &&
            (((d.status === 'PENDING' || d.status === 'RETRY') && d.notBefore <= olderThan) ||
              (d.status === 'SENDING' && d.leaseUntil !== null && d.leaseUntil < olderThan)),
        )
        .slice(0, limit)
        .map((d) => ({ ...d })),
    );
  }

  statuses(
    workspaceId: string,
    notificationIds: readonly string[],
  ): Promise<ReadonlyMap<string, DeliveryStatus>> {
    const out = new Map<string, DeliveryStatus>();
    for (const d of this.rows.values()) {
      if (d.workspaceId === workspaceId && notificationIds.includes(d.notificationId)) {
        out.set(d.notificationId, d.status);
      }
    }
    return Promise.resolve(out);
  }

  /** Borra las entregas de las notificaciones purgadas. */
  dropFor(notificationIds: readonly string[]): void {
    for (const [id, d] of this.rows) if (notificationIds.includes(d.notificationId)) this.rows.delete(id);
  }

  byNotification(notificationId: string): MutableDelivery | undefined {
    return [...this.rows.values()].find((d) => d.notificationId === notificationId);
  }

  private mustGet(id: string): MutableDelivery {
    const row = this.rows.get(id);
    if (!row) throw new Error(`delivery ${id} not found`);
    return row;
  }
}

export class InMemoryPreferences implements PreferencesRepository {
  readonly rows = new Map<string, NotificationPreferences>();
  private key = (workspaceId: string, userId: string) => `${workspaceId}:${userId}`;

  load(workspaceId: string, userId: string): Promise<NotificationPreferences> {
    const stored = this.rows.get(this.key(workspaceId, userId));
    return Promise.resolve(
      stored
        ? NotificationPreferences.restore(stored.snapshot)
        : NotificationPreferences.defaults(userId, workspaceId),
    );
  }

  async loadMany(
    workspaceId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, NotificationPreferences>> {
    const out = new Map<string, NotificationPreferences>();
    for (const id of userIds) out.set(id, await this.load(workspaceId, id));
    return out;
  }

  save(prefs: NotificationPreferences): Promise<boolean> {
    const { workspaceId, userId } = prefs.snapshot;
    const current = this.rows.get(this.key(workspaceId, userId));
    const persisted = current ? current.snapshot.version : 0;
    if (persisted !== prefs.persistedVersion) return Promise.resolve(false);
    this.rows.set(this.key(workspaceId, userId), NotificationPreferences.restore(prefs.snapshot));
    return Promise.resolve(true);
  }
}

export interface RecordedJob {
  readonly deliveryId: string;
  readonly workspaceId: string;
  readonly startAfter: Date | null;
  readonly first: boolean;
}

export class RecordingScheduler {
  readonly jobs: RecordedJob[] = [];
  schedule(input: RecordedJob): Promise<void> {
    this.jobs.push(input);
    return Promise.resolve();
  }
}

export class FakeEmailSender implements EmailSender {
  driver: 'smtp' | 'none' = 'smtp';
  readonly sent: EmailMessage[] = [];
  /** Errores a lanzar en los próximos envíos (cola); vacía = aceptar. */
  failures: (Error | null)[] = [];
  /** Cuando es true, todo envío falla con un error reintentable. */
  down = false;

  send(message: EmailMessage): Promise<{ providerMessageId: string }> {
    const next = this.failures.shift();
    if (next) return Promise.reject(next);
    if (this.down) return Promise.reject(new RetryableEmailError('SMTP_CONNECTION'));
    this.sent.push(message);
    return Promise.resolve({ providerMessageId: message.messageId });
  }

  rejectPermanently(): void {
    this.failures.push(new PermanentEmailError('SMTP_550'));
  }
}

export class RecordingMetrics implements NotificationMetricsPort {
  readonly created_: string[] = [];
  readonly emailDeliveries: string[] = [];
  readonly lags: { type: string; seconds: number }[] = [];
  created(type: string): void {
    this.created_.push(type);
  }
  emailDelivery(status: 'sent' | 'retry' | 'failed' | 'suppressed'): void {
    this.emailDeliveries.push(status);
  }
  lagSeconds(type: string, seconds: number): void {
    this.lags.push({ type, seconds });
  }
}

export class RecordingLogger {
  readonly lines: { level: 'info' | 'warn'; fields: Record<string, unknown>; message: string }[] = [];
  info(fields: Readonly<Record<string, unknown>>, message: string): void {
    this.lines.push({ level: 'info', fields: { ...fields }, message });
  }
  warn(fields: Readonly<Record<string, unknown>>, message: string): void {
    this.lines.push({ level: 'warn', fields: { ...fields }, message });
  }
}

export interface Member extends WorkspaceRecipientDto {
  readonly email: string | null;
}

export class InMemoryRecipients {
  members: Member[] = [];
  activeMembers(workspaceId: string): Promise<readonly WorkspaceRecipientDto[]> {
    void workspaceId;
    return Promise.resolve(
      this.members.map(({ userId, role, locale, timeZone }) => ({ userId, role, locale, timeZone })),
    );
  }
  emailFor(userId: string): Promise<string | null> {
    return Promise.resolve(this.members.find((m) => m.userId === userId)?.email ?? null);
  }
}

export const RESTAURANTS_ID = '01928c4e-0000-7000-8000-0000000ca003';

export const emptyTree = (): CategoryTreeDto => ({ groups: [], categories: [], tags: [] });

export const treeWithRestaurants = (name = 'Restaurantes'): CategoryTreeDto => ({
  groups: [],
  categories: [
    {
      categoryId: RESTAURANTS_ID,
      name,
      kind: 'EXPENSE',
      groupId: '01928c4e-0000-7000-8000-0000000c0001',
      parentId: null,
      systemCode: null,
      archived: false,
    },
  ],
  tags: [],
});

/** Entorno completo: reloj fijo, miembros OWNER/EDITOR/VIEWER y todos los puertos en memoria. */
export class NotificationsTestEnv {
  readonly clock = new FixedClock(Instant.parse('2026-11-12T15:20:00Z'));
  readonly notifications: InMemoryNotifications;
  readonly deliveries = new InMemoryDeliveries();
  readonly preferences = new InMemoryPreferences();
  readonly recipients = new InMemoryRecipients();
  readonly scheduler = new RecordingScheduler();
  readonly sender = new FakeEmailSender();
  readonly metrics = new RecordingMetrics();
  readonly logger = new RecordingLogger();
  readonly audit: AuditEntry[] = [];
  readonly locales = new Map<string, string>();
  tree: CategoryTreeDto = treeWithRestaurants();
  private counter = 0;

  readonly config: DispatchConfig = {
    messageIdDomain: 'pfos.local',
    appPublicUrl: 'https://app.pfos.test',
    maxAttempts: 5,
    backoffMs: DEFAULT_BACKOFF_MS,
    leaseMs: DEFAULT_LEASE_MS,
  };

  constructor() {
    this.notifications = new InMemoryNotifications((ids) => this.deliveries.dropFor(ids));
    this.recipients.members = [
      { userId: OWNER, role: 'OWNER', locale: 'es-BO', timeZone: 'America/La_Paz', email: 'owner@pfos.test' },
      {
        userId: EDITOR,
        role: 'EDITOR',
        locale: 'pt-BR',
        timeZone: 'America/La_Paz',
        email: 'editor@pfos.test',
      },
      {
        userId: VIEWER,
        role: 'VIEWER',
        locale: 'fr-FR',
        timeZone: 'America/La_Paz',
        email: 'viewer@pfos.test',
      },
    ];
    for (const m of this.recipients.members) this.locales.set(m.userId, m.locale);
  }

  readonly uow = { run: <T>(_workspaceId: string, fn: () => Promise<T>): Promise<T> => fn() };
  readonly ids = {
    next: (): string => {
      this.counter += 1;
      return `01928c4e-0000-7000-8000-${String(this.counter).padStart(12, '0')}`;
    },
  };

  notifyDeps(): NotifyDeps {
    return {
      uow: this.uow,
      notifications: this.notifications,
      deliveries: this.deliveries,
      preferences: this.preferences,
      recipients: this.recipients,
      scheduler: this.scheduler,
      ids: this.ids,
      clock: this.clock,
      metrics: this.metrics,
    };
  }

  dispatchDeps(): DispatchDeps {
    return {
      uow: this.uow,
      notifications: this.notifications,
      deliveries: this.deliveries,
      preferences: this.preferences,
      recipients: this.recipients,
      catalog: { categoryTree: () => Promise.resolve(this.tree) },
      sender: this.sender,
      scheduler: this.scheduler,
      clock: this.clock,
      metrics: this.metrics,
      logger: this.logger,
      config: this.config,
      ids: this.ids,
    };
  }

  inboxDeps(): InboxDeps {
    return {
      uow: this.uow,
      notifications: this.notifications,
      deliveries: this.deliveries,
      locales: { localeOf: (userId: string) => Promise.resolve(this.locales.get(userId) ?? 'es-BO') },
      catalog: { categoryTree: () => Promise.resolve(this.tree) },
      clock: this.clock,
    };
  }

  preferencesDeps(): PreferencesDeps {
    return {
      uow: this.uow,
      preferences: this.preferences,
      audit: { append: (entry) => Promise.resolve(void this.audit.push(entry)) },
      clock: this.clock,
    };
  }
}
