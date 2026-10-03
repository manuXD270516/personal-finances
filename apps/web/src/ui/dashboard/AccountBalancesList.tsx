import { formatMoney } from './format';
import { cardStyle, listStyle, mutedStyle } from './styles';
import type { FormatContext, ReportSummary } from './types';

/** Saldo de cada cuenta activa en su moneda original y, si hay tasa, convertido a la moneda de reporte. */
export function AccountBalancesList({ summary, ctx }: { summary: ReportSummary; ctx: FormatContext }) {
  const { t, locale } = ctx;
  if (summary.accounts.length === 0) return null;
  const reporting = summary.consolidated.currency;
  return (
    <section data-testid="account-balances" aria-labelledby="account-balances-title" style={cardStyle}>
      <h2 id="account-balances-title" style={{ fontSize: '1rem', margin: 0 }}>
        {t('accounts.title')}
      </h2>
      <ul style={listStyle}>
        {summary.accounts.map((a) => (
          <li
            key={a.accountId}
            data-testid="account-balance"
            data-account-id={a.accountId}
            data-nature={a.nature}
            data-liquid={a.liquid ? 'true' : 'false'}
            style={{ margin: '0.5rem 0' }}
          >
            <span data-testid="account-name">{a.name}</span>{' '}
            <span style={mutedStyle}>
              ({t(`accountTypes.${a.type}`)}
              {a.nature === 'LIABILITY' ? ` · ${t('accounts.liability')}` : ''})
            </span>
            : <strong data-testid="account-balance-amount">{formatMoney(a.balance, locale)}</strong>
            {a.balance.currency !== reporting ? (
              <span data-testid="account-converted-balance" style={mutedStyle}>
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
