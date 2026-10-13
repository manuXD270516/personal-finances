import { FX_USER_CONVERSION_BACKFILL_JOB } from '@pf/fx/contracts';
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
import {
  userConversionConsumers,
  type ConversionBackfillSource,
  type UserConversionObservations,
} from '@pf/fx/interface/fx.module';
import type { FirstBalanceDateQuery } from '@pf/ledger/contracts';
import { runWithRequestContext } from '@pf/platform/api';
import type { EventConsumerDefinition } from '@pf/platform/events';
import type { FirstBalanceDatePort } from '@pf/fx/interface/fx.module';
import type { Logger } from '@pf/platform/logging';
import type { JobQueue } from '@pf/platform/queue';
import type { ConversionDetailQuery } from '@pf/transactions/contracts';

export interface FxJobsOptions {
  /** Encola un relleno de días faltantes al arrancar (workspaces previos a los providers). Por defecto sí. */
  readonly gapFillOnStart?: boolean;
}

interface BackfillPayload {
  readonly workspaceId: string;
  readonly timeZone: string;
  /** Moneda base del workspace (decide su lista de pares por defecto); ausente en jobs encolados antes del cambio. */
  readonly baseCurrency?: string;
}

/**
 * `FirstBalanceDatePort` de FX sobre la consulta pública de LEDGER (add-crypto-rate-providers, D229): primera fecha con
 * saldo por moneda, en la unidad de trabajo del workspace que abre FX. Sin tocar tablas de LEDGER desde FX.
 */
