import type { ModuleMetadata } from '@nestjs/common';
import type { JwtVerifierOptions } from '@pf/platform/api';
import type { ApiConfig } from '@pf/platform/config';
import { PgOutboxWriter, type OutboxWriter } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import type { ApiConventionsOptions } from '@pf/platform/nest';
import { IdentityModule, type AuditPort, type OutboxPort } from '@pf/identity/interface/identity.module';
import type { Pool } from 'pg';
import { eventSchemaRegistry } from '../runtime/event-contracts.js';

/** Opciones JWT desde el contrato de configuración (`OIDC_*`); `undefined` si no hay emisor configurado. */
export function jwtOptionsFromConfig(config: ApiConfig): JwtVerifierOptions | undefined {
  if (!config.OIDC_ISSUER_URL) return undefined;
  const issuer = config.OIDC_ISSUER_URL.replace(/\/+$/, '');
  return {
    issuer,
    audience: config.OIDC_API_AUDIENCE,
    requiredScope: config.OIDC_REQUIRED_SCOPE,
    clockSkewSeconds: config.OIDC_CLOCK_SKEW_SECONDS,
    jwks: new URL(config.OIDC_JWKS_URI ?? `${issuer}/protocol/openid-connect/certs`),
  };
}

/**
 * `OutboxPort` de IDENTITY sobre el outbox transaccional real (openspec add-event-outbox, cierra la tarea 6.3 de
 * add-workspace-identity): el evento se escribe en la transacción de la Unit of Work del caso de uso y se valida
 * contra contracts/events. La auditoría sigue registrándose en el log hasta add-audit-trail (design § Decisiones 12).
 */
export function outboxPort(writer: OutboxWriter = new PgOutboxWriter(eventSchemaRegistry())): OutboxPort {
  return {
    append: async (event) => {
      await writer.append(event);
    },
  };
}

function loggingAudit(logger: Logger): { audit: AuditPort } {
  return {
    audit: {
      record: async (a) => {
        logger.info(
          { action: a.action, workspaceId: a.workspaceId },
          'audit sin persistencia (add-audit-trail)',
        );
      },
    },
  };
}

export function identityImports(input: {
  readonly config: ApiConfig;
  readonly pool: Pool;
  readonly conventions: ApiConventionsOptions;
  readonly logger: Logger;
  readonly jwt?: JwtVerifierOptions;
}): NonNullable<ModuleMetadata['imports']> {
  const jwt = input.jwt ?? jwtOptionsFromConfig(input.config);
  if (!jwt) {
    input.logger.warn(
      'OIDC_ISSUER_URL ausente: rutas /api/v1/me y /api/v1/workspaces no montadas (solo local/ci)',
    );
    return [];
  }
  return [
    IdentityModule.register({
      pool: input.pool,
      clock: input.conventions.clock,
      conventions: input.conventions,
      jwt,
      defaults: {
        baseCurrency: input.config.APP_REPORTING_CURRENCY,
        timeZone: input.config.APP_TIMEZONE,
        locale: input.config.APP_DEFAULT_LOCALE,
        personalWorkspaceName: 'Personal',
      },
      outbox: outboxPort(),
      ...loggingAudit(input.logger),
    }),
  ];
}
