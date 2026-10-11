import {
  DEBT_CARD_DAILY_JOB,
  runCardDaily,
  type ActiveWorkspaceDirectory,
  type CardsRuntime,
} from '@pf/debt/interface/debt.module';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';

export interface DebtJobOptions {
  /** Cron de 5 campos en UTC (`DEBT_CARDS_CRON`, por omisión `30 * * * *`) u `off`. */
  readonly cron: string;
  /** Encola además una ejecución al arrancar (estados de cuenta y recordatorios sin esperar al cron). */
  readonly runOnStart: boolean;
}

export interface DebtJobPayload {
  readonly trigger: 'cron' | 'startup' | 'manual';
}

/**
 * Job `debt.card-daily` (openspec add-credit-cards, decisiones 5 y 8): cada hora, por workspace activo y con "hoy" en
 * su zona horaria, emite una sola vez los estados de cuenta de los ciclos cerrados, publica los recordatorios de
 * vencimiento y refresca las expectativas del plan de pago y los umbrales de límites compartidos. Concurrencia 1;
 * repetirlo o ejecutarlo en paralelo es inocuo (`FOR UPDATE` por tarjeta y claves únicas `(cuenta, cierre)`).
 */
export async function registerDebtCardsJob(
  queue: JobQueue,
  runtime: Pick<CardsRuntime, 'daily'>,
  workspaces: ActiveWorkspaceDirectory,
  logger: Logger,
  options: DebtJobOptions,
): Promise<void> {
  await queue.work<DebtJobPayload>(DEBT_CARD_DAILY_JOB, { concurrency: 1 }, async (job) => {
    await runCardDaily(runtime.daily, workspaces, logger, job.payload.trigger);
  });
  if (options.cron === 'off') {
    await queue.unschedule(DEBT_CARD_DAILY_JOB);
    logger.info({ 'job.queue': DEBT_CARD_DAILY_JOB }, 'debt cards cron disabled');
  } else {
    await queue.schedule<DebtJobPayload>(
      DEBT_CARD_DAILY_JOB,
      options.cron,
      { trigger: 'cron' },
      { tz: 'UTC' },
    );
  }
  if (options.runOnStart) {
    await queue.send<DebtJobPayload>(DEBT_CARD_DAILY_JOB, { trigger: 'startup' });
  }
}
