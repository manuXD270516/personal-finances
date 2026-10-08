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
  /**
   * Rechaza con `PERIOD_CLOSED` si el mes de `date` (`YYYY-MM-DD`) está cerrado (INV-015; docs/31 D49): lo usan los
   * cambios que no generan asiento pero alteran lo reportado de un periodo cerrado (recategorizar). Sin efectos.
   */
  assertPeriodOpen(input: { readonly workspaceId: string; readonly date: string }): Promise<void>;
  /**
   * Primera fecha de negocio ABIERTA `>= date` (`YYYY-MM-DD`): salta los periodos cerrados contiguos (ADR-0028;
   * anulación corregida en el periodo vigente). Sin efectos.
   */
  firstOpenDateOnOrAfter(input: { readonly workspaceId: string; readonly date: string }): Promise<string>;
}

/**
 * Bloqueo por RANGO del periodo financiero (ADR-0028; en Phase 1 era el mes calendario, docs/31 D10). Idempotente por
 * `yearMonth` (etiqueta del periodo); lo usa Planning en su transacción de cierre.
 */
export interface LedgerPeriodLockPort {
  /**
   * Cierra `[periodStart, periodEnd]` (`YYYY-MM-DD`; sin rango explícito, el mes calendario de `yearMonth`);
   * `openStart: true` = abierto hacia atrás (primer periodo cerrado). Toma el candado EXCLUSIVO del workspace ANTES de
   * insertar el lock, en la unidad de trabajo del llamador. Un rango que se solape con otro periodo cerrado falla.
   */
  lockPeriod(input: {
    readonly workspaceId: string;
    readonly yearMonth: string;
    readonly periodId?: string | null;
    readonly periodStart?: string | null;
    readonly periodEnd?: string | null;
    readonly openStart?: boolean;
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

/**
 * Rango de fechas de negocio con asientos del workspace (openspec add-financial-periods: cobertura retroactiva de los
 * periodos). Lee `ledger.journal_entry` por el índice `(workspace_id, entry_date)` en la unidad de trabajo en curso
 * (RLS del workspace). `null` si el workspace no tiene asientos. Sin efectos.
 */
export interface LedgerActivityRangeQuery {
  getActivityRange(
    workspaceId: string,
  ): Promise<{ readonly minEntryDate: string; readonly maxEntryDate: string } | null>;
}

/**
 * Saldo inicial de una cuenta del usuario (openspec add-reconciliation, design decisión 1): Σ postings con signo
 * contable (débito +, crédito −) sobre la cuenta contable de la cuenta del usuario de sus asientos de apertura
 * (`entry_type = OPENING`) con fecha ≤ `asOf`. El asiento de apertura no tiene fila en `txn`, así que la reconciliación
 * lo lee aquí para sumarlo UNA sola vez al saldo confirmado. `null` si la cuenta no tiene saldo inicial. Sin efectos;
 * en la unidad de trabajo del llamador (RLS del workspace).
 */
export interface LedgerOpeningBalanceQuery {
  getOpeningBalance(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly asOf: string;
  }): Promise<MoneyDto | null>;
}

export const LEDGER_POSTING_PORT = Symbol.for('pf.ledger.LedgerPostingPort');
export const LEDGER_PERIOD_LOCK_PORT = Symbol.for('pf.ledger.LedgerPeriodLockPort');
export const BALANCE_QUERY = Symbol.for('pf.ledger.BalanceQuery');
export const ACCOUNT_BALANCES_QUERY = Symbol.for('pf.ledger.AccountBalancesQuery');

/** Nombre del evento publicado por el outbox (contracts/events/ledger/JournalEntryPosted.v1.schema.json). */
export const JOURNAL_ENTRY_POSTED = { eventType: 'ledger.JournalEntryPosted', eventVersion: 1 } as const;
