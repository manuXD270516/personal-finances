import type { AuditHistoryQuery, AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { AccountsQueryPort } from '@pf/accounts/contracts';
import type { ClassificationValidator } from '@pf/classification/contracts';
import type { FxConversionPricingPort } from '@pf/fx/contracts';
import type { LedgerPostingPort } from '@pf/ledger/contracts';
import type { Clock, Money } from '@pf/shared-kernel';
import type {
  ConversionDetail,
  LegRole,
  PaymentMethod,
  Reconciliation,
  SystemFlag,
  Transaction,
  TransactionKind,
  TransactionSource,
  TransactionState,
  TransactionStatus,
} from '../../domain/index.js';

/** Transacción PG + `SET LOCAL app.workspace_id`; reutiliza la del llamador si existe (idempotencia, orquestación). */
export interface UnitOfWork {
  run<T>(
    workspaceId: string,
    fn: () => Promise<T>,
    options?: { readonly isolation?: 'SERIALIZABLE' },
  ): Promise<T>;
}

export type TransactionSort =
  'transactionDate' | '-transactionDate' | 'amount' | '-amount' | 'createdAt' | '-createdAt';

/** Filtro por valor de custom field (`customField[<key>]`, `[gte]`, `[lte]`): igualdad o rango (decimal, número, fecha). */
export interface CustomFieldFilter {
  readonly key: string;
  readonly eq?: string;
  readonly gte?: string;
  readonly lte?: string;
}

export interface TransactionListFilter {
  readonly accountIds?: readonly string[];
  readonly categoryIds?: readonly string[];
  readonly tagIds?: readonly string[];
  readonly customFields?: readonly CustomFieldFilter[];
  readonly counterpartyIds?: readonly string[];
  readonly kinds?: readonly TransactionKind[];
  readonly statuses?: readonly TransactionStatus[];
  readonly sources?: readonly TransactionSource[];
  readonly paymentMethods?: readonly PaymentMethod[];
  readonly currency?: string;
  /** Solo conversiones: moneda del leg `TARGET` vigente. */
  readonly targetCurrency?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
  /** Marcas de sistema derivadas (docs/33 D111): `RECONCILED_WITHOUT_STATEMENT`. */
  readonly systemFlags?: readonly SystemFlag[];
  readonly amountMin?: string;
  readonly amountMax?: string;
  /** Texto ya normalizado (minúsculas, sin acentos). */
  readonly q?: string;
  readonly sort: TransactionSort;
}

export interface TransactionRepository {
  insert(tx: Transaction): Promise<void>;
  /** Optimistic locking por `persistedVersion`; `false` si otra escritura ganó (CONCURRENCY_CONFLICT). */
  update(tx: Transaction): Promise<boolean>;
  /**
   * Persiste SOLO un cambio de estado de conciliación sin tocar legs, splits ni conversiones (`status`,
   * `reconciliation_mode`, versión): CLEAR/UNCLEAR/RECONCILE/UNRECONCILE/cotejo (add-reconciliation). Optimistic
   * locking por `persistedVersion`; `false` si otra escritura ganó.
   */
  updateStatus(tx: Transaction): Promise<boolean>;
  findById(
    workspaceId: string,
    id: string,
    options?: { readonly forUpdate?: boolean },
  ): Promise<Transaction | null>;
  /**
   * Varias transacciones por id (add-bulk-edit). Con `forUpdate` las bloquea `FOR UPDATE` ordenadas por id (sin
   * deadlocks entre operaciones masivas concurrentes) con `lock_timeout` de 5 s ⇒ `CONCURRENCY_CONFLICT`
   * reintentable. Devuelve un mapa por id; las inexistentes (o de otro workspace, RLS) no aparecen.
   */
  findMany(
    workspaceId: string,
    ids: readonly string[],
    options?: { readonly forUpdate?: boolean },
  ): Promise<ReadonlyMap<string, Transaction>>;
  /**
   * Persiste en lote los cambios de una edición masiva (add-bulk-edit): cabecera descriptiva (notas, contraparte,
   * estado), categoría, tags y custom fields de los splits; nunca legs, montos ni revisión (INV-033). Optimistic
   * locking por `persistedVersion` de cada una; `false` si alguna otra escritura ganó. Sentencias multi-fila.
   */
  updateClassificationBatch(txs: readonly Transaction[]): Promise<boolean>;
  /** Página por offset (el cursor opaco lo firma la capa HTTP). */
  list(
    workspaceId: string,
    filter: TransactionListFilter,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<Transaction[]>;
  /** Transacciones no anuladas de la cuenta y moneda con el mismo monto en la ventana de fechas. */
  duplicateCandidates(
    workspaceId: string,
    probe: { readonly accountId: string; readonly amount: Money; readonly from: string; readonly to: string },
  ): Promise<TransactionState[]>;
  /** Σ (decimal) de reembolsos no anulados vinculados al original. */
  refundedTotal(workspaceId: string, originalId: string): Promise<string>;
  /** Cadena append-only `transaction_journal_link`. */
  linkEntry(input: {
    readonly workspaceId: string;
    readonly transactionId: string;
    readonly revision: number;
    readonly journalEntryId: string;
    readonly linkType: 'POSTED' | 'REVERSAL';
  }): Promise<void>;
  linkedEntries(workspaceId: string, transactionId: string): Promise<string[]>;
  /**
   * Legs de cada revisión (vigentes y reemplazadas; `superseded_in_revision` no las borra) para los montos por revisión
   * del recorrido (add-lifecycle-timeline decisión 7).
   */
  revisionLegs(
    workspaceId: string,
    transactionId: string,
  ): Promise<
    ReadonlyMap<
      number,
      readonly { readonly accountId: string; readonly role: LegRole; readonly amount: Money }[]
    >
  >;
  /** Asientos POSTED por revisión (para el historial de revisiones de una conversión). */
  postedEntriesByRevision(workspaceId: string, transactionId: string): Promise<Map<number, string>>;
  /** Todas las revisiones del `ConversionDetail` (inmutables), de la más antigua a la vigente. */
  conversionRevisions(
    workspaceId: string,
    transactionId: string,
  ): Promise<{ readonly detail: ConversionDetail; readonly createdAt: string | null }[]>;
}

/** Fila de `txn.reconciliation_item`: transacción reconciliada (o cotejada) por una sesión. */
export interface ReconciliationItem {
  readonly reconciliationId: string;
  readonly transactionId: string;
  readonly reconciledAt: string;
  /** `true` si la transacción ya estaba conciliada sin extracto y la sesión la coteja (decisión 14). */
  readonly verifiedWithoutStatement: boolean;
  readonly unreconciledAt: string | null;
  readonly unreconciledBy: string | null;
  readonly unreconcileReason: string | null;
}

export interface ReconciliationListFilter {
  readonly accountId?: string;
  readonly status?: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
}

/** Conteos por cuenta para `ReconciliationStatusQuery.getCoverage` (decisión 9). */
export interface CoverageCounts {
  /** Transacciones `POSTED` con un leg en la cuenta y fecha ≤ corte. */
  readonly unreconciledPostedCount: number;
  /** Transacciones `CLEARED` con un leg en la cuenta y fecha ≤ corte. */
  readonly unreconciledClearedCount: number;
  /** `RECONCILED` en modo `WITHOUT_STATEMENT` con fecha en `[from, through]`. */
  readonly withoutStatementInRange: number;
  /** ¿Existe una `RECONCILED/WITHOUT_STATEMENT` con fecha en `(afterDate, through]`? */
  readonly withoutStatementAfterLastStatement: boolean;
}

export interface ReconciliationRepository {
  insert(r: Reconciliation): Promise<void>;
  /** Optimistic locking por `persistedVersion`; `false` si otra escritura ganó. */
  update(r: Reconciliation): Promise<boolean>;
  findById(
    workspaceId: string,
    id: string,
    options?: { readonly forUpdate?: boolean },
  ): Promise<Reconciliation | null>;
  /** La sesión `IN_PROGRESS` de la cuenta, si existe (índice único parcial). */
  findInProgress(workspaceId: string, accountId: string): Promise<Reconciliation | null>;
  /** La sesión `COMPLETED` de la cuenta con mayor fecha de extracto. */
  lastCompleted(workspaceId: string, accountId: string): Promise<Reconciliation | null>;
  /** Orden `statementDate DESC, id DESC`. */
  list(
    workspaceId: string,
    filter: ReconciliationListFilter,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<Reconciliation[]>;
  findByIds(workspaceId: string, ids: readonly string[]): Promise<Reconciliation[]>;
  /**
   * Σ de los legs vigentes de la cuenta (signo contable) de transacciones en los `statuses` con fecha de negocio ≤
   * `through`, y cuántas transacciones son. Consulta agregada (p95 ≤ 150 ms, NFR-PERF-003).
   */
  confirmedLegsTotal(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly currency: string;
    readonly through: string;
    readonly statuses: readonly ('CLEARED' | 'RECONCILED')[];
  }): Promise<{ readonly total: Money; readonly count: number }>;
  /** `CLEARED` con un leg en la cuenta y fecha ≤ `through`, bloqueadas `FOR UPDATE`, por fecha e id. */
  lockClearedThrough(workspaceId: string, accountId: string, through: string): Promise<Transaction[]>;
  /** `RECONCILED` en modo `WITHOUT_STATEMENT` con un leg en la cuenta y fecha ≤ `through`, `FOR UPDATE`. */
  lockWithoutStatementThrough(
    workspaceId: string,
    accountId: string,
    through: string,
  ): Promise<Transaction[]>;
  insertItems(
    workspaceId: string,
    items: readonly {
      readonly reconciliationId: string;
      readonly transactionId: string;
      readonly verifiedWithoutStatement: boolean;
    }[],
  ): Promise<void>;
  itemsOf(workspaceId: string, reconciliationId: string): Promise<ReconciliationItem[]>;
  /**
   * Anota la des-reconciliación posterior en el ítem vigente de la transacción (sin alterar el resultado de la
   * sesión) y devuelve la sesión; `null` si la transacción no fue reconciliada en una sesión (D77).
   */
  markUnreconciled(input: {
    readonly workspaceId: string;
    readonly transactionId: string;
    readonly reason: string;
  }): Promise<{ readonly reconciliationId: string } | null>;
  coverageCounts(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly from: string | null;
    readonly through: string;
    readonly afterDate: string | null;
  }): Promise<CoverageCounts>;
}

/** Saldo inicial de una cuenta en el ledger (asiento de apertura; no tiene fila en `txn`). */
export interface OpeningBalanceReader {
  /** Σ postings con signo contable de los asientos de apertura de la cuenta con fecha ≤ `asOf`; `null` si no hay. */
  openingBalance(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly asOf: string;
  }): Promise<{ readonly amount: string; readonly currency: string } | null>;
}

