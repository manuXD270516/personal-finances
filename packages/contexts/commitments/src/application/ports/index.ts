import type { AccountsQueryPort, AccountCatalogQuery } from '@pf/accounts/contracts';
import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { ClassificationValidator } from '@pf/classification/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import type { Clock } from '@pf/shared-kernel';
import type {
  PendingFlowQuery,
  RecurringTransactionPort,
  TransactionLinkQuery,
} from '@pf/transactions/contracts';
import type {
  ExistingOccurrence,
  OccurrenceState,
  RecurringDefinition,
  RecurringOccurrence,
  DefinitionStatus,
  OccurrenceStatus,
  RecurringKind,
} from '../../domain/index.js';
import type { MatchSuggestionRepository } from './matching.js';

export * from './matching.js';

/**
 * Transacción PG con `SET LOCAL app.workspace_id` (RLS, ADR-0023); reutiliza la del llamador si existe (consumidores
 * del worker, `RecurringTransactionPort` de TRANSACTIONS en la misma unidad de trabajo).
 */
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

/** Periodo financiero que necesita COMMITMENTS (puerto propio; el adapter vive en la composición de `apps/api`). */
export interface FinancialPeriodView {
  readonly id: string;
  readonly label: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: string;
}

export interface FinancialPeriodPort {
  getPeriod(input: {
    readonly workspaceId: string;
    readonly periodId: string;
  }): Promise<FinancialPeriodView | null>;
  getPeriodContaining(input: {
    readonly workspaceId: string;
    readonly date: string;
  }): Promise<FinancialPeriodView | null>;
}

/** Moneda base y zona horaria del workspace (IDENTITY). */
export interface WorkspaceSettingsPort {
  settingsOf(workspaceId: string): Promise<{ readonly baseCurrency: string; readonly timeZone: string }>;
}

/** Fila de lista de definiciones con su versión vigente resumida. */
export interface DefinitionListRow {
  readonly definition: RecurringDefinition;
  readonly nextOccurrence: { readonly occurrenceDate: string; readonly dueDate: string } | null;
  readonly pendingApprovalCount: number;
}

export interface DefinitionFilter {
  readonly status?: DefinitionStatus | undefined;
  readonly kind?: RecurringKind | undefined;
  readonly q?: string | undefined;
}

export interface DefinitionRepository {
  insert(definition: RecurringDefinition): Promise<void>;
  /** `lock: 'update'` = `SELECT … FOR UPDATE` (serializa generación, revisiones y pausas de la definición). */
  findById(
    workspaceId: string,
    id: string,
    options?: { readonly lock?: 'update' },
  ): Promise<RecurringDefinition | null>;
  /** Control optimista por `persistedVersion`; inserta las versiones nuevas (inmutables). `false` si cambió. */
  save(definition: RecurringDefinition): Promise<boolean>;
  list(workspaceId: string, filter: DefinitionFilter): Promise<DefinitionListRow[]>;
  /** Definiciones con trabajo pendiente para el job: activas o con ocurrencias por vencer/atrasar. */
  idsNeedingWork(workspaceId: string): Promise<string[]>;
  hasActive(workspaceId: string): Promise<boolean>;
  /** Definiciones `ACTIVE` del usuario (`managedBy = USER`) de tipo `TRANSFER` cuyo destino vigente es la cuenta. */
  listActiveTransfersTo(
    workspaceId: string,
    accountId: string,
  ): Promise<readonly { readonly definitionId: string; readonly name: string }[]>;
}

/** Ocurrencia con los datos de su definición y versión (lecturas con join). */
export interface OccurrenceView {
  readonly occurrence: OccurrenceState;
  readonly definitionName: string;
  readonly kind: RecurringKind;
  readonly managedBy: 'USER' | 'SUBSCRIPTION' | 'DEBT';
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly mode: 'AUTO_CREATE' | 'PENDING_APPROVAL' | 'NOTIFY_ONLY';
  readonly leadDays: number;
}

export interface OccurrenceFilter {
  readonly definitionId?: string | undefined;
  readonly statuses?: readonly OccurrenceStatus[] | undefined;
  /** Vencimiento desde / hasta (inclusivo). */
  readonly dueFrom?: string | undefined;
  readonly dueTo?: string | undefined;
  /** Solo la bandeja "por aprobar": `DUE`/`OVERDUE` de definiciones en `PENDING_APPROVAL`. */
  readonly requiresApproval?: boolean | undefined;
  readonly limit?: number | undefined;
  /** Posición del cursor (keyset): `[dueDate, id]` del último elemento de la página anterior. */
  readonly after?: readonly [string, string] | undefined;
  /** Orden: atrasadas primero y luego por vencimiento (próximos pagos) o solo por vencimiento. */
  readonly order?: 'UPCOMING' | 'DUE_DATE' | undefined;
}

