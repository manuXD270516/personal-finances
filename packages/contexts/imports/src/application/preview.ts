import { Money, currency as makeCurrency } from '@pf/shared-kernel';
import type { ImportJobState } from '../domain/index.js';
import type { AccountView, ImportsDeps, StagedRow, StagingSummary } from './ports/index.js';
import { toOccurrenceCandidateView, toProposalView } from './views.js';
import type { PreviewCandidateView, PreviewRowView, PreviewSummaryView } from './views.js';

/**
 * Totales de la vista previa (decisión 12 de add-basic-csv-import): conteos por clasificación y decisión, Σ de salidas
 * y entradas de las filas A CREAR y saldo contable actual y resultante de la cuenta en su moneda. El saldo de un pasivo
 * se presenta con el signo de la UI (deuda positiva): una salida la aumenta y una entrada la reduce. Sin efectos.
 */
export async function buildPreviewSummary(
  deps: ImportsDeps,
  input: {
    readonly workspaceId: string;
    readonly job: ImportJobState;
    readonly account: AccountView;
    readonly summary: StagingSummary;
  },
): Promise<PreviewSummaryView> {
  const { account, summary } = input;
  const scale = (await deps.currencies.scaleOf(account.currency)) ?? 2;
  const currency = makeCurrency(account.currency, scale);
  const outflows = Money.parse(summary.outflows, currency);
  const inflows = Money.parse(summary.inflows, currency);
  const presented = await deps.balances.presentedBalance(input.workspaceId, account.accountId);
  const current = Money.parse(presented ?? '0', currency);
  const resulting =
    account.nature === 'LIABILITY'
      ? current.add(outflows).subtract(inflows)
      : current.add(inflows).subtract(outflows);
  const by = summary.byClassification;
  return {
    counts: {
      rows: summary.rows,
      new: by.NEW,
      alreadyImported: by.DUPLICATE_EXACT,
      probableDuplicates: by.DUPLICATE_PROBABLE,
      invalid: by.INVALID,
      pendingDecisions: summary.pendingDecisions,
      toCreate: summary.toCreate,
      skipped: summary.skipped,
      excluded: summary.excluded,
    },
    outflows: outflows.toJSON(),
    inflows: inflows.toJSON(),
    currentBalance: current.toJSON(),
    resultingBalance: resulting.toJSON(),
  };
}

/** Las ediciones de campos (origen manual); el tipo, la transferencia y la conversión viajan aparte en la fila. */
function editsView(edits: StagedRow['edits']): PreviewRowView['edits'] {
  const {
    kind: _kind,
    transfer: _transfer,
    conversion: _conversion,
    occurrenceLink: _link,
    ...fields
  } = edits;
  return Object.keys(fields).length === 0 ? null : fields;
}

export function toRowView(
  row: StagedRow,
  candidate: PreviewCandidateView | null,
  currencyCode: string,
): PreviewRowView {
  return {
    id: row.id,
    lineNumber: row.rowNumber,
    date: row.bookingDate,
    description: row.description,
    amount: row.amount === null ? null : { amount: row.amount, currency: row.currency ?? currencyCode },
    direction: row.direction,
    classification: row.classification ?? 'INVALID',
    decision: row.decision,
    // Las advertencias del pipeline (reglas no disponibles, vínculo con la ocurrencia omitido) viajan con las incidencias.
    issues: row.warnings.length > 0 ? [...row.issues, ...row.warnings] : row.issues,
    candidate,
    transactionId: row.transactionId,
    failure: row.batchError,
    kind: row.edits.kind ?? row.kind ?? (row.direction === 'IN' ? 'INCOME' : 'EXPENSE'),
    externalId: row.externalId,
    time: row.bookingTime,
    runningBalance:
      row.runningBalance === null
        ? null
        : { amount: row.runningBalance, currency: row.currency ?? currencyCode },
    proposal:
      row.proposal === null && Object.keys(row.edits).length === 0
        ? null
        : toProposalView(row.proposal, row.edits),
    edits: editsView(row.edits),
    candidates: row.candidates,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decidedScore: row.decidedScore,
    duplicateOfRow: row.duplicateOfRow,
    occurrenceCandidates: row.occurrenceCandidates.map(toOccurrenceCandidateView),
    occurrenceLink: row.occurrenceLink,
    transfer: row.edits.transfer ?? null,
    conversion: row.edits.conversion ?? null,
  };
}
