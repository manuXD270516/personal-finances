import type { AuditPort } from '@pf/audit/contracts';
import type { CategoryCatalogQuery } from '@pf/classification/contracts';
import type { WorkspaceRecipientsQuery } from '@pf/identity/contracts';
import type { Clock } from '@pf/shared-kernel';
import type { NotificationPreferences, NotificationState, NotificationStatus } from '../../domain/index.js';

export type { AuditPort, CategoryCatalogQuery, WorkspaceRecipientsQuery };

/** Unidad de trabajo por workspace (RLS del workspace y, en la API, del usuario de la petición). */
export interface UnitOfWork {
  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}

export interface IdGenerator {
  next(): string;
}

// ─────────────────────────────────────────────────────────────────────────── bandeja

export interface InboxPosition {
  readonly createdAt: string;
  readonly id: string;
}

export interface NotificationRepository {
  /** `INSERT … ON CONFLICT (workspace_id, user_id, dedupe_key) DO NOTHING`: `true` si se insertó (decisión 2). */
  insertIfAbsent(notification: NotificationState): Promise<boolean>;
  findOwn(workspaceId: string, userId: string, id: string): Promise<NotificationState | null>;
  findById(workspaceId: string, id: string): Promise<NotificationState | null>;
  /** Más reciente primero (`created_at DESC, id DESC`); el llamador pide `limit + 1` para saber si hay más. */
  list(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly statuses: readonly NotificationStatus[];
    readonly after?: InboxPosition;
    readonly limit: number;
  }): Promise<readonly NotificationState[]>;
  unreadCount(workspaceId: string, userId: string): Promise<number>;
  /** `UNREAD → READ`; `false` si no hay una propia con ese id (idempotente si ya estaba leída o archivada). */
  markRead(workspaceId: string, userId: string, id: string, now: string): Promise<boolean>;
  markAllRead(workspaceId: string, userId: string, now: string): Promise<number>;
  archive(workspaceId: string, userId: string, id: string, now: string): Promise<boolean>;
  /** Purga por retención (con sus entregas); devuelve cuántas notificaciones borró. */
  deleteCreatedBefore(workspaceId: string, cutoff: string): Promise<number>;
}

// ─────────────────────────────────────────────────────────────────────────── entregas por email

export type DeliveryStatus = 'PENDING' | 'SENDING' | 'RETRY' | 'SENT' | 'FAILED' | 'SUPPRESSED';
export type SuppressionReason =
  'CHANNEL_DISABLED' | 'NO_EMAIL' | 'NOT_MEMBER' | 'PREFERENCE_DISABLED' | 'NOTIFICATION_GONE';

export interface DeliveryState {
  readonly id: string;
  readonly workspaceId: string;
  readonly notificationId: string;
  readonly status: DeliveryStatus;
  readonly suppressionReason: SuppressionReason | null;
  readonly notBefore: string;
  readonly attempts: number;
  readonly leaseUntil: string | null;
  readonly providerMessageId: string | null;
  readonly lastErrorCode: string | null;
}

export interface DeliveryRepository {
  insert(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly notificationId: string;
    readonly notBefore: string;
    readonly now: string;
  }): Promise<void>;
  find(workspaceId: string, id: string): Promise<DeliveryState | null>;
  /**
   * Claim atómico (decisión 7a): `PENDING`/`RETRY` ya vencida, o `SENDING` con el lease expirado, pasa a `SENDING`
   * con `attempts + 1` y un nuevo lease. `null` si otra instancia la tiene o ya se resolvió (envío ya aceptado).
   */
  claim(input: {
    readonly workspaceId: string;
    readonly id: string;
    readonly now: string;
    readonly leaseUntil: string;
  }): Promise<DeliveryState | null>;
  markSent(input: {
    readonly id: string;
    readonly provider: string;
    readonly providerMessageId: string;
    readonly now: string;
  }): Promise<void>;
  /** Devuelve la entrega a `PENDING` sin consumir el intento (horario de silencio vigente). */
  release(input: { readonly id: string; readonly notBefore: string; readonly now: string }): Promise<void>;
  markRetry(input: {
    readonly id: string;
    readonly notBefore: string;
    readonly errorCode: string;
    readonly now: string;
  }): Promise<void>;
  markFailed(input: { readonly id: string; readonly errorCode: string; readonly now: string }): Promise<void>;
  markSuppressed(input: {
    readonly id: string;
    readonly reason: SuppressionReason;
    readonly now: string;
  }): Promise<void>;
  /** Entregas vencidas cuyo trabajo se perdió: `PENDING`/`RETRY` con `not_before <= olderThan` o `SENDING` expirada. */
  due(workspaceId: string, olderThan: string, limit: number): Promise<readonly DeliveryState[]>;
  /** Estado agregado por notificación (lo que la API expone como `emailStatus`). */
  statuses(
    workspaceId: string,
    notificationIds: readonly string[],
  ): Promise<ReadonlyMap<string, DeliveryStatus>>;
}

// ─────────────────────────────────────────────────────────────────────────── preferencias

