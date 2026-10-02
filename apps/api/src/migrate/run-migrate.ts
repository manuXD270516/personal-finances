import type { MigrateConfig } from '@pf/platform/config';
import type { Logger } from '@pf/platform/logging';
import { createObjectStorageClient } from '@pf/platform/storage';
import { Client } from 'pg';
import { ensureAppRolePassword } from './app-role.js';
import { ensureBucket } from './bucket.js';
import { runDbmateUp } from './dbmate.js';
import { installJobQueueSchema } from './pgboss.js';

export interface MigrateOptions {
  readonly migrationsDir?: string;
}

/**
 * Comando `migrate` (one-shot, rol `pf_migrator`). Idempotente; el orden importa:
 *  1. `dbmate up`: migraciones SQL (schemas, rol pf_app, grants y default privileges).
 *  2. Contraseña de `pf_app` alineada con DATABASE_URL.
 *  3. Schema de pg-boss (DDL fuera de la app) + grants para pf_app.
 *  4. Solo local/CI: bucket con CORS y versioning.
 * Compose condiciona api/worker a que este proceso termine con 0 (`service_completed_successfully`).
 */
export async function runMigrate(
  config: MigrateConfig,
  logger: Logger,
  options: MigrateOptions = {},
): Promise<void> {
  const started = Date.now();
  await runDbmateUp({
    databaseUrl: config.DATABASE_MIGRATOR_URL,
    logger,
    ...(options.migrationsDir ? { migrationsDir: options.migrationsDir } : {}),
  });

  const migrator = new Client({
    connectionString: config.DATABASE_MIGRATOR_URL,
    application_name: 'pfos-migrate',
  });
  await migrator.connect();
  try {
    await ensureAppRolePassword(migrator, config.DATABASE_URL);
    await installJobQueueSchema(migrator, config.DATABASE_MIGRATOR_URL);
  } finally {
    await migrator.end();
  }

  if (config.OBJECT_STORAGE_ENSURE_BUCKET) {
    const s3 = createObjectStorageClient(config);
    try {
      await ensureBucket(s3, {
        bucket: config.OBJECT_STORAGE_BUCKET,
        corsOrigins: (config.OBJECT_STORAGE_CORS_ORIGINS ?? '')
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean),
        logger,
      });
    } finally {
      s3.destroy();
    }
  }
  logger.info({ duration_ms: Date.now() - started }, 'migrate completed');
}
