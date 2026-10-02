import { installPgBossSchema, PGBOSS_SCHEMA } from '@pf/platform/queue';
import type { Client } from 'pg';
import { APP_ROLE } from './app-role.js';

/**
 * Instala/actualiza pg-boss con el rol propietario y concede a `pf_app` solo DML + EXECUTE sobre lo existente
 * (los objetos futuros los cubren los default privileges de la migración de bootstrap). La app arranca pg-boss
 * con `migrate: false`: si el schema falta o está desactualizado, falla en vez de intentar DDL.
 */
export async function installJobQueueSchema(migrator: Client, migratorUrl: string): Promise<void> {
  await installPgBossSchema(migratorUrl, PGBOSS_SCHEMA);
  await migrator.query(`
    GRANT USAGE ON SCHEMA ${PGBOSS_SCHEMA} TO ${APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${PGBOSS_SCHEMA} TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${PGBOSS_SCHEMA} TO ${APP_ROLE};
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${PGBOSS_SCHEMA} TO ${APP_ROLE};
  `);
}
