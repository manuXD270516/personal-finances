/**
 * API pública de `@pf/ledger` (openspec add-ledger-core; ADR-0003): puertos síncronos que otros contextos invocan
 * DENTRO de su unidad de trabajo (misma transacción BD del llamador) y la consulta de saldos. Hoja: no importa capas
 * internas. Los montos viajan como `{amount: "<decimal>", currency: "<código>"}` (nunca `number`, ADR-0006).
 */
export const LEDGER_CONTEXT = 'ledger' as const;

export interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
}

export type LedgerAccountNatureDto = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
export type SystemAccountKindDto = 'INCOME' | 'EXPENSE' | 'OPENING_BALANCE' | 'FX_TRADING' | 'ADJUSTMENTS';
export type EntryTypeDto = 'STANDARD' | 'REVERSAL' | 'OPENING';

/** Cuenta contable destino de un posting: la de una cuenta del usuario, una de sistema o una ya conocida. */
export type PostingTargetDto =
  | { readonly kind: 'USER_ACCOUNT'; readonly accountId: string; readonly nature: 'ASSET' | 'LIABILITY' }
  | { readonly kind: 'SYSTEM'; readonly systemKind: SystemAccountKindDto }
  | { readonly kind: 'LEDGER_ACCOUNT'; readonly ledgerAccountId: string };

export interface PostingLineDto {
  readonly target: PostingTargetDto;
  /** Débito positivo, crédito negativo (FR-LEDGER-002). La moneda debe ser la de la cuenta contable. */
  readonly amount: MoneyDto;
  /** Obligatorio en postings a `INCOME`/`EXPENSE` (FR-LEDGER-008). */
  readonly splitId?: string | null;
}

export interface SourceRefDto {
  readonly type: 'Transaction';
  readonly id: string;
  readonly revision: number;
}

export interface PostJournalEntryCommand {
  readonly workspaceId: string;
  /** Fecha de negocio `YYYY-MM-DD`. */
  readonly entryDate: string;
  readonly entryType: 'STANDARD' | 'OPENING';
  readonly sourceRef: SourceRefDto;
  readonly memo?: string | null;
  readonly postings: readonly PostingLineDto[];
}

export interface ReverseJournalEntryCommand {
  readonly workspaceId: string;
  readonly journalEntryId: string;
  /** Fecha de la reversa (por defecto Transactions usa la del original, docs/09 §5). */
  readonly reverseDate: string;
  readonly reason: string;
}

export interface PostedEntryDto {
  readonly journalEntryId: string;
  readonly sequence: string;
  /** `false` si el origen y la revisión ya tenían asiento (idempotencia por origen, FR-LEDGER-010). */
  readonly created: boolean;
}

/**
 * Puerto de registro (sync). Errores (`DomainError.code`): `LEDGER_UNBALANCED_ENTRY`,
 * `LEDGER_ENTRY_TOO_FEW_POSTINGS`, `LEDGER_ZERO_AMOUNT_POSTING`, `AMOUNT_SCALE_EXCEEDED`, `CURRENCY_MISMATCH`,
 * `LEDGER_SPLIT_REQUIRED`, `PERIOD_CLOSED`, `REFERENCE_NOT_FOUND`, `LEDGER_ENTRY_ALREADY_REVERSED`,
 * `LEDGER_ENTRY_NOT_REVERSIBLE`.
 */
export interface LedgerPostingPort {
  postJournalEntry(command: PostJournalEntryCommand): Promise<PostedEntryDto>;
  reverseJournalEntry(command: ReverseJournalEntryCommand): Promise<PostedEntryDto>;
  /** Get-or-create idempotente de la cuenta contable 1:1 de una cuenta del usuario (FR-ACCOUNTS-003). */
  ledgerAccountForUserAccount(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly nature: 'ASSET' | 'LIABILITY';
    readonly currency: string;
  }): Promise<{ readonly ledgerAccountId: string; readonly code: string }>;
}

