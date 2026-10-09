import { Writable } from 'node:stream';
import { loadConfig, type ApiConfig, type WorkerConfig } from '@pf/platform/config';
import { createLogger, type Logger, type ProcessRole } from '@pf/platform/logging';
import { Pool } from 'pg';
import type { Dependencies } from './global-setup.js';

export type LogRecord = Record<string, unknown>;

/** Logger real (mismas opciones que producción) con salida capturada en memoria. */
export function capturingLogger(service: string, role: ProcessRole, level = 'info') {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(...chunk.toString('utf8').split('\n').filter(Boolean));
      cb();
    },
  });
  const logger: Logger = createLogger({ service, role, environment: 'ci', level, destination: stream });
  return {
    logger,
    lines,
    records: (): LogRecord[] => lines.map((l) => JSON.parse(l) as LogRecord),
  };
}

export function baseEnv(deps: Dependencies, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    PFOS_ENV: 'ci',
    LOG_LEVEL: 'info',
    DATABASE_URL: deps.databaseUrl,
    WORKER_DATABASE_URL: deps.workerDatabaseUrl,
    OBJECT_STORAGE_ENDPOINT: deps.s3Endpoint,
    OBJECT_STORAGE_BUCKET: deps.bucket,
    OBJECT_STORAGE_EXPORTS_BUCKET: deps.exportsBucket,
    EXPORT_ENCRYPTION_KEYS: deps.exportKeys,
    EXPORT_ENCRYPTION_ACTIVE_KEY_ID: 'k1',
    OBJECT_STORAGE_ACCESS_KEY: deps.s3AccessKey,
    OBJECT_STORAGE_SECRET_KEY: deps.s3SecretKey,
    HEALTH_CHECK_TIMEOUT_MS: '1500',
    // Sin red en tests: providers de tasas de mercado deshabilitados salvo que el test los simule localmente.
    FX_PROVIDER_PRIMARY: 'none',
    FX_PROVIDER_FALLBACK: 'none',
    FX_PROVIDER_OFFICIAL: 'none',
    ...overrides,
  };
}

export const apiConfig = (env: Record<string, string>): ApiConfig => loadConfig('api', env);
export const workerConfig = (env: Record<string, string>): WorkerConfig => loadConfig('worker', env);

/** Reemplaza host:puerto de una URL de conexión (para pasar por el proxy TCP). */
export function viaPort(url: string, port: number): string {
  const u = new URL(url);
  u.hostname = '127.0.0.1';
  u.port = String(port);
  return u.toString();
}

export async function waitFor<T>(fn: () => T | undefined, timeoutMs = 20_000, stepMs = 100): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = fn();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error('waitFor: timeout');
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** Tipos de evento que consumen las notificaciones (openspec add-alerts): su atraso en el outbox retrasa a NOTIFY. */
export const NOTIFY_SOURCE_EVENT_TYPES = [
  'planning.BudgetThresholdReached',
  'planning.MonthClosePending',
] as const;

/**
 * Aislamiento entre archivos de integración (que comparten la misma PostgreSQL): los archivos anteriores dejan trabajos
 * pendientes en las colas de pg-boss (`events.*`, y `fx.backfill-historical-rates`, uno por workspace creado) y hechos
 * sin publicar en el outbox (las suites de API no tienen relay). El worker del test siguiente los publica y procesa
 * antes que sus propios eventos y agota el tiempo de espera (el backlog del outbox solo lo ve `pf_worker`: con RLS
 * forzada el dueño de la tabla no ve filas sin workspace). Se descartan SOLO los trabajos pendientes (`created`/`retry`,
 * nunca los activos ni los internos de pg-boss) y los hechos sin publicar de los tipos indicados (por defecto, los que
 * consume NOTIFY), nunca todo el outbox. Debe llamarse ANTES de crear datos y de arrancar el primer worker del archivo;
 * no existe en producción.
 */
export async function discardStaleEventBacklog(
  deps: Pick<Dependencies, 'migratorUrl' | 'workerDatabaseUrl'>,
  eventTypes: readonly string[] = NOTIFY_SOURCE_EVENT_TYPES,
): Promise<void> {
  const migrator = new Pool({ connectionString: deps.migratorUrl, max: 1 });
  const worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 1 });
  try {
    await migrator.query(
      `DELETE FROM pgboss.job WHERE name NOT LIKE '%pgboss%' AND state IN ('created', 'retry')`,
    );
    await worker.query(
      `UPDATE platform.outbox SET published_at = clock_timestamp()
        WHERE published_at IS NULL AND event_type = ANY($1::text[])`,
      [[...eventTypes]],
    );
  } finally {
    await Promise.all([migrator.end(), worker.end()]);
  }
}
