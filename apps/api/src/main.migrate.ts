// Comando `migrate` (one-shot) de la imagen finance-api: dbmate up + rol pf_app + pg-boss + bucket (local/CI).
// Termina con 0 si todo quedó aplicado; Compose encadena api/worker con `service_completed_successfully`.
import { loadConfigOrExit } from '@pf/platform/config';
import { createLogger } from '@pf/platform/logging';
import { runMigrate } from './migrate/run-migrate.js';

const config = loadConfigOrExit('migrate');
const logger = createLogger({
  service: 'finance-api',
  role: 'migrate',
  environment: config.PFOS_ENV,
  level: config.LOG_LEVEL,
});

try {
  await runMigrate(config, logger);
} catch (err) {
  logger.fatal(
    { err: { type: err instanceof Error ? err.name : typeof err, message: (err as Error).message } },
    'migrate failed',
  );
  process.exit(1);
}
