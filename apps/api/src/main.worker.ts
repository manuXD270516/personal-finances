// Comando `worker` de la imagen finance-api (vía dist/entrypoint.js, que registra OTel antes de cargar este módulo).
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
  await runtime.listenHealth();
  logger.info('worker started');
} catch (err) {
  logger.fatal({ err }, 'worker failed to start');
  await shutdownTelemetry();
  process.exit(1);
}
