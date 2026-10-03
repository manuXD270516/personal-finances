import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtVerifier, type JwtVerifierOptions } from '@pf/platform/api';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import { DomainError, type Clock } from '@pf/shared-kernel';
import { currentRequestContext, PgUnitOfWork } from '@pf/platform/api';
import type { Pool } from 'pg';
import { IdentityService } from '../application/identity.service.js';
import type {
  AuditPort,
  OutboxPort,
  WorkspaceCreatedHook,
  WorkspaceDefaults,
} from '../application/ports/index.js';
import { PgUserRepository, PgWorkspaceRepository, pgIdentityDeps } from '../infrastructure/pg-identity.js';
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
  /** Outbox transaccional (add-event-outbox) y auditoría síncrona (`@pf/audit`, add-audit-trail). */
  readonly outbox: OutboxPort;
  readonly audit: AuditPort;
  /** Provisión síncrona de otros contextos al crear un workspace (add-classification). */
  readonly onWorkspaceCreated?: WorkspaceCreatedHook;
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
      ...(options.onWorkspaceCreated ? { onWorkspaceCreated: options.onWorkspaceCreated } : {}),
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

/**
 * Zona horaria IANA de un workspace para otros contextos (AUDIT interpreta `from`/`to` en ella). Lee con el contexto
 * RLS del usuario que consulta (solo ve workspaces de los que es miembro activo).
 */
export function identityWorkspaceTimeZones(pool: Pool): {
  timeZoneOf(userId: string, workspaceId: string): Promise<string>;
} {
  const uow = new PgUnitOfWork(pool);
  const workspaces = new PgWorkspaceRepository();
  return {
    timeZoneOf: (userId, workspaceId) =>
      uow.run({ userId, workspaceId }, async () => {
        const ws = await workspaces.findById(workspaceId);
        if (!ws) throw new Error('workspace not visible for time zone lookup');
        return ws.settings.timeZone.value;
      }),
  };
}

/**
 * Moneda de reporte (`baseCurrency`) y zona horaria del workspace para otros contextos (FX valora el costo de una
 * conversión en la moneda de reporte y fecha las tasas en la zona del workspace; add-manual-conversions). Se invoca
 * dentro de la unidad de trabajo del llamador, con el usuario de la petición (RLS de membresía).
 */
export function identityWorkspaceSettings(pool: Pool): {
  settingsOf(workspaceId: string): Promise<{ readonly baseCurrency: string; readonly timeZone: string }>;
} {
  const uow = new PgUnitOfWork(pool);
  const workspaces = new PgWorkspaceRepository();
  return {
    settingsOf: (workspaceId) => {
      const actor = currentRequestContext()?.actor;
      const userId = actor && actor.type === 'USER' ? actor.userId : null;
      return uow.run({ userId, workspaceId }, async () => {
        const ws = await workspaces.findById(workspaceId);
        if (!ws) throw new DomainError('RESOURCE_NOT_FOUND', `workspace ${workspaceId} not found`);
        return { baseCurrency: ws.settings.baseCurrency.code, timeZone: ws.settings.timeZone.value };
      });
    },
  };
}

/**
 * Locale del usuario (`Me.locale`) para otros contextos (CLASSIFICATION nombra las categorías de sistema en él).
 * Lee con el contexto RLS del propio usuario (solo ve su fila).
 */
export function identityUserLocales(pool: Pool): { localeOf(userId: string): Promise<string> } {
  const uow = new PgUnitOfWork(pool);
  const users = new PgUserRepository();
  return {
    localeOf: (userId) =>
      uow.run(
        { userId, workspaceId: null },
        async () => (await users.findById(userId))?.locale.value ?? 'es',
      ),
  };
}

export { JwtVerifier };
export type { AuditPort, OutboxPort, WorkspaceCreatedHook, WorkspaceDefaults };
