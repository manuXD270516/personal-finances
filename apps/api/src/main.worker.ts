// Entrypoint `worker` de la imagen finance-api. Con OTel: node --import @pf/platform/otel/register dist/main.worker.js
import 'reflect-metadata';
import { loadConfigOrExit } from '@pf/platform/config';
import { installGracefulShutdown } from '@pf/platform/lifecycle';
import { createLogger } from '@pf/platform/logging';
import { shutdownTelemetry } from '@pf/platform/otel';
import { createWorkerRuntime } from './worker/create-worker-runtime.js';

const config = loadConfigOrExit('worker');
const logger = createLogger({
  service: 'finance-worker',
  role: 'worker',
  environment: config.PFOS_ENV,
  level: config.LOG_LEVEL,
});

try {
  const runtime = await createWorkerRuntime(config, logger);
  installGracefulShutdown(() => runtime.close(), { logger, timeoutMs: config.SHUTDOWN_TIMEOUT_MS });
  logger.info('worker started');
} catch (err) {
  logger.fatal({ err }, 'worker failed to start');
  await shutdownTelemetry();
  process.exit(1);
}
