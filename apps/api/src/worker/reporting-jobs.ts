import { CASH_FLOW_WATCH_JOB, type EvaluateShortfallRisk } from '@pf/reporting/interface/reporting.module';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';

export interface ReportingJobsOptions {
  /** Cron de 5 campos en UTC (`REPORTING_CASH_FLOW_WATCH_CRON`, por defecto `25 * * * *`) u `off`. */
  readonly cron: string;
  /** Encola además una pasada al arrancar (detecta un déficit sin esperar al cron). */
  readonly runOnStart: boolean;
  /**
   * Programa el cron (por defecto sí, como en producción). Los benchmarks y los tests lo desactivan para que ninguna
   * pasada horaria caiga dentro de una ventana medida (como `notifications.scheduleCrons`).
   */
  readonly scheduleCrons?: boolean;
}

export interface CashFlowWatchPayload {
  readonly trigger: 'cron' | 'startup' | 'manual';
}

/**
 * Job `reporting.cash-flow-watch` (openspec add-cash-flow-forecast, tarea 4.4; design.md decisión 13; D381): cada hora a los
 * :25 (después de `commitments.generate-occurrences`, a los :10), por workspace activo y UNO a UNO, calcula el calendario
 * del horizonte de la alerta y abre, sostiene o cierra el episodio de riesgo de déficit de cada moneda. Concurrencia 1;
 * dos corridas simultáneas son inocuas (índice único del episodio abierto). Usa la `JobQueue` existente: sin consumidores
 * de eventos nuevos (presupuesto de conexiones, TC-PLATFORM-THROUGHPUT-009).
 */
export async function registerCashFlowWatchJob(
  queue: JobQueue,
  watch: EvaluateShortfallRisk,
  logger: Logger,
  options: ReportingJobsOptions,
): Promise<void> {
  await queue.work<CashFlowWatchPayload>(CASH_FLOW_WATCH_JOB, { concurrency: 1 }, async (job) => {
    const summary = await watch.run();
    if (summary.failed > 0) {
      logger.warn(
        { trigger: job.payload.trigger, failed: summary.failed, errors: summary.errors },
        'cash flow watch: some workspaces failed and will be retried',
      );
    }
    if (summary.opened + summary.closed > 0) {
      logger.info(
        { trigger: job.payload.trigger, opened: summary.opened, closed: summary.closed },
        'cash flow shortfall episodes changed',
      );
    }
  });
  if (options.cron === 'off') {
    await queue.unschedule(CASH_FLOW_WATCH_JOB);
    logger.info({ 'job.queue': CASH_FLOW_WATCH_JOB }, 'cash flow watch cron disabled');
  } else if (options.scheduleCrons ?? true) {
    await queue.schedule<CashFlowWatchPayload>(
      CASH_FLOW_WATCH_JOB,
      options.cron,
      { trigger: 'cron' },
      { tz: 'UTC' },
    );
  }
  if (options.runOnStart) {
    await queue.send<CashFlowWatchPayload>(CASH_FLOW_WATCH_JOB, { trigger: 'startup' });
  }
}