export function firstBalanceDatePort(query: FirstBalanceDateQuery): FirstBalanceDatePort {
  return {
    async byCurrency(workspaceId) {
      const rows = await query.byCurrency({ workspaceId });
      return new Map(rows.map((r) => [r.currency, r.firstDate] as const));
    },
  };
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
    } else if (settings.cryptoConfigError) {
      logger.error(
        { code: 'FX_PROVIDER_CONFIG_INVALID', reason: settings.cryptoConfigError },
        'fx crypto rate providers not started: invalid configuration',
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
    // Histórico de cierres cripto desde la primera fecha con saldo (D229): sin providers cripto no hace nada.
    const crypto = await asWorker(FX_BACKFILL_QUEUE, () => jobs.ingestion.cryptoBackfill(job.payload));
    logger.info({ 'job.queue': FX_BACKFILL_QUEUE, result, crypto }, 'fx historical rates backfilled');
  });

  await queue.work<{ trigger: string }>(FX_GAP_FILL_QUEUE, { concurrency: 1 }, async () => {
    const result = await asWorker(FX_GAP_FILL_QUEUE, () => jobs.ingestion.fillGaps());
    // Caché de instalación de cierres cripto y días faltantes de cada workspace (D229).
    const crypto = await asWorker(FX_GAP_FILL_QUEUE, () => jobs.ingestion.cryptoFillGaps());
    logger.info({ 'job.queue': FX_GAP_FILL_QUEUE, result, crypto }, 'fx rate gaps filled');
  });
  if (settings.backfillEnabled) {
    await queue.schedule(FX_GAP_FILL_QUEUE, FX_GAP_FILL_CRON, { trigger: 'cron' }, { tz: FX_GAP_FILL_TZ });
    if (options.gapFillOnStart ?? true) await queue.send(FX_GAP_FILL_QUEUE, { trigger: 'startup' });
  } else {
    await queue.unschedule(FX_GAP_FILL_QUEUE);
  }
  if (settings.cryptoConfigError) {
    // Solo los providers cripto quedan deshabilitados: los de tasa paralela siguen (NFR-COMP-007).
    logger.error(
      { code: 'FX_PROVIDER_CONFIG_INVALID', reason: settings.cryptoConfigError },
      'fx crypto rate providers not started: invalid configuration',
    );
  }
  logger.info(
    {
      queues: [FX_POLL_QUEUE, FX_BACKFILL_QUEUE, FX_GAP_FILL_QUEUE],
      cron: settings.pollCron,
      primary: settings.primary,
      fallback: settings.fallback,
      official: settings.official,
      cryptoPrimary: settings.cryptoPrimary,
      cryptoFallback: settings.cryptoFallback,
    },
    'fx market rate providers scheduled',
  );

  return [
    {
      consumer: FX_WORKSPACE_PROVISIONING_CONSUMER,
      // Baja frecuencia (una vez por workspace): no reserva conexiones del pool del worker.
      concurrency: 1,
      events: [{ type: 'identity.WorkspaceCreated', version: 1 }],
      // En la transacción del consumidor (inbox + RLS del workspace): siembra preferencias PARALLEL y encola la carga
      // histórica con el id del evento como id del job (una re-entrega no duplica el job).
      handler: async (event, ctx) => {
        await jobs.ingestion.seedPreferences(event.workspaceId);
        if (!settings.backfillEnabled) return;
        const payload = event.payload as { readonly timeZone?: unknown; readonly baseCurrency?: unknown };
        const timeZone = typeof payload.timeZone === 'string' ? payload.timeZone : 'America/La_Paz';
        const baseCurrency = typeof payload.baseCurrency === 'string' ? payload.baseCurrency : undefined;
        await queue.enqueueInTransaction<BackfillPayload>(
          FX_BACKFILL_QUEUE,
          [
            {
              id: event.eventId,
              payload: {
                workspaceId: event.workspaceId,
                timeZone,
                ...(baseCurrency ? { baseCurrency } : {}),
              },
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

export interface UserConversionBackfillPayload {
  readonly trigger: 'startup' | 'manual';
}

/**
 * `ConversionBackfillSource` sobre la consulta pública de TRANSACTIONS (D231): la revisión vigente de todas las
 * conversiones del workspace con asiento (anuladas incluidas, marcadas), con la tasa efectiva en la orientación de
 * visualización de la conversión. Sin tocar tablas de TRANSACTIONS desde FX.
 */
export function conversionBackfillSource(details: ConversionDetailQuery): ConversionBackfillSource {
  return {
    async listCurrentConversions(workspaceId) {
      const rows = await details.listForCostAnalysis({
        workspaceId,
        from: '1970-01-01',
        to: '2999-12-31',
        includeVoided: true,
      });
      return rows.map((r) => ({
        transactionId: r.transactionId,
        revision: r.revision,
        base: r.effectiveRate.base,
        quote: r.effectiveRate.quote,
        value: r.effectiveRate.value,
        executedAt: r.executedAt,
        businessDate: r.businessDate,
        voided: r.voided,
      }));
    },
  };
}

/**
 * Observaciones de las conversiones propias (add-conversion-cost-analysis, D231, D249): registra el consumidor
 * `fx.user-conversion-observations` (concurrencia 1) y el job `fx.backfill-user-conversion-observations`, la carga
 * inicial IDEMPOTENTE de las conversiones anteriores al cambio (se encola al arrancar; repetirla no registra nada más).
 * Un workspace que falla no detiene a los demás; el siguiente arranque lo reintenta. Devuelve los consumidores de
 * eventos a suscribir.
 */
export async function registerFxUserConversionJobs(
  queue: JobQueue,
  observations: UserConversionObservations,
  source: ConversionBackfillSource,
  workspaces: { list(): Promise<readonly { readonly workspaceId: string }[]> },
  logger: Logger,
  options: { readonly runOnStart: boolean },
): Promise<EventConsumerDefinition[]> {
  await queue.work<UserConversionBackfillPayload>(
    FX_USER_CONVERSION_BACKFILL_JOB,
    { concurrency: 1 },
    async (job) => {
      await asWorker(`${FX_USER_CONVERSION_BACKFILL_JOB}:${job.payload.trigger}`, async () => {
        let recorded = 0;
        let withdrawn = 0;
        let failed = 0;
        for (const { workspaceId } of await workspaces.list()) {
          try {
            const result = await observations.backfill(workspaceId, source);
            recorded += result.recorded;
            withdrawn += result.withdrawn;
          } catch (err) {
            failed += 1;
            logger.error(
              {
                workspaceId,
                err: { type: err instanceof Error ? err.name : typeof err, message: String(err) },
              },
              'user conversion observations backfill failed for workspace',
            );
          }
        }
        logger.info(
          { job: FX_USER_CONVERSION_BACKFILL_JOB, recorded, withdrawn, failed },
          'user conversion observations backfilled',
        );
      });
    },
  );
  if (options.runOnStart) {
    await queue.send<UserConversionBackfillPayload>(FX_USER_CONVERSION_BACKFILL_JOB, { trigger: 'startup' });
  }
  return userConversionConsumers(observations);
}
