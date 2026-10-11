import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { RecurringDefinitionPort } from '@pf/commitments/contracts';
import type { ValuationRateDto } from '@pf/fx/contracts';
import type { Clock, Money } from '@pf/shared-kernel';
import type { GoalTransferPort, TransactionLinkDto, TransactionLinkQuery } from '@pf/transactions/contracts';
import type {
  GoalFund,
  GoalMovement,
  GoalState,
  GoalStatus,
  ReservationEpisodeState,
  SavingsGoal,
} from '../../domain/index.js';

/**
 * Puertos de GOALS (hexagonal). Los repositorios los implementa `infrastructure/` sobre PostgreSQL; los de otros
 * contextos son contratos públicos o adaptadores de la composición de `apps/api`.
 */

/** Transacción PG con `SET LOCAL app.workspace_id` (RLS, ADR-0023); reutiliza la del llamador si existe. */
export interface UnitOfWork {
  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}

export interface IdGenerator {
  /** UUIDv7. */
  next(): string;
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

/** Zona horaria y día de inicio del mes financiero del workspace (IDENTITY; adapter en la composición). */
export interface CalendarPort {
  calendarOf(workspaceId: string): Promise<{ readonly timeZone: string; readonly startDay: number }>;
}

/** Escala de la moneda (`fx.currency`) y monedas habilitadas del workspace. */
export interface CurrencyCatalogPort {
  scaleOf(code: string): Promise<number | null>;
  /** `true` si la moneda está habilitada en el workspace (`fx.workspace_currency`). */
  isEnabled(workspaceId: string, code: string): Promise<boolean>;
}

export interface AccountInfo {
  readonly accountId: string;
  readonly name: string;
  readonly nature: 'ASSET' | 'LIABILITY';
  readonly currency: string;
  readonly status: 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
}

export interface AccountsPort {
  /** Cuentas por id, archivadas incluidas (las inexistentes no figuran). */
  find(workspaceId: string, accountIds: readonly string[]): Promise<readonly AccountInfo[]>;
}

export interface BalancePort {
  /** Saldo contable PRESENTADO de las cuentas (hoy): `POSTED`, `CLEARED` y `RECONCILED`; las pendientes no cuentan. */
  presentedBalances(workspaceId: string, accountIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/** Valoración de FX (stock con la tasa vigente; flujos con la tasa de su fecha) con la ventana de REPORTING. */
export interface ValuationPort {
  resolve(input: {
    readonly workspaceId: string;
    readonly requests: readonly { readonly base: string; readonly quote: string; readonly at: string }[];
    readonly windowDays: number;
  }): Promise<readonly (ValuationRateDto | null)[]>;
}

// ───────────────────────────────────────────── repositorios

export interface GoalFilter {
  readonly statuses?: readonly GoalStatus[];
  readonly type?: string;
  readonly includeArchived?: boolean;
}

export interface GoalRepository {
  findById(workspaceId: string, id: string, options?: { lock?: 'update' }): Promise<SavingsGoal | null>;
  /** Bloquea varias metas en orden de id (evita interbloqueos). */
  lockMany(workspaceId: string, ids: readonly string[]): Promise<readonly SavingsGoal[]>;
  insert(goal: SavingsGoal): Promise<void>;
  /** Control optimista por versión; `false` si otro cambio ganó. Persiste también las cuentas vinculadas. */
  save(goal: SavingsGoal): Promise<boolean>;
  list(workspaceId: string, filter: GoalFilter): Promise<readonly SavingsGoal[]>;
  /** ¿Existe otra meta no archivada con ese nombre (sin distinguir mayúsculas)? */
  nameTaken(workspaceId: string, name: string, exceptId?: string): Promise<boolean>;
  /** Metas `ACTIVE` o `PAUSED` a las que está vinculada alguna de las cuentas. */
  linkedToAccounts(
    workspaceId: string,
    accountIds: readonly string[],
  ): Promise<readonly { goalId: string; accountId: string; status: GoalStatus }[]>;
  /** Metas con fondos en monedas distintas a la de su objetivo (reevaluación diaria). */
  withForeignFunds(workspaceId: string): Promise<readonly string[]>;
}

export interface MovementRow extends GoalMovement {
  readonly recordedAt: string;
  readonly recordedBy: string;
}

export interface MovementFilter {
  readonly from?: string;
  readonly to?: string;
  readonly cursor?: { readonly occurredOn: string; readonly recordedAt: string; readonly id: string };
  readonly limit?: number;
}

export interface FundRow {
  readonly goalId: string;
  readonly goalName: string;
  readonly goalStatus: GoalStatus;
  readonly accountId: string;
  readonly fund: GoalFund;
  readonly currency: string;
  readonly amount: string;
}

export interface FlowRow {
  readonly goalId: string;
  readonly date: string;
  readonly currency: string;
  readonly amount: string;
}

export interface MovementRepository {
  /** Inserta; las claves únicas parciales de aporte/retiro por transacción devuelven `false` (ya vinculada). */
  insert(workspaceId: string, movement: MovementRow): Promise<boolean>;
  find(workspaceId: string, id: string): Promise<MovementRow | null>;
  /** Todos los movimientos de la meta, en orden de registro. */
  listAll(workspaceId: string, goalId: string): Promise<readonly MovementRow[]>;
  list(workspaceId: string, goalId: string, filter: MovementFilter): Promise<readonly MovementRow[]>;
  hasAny(workspaceId: string, goalId: string): Promise<boolean>;
  /** Σ por (meta, moneda) de todos los movimientos. */
  sums(
    workspaceId: string,
    goalIds: readonly string[],
  ): Promise<readonly { goalId: string; currency: string; amount: string }[]>;
  /** Fondos por (meta, cuenta, fondo) de metas en los estados dados (sin filtro de estado si se omite). */
  funds(
    workspaceId: string,
    filter: {
      readonly goalIds?: readonly string[];
      readonly accountIds?: readonly string[];
      readonly statuses?: readonly GoalStatus[];
    },
  ): Promise<readonly FundRow[]>;
  /** Todos los movimientos que respaldan o invierten la transacción (incluye los inversos), orden de registro. */
  byTransactions(workspaceId: string, transactionIds: readonly string[]): Promise<readonly MovementRow[]>;
  /** Movimientos de aporte o retiro reales de la transacción no invertidos aún. */
  liveByTransaction(workspaceId: string, transactionId: string): Promise<readonly MovementRow[]>;
  /** Ids de movimientos que el movimiento `reversesId` ya invirtió (idempotencia de negocio). */
  isReversed(workspaceId: string, movementId: string): Promise<boolean>;
  /** Σ por (fecha de negocio, moneda) de los movimientos de las metas en el rango (reasignaciones excluidas a petición). */
  flows(
    workspaceId: string,
    filter: {
      readonly goalIds?: readonly string[];
      readonly from: string;
      readonly to: string;
      readonly includeReassignments: boolean;
    },
  ): Promise<readonly FlowRow[]>;
  /** Cuentas con algún movimiento de metas (barrido diario). */
  accountsWithMovements(workspaceId: string): Promise<readonly string[]>;
  /** Σ de retiros reales vigentes de una transacción (todas las metas), para el tope de retiros parciales. */
  withdrawnFromTransaction(workspaceId: string, transactionId: string): Promise<string>;
}

export interface PlanRecord {
  readonly goalId: string;
  readonly monthlyAmount: string;
  readonly currency: string;
  readonly fund: GoalFund;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string | null;
  readonly dayOfMonth: number | null;
  readonly automation: 'NONE' | 'RECURRING';
  readonly materializationMode: 'PENDING_APPROVAL' | 'AUTO_CREATE' | null;
  readonly autoCreateStatus: 'PENDING' | 'POSTED' | null;
  readonly definitionId: string | null;
  readonly version: number;
}

export interface PlanRepository {
  get(workspaceId: string, goalId: string): Promise<PlanRecord | null>;
  getMany(workspaceId: string, goalIds: readonly string[]): Promise<readonly PlanRecord[]>;
  upsert(workspaceId: string, plan: PlanRecord): Promise<void>;
  remove(workspaceId: string, goalId: string): Promise<void>;
  /** Plan cuya definición recurrente administrada es `definitionId`. */
  findByDefinition(workspaceId: string, definitionId: string): Promise<PlanRecord | null>;
}

export interface ReservationStateRecord extends ReservationEpisodeState {
  readonly accountId: string;
  readonly version: number;
}

export interface ReservationStateRepository {
  /** Get-or-create con `SELECT … FOR UPDATE` de la fila `(workspace, cuenta)`: serializa reservas y vigilancia. */
  lock(workspaceId: string, accountId: string): Promise<ReservationStateRecord>;
  save(workspaceId: string, state: ReservationStateRecord, evaluatedAt: string): Promise<void>;
  /** Cuentas actualmente `OVER_ALLOCATED`. */
  overAllocated(workspaceId: string): Promise<readonly ReservationStateRecord[]>;
  /** Estado por cuenta (sin bloqueo). */
  states(workspaceId: string, accountIds?: readonly string[]): Promise<readonly ReservationStateRecord[]>;
}

export interface MaterializationRecord {
  readonly transactionId: string;
  readonly goalId: string;
  readonly definitionId: string;
  readonly occurrenceId: string;
  readonly status: 'WAITING' | 'RECORDED' | 'RELEASED';
}

export interface MaterializationRepository {
  find(workspaceId: string, transactionId: string): Promise<MaterializationRecord | null>;
  upsert(workspaceId: string, record: MaterializationRecord, at: string): Promise<void>;
  setStatus(
    workspaceId: string,
    transactionId: string,
    status: MaterializationRecord['status'],
    at: string,
  ): Promise<void>;
  waitingForGoal(workspaceId: string, goalId: string): Promise<number>;
}

export type SuggestionStatus = 'PENDING' | 'CONFIRMED' | 'DISMISSED' | 'EXPIRED';

export interface SuggestionRecord {
  readonly id: string;
  readonly transactionId: string;
  readonly transactionRevision: number;
  readonly accountId: string;
  readonly amount: Money;
  readonly goalId: string | null;
  readonly status: SuggestionStatus;
  readonly businessDate: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
  readonly movementId: string | null;
  readonly createdAt: string;
}

export interface SuggestionRepository {
  /** Inserta si no existe `(transacción, revisión)`; `false` si ya existía (descartada o no). */
  insertIfAbsent(workspaceId: string, suggestion: SuggestionRecord): Promise<boolean>;
  find(workspaceId: string, id: string, options?: { lock?: 'update' }): Promise<SuggestionRecord | null>;
  list(workspaceId: string, status?: SuggestionStatus): Promise<readonly SuggestionRecord[]>;
  pendingCount(workspaceId: string): Promise<number>;
  decide(
    workspaceId: string,
    id: string,
    input: { status: 'CONFIRMED' | 'DISMISSED'; at: string; by: string; movementId: string | null },
  ): Promise<void>;
  /** Expira las pendientes de la transacción (anulación o revisión). */
  expireForTransaction(workspaceId: string, transactionId: string): Promise<number>;
}

export interface GoalsSettings {
  /** Ventana de vigencia (días) de las tasas de valoración (`REPORTING_RATE_VALIDITY_WINDOW`). */
  readonly rateValidityWindowDays: number;
  /** Horizonte de movimientos por página. */
  readonly pageSize: number;
}

export interface GoalsDeps {
  readonly uow: UnitOfWork;
  readonly goals: GoalRepository;
  readonly movements: MovementRepository;
  readonly plans: PlanRepository;
  readonly reservations: ReservationStateRepository;
  readonly materializations: MaterializationRepository;
  readonly suggestions: SuggestionRepository;
  readonly accounts: AccountsPort;
  readonly balances: BalancePort;
  readonly currencies: CurrencyCatalogPort;
  readonly calendar: CalendarPort;
  readonly valuation: ValuationPort;
  readonly transfers: GoalTransferPort;
  readonly links: TransactionLinkQuery;
  readonly recurring: RecurringDefinitionPort;
  readonly audit: AuditPort;
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery?: LifecycleQuery;
  readonly outbox: OutboxPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly settings: GoalsSettings;
}

export type { GoalState, TransactionLinkDto };
