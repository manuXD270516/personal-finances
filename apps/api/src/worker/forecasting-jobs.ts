import {
  FORECAST_RUNNER_JOB,
  FORECAST_SCHEDULE_JOB,
  runForecastRunner,
  runForecastSchedule,
  type ForecastingRuntime,
} from '@pf/forecasting/interface/forecasting.module';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';

export interface ForecastingJobsOptions {
  /** `FORECASTING_ENABLED`: deshabilitada no se registra ningún trabajo (no cuesta nada) y se retiran los cron. */
  readonly enabled: boolean;
  /** Cron de 5 campos en UTC (`FORECASTING_SCHEDULE_CRON`, por omisión `15 5 * * *`) u `off`. */
  readonly scheduleCron: string;
  /** Cron de 5 campos en UTC (`FORECASTING_RUNNER_CRON`, por omisión cada minuto) u `off`. */
  readonly runnerCron: string;
  /** Encola además una pasada del trabajo diario al arrancar. */
  readonly runOnStart: boolean;
  /** Programa los cron (por omisión sí); los benchmarks y los tests los desactivan. */
  readonly scheduleCrons?: boolean;
}

export interface ForecastingJobPayload {
  readonly trigger: 'cron' | 'startup' | 'manual';
}

/**
 * Jobs `forecasting.schedule` (diario: corridas programadas y retención) y `forecasting.runner` (ejecutor: UNA corrida
 * por pasada) de openspec add-ml-forecasting-service (decisión 13). Usan la `JobQueue` existente y comparten la reserva de
 * trabajos periódicos del worker: SIN consumidores de eventos ni conexiones nuevas (D249, TC-PLATFORM-THROUGHPUT-009).
 * La llamada al servicio ocurre sin conexión tomada, así que una corrida de minutos no bloquea a los demás trabajos.
 */
export async function registerForecastingJobs(
  queue: JobQueue,
  runtime: Pick<ForecastingRuntime, 'schedule' | 'execute'>,
  logger: Logger,
  options: ForecastingJobsOptions,
): Promise<void> {
  if (!options.enabled) {
    await queue.unschedule(FORECAST_SCHEDULE_JOB);
    await queue.unschedule(FORECAST_RUNNER_JOB);
    return;
  }
  await queue.work<ForecastingJobPayload>(FORECAST_SCHEDULE_JOB, { concurrency: 1 }, async (job) => {
    await runForecastSchedule(runtime, logger, job.payload.trigger);
  });
  await queue.work<ForecastingJobPayload>(FORECAST_RUNNER_JOB, { concurrency: 1 }, async () => {
    await runForecastRunner(runtime, logger);
  });
  const schedule = async (name: string, cron: string): Promise<void> => {
    if (cron === 'off') {
      await queue.unschedule(name);
      logger.info({ 'job.queue': name }, 'forecasting cron disabled');
    } else if (options.scheduleCrons ?? true) {
      await queue.schedule<ForecastingJobPayload>(name, cron, { trigger: 'cron' }, { tz: 'UTC' });
    }
  };
  await schedule(FORECAST_SCHEDULE_JOB, options.scheduleCron);
  await schedule(FORECAST_RUNNER_JOB, options.runnerCron);
  if (options.runOnStart)
    await queue.send<ForecastingJobPayload>(FORECAST_SCHEDULE_JOB, { trigger: 'startup' });
}