/** Fecha de hoy en la zona horaria del workspace (RISK-020). */
export interface WorkspaceCalendar {
  today(workspaceId: string): Promise<string>;
}

export interface CurrencyCatalog {
  /** Escala de la moneda (`null` si no existe o no está habilitada). */
  scaleOf(code: string): Promise<number | null>;
}

/** Categorías de sistema y jerarquía (CLASSIFICATION, vía su API pública). */
export interface CategoryLookupPort {
  /** *Uncategorized* (`EXPENSE`) o *Uncategorized income* (`INCOME`) del workspace. */
  uncategorized(workspaceId: string, kind: 'EXPENSE' | 'INCOME'): Promise<string | null>;
  /** Categoría de sistema *Fees* (comisión por defecto de una transferencia, add-transfers decisión 2). */
  fees(workspaceId: string): Promise<string | null>;
  /** Las categorías dadas y todas sus subcategorías (filtro `categoryId` del listado). */
  withDescendants(workspaceId: string, categoryIds: readonly string[]): Promise<string[]>;
}

/** Evento de dominio a escribir en el outbox de la unidad de trabajo en curso. */
export interface OutboxEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly occurredAt: string;
  readonly workspaceId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: number;
  readonly payload: object;
  /** Correlación explícita del evento (UUID); por defecto la de la petición. Operaciones masivas: `bulkOperationId`. */
  readonly correlationId?: string;
}

