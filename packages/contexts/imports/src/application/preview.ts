import { Money, currency as makeCurrency } from '@pf/shared-kernel';
import type { ImportJobState } from '../domain/index.js';
import type { AccountView, ImportsDeps, StagedRow, StagingSummary } from './ports/index.js';
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
    issues: row.issues,
    candidate,
    transactionId: row.transactionId,
    failure: row.batchError,
  };
}
