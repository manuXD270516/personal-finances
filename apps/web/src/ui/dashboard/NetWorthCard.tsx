import { formatMoney } from './format';
import { statusOf } from './QuestionWidgets';
import { amountStyle, cardStyle, mutedStyle, warningStyle } from './styles';
import type { FormatContext, ReportSummary } from './types';

const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' } as const;
const cell = { textAlign: 'right', padding: '0.125rem 0.25rem' } as const;

/**
 * Patrimonio neto actual (reporting/net-worth): activos − pasivos en la moneda de reporte, advertencia si hay montos
 * sin valorar y desglose por moneda (nativo y convertido) y por tipo de cuenta.
 */
export function NetWorthCard({ summary, ctx }: { summary: ReportSummary; ctx: FormatContext }) {
  const { t, locale } = ctx;
  const nw = summary.netWorth;
  const noAccounts = statusOf(summary, 'Q1').status === 'NO_DATA';
  return (
    <section data-testid="net-worth" aria-labelledby="net-worth-title" style={cardStyle}>
      <h2 id="net-worth-title" style={{ fontSize: '1rem', margin: 0 }}>
        {t('netWorth.title')}
      </h2>
      {noAccounts ? (
        <p data-testid="net-worth-no-accounts">{t('noAccounts')}</p>
      ) : (
        <>
          <p data-testid="net-worth-amount" style={amountStyle}>
            {formatMoney(nw.netWorth, locale)}
          </p>
          <p style={mutedStyle}>
            {t('netWorth.assets')}{' '}
            <span data-testid="net-worth-assets">{formatMoney(nw.assets, locale)}</span> ·{' '}
            {t('netWorth.liabilities')}{' '}
            <span data-testid="net-worth-liabilities">{formatMoney(nw.liabilities, locale)}</span>
          </p>
          {!nw.complete ? (
            <div data-testid="net-worth-incomplete" style={warningStyle}>
              <p style={{ margin: 0 }}>{t('netWorth.incomplete')}</p>
              {nw.unvalued.length > 0 ? (
                <p style={{ margin: 0 }} data-testid="net-worth-unvalued">
                  {nw.unvalued.map((m) => formatMoney(m, locale)).join(' · ')}
                </p>
              ) : null}
            </div>
          ) : null}
          {nw.byCurrency.length > 0 ? (
            <table data-testid="net-worth-by-currency" style={tableStyle}>
              <caption style={{ textAlign: 'left' }}>{t('netWorth.byCurrency')}</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ textAlign: 'left' }}>
                    {t('netWorth.currency')}
                  </th>
                  <th scope="col" style={cell}>
                    {t('netWorth.net')}
                  </th>
                  <th scope="col" style={cell}>
                    {t('netWorth.converted', { currency: summary.consolidated.currency })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {nw.byCurrency.map((c) => (
                  <tr key={c.currency} data-currency={c.currency}>
                    <th scope="row" style={{ textAlign: 'left' }}>
                      {c.currency}
                    </th>
                    <td style={cell}>{formatMoney(c.net, locale)}</td>
                    <td style={cell}>
                      {c.converted ? formatMoney(c.converted, locale) : t('netWorth.noRate')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {nw.byAccountType.length > 0 ? (
            <table data-testid="net-worth-by-type" style={tableStyle}>
              <caption style={{ textAlign: 'left' }}>{t('netWorth.byAccountType')}</caption>
              <tbody>
                {nw.byAccountType.map((a) => (
                  <tr key={a.type} data-account-type={a.type}>
                    <th scope="row" style={{ textAlign: 'left' }}>
                      {t(`accountTypes.${a.type}`)}
                    </th>
                    <td style={cell}>{formatMoney(a.amount, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </>
      )}
    </section>
  );
}
