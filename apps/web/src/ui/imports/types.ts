/**
 * Tipos del contrato `finance-api.v1.yaml` (tag Imports, openspec add-basic-csv-import). Los montos son `Money`
 * (strings decimales, INV-001); los textos que vienen del archivo (encabezado, celdas, descripciones, nombre del
 * archivo) son DATOS NO CONFIABLES: la UI los muestra siempre como texto (React los escapa) y nunca como HTML, enlace
 * o fórmula.
 */
import type { Money } from '../common/types';

export type ImportJobStatus =
  | 'UPLOADED'
  | 'PROCESSING'
  | 'PARSE_FAILED'
  | 'AWAITING_MAPPING'
  | 'AWAITING_REVIEW'
  | 'APPROVED'
  | 'PERSISTING'
  | 'COMPLETED'
  | 'PARTIALLY_FAILED'
  | 'COMPLETED_WITH_DIFFERENCE'
  | 'COMPLETED_WITH_ERRORS'
  | 'REVERTING'
  | 'ROLLED_BACK'
  | 'PARTIALLY_ROLLED_BACK'
  | 'CANCELLED';

export const JOB_STATUSES: readonly ImportJobStatus[] = [
  'UPLOADED',
  'PROCESSING',
  'PARSE_FAILED',
  'AWAITING_MAPPING',
  'AWAITING_REVIEW',
  'APPROVED',
  'PERSISTING',
  'COMPLETED',
  'PARTIALLY_FAILED',
  'COMPLETED_WITH_DIFFERENCE',
  'COMPLETED_WITH_ERRORS',
  'REVERTING',
  'ROLLED_BACK',
  'PARTIALLY_ROLLED_BACK',
  'CANCELLED',
];

export type ImportRowClassification = 'NEW' | 'DUPLICATE_EXACT' | 'DUPLICATE_PROBABLE' | 'INVALID';
export const ROW_CLASSIFICATIONS: readonly ImportRowClassification[] = [
  'NEW',
  'DUPLICATE_EXACT',
  'DUPLICATE_PROBABLE',
  'INVALID',
];

export type ImportRowDecision = 'CREATE' | 'SKIP' | 'EXCLUDE';

export type ImportDateFormat = 'dd/MM/yyyy' | 'dd-MM-yyyy' | 'dd/MM/yy' | 'yyyy-MM-dd' | 'MM/dd/yyyy';
export const DATE_FORMATS: readonly ImportDateFormat[] = [
  'dd/MM/yyyy',
  'dd-MM-yyyy',
  'dd/MM/yy',
  'yyyy-MM-dd',
  'MM/dd/yyyy',
];

export type DecimalSeparator = ',' | '.';
export type SignConvention = 'NEGATIVE_IS_OUTFLOW' | 'POSITIVE_IS_OUTFLOW';

export interface ImportColumnRef {
  readonly index: number;
}
export interface ImportSignedAmountColumn {
  readonly mode: 'SIGNED';
  readonly index: number;
  readonly signConvention: SignConvention;
}
export interface ImportDebitCreditColumns {
  readonly mode: 'DEBIT_CREDIT';
  readonly debitIndex: number;
  readonly creditIndex: number;
}

/** `ImportMapping` (`imports.mapping.v1`): índices de columna base 0. */
export interface ImportMapping {
  readonly hasHeader: boolean;
  readonly skipRows?: number;
  readonly columns: {
    readonly date: ImportColumnRef;
    readonly description: ImportColumnRef;
    readonly amount: ImportSignedAmountColumn | ImportDebitCreditColumns;
  };
  readonly dateFormat: ImportDateFormat;
  readonly decimalSeparator: DecimalSeparator;
}

export interface ImportCounters {
  readonly rows: number;
  readonly newRows: number;
  readonly alreadyImported: number;
  readonly probableDuplicates: number;
  readonly invalid: number;
  readonly toCreate: number;
  readonly skipped: number;
  readonly excluded: number;
  readonly created: number;
  readonly failed: number;
}

export interface ImportProgress {
  readonly attempt: number;
  readonly batchCount: number;
  readonly batchesDone: number;
  /** Pipeline de documentos (add-import-pipeline): etapa del worker y filas procesadas. */
  readonly stage?: ImportStage | null;
  readonly processedRows?: number;
  readonly totalRows?: number;
}

