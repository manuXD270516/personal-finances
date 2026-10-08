import type { AccountCatalogQuery } from '@pf/accounts/contracts';
import type { AuditHistoryQuery, AuditPort, LifecyclePort } from '@pf/audit/contracts';
import type { CategoryCatalogQuery } from '@pf/classification/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import type {
  AccountBalancesQuery,
  LedgerActivityRangeQuery,
  LedgerPeriodLockPort,
  LedgerPostingPort,
} from '@pf/ledger/contracts';
import type { NetWorthQuery, PeriodFlowsQuery } from '@pf/reporting/contracts';
import type { Clock } from '@pf/shared-kernel';
import type {
  NominalFlowQuery,
  ReconciliationStatusQuery,
  TransactionsClosingQuery,
} from '@pf/transactions/contracts';
import type { BudgetVsActualQuery, PeriodCreatedHook, PlanningEditGuard } from '../../contracts/index.js';
import type {
  Budget,
  ClosingPolicy,
  CloseSnapshotContent,
  BudgetLine,
  BudgetTemplate,
  FinancialPeriod,
  FinancialPeriodStatus,
  TargetKind,
  TemplateStatus,
  TemplateVersion,
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
  /** Planes cuya versión de origen pertenece al template (con sus líneas); base de la propagación. */
  listByTemplate(workspaceId: string, templateId: string): Promise<Budget[]>;
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

/** Datos de la versión de origen de un plan (`templateVersion` de la API). */
export interface TemplateVersionRef {
  readonly versionId: string;
  readonly templateId: string;
  readonly versionNo: number;
  readonly templateName: string;
}

/** Encabezado de una versión (sin sus líneas) para el historial de versiones. */
export interface TemplateVersionHeader {
  readonly versionNo: number;
  readonly basedOnVersionNo: number | null;
  readonly changeNote: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
  readonly lineCount: number;
}

/** Templates, versiones y líneas (add-budget-templates; versiones y líneas son WS-RO en la BD). */
export interface BudgetTemplateRepository {
  /** Candado consultivo por workspace que serializa "marcar como predeterminado" (`pg_advisory_xact_lock`). */
  lockDefaults(workspaceId: string): Promise<void>;
  /** Inserta el template, su versión 1 y sus líneas (23505 en el nombre => `NAME_TAKEN`). */
  insert(template: BudgetTemplate): Promise<void>;
  /** Inserta la versión vigente (recién publicada) y sus líneas. */
  insertCurrentVersion(template: BudgetTemplate): Promise<void>;
  /** Control optimista por `persistedVersion`; actualiza nombre, estado, predeterminado y versión vigente. */
  save(template: BudgetTemplate): Promise<boolean>;
  /** Template con su versión vigente; `lock: 'update'` = `SELECT … FOR UPDATE`. */
  findById(
    workspaceId: string,
    id: string,
    options?: { readonly lock?: 'update' },
  ): Promise<BudgetTemplate | null>;
  /** Template ACTIVO con ese nombre (sin distinguir mayúsculas). */
  findActiveByName(workspaceId: string, name: string): Promise<BudgetTemplate | null>;
  /** Template ACTIVO marcado como predeterminado. */
  findDefault(workspaceId: string): Promise<BudgetTemplate | null>;
  list(workspaceId: string, status?: TemplateStatus): Promise<BudgetTemplate[]>;
  listVersions(workspaceId: string, templateId: string): Promise<TemplateVersionHeader[]>;
  findVersion(workspaceId: string, templateId: string, versionNo: number): Promise<TemplateVersion | null>;
  versionRef(workspaceId: string, versionId: string): Promise<TemplateVersionRef | null>;
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
  readonly templates: BudgetTemplateRepository;
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

// ───────────────────────────────────────────── add-month-closing

export interface ClosingPolicyRepository {
  /** `null` si el workspace nunca guardó una política (valores por defecto). */
  find(workspaceId: string): Promise<ClosingPolicy | null>;
  /** INSERT si `persistedVersion` es 0, UPDATE condicional por versión si no; `false` si la versión cambió. */
  save(policy: ClosingPolicy): Promise<boolean>;
}

/** Cabecera de un snapshot de cierre (inmutable). */
export interface SnapshotHeader {
  readonly id: string;
  readonly workspaceId: string;
  readonly periodId: string;
  readonly closeNo: number;
  readonly closedAt: string;
  readonly closedBy: string | null;
  readonly previousSnapshotId: string | null;
}

export interface StoredSnapshot extends SnapshotHeader {
  readonly contentSha256: string;
  readonly content: CloseSnapshotContent;
}

/** Repositorio append-only de snapshots (sin update ni delete; `forbid_mutation` en BD, PF003). */
export interface CloseSnapshotRepository {
  /** Inserta cabecera, saldos y transacciones conciliadas sin extracto; calcula `content_sha256` del contenido. */
  insert(snapshot: SnapshotHeader & { readonly content: CloseSnapshotContent }): Promise<string>;
  /** Versiones del periodo por `close_no` ascendente. */
  list(workspaceId: string, periodId: string): Promise<readonly SnapshotHeader[]>;
  find(workspaceId: string, periodId: string, closeNo: number): Promise<StoredSnapshot | null>;
  /** Vigente (mayor `close_no`) de cada periodo dado. */
  listCurrent(workspaceId: string, periodIds: readonly string[]): Promise<readonly StoredSnapshot[]>;
  /** Vigentes de todos los periodos con snapshot (verificador). */
  listAllCurrent(workspaceId: string): Promise<readonly StoredSnapshot[]>;
}

export interface PeriodReopeningRow {
  readonly id: string;
  readonly workspaceId: string;
  readonly periodId: string;
  readonly reopenNo: number;
  readonly reason: string;
  readonly reopenedBy: string | null;
  readonly reopenedAt: string;
  readonly closedSnapshotId: string;
}

export interface PeriodReopeningRepository {
  insert(row: PeriodReopeningRow): Promise<void>;
}

export interface ClosePendingNoticeRepository {
  /** `INSERT … ON CONFLICT DO NOTHING`; `true` solo si insertó (una vez por periodo en toda su vida). */
  insertIfAbsent(input: { workspaceId: string; periodId: string; eventId: string }): Promise<boolean>;
}

export interface ClosingMetricsPort {
  increment(name: string, labels: Readonly<Record<string, string>>, value?: number): void;
}

/** Dependencias de cierre, reapertura, política, consultas del snapshot y verificador (add-month-closing). */
export interface ClosingDeps {
  readonly uow: UnitOfWork;
  readonly periods: FinancialPeriodRepository;
  readonly policies: ClosingPolicyRepository;
  readonly snapshots: CloseSnapshotRepository;
  readonly reopenings: PeriodReopeningRepository;
  readonly notices: ClosePendingNoticeRepository;
  readonly calendar: WorkspaceCalendarQuery;
  readonly settings: WorkspaceSettingsPort;
  /** Bloqueo del rango en el ledger (misma transacción, candado consultivo exclusivo). */
  readonly lock: LedgerPeriodLockPort;
  readonly ledger: Pick<LedgerPostingPort, 'assertPeriodOpen'>;
  readonly accounts: AccountCatalogQuery;
  readonly balances: AccountBalancesQuery;
  readonly closing: TransactionsClosingQuery;
  readonly reconciliation: ReconciliationStatusQuery;
  readonly flows: PeriodFlowsQuery;
  readonly netWorth: NetWorthQuery;
  /** Presupuesto vs real (add-budgets); ausente si los presupuestos no están compuestos. */
  readonly budgets?: BudgetVsActualQuery;
  readonly catalog?: Pick<CategoryCatalogQuery, 'categoryTree'>;
  readonly audit: AuditPort;
  readonly lifecycle: LifecyclePort;
  readonly outbox: OutboxPort;
  readonly actor: ActorPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** `PLANNING_CLOSE_PENDING_DELAY_DAYS` (default 3). */
  readonly closePendingDelayDays: number;
  readonly metrics?: ClosingMetricsPort;
}
