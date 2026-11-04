import type { LifecyclePort } from '@pf/audit/contracts';
import type {
  ClassificationProposal,
  CsvDelimiter,
  CsvEncoding,
  CsvRecord,
  Decision,
  ImportFailure,
  MappingProfileVersion,
  ParsedStatement,
  SniffResult,
  OccurrenceCandidateEntry,
  RowCandidate,
  RowIssue,
  RowKind,
  StatementFormat,
} from '../../domain/index.js';

/**
 * Puertos del pipeline de Phase 6 (openspec add-import-pipeline, design § Puertos que consume). Son estructurales:
 * reproducen el contrato público del contexto dueño sin importar su paquete (la composición de `apps/api` los
 * satisface con el servicio real y el compilador verifica la compatibilidad).
 */

// ───────────────────────────────────────────────────────────── DOCUMENTS (add-document-attachments)

export interface DocumentForImport {
  readonly documentId: string;
  /** `AVAILABLE`, `PENDING_UPLOAD`, … (el contrato de DOCUMENTS). */
  readonly status: string;
  /** `IMPORT_SOURCE`, `RECEIPT`, … */
  readonly purpose: string;
  readonly detectedFormat: string | null;
  readonly sizeBytes: number;
  /** SHA-256 hexadecimal. */
  readonly sha256: string;
  readonly originalName: string;
}

/**
 * `DocumentQuery.getForProcessing` + `DocumentContentReader.open` + `AttachmentCommand.link`. `readBytes` agota el flujo
 * verificado por bloque con un tope (el documento ya fue acotado por DOCUMENTS; el tope protege la memoria).
 */
export interface DocumentSourcePort {
  getForProcessing(workspaceId: string, documentId: string): Promise<DocumentForImport | null>;
  readBytes(workspaceId: string, documentId: string, maxBytes: number): Promise<Uint8Array>;
  /** En la unidad de trabajo del llamador; idempotente. */
  linkToImport(input: {
    readonly workspaceId: string;
    readonly documentId: string;
    readonly importJobId: string;
    readonly actorUserId: string;
  }): Promise<void>;
}

// ───────────────────────────────────────────────────────────── RULES (add-rule-engine)

export interface RuleOrigin {
  readonly ruleId: string;
  readonly ruleVersion: number;
}

export interface RuleSubject {
  readonly ref: string;
  readonly kind: 'INCOME' | 'EXPENSE' | 'REFUND';
  readonly accountId: string;
  readonly date: string;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly description: string | null;
  readonly counterpartyId: string | null;
  readonly counterpartyOrigin: 'USER' | 'ALIAS' | null;
  readonly categoryId: string | null;
  readonly tagIds: readonly string[];
  readonly externalSource: string | null;
  readonly customFields: readonly { readonly fieldId: string; readonly value: string | boolean }[];
  readonly splitCount: number;
  readonly notes?: string | null;
}

export interface RuleOutcome {
  readonly ref: string;
  readonly category: { readonly categoryId: string; readonly origin: RuleOrigin } | null;
  readonly counterparty: { readonly counterpartyId: string; readonly origin: RuleOrigin } | null;
  readonly addTags: readonly { readonly tagId: string; readonly origin: RuleOrigin }[];
  readonly removeTags: readonly { readonly tagId: string; readonly origin: RuleOrigin }[];
  readonly description: { readonly text: string; readonly origin: RuleOrigin } | null;
  readonly appendNotes: readonly { readonly text: string; readonly origin: RuleOrigin }[];
  readonly markForReview: RuleOrigin | null;
  readonly exclude: RuleOrigin | null;
  readonly matched: readonly RuleOrigin[];
}

/** `RuleEvaluationQuery.evaluate` con `trigger = IMPORT` y `mode = FILL_EMPTY` (hasta 5 000 sujetos por llamada). */
export interface RulesEvaluationPort {
  evaluate(input: {
    readonly workspaceId: string;
    readonly subjects: readonly RuleSubject[];
  }): Promise<readonly RuleOutcome[]>;
}