export type ImportStage = 'PARSE' | 'NORMALIZE' | 'VALIDATE' | 'CLASSIFY' | 'DEDUPE' | 'MATCH';
export const IMPORT_STAGES: readonly ImportStage[] = [
  'PARSE',
  'NORMALIZE',
  'VALIDATE',
  'CLASSIFY',
  'DEDUPE',
  'MATCH',
];
export type ImportFormat = 'CSV' | 'OFX' | 'QIF' | 'JSON' | 'XLSX';

export interface ImportProfileCandidate {
  readonly profileId: string;
  readonly version: number;
  readonly name: string;
  readonly missingColumns: readonly string[];
}

export interface ImportStatement {
  readonly openingBalance?: Money | null;
  readonly closingBalance?: Money | null;
  readonly periodFrom?: string | null;
  readonly periodTo?: string | null;
}

export interface ImportReconciliationOffer {
  readonly accountId: string;
  readonly statementDate: string;
  readonly statementBalance: Money;
}

export interface ImportRevertSummary {
  readonly voided: number;
  readonly alreadyVoided: number;
  readonly blocked: number;
  readonly revertedAt: string | null;
  readonly revertedBy: string | null;
}

export interface ImportRuleCoverage {
  readonly rows: number;
  readonly classifiedByRule: number;
  readonly withoutCategory: number;
  /** Texto decimal de 4 decimales (0.7193). */
  readonly ratio: string;
}

export interface ImportFailure {
  readonly code: string;
  readonly pointer: string | null;
}

export interface ImportErrorGroup {
  readonly code: string;
  readonly count: number;
  readonly lines: readonly number[];
}

export interface ImportWarning {
  readonly code: string;
  readonly previousImportId: string;
  readonly previousImportedAt: string;
}

export interface ImportJob {
  readonly id: string;
  readonly accountId: string;
  readonly status: ImportJobStatus;
  readonly originalName: string | null;
  readonly fileSha256: string;
  readonly fileSizeBytes: number;
  readonly detected: { readonly encoding: 'utf-8' | 'windows-1252'; readonly delimiter: string };
  readonly rowCount: number;
  readonly columnCount: number;
  readonly header: readonly string[];
  readonly mapping: ImportMapping | null;
  readonly counters: ImportCounters;
  readonly progress: ImportProgress;
  readonly errors: readonly ImportErrorGroup[];
  readonly warnings: readonly ImportWarning[];
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelledBy: string | null;
  readonly expiresAt: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  // ── Pipeline de documentos: opcionales (la ruta multipart del CSV básico no los trae).
  readonly source?: string;
  readonly documentId?: string | null;
  readonly format?: ImportFormat | null;
  readonly stage?: ImportStage | null;
  readonly failure?: ImportFailure | null;
  readonly mappingProfile?: { readonly id: string; readonly version: number } | null;
  readonly profileCandidates?: readonly ImportProfileCandidate[];
  readonly missingColumns?: readonly string[];
  readonly statement?: ImportStatement | null;
  readonly statementDifference?: Money | null;
  readonly reconciliationOffer?: ImportReconciliationOffer | null;
  readonly revertSummary?: ImportRevertSummary | null;
  readonly ruleCoverage?: ImportRuleCoverage | null;
}

export interface ImportCreated extends ImportJob {
  readonly sampleRows: readonly (readonly string[])[];
  readonly suggestedMapping: ImportMapping | null;
}

export interface ImportPreviewCounts {
  readonly rows: number;
  readonly new: number;
  readonly alreadyImported: number;
  readonly probableDuplicates: number;
  readonly invalid: number;
  readonly pendingDecisions: number;
  readonly toCreate: number;
  readonly skipped: number;
  readonly excluded: number;
}

export interface ImportPreviewSummary {
  readonly counts: ImportPreviewCounts;
  readonly outflows: Money;
  readonly inflows: Money;
  readonly currentBalance: Money;
  readonly resultingBalance: Money;
}

export interface ImportMapped extends ImportJob {
  readonly previewSummary: ImportPreviewSummary;
}

export interface ImportRowIssue {
  readonly code: string;
  readonly severity: 'ERROR' | 'WARNING';
}

export interface ImportPreviewCandidate {
  readonly transactionId: string;
  readonly kind: string | null;
  readonly date: string | null;
  readonly amount: Money | null;
  readonly description: string | null;
}

