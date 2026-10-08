import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtVerifier, type JwtVerifierOptions } from '@pf/platform/api';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import { DomainError, type Clock } from '@pf/shared-kernel';
import { currentRequestContext, PgUnitOfWork } from '@pf/platform/api';
import type { Pool } from 'pg';
import { DemoDataService } from '../application/demo-data.service.js';
import { IdentityService } from '../application/identity.service.js';
import type { WorkspaceCalendarQuery } from '../contracts/index.js';
import type {
  AuditPort,
  DemoDataSettings,
  DemoJobPort,
  IdentityDeps,
  OutboxPort,
  WorkspaceCreatedHook,
  WorkspaceDefaults,
} from '../application/ports/index.js';
import {
  PgDemoRunRepository,
  PgUserRepository,
  PgWorkspaceRepository,
  pgDemoPurge,
  pgIdentityDeps,
} from '../infrastructure/pg-identity.js';
import {
  DEMO_DATA_SERVICE,
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
  /** Datos de demostración (add-demo-data): habilitación, dataset y cola de jobs. Ausente ⇒ carga deshabilitada. */
  readonly demo?: DemoDataOptions;
}

export interface DemoDataOptions {
  readonly settings: DemoDataSettings;
  readonly jobs: DemoJobPort;
}

/** Carga deshabilitada (sin configuración): la API rechaza con `DEMO_DATA_DISABLED`; los jobs nunca se encolan. */
const DISABLED_DEMO: DemoDataOptions = {
  settings: { enabled: false, datasetVersion: '1', workspaceName: 'Demo', modules: [] },
  jobs: {
    enqueueLoad: () => Promise.reject(new Error('demo jobs not configured')),
    enqueuePurge: () => Promise.reject(new Error('demo jobs not configured')),
  },
};

