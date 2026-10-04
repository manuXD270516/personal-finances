import type { AddressInfo } from 'node:net';
import type { ModuleMetadata } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ApiConfig } from '@pf/platform/config';
import type { Logger } from '@pf/platform/logging';
import {
  httpContextMiddleware,
  PinoNestLogger,
  problemFallbackHandlers,
  requestContextMiddleware,
  type ApiConventionsOptions,
} from '@pf/platform/nest';
import { shutdownTelemetry } from '@pf/platform/otel';
import { createApiResources, type ApiResources } from '../runtime/platform-resources.js';
import { ApiModule } from './api.module.js';
import { createApiConventions, type ApiConventionsOverrides } from './api-conventions.js';
import { identityImports } from '../identity/identity-wiring.js';
import type { JwtVerifierOptions } from '@pf/platform/api';
import type { AuditPort, LifecyclePort } from '@pf/audit/interface/audit.module';

/** Rutas operativas fuera de la API versionada (proposal: los probes no dependen de auth ni de versionado). */
const UNVERSIONED_ROUTES = [
  'health/live',
  'health/ready',
  'internal/platform/ping',
  'internal/platform/probe',
];

export interface ApiRuntime {
  readonly app: NestExpressApplication;
  readonly resources: ApiResources;
  /** Escucha en `port`/`host` (por defecto los de la configuración). Devuelve la URL base. */
  listen(port?: number, host?: string): Promise<string>;
  /** Apagado ordenado: deja de aceptar conexiones, cierra cola, pool y storage, y vacía la telemetría. */
  close(): Promise<void>;
}

export interface ApiRuntimeOptions extends ApiConventionsOverrides {
  /** Módulos extra (tests: controllers de prueba del harness con acceso a los recursos). */
  readonly imports?: (
    resources: ApiResources,
    conventions: ApiConventionsOptions,
  ) => NonNullable<ModuleMetadata['imports']>;
  /** Middleware previo a las rutas (tests: fija el usuario autenticado hasta que exista add-workspace-identity). */
  readonly middleware?: Parameters<NestExpressApplication['use']>[0];
  /**
   * Monta IDENTITY (`/me`, `/workspaces*`) y AUDIT (`/audit-log`): por defecto según `OIDC_ISSUER_URL`; `false` los
   * omite (harness). `audit` envuelve el `AuditPort` (tests de atomicidad con fallos inyectados).
   */
  readonly identity?:
    | false
    | {
        readonly jwt?: JwtVerifierOptions;
        readonly audit?: (port: AuditPort) => AuditPort;
        /** Envuelve el `LifecyclePort` (TC-AUDIT-LIFECYCLE-002: fallo inyectado al escribir la transición). */
        readonly lifecycle?: (port: LifecyclePort) => LifecyclePort;
      };
}

export async function createApiRuntime(
  config: ApiConfig,
  logger: Logger,
  options: ApiRuntimeOptions = {},
): Promise<ApiRuntime> {
  const resources = createApiResources(config, logger);
  await resources.queue.start();

  const conventions = createApiConventions(config, resources.pool, logger, options);

  const app = await NestFactory.create<NestExpressApplication>(
    ApiModule.register({
      probe: resources.probe,
      queue: resources.queue,
      logger,
      diagnostics: config.PFOS_ENV === 'local' || config.PFOS_ENV === 'ci',
      conventions,
      imports: [
        ...(options.identity === false
          ? []
          : identityImports({
              config,
              pool: resources.pool,
              conventions,
              logger,
              ...(options.identity?.jwt ? { jwt: options.identity.jwt } : {}),
              ...(options.identity?.audit ? { audit: options.identity.audit } : {}),
              ...(options.identity?.lifecycle ? { lifecycle: options.identity.lifecycle } : {}),
            })),
        ...(options.imports?.(resources, conventions) ?? []),
      ],
    }),
    { logger: new PinoNestLogger(logger), abortOnError: false, bodyParser: false },
  );
  app.use(httpContextMiddleware(logger));
  // Contexto ambiental (origen, user agent, IP para su HMAC, Idempotency-Key) que usa la auditoría (add-audit-trail).
  app.use(requestContextMiddleware());
  // JSON y `application/*+json` (merge-patch de PATCH, docs/10 §2); errores de parseo → 400 VALIDATION_FAILED.
  app.useBodyParser('json', { type: ['application/json', 'application/*+json'], limit: '1mb' });
  if (options.middleware) app.use(options.middleware);
  app.setGlobalPrefix('api/v1', { exclude: UNVERSIONED_ROUTES });
  await app.init();
  // 404/errores problem+json también fuera de /api/v1 (p. ej. /api/v2/me: versión no publicada).
  const fallback = problemFallbackHandlers(conventions);
  app.use(fallback.notFound);
  app.use(fallback.onError);

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
