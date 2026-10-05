import { formatMoney } from './format';
import { ActionHint, statusOf } from './QuestionWidgets';
import { RateSourceBadge } from './RateSourceBadge';
import type { FormatContext, ReportSummary, ResolvedRate } from './types';

/**
 * Tasa con la que se valoró hoy una moneda: primero la de las cuentas (stocks valorados a la fecha de consulta),
 * luego `meta.ratesUsed`.
 */
export function rateForCurrency(summary: ReportSummary, currency: string): ResolvedRate | undefined {
  const quote = summary.consolidated.currency;
  if (currency === quote) return undefined;
  const fromAccounts = summary.accounts.find(
    (a) => a.balance.currency === currency && a.rate && a.rate.rate.base === currency,
  )?.rate;
  return (
    fromAccounts ??
    summary.meta.ratesUsed?.find((r) => r.rate.base === currency && r.rate.quote === quote) ??
    undefined
  );
}

/** Destino de "Registrar tasa X/Y": la pantalla de tasas con el par prellenado. */
export const rateHref = (href: string, base: string, quote: string): string =>
  `${href}${href.includes('?') ? '&' : '?'}${new URLSearchParams({ base, quote }).toString()}`;

/**
 * Q1 "¿Cuánto dinero tengo?": dinero disponible consolidado en la moneda de reporte, totales líquidos por moneda
 * con la tasa usada y su fuente, y advertencia de montos no convertidos (sin 1:1 ni números inventados).
 */
export function LiquidBalanceCard({
  summary,
  ctx,
  createAccountHref,
  registerRateHref,
}: {
  summary: ReportSummary;
  ctx: FormatContext;
  createAccountHref?: string | undefined;
  registerRateHref?: string | undefined;
}) {
  const { t, locale } = ctx;
  const q1 = statusOf(summary, 'Q1');
  const { consolidated } = summary;
  const liquid = summary.byCurrency.filter((c) => c.liquidBalance !== undefined);

  return (
    <section
      data-testid="liquid-balance"
      data-question="Q1"
      data-status={q1.status}
      aria-labelledby="liquid-balance-title"
      className="pf-home-card pf-home-hero"
    >
      <h2 id="liquid-balance-title">{t('questions.Q1')}</h2>
      {q1.status === 'NO_DATA' ? (
        <div data-testid="liquid-balance-no-accounts">
          <p>{t('noAccounts')}</p>
          <ActionHint
            code={q1.actionHint ?? 'CREATE_ACCOUNT'}
            ctx={ctx}
            href={createAccountHref}
            testId="create-account-action"
          />
        </div>
      ) : (
        <>
          <p data-testid="liquid-balance-amount" className="pf-home-amount">
            {formatMoney(consolidated.liquidBalance, locale)}
          </p>
          <p className="pf-home-muted">{t('liquid.caption', { currency: consolidated.currency })}</p>
          {liquid.length > 0 ? (
            <ul data-testid="liquid-balance-by-currency" className="pf-home-list">
              {liquid.map((c) => {
                const rate = rateForCurrency(summary, c.currency);
                return (
                  <li key={c.currency} data-currency={c.currency}>
                    <span data-testid="liquid-currency-amount" className="pf-home-num">
                      {formatMoney(c.liquidBalance!, locale)}
                    </span>
                    {rate ? <RateSourceBadge rate={rate} ctx={ctx} /> : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {!consolidated.complete ? (
            <div data-testid="liquid-balance-incomplete" className="pf-home-warning">
              <p>{t('liquid.incomplete')}</p>
              {consolidated.unconverted.length > 0 ? (
                <ul data-testid="unconverted" className="pf-home-list">
                  {consolidated.unconverted.map((m) => (
                    <li key={m.currency} data-currency={m.currency}>
                      <span data-testid="unconverted-amount">{formatMoney(m, locale)}</span> ·{' '}
                      <span data-testid="register-rate-action">
                        {registerRateHref ? (
                          <a href={rateHref(registerRateHref, m.currency, consolidated.currency)}>
                            {t('liquid.registerRate', { pair: `${m.currency}/${consolidated.currency}` })}
                          </a>
                        ) : (
                          t('liquid.registerRate', { pair: `${m.currency}/${consolidated.currency}` })
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
