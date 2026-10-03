import { formatMoney, formatLocalDate, isNegative } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { todayIn } from '../common/dates';
import type { Account, AccountType, Institution, Money } from '../common/types';
import { badgeStyle, cardStyle, mutedStyle } from '../common/ui';
import { groupAccounts, maskedIdentifier, type AccountGroupBy } from './logic';
import type { AccountValuation } from './valuations';

/** Saldo presentado: los pasivos se muestran como "Adeuda …" (positivo), nunca como negativo (docs/28 §8.3). */
export function BalanceText({ account, ctx }: { account: Account; ctx: FormatContext }) {
  const { t, locale } = ctx;
  const b = account.balance;
  if (account.classification === 'LIABILITY') {
    const owed = isNegative(b.amount)
      ? t('balance.inFavor', { amount: formatMoney({ ...b, amount: b.amount.slice(1) }, locale) })
      : t('balance.owes', { amount: formatMoney(b, locale) });
    return <>{owed}</>;
  }
  return <>{formatMoney(b, locale)}</>;
}

/**
 * Equivalente en la moneda base con la fecha y la fuente de la tasa (FR-ACCOUNTS-010); sin tasa lo dice
 * explícitamente y no inventa un equivalente (TC-ACCOUNTS-LIST-001).
 */
export function BaseEquivalent({
  account,
  baseCurrency,
  ctx,
  valuation,
}: {
  account: Account;
  baseCurrency: string;
  ctx: FormatContext;
  valuation?: AccountValuation | undefined;
}) {
  const { t, locale, has, timeZone } = ctx;
  if (account.currency === baseCurrency) return null;
  const eq: { amount: Money; date: string; source: string } | null = account.baseCurrencyBalance
    ? {
        amount: account.baseCurrencyBalance.amount,
        date: account.baseCurrencyBalance.rateDate,
        source: account.baseCurrencyBalance.rateSource,
      }
    : valuation
      ? {
          amount: valuation.converted,
          date: todayIn(timeZone, new Date(valuation.rate.asOf)),
          source:
            valuation.rate.source === 'PROVIDER' && valuation.rate.attribution
              ? valuation.rate.attribution.text
              : valuation.rate.source,
        }
      : null;
  if (!eq)
    return (
      <span data-testid="account-no-rate" style={mutedStyle}>
        {t('noRate', { currency: baseCurrency })}
      </span>
    );
  const source = has(`rateSource.${eq.source}`) ? t(`rateSource.${eq.source}`) : eq.source;
  return (
    <span data-testid="account-base-equivalent" style={mutedStyle}>
      {t('equivalent', {
        amount: formatMoney(eq.amount, locale),
        date: formatLocalDate(eq.date, locale),
        source,
      })}
    </span>
  );
}

export function AccountStatusBadge({ account, ctx }: { account: Account; ctx: FormatContext }) {
  if (account.status === 'ACTIVE') return null;
  return (
    <span data-testid="account-status" data-status={account.status} style={badgeStyle}>
      {ctx.t(`status.${account.status}`)}
    </span>
  );
}

export interface AccountsListViewProps {
  readonly accounts: readonly Account[];
  readonly institutions: ReadonlyMap<string, Institution>;
  readonly groupBy: AccountGroupBy;
  readonly baseCurrency: string;
  readonly ctx: FormatContext;
  readonly href: (path: string) => string;
  /** Equivalentes en moneda base por cuenta (valoración del resumen) cuando la cuenta no trae el suyo. */
  readonly valuations?: ReadonlyMap<string, AccountValuation>;
}

/**
 * Pantalla Cuentas (add-accounts-management 7.1): listado agrupable con saldo en su moneda, equivalente en la
 * moneda base (fecha y fuente de la tasa, o "sin tasa"), pasivos como "Adeuda", estado e identificador enmascarado.
 */
export function AccountsListView({
  accounts,
  institutions,
  groupBy,
  baseCurrency,
  ctx,
  href,
  valuations,
}: AccountsListViewProps) {
  const { t } = ctx;
  if (accounts.length === 0) return <p data-testid="accounts-empty">{t('empty')}</p>;
  const groups = groupAccounts(accounts, groupBy, {
    type: (type: AccountType) => t(`types.${type}`),
    institutions,
    noInstitution: t('noInstitution'),
    all: t('allAccounts'),
  });
  return (
    <div data-testid="accounts-list" style={{ display: 'grid', gap: '1rem' }}>
      {groups.map((g) => (
        <section
          key={g.key}
          data-testid="account-group"
          data-group={g.key}
          aria-labelledby={`account-group-${g.key}`}
          style={cardStyle}
        >
          <h2 id={`account-group-${g.key}`} style={{ fontSize: '1rem', margin: 0 }}>
            {g.label}
          </h2>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {g.accounts.map((a) => {
              const mask = maskedIdentifier(a.accountNumberLast4);
              return (
                <li
                  key={a.id}
                  data-testid="account-row"
                  data-account-id={a.id}
                  data-status={a.status}
                  data-nature={a.classification}
                  style={{ padding: '0.5rem 0', borderBottom: '1px solid #eaeef2' }}
                >
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'baseline' }}>
                    <a href={href(`/cuentas/${a.id}`)} data-testid="account-name">
                      {a.name}
                    </a>
                    <span style={mutedStyle}>
                      {t(`types.${a.type}`)} · {a.currency}
                    </span>
                    {mask ? (
                      <span
                        data-testid="account-mask"
                        aria-label={t('maskLabel', { last4: a.accountNumberLast4 ?? '' })}
                      >
                        {mask}
                      </span>
                    ) : null}
                    <AccountStatusBadge account={a} ctx={ctx} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'baseline' }}>
                    <strong data-testid="account-balance">
                      <BalanceText account={a} ctx={ctx} />
                    </strong>
                    <BaseEquivalent
                      account={a}
                      baseCurrency={baseCurrency}
                      ctx={ctx}
                      valuation={valuations?.get(a.id)}
                    />
                  </div>
                  <small style={mutedStyle} data-testid="account-liquidity" data-liquidity={a.liquidity}>
                    {t(`liquidity.${a.liquidity}`)}
                    {a.includeInNetWorth ? '' : ` · ${t('excludedFromNetWorth')}`}
                  </small>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
