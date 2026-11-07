import {
  DIGEST_QUEUE,
  EMAIL_DISPATCH_QUEUE,
  EMAIL_SWEEP_QUEUE,
  PURGE_QUEUE,
  type DispatchEmailDelivery,
  type EmailDispatchJob,
  type NotificationsMaintenanceJob,
  type PurgeExpiredNotifications,
  type SendHomeDigests,
} from '@pf/notifications/interface/notifications.module';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';

/** Barrido de entregas perdidas: cada 5 minutos (design decisión 7). */
export const EMAIL_SWEEP_CRON = '*/5 * * * *';
/** Purga por retención: diaria, de madrugada en UTC (design decisión 11). */
export const PURGE_CRON = '30 4 * * *';
/** Digest del Home por email: cada hora a los :05 (`NOTIFICATIONS_DIGEST_CRON`, D385). */
export const DEFAULT_DIGEST_CRON = '5 * * * *';

export interface ActiveWorkspaces {
  list(): Promise<readonly { readonly workspaceId: string }[]>;
}

export interface NotificationsJobsOptions {
  readonly dispatch: DispatchEmailDelivery;
  readonly purge: PurgeExpiredNotifications;
  readonly workspaces: ActiveWorkspaces;
  readonly logger: Logger;
  /** Programa los barridos periódicos (por defecto sí; los tests los desactivan). */
  readonly scheduleCrons?: boolean;
  /** Encola además un barrido al arrancar (reanuda las entregas pendientes de antes del reinicio). */
  readonly sweepOnStart?: boolean;
  /** Trabajos de despacho en paralelo (el proveedor lento no bloquea otras colas). */
  readonly dispatchConcurrency?: number;
  /**
   * Digest periódico del Home (add-cash-flow-forecast): job `notifications.digest` de la `JobQueue` existente, sin
   * consumidor de eventos (presupuesto de conexiones: dentro de las reservadas para jobs periódicos).
   */
  readonly digest?: {
    readonly service: SendHomeDigests;
    /** `NOTIFICATIONS_DIGEST_CRON` (UTC, 5 campos) u `off`. */
    readonly cron?: string;
    /** Encola además una pasada al arrancar (recupera el digest de la semana si el worker estuvo caído). */
    readonly runOnStart?: boolean;
  };
}

/**
 * Trabajos pg-boss de NOTIFY (openspec add-alerts, tarea 4.4):
 *  - `notifications.email-dispatch`: despacha UNA entrega (claim con lease; repetirlo es inocuo). Cola propia con
 *    concurrencia acotada: un proveedor SMTP lento o caído no afecta a los consumidores de otros contextos.
 *  - `notifications.email-sweep`: cada 5 min reencola las entregas vencidas cuyo trabajo se perdió.
 *  - `notifications.purge`: diario, borra las notificaciones con más de `NOTIFY_RETENTION`.
 * La cola de despacho debe existir ANTES de que un consumidor de eventos encole en una transacción.
 */
export async function registerNotificationsJobs(
  queue: JobQueue,
  options: NotificationsJobsOptions,
): Promise<void> {
  const { dispatch, purge, workspaces, logger } = options;
  await queue.ensureQueue(EMAIL_DISPATCH_QUEUE, {
    retryLimit: 3,
    retryDelaySeconds: 30,
    expireInSeconds: 180,
  });
  await queue.work<EmailDispatchJob>(
    EMAIL_DISPATCH_QUEUE,
    { concurrency: options.dispatchConcurrency ?? 2 },
    async (job) => {
      await dispatch.run(job.payload);
    },
  );

  await queue.work<NotificationsMaintenanceJob>(EMAIL_SWEEP_QUEUE, { concurrency: 1 }, async () => {
    let requeued = 0;
    for (const { workspaceId } of await workspaces.list()) requeued += await dispatch.sweep(workspaceId);
    if (requeued > 0) logger.info({ requeued }, 'notification email deliveries re-enqueued');
  });

  await queue.work<NotificationsMaintenanceJob>(PURGE_QUEUE, { concurrency: 1 }, async () => {
    let purged = 0;
    for (const { workspaceId } of await workspaces.list()) purged += await purge.purgeWorkspace(workspaceId);
    logger.info({ purged }, 'expired notifications purged');
  });

  if (options.digest) {
    const { service, cron = DEFAULT_DIGEST_CRON } = options.digest;
    await queue.work<NotificationsMaintenanceJob>(DIGEST_QUEUE, { concurrency: 1 }, async () => {
      let created = 0;
      for (const { workspaceId } of await workspaces.list()) {
        // Un workspace con error no frena a los demás: la pasada siguiente (cada hora) lo reintenta.
        try {
          created += (await service.run(workspaceId)).created;
        } catch (err) {
          logger.warn(
            { err: { type: err instanceof Error ? err.name : typeof err }, workspaceId },
            'home digest failed for a workspace',
          );
        }
      }
      if (created > 0) logger.info({ created }, 'home digests created');
    });
    if (cron === 'off') {
      await queue.unschedule(DIGEST_QUEUE);
      logger.info({ 'job.queue': DIGEST_QUEUE }, 'notifications digest cron disabled');
    } else if (options.scheduleCrons ?? true) {
      await queue.schedule<NotificationsMaintenanceJob>(
        DIGEST_QUEUE,
        cron,
        { trigger: 'cron' },
        { tz: 'UTC' },
      );
    }
    if (options.digest.runOnStart ?? false) {
      await queue.send<NotificationsMaintenanceJob>(DIGEST_QUEUE, { trigger: 'startup' });
    }
  }

  if (options.scheduleCrons ?? true) {
    await queue.schedule<NotificationsMaintenanceJob>(EMAIL_SWEEP_QUEUE, EMAIL_SWEEP_CRON, {
      trigger: 'cron',
    });
    await queue.schedule<NotificationsMaintenanceJob>(PURGE_QUEUE, PURGE_CRON, { trigger: 'cron' });
  }
  if (options.sweepOnStart ?? true) {
    await queue.send<NotificationsMaintenanceJob>(EMAIL_SWEEP_QUEUE, { trigger: 'startup' });
  }
}
