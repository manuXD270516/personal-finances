import { Module, type DynamicModule } from '@nestjs/common';
import { AUTHORIZATION_DENIAL_PORT, type AuthorizationDenialPort } from '@pf/audit/contracts';
import { APP_GUARD } from '@nestjs/core';
import { JwtVerifier, type JwtVerifierOptions } from '@pf/platform/api';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import { DomainError, type Clock } from '@pf/shared-kernel';
import { currentRequestContext, PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import type { Pool, PoolClient } from 'pg';
import { DemoDataService } from '../application/demo-data.service.js';
import type {
  ArchiveInspector,
  EnvelopeCipher,
  ExportArchiveBuilder,
  ExportObjectStore,
  PortabilityDeps,
  PortabilityJobPort,
  PortabilitySettings,
  WorkspaceImporter,
} from '../application/portability/ports.js';
import { RecentAuthPolicy } from '../application/portability/reauth.js';
import { WorkspaceExportService } from '../application/portability/workspace-export.service.js';
import { WorkspaceImportService } from '../application/portability/workspace-import.service.js';
import { IdentityService } from '../application/identity.service.js';
import type {
  WorkspaceCalendarQuery,
  WorkspaceRecipientDto,
  WorkspaceRecipientsQuery,
  WorkspaceRoleDto,
} from '../contracts/index.js';
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
  PgExportRepository,
  PgImportRepository,
  PgOperationRepository,
} from '../infrastructure/portability/pg-portability.js';
import {
  PORTABILITY_SETTINGS,
  PortabilityController,
  WORKSPACE_EXPORT_SERVICE,
  WORKSPACE_IMPORT_SERVICE,
} from './portability-http.js';
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
  /**
   * Registrador de rechazos de autorización (openspec add-global-audit-view, docs/33 D106): el guard audita
   * `INSUFFICIENT_ROLE` y `WORKSPACE_ACCESS_DENIED` como evento de seguridad. Ausente ⇒ no se auditan.
   */
  readonly denials?: AuthorizationDenialPort;
  /** Provisión síncrona de otros contextos al crear un workspace (add-classification). */
  readonly onWorkspaceCreated?: WorkspaceCreatedHook;
  /** Datos de demostración (add-demo-data): habilitación, dataset y cola de jobs. Ausente ⇒ carga deshabilitada. */
  readonly demo?: DemoDataOptions;
  /** Exportación/importación del workspace (add-workspace-export). Ausente ⇒ las operaciones responden 503. */
  readonly portability?: PortabilityOptions;
}

/** Piezas de la portabilidad que cablea el composition root (la clave maestra y las secciones viven fuera de IDENTITY). */
export interface PortabilityOptions {
  readonly store: ExportObjectStore;
  readonly cipher: EnvelopeCipher;
  readonly builder: ExportArchiveBuilder;
  readonly importer: WorkspaceImporter;
  readonly inspector: ArchiveInspector;
  readonly jobs: PortabilityJobPort;
  readonly settings: PortabilitySettings;
  /** Antigüedad máxima de la autenticación (`REAUTH_MAX_AGE`, ms). */
  readonly reauthMaxAgeMs: number;
}

/** Dependencias de los casos de uso de portabilidad sobre PostgreSQL. */
export function portabilityDeps(deps: IdentityDeps, options: PortabilityOptions): PortabilityDeps {
  return {
    ...deps,
    exports: new PgExportRepository(),
    imports: new PgImportRepository(),
    operations: new PgOperationRepository(),
    store: options.store,
    cipher: options.cipher,
    builder: options.builder,
    inspector: options.inspector,
    importer: options.importer,
    reauth: new RecentAuthPolicy(options.reauthMaxAgeMs),
    jobs: options.jobs,
    settings: options.settings,
  };
}

