// Entrypoint `migrate` (one-shot). Placeholder: la migración SQL de bootstrap (schema `platform`, roles
// pf_migrator / pf_app) y dbmate llegan con la tarea 4.5. Termina con 0 para que Compose pueda encadenar
// `service_completed_successfully`.
import { loadConfigOrExit } from '@pf/platform/config';
import { createLogger } from '@pf/platform/logging';

const config = loadConfigOrExit('migrate');
const logger = createLogger({
  service: 'finance-api',
  role: 'migrate',
  environment: config.PFOS_ENV,
  level: config.LOG_LEVEL,
});

logger.info({ applied: 0 }, 'sin migraciones');
