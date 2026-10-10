'use client';

import { useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { formatDecimal } from '../AuditHistory';
import { trimRate } from '../common/money';
import {
  cardStyle,
  cellStyle,
  mutedStyle,
  numCellStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate, periodName } from '../planning/logic';
import { committedItemPath } from './logic';
import type { CommittedAmount } from './types';

/**
 * Tarjeta "Comprometido del periodo" (Q4, FR-COMMITMENTS-011): total por moneda y consolidado en la moneda base con la
 * misma valoración que el Home. Si falta una tasa el total es parcial (`complete = false`): se avisa y se listan las
 * partes sin convertir, nunca se asumen 1:1. Los pagos `VARIABLE` no suman y se informan ("N pagos sin monto", D115);
 * el ingreso esperado es informativo. El desglose explica la composición (ocurrencias y gastos pendientes).
 */
export function CommittedView({
  committed,
  f,
  href,
}: {
  committed: CommittedAmount;
  f: FormatContext;
  href: (path: string) => string;
}) {
  const { consolidated } = committed;
  return (
    <section
      aria-labelledby="committed-title"
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)' }}
      data-testid="committed-card"
      data-complete={consolidated.complete}
    >
      <div>
        <h2 id="committed-title" style={{ margin: 0 }}>
          {f.t('committed.title')}
        </h2>
        <p style={{ ...mutedStyle, margin: 0 }}>
          {f.t('committed.period', {
            name: periodName(committed.periodLabel, f.locale),
            from: formatBusinessDate(committed.periodStart),
            to: formatBusinessDate(committed.periodEnd),
          })}
        </p>
      </div>
      <p style={{ margin: 0, fontSize: 'var(--pf-text-2xl)', fontWeight: 600 }} data-testid="committed-total">
        {formatMoney(consolidated.amount, f.locale)}
      </p>
      {!consolidated.complete ? (
        <div role="note" style={warningStyle} data-testid="committed-incomplete">
          <strong>
            <span aria-hidden="true">⚠</span> {f.t('committed.incomplete')}
          </strong>
          <p style={{ margin: 0 }}>
            {f.t('committed.unconverted', {
              parts: consolidated.unconverted.map((m) => formatMoney(m, f.locale)).join(', '),
            })}
          </p>
        </div>
      ) : null}
      {committed.withoutAmountCount > 0 ? (
        <p style={{ margin: 0 }} data-testid="committed-without-amount">
          <span aria-hidden="true">ℹ</span>{' '}
          {f.t('committed.withoutAmount', { count: committed.withoutAmountCount })}
        </p>
      ) : null}
      {committed.byCurrency.length > 0 ? (
        <div style={tableWrapStyle}>
          <table style={tableStyle} data-testid="committed-by-currency">
            <caption className="pf-sr-only">{f.t('committed.byCurrency')}</caption>
            <thead>
              <tr>
                <th scope="col" style={cellStyle}>
                  {f.t('committed.currency')}
                </th>
                <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {f.t('committed.occurrences')}
                </th>
                <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {f.t('committed.pending')}
                </th>
                <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                  {f.t('committed.total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {committed.byCurrency.map((row) => (
                <tr key={row.currency} data-currency={row.currency}>
                  <th scope="row" style={cellStyle}>
                    {row.currency}
                  </th>
                  <td style={numCellStyle}>{formatDecimal(row.occurrences.amount, f.locale)}</td>
                  <td style={numCellStyle}>{formatDecimal(row.pending.amount, f.locale)}</td>
                  <td style={numCellStyle}>
                    <strong>{formatMoney(row.total, f.locale)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={mutedStyle}>{f.t('committed.none')}</p>
      )}
      {committed.expectedIncome.length > 0 ? (
        <p style={{ margin: 0 }} data-testid="committed-income">
          {f.t('committed.expectedIncome', {
            amounts: committed.expectedIncome.map((m) => formatMoney(m, f.locale)).join(', '),
          })}
        </p>
      ) : null}
      {committed.ratesUsed.length > 0 ? (
        <p style={mutedStyle} data-testid="committed-rates">
          {f.t('committed.rates', {
            rates: committed.ratesUsed
              .map((r) => `${r.rate.base}→${r.rate.quote} ${trimRate(r.rate.value)}`)
              .join(', '),
          })}
        </p>
      ) : null}
      {committed.items.length > 0 ? (
        <details data-testid="committed-breakdown">
          <summary>{f.t('committed.breakdown', { count: committed.items.length })}</summary>
          <div style={tableWrapStyle}>
            <table style={tableStyle}>
              <caption className="pf-sr-only">{f.t('committed.breakdownCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col" style={cellStyle}>
                    {f.t('columns.due')}
                  </th>
                  <th scope="col" style={cellStyle}>
                    {f.t('committed.item')}
                  </th>
                  <th scope="col" style={cellStyle}>
                    {f.t('committed.source')}
                  </th>
                  <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                    {f.t('columns.amount')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {committed.items.map((item) => (
                  <tr key={`${item.source}-${item.id}`} data-source={item.source}>
                    <td style={cellStyle}>{formatBusinessDate(item.date)}</td>
                    <td style={cellStyle}>
                      <a href={href(committedItemPath(item))}>{item.name ?? f.t('committed.unnamed')}</a>
                    </td>
                    <td style={cellStyle}>
                      {item.source === 'OCCURRENCE'
                        ? f.t('committed.fromOccurrence', {
                            status: item.status ? f.t(`status.${item.status}`) : '',
                          })
                        : f.t('committed.fromPending')}
                    </td>
                    <td style={numCellStyle}>
                      {item.amount ? formatMoney(item.amount, f.locale) : f.t('amount.none')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}

/** Tarjeta conectada: consulta `GET …/recurring/committed` (periodo de hoy) y se recarga con `refreshKey`. */
export function CommittedCard({
  ctx,
  f,
  refreshKey,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  refreshKey: number;
}) {
  const [committed, setCommitted] = useState<CommittedAmount | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<CommittedAmount>(`${ctx.base}/recurring/committed`)
      .then((r) => {
        if (cancelled) return;
        setCommitted(r.data);
        setProblem(undefined);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, refreshKey]);

  if (problem) return <ProblemMessage problem={problem} locale={ctx.uiLocale} />;
  if (!committed)
    return (
      <p aria-busy="true" data-testid="committed-loading">
        {f.t('committed.loading')}
      </p>
    );
  return <CommittedView committed={committed} f={f} href={ctx.href} />;
}
