// Entrypoint `seed` (one-shot). Placeholder: los datasets minimal/demo/large llegan con docs/29 y la tarea 4.6.
import { loadConfigOrExit } from '@pf/platform/config';
import { createLogger } from '@pf/platform/logging';

const config = loadConfigOrExit('seed');
const logger = createLogger({
  service: 'finance-api',
  role: 'seed',
  environment: config.PFOS_ENV,
  level: config.LOG_LEVEL,
});

// Los seeds son solo de desarrollo/CI (docs/19 §6.1, docs/29): nunca contra staging/production.
if (config.PFOS_ENV === 'staging' || config.PFOS_ENV === 'production') {
  logger.error({ environment: config.PFOS_ENV }, 'seed rejected outside local/ci');
  process.exit(1);
}

logger.info({ seeded: 0 }, 'sin seeds');
