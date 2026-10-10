import type { AuditPort } from '@pf/audit/contracts';
import type { Clock } from '@pf/shared-kernel';
import type {
  DuplicateCandidatesQuery,
  ImportedTransactionsCommand,
  TransactionStatusQuery,
} from '@pf/transactions/contracts';
import type {
  Classification,
  ClosedPeriodRange,
  CsvMapping,
  Decision,
  Direction,
  ImportJob,
  ImportStatus,
  RowIssue,
} from '../../domain/index.js';

/**
 * Puertos de IMPORTS (hexagonal). Los repositorios los implementa `infrastructure/` sobre PostgreSQL; los de otros
 * contextos son contratos públicos (`@pf/transactions/contracts`) o adaptadores de la composición de `apps/api`.
 */

/** Transacción PG con `SET LOCAL app.workspace_id` (RLS, ADR-0023); reutiliza la del llamador si existe. */
export interface UnitOfWork {
  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
  /** Transacción NUEVA e independiente aunque haya una en curso (un lote = una transacción dentro del consumidor). */
  runDetached<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
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

/** Zona horaria del workspace (IDENTITY; adapter en la composición). */
export interface CalendarPort {
  timeZoneOf(workspaceId: string): Promise<string>;
}

/** Periodos cerrados del workspace (PLANNING `PeriodQuery`; adapter en la composición). */
export interface ClosedPeriodsPort {
  listClosed(workspaceId: string): Promise<readonly ClosedPeriodRange[]>;
}

export interface AccountView {
  readonly accountId: string;
  readonly currency: string;
  readonly nature: 'ASSET' | 'LIABILITY';
  readonly status: string;
}

/** Cuentas (ACCOUNTS `AccountsQueryPort`; adapter en la composición). */
export interface AccountsPort {
  /** `null` si la cuenta no existe en el workspace. Lectura sin validar el estado. */
  getAccount(workspaceId: string, accountId: string): Promise<AccountView | null>;
  /** Cuenta existente, activa y no archivada; si no, `REFERENCE_NOT_FOUND`, `ACCOUNT_CLOSED` o `ACCOUNT_ARCHIVED`. */
  assertActive(workspaceId: string, accountId: string): Promise<AccountView>;
}

/** Saldo PRESENTADO de la cuenta (deuda positiva en pasivos); cero si la cuenta no tiene asientos (LEDGER). */
export interface BalancePort {
  presentedBalance(workspaceId: string, accountId: string): Promise<string | null>;
}

export interface CurrencyCatalogPort {
  scaleOf(code: string): Promise<number | null>;
}

// ───────────────────────────────────────────────────────────── repositorios

export interface ImportJobFilter {
  readonly accountId?: string | undefined;
  readonly status?: ImportStatus | undefined;
  readonly limit: number;
  /** Cursor keyset por `(created_at DESC, id DESC)`. */
  readonly after?: readonly [string, string] | undefined;
}

export interface ImportJobRepository {
  insert(job: ImportJob): Promise<void>;
  findById(
    workspaceId: string,
    id: string,
    options?: { readonly lock?: 'update' },
  ): Promise<ImportJob | null>;
  /** Control optimista por `persistedVersion`; `false` si cambió. */
  save(job: ImportJob): Promise<boolean>;
  list(workspaceId: string, filter: ImportJobFilter): Promise<ImportJob[]>;
  /** Importación terminada más reciente de la cuenta con el mismo checksum (aviso de archivo ya importado). */
  findPreviousImported(
    workspaceId: string,
    accountId: string,
    fileChecksum: string,
  ): Promise<{ readonly id: string; readonly completedAt: string } | null>;
  /** Mapeo del último import de la cuenta que lo tiene (sugerencia al subir otro). */
  lastMapping(workspaceId: string, accountId: string): Promise<CsvMapping | null>;
  /** Jobs `AWAITING_*` con `expires_at ≤ now`. */
  expiredReviews(workspaceId: string, now: string, limit: number): Promise<string[]>;
  /** Jobs terminados o cancelados antes de `cutoff` con filas de staging. */
  purgeable(workspaceId: string, cutoff: string, limit: number): Promise<string[]>;
}

export interface StagedRow {
  readonly id: string;
  readonly rowNumber: number;
  readonly raw: readonly string[];
  readonly bookingDate: string | null;
  /** Positivo, escala de la moneda. */
  readonly amount: string | null;
  readonly currency: string | null;
  readonly direction: Direction | null;
  readonly description: string | null;
  readonly occurrenceIndex: number | null;
  /** Hexadecimal. */
  readonly fingerprint: string | null;
  readonly classification: Classification | null;
  readonly decision: Decision | null;
  readonly issues: readonly RowIssue[];
  readonly matchedTransactionId: string | null;
  readonly transactionId: string | null;
  readonly batchNo: number | null;
  readonly batchError: { readonly code: string } | null;
}

/** Resultado de normalizar y clasificar una fila de datos (se escribe en el staging al aplicar el mapeo). */
export interface RowNormalization {
  readonly id: string;
  readonly bookingDate: string | null;
  readonly amount: string | null;
  readonly currency: string;
  readonly direction: Direction | null;
  readonly description: string | null;
  readonly occurrenceIndex: number | null;
  readonly fingerprint: string | null;
  readonly classification: Classification;
  readonly decision: Decision | null;
  readonly issues: readonly RowIssue[];
  readonly matchedTransactionId: string | null;
}

export interface StagingSummary {
  readonly rows: number;
  readonly byClassification: Readonly<Record<Classification, number>>;
  readonly pendingDecisions: number;
  /** Filas por decisión efectiva. */
  readonly toCreate: number;
  readonly skipped: number;
  readonly excluded: number;
  /** Σ de las filas a crear, por sentido y moneda (strings decimales exactos). */
  readonly outflows: string;
  readonly inflows: string;
  readonly created: number;
  readonly failed: number;
}

export interface StagingRepository {
  insertRaw(
    workspaceId: string,
    jobId: string,
    rows: readonly { readonly id: string; readonly rowNumber: number; readonly raw: readonly string[] }[],
  ): Promise<void>;
  /** Celdas y estado previo de TODAS las filas del job por línea (reaplicar el mapeo). */
  loadForMapping(
    workspaceId: string,
    jobId: string,
  ): Promise<
    readonly {
      readonly id: string;
      readonly rowNumber: number;
      readonly raw: readonly string[];
      readonly fingerprint: string | null;
      readonly classification: Classification | null;
      readonly decision: Decision | null;
    }[]
  >;
  /** Escribe la normalización de las filas de datos y deja sin clasificar (NULL) las de `resetIds`. */
  applyNormalization(
    workspaceId: string,
    jobId: string,
    items: readonly RowNormalization[],
    resetIds: readonly string[],
  ): Promise<void>;
  summary(workspaceId: string, jobId: string): Promise<StagingSummary>;
  page(
    workspaceId: string,
    jobId: string,
    options: {
      readonly classification?: Classification | undefined;
      readonly afterRowNumber?: number | undefined;
      readonly limit: number;
    },
  ): Promise<StagedRow[]>;
  find(workspaceId: string, jobId: string, rowId: string): Promise<StagedRow | null>;
  setDecision(workspaceId: string, jobId: string, rowId: string, decision: Decision): Promise<void>;
  /** Filas con decisión `CREATE` (nuevas y posibles duplicados decididos a crear), para repartir en lotes. */
  rowsToCreate(
    workspaceId: string,
    jobId: string,
  ): Promise<
    readonly { readonly rowId: string; readonly bookingDate: string; readonly lineNumber: number }[]
  >;
  assignBatches(
    workspaceId: string,
    jobId: string,
    plan: readonly { readonly batchNo: number; readonly rowIds: readonly string[] }[],
  ): Promise<void>;
  /** Posibles duplicados omitidos: huella y movimiento existente al que se vinculan. */
  skippedProbableRows(
    workspaceId: string,
    jobId: string,
  ): Promise<
    readonly {
      readonly rowId: string;
      readonly fingerprint: string;
      readonly matchedTransactionId: string;
    }[]
  >;
  /** Lotes con filas sin transacción y sin fallo registrado, en orden (lo que falta persistir). */
  pendingBatchNumbers(workspaceId: string, jobId: string): Promise<number[]>;
  loadBatch(workspaceId: string, jobId: string, batchNo: number): Promise<StagedRow[]>;
  markPersisted(
    workspaceId: string,
    items: readonly { readonly rowId: string; readonly transactionId: string }[],
  ): Promise<void>;
  markBatchFailed(
    workspaceId: string,
    jobId: string,
    batchNo: number,
    error: { readonly code: string },
  ): Promise<void>;
  /** Reintento: limpia el fallo de las filas sin transacción para volver a procesarlas. */
  clearFailures(workspaceId: string, jobId: string): Promise<void>;
  failures(
    workspaceId: string,
    jobId: string,
    limit: number,
  ): Promise<readonly { readonly code: string; readonly count: number; readonly lines: readonly number[] }[]>;
  /** Rango de fechas de las filas persistidas/a crear, para `ImportCompleted`. */
  dateRange(
    workspaceId: string,
    jobId: string,
  ): Promise<{ readonly from: string; readonly to: string } | null>;
  deleteAll(workspaceId: string, jobId: string): Promise<number>;
}

export interface RowLinkInsert {
  readonly id: string;
  readonly accountId: string;
  readonly fingerprint: string;
  readonly transactionId: string;
  readonly stagedTransactionId: string | null;
  readonly kind: 'CREATED' | 'SKIPPED_AS_DUPLICATE';
}

export interface RowLinkRepository {
  /** Vínculos ACTIVOS de la cuenta para estas huellas. */
  findActive(
    workspaceId: string,
    accountId: string,
    fingerprints: readonly string[],
  ): Promise<readonly { readonly fingerprint: string; readonly transactionId: string }[]>;
  /** `ON CONFLICT DO NOTHING` sobre el índice de vínculos activos. */
  insertMany(workspaceId: string, links: readonly RowLinkInsert[]): Promise<void>;
  supersede(
    workspaceId: string,
    accountId: string,
    fingerprints: readonly string[],
    now: string,
  ): Promise<void>;
  /** Cuáles de estas transacciones ya están vinculadas a alguna fila ACTIVA de la cuenta. */
  linkedTransactionIds(
    workspaceId: string,
    accountId: string,
    transactionIds: readonly string[],
  ): Promise<ReadonlySet<string>>;
}

/** Puertos hacia otros contextos que coinciden con sus contratos públicos. */
export type ImportedTransactionsPort = ImportedTransactionsCommand;
export type DuplicateCandidatesPort = DuplicateCandidatesQuery;
export type TransactionStatusPort = TransactionStatusQuery;

export interface ImportsSettings {
  /** `IMPORT_CSV_MAX_BYTES`. */
  readonly maxBytes: number;
  /** `IMPORT_CSV_MAX_ROWS`. */
  readonly maxRows: number;
  /** `IMPORT_CSV_MAX_COLUMNS`. */
  readonly maxColumns: number;
  /** `IMPORT_PERSIST_BATCH_SIZE`. */
  readonly batchSize: number;
  /** `IMPORT_REVIEW_TTL` en ms. */
  readonly reviewTtlMs: number;
  /** `IMPORT_STAGING_RETENTION` en ms. */
  readonly stagingRetentionMs: number;
  /** `IMPORT_FUTURE_DATE_TOLERANCE_DAYS`. */
  readonly futureToleranceDays: number;
  /** Ventana de detección de duplicados (`transactions/duplicate-detection`, ±3 días). */
  readonly duplicateWindowDays: number;
}

export interface ImportsDeps {
  readonly uow: UnitOfWork;
  readonly jobs: ImportJobRepository;
  readonly staging: StagingRepository;
  readonly links: RowLinkRepository;
  readonly accounts: AccountsPort;
  readonly balances: BalancePort;
  readonly currencies: CurrencyCatalogPort;
  readonly calendar: CalendarPort;
  readonly periods: ClosedPeriodsPort;
  readonly imported: ImportedTransactionsPort;
  readonly duplicates: DuplicateCandidatesPort;
  readonly statuses: TransactionStatusPort;
  readonly audit: AuditPort;
  readonly outbox: OutboxPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly settings: ImportsSettings;
}
