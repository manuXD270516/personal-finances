import type { AuditPort, LifecyclePort } from '@pf/audit/contracts';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import type { LedgerActivityRangeQuery } from '@pf/ledger/contracts';
import type { Clock } from '@pf/shared-kernel';
import type { PeriodCreatedHook } from '../../contracts/index.js';
import type { FinancialPeriod, FinancialPeriodStatus } from '../../domain/index.js';

/**
 * Transacción PG con `SET LOCAL app.workspace_id` (RLS, ADR-0023); reutiliza la del llamador si existe (consumidores
 * del worker, `PlanningEditGuard` dentro del caso de uso de pf-p2b).
 */
export interface UnitOfWork {
  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}

export interface FinancialPeriodRepository {
  /**
   * Candado consultivo por workspace (`pg_advisory_xact_lock`, decisión 5): serializa job, comando y consumidores de
   * periodos del mismo workspace dentro de la transacción.
   */
  lockWorkspace(workspaceId: string): Promise<void>;
  /** Periodos del workspace ordenados por inicio ascendente (opcionalmente filtrados por estado). */
  list(workspaceId: string, statuses?: readonly FinancialPeriodStatus[]): Promise<FinancialPeriod[]>;
  /** `lock`: `update` = `FOR UPDATE` (comandos), `share` = `FOR SHARE` (guard de planificación). */
  findById(
    workspaceId: string,
    id: string,
    options?: { readonly lock?: 'update' | 'share' },
  ): Promise<FinancialPeriod | null>;
  /** Periodo cuyo rango contiene la fecha de negocio `date`. */
  findContaining(workspaceId: string, date: string): Promise<FinancialPeriod | null>;
  /** Primer inicio y último fin cubiertos (consulta barata para el consumidor de asientos). */
  coveredRange(workspaceId: string): Promise<{ readonly start: string; readonly end: string } | null>;
  /** `INSERT … ON CONFLICT (workspace_id, label) DO NOTHING`; `false` si ya existía (no se notifica ni audita). */
  insertIfAbsent(period: FinancialPeriod): Promise<boolean>;
  /** Optimistic locking por `persistedVersion`; `false` si la versión cambió. */
  update(period: FinancialPeriod): Promise<boolean>;
}

export interface OutboxPort {
  append(event: {
    readonly eventId: string;
    readonly eventType: string;
    readonly eventVersion: number;
    readonly occurredAt: string;
    readonly workspaceId: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly aggregateVersion: number;
    readonly payload: object;
  }): Promise<void>;
}

export interface IdGenerator {
  /** UUIDv7. */
  next(): string;
}

export interface PlanningDeps {
  readonly uow: UnitOfWork;
  readonly periods: FinancialPeriodRepository;
  /** Zona horaria y día de inicio del workspace (IDENTITY). */
  readonly calendar: WorkspaceCalendarQuery;
  /** Rango de fechas con asientos (LEDGER), en la unidad de trabajo en curso. */
  readonly activity: LedgerActivityRangeQuery;
  readonly outbox: OutboxPort;
  readonly audit: AuditPort;
  /** Auditoría + registro de transición/anotación en la misma unidad de trabajo (add-lifecycle-timeline). */
  readonly lifecycle: LifecyclePort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** Participantes de la creación de periodos (decisión 15); vacío por defecto. */
  readonly onPeriodCreated?: readonly PeriodCreatedHook[];
  /** Periodos futuros en DRAFT que deben existir (`PLANNING_PERIOD_LOOKAHEAD`, docs/33 D63; mínimo 1). */
  readonly lookahead: number;
}