/** Bloqueo MENSUAL de periodos (docs/31 D10). Idempotente; lo usará Planning (Phase 2) en su transacción de cierre. */
export interface LedgerPeriodLockPort {
  lockPeriod(input: {
    readonly workspaceId: string;
    readonly yearMonth: string;
    readonly periodId?: string | null;
  }): Promise<void>;
  unlockPeriod(input: {
    readonly workspaceId: string;
    readonly yearMonth: string;
    readonly reason: string;
  }): Promise<void>;
}

export interface AccountBalanceDto {
  readonly ledgerAccountId: string;
  readonly code: string;
  readonly nature: LedgerAccountNatureDto;
  readonly accountId: string | null;
  /** Saldo contable: Σ postings con signo. */
  readonly balance: MoneyDto;
  /** Saldo presentado según la naturaleza (FR-LEDGER-012). */
  readonly presented: MoneyDto;
}

export interface TrialBalanceDto {
  readonly asOf: string | null;
  readonly currencies: readonly {
    readonly currency: string;
    readonly lines: readonly AccountBalanceDto[];
    readonly total: MoneyDto;
  }[];
}

export interface EntrySummaryDto {
  readonly journalEntryId: string;
  readonly entryType: EntryTypeDto;
  readonly entryDate: string;
  readonly sequence: string;
  readonly sourceRevision: number;
  readonly reversesEntryId: string | null;
  readonly reversedByEntryId: string | null;
}

/** Consultas de saldo (sin efectos). El saldo contable no conoce estados de transacción (pendientes, FR-LEDGER-013). */
export interface BalanceQuery {
  getBalance(input: {
    readonly workspaceId: string;
    readonly ledgerAccountId: string;
    readonly asOf?: string;
  }): Promise<AccountBalanceDto>;
  /** Σ por moneda de las cuentas indicadas (o de todas las ASSET/LIABILITY); nunca suma monedas distintas. */
  getBalances(input: {
    readonly workspaceId: string;
    readonly ledgerAccountIds?: readonly string[];
    readonly asOf?: string;
  }): Promise<readonly MoneyDto[]>;
  getTrialBalance(input: { readonly workspaceId: string; readonly asOf?: string }): Promise<TrialBalanceDto>;
  getEntriesBySource(input: {
    readonly workspaceId: string;
    readonly sourceId: string;
  }): Promise<readonly EntrySummaryDto[]>;
}

/** Saldos por lote de cuentas del usuario (`GetBalances` por lote; openspec add-basic-dashboard). */
export interface AccountBalancesDto {
  /** Fecha de corte aplicada (`null` = sin límite de fecha). */
  readonly asOf: string | null;
  /** Instante de registro del último asiento del workspace (frescura de los datos), `null` si no hay asientos. */
  readonly latestEntryAt: string | null;
  /** Una línea por cuenta del usuario con ledger account (las demás tienen saldo cero). */
  readonly balances: readonly AccountBalanceDto[];
}

/**
 * Consulta de saldos por lote para lecturas (Reporting): saldo contable y presentado de cada cuenta del usuario a la
 * fecha `asOf` (por defecto, hoy en la zona horaria del workspace), acelerada por `balance_snapshot`. Sin efectos.
 */
export interface AccountBalancesQuery {
  getAccountBalances(input: {
    readonly workspaceId: string;
    /** Ids de cuentas del usuario (Accounts); sin filtro = todas. */
    readonly accountIds?: readonly string[];
    readonly asOf?: string;
  }): Promise<AccountBalancesDto>;
}

export const LEDGER_POSTING_PORT = Symbol.for('pf.ledger.LedgerPostingPort');
export const LEDGER_PERIOD_LOCK_PORT = Symbol.for('pf.ledger.LedgerPeriodLockPort');
export const BALANCE_QUERY = Symbol.for('pf.ledger.BalanceQuery');
export const ACCOUNT_BALANCES_QUERY = Symbol.for('pf.ledger.AccountBalancesQuery');

/** Nombre del evento publicado por el outbox (contracts/events/ledger/JournalEntryPosted.v1.schema.json). */
export const JOURNAL_ENTRY_POSTED = { eventType: 'ledger.JournalEntryPosted', eventVersion: 1 } as const;
