import type { S3Client } from '@aws-sdk/client-s3';
import type { ApiConfig } from '@pf/platform/config';
import {
  isValkeyEnabled,
  objectStorageCheck,
  postgresCheck,
  ReadinessProbe,
  valkeyCheck,
  type DependencyCheck,
} from '@pf/platform/health';
import type { Logger } from '@pf/platform/logging';
import { PgBossJobQueue, type JobQueue } from '@pf/platform/queue';
import { createObjectStorageClient } from '@pf/platform/storage';
import { Pool } from 'pg';

/**
 * Elige el adapter de la cola según el toggle (docs/19 §0.3 punto 6). El dominio nunca se entera.
 * BullMQ/Valkey es un adapter opcional aún no implementado (ADR-0008): fallar al arrancar es explícito.
 * `connectionString`: DATABASE_URL (pf_app) en la API, WORKER_DATABASE_URL (pf_worker) en el worker.
 */
export function createJobQueue(
  config: Pick<ApiConfig, 'JOB_QUEUE_DRIVER' | 'JOB_QUEUE_POLLING_INTERVAL_SECONDS'>,
  connectionString: string,
  logger: Logger,
  role: 'producer' | 'consumer',
): JobQueue {
  if (config.JOB_QUEUE_DRIVER !== 'pgboss') {
    throw new Error(`JOB_QUEUE_DRIVER=${config.JOB_QUEUE_DRIVER} todavía no tiene adapter (solo pgboss)`);
  }
  return new PgBossJobQueue({
    connectionString,
    pollingIntervalSeconds: config.JOB_QUEUE_POLLING_INTERVAL_SECONDS,
    logger,
    role,
  });
}

export interface ApiResources {
  readonly pool: Pool;
  readonly storage: S3Client;
  readonly queue: JobQueue;
  readonly probe: ReadinessProbe;
  close(): Promise<void>;
}

export function createApiResources(config: ApiConfig, logger: Logger): ApiResources {
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    connectionTimeoutMillis: config.HEALTH_CHECK_TIMEOUT_MS,
    application_name: 'finance-api',
  });
  // Un cliente ocioso que pierde la conexión emite 'error': sin listener tumbaría el proceso.
  pool.on('error', (err) =>
    logger.warn({ err: { type: err.name, message: err.message } }, 'idle database client error'),
  );

  const storage = createObjectStorageClient(config);
  const checks: DependencyCheck[] = [
    postgresCheck(pool),
    objectStorageCheck(storage, config.OBJECT_STORAGE_BUCKET),
  ];
  if (isValkeyEnabled(config) && config.VALKEY_URL) checks.push(valkeyCheck(config.VALKEY_URL));

  const probe = new ReadinessProbe(checks, config.HEALTH_CHECK_TIMEOUT_MS, (dependency, error) =>
    logger.warn(
      { dependency, err: { type: error instanceof Error ? error.name : typeof error } },
      'readiness check failed',
    ),
  );
  const queue = createJobQueue(config, config.DATABASE_URL, logger, 'producer');

  return {
    pool,
    storage,
    queue,
    probe,
    async close() {
      await queue.stop();
      await pool.end();
      storage.destroy();
    },
  };
}