export interface OutboxPort {
  append(event: OutboxEvent): Promise<void>;
  /** Varios eventos con una sola sentencia multi-fila (operaciones masivas). Opcional: sin ella se usa `append`. */
  appendMany?(events: readonly OutboxEvent[]): Promise<void>;
}

export interface IdGenerator {
  /** UUIDv7. */
  next(): string;
}

export interface TransactionsDeps {
  readonly uow: UnitOfWork;
  readonly transactions: TransactionRepository;
  readonly currencies: CurrencyCatalog;
  readonly accounts: AccountsQueryPort;
  readonly ledger: LedgerPostingPort;
  readonly classification: ClassificationValidator;
  readonly categories: CategoryLookupPort;
  /** Referencia y costo de conversiones (FX vía `@pf/fx/contracts`, misma unidad de trabajo). */
  readonly fx: FxConversionPricingPort;
  readonly outbox: OutboxPort;
  readonly audit: AuditPort;
  /** Auditoría + registro de transición/anotación en la misma unidad de trabajo (add-lifecycle-timeline). */
  readonly lifecycle: LifecyclePort;
  readonly history: AuditHistoryQuery;
  /** `GetLifecycle` de AUDIT (el recorrido lo compone TRANSACTIONS con los montos de sus revisiones). */
  readonly lifecycleQuery: LifecycleQuery;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** Sesiones de reconciliación (add-reconciliation). */
  readonly reconciliations: ReconciliationRepository;
  readonly openingBalances: OpeningBalanceReader;
  readonly calendar: WorkspaceCalendar;
}
