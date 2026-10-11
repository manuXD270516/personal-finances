'use client';

import { problemMessage } from '../../errors/error-messages';
import type { Transaction } from '../common/types';
import { cardStyle, mutedStyle } from '../common/ui';
import { useFormat, type WorkspaceContext } from '../common/workspace';
import { formatDecimal } from '../AuditHistory';
import type { FormatContext } from '../dashboard/types';
import { useLoanLookup } from './useLoanLookup';
import { COMPONENT_KEYS } from './types';

/** Distintivo "Préstamo" con enlace y desglose del pago (presentacional). */
export function LoanTransactionView({
  tx,
  f,
  loanName,
  href,
  managedMessage,
}: {
  tx: Pick<Transaction, 'kind' | 'loanId' | 'loanPaymentBreakdown'>;
  f: FormatContext;
  loanName: string | undefined;
  href: (path: string) => string;
  managedMessage: string;
}) {
  return (
    <section aria-labelledby="tx-loan-title" style={cardStyle} data-testid="tx-loan">
      <h2 id="tx-loan-title" style={{ fontSize: '1rem', marginTop: 0 }}>
        <span data-testid="tx-loan-badge">{f.t('transaction.badge')}</span>
      </h2>
      <p style={{ margin: 0 }}>
        <a href={href(`/debts/${tx.loanId}`)} data-testid="tx-loan-link">
          {loanName ?? f.t('transaction.viewLoan')}
        </a>
      </p>
      <p style={mutedStyle} data-testid="tx-loan-managed">
        {managedMessage}
      </p>
      {tx.loanPaymentBreakdown ? (
        <table style={{ borderCollapse: 'collapse' }} data-testid="tx-loan-breakdown">
          <caption className="pf-sr-only">{f.t('transaction.breakdownCaption')}</caption>
          <tbody>
            {COMPONENT_KEYS.map((k) => (
              <tr key={k}>
                <th
                  scope="row"
                  style={{ textAlign: 'left', paddingRight: 'var(--pf-space-4)', fontWeight: 400 }}
                >
                  {f.t(`components.${k}`)}
                </th>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }} data-component={k}>
                  {formatDecimal(tx.loanPaymentBreakdown![k].amount, f.locale)}{' '}
                  {tx.loanPaymentBreakdown![k].currency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

/** Para el detalle de transacciones: el préstamo que la administra, su desglose y por qué no se edita ni se anula. */
export function LoanTransactionInfo({ ctx, tx }: { ctx: WorkspaceContext; tx: Transaction }) {
  const f = useFormat('Debt', ctx);
  const loans = useLoanLookup(ctx, true);
  return (
    <LoanTransactionView
      tx={tx}
      f={f}
      loanName={tx.loanId ? loans.ofId(tx.loanId)?.name : undefined}
      href={ctx.href}
      managedMessage={problemMessage({ code: 'TRANSACTION_MANAGED_EXTERNALLY' }, ctx.uiLocale)}
    />
  );
}
