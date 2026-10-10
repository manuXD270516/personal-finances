import { formatDecimal } from '../AuditHistory';
import { formatInstant, formatLocalDate, formatMoney } from '../dashboard/format';
import type { FormatContext, ResolvedRate } from '../dashboard/types';
import { DAY_OPTIONS, RECURRING_PATH, amountText, itemPath, joinMoney } from './logic';
import { UPCOMING_CSS } from './styles';
import type { SurprisePayments, UpcomingPayments } from './types';
import { CommittedSummary, IncompleteNote, StatusBadge, fromCommitment } from './UpcomingParts';

export interface UpcomingFullViewProps {
  readonly upcoming: UpcomingPayments;
  /** Indicador de pagos sorpresa del periodo; `'error'` si falló; `undefined` mientras carga. */
  readonly surprise: SurprisePayments | 'error' | undefined;
  readonly days: number;
  readonly onDaysChange: (days: number) => void;
  readonly f: FormatContext;
  readonly href: (path: string) => string;
}

function rateLine(r: ResolvedRate, f: FormatContext): string {
  return f.t('rates.item', {
    base: r.rate.base,
    quote: r.rate.quote,
    value: formatDecimal(r.rate.value, f.locale),
    type: r.rateType,
    source: r.attribution?.text ?? r.sourceLabel ?? f.t(`rates.source.${r.source}`),
    date: formatLocalDate(r.asOf.slice(0, 10), f.locale),
  });
}