export type ImportRowKind = 'EXPENSE' | 'INCOME' | 'TRANSFER' | 'CONVERSION';
export type FieldOrigin = 'ALIAS' | 'RULE' | 'DEFAULT' | 'MANUAL';
export type DuplicateConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ImportProposedField {
  /** Un id, una lista de ids o un texto. */
  readonly value: string | readonly string[] | null;
  readonly origin: FieldOrigin;
  readonly ruleId?: string | null;
  readonly ruleVersion?: number | null;
}

export interface ImportRowProposal {
  readonly categoryId?: ImportProposedField;
  readonly counterpartyId?: ImportProposedField;
  readonly tagIds?: ImportProposedField;
  readonly description?: ImportProposedField;
  readonly excluded?: boolean;
  readonly needsCategory: boolean;
}

export interface ImportRowEdits {
  readonly categoryId?: string | null;
  readonly counterpartyId?: string | null;
  readonly tagIds?: readonly string[];
  readonly description?: string | null;
  readonly note?: string | null;
}

export interface ImportDuplicateCandidate extends ImportPreviewCandidate {
  readonly score: string;
  readonly confidence: DuplicateConfidence;
  readonly signals: {
    readonly amount: string;
    readonly date: string;
    readonly description: string;
    readonly counterparty: string;
    readonly origin: string;
  };
  readonly preselected: boolean;
}

export interface ImportOccurrenceCandidate {
  readonly occurrenceId: string;
  readonly confidence: DuplicateConfidence;
  readonly dueDate: string;
  readonly expectedAmount?: Money | null;
  /** Nombre del compromiso: texto no confiable. */
  readonly label: string;
}

export interface ImportRowConversion {
  readonly counterAccountId: string;
  readonly counterAmount: Money;
  readonly fee?: Money;
  readonly quotedRate?: string;
}

export interface ImportPreviewRow {
  readonly id: string;
  readonly lineNumber: number;
  readonly date: string | null;
  readonly description: string | null;
  readonly amount: Money | null;
  readonly direction: 'IN' | 'OUT' | null;
  readonly classification: ImportRowClassification;
  readonly decision: ImportRowDecision | null;
  readonly issues: readonly ImportRowIssue[];
  readonly candidate: ImportPreviewCandidate | null;
  readonly transactionId: string | null;
  readonly failure: { readonly code: string } | null;
  // ── Pipeline de documentos (opcionales)
  readonly kind?: ImportRowKind;
  readonly externalId?: string | null;
  readonly time?: string | null;
  readonly runningBalance?: Money | null;
  readonly proposal?: ImportRowProposal | null;
  readonly edits?: ImportRowEdits | null;
  readonly candidates?: readonly ImportDuplicateCandidate[];
  readonly decidedBy?: string | null;
  readonly decidedAt?: string | null;
  readonly decidedScore?: string | null;
  readonly duplicateOfRow?: number | null;
  readonly occurrenceCandidates?: readonly ImportOccurrenceCandidate[];
  readonly occurrenceLink?: { readonly occurrenceId: string } | null;
  readonly transfer?: { readonly counterAccountId: string } | null;
  readonly conversion?: ImportRowConversion | null;
}

export interface ImportPreview {
  readonly summary: ImportPreviewSummary;
  readonly rows: readonly ImportPreviewRow[];
  readonly nextCursor: string | null;
}

export interface ImportRowDecisionResult extends ImportPreviewRow {
  readonly version: number;
  readonly counters: ImportCounters;
}

export interface ImportPage {
  readonly data: readonly ImportJob[];
  readonly page: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

// ── Perfiles de mapeo (add-import-pipeline)

export interface ImportProfileVersionInfo {
  readonly version: number;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface ImportProfile {
  readonly id: string;
  readonly name: string;
  readonly format: ImportFormat;
  readonly institutionId: string | null;
  readonly accountId: string | null;
  readonly version: number;
  readonly options: Readonly<Record<string, unknown>>;
  readonly optionsSchemaVersion: number;
  readonly archivedAt: string | null;
  readonly versions: readonly ImportProfileVersionInfo[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ImportProfilePage {
  readonly data: readonly ImportProfile[];
  readonly page: { readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface ImportRevertBlocked {
  readonly rowId: string;
  readonly lineNumber: number;
  readonly transactionId: string;
  readonly reason: string;
}

export interface ImportRevertPreview {
  readonly toVoid: number;
  readonly alreadyVoided: number;
  readonly blocked: readonly ImportRevertBlocked[];
  readonly editedAfterImport: number;
}
