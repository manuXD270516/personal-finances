import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { ApiConfig } from '@pf/platform/config';
import type { Logger } from '@pf/platform/logging';
import { httpContextMiddleware, PinoNestLogger } from '@pf/platform/nest';
import { shutdownTelemetry } from '@pf/platform/otel';
import { createApiResources, type ApiResources } from '../runtime/platform-resources.js';
import { ApiModule } from './api.module.js';

/** Rutas operativas fuera de la API versionada (proposal: los probes no dependen de auth ni de versionado). */
const UNVERSIONED_ROUTES = ['health/live', 'health/ready', 'internal/platform/ping'];

export interface ApiRuntime {
  readonly app: INestApplication;
  readonly resources: ApiResources;
  /** Escucha en `port`/`host` (por defecto los de la configuración). Devuelve la URL base. */
  listen(port?: number, host?: string): Promise<string>;
  /** Apagado ordenado: deja de aceptar conexiones, cierra cola, pool y storage, y vacía la telemetría. */
  close(): Promise<void>;
}

export async function createApiRuntime(config: ApiConfig, logger: Logger): Promise<ApiRuntime> {
  const resources = createApiResources(config, logger);
  await resources.queue.start();

  const app = await NestFactory.create(
    ApiModule.register({
      probe: resources.probe,
      queue: resources.queue,
      logger,
      diagnostics: config.PFOS_ENV === 'local' || config.PFOS_ENV === 'ci',
    }),
    { logger: new PinoNestLogger(logger), abortOnError: false },
  );
  app.use(httpContextMiddleware(logger));
  app.setGlobalPrefix('api/v1', { exclude: UNVERSIONED_ROUTES });
  await app.init();

  let closed = false;
  return {
    app,
    resources,
    async listen(port = config.API_PORT, host = config.API_BIND_ADDRESS) {
      await app.listen(port, host);
      const address = app.getHttpServer().address() as AddressInfo;
      const url = `http://${host.includes(':') ? `[${host}]` : host}:${address.port}`;
      logger.info({ port: address.port }, 'api listening');
      return url;
    },
    async close() {
      if (closed) return;
      closed = true;
      await app.close();
      await resources.close();
      await shutdownTelemetry();
    },
  };
}