/** Contraparte por alias y categoría por defecto (CLASSIFICATION). */
export interface CounterpartyResolverPort {
  /** Texto de descripción ⇒ id de la contraparte cuyo alias coincide (o `null`). */
  resolveAliases(
    workspaceId: string,
    descriptions: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>>;
  /** Contraparte ⇒ categoría por defecto (si tiene). */
  defaultCategories(
    workspaceId: string,
    counterpartyIds: readonly string[],
  ): Promise<ReadonlyMap<string, string | null>>;
}

// ───────────────────────────────────────────────────────────── COMMITMENTS

export interface OccurrenceMatchRow {
  readonly rowRef: string;
  readonly kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  readonly accountId: string;
  readonly toAccountId?: string | null;
  readonly amount: { readonly amount: string; readonly currency: string };
  readonly businessDate: string;
  readonly counterpartyId?: string | null;
}

/** `OccurrenceMatchCandidatesQuery.findCandidates` (≤ 500 filas por llamada). */
export interface OccurrenceMatchingPort {
  findCandidates(input: {
    readonly workspaceId: string;
    readonly rows: readonly OccurrenceMatchRow[];
  }): Promise<
    readonly { readonly rowRef: string; readonly candidates: readonly OccurrenceCandidateEntry[] }[]
  >;
}

/** `OccurrenceLinkPort.link` con `matchedBy = USER_LINK` (D121: solo con confirmación del usuario). */
export interface OccurrenceLinkingPort {
  link(input: {
    readonly workspaceId: string;
    readonly occurrenceId: string;
    readonly transactionId: string;
    readonly userId: string;
  }): Promise<void>;
}

/** Institución de la cuenta (ACCOUNTS `GetAccount`). */
export interface InstitutionOfAccountPort {
  institutionOf(workspaceId: string, accountId: string): Promise<string | null>;
  /** Últimos 4 caracteres del número de cuenta registrados (ACCOUNTS); verifica el extracto PDF (D353). */
  accountNumberLast4Of?(workspaceId: string, accountId: string): Promise<string | null>;
}

// ───────────────────────────────────────────────────────────── repositorios nuevos

export interface StoredProfileVersion extends MappingProfileVersion {
  /** `created_at` de la versión (el perfil vigente se ordena por la más reciente). */
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

export interface MappingProfileRepository {
  /** Inserta una versión nueva (inmutable). */
  insertVersion(version: MappingProfileVersion): Promise<void>;
  /** Todas las versiones del perfil, ascendentes; `[]` si no existe. */
  versionsOf(workspaceId: string, profileId: string): Promise<readonly StoredProfileVersion[]>;
  /** Archiva todas las versiones del perfil. */
  archive(workspaceId: string, profileId: string, at: string): Promise<void>;
  /** Última versión de cada perfil vigente (no archivado) del formato, de la cuenta o de la institución. */
  latestForMatching(
    workspaceId: string,
    input: {
      readonly accountId: string;
      readonly institutionId: string | null;
      readonly format: StatementFormat;
    },
  ): Promise<readonly StoredProfileVersion[]>;
  /** Última versión de cada perfil, filtrable; paginado por `(updated_at DESC, id)`. */
  list(
    workspaceId: string,
    filter: {
      readonly institutionId?: string | undefined;
      readonly accountId?: string | undefined;
      readonly format?: StatementFormat | undefined;
      readonly includeArchived: boolean;
      readonly limit: number;
      readonly after?: readonly [string, string] | undefined;
    },
  ): Promise<readonly StoredProfileVersion[]>;
}

// ───────────────────────────────────────────────────────────── staging (filas nuevas)

/** Fila para insertar en el staging durante la lectura (por bloques, idempotente por `(job, row_number)`). */
export interface StagedInsert {
  readonly id: string;
  readonly rowNumber: number;
  /** Celdas crudas (CSV/XLSX); `[]` en los formatos autodescritos. */
  readonly raw: readonly string[];
  /** Solo los formatos autodescritos traen la normalización ya hecha. */
  readonly record?: {
    readonly bookingDate: string | null;
    readonly bookingTime: string | null;
    readonly valueDate: string | null;
    /** Con signo (salida negativa). */
    readonly signedAmount: string | null;
    readonly currency: string | null;
    readonly description: string | null;
    readonly externalId: string | null;
    readonly reference: string | null;
    readonly counterpartyText: string | null;
    readonly runningBalance: string | null;
    readonly issues: readonly RowIssue[];
  };
}

/** Resultado de las etapas para una fila (se escribe en bloque). */
export interface PipelineRowResult {
  readonly id: string;
  readonly bookingDate: string | null;
  readonly bookingTime: string | null;
  readonly valueDate: string | null;
  /** Positivo, escala de la moneda. */
  readonly amount: string | null;
  readonly currency: string;
  readonly direction: 'IN' | 'OUT' | null;
  readonly description: string | null;
  readonly externalId: string | null;
  readonly reference: string | null;
  readonly counterpartyText: string | null;
  readonly runningBalance: string | null;
  readonly occurrenceIndex: number | null;
  readonly fingerprint: string | null;
  readonly classification: 'NEW' | 'DUPLICATE_EXACT' | 'DUPLICATE_PROBABLE' | 'INVALID';
  readonly decision: Decision | null;
  readonly issues: readonly RowIssue[];
  readonly matchedTransactionId: string | null;
  readonly proposal: ClassificationProposal | null;
  readonly candidates: readonly RowCandidate[];
  readonly occurrenceCandidates: readonly OccurrenceCandidateEntry[];
  readonly duplicateOfRow: number | null;
  readonly decidedScore: string | null;
  readonly warnings: readonly RowIssue[];
  /** Tipo propuesto por la normalización (gasto/ingreso por la dirección). */
  readonly kind: RowKind | null;
}

export interface PreviewFilter {
  readonly classification?: 'NEW' | 'DUPLICATE_EXACT' | 'DUPLICATE_PROBABLE' | 'INVALID' | undefined;
  /** Filas sin categoría efectiva (ni propuesta ni edición). */
  readonly needsCategory?: boolean | undefined;
  readonly ruleId?: string | undefined;
  /** Confianza del candidato de duplicado. */
  readonly candidateConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | undefined;
  readonly decision?: Decision | undefined;
}

export interface BulkEditSet {
  readonly categoryId?: string | null | undefined;
  readonly tagIds?: readonly string[] | undefined;
  readonly counterpartyId?: string | null | undefined;
  readonly decision?: Decision | undefined;
}

export interface RevertLink {
  readonly linkId: string;
  readonly transactionId: string;
  readonly rowId: string | null;
  readonly lineNumber: number | null;
  readonly bookingDate: string | null;
  readonly kind: 'CREATED' | 'SKIPPED_AS_DUPLICATE';
}

export type LifecycleRecorder = LifecyclePort;

// ───────────────────────────────────────────────────────────── lectores de formatos

export type ReadOutcome =
  /** OFX, QIF y JSON: registros ya normalizados por el lector. */
  | { readonly kind: 'RECORDS'; readonly parsed: ParsedStatement }
  /** CSV y XLSX: celdas crudas que se normalizan con el mapeo del perfil. */
  | {
      readonly kind: 'TABLE';
      readonly records: readonly CsvRecord[];
      readonly columnCount: number;
      readonly encoding: CsvEncoding;
      readonly delimiter: CsvDelimiter;
    }
  | { readonly kind: 'FAILED'; readonly failure: ImportFailure };

export interface ReadOptions {
  readonly timeZone: string;
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly accountCurrency: string;
  readonly currencyScale: number;
  readonly dateOrder?: 'DMY' | 'MDY' | undefined;
  readonly sheet?: string | undefined;
}

/** Lectores por formato (OFX, QIF, JSON, XLSX, CSV): puro, sin base de datos; lo cumple `infrastructure/readers`. */
export interface StatementReaderPort {
  /** Detecta el formato por contenido, nunca por nombre; `null` si no es importable (PDF, binario). */
  sniff(head: Uint8Array): SniffResult | null;
  read(format: StatementFormat, bytes: Uint8Array, options: ReadOptions): ReadOutcome;
}

// ───────────────────────────────────────────────────────────── catálogo de referencias (CLASSIFICATION)

/**
 * Validación de las referencias que el usuario edita en la vista previa (categoría activa del tipo correcto,
 * contraparte y etiquetas existentes). Lanza `VALIDATION_FAILED`/`REFERENCE_NOT_FOUND` con el puntero del campo.
 */
export interface ReferenceCatalogPort {
  assertCategory(
    workspaceId: string,
    categoryId: string,
    kind: 'EXPENSE' | 'INCOME' | null,
    pointer: string,
  ): Promise<void>;
  assertCounterparty(workspaceId: string, counterpartyId: string, pointer: string): Promise<void>;
  assertTags(workspaceId: string, tagIds: readonly string[], pointer: string): Promise<void>;
}