export interface PreferencesRepository {
  load(workspaceId: string, userId: string): Promise<NotificationPreferences>;
  loadMany(
    workspaceId: string,
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, NotificationPreferences>>;
  /** Guarda con bloqueo optimista por la versión persistida; `false` si cambió (412). */
  save(preferences: NotificationPreferences): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────── email

export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /** `<deliveryId@dominio>`: determinista, los clientes de correo agrupan los duplicados (decisión 7). */
  readonly messageId: string;
  /** Clave de idempotencia para adapters con API HTTP (el id de la entrega). */
  readonly idempotencyKey: string;
  /** Página de preferencias (cabecera `List-Unsubscribe`, decisión 8). */
  readonly listUnsubscribeUrl: string;
}

/** Fallo transitorio del proveedor: se reintenta con espera creciente. */
export class RetryableEmailError extends Error {
  constructor(readonly code: string) {
    super(`email send failed (retryable): ${code}`);
    this.name = 'RetryableEmailError';
  }
}

/** Rechazo definitivo (p. ej. destinatario inexistente): la entrega pasa a `FAILED` sin reintentar. */
export class PermanentEmailError extends Error {
  constructor(readonly code: string) {
    super(`email send failed (permanent): ${code}`);
    this.name = 'PermanentEmailError';
  }
}

export type EmailDriver = 'smtp' | 'none';

/**
 * Puerto del canal email (decisión 6). `none` suprime las entregas (`CHANNEL_DISABLED`); el adapter HTTP con
 * `Idempotency-Key` se agregará con la decisión del proveedor de producción (docs/33 D87) sin tocar el dominio.
 * Los mensajes de error NO deben contener la dirección de destino.
 */
export interface EmailSender {
  readonly driver: EmailDriver;
  send(message: EmailMessage): Promise<{ readonly providerMessageId: string }>;
}

/** Encola, en la MISMA transacción que la entrega, el trabajo `notifications.email-dispatch` (decisión 7). */
export interface EmailDispatchScheduler {
  schedule(input: {
    readonly deliveryId: string;
    readonly workspaceId: string;
    /** No antes de este instante (horario de silencio, backoff); `null` = ahora. */
    readonly startAfter: Date | null;
    /** Primer trabajo de la entrega: id = deliveryId (deduplica). Los siguientes usan un id nuevo. */
    readonly first: boolean;
  }): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────── observabilidad

/** Métricas de baja cardinalidad (docs/18 §5): nunca workspace, usuario ni notificación como etiqueta. */
export interface NotificationMetricsPort {
  created(type: string): void;
  emailDelivery(status: 'sent' | 'retry' | 'failed' | 'suppressed'): void;
  /** Retraso evento → notificación in-app, en segundos (NFR-PERF-008). */
  lagSeconds(type: string, seconds: number): void;
}

export interface NotificationLogger {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
  warn(fields: Readonly<Record<string, unknown>>, message: string): void;
}

// ─────────────────────────────────────────────────────────────────────────── dependencias

export interface UserLocaleQuery {
  localeOf(userId: string): Promise<string>;
}

/** Datos del hecho que el consumidor entrega a `NotifyFromEvent`. */
export interface SourceEvent {
  readonly eventId: string;
  readonly workspaceId: string;
  readonly occurredAt: string;
  readonly payload: unknown;
}

export interface NotifyDeps {
  readonly uow: UnitOfWork;
  readonly notifications: NotificationRepository;
  readonly deliveries: DeliveryRepository;
  readonly preferences: PreferencesRepository;
  readonly recipients: Pick<WorkspaceRecipientsQuery, 'activeMembers'>;
  readonly scheduler: EmailDispatchScheduler;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly metrics: NotificationMetricsPort;
}

export interface DispatchConfig {
  /** Dominio del `Message-ID` (el de `EMAIL_FROM`). */
  readonly messageIdDomain: string;
  /** `APP_PUBLIC_URL` sin barra final. */
  readonly appPublicUrl: string;
  /** `NOTIFY_EMAIL_MAX_ATTEMPTS` (5). */
  readonly maxAttempts: number;
  /** Espera tras el intento n (índice n-1): 1 min, 5 min, 25 min, 2 h (decisión 7). */
  readonly backoffMs: readonly number[];
  /** Vigencia del lease de una entrega en curso (2 min). */
  readonly leaseMs: number;
}

export const DEFAULT_BACKOFF_MS: readonly number[] = [60_000, 300_000, 1_500_000, 7_200_000];
export const DEFAULT_LEASE_MS = 120_000;

export interface DispatchDeps {
  readonly uow: UnitOfWork;
  readonly notifications: NotificationRepository;
  readonly deliveries: DeliveryRepository;
  readonly preferences: PreferencesRepository;
  readonly recipients: WorkspaceRecipientsQuery;
  readonly catalog: Pick<CategoryCatalogQuery, 'categoryTree'>;
  readonly sender: EmailSender;
  readonly scheduler: EmailDispatchScheduler;
  readonly clock: Clock;
  readonly metrics: NotificationMetricsPort;
  readonly logger: NotificationLogger;
  readonly config: DispatchConfig;
  readonly ids: IdGenerator;
}

export interface InboxDeps {
  readonly uow: UnitOfWork;
  readonly notifications: NotificationRepository;
  readonly deliveries: Pick<DeliveryRepository, 'statuses'>;
  readonly locales: UserLocaleQuery;
  readonly catalog: Pick<CategoryCatalogQuery, 'categoryTree'>;
  readonly clock: Clock;
}

export interface PreferencesDeps {
  readonly uow: UnitOfWork;
  readonly preferences: PreferencesRepository;
  readonly audit: AuditPort;
  readonly clock: Clock;
}
