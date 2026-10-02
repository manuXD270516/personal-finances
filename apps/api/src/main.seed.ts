// Comando `seed` (one-shot): `seed --profile=minimal|demo|large`. Solo local/CI (docs/19 §8, docs/29).
import { loadConfigOrExit } from '@pf/platform/config';
import { createLogger } from '@pf/platform/logging';
import { parseSeedProfile, runSeed, SeedRejectedError } from './seed/run-seed.js';

const config = loadConfigOrExit('seed');
const logger = createLogger({
  service: 'finance-api',
  role: 'seed',
  environment: config.PFOS_ENV,
  level: config.LOG_LEVEL,
});

try {
  await runSeed(config, logger, parseSeedProfile(process.argv.slice(2)));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: { type: err instanceof Error ? err.name : typeof err, message } }, 'seed failed');
  process.exit(err instanceof SeedRejectedError ? 64 : 1);
}
