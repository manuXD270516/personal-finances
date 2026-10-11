import {
  GOALS_DAILY_JOB,
  runGoalsDaily,
  type ActiveWorkspaceDirectory,
  type GoalsRuntime,
} from '@pf/goals/interface/goals.module';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';

export interface GoalsJobOptions {
  /** Cron de 5 campos en UTC (`GOALS_DAILY_CRON`, por omisión `40 * * * *`) u `off`. */
  readonly cron: string;
  /** Encola además una ejecución al arrancar (sobre-asignación y metas multi-moneda sin esperar al cron). */
  readonly runOnStart: boolean;
}

export interface GoalsJobPayload {
  readonly trigger: 'cron' | 'startup' | 'manual';
}

/**
 * Job `goals.daily-evaluation` (openspec add-savings-goals, decisiones 6 y 15): por workspace activo y con "hoy" en su
 * zona horaria, reevalúa las metas con fondos en otra moneda (`REACH` por tipo de cambio, nunca `REOPEN`) y barre la
 * sobre-asignación de las cuentas con reservas. Concurrencia 1; repetirlo es inocuo (episodios y estados idempotentes).
 */
export async function registerGoalsDailyJob(
  queue: JobQueue,
  runtime: Pick<GoalsRuntime, 'reactions'>,
  workspaces: ActiveWorkspaceDirectory,
  logger: Logger,
  options: GoalsJobOptions,
): Promise<void> {
  await queue.work<GoalsJobPayload>(GOALS_DAILY_JOB, { concurrency: 1 }, async (job) => {
    await runGoalsDaily(runtime.reactions, workspaces, logger, job.payload.trigger);
  });
  if (options.cron === 'off') {
    await queue.unschedule(GOALS_DAILY_JOB);
    logger.info({ 'job.queue': GOALS_DAILY_JOB }, 'goals daily cron disabled');
  } else {
    await queue.schedule<GoalsJobPayload>(GOALS_DAILY_JOB, options.cron, { trigger: 'cron' }, { tz: 'UTC' });
  }
  if (options.runOnStart) {
    await queue.send<GoalsJobPayload>(GOALS_DAILY_JOB, { trigger: 'startup' });
  }
}
