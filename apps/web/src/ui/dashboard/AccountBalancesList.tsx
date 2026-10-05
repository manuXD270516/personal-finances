import { formatMoney } from './format';
import type { FormatContext, ReportSummary } from './types';

/** Saldo de cada cuenta activa en su moneda original y, si hay tasa, convertido a la moneda de reporte. */
export function AccountBalancesList({ summary, ctx }: { summary: ReportSummary; ctx: FormatContext }) {
  const { t, locale } = ctx;
  if (summary.accounts.length === 0) return null;
  const reporting = summary.consolidated.currency;
  return (
    <section data-testid="account-balances" aria-labelledby="account-balances-title" className="pf-home-card">
      <h3 id="account-balances-title">{t('accounts.title')}</h3>
      <ul className="pf-home-list">
        {summary.accounts.map((a) => (
          <li
            key={a.accountId}
            data-testid="account-balance"
            data-account-id={a.accountId}
            data-nature={a.nature}
            data-liquid={a.liquid ? 'true' : 'false'}
          >
            <span data-testid="account-name">{a.name}</span>{' '}
            <span className="pf-home-muted">
              ({t(`accountTypes.${a.type}`)}
              {a.nature === 'LIABILITY' ? ` · ${t('accounts.liability')}` : ''})
            </span>
            :{' '}
            <strong data-testid="account-balance-amount" className="pf-home-num">
              {formatMoney(a.balance, locale)}
            </strong>
            {a.balance.currency !== reporting ? (
              <span data-testid="account-converted-balance" className="pf-home-muted">
                {' '}
                {a.convertedBalance
                  ? t('accounts.converted', { amount: formatMoney(a.convertedBalance, locale) })
                  : t('accounts.noRate')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
