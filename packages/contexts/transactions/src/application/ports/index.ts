import type { AuditHistoryQuery, AuditPort } from '@pf/audit/contracts';
import type { AccountsQueryPort } from '@pf/accounts/contracts';
import type { ClassificationValidator } from '@pf/classification/contracts';
import type { LedgerPostingPort } from '@pf/ledger/contracts';
import type { Clock, Money } from '@pf/shared-kernel';
import type {
  PaymentMethod,
  Transaction,
  TransactionKind,
  TransactionSource,
  TransactionState,
  TransactionStatus,
} from '../../domain/index.js';

/** Transacción PG + `SET LOCAL app.workspace_id`; reutiliza la del llamador si existe (idempotencia, orquestación). */
export interface UnitOfWork {
  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}

export type TransactionSort =
  'transactionDate' | '-transactionDate' | 'amount' | '-amount' | 'createdAt' | '-createdAt';

export interface TransactionListFilter {
  readonly accountIds?: readonly string[];
  readonly categoryIds?: readonly string[];
  readonly tagIds?: readonly string[];
  readonly counterpartyIds?: readonly string[];
  readonly kinds?: readonly TransactionKind[];
  readonly statuses?: readonly TransactionStatus[];
  readonly sources?: readonly TransactionSource[];
  readonly paymentMethods?: readonly PaymentMethod[];
  readonly currency?: string;
  readonly dateFrom?: string;
  readonly dateTo?: string;
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
  findById(
    workspaceId: string,
    id: string,
    options?: { readonly forUpdate?: boolean },
  ): Promise<Transaction | null>;
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
}

export interface CurrencyCatalog {
  /** Escala de la moneda (`null` si no existe o no está habilitada). */
  scaleOf(code: string): Promise<number | null>;
}

/** Categorías de sistema y jerarquía (CLASSIFICATION, vía su API pública). */
export interface CategoryLookupPort {
  /** *Uncategorized* (`EXPENSE`) o *Uncategorized income* (`INCOME`) del workspace. */
  uncategorized(workspaceId: string, kind: 'EXPENSE' | 'INCOME'): Promise<string | null>;
  /** Las categorías dadas y todas sus subcategorías (filtro `categoryId` del listado). */
  withDescendants(workspaceId: string, categoryIds: readonly string[]): Promise<string[]>;
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

export interface TransactionsDeps {
  readonly uow: UnitOfWork;
  readonly transactions: TransactionRepository;
  readonly currencies: CurrencyCatalog;
  readonly accounts: AccountsQueryPort;
  readonly ledger: LedgerPostingPort;
  readonly classification: ClassificationValidator;
  readonly categories: CategoryLookupPort;
  readonly outbox: OutboxPort;
  readonly audit: AuditPort;
  readonly history: AuditHistoryQuery;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}
