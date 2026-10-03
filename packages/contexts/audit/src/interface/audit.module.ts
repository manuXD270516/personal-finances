import { Module, type DynamicModule } from '@nestjs/common';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { AuditQueries } from '../application/audit-queries.js';
import { AuditRecorder } from '../application/audit-recorder.js';
import type { WorkspaceTimeZones } from '../application/ports/index.js';
import {
  AUDIT_HISTORY_QUERY,
  AUDIT_PORT,
  type AuditFieldPoliciesDto,
  type AuditHistoryQuery,
  type AuditPort,
} from '../contracts/index.js';
import { RedactionPolicy } from '../domain/redaction-policy.js';
import {
  HmacIpHasher,
  PgAuditLogStore,
  ensureAuditPartitions,
  pgReadUnitOfWork,
  platformAuditEnvironment,
  uuidV7Ids,
} from '../infrastructure/pg-audit-log.js';
import { AUDIT_QUERIES, AuditLogController } from './audit-log.controller.js';

export interface AuditRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  /** `AUDIT_IP_HMAC_KEY` (`kid:secreto[,…]`); sin ella (solo local/ci) se usa una clave efímera. */
  readonly ipHmacKeys?: string;
  /** Allow-lists de redacción que aporta cada contexto para sus agregados (lo no listado se omite). */
  readonly policies: readonly AuditFieldPoliciesDto[];
  /** Zona horaria del workspace (la aporta IDENTITY en el composition root). */
  readonly timeZones: WorkspaceTimeZones;
}

/** Puertos de AUDIT ya compuestos: `port` lo reciben los módulos que mutan; `history` las vistas de historial. */
export interface AuditRuntime {
  readonly port: AuditPort;
  readonly history: AuditHistoryQuery;
  /** Consultas del log (uso interno del módulo HTTP). */
  readonly queries: AuditQueries;
}

/** Composición de AUDIT sobre PostgreSQL (misma transacción que la `PgUnitOfWork` de cada comando). */
export function createAuditRuntime(options: AuditRuntimeOptions): AuditRuntime {
  const store = new PgAuditLogStore();
  const policy = options.policies.reduce((acc, p) => acc.with(p), new RedactionPolicy());
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
  return { port, history: queries, queries };
}

export interface AuditModuleOptions {
  readonly runtime: AuditRuntime;
  /** Convenciones de API (contrato, cursores, reloj) del composition root. */
  readonly conventions: ApiConventionsOptions;
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
      controllers: [AuditLogController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: AUDIT_QUERIES, useValue: options.runtime.queries },
        { provide: AUDIT_PORT, useValue: options.runtime.port },
        { provide: AUDIT_HISTORY_QUERY, useValue: options.runtime.history },
      ],
      exports: [AUDIT_PORT, AUDIT_HISTORY_QUERY],
    };
  }
}

export { AUDIT_HISTORY_QUERY, AUDIT_PORT, ensureAuditPartitions };
export type { AuditFieldPoliciesDto, AuditHistoryQuery, AuditPort, WorkspaceTimeZones };
