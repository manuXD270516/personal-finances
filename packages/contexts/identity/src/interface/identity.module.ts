import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtVerifier, type JwtVerifierOptions } from '@pf/platform/api';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { IdentityService } from '../application/identity.service.js';
import type { AuditPort, OutboxPort, WorkspaceDefaults } from '../application/ports/index.js';
import { pgIdentityDeps } from '../infrastructure/pg-identity.js';
import {
  IDENTITY_DEFAULTS,
  IDENTITY_DEPS,
  IDENTITY_SERVICE,
  IdentityAccessGuard,
  IdentityController,
  JWT_VERIFIER,
} from './identity-http.js';

export interface IdentityModuleOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  /** Convenciones de API (contrato, reloj) del composition root. */
  readonly conventions: ApiConventionsOptions;
  readonly defaults: WorkspaceDefaults;
  /** Validación de access tokens (JWKS remoto en runtime; JWKS local en tests). */
  readonly jwt: JwtVerifierOptions;
  /** Puertos sin adapter PostgreSQL todavía (tarea 6.3 / add-audit-trail); ver design.md § Decisiones 12. */
  readonly outbox: OutboxPort;
  readonly audit: AuditPort;
}

/**
 * Módulo HTTP de IDENTITY (`/api/v1/me`, `/api/v1/workspaces*`): guard global de autenticación + autorización por
 * workspace dirigido por `x-required-role` y controllers del contrato. Problem Details, ETag, `If-Match` e
 * idempotencia los aportan las convenciones de `@pf/platform/nest` (globales).
 */
@Module({})
export class IdentityModule {
  static register(options: IdentityModuleOptions): DynamicModule {
    const deps = pgIdentityDeps({
      pool: options.pool,
      outbox: options.outbox,
      audit: options.audit,
      clock: options.clock,
      defaults: options.defaults,
    });
    return {
      module: IdentityModule,
      controllers: [IdentityController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: IDENTITY_DEPS, useValue: deps },
        { provide: IDENTITY_SERVICE, useValue: new IdentityService(deps) },
        { provide: IDENTITY_DEFAULTS, useValue: options.defaults },
        { provide: JWT_VERIFIER, useValue: new JwtVerifier(options.jwt) },
        { provide: APP_GUARD, useClass: IdentityAccessGuard },
      ],
    };
  }
}

export { JwtVerifier };
export type { AuditPort, OutboxPort, WorkspaceDefaults };