/** `DemoDataService` sobre PostgreSQL (API con pf_app; worker con pf_worker, que además puede purgar). */
export function demoDataService(deps: IdentityDeps, demo: DemoDataOptions = DISABLED_DEMO): DemoDataService {
  return new DemoDataService({
    ...deps,
    demoRuns: new PgDemoRunRepository(),
    demoJobs: demo.jobs,
    demoPurge: pgDemoPurge,
    demo: demo.settings,
  });
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
        { provide: DEMO_DATA_SERVICE, useValue: demoDataService(deps, options.demo) },
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
 * Moneda base y zona horaria del workspace para el worker (openspec add-budget-templates: el job de creación de periodos
 * crea el plan del template predeterminado en la moneda base). Igual que `identityWorkspaceCalendarDirectory`: lee en
 * una conexión PROPIA con el rol de directorio (`SET LOCAL ROLE pf_workspace_directory`, columnas `base_currency` y
 * `time_zone`; migración 20261008160000), nunca dentro de la transacción del llamador.
 */
export function identityWorkspaceSettingsDirectory(pool: Pool): {
  settingsOf(workspaceId: string): Promise<{ readonly baseCurrency: string; readonly timeZone: string }>;
} {
  return {
    async settingsOf(workspaceId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        await client.query('SET LOCAL ROLE pf_workspace_directory');
        const { rows } = await client.query<{ base_currency: string; time_zone: string }>(
          `SELECT base_currency, time_zone FROM iam.workspace WHERE id = $1`,
          [workspaceId],
        );
        await client.query('COMMIT');
        const row = rows[0];
        if (!row) throw new DomainError('RESOURCE_NOT_FOUND', `workspace ${workspaceId} not found`);
        return { baseCurrency: row.base_currency, timeZone: row.time_zone };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

/**
 * `WorkspaceCalendarQuery` de la API (openspec add-financial-periods): zona horaria y día de inicio del mes financiero
 * con el contexto RLS del usuario de la petición (membresía). Reutiliza la unidad de trabajo del llamador si existe.
 */
export function identityWorkspaceCalendar(pool: Pool): WorkspaceCalendarQuery {
  const uow = new PgUnitOfWork(pool);
  const workspaces = new PgWorkspaceRepository();
  return {
    calendarOf: (workspaceId) => {
      const actor = currentRequestContext()?.actor;
      const userId = actor && actor.type === 'USER' ? actor.userId : null;
      return uow.run({ userId, workspaceId }, async () => {
        const ws = await workspaces.findById(workspaceId);
        if (!ws) throw new DomainError('RESOURCE_NOT_FOUND', `workspace ${workspaceId} not found`);
        return { timeZone: ws.settings.timeZone.value, fiscalMonthStartDay: ws.settings.fiscalMonthStartDay };
      });
    },
  };
}

/**
 * `WorkspaceCalendarQuery` del worker (jobs y consumidores de PLANNING): `pf_worker` no ve `iam.workspace` (RLS por
 * membresía), así que lee en una conexión PROPIA con el rol de directorio (`SET LOCAL ROLE pf_workspace_directory`,
 * columnas `time_zone` y `fiscal_month_start_day`; migración 20261008120000). Nunca dentro de la transacción del
 * llamador (el `SET LOCAL ROLE` cambiaría su rol).
 */
export function identityWorkspaceCalendarDirectory(pool: Pool): WorkspaceCalendarQuery {
  return {
    async calendarOf(workspaceId) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        await client.query('SET LOCAL ROLE pf_workspace_directory');
        const { rows } = await client.query<{ time_zone: string; fiscal_month_start_day: number }>(
          `SELECT time_zone, fiscal_month_start_day FROM iam.workspace WHERE id = $1`,
          [workspaceId],
        );
        await client.query('COMMIT');
        const row = rows[0];
        if (!row) throw new DomainError('RESOURCE_NOT_FOUND', `workspace ${workspaceId} not found`);
        return { timeZone: row.time_zone, fiscalMonthStartDay: Number(row.fiscal_month_start_day) };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

/**
 * Directorio de workspaces ACTIVOS (id y zona horaria) para jobs de instalación del worker (add-market-rate-providers:
 * FX copia cada tasa de provider a cada workspace). Requiere el pool del worker (`pf_worker`): asume
 * `pf_workspace_directory` solo dentro de la transacción de la consulta (migración 20261003230100).
 */
export function identityActiveWorkspaces(pool: Pool): {
  list(): Promise<readonly { readonly workspaceId: string; readonly timeZone: string }[]>;
} {
  return {
    async list() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN READ ONLY');
        await client.query('SET LOCAL ROLE pf_workspace_directory');
        const { rows } = await client.query<{ id: string; time_zone: string }>(
          `SELECT id::text AS id, time_zone FROM iam.workspace
            WHERE status = 'ACTIVE' AND archived_at IS NULL ORDER BY id`,
        );
        await client.query('COMMIT');
        return rows.map((r) => ({ workspaceId: r.id, timeZone: r.time_zone }));
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
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

/**
 * Composición de `DemoDataService` para el worker (jobs `demo.load` y `demo.purge`; add-demo-data). El `pool` es el del
 * worker (`pf_worker`): solo él puede ejecutar `platform.purge_demo_workspace`.
 */
export function createDemoDataRuntime(input: {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly outbox: OutboxPort;
  readonly audit: AuditPort;
  readonly defaults: WorkspaceDefaults;
  readonly demo: DemoDataOptions;
  readonly onWorkspaceCreated?: WorkspaceCreatedHook;
}): DemoDataService {
  const deps = pgIdentityDeps({
    pool: input.pool,
    outbox: input.outbox,
    audit: input.audit,
    clock: input.clock,
    defaults: input.defaults,
    ...(input.onWorkspaceCreated ? { onWorkspaceCreated: input.onWorkspaceCreated } : {}),
  });
  return demoDataService(deps, input.demo);
}

export {
  DEMO_ACTOR_PROCESS,
  DemoDataService,
  type DemoDataStatusView,
} from '../application/demo-data.service.js';
export type {
  DemoDataSettings,
  DemoJobPort,
  DemoLoadJob,
  DemoProgress,
  DemoPurgeJob,
} from '../application/ports/index.js';
