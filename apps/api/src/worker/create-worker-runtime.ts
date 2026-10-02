import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { WorkerConfig } from '@pf/platform/config';
import {
  objectStorageCheck,
  postgresCheck,
  ReadinessProbe,
  startHealthServer,
  type HealthServer,
} from '@pf/platform/health';
import type { Logger } from '@pf/platform/logging';
import { PinoNestLogger } from '@pf/platform/nest';
import { shutdownTelemetry } from '@pf/platform/otel';
import type { JobQueue } from '@pf/platform/queue';
import { createObjectStorageClient } from '@pf/platform/storage';
import { Pool } from 'pg';
import { createJobQueue } from '../runtime/platform-resources.js';
import { WorkerModule } from './platform-jobs.js';

export interface WorkerRuntime {
  readonly context: INestApplicationContext;
  readonly queue: JobQueue;
  readonly pool: Pool;
  /** Publica `/health/live` y `/health/ready` (por defecto en WORKER_HEALTH_PORT). Devuelve el puerto. */
  listenHealth(port?: number, host?: string): Promise<number>;
  /**
   * Apagado ordenado (NFR-REL-009): readiness pasa a 503, deja de tomar jobs, espera a que terminen los activos
   * (pg-boss `offWork({ wait: true })`), cierra la cola, el pool y vacía la telemetría.
   */
  close(): Promise<void>;
}

export async function createWorkerRuntime(config: WorkerConfig, logger: Logger): Promise<WorkerRuntime> {
  const queue = createJobQueue(config, logger, 'consumer');
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: Math.min(config.DATABASE_POOL_MAX, 4),
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

  let draining = false;
  let health: HealthServer | undefined;
  let closed = false;
  return {
    context,
    queue,
    pool,
    async listenHealth(port = config.WORKER_HEALTH_PORT, host = config.WORKER_HEALTH_BIND_ADDRESS) {
      health = await startHealthServer({ port, host, probe, isDraining: () => draining });
      logger.info({ port: health.port }, 'worker health listening');
      return health.port;
    },
    async close() {
      if (closed) return;
      closed = true;
      draining = true;
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
