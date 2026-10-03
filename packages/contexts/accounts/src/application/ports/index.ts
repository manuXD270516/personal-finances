import type { AuditPort } from '@pf/audit/contracts';
import type { Clock } from '@pf/shared-kernel';
import type { AccountOpeningBalancePort, MoneyDto } from '../../contracts/index.js';
import type {
  Account,
  AccountStatus,
  AccountType,
  CurrencyKind,
  Institution,
  InstitutionKind,
  Liquidity,
} from '../../domain/index.js';

/** Transacción PG + `SET LOCAL app.workspace_id`; reutiliza la del llamador si existe (idempotencia, orquestación). */
export interface UnitOfWork {
  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}

export interface AccountListFilter {
  readonly types?: readonly AccountType[];
  readonly currencies?: readonly string[];
  readonly institutionId?: string;
  readonly statuses: readonly AccountStatus[];
  readonly tagId?: string;
  readonly liquidities?: readonly Liquidity[];
}

export interface AccountRepository {
  /** `ACCOUNT_NAME_TAKEN` si otra cuenta no archivada usa el nombre (índice único parcial, case-insensitive). */
  insert(account: Account): Promise<void>;
  /** Optimistic locking por `persistedVersion`; `false` si la versión cambió. */
  update(account: Account): Promise<boolean>;
  /** `forUpdate` toma `SELECT … FOR UPDATE` (archivar/cerrar vs. postear, design.md decisión 4). */
  findById(
    workspaceId: string,
    id: string,
    options?: { readonly forUpdate?: boolean },
  ): Promise<Account | null>;
  list(workspaceId: string, filter: AccountListFilter): Promise<Account[]>;
  /** Todas las cuentas del workspace bloqueadas para reordenar. */
  listAllForUpdate(workspaceId: string): Promise<Account[]>;
  nextDisplayOrder(workspaceId: string): Promise<number>;
  /** Elegibilidad con `FOR SHARE` (INV-026). */
  lockForPosting(workspaceId: string, ids: readonly string[]): Promise<Account[]>;
}

export interface InstitutionListFilter {
  readonly includeArchived: boolean;
  readonly kinds?: readonly InstitutionKind[];
  readonly query?: string;
}

export interface InstitutionRepository {
  /** `NAME_TAKEN` si otra institución activa usa el nombre. */
  insert(institution: Institution): Promise<void>;
  update(institution: Institution): Promise<boolean>;
  findById(workspaceId: string, id: string): Promise<Institution | null>;
  list(workspaceId: string, filter: InstitutionListFilter): Promise<Institution[]>;
}

export interface CurrencyInfo {
  readonly code: string;
  readonly kind: CurrencyKind;
  readonly scale: number;
  readonly active: boolean;
}

/** Catálogo `fx.currency` (FX): clase, escala y si está habilitada. */
export interface CurrencyCatalog {
  find(code: string): Promise<CurrencyInfo | null>;
}

export interface LedgerAccountBalance {
  /** Σ postings con signo (saldo contable). */
  readonly balance: MoneyDto;
  /** Saldo presentado según la naturaleza (pasivo positivo = adeudado). */
  readonly presented: MoneyDto;
}

/** Saldos calculados por LEDGER (nunca se persisten en Accounts). */
export interface LedgerBalancesPort {
  /** Solo incluye las cuentas que ya tienen ledger account (las demás tienen saldo cero y sin movimientos). */
  balancesOf(
    workspaceId: string,
    accountIds: readonly string[],
  ): Promise<ReadonlyMap<string, LedgerAccountBalance>>;
}

/** Catálogo de etiquetas (Classification contracts): `TAG_ARCHIVED`/`REFERENCE_NOT_FOUND` si no asignables. */
export interface TagCatalogPort {
  assertAssignable(workspaceId: string, tagIds: readonly string[]): Promise<void>;
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

/** Zona horaria del workspace para fechas de negocio (`reactivatedOn`, `archivedOn`). */
export interface WorkspaceCalendar {
  today(workspaceId: string): Promise<string>;
}

export interface AccountsDeps {
  readonly uow: UnitOfWork;
  readonly accounts: AccountRepository;
  readonly institutions: InstitutionRepository;
  readonly currencies: CurrencyCatalog;
  readonly balances: LedgerBalancesPort;
  readonly tags: TagCatalogPort;
  readonly openingBalance: AccountOpeningBalancePort;
  readonly outbox: OutboxPort;
  readonly audit: AuditPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly calendar: WorkspaceCalendar;
}
