import { cellStyle, mutedStyle, numCellStyle, tableStyle, tableWrapStyle } from '../common/ui';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { MoneyText, SubscriptionStatusBadge, cycleSummary } from './Badges';
import { subscriptionPath } from './logic';
import type { Subscription } from './types';

/**
 * Listado de suscripciones: estado (texto + icono), provider y plan, precio vigente con su moneda, próxima renovación,
 * cuenta de pago y, si existe, la cancelación programada o el fin del trial. El nombre enlaza al detalle.
 */
export function SubscriptionsList({
  subscriptions,
  f,
  href,
}: {
  subscriptions: readonly Subscription[];
  f: FormatContext;
  href: (path: string) => string;
}) {
  if (subscriptions.length === 0)
    return (
      <p style={mutedStyle} data-testid="subscriptions-empty">
        {f.t('list.empty')}
      </p>
    );
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle} data-testid="subscriptions-table">
        <caption className="pf-sr-only">{f.t('list.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('columns.name')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.status')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('columns.price')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.nextRenewal')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.paymentAccount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {subscriptions.map((s) => (
            <tr
              key={s.id}
              data-testid="subscription-row"
              data-subscription-id={s.id}
              data-name={s.name}
              data-status={s.status}
            >
              <td style={cellStyle}>
                <a
                  href={href(subscriptionPath(s.id, { cancelled: s.status === 'CANCELLED' }))}
                  data-testid="subscription-link"
                >
                  {s.name}
                </a>
                <div style={mutedStyle}>
                  {[s.providerName, s.planName].filter(Boolean).join(' · ') || '—'}
                </div>
              </td>
              <td style={cellStyle}>
                <SubscriptionStatusBadge status={s.status} f={f} />
                {s.status === 'TRIAL' && s.trialEndsOn ? (
                  <div style={mutedStyle} data-testid="trial-ends">
                    {f.t('list.trialEnds', { date: formatBusinessDate(s.trialEndsOn) })}
                  </div>
                ) : null}
                {s.scheduledCancellationOn && s.status !== 'CANCELLED' ? (
                  <div style={mutedStyle} data-testid="scheduled-cancellation">
                    <span aria-hidden="true">⏳</span>{' '}
                    {f.t('list.scheduledCancellation', {
                      date: formatBusinessDate(s.scheduledCancellationOn),
                    })}
                  </div>
                ) : null}
                {s.status === 'CANCELLED' && s.cancelledOn ? (
                  <div style={mutedStyle} data-testid="cancelled-on">
                    {f.t('list.cancelledOn', { date: formatBusinessDate(s.cancelledOn) })}
                  </div>
                ) : null}
              </td>
              <td style={numCellStyle}>
                <MoneyText money={s.currentPrice} f={f} testId="subscription-price" />
                <div style={mutedStyle}>{cycleSummary(s.billingCycle, f)}</div>
              </td>
              <td style={cellStyle} data-testid="next-renewal">
                {s.nextRenewalOn ? formatBusinessDate(s.nextRenewalOn) : f.t('list.noRenewal')}
              </td>
              <td style={cellStyle}>
                {s.paymentAccountName ?? '—'}
                {s.accountCurrency !== s.currentPrice.currency ? (
                  <div style={mutedStyle}>{f.t('list.chargedIn', { currency: s.accountCurrency })}</div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
