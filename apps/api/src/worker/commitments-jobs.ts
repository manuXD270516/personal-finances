import {
  COMMITMENTS_GENERATE_JOB,
  COMMITMENTS_SUBSCRIPTION_JOB,
  runGenerateOccurrences,
  runSubscriptionDaily,
  type ActiveWorkspaceDirectory,
  type GenerateOccurrencesService,
  type SubscriptionDailyService,
} from '@pf/commitments/interface/commitments.module';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';

export interface CommitmentsJobOptions {
  /** Cron de 5 campos en UTC (`COMMITMENTS_SCHEDULER_CRON`, por defecto `10 * * * *`) u `off`. */
  readonly cron: string;
  /** Encola además una ejecución al arrancar (ocurrencias de los workspaces existentes sin esperar al cron). */
  readonly runOnStart: boolean;
}

export interface CommitmentsJobPayload {
  readonly trigger: 'cron' | 'startup' | 'manual';
}

/**
 * Job `commitments.generate-occurrences` (openspec add-recurrence-engine, tarea 4.6; design.md decisión 7): cada hora,
 * por workspace activo, extiende la ventana de generación hasta hoy + `COMMITMENTS_HORIZON_DAYS`, pasa a próxima y a
 * atrasada las ocurrencias que corresponde y crea las de modo `AUTO_CREATE` vencidas. Concurrencia 1; repetirlo o
 * ejecutarlo dos veces en paralelo es inocuo (unicidad nominal, `FOR UPDATE` y el índice único por `externalRef`).
 */
export async function registerCommitmentsJob(
  queue: JobQueue,
  service: GenerateOccurrencesService,
  workspaces: ActiveWorkspaceDirectory,
  logger: Logger,
  options: CommitmentsJobOptions,
): Promise<void> {
  await queue.work<CommitmentsJobPayload>(COMMITMENTS_GENERATE_JOB, { concurrency: 1 }, async (job) => {
    await runGenerateOccurrences(service, workspaces, logger, job.payload.trigger);
  });
  if (options.cron === 'off') {
    await queue.unschedule(COMMITMENTS_GENERATE_JOB);
    logger.info({ 'job.queue': COMMITMENTS_GENERATE_JOB }, 'commitments cron disabled');
  } else {
    await queue.schedule<CommitmentsJobPayload>(
      COMMITMENTS_GENERATE_JOB,
      options.cron,
      { trigger: 'cron' },
      { tz: 'UTC' },
    );
  }
  if (options.runOnStart) {
    await queue.send<CommitmentsJobPayload>(COMMITMENTS_GENERATE_JOB, { trigger: 'startup' });
  }
}

/**
 * Job `commitments.subscription-daily` (openspec add-subscriptions, tarea 3.7; design.md decisión 12): cada hora, por
 * workspace activo y con "hoy" en su zona horaria, pasa a activa la suscripción cuyo trial terminó, ejecuta las
 * cancelaciones programadas vencidas y emite los recordatorios de renovación y de fin de trial (a lo sumo uno por
 * suscripción y fecha). Concurrencia 1; repetirlo o ejecutarlo en paralelo es inocuo (`FOR UPDATE` por suscripción y
 * clave `(suscripción, tipo, fecha)` de los recordatorios).
 */
export async function registerSubscriptionsJob(
  queue: JobQueue,
  service: SubscriptionDailyService,
  workspaces: ActiveWorkspaceDirectory,
  logger: Logger,
  options: CommitmentsJobOptions,
): Promise<void> {
  await queue.work<CommitmentsJobPayload>(COMMITMENTS_SUBSCRIPTION_JOB, { concurrency: 1 }, async (job) => {
    await runSubscriptionDaily(service, workspaces, logger, job.payload.trigger);
  });
  if (options.cron === 'off') {
    await queue.unschedule(COMMITMENTS_SUBSCRIPTION_JOB);
    logger.info({ 'job.queue': COMMITMENTS_SUBSCRIPTION_JOB }, 'subscriptions cron disabled');
  } else {
    await queue.schedule<CommitmentsJobPayload>(
      COMMITMENTS_SUBSCRIPTION_JOB,
      options.cron,
      { trigger: 'cron' },
      { tz: 'UTC' },
    );
  }
  if (options.runOnStart) {
    await queue.send<CommitmentsJobPayload>(COMMITMENTS_SUBSCRIPTION_JOB, { trigger: 'startup' });
  }
}
