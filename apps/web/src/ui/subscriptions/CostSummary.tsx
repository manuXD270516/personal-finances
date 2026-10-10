'use client';

import { useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
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
import { RateSourceBadge } from '../dashboard/RateSourceBadge';
import { formatInstant, formatMoney } from '../dashboard/format';
import type { FormatContext, Money } from '../dashboard/types';
import { SubscriptionStatusBadge } from './Badges';
import { subscriptionPath } from './logic';
import type { SubscriptionCostAmounts, SubscriptionCostItem, SubscriptionCostSummary } from './types';

/** Monto convertido a la moneda base, o "Sin convertir" con el monto original cuando no hay tasa del par (nunca 1:1). */
function BaseAmount({ amounts, f }: { amounts: SubscriptionCostAmounts; f: FormatContext }) {
  if (amounts.base)
    return (
      <>
        <strong>{formatMoney(amounts.base, f.locale)}</strong>
        {amounts.native.currency !== amounts.base.currency ? (
          <div style={mutedStyle}>{formatMoney(amounts.native, f.locale)}</div>
        ) : null}
      </>
    );
  return (
    <>
      <span data-testid="unconverted-amount">{formatMoney(amounts.native, f.locale)}</span>
      <div style={mutedStyle}>
        <span aria-hidden="true">⚠</span> {f.t('cost.unconverted')}
      </div>
    </>
  );
}

function ItemsTable({
  items,
  f,
  href,
  caption,
  testId,
}: {
  items: readonly SubscriptionCostItem[];
  f: FormatContext;
  href: (path: string) => string;
  caption: string;
  testId: string;
}) {
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle} data-testid={testId}>
        <caption className="pf-sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('columns.name')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('columns.status')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('cost.monthly')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('cost.annual')}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.subscriptionId}
              data-testid="cost-row"
              data-subscription-id={item.subscriptionId}
              data-complete={item.complete}
            >
              <td style={cellStyle}>
                <a href={href(subscriptionPath(item.subscriptionId))}>{item.name}</a>
                {!item.complete ? (
                  <div style={mutedStyle} data-testid="cost-row-incomplete">
                    <span aria-hidden="true">⚠</span> {f.t('cost.incomplete')}
                  </div>
                ) : null}
              </td>
              <td style={cellStyle}>
                <SubscriptionStatusBadge status={item.status} f={f} />
              </td>
              <td style={numCellStyle} data-testid="cost-monthly">
                <BaseAmount amounts={item.monthly} f={f} />
              </td>
              <td style={numCellStyle} data-testid="cost-annual">
                <BaseAmount amounts={item.annual} f={f} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const sumOf = (parts: readonly Money[], f: FormatContext): string =>
  parts.map((m) => formatMoney(m, f.locale)).join(', ');

/**
 * Vista "Costo de suscripciones" (FR-COMMITMENTS-016): costo mensual y anual por suscripción y total en la moneda base
 * con la misma valoración que el Home; las tasas usadas con su atribución; los montos sin tasa quedan sin convertir y
 * el total se marca "incompleto" (nunca 1:1); las suscripciones en trial van aparte como "Costo al terminar el trial".
 */
export function CostSummaryView({
  summary,
  f,
  df,
  href,
}: {
  summary: SubscriptionCostSummary;
  f: FormatContext;
  /** Formato del namespace `Dashboard` (atribución de tasas). */
  df: FormatContext;
  href: (path: string) => string;
}) {
  const { totals, afterTrial, meta } = summary;
  const empty = summary.items.length === 0 && afterTrial.items.length === 0;
  return (
    <section
      aria-labelledby="cost-title"
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)' }}
      data-testid="cost-summary"
      data-complete={totals.complete}
    >
      <div>
        <h2 id="cost-title" style={{ margin: 0 }}>
          {f.t('cost.title')}
        </h2>
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t('cost.intro', { currency: summary.baseCurrency })}</p>
      </div>
      {empty ? (
        <p style={mutedStyle} data-testid="cost-empty">
          {f.t('cost.empty')}
        </p>
      ) : (
        <>
          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))',
              gap: 'var(--pf-space-3)',
              margin: 0,
            }}
          >
            <div>
              <dt style={mutedStyle}>{f.t('cost.totalMonthly')}</dt>
              <dd
                style={{ margin: 0, fontSize: 'var(--pf-text-2xl)', fontWeight: 600 }}
                data-testid="cost-total-monthly"
              >
                {formatMoney(totals.monthly, f.locale)}
              </dd>
            </div>
            <div>
              <dt style={mutedStyle}>{f.t('cost.totalAnnual')}</dt>
              <dd
                style={{ margin: 0, fontSize: 'var(--pf-text-2xl)', fontWeight: 600 }}
                data-testid="cost-total-annual"
              >
                {formatMoney(totals.annual, f.locale)}
              </dd>
            </div>
          </dl>
          {!totals.complete ? (
            <div role="note" style={warningStyle} data-testid="cost-incomplete">
              <strong>
                <span aria-hidden="true">⚠</span> {f.t('cost.incompleteTotal')}
              </strong>
              <p style={{ margin: 0 }}>
                {f.t('cost.unconvertedParts', {
                  monthly: sumOf(
                    totals.unconverted.map((u) => u.monthly),
                    f,
                  ),
                  annual: sumOf(
                    totals.unconverted.map((u) => u.annual),
                    f,
                  ),
                })}
              </p>
            </div>
          ) : null}
          {summary.items.length > 0 ? (
            <ItemsTable
              items={summary.items}
              f={f}
              href={href}
              caption={f.t('cost.caption')}
              testId="cost-table"
            />
          ) : null}
          {afterTrial.items.length > 0 ? (
            <section
              aria-labelledby="after-trial-title"
              style={{ display: 'grid', gap: 'var(--pf-space-2)' }}
              data-testid="after-trial"
              data-complete={afterTrial.complete}
            >
              <h3 id="after-trial-title" style={{ margin: 0 }}>
                {f.t('cost.afterTrialTitle')}
              </h3>
              <p style={{ ...mutedStyle, margin: 0 }}>{f.t('cost.afterTrialNote')}</p>
              <p style={{ margin: 0 }} data-testid="after-trial-total">
                {f.t('cost.afterTrialTotal', {
                  monthly: formatMoney(afterTrial.monthly, f.locale),
                  annual: formatMoney(afterTrial.annual, f.locale),
                })}
                {!afterTrial.complete ? (
                  <>
                    {' '}
                    <strong data-testid="after-trial-incomplete">
                      <span aria-hidden="true">⚠</span> {f.t('cost.incomplete')}
                    </strong>
                  </>
                ) : null}
              </p>
              <ItemsTable
                items={afterTrial.items}
                f={f}
                href={href}
                caption={f.t('cost.afterTrialCaption')}
                testId="after-trial-table"
              />
            </section>
          ) : null}
        </>
      )}
      {meta.ratesUsed.length > 0 ? (
        <div data-testid="cost-rates">
          <p style={{ ...mutedStyle, margin: 0 }}>{f.t('cost.rates')}</p>
          <ul style={{ margin: 0, paddingLeft: 'var(--pf-space-4)' }}>
            {meta.ratesUsed.map((rate) => (
              <li key={`${rate.rate.base}/${rate.rate.quote}/${rate.rateType}`}>
                <RateSourceBadge rate={rate} ctx={df} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p style={{ ...mutedStyle, margin: 0 }} data-testid="cost-as-of">
        {f.t('cost.asOf', { date: formatInstant(meta.asOf, f.locale, f.timeZone) })}
      </p>
    </section>
  );
}

/** Vista conectada: consulta `GET …/subscriptions/cost-summary` y se recarga con `refreshKey`. */
export function CostSummaryCard({
  ctx,
  f,
  df,
  refreshKey,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  df: FormatContext;
  refreshKey: number;
}) {
  const [summary, setSummary] = useState<SubscriptionCostSummary | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<SubscriptionCostSummary>(`${ctx.base}/subscriptions/cost-summary`)
      .then((r) => {
        if (cancelled) return;
        setSummary(r.data);
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
  if (!summary)
    return (
      <p aria-busy="true" data-testid="cost-loading">
        {f.t('cost.loading')}
      </p>
    );
  return <CostSummaryView summary={summary} f={f} df={df} href={ctx.href} />;
}
