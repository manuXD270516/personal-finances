import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { WorkerConfig } from '@pf/platform/config';
import {
  EventConsumerRuntime,
  EventDeliveryMetrics,
  EventSubscriptions,
  OutboxRelay,
  type EventConsumerDefinition,
  type OutboxRelayOptions,
} from '@pf/platform/events';
import {
  objectStorageCheck,
  postgresCheck,
  ReadinessProbe,
  startHealthServer,
  type HealthServer,
} from '@pf/platform/health';
import type { Logger } from '@pf/platform/logging';
import { createLedgerMaintenance } from '@pf/ledger/interface/ledger.module';
import { PinoNestLogger } from '@pf/platform/nest';
import { otelCounters, shutdownTelemetry } from '@pf/platform/otel';
import type { JobQueue } from '@pf/platform/queue';
import { createObjectStorageClient } from '@pf/platform/storage';
import { systemClock, type Clock } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { createJobQueue } from '../runtime/platform-resources.js';
import { registerLedgerDailyJob } from './ledger-jobs.js';
import { WorkerModule } from './platform-jobs.js';

export interface WorkerRuntime {
  readonly context: INestApplicationContext;
  readonly queue: JobQueue;
  readonly pool: Pool;
  readonly relay: OutboxRelay;
  readonly consumers: EventConsumerRuntime;
  readonly subscriptions: EventSubscriptions;
  /** Publica `/health/live` y `/health/ready` (por defecto en WORKER_HEALTH_PORT). Devuelve el puerto. */
  listenHealth(port?: number, host?: string): Promise<number>;
  /**
   * Apagado ordenado (NFR-REL-009): readiness pasa a 503, el relay deja de publicar, la cola deja de tomar jobs y
   * espera a que terminen los activos (pg-boss `offWork({ wait: true })`), y se cierran cola, pool y telemetría.
   */
  close(): Promise<void>;
}

export interface WorkerRuntimeOptions {
  /** Consumidores de eventos registrados por los contextos (y por los tests). */
  readonly eventConsumers?: readonly EventConsumerDefinition[];
  /** Ajustes del relay (tests: lote, polling, inyección de fallos). */
  readonly relay?: Partial<Pick<OutboxRelayOptions, 'batchSize' | 'pollIntervalMs' | 'afterEnqueue'>>;
  readonly metrics?: EventDeliveryMetrics;
  /** Reloj de los comandos del ledger (tests: FixedClock). */
  readonly clock?: Clock;
  /** Encola el mantenimiento diario del ledger al arrancar (por defecto sí; los tests lo desactivan). */
  readonly ledgerMaintenanceOnStart?: boolean;
}

export async function createWorkerRuntime(
  config: WorkerConfig,
  logger: Logger,
  options: WorkerRuntimeOptions = {},
): Promise<WorkerRuntime> {
  // pf_worker: relay del outbox entre workspaces, inbox y dead-letter (openspec add-event-outbox, design §4).
  const databaseUrl = config.WORKER_DATABASE_URL;
  if (!databaseUrl) throw new Error('WORKER_DATABASE_URL es obligatoria en el worker');
  const queue = createJobQueue(config, databaseUrl, logger, 'consumer');
  const pool = new Pool({
    connectionString: databaseUrl,
    max: Math.min(config.DATABASE_POOL_MAX, 6),
    connectionTimeoutMillis: config.HEALTH_CHECK_TIMEOUT_MS,
    application_name: 'finance-worker',
  });
  pool.on('error', (err) =>
    logger.warn({ err: { type: err.name, message: err.message } }, 'idle database client error'),
  );
  const storage = createObjectStorageClient(config);
  const probe = new ReadinessProbe(
    [postgresCheck(pool), objectStorageCheck(storage, config.OBJECT_STORAGE_BUCKET)],
    config.HEALTH_CHECK_TIMEOUT_MS,
    (dependency, error) =>
      logger.warn(
        { dependency, err: { type: error instanceof Error ? error.name : typeof error } },
        'readiness check failed',
      ),
  );

  const context = await NestFactory.createApplicationContext(
    WorkerModule.register({
      queue,
      logger,
      pool,
      concurrency: config.WORKER_CONCURRENCY,
      diagnostics: config.PFOS_ENV === 'local' || config.PFOS_ENV === 'ci',
    }),
    { logger: new PinoNestLogger(logger), abortOnError: false },
  );

  // Job diario del ledger: verificador de invariantes + snapshots (add-ledger-core 5.6). Corre también al arrancar,
  // así `restore:local` (que reinicia el worker) verifica el ledger restaurado.
  await registerLedgerDailyJob(
    queue,
    createLedgerMaintenance({
      pool,
      clock: options.clock ?? systemClock,
      logger,
      metrics: otelCounters('@pf/ledger'),
    }),
    logger,
    {
      cron: config.LEDGER_INTEGRITY_CRON,
      tz: config.LEDGER_INTEGRITY_CRON_TZ,
      runOnStart: options.ledgerMaintenanceOnStart ?? true,
    },
  );

  const metrics = options.metrics ?? new EventDeliveryMetrics(pool);
  const subscriptions = new EventSubscriptions(options.eventConsumers ?? []);
  const consumers = new EventConsumerRuntime({ pool, queue, subscriptions, logger, metrics });
  const relay = new OutboxRelay({
    pool,
    queue,
    routes: subscriptions,
    logger,
    metrics,
    listenConnectionString: databaseUrl,
    pollIntervalMs: Math.round(config.JOB_QUEUE_POLLING_INTERVAL_SECONDS * 1000),
    ...options.relay,
  });
  await consumers.start();
  await relay.start();

  let draining = false;
  let health: HealthServer | undefined;
  let closed = false;
  return {
    context,
    queue,
    pool,
    relay,
    consumers,
    subscriptions,
    async listenHealth(port = config.WORKER_HEALTH_PORT, host = config.WORKER_HEALTH_BIND_ADDRESS) {
      health = await startHealthServer({ port, host, probe, isDraining: () => draining });
      logger.info({ port: health.port }, 'worker health listening');
      return health.port;
    },
    async close() {
      if (closed) return;
      closed = true;
      draining = true;
      await relay.stop();
      await queue.drain();
      await context.close();
      await queue.stop();
      await health?.close();
      await pool.end();
      storage.destroy();
      await shutdownTelemetry();
    },
  };
}
