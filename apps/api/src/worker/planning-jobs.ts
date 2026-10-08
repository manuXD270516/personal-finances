import {
  PLANNING_ENSURE_PERIODS_JOB,
  runEnsurePeriods,
  type ActiveWorkspaceDirectory,
  type PeriodsService,
} from '@pf/planning/interface/planning.module';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';

export interface PlanningPeriodsJobOptions {
  /** Cron de 5 campos en UTC (`PLANNING_PERIODS_CRON`, por defecto `5 * * * *`) u `off`. */
  readonly cron: string;
  /** Encola además una ejecución al arrancar (periodos de los workspaces existentes sin esperar al cron). */
  readonly runOnStart: boolean;
}

export interface PlanningPeriodsPayload {
  readonly trigger: 'cron' | 'startup' | 'manual';
}

/**
 * Job `planning.ensure-periods` (openspec add-financial-periods, tarea 4.4; design.md decisiones 6 y 7): cada hora,
 * por workspace activo, activa los DRAFT iniciados en su zona horaria, recalcula los DRAFT tras un cambio del día de
 * inicio y crea los periodos que falten. Concurrencia 1; repetirlo es inocuo (idempotente por workspace).
 */
export async function registerPlanningPeriodsJob(
  queue: JobQueue,
  service: PeriodsService,
  workspaces: ActiveWorkspaceDirectory,
  logger: Logger,
  options: PlanningPeriodsJobOptions,
): Promise<void> {
  await queue.work<PlanningPeriodsPayload>(PLANNING_ENSURE_PERIODS_JOB, { concurrency: 1 }, async (job) => {
    await runEnsurePeriods(service, workspaces, logger, job.payload.trigger);
  });
  if (options.cron === 'off') {
    await queue.unschedule(PLANNING_ENSURE_PERIODS_JOB);
    logger.info({ 'job.queue': PLANNING_ENSURE_PERIODS_JOB }, 'planning periods cron disabled');
  } else {
    await queue.schedule<PlanningPeriodsPayload>(
      PLANNING_ENSURE_PERIODS_JOB,
      options.cron,
      { trigger: 'cron' },
      { tz: 'UTC' },
    );
  }
  if (options.runOnStart)
    await queue.send<PlanningPeriodsPayload>(PLANNING_ENSURE_PERIODS_JOB, { trigger: 'startup' });
}
