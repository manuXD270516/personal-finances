import type {
  ClassificationProposal,
  CsvMapping,
  FieldOrigin,
  ImportCounters,
  ImportErrorGroup,
  ImportFailure,
  ImportJobState,
  ImportMappingRef,
  ImportProgress,
  ImportSource,
  ImportStatus,
  ImportWarning,
  OccurrenceCandidateEntry,
  OccurrenceLinkState,
  ProfileCandidateInfo,
  RowCandidate,
  RowEdits,
  RowIssue,
  RowKind,
  StatementFormat,
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
  // ── Phase 6
  readonly source: ImportSource;
  readonly documentId: string | null;
  readonly format: StatementFormat | null;
  readonly stage: ImportProgress['stage'] | null;
  readonly failure: ImportFailure | null;
  readonly mappingProfile: ImportMappingRef | null;
  readonly profileCandidates: readonly ProfileCandidateInfo[];
  readonly missingColumns: readonly string[];
  readonly statement: StatementView | null;
  /** `closingBalance − resultingBalance` (se completa en las consultas con el staging a la vista). */
  readonly statementDifference: MoneyView | null;
  readonly reconciliationOffer: ReconciliationOfferView | null;
  readonly revertSummary: RevertSummaryView | null;
  readonly ruleCoverage: RuleCoverageView | null;
}

export interface StatementView {
  readonly openingBalance: MoneyView | null;
  readonly closingBalance: MoneyView | null;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
}

export interface ReconciliationOfferView {
  readonly accountId: string;
  readonly statementDate: string;
  readonly statementBalance: MoneyView;
}

export interface RevertSummaryView {
  readonly voided: number;
  readonly alreadyVoided: number;
  readonly blocked: number;
  readonly revertedAt: string | null;
  readonly revertedBy: string | null;
}

export interface RuleCoverageView {
  readonly rows: number;
  readonly classifiedByRule: number;
  readonly withoutCategory: number;
  readonly ratio: string;
}

export function toJobView(s: ImportJobState, currency = ''): ImportJobView {
  const money = (amount: string | null): MoneyView | null => (amount === null ? null : { amount, currency });
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
    source: s.source,
    documentId: s.documentId,
    format: s.format,
    stage: s.progress.stage ?? null,
    failure: s.failure,
    mappingProfile: s.mappingProfile,
    profileCandidates: s.mappingHelp?.profileCandidates ?? [],
    missingColumns: s.mappingHelp?.missingColumns ?? [],
    statement:
      s.statement === null
        ? null
        : {
            openingBalance: money(s.statement.openingBalance),
            closingBalance: money(s.statement.closingBalance),
            periodFrom: s.statement.periodFrom,
            periodTo: s.statement.periodTo,
          },
    statementDifference: null,
    reconciliationOffer:
      s.reconciliation?.outcome === 'MATCHED'
        ? {
            accountId: s.accountId,
            statementDate: s.reconciliation.statementDate,
            statementBalance: { amount: s.reconciliation.statementBalance, currency },
          }
        : null,
    revertSummary:
      s.revert === null
        ? null
        : {
            voided: s.revert.voided,
            alreadyVoided: s.revert.alreadyVoided,
            blocked: s.revert.blocked,
            revertedAt: s.revertedAt,
            revertedBy: s.revertedBy,
          },
    ruleCoverage:
      s.rulesSummary === null
        ? null
        : {
            rows: s.rulesSummary.rows,
            classifiedByRule: s.rulesSummary.classifiedByRule,
            withoutCategory: s.rulesSummary.withoutCategory,
            ratio: s.rulesSummary.ratio,
          },
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

export interface PreviewRowView extends RowPhase6View {
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

// ───────────────────────────────────────────────────────────── filas de la vista previa (Phase 6)

export interface ProposedFieldView {
  readonly value: string | readonly string[] | null;
  readonly origin: 'ALIAS' | 'RULE' | 'DEFAULT' | 'MANUAL';
  readonly ruleId: string | null;
  readonly ruleVersion: number | null;
}

export interface RowProposalView {
  readonly categoryId?: ProposedFieldView;
  readonly counterpartyId?: ProposedFieldView;
  readonly tagIds?: ProposedFieldView;
  readonly description?: ProposedFieldView;
  readonly excluded?: boolean;
  readonly needsCategory: boolean;
}

const originView = (origin: FieldOrigin): Pick<ProposedFieldView, 'origin' | 'ruleId' | 'ruleVersion'> =>
  origin.type === 'RULE'
    ? { origin: 'RULE', ruleId: origin.ruleId, ruleVersion: origin.ruleVersion }
    : {
        origin: origin.type === 'MANUAL' ? 'MANUAL' : origin.type === 'ALIAS' ? 'ALIAS' : 'DEFAULT',
        ruleId: null,
        ruleVersion: null,
      };

/** Propuesta con el origen de cada campo; `needsCategory` mira lo EFECTIVO (edición sobre propuesta). */
export function toProposalView(proposal: ClassificationProposal | null, edits: RowEdits): RowProposalView {
  const field = <T extends string | readonly string[] | null>(
    p: { readonly value: T; readonly origin: FieldOrigin } | null,
  ): ProposedFieldView | undefined => (p === null ? undefined : { value: p.value, ...originView(p.origin) });
  const effectiveCategory =
    edits.categoryId !== undefined ? edits.categoryId : (proposal?.category?.value ?? null);
  return {
    ...(proposal?.category ? { categoryId: field(proposal.category) as ProposedFieldView } : {}),
    ...(proposal?.counterparty ? { counterpartyId: field(proposal.counterparty) as ProposedFieldView } : {}),
    ...(proposal?.tags ? { tagIds: field(proposal.tags) as ProposedFieldView } : {}),
    ...(proposal?.description ? { description: field(proposal.description) as ProposedFieldView } : {}),
    ...(proposal?.exclude ? { excluded: true } : {}),
    needsCategory: effectiveCategory === null,
  };
}

export interface OccurrenceCandidateView {
  readonly occurrenceId: string;
  readonly confidence: string;
  readonly dueDate: string;
  readonly expectedAmount: MoneyView | null;
  readonly label: string;
}

export const toOccurrenceCandidateView = (c: OccurrenceCandidateEntry): OccurrenceCandidateView => ({
  occurrenceId: c.occurrenceId,
  confidence: c.confidence,
  dueDate: c.dueDate,
  expectedAmount: null,
  label: c.definitionName,
});

export type DuplicateCandidateView = RowCandidate;

export interface RowPhase6View {
  readonly kind: RowKind;
  readonly externalId: string | null;
  readonly time: string | null;
  readonly runningBalance: MoneyView | null;
  readonly proposal: RowProposalView | null;
  readonly edits: RowEdits | null;
  readonly candidates: readonly DuplicateCandidateView[];
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
  readonly decidedScore: string | null;
  readonly duplicateOfRow: number | null;
  readonly occurrenceCandidates: readonly OccurrenceCandidateView[];
  readonly occurrenceLink: OccurrenceLinkState | null;
  readonly transfer: { readonly counterAccountId: string } | null;
  readonly conversion: NonNullable<RowEdits['conversion']> | null;
}
