import type { Clock, Currency } from '@pf/shared-kernel';
import type {
  JournalEntry,
  LedgerAccount,
  PeriodLock,
  SourceRef,
  SystemKind,
  YearMonth,
} from '../../domain/index.js';

/**
 * Unidad de trabajo del ledger: reutiliza la transacción del llamador si existe (mismo commit que la transacción de
 * negocio, `LedgerPostingPort` es síncrono) o abre una con el contexto RLS del workspace. La implementación traduce
 * los SQLSTATE del ledger (`PF001/PF004/PF005` → `DomainError`; `PF002/PF003/42501` → `INTERNAL_ERROR` + métrica).
 */
export interface LedgerUnitOfWork {
  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}

/** Catálogo de monedas (`fx.currency`): escala canónica; `REFERENCE_NOT_FOUND` si no existe. */
export interface CurrencyCatalog {
  currencyOf(code: string): Promise<Currency>;
}

/** Plan de cuentas: get-or-create idempotente (INSERT … ON CONFLICT DO NOTHING + relectura). */
export interface LedgerAccountRepository {
  getOrCreateForUserAccount(input: {
    readonly workspaceId: string;
    readonly sourceAccountId: string;
    readonly nature: 'ASSET' | 'LIABILITY';
    readonly currency: Currency;
  }): Promise<LedgerAccount>;
  getOrCreateSystem(input: {
    readonly workspaceId: string;
    readonly kind: SystemKind;
    readonly currency: Currency;
  }): Promise<LedgerAccount>;
  /** `null` si no existe o es de otro workspace (invisible bajo RLS). */
  findById(workspaceId: string, id: string): Promise<LedgerAccount | null>;
}

/** Repositorio append-only de asientos (sin update ni delete). */
export interface JournalEntryRepository {
  /** Inserta asiento + postings; devuelve el asiento con su `sequence`. */
  append(entry: JournalEntry): Promise<JournalEntry>;
  findById(workspaceId: string, id: string): Promise<JournalEntry | null>;
  findBySource(
    workspaceId: string,
    source: SourceRef,
    entryType: JournalEntry['entryType'],
  ): Promise<JournalEntry | null>;
  isReversed(workspaceId: string, entryId: string): Promise<boolean>;
  /** Vincula original → reversa (PK de `entry_reversal`); `LEDGER_ENTRY_ALREADY_REVERSED` si ya existía. */
  recordReversal(workspaceId: string, originalId: string, reversalId: string): Promise<void>;
}

export interface PeriodLockRepository {
  isLocked(workspaceId: string, yearMonth: YearMonth): Promise<boolean>;
  /** Idempotente: bloquear un mes ya bloqueado no hace nada. Devuelve si cambió algo. */
  lock(lock: PeriodLock, lockedBy: string | null): Promise<boolean>;
  /** Idempotente. Devuelve si cambió algo. */
  unlock(workspaceId: string, yearMonth: YearMonth): Promise<boolean>;
}

/** Puerto del outbox (ADR-0008): escribe el evento en la transacción en curso. */
export interface LedgerOutboxPort {
  append(draft: {
    readonly eventId: string;
    readonly eventType: string;
    readonly eventVersion: number;
    readonly occurredAt: string;
    readonly workspaceId: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly aggregateVersion: number;
    readonly payload: object;
    readonly correlationId?: string;
    readonly actor?: { readonly type: 'USER' | 'SYSTEM' | 'SERVICE'; readonly id: string | null };
  }): Promise<unknown>;
}

export interface IdGenerator {
  newId(): string;
}

/** Contexto del actor/correlación de la petición o job en curso (lo aporta la plataforma). */
export interface LedgerRequestContext {
  actorUserId(): string | null;
  correlationId(): string | null;
}

export interface LedgerDeps {
  readonly uow: LedgerUnitOfWork;
  readonly currencies: CurrencyCatalog;
  readonly accounts: LedgerAccountRepository;
  readonly entries: JournalEntryRepository;
  readonly periods: PeriodLockRepository;
  readonly outbox: LedgerOutboxPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly context: LedgerRequestContext;
}
