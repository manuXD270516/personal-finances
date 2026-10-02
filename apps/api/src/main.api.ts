// Comando `api` de la imagen finance-api (vía dist/entrypoint.js, que registra OTel antes de cargar este módulo).
import 'reflect-metadata';
import { loadConfigOrExit } from '@pf/platform/config';
import { installGracefulShutdown } from '@pf/platform/lifecycle';
import { createLogger } from '@pf/platform/logging';
import { shutdownTelemetry } from '@pf/platform/otel';
import { createApiRuntime } from './api/create-api-runtime.js';

const config = loadConfigOrExit('api');
const logger = createLogger({
  service: 'finance-api',
  role: 'api',
  environment: config.PFOS_ENV,
  level: config.LOG_LEVEL,
});

try {
  const runtime = await createApiRuntime(config, logger);
  installGracefulShutdown(() => runtime.close(), { logger, timeoutMs: config.SHUTDOWN_TIMEOUT_MS });
  await runtime.listen();
} catch (err) {
  logger.fatal({ err }, 'api failed to start');
  await shutdownTelemetry();
  process.exit(1);
}
