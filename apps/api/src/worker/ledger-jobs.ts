import { runWithRequestContext } from '@pf/platform/api';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';
import { LEDGER_DAILY_MAINTENANCE_QUEUE, type LedgerMaintenance } from '@pf/ledger/interface/ledger.module';

export interface LedgerDailyJobOptions {
  /** Cron de 5 campos (`LEDGER_INTEGRITY_CRON`) u `off`. */
  readonly cron: string;
  readonly tz: string;
  /** Encola además una ejecución al arrancar (p. ej. tras `restore:local`, que reinicia el worker). */
  readonly runOnStart: boolean;
  /**
   * Chequeos adicionales tras `VerifyLedgerIntegrity` (add-lifecycle-timeline decisión 6: estado del agregado ↔
   * última transición del recorrido).
   */
  readonly afterIntegrity?: () => Promise<unknown>;
}

export interface LedgerDailyPayload {
  readonly trigger: 'cron' | 'startup';
}

/**
 * Job diario del ledger (openspec add-ledger-core, tarea 5.6; design.md §Decisiones 9 y 10): primero
 * `VerifyLedgerIntegrity` (detecta corrupción con los snapshots tal como están) y luego `RebuildBalanceSnapshots` al
 * día anterior. Una sola ejecución a la vez (concurrencia 1); repetirla es inocuo.
 */
export async function registerLedgerDailyJob(
  queue: JobQueue,
  maintenance: LedgerMaintenance,
  logger: Logger,
  options: LedgerDailyJobOptions,
): Promise<void> {
  await queue.work<LedgerDailyPayload>(LEDGER_DAILY_MAINTENANCE_QUEUE, { concurrency: 1 }, (job) =>
    runLedgerDailyMaintenance(maintenance, job.payload.trigger, options.afterIntegrity),
  );
  if (options.cron === 'off') {
    await queue.unschedule(LEDGER_DAILY_MAINTENANCE_QUEUE);
    logger.info({ 'job.queue': LEDGER_DAILY_MAINTENANCE_QUEUE }, 'ledger daily maintenance disabled');
  } else {
    await queue.schedule<LedgerDailyPayload>(
      LEDGER_DAILY_MAINTENANCE_QUEUE,
      options.cron,
      { trigger: 'cron' },
      { tz: options.tz },
    );
  }
  if (options.runOnStart)
    await queue.send<LedgerDailyPayload>(LEDGER_DAILY_MAINTENANCE_QUEUE, { trigger: 'startup' });
}

export function runLedgerDailyMaintenance(
  maintenance: LedgerMaintenance,
  trigger: LedgerDailyPayload['trigger'],
  afterIntegrity?: () => Promise<unknown>,
): Promise<void> {
  return runWithRequestContext(
    { actor: { type: 'WORKER', process: `ledger.daily-maintenance:${trigger}` }, origin: 'system' },
    async () => {
      await maintenance.verifyLedgerIntegrity();
      if (afterIntegrity) await afterIntegrity();
      await maintenance.rebuildBalanceSnapshots();
    },
  );
}