export function portabilityServices(deps: IdentityDeps, options: PortabilityOptions) {
  const full = portabilityDeps(deps, options);
  return { exports: new WorkspaceExportService(full), imports: new WorkspaceImportService(full) };
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
    const portability = options.portability ? portabilityServices(deps, options.portability) : undefined;
    return {
      module: IdentityModule,
      controllers: [IdentityController, PortabilityController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: IDENTITY_DEPS, useValue: deps },
        { provide: IDENTITY_SERVICE, useValue: new IdentityService(deps) },
        { provide: DEMO_DATA_SERVICE, useValue: demoDataService(deps, options.demo) },
        { provide: WORKSPACE_EXPORT_SERVICE, useValue: portability?.exports ?? {} },
        { provide: WORKSPACE_IMPORT_SERVICE, useValue: portability?.imports ?? {} },
        {
          provide: PORTABILITY_SETTINGS,
          useValue: {
            enabled: portability !== undefined,
            maxImportBytes: options.portability?.settings.maxImportBytes ?? 0,
          },
        },
        { provide: IDENTITY_DEFAULTS, useValue: options.defaults },
        { provide: JWT_VERIFIER, useValue: new JwtVerifier(options.jwt) },
        ...(options.denials ? [{ provide: AUTHORIZATION_DENIAL_PORT, useValue: options.denials }] : []),
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
 * Nombre visible actual de los usuarios que figuran como actores en el log de auditoría del workspace, para AUDIT (CSV
 * del log; fix-phase-2-gaps). Se resuelve en bloque con `iam.audit_actor_names` (SECURITY DEFINER acotada al workspace
 * del contexto RLS y a los actores de su log; ver la migración). Se invoca dentro de la unidad de trabajo del llamador.
 */
export function identityUserDisplayNames(): {
  namesOf(workspaceId: string, userIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
} {
  return {
    namesOf: async (workspaceId, userIds) => {
      if (userIds.length === 0) return new Map();
      const { rows } = await requireSqlExecutor().query(
        'SELECT user_id, display_name FROM iam.audit_actor_names($1::uuid, $2::uuid[])',
        [workspaceId, [...userIds]],
      );
      return new Map(
        (rows as { user_id: string; display_name: string }[]).map((r) => [r.user_id, r.display_name]),
      );
    },
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
 * `WorkspaceRecipientsQuery` del worker (openspec add-alerts, design § Contratos): miembros ACTIVOS de un workspace con
 * su rol, locale y zona horaria, y el email verificado de un usuario al despachar un correo. `pf_worker` no ve `iam.*`
 * por membresía (RLS), así que lee en una conexión PROPIA con el rol de directorio (`SET LOCAL ROLE
 * pf_workspace_directory`, columnas mínimas; migración 20261008190000), nunca dentro de la transacción del llamador.
 * El email no se persiste ni se loguea en NOTIFY: se pide solo en el momento del envío.
 */
export function identityWorkspaceRecipients(pool: Pool): WorkspaceRecipientsQuery {
  async function inDirectory<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query('SET LOCAL ROLE pf_workspace_directory');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
  return {
    activeMembers: (workspaceId) =>
      inDirectory(async (client) => {
        const { rows } = await client.query<{
          user_id: string;
          role: WorkspaceRoleDto;
          locale: string;
          time_zone: string;
        }>(
          `SELECT m.user_id::text AS user_id, m.role, u.locale, coalesce(u.time_zone, w.time_zone) AS time_zone
             FROM iam.workspace_membership m
             JOIN iam."user" u ON u.id = m.user_id AND u.status = 'ACTIVE'
             JOIN iam.workspace w ON w.id = m.workspace_id
            WHERE m.workspace_id = $1 AND m.status = 'ACTIVE'
            ORDER BY m.user_id`,
          [workspaceId],
        );
        return rows.map((r): WorkspaceRecipientDto => ({
          userId: r.user_id,
          role: r.role,
          locale: r.locale,
          timeZone: r.time_zone,
        }));
      }),
    emailFor: (userId) =>
      inDirectory(async (client) => {
        const { rows } = await client.query<{ email: string }>(
          `SELECT email FROM iam."user" WHERE id = $1 AND status = 'ACTIVE' AND email_verified`,
          [userId],
        );
        return rows[0]?.email ?? null;
      }),
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

/**
 * Locale del perfil (`iam.user.locale`) como TEXTO tolerante, para presentar contenido en el idioma del usuario
 * (openspec add-alerts: `es-*`, `en-*`, `pt-*` y español de respaldo para cualquier otro, incluso un tag que el perfil ya
 * no admite). A diferencia de `identityUserLocales`, no reconstruye el agregado `User` (su `Locale` rechaza tags no
 * soportados) y NO cambia el contexto RLS de la transacción en curso: lee con el `app.user_id` ya fijado por la
 * petición (política `user_self_read`). Fuera de una unidad de trabajo abre una propia solo con el usuario.
 */
export function identityUserLocaleTags(pool: Pool): { localeOf(userId: string): Promise<string> } {
  const uow = new PgUnitOfWork(pool);
  const read = async (userId: string): Promise<string> => {
    const { rows } = await requireSqlExecutor().query('SELECT locale FROM iam."user" WHERE id = $1', [
      userId,
    ]);
    const locale = (rows[0] as { locale?: unknown } | undefined)?.locale;
    return typeof locale === 'string' ? locale : 'es';
  };
  return {
    localeOf: (userId) => {
      try {
        requireSqlExecutor();
      } catch {
        return uow.run({ userId, workspaceId: null }, () => read(userId));
      }
      return read(userId);
    },
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

/**
 * Composición de los casos de uso de portabilidad para el worker (jobs `identity.workspace-export`,
 * `identity.workspace-import` e `identity.export-retention`; add-workspace-export). El `pool` es el del worker
 * (`pf_worker`): el constructor del archivo asume `pf_workspace_directory` solo para leer los nombres de los miembros.
 */
export function createPortabilityRuntime(input: {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly outbox: OutboxPort;
  readonly audit: AuditPort;
  readonly defaults: WorkspaceDefaults;
  readonly portability: PortabilityOptions;
}): { readonly exports: WorkspaceExportService; readonly imports: WorkspaceImportService } {
  const deps = pgIdentityDeps({
    pool: input.pool,
    outbox: input.outbox,
    audit: input.audit,
    clock: input.clock,
    defaults: input.defaults,
  });
  return portabilityServices(deps, input.portability);
}

export { WorkspaceExportService } from '../application/portability/workspace-export.service.js';
export { WorkspaceImportService } from '../application/portability/workspace-import.service.js';
export type { ExportView } from '../application/portability/workspace-export.service.js';
export type { ImportView } from '../application/portability/workspace-import.service.js';
export type {
  ArchiveInspector,
  EnvelopeCipher,
  ExportArchiveBuilder,
  ExportJob,
  ExportKeyProvider,
  ExportObjectStore,
  ImportJob,
  PortabilityJobPort,
  PortabilitySettings,
  WorkspaceImporter,
} from '../application/portability/ports.js';
export {
  KeyringEnvelopeCipher,
  S3ExportObjectStore,
} from '../infrastructure/portability/s3-store-and-cipher.js';
export { LocalKeyringProvider } from '../infrastructure/portability/key-provider.js';
export { PgExportArchiveBuilder } from '../infrastructure/portability/pg-archive-builder.js';
export {
  PgWorkspaceImporter,
  type ImportHook,
  type ImportHookContext,
} from '../infrastructure/portability/pg-importer.js';
export { archiveInspector } from '../infrastructure/portability/archive-inspector.js';
export {
  buildSectionSchema,
  exportSchemaId,
  renderSchema,
} from '../infrastructure/portability/json-schema.js';
export { loadColumns, type ColumnInfo, type SqlExec } from '../infrastructure/portability/section-sql.js';
export { ZipReader, ZipWriter } from '../infrastructure/portability/zip.js';
export { RecordValidators, inspectArchive } from '../infrastructure/portability/archive-inspector.js';
export { DATA_KEY_BYTES, decryptEnvelope, encryptEnvelope } from '../infrastructure/portability/envelope.js';
