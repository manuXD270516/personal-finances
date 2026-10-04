import {
  FX_BACKFILL_QUEUE,
  FX_GAP_FILL_CRON,
  FX_GAP_FILL_QUEUE,
  FX_GAP_FILL_TZ,
  FX_POLL_QUEUE,
  FX_WORKSPACE_PROVISIONING_CONSUMER,
  type FxMarketRateJobs,
  type FxMarketRateJobsOptions,
} from '@pf/fx/interface/fx.module';
import { runWithRequestContext } from '@pf/platform/api';
import type { EventConsumerDefinition } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';

export interface FxJobsOptions {
  /** Encola un relleno de días faltantes al arrancar (workspaces previos a los providers). Por defecto sí. */
  readonly gapFillOnStart?: boolean;
}

interface BackfillPayload {
  readonly workspaceId: string;
  readonly timeZone: string;
}

/**
 * URL base alternativas de los providers (`FX_PROVIDER_PARALELO_BO_URL`, `FX_PROVIDER_DOLARAPI_BO_URL`; el contrato de
 * configuración las rechaza fuera de local/ci): las pruebas E2E apuntan el worker a un servidor HTTP local que
 * simula a los providers (nunca la red real). La allowlist de hosts suma los de esas URL.
 */
export function fxEndpointsFromConfig(config: {
  readonly FX_PROVIDER_PARALELO_BO_URL?: string | undefined;
  readonly FX_PROVIDER_DOLARAPI_BO_URL?: string | undefined;
}): FxMarketRateJobsOptions['endpoints'] | undefined {
  const baseUrls = {
    ...(config.FX_PROVIDER_PARALELO_BO_URL ? { PARALELO_BO: config.FX_PROVIDER_PARALELO_BO_URL } : {}),
    ...(config.FX_PROVIDER_DOLARAPI_BO_URL ? { DOLARAPI_BO: config.FX_PROVIDER_DOLARAPI_BO_URL } : {}),
  };
  return Object.keys(baseUrls).length > 0 ? { baseUrls } : undefined;
}

const asWorker = <T>(process: string, fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext({ actor: { type: 'WORKER', process }, origin: 'system' }, fn);

/**
 * Jobs pg-boss de los providers de tasas de mercado (openspec add-market-rate-providers, tarea 4.4; design.md
 * decisión 4): `fx.poll-market-rates` (cron derivado de `FX_POLL_INTERVAL`), `fx.backfill-historical-rates`
 * (encolado en la transacción del consumidor de `identity.WorkspaceCreated.v1`, id del job = id del evento) y
 * `fx.fill-rate-gaps` (02:00 America/La_Paz). Concurrencia 1 por cola: la programación de pg-boss emite un solo job
 * por tick entre réplicas y el índice único de vigencia impide duplicados (design.md decisión 22).
 * Con los tres roles en `none` o configuración inválida NO se registra ninguna cola ni consumidor (degradación: el
 * core sigue con tasas manuales). Devuelve los consumidores de eventos a suscribir.
 */
export async function registerFxMarketRateJobs(
  queue: JobQueue,
  jobs: FxMarketRateJobs,
  logger: Logger,
  options: FxJobsOptions = {},
): Promise<EventConsumerDefinition[]> {
  const { settings } = jobs;
  if (!jobs.enabled) {
    // Si antes estaban habilitados, sus programaciones dejan de emitir jobs (idempotente).
    for (const name of [FX_POLL_QUEUE, FX_GAP_FILL_QUEUE]) {
      await queue
        .unschedule(name)
        .catch((err: unknown) =>
          logger.warn(
            { 'job.queue': name, err: { type: err instanceof Error ? err.name : typeof err } },
            'unschedule failed',
          ),
        );
    }
    if (settings.configError) {
      logger.error(
        { code: 'FX_PROVIDER_CONFIG_INVALID', reason: settings.configError },
        'fx market rate providers not started: invalid configuration',
      );
    } else {
      logger.info('fx market rate providers disabled (FX_PROVIDER_* = none)');
    }
    return [];
  }

  await queue.work<{ trigger: string }>(FX_POLL_QUEUE, { concurrency: 1 }, async () => {
    const results = await asWorker(FX_POLL_QUEUE, () => jobs.ingestion.poll());
    logger.info({ 'job.queue': FX_POLL_QUEUE, results }, 'fx market rates polled');
  });
  await queue.schedule(FX_POLL_QUEUE, settings.pollCron, { trigger: 'cron' }, { tz: 'UTC' });

  await queue.work<BackfillPayload>(FX_BACKFILL_QUEUE, { concurrency: 1 }, async (job) => {
    const result = await asWorker(FX_BACKFILL_QUEUE, () => jobs.ingestion.backfill(job.payload));
    logger.info({ 'job.queue': FX_BACKFILL_QUEUE, result }, 'fx historical rates backfilled');
  });

  await queue.work<{ trigger: string }>(FX_GAP_FILL_QUEUE, { concurrency: 1 }, async () => {
    const result = await asWorker(FX_GAP_FILL_QUEUE, () => jobs.ingestion.fillGaps());
    logger.info({ 'job.queue': FX_GAP_FILL_QUEUE, result }, 'fx rate gaps filled');
  });
  if (settings.backfillEnabled) {
    await queue.schedule(FX_GAP_FILL_QUEUE, FX_GAP_FILL_CRON, { trigger: 'cron' }, { tz: FX_GAP_FILL_TZ });
    if (options.gapFillOnStart ?? true) await queue.send(FX_GAP_FILL_QUEUE, { trigger: 'startup' });
  } else {
    await queue.unschedule(FX_GAP_FILL_QUEUE);
  }
  logger.info(
    {
      queues: [FX_POLL_QUEUE, FX_BACKFILL_QUEUE, FX_GAP_FILL_QUEUE],
      cron: settings.pollCron,
      primary: settings.primary,
      fallback: settings.fallback,
      official: settings.official,
    },
    'fx market rate providers scheduled',
  );

  return [
    {
      consumer: FX_WORKSPACE_PROVISIONING_CONSUMER,
      events: [{ type: 'identity.WorkspaceCreated', version: 1 }],
      // En la transacción del consumidor (inbox + RLS del workspace): siembra preferencias PARALLEL y encola la carga
      // histórica con el id del evento como id del job (una re-entrega no duplica el job).
      handler: async (event, ctx) => {
        await jobs.ingestion.seedPreferences(event.workspaceId);
        if (!settings.backfillEnabled) return;
        const payload = event.payload as { readonly timeZone?: unknown };
        const timeZone = typeof payload.timeZone === 'string' ? payload.timeZone : 'America/La_Paz';
        await queue.enqueueInTransaction<BackfillPayload>(
          FX_BACKFILL_QUEUE,
          [
            {
              id: event.eventId,
              payload: { workspaceId: event.workspaceId, timeZone },
              correlationId: event.correlationId,
              traceContext: {},
            },
          ],
          ctx.tx,
        );
      },
    },
  ];
}
