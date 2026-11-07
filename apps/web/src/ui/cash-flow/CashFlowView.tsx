import type { ReactNode } from 'react';
import { formatInstant, formatLocalDate, formatMoney, isNegative } from '../dashboard/format';
import { RateAttributionLink, RateSourceBadge } from '../dashboard/RateSourceBadge';
import type { FormatContext } from '../dashboard/types';
import { CashFlowChart } from './CashFlowChart';
import {
  accountsOf,
  CASH_FLOW_HORIZONS,
  eventSign,
  eventsByDay,
  hasNoAmount,
  occurrencePathOf,
  pickCurrency,
  RISK_GLYPH,
  seriesAccount,
  seriesRows,
  type CashFlowSelection,
} from './logic';
import { CASH_FLOW_CSS } from './styles';
import type { CashFlowCalendar, CashFlowCurrency, CashFlowEvent, CashFlowRisk } from './types';

export interface CashFlowViewProps {
  readonly calendar: CashFlowCalendar;
  readonly selection: CashFlowSelection;
  /** Textos del namespace `CashFlow` y formato del workspace. */
  readonly f: FormatContext;
  /** Contexto del namespace `Dashboard`: el distintivo de tasa (`RateSourceBadge`) usa sus claves `rate.*`. */
  readonly rateCtx: FormatContext;
  /** Cambia la selección (horizonte, moneda o cuenta); la página la refleja en la URL y vuelve a leer. */
  readonly onSelect: (next: Partial<CashFlowSelection>) => void;
  /** Localiza una ruta con el prefijo de idioma. */
  readonly href: (path: string) => string;
}

function RiskBadge({ risk, f }: { risk: CashFlowRisk; f: FormatContext }) {
  return (
    <span className="pf-cf-badge" data-risk={risk} data-testid="cash-flow-risk">
      <span aria-hidden="true">{RISK_GLYPH[risk]}</span> {f.t(`risk.${risk}`)}
    </span>
  );
}

