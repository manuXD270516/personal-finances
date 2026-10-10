/**
 * Tipos del contrato `finance-api.v1.yaml` (tag Imports, openspec add-basic-csv-import). Los montos son `Money`
 * (strings decimales, INV-001); los textos que vienen del archivo (encabezado, celdas, descripciones, nombre del
 * archivo) son DATOS NO CONFIABLES: la UI los muestra siempre como texto (React los escapa) y nunca como HTML, enlace
 * o fórmula.
 */
import type { Money } from '../common/types';

export type ImportJobStatus =
  | 'AWAITING_MAPPING'
  | 'AWAITING_REVIEW'
  | 'APPROVED'
  | 'PERSISTING'
  | 'COMPLETED'
  | 'PARTIALLY_FAILED'
  | 'COMPLETED_WITH_ERRORS'
  | 'CANCELLED';

export const JOB_STATUSES: readonly ImportJobStatus[] = [
  'AWAITING_MAPPING',
  'AWAITING_REVIEW',
  'APPROVED',
  'PERSISTING',
  'COMPLETED',
  'PARTIALLY_FAILED',
  'COMPLETED_WITH_ERRORS',
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
