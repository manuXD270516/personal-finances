'use client';

import { useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../../bff/finance-api-client';
import { ProblemMessage } from '../../../errors/ProblemMessage';
import {
  cellStyle,
  mutedStyle,
  numCellStyle,
  pageStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../../common/workspace';
import { formatMoney } from '../../dashboard/format';
import type { FormatContext } from '../../dashboard/types';
import { formatBusinessDate } from '../../planning/logic';
import { debtDetailPath, debtFreeMonth, hasInterest, interestYear, joinMoney, joinNames } from './logic';
import type { DebtSummary } from './types';

const h2Style = { margin: 0, fontSize: 'var(--pf-text-xl)' } as const;

function Totals({ summary, f }: { summary: DebtSummary; f: FormatContext }) {
  const { t, locale } = f;
  const consolidated = summary.totals.consolidated;
  return (
    <section aria-labelledby="debt-totals-title" style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
      <h3 id="debt-totals-title" style={{ margin: 0 }}>
        {t('panel.totals.title')}
      </h3>
      <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={t('panel.totals.caption')}>
        <table style={tableStyle} data-testid="debt-totals-table">
          <caption className="pf-sr-only">{t('panel.totals.caption')}</caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {t('panel.totals.currency')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {t('panel.totals.amount')}
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.totals.byCurrency.map((m) => (
              <tr key={m.currency} data-testid="debt-total-row" data-currency={m.currency}>
                <th scope="row" style={cellStyle}>
                  {m.currency}
                </th>
                <td style={numCellStyle}>{formatMoney(m, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ margin: 0 }} data-testid="debt-consolidated">
        {t('panel.totals.consolidated', {
          currency: summary.baseCurrency,
          amount: formatMoney(consolidated.amount, locale),
        })}
      </p>
      {!consolidated.complete ? (
        <p role="status" style={warningStyle} data-testid="debt-incomplete">
          <span aria-hidden="true">⚠</span>{' '}
          {t('panel.totals.unconverted', { amounts: joinMoney(consolidated.unconverted, locale) })}
        </p>
      ) : null}
    </section>
  );
}

function Debts({
  summary,
  f,
  href,
}: {
  summary: DebtSummary;
  f: FormatContext;
  href: (path: string) => string;
}) {
  const { t, locale } = f;
  return (
    <section aria-labelledby="debt-list-title" style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
      <h3 id="debt-list-title" style={{ margin: 0 }}>
        {t('panel.debts.title')}
      </h3>
      <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={t('panel.debts.region')}>
        <table style={tableStyle} data-testid="debt-debts-table">
          <caption className="pf-sr-only">{t('panel.debts.caption')}</caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {t('panel.debts.debt')}
              </th>
              <th scope="col" style={cellStyle}>
                {t('panel.debts.kind')}
              </th>
              <th scope="col" style={cellStyle}>
                {t('panel.debts.account')}
              </th>
              <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                {t('panel.debts.outstanding')}
              </th>
              <th scope="col" style={cellStyle}>
                {t('panel.debts.payoff')}
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.debts.flatMap((debt) =>
              debt.balances.map((b, index) => {
                const path = debtDetailPath(debt.kind, debt.id);
                return (
                  <tr
                    key={`${debt.kind}|${debt.id}|${b.accountId}`}
                    data-testid="debt-row"
                    data-kind={debt.kind}
                    data-name={debt.name}
                    data-currency={b.outstanding.currency}
                  >
                    <th scope="row" style={cellStyle}>
                      {path ? <a href={href(path)}>{debt.name}</a> : debt.name}
                    </th>
                    <td style={cellStyle}>{t(`panel.debts.kinds.${debt.kind}`)}</td>
                    <td style={cellStyle}>
                      {b.accountName}
                      {!b.includedInNetWorth ? (
                        <div style={mutedStyle} data-testid="debt-not-in-net-worth">
                          <span aria-hidden="true">ⓘ</span> {t('panel.debts.notInNetWorth')}
                        </div>
                      ) : null}
                    </td>
                    <td style={numCellStyle}>{formatMoney(b.outstanding, locale)}</td>
                    <td style={cellStyle} data-testid="debt-payoff">
                      {index === 0
                        ? debt.estimatedPayoffDate
                          ? formatBusinessDate(debt.estimatedPayoffDate)
                          : t('panel.debts.notEstimable')
                        : ''}
                    </td>
                  </tr>
                );
              }),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Credits({ summary, f }: { summary: DebtSummary; f: FormatContext }) {
  if (summary.creditBalances.length === 0) return null;
  const { t, locale } = f;
  return (
    <section aria-labelledby="debt-credits-title" style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
      <h3 id="debt-credits-title" style={{ margin: 0 }}>
        {t('panel.credits.title')}
      </h3>
      <p style={mutedStyle}>{t('panel.credits.note')}</p>
      <ul data-testid="debt-credits" style={{ margin: 0, paddingLeft: '1.25rem' }}>
        {summary.creditBalances.map((c) => (
          <li key={c.accountId}>
            {t('panel.credits.item', { name: c.name, amount: formatMoney(c.amount, locale) })}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Interest({ summary, f }: { summary: DebtSummary; f: FormatContext }) {
  const { t, locale } = f;
  const interest = summary.interestYtd;
  const year = interestYear(summary);
  return (
    <section aria-labelledby="debt-interest-title" style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
      <h3 id="debt-interest-title" style={{ margin: 0 }}>
        {t('panel.interest.title', { year })}
      </h3>
      <p style={mutedStyle}>
        {t('panel.interest.range', {
          from: formatBusinessDate(interest.from),
          to: formatBusinessDate(interest.to),
        })}
      </p>
      {!hasInterest(summary) ? (
        <p data-testid="debt-interest-none">{t('panel.interest.none')}</p>
      ) : (
        <>
          <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={t('panel.interest.caption')}>
            <table style={tableStyle} data-testid="debt-interest-table">
              <caption className="pf-sr-only">{t('panel.interest.caption')}</caption>
              <thead>
                <tr>
                  <th scope="col" style={cellStyle}>
                    {t('panel.interest.currency')}
                  </th>
                  <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                    {t('panel.interest.amount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {interest.byCurrency.map((m) => (
                  <tr key={m.currency} data-testid="debt-interest-row" data-currency={m.currency}>
                    <th scope="row" style={cellStyle}>
                      {m.currency}
                    </th>
                    <td style={numCellStyle}>{formatMoney(m, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p style={{ margin: 0 }} data-testid="debt-interest-consolidated">
            {t('panel.interest.consolidated', {
              currency: summary.baseCurrency,
              amount: formatMoney(interest.consolidated.amount, locale),
            })}
          </p>
          {!interest.consolidated.complete ? (
            <p role="status" style={warningStyle} data-testid="debt-interest-incomplete">
              <span aria-hidden="true">⚠</span>{' '}
              {t('panel.totals.unconverted', {
                amounts: joinMoney(interest.consolidated.unconverted, locale),
              })}
            </p>
          ) : null}
          <div
            style={tableWrapStyle}
            tabIndex={0}
            role="region"
            aria-label={t('panel.interest.attributionRegion')}
          >
            <table style={tableStyle} data-testid="debt-attribution-table">
              <caption className="pf-sr-only">{t('panel.interest.attributionCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col" style={cellStyle}>
                    {t('panel.interest.source')}
                  </th>
                  <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                    {t('panel.interest.amount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {interest.attribution
                  .filter((a) => a.kind !== 'OTHER' || a.byCurrency.length > 0)
                  .map((a) => (
                    <tr key={`${a.kind}|${a.id ?? ''}`} data-testid="debt-attribution-row" data-kind={a.kind}>
                      <th scope="row" style={cellStyle}>
                        {a.kind === 'OTHER' ? t('panel.interest.other') : (a.name ?? '')}
                      </th>
                      <td style={numCellStyle}>{joinMoney(a.byCurrency, locale)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!interest.attributionConsistent ? (
            <p role="status" style={warningStyle} data-testid="debt-attribution-inconsistent">
              <span aria-hidden="true">⚠</span> {t('panel.interest.inconsistent')}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function DebtFree({ summary, f }: { summary: DebtSummary; f: FormatContext }) {
  const { t, locale } = f;
  const { date, excluded } = summary.debtFree;
  return (
    <section aria-labelledby="debt-free-title" style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
      <h3 id="debt-free-title" style={{ margin: 0 }}>
        {t('panel.debtFree.title')}
      </h3>
      <p style={{ margin: 0 }} data-testid="debt-free-date">
        {date
          ? t('panel.debtFree.date', { date: `${debtFreeMonth(date, locale)} (${formatBusinessDate(date)})` })
          : t('panel.debtFree.none')}
      </p>
      <p style={mutedStyle} data-testid="debt-free-assumptions">
        {t('panel.debtFree.assumptions')}
      </p>
      {excluded.length > 0 ? (
        <p style={mutedStyle} data-testid="debt-free-excluded">
          <span aria-hidden="true">ⓘ</span>{' '}
          {t('panel.debtFree.excluded', { names: joinNames(excluded.map((e) => e.name)) })}
        </p>
      ) : null}
    </section>
  );
}

function Dues({ summary, f }: { summary: DebtSummary; f: FormatContext }) {
  const { t, locale } = f;
  return (
    <section aria-labelledby="debt-dues-title" style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
      <h3 id="debt-dues-title" style={{ margin: 0 }}>
        {t('panel.dues.title')}
      </h3>
      {summary.upcomingDues.length === 0 ? (
        <p style={mutedStyle} data-testid="debt-dues-none">
          {t('panel.dues.none')}
        </p>
      ) : (
        <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={t('panel.dues.region')}>
          <table style={tableStyle} data-testid="debt-dues-table">
            <caption className="pf-sr-only">{t('panel.dues.caption')}</caption>
            <thead>
              <tr>
                <th scope="col" style={cellStyle}>
                  {t('panel.dues.debt')}
                </th>
                <th scope="col" style={cellStyle}>
                  {t('panel.dues.due')}
                </th>
                <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {t('panel.dues.amount')}
                </th>
                <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {t('panel.dues.minimum')}
                </th>
                <th scope="col" style={cellStyle}>
                  {t('panel.dues.overdue')}
                </th>
              </tr>
            </thead>
            <tbody>
              {summary.upcomingDues.map((d) => (
                <tr key={`${d.kind}|${d.id}|${d.accountId}`} data-testid="debt-due-row" data-name={d.name}>
                  <th scope="row" style={cellStyle}>
                    {d.name}
                  </th>
                  <td style={cellStyle}>{formatBusinessDate(d.dueDate)}</td>
                  <td style={numCellStyle}>
                    {formatMoney(d.amount, locale)}
                    {d.estimated ? <div style={mutedStyle}>{t('panel.dues.estimated')}</div> : null}
                  </td>
                  <td style={numCellStyle}>{d.minimum ? formatMoney(d.minimum, locale) : '—'}</td>
                  <td style={cellStyle}>
                    {d.overdueDays > 0 ? (
                      <span style={{ color: 'var(--pf-error)' }}>
                        <span aria-hidden="true">⚠</span> {t('card.overdueDays', { days: d.overdueDays })}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Pestaña Resumen de `/debts` (openspec add-debt-summary): total adeudado por moneda y consolidado, deudas con su fecha
 * estimada, saldos a favor, interés del año con su desglose, fecha libre de deudas con sus supuestos y próximos
 * vencimientos. Tablas con encabezados de fila y columna; avisos con texto e icono.
 */
export function DebtSummaryView({
  summary,
  f,
  href,
}: {
  summary: DebtSummary;
  f: FormatContext;
  href: (path: string) => string;
}) {
  const { t } = f;
  return (
    <section
      aria-labelledby="debt-summary-title"
      style={pageStyle}
      data-testid="debt-summary"
      data-state={summary.status}
    >
      <h2 id="debt-summary-title" style={h2Style}>
        {t('panel.title')}
      </h2>
      <p style={mutedStyle}>{t('panel.intro')}</p>
      <p style={mutedStyle} data-testid="debt-as-of">
        {t('panel.asOf', { date: formatBusinessDate(summary.asOf) })}
      </p>
      {summary.status === 'NO_LIABILITIES' ? (
        <p data-testid="debt-summary-no-liabilities">{t('panel.noLiabilities')}</p>
      ) : (
        <>
          {summary.status === 'NO_DEBT' ? (
            <p data-testid="debt-summary-no-debt">{t('panel.noDebt')}</p>
          ) : (
            <>
              <Totals summary={summary} f={f} />
              <Debts summary={summary} f={f} href={href} />
            </>
          )}
          <Credits summary={summary} f={f} />
          <Interest summary={summary} f={f} />
          {summary.status === 'ACTIVE' ? (
            <>
              <DebtFree summary={summary} f={f} />
              <Dues summary={summary} f={f} />
            </>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Carga `GET /debts/summary` del workspace activo. */
export function DebtSummaryPanel({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('DebtSummary', ctx);
  const [summary, setSummary] = useState<DebtSummary | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<DebtSummary>(`${ctx.base}/debts/summary`)
      .then((r) => {
        if (!cancelled) setSummary(r.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base]);

  if (problem) return <ProblemMessage problem={problem} locale={ctx.uiLocale} />;
  if (!summary) return <p aria-busy="true">{f.t('panel.loading')}</p>;
  return <DebtSummaryView summary={summary} f={f} href={ctx.href} />;
}
