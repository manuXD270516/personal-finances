import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { Clock } from '@pf/shared-kernel';
import type {
  DuplicateCandidatesQuery,
  ImportedConversionsCommand,
  ImportedTransactionsCommand,
  TransactionStatusQuery,
} from '@pf/transactions/contracts';
import type {
  Classification,
  ClassificationProposal,
  ClosedPeriodRange,
  CsvMapping,
  Decision,
  Direction,
  ImportJob,
  ImportStatus,
  OccurrenceCandidateEntry,
  OccurrenceLinkState,
  RowCandidate,
  RowEdits,
  RowIssue,
  RowKind,
} from '../../domain/index.js';
import type { PdfStatementReader } from '../pdf/pdf-statement-reader.js';
import type {
  BulkEditSet,
  CounterpartyResolverPort,
  DocumentSourcePort,
  InstitutionOfAccountPort,
  MappingProfileRepository,
  OccurrenceLinkingPort,
  OccurrenceMatchingPort,
  PipelineRowResult,
  PreviewFilter,
  ReferenceCatalogPort,
  RevertLink,
  RulesEvaluationPort,
  StagedInsert,
  StatementReaderPort,
} from './pipeline.js';

export * from './pipeline.js';
export * from '../pdf/ports.js';

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
  presentedBalance(workspaceId: string, accountId: string, asOf?: string): Promise<string | null>;
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
  // ── Phase 6 (add-import-pipeline)
  readonly externalId: string | null;
  readonly bookingTime: string | null;
  readonly valueDate: string | null;
  /** Con signo, como lo declara el archivo. */
  readonly runningBalance: string | null;
  readonly reference: string | null;
  readonly counterpartyText: string | null;
  readonly kind: RowKind | null;
  readonly proposal: ClassificationProposal | null;
  readonly edits: RowEdits;
  readonly candidates: readonly RowCandidate[];
  readonly occurrenceCandidates: readonly OccurrenceCandidateEntry[];
  readonly occurrenceLink: OccurrenceLinkState | null;
  readonly duplicateOfRow: number | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decidedScore: string | null;
  readonly warnings: readonly RowIssue[];
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
    options: PreviewFilter & {
      readonly afterRowNumber?: number | undefined;
      readonly limit: number;
    },
  ): Promise<StagedRow[]>;

  // ── Phase 6: lectura por bloques y etapas del worker (todas idempotentes y reanudables)
  /** Inserta filas del archivo en el staging; `ON CONFLICT (job, row_number) DO NOTHING` (reanudación sin duplicar). */
  insertRecords(workspaceId: string, jobId: string, rows: readonly StagedInsert[]): Promise<void>;
  countRows(workspaceId: string, jobId: string): Promise<number>;
  /** TODAS las filas del job (celdas crudas incluidas) por línea; ≤ `IMPORT_MAX_ROWS` (+ encabezado). */
  loadAll(workspaceId: string, jobId: string): Promise<StagedRow[]>;
  /** Escribe el resultado de las etapas para las filas de datos y deja sin clasificar las de `resetIds`. */
  applyPipeline(
    workspaceId: string,
    jobId: string,
    items: readonly PipelineRowResult[],
    resetIds: readonly string[],
  ): Promise<void>;
  /** Reescribe solo la propuesta de clasificación (y sus advertencias) de las filas dadas; no toca las ediciones. */
  applyProposals(
    workspaceId: string,
    jobId: string,
    items: readonly {
      readonly id: string;
      readonly proposal: ClassificationProposal | null;
      readonly warnings: readonly RowIssue[];
    }[],
  ): Promise<void>;
  /** Edición de una fila: ediciones, tipo, decisión (con autor y momento) y vínculo con la ocurrencia. */
  applyEdit(
    workspaceId: string,
    jobId: string,
    rowId: string,
    change: {
      readonly edits: RowEdits;
      readonly kind: RowKind | null;
      readonly decision?: Decision | undefined;
      readonly decidedBy: string;
      readonly decidedAt: string;
      readonly occurrenceLink: OccurrenceLinkState | null;
      /** Candidato elegido al omitir vinculando (por omisión, el asignado). */
      readonly matchedTransactionId?: string | undefined;
      /** Puntaje del candidato vinculado al decidir (auditoría). */
      readonly decidedScore?: string | null | undefined;
    },
  ): Promise<void>;
  /** Mismo cambio para todas las filas del filtro, en una sentencia; devuelve las filas actualizadas. */
  bulkEdit(
    workspaceId: string,
    jobId: string,
    filter: PreviewFilter,
    set: BulkEditSet,
    by: { readonly userId: string; readonly at: string },
  ): Promise<number>;
  /** Confirma la candidata única de confianza alta (no ambigua) de cada fila sin vínculo; devuelve cuántas. */
  confirmHighConfidenceMatches(workspaceId: string, jobId: string): Promise<number>;
  /** Resultado del vínculo con la ocurrencia tras persistir. */
  markOccurrenceOutcome(
    workspaceId: string,
    items: readonly { readonly rowId: string; readonly outcome: 'LINKED' | 'SKIPPED' }[],
  ): Promise<void>;
  /** Cobertura de reglas de las transacciones creadas por el job (`category_origin = RULE`, D334). */
  rulesCoverage(
    workspaceId: string,
    jobId: string,
  ): Promise<{ readonly created: number; readonly byRule: number; readonly withoutCategory: number }>;
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
      readonly lineNumber: number;
      readonly decidedScore: string | null;
      readonly externalId: string | null;
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
  /** Job que creó el vínculo (deshacer los supera). */
  readonly importJobId?: string | null;
  /** Identificador externo del banco (idempotencia entre formatos y rangos solapados). */
  readonly externalRef?: { readonly namespace: string; readonly id: string } | null;
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
  /**
   * Cuáles de estas transacciones ya fueron FUSIONADAS con otra fila (vínculo `SKIPPED_AS_DUPLICATE` activo): un
   * movimiento existente se empareja con una sola fila. Las creadas por un import anterior SÍ son candidatas (extractos
   * solapados de varios formatos, TC-IMPORTS-PIPELINE-055).
   */
  mergedTransactionIds(
    workspaceId: string,
    accountId: string,
    transactionIds: readonly string[],
  ): Promise<ReadonlySet<string>>;
  /** Vínculos ACTIVOS de la cuenta por identificador externo del banco (con el formato que los creó). */
  findActiveByExternal(
    workspaceId: string,
    accountId: string,
    externalIds: readonly string[],
  ): Promise<readonly { readonly externalId: string; readonly transactionId: string }[]>;
  /** Vínculos ACTIVOS creados por el job (deshacer): transacción, fila y fecha si el staging aún existe. */
  activeByJob(workspaceId: string, jobId: string): Promise<readonly RevertLink[]>;
  /** Supera los vínculos activos del job (creados y fusionados) al deshacer, salvo los de las transacciones que siguen vivas. */
  supersedeByJob(
    workspaceId: string,
    jobId: string,
    now: string,
    keepTransactionIds?: readonly string[],
  ): Promise<number>;
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
  // ── Phase 6
  /** `IMPORT_PROCESSING_TIMEOUT` en ms (por omisión `PT10M`). */
  readonly processingTimeoutMs: number;
  /** `IMPORT_DUPLICATE_HIGH_SCORE` / `IMPORT_DUPLICATE_LOW_SCORE` (texto decimal de 4 decimales). */
  readonly duplicateHighScore: string;
  readonly duplicateLowScore: string;
  /** Tope de bytes de un documento a importar (`DOCUMENT_IMPORT_SOURCE_MAX_BYTES`). */
  readonly documentMaxBytes: number;
  // ── add-pdf-statement-parser (`IMPORT_PDF_*`)
  readonly pdfExtractionTimeoutMs: number;
  readonly pdfMaxPages: number;
  readonly pdfMaxTextItems: number;
  readonly pdfMaxTextChars: number;
  readonly pdfWorkerMaxOldMb: number;
  readonly pdfMinPageTextChars: number;
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
  // ── Phase 6 (add-import-pipeline)
  readonly lifecycle: LifecyclePort;
  /** Recorrido del job (`GET .../imports/{id}/lifecycle`); ausente en los tests de aplicación. */
  readonly lifecycleQuery?: LifecycleQuery;
  readonly profiles: MappingProfileRepository;
  readonly documents: DocumentSourcePort;
  readonly rules: RulesEvaluationPort;
  readonly counterparties: CounterpartyResolverPort;
  readonly matching: OccurrenceMatchingPort;
  readonly occurrenceLinks: OccurrenceLinkingPort;
  readonly institutions: InstitutionOfAccountPort;
  readonly conversions: ImportedConversionsPort;
  readonly readers: StatementReaderPort;
  readonly refs: ReferenceCatalogPort;
  /** Lector de extractos PDF (add-pdf-statement-parser); ausente ⇒ un PDF se rechaza como formato no importable. */
  readonly pdf?: PdfStatementReader;
}

/** `ImportedConversionsCommand.recordBatch` (lo implementa TRANSACTIONS; el mismo comando usa `add-banking-providers`). */
export type ImportedConversionsPort = ImportedConversionsCommand;