function Totals({ upcoming, f }: { upcoming: UpcomingPayments; f: FormatContext }) {
  const { totals, meta } = upcoming;
  const external = { target: '_blank', rel: 'noopener noreferrer' } as const;
  return (
    <section aria-labelledby="upcoming-totals-title" data-testid="upcoming-totals" className="pf-home-card">
      <h3 id="upcoming-totals-title">{f.t('totals.title')}</h3>
      <div className="pf-upc-totals">
        <p className="pf-home-amount" data-testid="upcoming-total-consolidated" style={{ margin: 0 }}>
          {formatMoney(totals.consolidated.amount, f.locale)}
        </p>
        {totals.byCurrency.length > 0 ? (
          <p className="pf-home-muted" style={{ margin: 0 }} data-testid="upcoming-total-by-currency">
            {f.t('totals.byCurrency', { amounts: joinMoney(totals.byCurrency, f.locale) })}
          </p>
        ) : null}
        <IncompleteNote
          complete={totals.consolidated.complete}
          unconverted={totals.consolidated.unconverted}
          f={f}
          testId="upcoming-incomplete"
        />
        {totals.withoutAmountCount > 0 ? (
          <p style={{ margin: 0 }} data-testid="upcoming-without-amount">
            <span aria-hidden="true">ℹ</span> {f.t('withoutAmount', { count: totals.withoutAmountCount })}
          </p>
        ) : null}
        <p className="pf-home-muted" style={{ margin: 0 }}>
          {f.t('totals.valuedToday', { currency: meta.reportingCurrency })}
        </p>
        {meta.rates.length > 0 ? (
          <ul className="pf-home-list pf-home-muted" data-testid="upcoming-rates">
            {meta.rates.map((r) => (
              <li key={`${r.fxRateId ?? r.asOf}-${r.rate.base}-${r.rate.quote}`}>{rateLine(r, f)}</li>
            ))}
          </ul>
        ) : null}
        {meta.attributions.length > 0 ? (
          <ul className="pf-home-list pf-home-muted" data-testid="upcoming-attributions">
            {meta.attributions.map((a) => (
              <li key={a.provider} data-provider={a.provider}>
                <a href={a.url} {...external}>
                  {a.text}
                </a>
                {a.license ? ` · ${a.license}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function ItemsTable({ upcoming, f, href }: Pick<UpcomingFullViewProps, 'upcoming' | 'f' | 'href'>) {
  if (upcoming.items.length === 0) {
    return (
      <p data-testid="upcoming-empty" className="pf-home-empty">
        {f.t('table.empty', { days: upcoming.window.days })}
      </p>
    );
  }
  return (
    <div className="pf-upc-table-wrap">
      <table className="pf-upc-table" data-testid="upcoming-table">
        <caption>
          {f.t('table.caption', {
            from: formatLocalDate(upcoming.window.from, f.locale),
            to: formatLocalDate(upcoming.window.to, f.locale),
          })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{f.t('table.date')}</th>
            <th scope="col">{f.t('table.payment')}</th>
            <th scope="col">{f.t('table.account')}</th>
            <th scope="col">{f.t('table.status')}</th>
            <th scope="col" className="pf-upc-num">
              {f.t('table.amount')}
            </th>
            <th scope="col" className="pf-upc-num">
              {f.t('table.converted', { currency: upcoming.meta.reportingCurrency })}
            </th>
          </tr>
        </thead>
        <tbody>
          {upcoming.items.map((item) => (
            <tr
              key={`${item.kind}-${item.occurrenceId ?? item.transactionId}`}
              data-testid="upcoming-row"
              data-status={item.status}
            >
              <td>{formatLocalDate(item.date, f.locale)}</td>
              <th scope="row">
                <a href={href(itemPath(item))}>{item.name}</a>
                {fromCommitment(item) ? (
                  <>
                    <br />
                    <span className="pf-home-muted">{f.t('fromCommitment')}</span>
                  </>
                ) : null}
              </th>
              <td>{item.accountName}</td>
              <td>
                <StatusBadge item={item} f={f} />
              </td>
              <td className="pf-upc-num">{amountText(item, f)}</td>
              <td className="pf-upc-num">
                {item.converted
                  ? formatMoney(item.converted, f.locale)
                  : item.withoutAmount
                    ? f.t('table.noAmount')
                    : f.t('table.noRate')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectedBalances({ upcoming, f }: { upcoming: UpcomingPayments; f: FormatContext }) {
  if (upcoming.projectedBalances.length === 0) return null;
  return (
    <section aria-labelledby="projected-title" data-testid="projected-balances" className="pf-home-group">
      <h3 id="projected-title">{f.t('projected.title')}</h3>
      <p className="pf-home-muted pf-upc-projection" style={{ margin: 0 }}>
        {f.t('projected.note')}
      </p>
      <div className="pf-upc-table-wrap">
        <table className="pf-upc-table">
          <caption>{f.t('projected.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{f.t('projected.account')}</th>
              <th scope="col" className="pf-upc-num">
                {f.t('projected.booked')}
              </th>
              <th scope="col" className="pf-upc-num">
                {f.t('projected.pendingIn')}
              </th>
              <th scope="col" className="pf-upc-num">
                {f.t('projected.pendingOut')}
              </th>
              <th scope="col" className="pf-upc-num">
                {f.t('projected.projected')}
              </th>
            </tr>
          </thead>
          <tbody>
            {upcoming.projectedBalances.map((b) => (
              <tr key={b.accountId} data-testid="projected-row">
                <th scope="row">{b.accountName}</th>
                <td className="pf-upc-num">{formatMoney(b.booked, f.locale)}</td>
                <td className="pf-upc-num">{formatMoney(b.pendingIn, f.locale)}</td>
                <td className="pf-upc-num">{formatMoney(b.pendingOut, f.locale)}</td>
                <td className="pf-upc-num" data-testid="projected-amount">
                  <strong>{formatMoney(b.projected, f.locale)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Surprise({ surprise, f }: { surprise: UpcomingFullViewProps['surprise']; f: FormatContext }) {
  return (
    <section aria-labelledby="surprise-title" data-testid="surprise-payments" className="pf-home-group">
      <h3 id="surprise-title">{f.t('surprise.title')}</h3>
      {surprise === undefined ? (
        <p aria-busy="true" role="status">
          {f.t('loading')}
        </p>
      ) : surprise === 'error' ? (
        <p role="status" data-testid="surprise-error">
          {f.t('surprise.error')}
        </p>
      ) : (
        <>
          <p data-testid="surprise-count" data-count={surprise.count}>
            {f.t('surprise.count', { count: surprise.count, period: surprise.label })}
            {surprise.partial ? ` · ${f.t('surprise.partial')}` : ''}
          </p>
          {surprise.items.length > 0 ? (
            <ul className="pf-home-list" data-testid="surprise-list">
              {surprise.items.map((s) => (
                <li key={s.transactionId}>
                  {f.t('surprise.item', {
                    name: s.name,
                    amount: formatMoney(s.amount, f.locale),
                    date: formatLocalDate(s.date, f.locale),
                    generated: formatLocalDate(s.generatedOn, f.locale),
                  })}
                </li>
              ))}
            </ul>
          ) : null}
          <p className="pf-home-muted" data-testid="surprise-note">
            {f.t('surprise.limitation')}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * Vista completa `/pagos-proximos` (reporting/cash-flow-calendar, versión simple de Phase 3): selector de ventana
 * (7/14/30/60/90 días), lista con estado y tipo de monto, totales con las tasas usadas ("valorado con la tasa de hoy"),
 * comprometido del periodo, saldo proyectado por cuenta rotulado como proyección e indicador de pagos sorpresa con su
 * limitación. Aprobar, omitir y vincular se hacen en Recurrentes (enlaces); aquí no se duplican.
 */
export function UpcomingFullView({ upcoming, surprise, days, onDaysChange, f, href }: UpcomingFullViewProps) {
  const options = DAY_OPTIONS.includes(days as (typeof DAY_OPTIONS)[number])
    ? DAY_OPTIONS
    : [...DAY_OPTIONS, days].sort((a, b) => a - b);
  return (
    <div className="pf-home" data-testid="upcoming-page">
      <style>{UPCOMING_CSS}</style>
      <div className="pf-home-group-head">
        <h1 style={{ margin: 0 }}>{f.t('page.title')}</h1>
        <p className="pf-home-muted" style={{ margin: 0 }}>
          <a href={href(RECURRING_PATH)} data-testid="manage-link">
            {f.t('page.manage')}
          </a>
        </p>
      </div>
      <div className="pf-upc-controls">
        <label>
          {f.t('page.window')}{' '}
          <select
            value={days}
            onChange={(e) => onDaysChange(Number(e.target.value))}
            data-testid="upcoming-days"
          >
            {options.map((d) => (
              <option key={d} value={d}>
                {f.t('page.days', { days: d })}
              </option>
            ))}
          </select>
        </label>
        <p className="pf-home-muted" style={{ margin: 0 }} data-testid="upcoming-meta">
          {f.t('page.meta', {
            date: formatInstant(upcoming.meta.generatedAt, f.locale, upcoming.meta.timeZone),
            currency: upcoming.meta.reportingCurrency,
          })}
          {upcoming.meta.dataFreshness
            ? ` · ${f.t('page.freshness', {
                date: formatInstant(upcoming.meta.dataFreshness, f.locale, upcoming.meta.timeZone),
              })}`
            : ''}
        </p>
      </div>
      <section aria-labelledby="upcoming-list-title" className="pf-home-group">
        <h2 id="upcoming-list-title">{f.t('page.listTitle')}</h2>
        <ItemsTable upcoming={upcoming} f={f} href={href} />
      </section>
      <Totals upcoming={upcoming} f={f} />
      <section
        aria-labelledby="committed-page-title"
        className="pf-home-card"
        data-testid="committed-section"
      >
        <h3 id="committed-page-title">{f.t('home.q4Title')}</h3>
        {upcoming.committed ? (
          <CommittedSummary committed={upcoming.committed} f={f} />
        ) : (
          <p data-testid="committed-no-period">{f.t('committed.noPeriod')}</p>
        )}
      </section>
      <ProjectedBalances upcoming={upcoming} f={f} />
      <Surprise surprise={surprise} f={f} />
    </div>
  );
}
