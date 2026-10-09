import { Module, type DynamicModule } from '@nestjs/common';
import type { AuditPort } from '@pf/audit/contracts';
import type { CategoryCatalogQuery } from '@pf/classification/contracts';
import type { WorkspaceRecipientsQuery } from '@pf/identity/contracts';
import type { EventConsumerDefinition } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { CounterMetrics, HistogramMetrics } from '@pf/platform/otel';
import type { JobQueue } from '@pf/platform/queue';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { DispatchEmailDelivery } from '../application/dispatch-email-delivery.js';
import { InboxActions } from '../application/inbox.actions.js';
import { InboxQueries } from '../application/inbox.queries.js';
import { NotifyFromEvent } from '../application/notify-from-event.js';
import {
  DEFAULT_BACKOFF_MS,
  DEFAULT_LEASE_MS,
  type DispatchConfig,
  type EmailSender,
  type InboxDeps,
  type UserLocaleQuery,
} from '../application/ports/index.js';
import { PreferencesService } from '../application/preferences.service.js';
import { PurgeExpiredNotifications } from '../application/purge-expired.js';
import { NOTIFICATION_TYPE_CATALOG } from '../domain/index.js';
import { NoneEmailSender } from '../infrastructure/none-email-sender.js';
import { OtelNotificationMetrics } from '../infrastructure/otel-metrics.js';
import {
  PgDeliveryRepository,
  PgNotificationRepository,
  PgNotificationsUnitOfWork,
  PgPreferencesRepository,
  uuidV7Ids,
} from '../infrastructure/pg-notifications.js';
import { PgBossEmailScheduler } from '../infrastructure/pgboss-email-scheduler.js';
import { SmtpEmailSender, type SmtpOptions } from '../infrastructure/smtp-email-sender.js';
import {
  INBOX_ACTIONS,
  INBOX_QUERIES,
  NotificationsController,
  PREFERENCES_SERVICE,
} from './notifications-http.js';

export { NOTIFICATIONS_AUDIT_POLICY } from '../contracts/index.js';
export {
  EMAIL_DISPATCH_QUEUE,
  EMAIL_SWEEP_QUEUE,
  PURGE_QUEUE,
  NOTIFICATION_CONSUMERS,
  type EmailDispatchJob,
  type NotificationsMaintenanceJob,
} from '../contracts/index.js';
export { DispatchEmailDelivery, PurgeExpiredNotifications };
export type { EmailMessage, EmailSender } from '../application/ports/index.js';
export { PermanentEmailError, RetryableEmailError } from '../application/ports/index.js';

// ───────────────────────────────────────────────────────────────────────── API (pf_app)

export interface NotificationsApiRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  /** Nombres vigentes de categorías, grupos y tags (CLASSIFICATION) para renderizar las notificaciones. */
  readonly catalog: Pick<CategoryCatalogQuery, 'categoryTree'>;
  /** Locale del perfil del usuario (IDENTITY): el texto se compone al leer. */
  readonly locales: UserLocaleQuery;
}

export interface NotificationsApiRuntime {
  readonly actions: InboxActions;
  readonly queries: InboxQueries;
  readonly preferences: PreferencesService;
}

/** Composición de NOTIFY para la API sobre PostgreSQL (misma transacción que cada petición, RLS de usuario). */
export function createNotificationsApiRuntime(
  options: NotificationsApiRuntimeOptions,
): NotificationsApiRuntime {
  const uow = new PgNotificationsUnitOfWork(options.pool);
  const inbox: InboxDeps = {
    uow,
    notifications: new PgNotificationRepository(),
    deliveries: new PgDeliveryRepository(),
    locales: options.locales,
    catalog: options.catalog,
    clock: options.clock,
  };
  return {
    actions: new InboxActions(inbox),
    queries: new InboxQueries(inbox),
    preferences: new PreferencesService({
      uow,
      preferences: new PgPreferencesRepository(),
      audit: options.audit,
      clock: options.clock,
    }),
  };
}

export interface NotificationsModuleOptions {
  readonly runtime: NotificationsApiRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de NOTIFY (`/notifications*`, `/notification-preferences`). */
@Module({})
export class NotificationsModule {
  static register(options: NotificationsModuleOptions): DynamicModule {
    return {
      module: NotificationsModule,
      controllers: [NotificationsController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: INBOX_ACTIONS, useValue: options.runtime.actions },
        { provide: INBOX_QUERIES, useValue: options.runtime.queries },
        { provide: PREFERENCES_SERVICE, useValue: options.runtime.preferences },
      ],
    };
  }
}

// ───────────────────────────────────────────────────────────────────────── worker (pf_worker)

export interface EmailSenderOptions {
  readonly driver: 'smtp' | 'none';
  /** Requerido con `driver = smtp`. */
  readonly smtp?: SmtpOptions;
}

