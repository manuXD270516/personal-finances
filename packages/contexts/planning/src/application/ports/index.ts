import type { AuditHistoryQuery, AuditPort, LifecyclePort } from '@pf/audit/contracts';
import type { CategoryCatalogQuery } from '@pf/classification/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import type { LedgerActivityRangeQuery } from '@pf/ledger/contracts';
import type { Clock } from '@pf/shared-kernel';
import type { NominalFlowQuery } from '@pf/transactions/contracts';
import type { PeriodCreatedHook, PlanningEditGuard } from '../../contracts/index.js';
import type {
  Budget,
  BudgetLine,
  FinancialPeriod,
  FinancialPeriodStatus,
  TargetKind,
} from '../../domain/index.js';

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

// ───────────────────────────────────────────── add-budgets

/** Cruce de umbral registrado (`planning.budget_threshold_crossing`, append-only). */
export interface ThresholdCrossingRow {
  readonly workspaceId: string;
  readonly periodId: string;
  readonly targetKind: TargetKind;
  readonly targetId: string;
  /** Umbral canónico ("90", "75.5"). */
  readonly threshold: string;
  readonly budgetId: string;
  readonly budgetLineId: string;
  readonly reference: string;
  readonly actual: string;
  readonly currency: string;
  readonly crossedAt: string;
  readonly eventId: string;
}

export interface CrossingKey {
  readonly targetKind: TargetKind;
  readonly targetId: string;
  readonly threshold: string;
}

export interface BudgetRepository {
  /** `lock: 'update'` = `SELECT … FOR UPDATE` del plan (serializa comandos y evaluaciones de umbrales). */
  findById(workspaceId: string, id: string, options?: { readonly lock?: 'update' }): Promise<Budget | null>;
  findByPeriod(
    workspaceId: string,
    periodId: string,
    options?: { readonly lock?: 'update' },
  ): Promise<Budget | null>;
  /** Planes de los periodos dados (con sus líneas). */
  listByPeriods(workspaceId: string, periodIds: readonly string[]): Promise<Budget[]>;
  /** `INSERT … ON CONFLICT (workspace_id, period_id) DO NOTHING`; `false` si el periodo ya tenía plan. */
  insertIfAbsent(budget: Budget): Promise<boolean>;
  /** Control optimista por `persistedVersion`; actualiza el encabezado (versión, modo base cero). */
  save(budget: Budget): Promise<boolean>;
  insertLine(line: BudgetLine): Promise<void>;
  /** Control optimista por la versión persistida de la línea. */
  updateLine(line: BudgetLine): Promise<boolean>;
  deleteLine(workspaceId: string, lineId: string): Promise<void>;
}

export interface ThresholdCrossingRepository {
  /** Cruces registrados de un periodo. */
  list(workspaceId: string, periodId: string): Promise<readonly CrossingKey[]>;
  /**
   * `INSERT … ON CONFLICT DO NOTHING RETURNING threshold`: devuelve los umbrales efectivamente insertados (los que ya
   * existían, por reentrega o evaluación concurrente, no se repiten).
   */
  insertIfAbsent(rows: readonly ThresholdCrossingRow[]): Promise<readonly string[]>;
}

/** Moneda base y zona horaria del workspace (IDENTITY, composición de la API; no disponible en el worker). */
export interface WorkspaceSettingsPort {
  settingsOf(workspaceId: string): Promise<{ readonly baseCurrency: string; readonly timeZone: string }>;
}

/** Usuario de la petición en curso (`''` en procesos del worker): argumento de las consultas de CLASSIFICATION. */
export interface ActorPort {
  userId(): string;
}

/** Dependencias de los casos de uso de presupuestos (openspec add-budgets § Decisiones). */
export interface BudgetsDeps {
  readonly uow: UnitOfWork;
  readonly periods: FinancialPeriodRepository;
  readonly budgets: BudgetRepository;
  readonly crossings: ThresholdCrossingRepository;
  readonly calendar: WorkspaceCalendarQuery;
  /** Solo la API (crear planes); el worker evalúa con la moneda del propio plan. */
  readonly settings?: WorkspaceSettingsPort;
  readonly flows: NominalFlowQuery;
  readonly catalog: Pick<CategoryCatalogQuery, 'categoryTree'>;
  readonly rates: FxValuationPort;
  readonly guard: PlanningEditGuard;
  readonly outbox: OutboxPort;
  readonly audit: AuditPort;
  readonly history?: AuditHistoryQuery;
  readonly actor: ActorPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** `REPORTING_RATE_VALIDITY_WINDOW` en días (docs/31 D53); la misma ventana que el resumen del Home. */
  readonly rateValidityWindowDays: number;
}
