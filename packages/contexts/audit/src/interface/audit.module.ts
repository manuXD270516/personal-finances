import { Module, type DynamicModule } from '@nestjs/common';
import { InMemoryRateLimiter, type RateLimiter } from '@pf/platform/api';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { AuditLogExporter } from '../application/audit-export.js';
import { AuditQueries } from '../application/audit-queries.js';
import { AuditRecorder } from '../application/audit-recorder.js';
import {
  AuthorizationDenialRecorder,
  RateLimiterDenialThrottle,
} from '../application/authorization-denial.js';
import { LIFECYCLE_BACKFILL_JOB, LifecycleBackfill } from '../application/lifecycle-backfill.js';
import { LifecycleExporter } from '../application/lifecycle-export.js';
import { LifecycleQueries } from '../application/lifecycle-queries.js';
import { LifecycleRecorder } from '../application/lifecycle-recorder.js';
import type { DenialObserver, WorkspaceTimeZones } from '../application/ports/index.js';
import {
  AUDIT_HISTORY_QUERY,
  AUDIT_LOG_EXPORT_AUDIT_POLICY,
  AUDIT_PORT,
  AUTHORIZATION_DENIAL_PORT,
  LIFECYCLE_EXPORT_AUDIT_POLICY,
  LIFECYCLE_QUERY,
  type AuditFieldPoliciesDto,
  type AuditHistoryQuery,
  type AuditPort,
  type AuthorizationDenialPort,
  type LifecycleExportLoaders,
  type LifecycleExportSource,
  type LifecycleMachineDto,
  type LifecyclePort,
  type LifecycleQuery,
} from '../contracts/index.js';
import { RedactionPolicy } from '../domain/redaction-policy.js';
import {
  HmacIpHasher,
  PgAuditLogStore,
  PgWorkspaceExistence,
  ensureAuditPartitions,
  pgReadUnitOfWork,
  platformAuditEnvironment,
  uuidV7Ids,
} from '../infrastructure/pg-audit-log.js';
import {
  PgLifecycleBackfillSource,
  PgLifecycleStore,
  findLifecycleDivergences,
  pgWorkerUnitOfWork,
  type LifecycleDivergence,
} from '../infrastructure/pg-lifecycle.js';
import { AUDIT_LOG_EXPORTER, AUDIT_QUERIES, AuditLogController } from './audit-log.controller.js';
import { PdfkitLifecyclePdf } from '../infrastructure/pdfkit-lifecycle-pdf.js';
import { LIFECYCLE_EXPORTER, LifecycleExportController } from './lifecycle-export.controller.js';
import { LifecycleMachinesController } from './lifecycle-machines.controller.js';

export interface AuditRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  /** `AUDIT_IP_HMAC_KEY` (`kid:secreto[,…]`); sin ella (solo local/ci) se usa una clave efímera. */
  readonly ipHmacKeys?: string;
  /** Allow-lists de redacción que aporta cada contexto para sus agregados (lo no listado se omite). */
  readonly policies: readonly AuditFieldPoliciesDto[];
  /** Zona horaria del workspace (la aporta IDENTITY en el composition root). */
  readonly timeZones: WorkspaceTimeZones;
  /**
   * Máquinas de estado declaradas por los contextos dueños (add-lifecycle-timeline; las exporta el módulo de cada
   * contexto: `TRANSACTION_LIFECYCLE_MACHINE`, `ACCOUNT_LIFECYCLE_MACHINE`, `EXCHANGE_RATE_LIFECYCLE_MACHINE`).
   */
  readonly machines?: readonly LifecycleMachineDto[];
  /**
   * Limitador de los fallos de autorización auditados (1 por usuario, workspace y operación por minuto): el del
   * `RATE_LIMIT_STORE` de la API. Sin él (tests, worker) se usa uno en memoria del proceso.
   */
  readonly denialLimiter?: RateLimiter;
  /** Métricas y logs de los fallos de autorización (`authz_denied_total`); sin él, no-op. */
  readonly denialObserver?: DenialObserver;
}

const NOOP_OBSERVER: DenialObserver = { denied: () => undefined, writeFailed: () => undefined };

/** Puertos de AUDIT ya compuestos: `port` lo reciben los módulos que mutan; `history` las vistas de historial. */
export interface AuditRuntime {
  readonly port: AuditPort;
  readonly history: AuditHistoryQuery;
  /** Consultas del log (uso interno del módulo HTTP). */
  readonly queries: AuditQueries;
  /** `LifecyclePort` sobre `port` (add-lifecycle-timeline). */
  readonly lifecycle: LifecyclePort;
  /** `LifecyclePort` sobre otro `AuditPort` (p. ej. el envuelto por los tests de atomicidad). */
  lifecycleFor(port: AuditPort): LifecyclePort;
  /** Consulta `GetLifecycle` y definiciones de máquinas. */
  readonly lifecycleQuery: LifecycleQuery;
  /** Exportación CSV/PDF del recorrido (docs/31 D52) con las cargas de cada contexto dueño. */
  lifecycleExporter(loaders: LifecycleExportLoaders): LifecycleExporter;
  /** Exportación CSV del log de auditoría (openspec add-global-audit-view; solo OWNER). */
  readonly logExporter: AuditLogExporter;
  /** Registrador de fallos de autorización para el guard de IDENTITY (excepción documentada a INV-029). */
  readonly denials: AuthorizationDenialPort;
}

