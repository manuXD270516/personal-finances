import type {
  CsvMapping,
  ImportCounters,
  ImportErrorGroup,
  ImportJobState,
  ImportProgress,
  ImportStatus,
  ImportWarning,
  RowIssue,
} from '../domain/index.js';

/** `ImportJob` del contrato (sin celdas del archivo ni nada que no deba viajar). */
export interface ImportJobView {
  readonly id: string;
  readonly accountId: string;
  readonly status: ImportStatus;
  readonly originalName: string | null;
  readonly fileSha256: string;
  readonly fileSizeBytes: number;
  readonly detected: { readonly encoding: string; readonly delimiter: string };
  readonly rowCount: number;
  readonly columnCount: number;
  readonly header: readonly string[];
  readonly mapping: CsvMapping | null;
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

export function toJobView(s: ImportJobState): ImportJobView {
  return {
    id: s.id,
    accountId: s.accountId,
    status: s.status,
    originalName: s.originalName,
    fileSha256: s.fileChecksum,
    fileSizeBytes: s.fileSizeBytes,
    detected: { encoding: s.encoding, delimiter: s.delimiter },
    rowCount: s.rowCount,
    columnCount: s.columnCount,
    header: s.header,
    mapping: s.mapping,
    counters: s.counters,
    progress: s.progress,
    errors: s.errors,
    warnings: s.warnings,
    approvedBy: s.approvedBy,
    approvedAt: s.approvedAt,
    completedAt: s.completedAt,
    cancelledAt: s.cancelledAt,
    cancelledBy:
      s.cancelledBy === null ? null : s.cancelledBy.type === 'USER' ? s.cancelledBy.userId : 'SYSTEM',
    expiresAt: s.expiresAt,
    createdBy: s.createdBy,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    version: s.version,
  };
}

export interface CreatedImportView extends ImportJobView {
  readonly sampleRows: readonly (readonly string[])[];
  readonly suggestedMapping: CsvMapping | null;
}

export interface MoneyView {
  readonly amount: string;
  readonly currency: string;
}

export interface PreviewSummaryView {
  readonly counts: {
    readonly rows: number;
    readonly new: number;
    readonly alreadyImported: number;
    readonly probableDuplicates: number;
    readonly invalid: number;
    readonly pendingDecisions: number;
    readonly toCreate: number;
    readonly skipped: number;
    readonly excluded: number;
  };
  readonly outflows: MoneyView;
  readonly inflows: MoneyView;
  readonly currentBalance: MoneyView;
  readonly resultingBalance: MoneyView;
}

export interface PreviewCandidateView {
  readonly transactionId: string;
  readonly kind: string | null;
  readonly date: string | null;
  readonly amount: MoneyView | null;
  readonly description: string | null;
}

export interface PreviewRowView {
  readonly id: string;
  readonly lineNumber: number;
  readonly date: string | null;
  readonly description: string | null;
  readonly amount: MoneyView | null;
  readonly direction: 'IN' | 'OUT' | null;
  readonly classification: string;
  readonly decision: string | null;
  readonly issues: readonly RowIssue[];
  readonly candidate: PreviewCandidateView | null;
  readonly transactionId: string | null;
  readonly failure: { readonly code: string } | null;
}

export interface PreviewView {
  readonly summary: PreviewSummaryView;
  readonly rows: readonly PreviewRowView[];
  readonly nextCursor: number | null;
}
