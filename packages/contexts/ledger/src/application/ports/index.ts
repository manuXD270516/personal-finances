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

/** Métricas del ledger (Prometheus/OTel en la plataforma). */
export interface MetricsPort {
  increment(name: string, labels: Readonly<Record<string, string>>, value?: number): void;
}

/** Log estructurado (pino en la plataforma); los campos van en `fields`, nunca interpolados en el mensaje. */
export interface LedgerLogPort {
  info(fields: Readonly<Record<string, unknown>>, message: string): void;
  error(fields: Readonly<Record<string, unknown>>, message: string): void;
}

/** Invariantes que revisa el verificador (design.md §Decisiones 10). */
export type LedgerInvariant = 'INV-004' | 'INV-005' | 'INV-008' | 'INV-022' | 'STRUCTURE';

export interface LedgerInvariantViolation {
  readonly invariant: LedgerInvariant;
  readonly workspaceId: string;
  /** Asiento o cuenta contable afectada. */
  readonly journalEntryId?: string;
  readonly ledgerAccountId?: string;
  readonly currency?: string;
  readonly asOfDate?: string;
  /** Diferencia o suma observada (decimal como string, nunca `number`). */
  readonly difference?: string;
  readonly detail: string;
}

/**
 * Acceso de mantenimiento al ledger (worker, rol `pf_ledger_maintenance` asumido solo en la transacción del job):
 * lectura entre workspaces y escritura de la caché `ledger.balance_snapshot` (DRV).
 */
export interface LedgerMaintenanceRepository {
  /** Recalcula desde cero los snapshots al `asOfDate` (de un workspace/cuenta o de todo el ledger). */
  rebuildSnapshots(input: {
    readonly asOfDate: string;
    readonly workspaceId?: string;
    readonly ledgerAccountId?: string;
  }): Promise<{ readonly workspaces: number; readonly snapshots: number }>;
  findViolations(): Promise<readonly LedgerInvariantViolation[]>;
}