/** Composición de AUDIT sobre PostgreSQL (misma transacción que la `PgUnitOfWork` de cada comando). */
export function createAuditRuntime(options: AuditRuntimeOptions): AuditRuntime {
  const store = new PgAuditLogStore();
  // La exportación del recorrido es un evento auditado propio de AUDIT (docs/31 D52, docs/12 §13.2).
  const policy = [...options.policies, LIFECYCLE_EXPORT_AUDIT_POLICY, AUDIT_LOG_EXPORT_AUDIT_POLICY].reduce(
    (acc, p) => acc.with(p),
    new RedactionPolicy(),
  );
  const port = new AuditRecorder({
    env: platformAuditEnvironment,
    store,
    ipHasher: new HmacIpHasher(options.ipHmacKeys),
    ids: uuidV7Ids,
    clock: options.clock,
    policy,
  });
  const queries = new AuditQueries({
    uow: pgReadUnitOfWork(options.pool),
    store,
    timeZones: options.timeZones,
  });
  const logExporter = new AuditLogExporter({
    uow: pgReadUnitOfWork(options.pool),
    store,
    timeZones: options.timeZones,
    audit: port,
  });
  const denials = new AuthorizationDenialRecorder({
    uow: pgReadUnitOfWork(options.pool),
    audit: port,
    throttle: new RateLimiterDenialThrottle(options.denialLimiter ?? new InMemoryRateLimiter()),
    workspaces: new PgWorkspaceExistence(),
    observer: options.denialObserver ?? NOOP_OBSERVER,
    clock: options.clock,
  });
  const lifecycleStore = new PgLifecycleStore();
  const lifecycleFor = (audit: AuditPort): LifecyclePort =>
    new LifecycleRecorder({
      audit,
      env: platformAuditEnvironment,
      store: lifecycleStore,
      ids: uuidV7Ids,
      clock: options.clock,
    });
  const lifecycleQuery = new LifecycleQueries({
    uow: pgReadUnitOfWork(options.pool),
    store: lifecycleStore,
    machines: options.machines ?? [],
  });
  return {
    port,
    history: queries,
    queries,
    lifecycle: lifecycleFor(port),
    lifecycleFor,
    lifecycleQuery,
    logExporter,
    denials,
    lifecycleExporter: (loaders) =>
      new LifecycleExporter({
        loaders,
        timeZones: options.timeZones,
        uow: pgReadUnitOfWork(options.pool),
        audit: port,
        clock: options.clock,
        pdf: new PdfkitLifecyclePdf(),
      }),
  };
}

/**
 * Job `audit.lifecycle-backfill` del worker (add-lifecycle-timeline decisión 8): `pool` es el del worker (`pf_worker`).
 * Idempotente y reanudable; devuelve agregados procesados y pasos derivados.
 */
export function createLifecycleBackfill(pool: Pool): LifecycleBackfill {
  return new LifecycleBackfill({
    uow: pgWorkerUnitOfWork(pool),
    source: new PgLifecycleBackfillSource(),
    store: new PgLifecycleStore(),
    ids: uuidV7Ids,
  });
}

export interface AuditModuleOptions {
  readonly runtime: AuditRuntime;
  /** Convenciones de API (contrato, cursores, reloj) del composition root. */
  readonly conventions: ApiConventionsOptions;
  /**
   * Cargas del recorrido por tipo de agregado para la exportación CSV/PDF (docs/31 D52); sin ellas, la descarga de
   * ese tipo responde 404.
   */
  readonly lifecycleExport?: LifecycleExportLoaders;
}

/**
 * Módulo HTTP de AUDIT (`GET /api/v1/workspaces/{id}/audit-log`). La autenticación y el rol (`x-required-role`)
 * los aplica el guard global de IDENTITY; Problem Details, validación de contrato y límite de tasa, las convenciones
 * globales de `@pf/platform/nest`. Exporta `AUDIT_PORT` y `AUDIT_HISTORY_QUERY` para otros módulos.
 */
@Module({})
export class AuditModule {
  static register(options: AuditModuleOptions): DynamicModule {
    return {
      module: AuditModule,
      controllers: [AuditLogController, LifecycleMachinesController, LifecycleExportController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: AUDIT_QUERIES, useValue: options.runtime.queries },
        { provide: AUDIT_LOG_EXPORTER, useValue: options.runtime.logExporter },
        { provide: AUDIT_PORT, useValue: options.runtime.port },
        { provide: AUDIT_HISTORY_QUERY, useValue: options.runtime.history },
        { provide: LIFECYCLE_QUERY, useValue: options.runtime.lifecycleQuery },
        {
          provide: LIFECYCLE_EXPORTER,
          useValue: options.runtime.lifecycleExporter(options.lifecycleExport ?? {}),
        },
      ],
      exports: [AUDIT_PORT, AUDIT_HISTORY_QUERY, LIFECYCLE_QUERY],
    };
  }
}

export {
  AUDIT_HISTORY_QUERY,
  AUDIT_PORT,
  AUTHORIZATION_DENIAL_PORT,
  LIFECYCLE_BACKFILL_JOB,
  LIFECYCLE_QUERY,
  ensureAuditPartitions,
  findLifecycleDivergences,
};
export type {
  AuditFieldPoliciesDto,
  AuditHistoryQuery,
  AuditPort,
  AuthorizationDenialPort,
  DenialObserver,
  LifecycleBackfill,
  LifecycleDivergence,
  LifecycleExportLoaders,
  LifecycleExportSource,
  LifecycleMachineDto,
  LifecyclePort,
  LifecycleQuery,
  WorkspaceTimeZones,
};