/** Selectores de horizonte (7/30/60/90), moneda y cuenta: grupos de opciones nativas, operables con teclado. */
function Controls({
  calendar,
  selection,
  current,
  f,
  onSelect,
}: Pick<CashFlowViewProps, 'calendar' | 'selection' | 'f' | 'onSelect'> & {
  current: CashFlowCurrency | undefined;
}) {
  const accounts = current ? accountsOf(calendar, current.currency) : [];
  return (
    <div className="pf-cf-controls" data-testid="cash-flow-controls">
      <fieldset>
        <legend>{f.t('controls.horizon')}</legend>
        {CASH_FLOW_HORIZONS.map((days) => (
          <label key={days} className="pf-cf-choice">
            <input
              type="radio"
              name="cash-flow-horizon"
              data-testid={`cash-flow-horizon-${days}`}
              checked={selection.horizon === days}
              onChange={() => onSelect({ horizon: days, accountId: undefined })}
            />
            {f.t('controls.days', { days })}
          </label>
        ))}
      </fieldset>
      {calendar.currencies.length > 1 ? (
        <fieldset>
          <legend>{f.t('controls.currency')}</legend>
          {calendar.currencies.map((c) => (
            <label key={c.currency} className="pf-cf-choice">
              <input
                type="radio"
                name="cash-flow-currency"
                data-testid={`cash-flow-currency-${c.currency}`}
                checked={current?.currency === c.currency}
                onChange={() => onSelect({ currency: c.currency, accountId: undefined })}
              />
              {c.currency}
            </label>
          ))}
        </fieldset>
      ) : null}
      {accounts.length > 0 ? (
        <div style={{ display: 'grid', gap: 'var(--pf-space-1)' }}>
          <label htmlFor="cash-flow-account">{f.t('controls.account')}</label>
          <select
            id="cash-flow-account"
            data-testid="cash-flow-account"
            value={selection.accountId ?? ''}
            onChange={(e) => onSelect({ accountId: e.target.value || undefined })}
          >
            <option value="">{f.t('controls.allAccounts', { currency: current?.currency ?? '' })}</option>
            {accounts.map((a) => (
              <option key={a.accountId} value={a.accountId}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </div>
  );
}

/** Una fila por moneda: así ninguna moneda con riesgo queda escondida detrás del selector. */
function CurrencySummary({
  calendar,
  current,
  f,
}: {
  calendar: CashFlowCalendar;
  current: CashFlowCurrency | undefined;
  f: FormatContext;
}) {
  return (
    <div className="pf-cf-card" data-testid="cash-flow-currencies">
      <div className="pf-cf-table-wrap">
        <table className="pf-cf-table">
          <caption>{f.t('summary.caption')}</caption>
          <thead>
            <tr>
              <th scope="col">{f.t('summary.currency')}</th>
              <th scope="col">{f.t('summary.risk')}</th>
              <th scope="col" data-num>
                {f.t('summary.lowest')}
              </th>
              <th scope="col">{f.t('summary.lowestDate')}</th>
            </tr>
          </thead>
          <tbody>
            {calendar.currencies.map((c) => (
              <tr
                key={c.currency}
                data-testid="cash-flow-currency-row"
                data-currency={c.currency}
                data-risk={c.risk}
                aria-current={current?.currency === c.currency ? 'true' : undefined}
              >
                <th scope="row">{c.currency}</th>
                <td>
                  <RiskBadge risk={c.risk} f={f} />
                </td>
                <td data-num>{formatMoney(c.lowest.amount, f.locale)}</td>
                <td>{formatLocalDate(c.lowest.date, f.locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RiskDetail({ currency: c, f }: { currency: CashFlowCurrency; f: FormatContext }) {
  const { locale } = f;
  const thresholdText =
    c.threshold.source === 'MINIMUM_RESERVE'
      ? f.t('risk.thresholdReserve', { amount: formatMoney(c.threshold.amount, locale) })
      : f.t('risk.thresholdZero');
  return (
    <div className="pf-cf-card" data-testid="cash-flow-risk-card" data-risk={c.risk}>
      <p>
        <RiskBadge risk={c.risk} f={f} /> <span className="pf-cf-muted">{thresholdText}</span>
      </p>
      {c.risk === 'NONE' ? <p>{f.t('risk.noneHelp')}</p> : null}
      {c.risk === 'LOW' ? <p>{f.t('risk.lowHelp')}</p> : null}
      {c.risk === 'POSSIBLE' ? <p>{f.t('risk.possibleHelp')}</p> : null}
      {c.risk === 'HIGH' ? <p>{f.t('risk.highHelp')}</p> : null}
      {c.firstShortfallDate ? (
        <p data-testid="cash-flow-first-shortfall">
          {f.t('risk.firstShortfall', { date: formatLocalDate(c.firstShortfallDate, locale) })}
          {c.shortfallAmount ? (
            <>
              {' '}
              <strong data-testid="cash-flow-shortfall">
                {f.t('risk.shortfall', { amount: formatMoney(c.shortfallAmount, locale) })}
              </strong>
            </>
          ) : null}
        </p>
      ) : null}
      {c.belowZero ? (
        <p role="status" className="pf-cf-notice" data-testid="cash-flow-below-zero">
          <span aria-hidden="true">⚠</span> {f.t('risk.belowZero')}
        </p>
      ) : null}
    </div>
  );
}

function Kpi({ label, children, testId }: { label: string; children: ReactNode; testId: string }) {
  return (
    <div className="pf-cf-kpi" data-testid={testId}>
      <span className="pf-cf-muted">{label}</span>
      {children}
    </div>
  );
}

function SeriesTable({
  rows,
  hasPlanned,
  f,
  caption,
}: {
  rows: ReturnType<typeof seriesRows>;
  hasPlanned: boolean;
  f: FormatContext;
  caption: string;
}) {
  const { locale } = f;
  return (
    <details data-testid="cash-flow-table-details">
      <summary>{f.t('table.show')}</summary>
      <div className="pf-cf-table-wrap">
        <table className="pf-cf-table" data-testid="cash-flow-table">
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{f.t('table.date')}</th>
              <th scope="col" data-num>
                {f.t('table.balance')}
              </th>
              <th scope="col" data-num>
                {f.t('table.low')}
              </th>
              {hasPlanned ? (
                <th scope="col" data-num>
                  {f.t('table.planned')}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.date}
                data-testid="cash-flow-row"
                data-date={r.date}
                data-below={String(r.belowThreshold)}
              >
                <th scope="row">{formatLocalDate(r.date, locale)}</th>
                <td data-num>{formatMoney(r.balance, locale)}</td>
                <td data-num>
                  {formatMoney(r.low, locale)}
                  {r.belowThreshold ? (
                    <>
                      {' '}
                      <span className="pf-cf-tag" data-tone="warn">
                        <span aria-hidden="true">⚠</span> {f.t('table.belowThreshold')}
                      </span>
                    </>
                  ) : null}
                </td>
                {hasPlanned ? <td data-num>{r.planned ? formatMoney(r.planned, locale) : '—'}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function CurrencySection({
  calendar,
  c,
  selection,
  f,
  onSelect,
}: Pick<CashFlowViewProps, 'calendar' | 'selection' | 'f' | 'onSelect'> & { c: CashFlowCurrency }) {
  const { locale } = f;
  const accountSeries = seriesAccount(calendar);
  const useAccount = accountSeries && selection.accountId === accountSeries.accountId;
  const series = useAccount ? accountSeries.series! : c.series;
  const planned = useAccount ? null : c.planned;
  const threshold = useAccount ? undefined : c.threshold.amount;
  const lowestDate = useAccount ? accountSeries.lowest.date : c.lowest.date;
  const noPlan = calendar.plannedSpending.periods.filter((p) => p.status === 'NO_PLAN');
  const title = useAccount
    ? f.t('chart.accountTitle', { name: accountSeries.name, days: calendar.horizonDays })
    : f.t('chart.title', { currency: c.currency, days: calendar.horizonDays });
  const rows = seriesRows(series, planned, threshold ?? null);
  return (
    <section
      className="pf-cf-card"
      aria-labelledby={`cash-flow-${c.currency}-title`}
      data-testid="cash-flow-currency"
      data-currency={c.currency}
    >
      <h2 id={`cash-flow-${c.currency}-title`}>{f.t('currency.title', { currency: c.currency })}</h2>
      <RiskDetail currency={c} f={f} />
      <div className="pf-cf-kpis">
        <Kpi label={f.t('kpi.start')} testId="cash-flow-start">
          <strong>{formatMoney(c.startBalance, locale)}</strong>
        </Kpi>
        <Kpi label={f.t('kpi.lowest')} testId="cash-flow-lowest">
          <strong data-negative={isNegative(c.lowest.amount.amount) ? 'true' : 'false'}>
            {formatMoney(c.lowest.amount, locale)}
          </strong>
          <span className="pf-cf-muted">{formatLocalDate(c.lowest.date, locale)}</span>
        </Kpi>
        <Kpi label={f.t('kpi.end')} testId="cash-flow-end">
          <strong>{formatMoney(c.endBalance, locale)}</strong>
        </Kpi>
        <Kpi label={f.t('kpi.outflow')} testId="cash-flow-outflow">
          <strong>{formatMoney(c.outflowTotal, locale)}</strong>
        </Kpi>
        <Kpi label={f.t('kpi.inflow')} testId="cash-flow-inflow">
          <strong>{formatMoney(c.inflowTotal, locale)}</strong>
        </Kpi>
      </div>
      {c.withoutAmountCount > 0 ? (
        <p className="pf-cf-muted" data-testid="cash-flow-without-amount">
          <span aria-hidden="true">ⓘ</span> {f.t('currency.withoutAmount', { count: c.withoutAmountCount })}
        </p>
      ) : null}
      {useAccount ? (
        <p className="pf-cf-muted" data-testid="cash-flow-account-note">
          {f.t('chart.accountNote', { name: accountSeries.name })}{' '}
          <button type="button" onClick={() => onSelect({ accountId: undefined })}>
            {f.t('chart.backToCurrency', { currency: c.currency })}
          </button>
        </p>
      ) : null}
      <CashFlowChart
        id={`cash-flow-chart-${c.currency}`}
        series={series}
        planned={planned?.series}
        threshold={threshold}
        lowestDate={lowestDate}
        locale={locale}
        labels={{
          title,
          description: f.t('chart.description', {
            low: formatMoney((useAccount ? accountSeries.lowest : c.lowest).amount, locale),
            date: formatLocalDate(lowestDate, locale),
          }),
          balance: f.t('chart.balance'),
          planned: f.t('chart.planned'),
          threshold: threshold
            ? c.threshold.source === 'MINIMUM_RESERVE'
              ? f.t('chart.thresholdReserve', { amount: formatMoney(threshold, locale) })
              : f.t('chart.thresholdZero')
            : undefined,
          lowest: f.t('chart.lowest'),
        }}
      />
      <SeriesTable rows={rows} hasPlanned={planned !== null} f={f} caption={title} />
      <div className="pf-cf-kpis" data-testid="cash-flow-scenarios">
        <Kpi label={f.t('scenarios.withoutIncome')} testId="cash-flow-without-income">
          <strong>{formatMoney(c.withoutExpectedIncome.lowest.amount, locale)}</strong>
          <span className="pf-cf-muted">
            {f.t('scenarios.lowestOn', {
              date: formatLocalDate(c.withoutExpectedIncome.lowest.date, locale),
            })}
            {' · '}
            {f.t('scenarios.endsAt', { amount: formatMoney(c.withoutExpectedIncome.endBalance, locale) })}
          </span>
        </Kpi>
        {c.planned ? (
          <Kpi label={f.t('scenarios.withPlan')} testId="cash-flow-with-plan">
            <strong>{formatMoney(c.planned.lowest.amount, locale)}</strong>
            <span className="pf-cf-muted">
              {f.t('scenarios.lowestOn', { date: formatLocalDate(c.planned.lowest.date, locale) })}
              {' · '}
              {f.t('scenarios.endsAt', { amount: formatMoney(c.planned.endBalance, locale) })}
            </span>
          </Kpi>
        ) : null}
      </div>
      {noPlan.length > 0 ? (
        <p className="pf-cf-muted" data-testid="cash-flow-no-plan">
          <span aria-hidden="true">ⓘ</span>{' '}
          {f.t('scenarios.noPlan', { periods: noPlan.map((p) => p.label).join(', ') })}
        </p>
      ) : null}
    </section>
  );
}

function AccountsSection({
  calendar,
  current,
  selection,
  f,
  onSelect,
}: Pick<CashFlowViewProps, 'calendar' | 'selection' | 'f' | 'onSelect'> & {
  current: CashFlowCurrency;
}) {
  const { locale } = f;
  const accounts = accountsOf(calendar, current.currency);
  if (accounts.length === 0) return null;
  return (
    <section
      className="pf-cf-card"
      aria-labelledby="cash-flow-accounts-title"
      data-testid="cash-flow-accounts"
    >
      <h2 id="cash-flow-accounts-title">{f.t('accounts.title')}</h2>
      <div className="pf-cf-table-wrap">
        <table className="pf-cf-table">
          <caption>{f.t('accounts.caption', { currency: current.currency })}</caption>
          <thead>
            <tr>
              <th scope="col">{f.t('accounts.account')}</th>
              <th scope="col" data-num>
                {f.t('accounts.start')}
              </th>
              <th scope="col" data-num>
                {f.t('accounts.lowest')}
              </th>
              <th scope="col">{f.t('accounts.lowestDate')}</th>
              <th scope="col" data-num>
                {f.t('accounts.end')}
              </th>
              <th scope="col">
                <span className="pf-cf-sr">{f.t('accounts.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.accountId} data-testid="cash-flow-account-row" data-account-id={a.accountId}>
                <th scope="row">{a.name}</th>
                <td data-num>{formatMoney(a.startBalance, locale)}</td>
                <td data-num>{formatMoney(a.lowest.amount, locale)}</td>
                <td>{formatLocalDate(a.lowest.date, locale)}</td>
                <td data-num>{formatMoney(a.endBalance, locale)}</td>
                <td>
                  {selection.accountId === a.accountId ? (
                    <span className="pf-cf-tag">{f.t('accounts.showing')}</span>
                  ) : (
                    <button type="button" onClick={() => onSelect({ accountId: a.accountId })}>
                      {f.t('accounts.showSeries', { name: a.name })}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EventLine({
  event: e,
  calendar,
  f,
  href,
}: {
  event: CashFlowEvent;
  calendar: CashFlowCalendar;
  f: FormatContext;
  href: (path: string) => string;
}) {
  const { locale } = f;
  const account = calendar.accounts.find((a) => a.accountId === e.accountId);
  const label = e.name ?? f.t(`event.kind.${e.kind}`);
  const occurrencePath = occurrencePathOf(e);
  const sign = eventSign(e.kind);
  return (
    <li
      className="pf-cf-event"
      data-testid="cash-flow-event"
      data-kind={e.kind}
      data-certainty={e.certainty}
      data-overdue={String(e.overdue)}
      data-source={e.source}
    >
      <span className="pf-cf-event-main">
        <span>
          {occurrencePath ? <a href={href(occurrencePath)}>{label}</a> : <strong>{label}</strong>}{' '}
          <span className="pf-cf-tag" data-testid="cash-flow-event-certainty">
            {f.t(`event.certainty.${e.certainty}`)}
          </span>{' '}
          <span className="pf-cf-tag">{f.t(`event.kind.${e.kind}`)}</span>
        </span>
        <span className="pf-cf-muted">
          {account ? account.name : null}
          {e.overdue && e.daysOverdue !== null ? (
            <>
              {account ? ' · ' : null}
              <span className="pf-cf-tag" data-tone="warn" data-testid="cash-flow-event-overdue">
                <span aria-hidden="true">⚠</span>{' '}
                {f.t('event.overdue', { days: e.daysOverdue, date: formatLocalDate(e.originalDate, locale) })}
              </span>
            </>
          ) : null}
        </span>
      </span>
      <span className="pf-cf-num" data-testid="cash-flow-event-amount">
        {hasNoAmount(e) ? (
          <em>{f.t('event.noAmount')}</em>
        ) : (
          <>
            {sign}
            {formatMoney(e.amount!, locale)}
            {e.toAmount ? <> → {formatMoney(e.toAmount, locale)}</> : null}
          </>
        )}
      </span>
    </li>
  );
}

function EventsSection({
  calendar,
  current,
  f,
  href,
}: Pick<CashFlowViewProps, 'calendar' | 'f' | 'href'> & { current: CashFlowCurrency }) {
  const days = eventsByDay(calendar, current.currency);
  return (
    <section className="pf-cf-card" aria-labelledby="cash-flow-events-title" data-testid="cash-flow-events">
      <h2 id="cash-flow-events-title">{f.t('events.title', { currency: current.currency })}</h2>
      {days.length === 0 ? (
        <p className="pf-cf-muted" data-testid="cash-flow-events-empty">
          {f.t('events.empty')}
        </p>
      ) : (
        <ol className="pf-cf-days">
          {days.map((d) => (
            <li key={d.date} className="pf-cf-day" data-testid="cash-flow-day" data-date={d.date}>
              <h3>{formatLocalDate(d.date, f.locale)}</h3>
              <ul className="pf-cf-events">
                {d.events.map((e) => (
                  <EventLine key={e.id} event={e} calendar={calendar} f={f} href={href} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ConsolidatedSection({
  calendar,
  f,
  rateCtx,
}: Pick<CashFlowViewProps, 'calendar' | 'f' | 'rateCtx'>) {
  const { locale } = f;
  const { consolidated, meta } = calendar;
  if (calendar.currencies.length < 2 && !consolidated.lowest && consolidated.unconverted.length === 0)
    return null;
  return (
    <section
      className="pf-cf-card"
      aria-labelledby="cash-flow-consolidated-title"
      data-testid="cash-flow-consolidated"
      data-complete={String(consolidated.complete)}
    >
      <h2 id="cash-flow-consolidated-title">
        {f.t('consolidated.title', { currency: calendar.reportingCurrency })}
      </h2>
      <p className="pf-cf-muted">{f.t('consolidated.help')}</p>
      {consolidated.lowest ? (
        <p>
          <strong data-testid="cash-flow-consolidated-lowest">
            {formatMoney(consolidated.lowest.amount, locale)}
          </strong>{' '}
          <span className="pf-cf-muted">{formatLocalDate(consolidated.lowest.date, locale)}</span>
        </p>
      ) : (
        <p data-testid="cash-flow-consolidated-none">{f.t('consolidated.none')}</p>
      )}
      {!consolidated.complete ? (
        <div className="pf-cf-notice" data-testid="cash-flow-consolidated-incomplete" role="status">
          <p>{f.t('consolidated.incomplete')}</p>
          <ul className="pf-cf-list">
            {consolidated.unconverted.map((m) => (
              <li key={m.currency} data-testid="cash-flow-unconverted" data-currency={m.currency}>
                {f.t('consolidated.unconverted', { amount: formatMoney(m, locale) })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {meta.ratesUsed.length > 0 ? (
        <ul className="pf-cf-list" data-testid="cash-flow-rates">
          {meta.ratesUsed.map((r) => (
            <li key={`${r.rate.base}/${r.rate.quote}/${r.asOf}`}>
              <RateSourceBadge rate={r} ctx={rateCtx} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SuggestionsSection({ calendar, f, rateCtx }: Pick<CashFlowViewProps, 'calendar' | 'f' | 'rateCtx'>) {
  if (calendar.suggestions.length === 0) return null;
  const { locale } = f;
  return (
    <section
      className="pf-cf-card"
      aria-labelledby="cash-flow-suggestions-title"
      data-testid="cash-flow-suggestions"
    >
      <h2 id="cash-flow-suggestions-title">{f.t('suggestions.title')}</h2>
      <p className="pf-cf-muted">{f.t('suggestions.help')}</p>
      <ul className="pf-cf-list">
        {calendar.suggestions.map((s) => (
          <li key={`${s.fromCurrency}-${s.toCurrency}-${s.before}`} data-testid="cash-flow-suggestion">
            <p>
              {f.t('suggestions.line', {
                amount: formatMoney(s.approxAmount, locale),
                to: s.toCurrency,
                date: formatLocalDate(s.before, locale),
              })}
            </p>
            <RateSourceBadge rate={s.rate} ctx={rateCtx} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Calendario de flujo de caja (`/flujo-de-caja`; reporting/cash-flow-calendar, FR-REPORTING-014): saldo esperado de las
 * cuentas líquidas día a día con el horizonte 7/30/60/90, por moneda, con la reserva mínima como umbral, el riesgo de
 * déficit, el peor caso sin ingresos, las cuentas con su saldo más bajo, los eventos por día (certeza, vencidos y
 * variables sin monto), la cobertura, el consolidado informativo con las tasas y atribuciones de la fuente y las
 * sugerencias de conversión (aproximadas; nunca ejecutan nada). Presentacional: sin cuentas líquidas muestra un estado
 * vacío que ofrece crear una cuenta, jamás un cero.
 */
export function CashFlowView(props: CashFlowViewProps & { createAccountHref?: string | undefined }) {
  const { calendar, f, selection, onSelect, rateCtx, href, createAccountHref } = props;
  const { locale, timeZone } = f;
  const current = pickCurrency(calendar.currencies, selection.currency);
  return (
    <div className="pf-cf" data-testid="cash-flow-page" data-horizon={calendar.horizonDays}>
      <style>{CASH_FLOW_CSS}</style>
      <header style={{ display: 'grid', gap: 'var(--pf-space-1)' }}>
        <h1>{f.t('title')}</h1>
        <p className="pf-cf-muted">
          {f.t('subtitle', {
            from: formatLocalDate(calendar.from, locale),
            to: formatLocalDate(calendar.to, locale),
          })}
        </p>
      </header>
      {!current ? (
        <div className="pf-cf-card" data-testid="cash-flow-empty">
          <p>{f.t('empty.text')}</p>
          {createAccountHref ? (
            <p>
              <a href={createAccountHref} data-testid="cash-flow-create-account">
                {f.t('empty.action')}
              </a>
            </p>
          ) : null}
        </div>
      ) : (
        <>
          <Controls calendar={calendar} selection={selection} current={current} f={f} onSelect={onSelect} />
          {!calendar.coverage.complete ? (
            <p className="pf-cf-notice" role="status" data-testid="cash-flow-coverage-incomplete">
              <span aria-hidden="true">⚠</span>{' '}
              {f.t('coverage.incomplete', { through: formatLocalDate(calendar.coverage.through, locale) })}
            </p>
          ) : null}
          <CurrencySummary calendar={calendar} current={current} f={f} />
          <CurrencySection calendar={calendar} c={current} selection={selection} f={f} onSelect={onSelect} />
          <AccountsSection
            calendar={calendar}
            current={current}
            selection={selection}
            f={f}
            onSelect={onSelect}
          />
          <EventsSection calendar={calendar} current={current} f={f} href={href} />
          <ConsolidatedSection calendar={calendar} f={f} rateCtx={rateCtx} />
          <SuggestionsSection calendar={calendar} f={f} rateCtx={rateCtx} />
        </>
      )}
      <footer className="pf-cf-footer" data-testid="cash-flow-meta">
        <p>
          <span data-testid="cash-flow-generated-at">
            {f.t('meta.generatedAt', { date: formatInstant(calendar.meta.generatedAt, locale, timeZone) })}
          </span>
          {calendar.meta.dataFreshness ? (
            <>
              {' · '}
              <span data-testid="cash-flow-freshness">
                {f.t('meta.freshness', {
                  date: formatInstant(calendar.meta.dataFreshness, locale, timeZone),
                })}
              </span>
            </>
          ) : null}
          {' · '}
          {f.t('meta.reportingCurrency', { currency: calendar.reportingCurrency })}
        </p>
        <p>{f.t('meta.help')}</p>
        {calendar.meta.attributions.length > 0 ? (
          <ul className="pf-cf-list" data-testid="attributions">
            {calendar.meta.attributions.map((a) => (
              <li key={a.provider} data-provider={a.provider}>
                <RateAttributionLink attribution={a} />
              </li>
            ))}
          </ul>
        ) : null}
      </footer>
    </div>
  );
}