export interface ResolvedOutflowRow {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly generatedAt: string;
  readonly resolution: 'MATERIALIZED' | 'MATCHED';
  readonly matchedBy: 'USER_LINK' | 'SUGGESTION' | null;
  readonly transactionId: string;
  readonly currency: string;
}

export interface OccurrenceRepository {
  /**
   * `INSERT … ON CONFLICT (definition_id, occurrence_date) DO NOTHING RETURNING id` (INV-013): devuelve SOLO las
   * insertadas por esta ejecución; las que ya existían no producen hechos ni transiciones.
   */
  insertIfAbsent(occurrences: readonly RecurringOccurrence[]): Promise<RecurringOccurrence[]>;
  findById(
    workspaceId: string,
    id: string,
    options?: { readonly lock?: 'update' },
  ): Promise<RecurringOccurrence | null>;
  /** Control optimista por `persistedVersion`; `false` si la versión cambió. */
  save(occurrence: RecurringOccurrence): Promise<boolean>;
  findByTransaction(workspaceId: string, transactionId: string): Promise<RecurringOccurrence | null>;
  /** Ocurrencias de una definición (todas o las de fecha nominal ≥ `from`). */
  listForDefinition(
    workspaceId: string,
    definitionId: string,
    options?: { readonly from?: string; readonly statuses?: readonly OccurrenceStatus[] },
  ): Promise<RecurringOccurrence[]>;
  /** Forma liviana para el planificador y la guarda de fecha efectiva. */
  listExisting(workspaceId: string, definitionId: string, from?: string): Promise<ExistingOccurrence[]>;
  list(workspaceId: string, filter: OccurrenceFilter): Promise<OccurrenceView[]>;
  findView(workspaceId: string, id: string): Promise<OccurrenceView | null>;
  /** No resueltas (`SCHEDULED|DUE|OVERDUE`) con vencimiento dentro del rango. */
  listUnresolvedInRange(workspaceId: string, from: string, to: string): Promise<OccurrenceView[]>;
  /** No resueltas con vencimiento anterior a `before`. */
  listUnresolvedBefore(workspaceId: string, before: string): Promise<OccurrenceView[]>;
  listResolvedOutflows(workspaceId: string, from: string, to: string): Promise<ResolvedOutflowRow[]>;
  /** Fecha nominal más reciente de una ocurrencia resuelta (`MATERIALIZED|MATCHED|SKIPPED`) o `null`. */
  lastResolvedNominal(workspaceId: string, definitionId: string): Promise<string | null>;
}

export interface CommitmentsMetricsPort {
  increment(name: string, labels: Readonly<Record<string, string>>, value?: number): void;
  observe?(name: string, labels: Readonly<Record<string, string>>, value: number): void;
}

/** Dependencias de los casos de uso (design § Decisiones 1, 10 y 16). */
export interface CommitmentsDeps {
  readonly uow: UnitOfWork;
  readonly definitions: DefinitionRepository;
  readonly occurrences: OccurrenceRepository;
  /** Sugerencias de coincidencia (openspec add-commitment-matching). */
  readonly matching: MatchSuggestionRepository;
  readonly calendar: WorkspaceCalendarQuery;
  readonly settings: WorkspaceSettingsPort;
  readonly periods: FinancialPeriodPort;
  readonly accounts: AccountsQueryPort;
  readonly accountCatalog: Pick<AccountCatalogQuery, 'listAccounts'>;
  readonly classification: ClassificationValidator;
  readonly rates: FxValuationPort;
  readonly transactions: RecurringTransactionPort;
  readonly links: TransactionLinkQuery;
  readonly pending: PendingFlowQuery;
  readonly audit: AuditPort;
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery?: LifecycleQuery;
  readonly outbox: OutboxPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** `COMMITMENTS_HORIZON_DAYS` (14..366, 90 por omisión). */
  readonly horizonDays: number;
  /** `REPORTING_RATE_VALIDITY_WINDOW` en días (misma ventana que el Home). */
  readonly rateValidityWindowDays: number;
  readonly metrics?: CommitmentsMetricsPort;
}