/** Selección del adaptador por `EMAIL_DRIVER` (design decisión 6). */
export function createEmailSender(options: EmailSenderOptions): EmailSender {
  if (options.driver === 'none') return new NoneEmailSender();
  if (!options.smtp) throw new Error('SMTP options are required when EMAIL_DRIVER=smtp');
  return new SmtpEmailSender(options.smtp);
}

/** Dominio de una dirección `EMAIL_FROM` (`Nombre <usuario@dominio>` o `usuario@dominio`). */
export function messageIdDomainOf(from: string): string {
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  const domain = address.split('@')[1]?.trim();
  if (!domain) throw new Error('EMAIL_FROM must contain an address with a domain');
  return domain;
}

export interface NotificationsWorkerRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly queue: JobQueue;
  readonly logger: Logger;
  /** Miembros activos y email verificado: lectura con el rol de directorio de IDENTITY. */
  readonly recipients: WorkspaceRecipientsQuery;
  readonly catalog: Pick<CategoryCatalogQuery, 'categoryTree'>;
  readonly sender: EmailSender;
  readonly counters: CounterMetrics;
  readonly histograms: HistogramMetrics;
  /** `APP_PUBLIC_URL` (obligatoria con `EMAIL_DRIVER=smtp`; con `none` no se usa). */
  readonly appPublicUrl?: string | undefined;
  /** `EMAIL_FROM`: su dominio forma el `Message-ID`. */
  readonly emailFrom: string;
  /** `NOTIFY_EMAIL_MAX_ATTEMPTS`. */
  readonly maxAttempts: number;
  /** `NOTIFY_RETENTION` en meses. */
  readonly retentionMonths: number;
  /** Tests: backoff y lease acotados. */
  readonly backoffMs?: readonly number[];
  readonly leaseMs?: number;
}

export interface NotificationsWorkerRuntime {
  readonly notify: NotifyFromEvent;
  readonly dispatch: DispatchEmailDelivery;
  readonly purge: PurgeExpiredNotifications;
}

/** Composición de NOTIFY para el worker: consumidores de eventos, despacho del email y purga. */
export function createNotificationsWorkerRuntime(
  options: NotificationsWorkerRuntimeOptions,
): NotificationsWorkerRuntime {
  const uow = new PgNotificationsUnitOfWork(options.pool);
  const notifications = new PgNotificationRepository();
  const deliveries = new PgDeliveryRepository();
  const preferences = new PgPreferencesRepository();
  const scheduler = new PgBossEmailScheduler(options.queue);
  const metrics = new OtelNotificationMetrics(options.counters, options.histograms);
  const config: DispatchConfig = {
    messageIdDomain: messageIdDomainOf(options.emailFrom),
    appPublicUrl: (options.appPublicUrl ?? '').replace(/\/+$/, ''),
    maxAttempts: options.maxAttempts,
    backoffMs: options.backoffMs ?? DEFAULT_BACKOFF_MS,
    leaseMs: options.leaseMs ?? DEFAULT_LEASE_MS,
  };
  return {
    notify: new NotifyFromEvent({
      uow,
      notifications,
      deliveries,
      preferences,
      recipients: options.recipients,
      scheduler,
      ids: uuidV7Ids,
      clock: options.clock,
      metrics,
    }),
    dispatch: new DispatchEmailDelivery({
      uow,
      notifications,
      deliveries,
      preferences,
      recipients: options.recipients,
      catalog: options.catalog,
      sender: options.sender,
      scheduler,
      clock: options.clock,
      metrics,
      logger: options.logger,
      config,
      ids: uuidV7Ids,
    }),
    purge: new PurgeExpiredNotifications({
      uow,
      notifications,
      clock: options.clock,
      retentionMonths: options.retentionMonths,
    }),
  };
}

/**
 * Consumidores idempotentes del worker (inbox en la misma transacción, INV-028): uno por tipo de notificación, cada
 * uno con su cola `events.<consumer>` (la caída del SMTP no bloquea a los demás). NOTIFY solo traduce el hecho.
 */
export function notificationEventConsumers(runtime: NotificationsWorkerRuntime): EventConsumerDefinition[] {
  return NOTIFICATION_TYPE_CATALOG.map((definition) => ({
    consumer: definition.consumer,
    events: [{ type: definition.event.type, version: definition.event.version }],
    // Baja frecuencia (un hecho por cruce de umbral o cierre pendiente): no reserva conexiones del pool del worker.
    concurrency: 1,
    handler: async (event) => {
      await runtime.notify.handle(
        {
          eventId: event.eventId,
          workspaceId: event.workspaceId,
          occurredAt: event.occurredAt,
          payload: event.payload,
        },
        definition,
      );
    },
  }));
}
