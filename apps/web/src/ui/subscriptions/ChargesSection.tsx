'use client';

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { scaleFor } from '../common/money';
import type { Page } from '../common/types';
import {
  cellStyle,
  Field,
  inputStyle,
  mutedStyle,
  numCellStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
} from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { formatMoney } from '../dashboard/format';
import { formatBusinessDate } from '../planning/logic';
import { ChargeOutcomeBadge } from './Badges';
import { CHARGES_LIMIT, buildChargeBody, formatImpliedRate, formatPercent, isNotComparable } from './logic';
import type { Subscription, SubscriptionCharge } from './types';

/**
 * Monto del extracto en la moneda del precio para un cargo "no comparable" (`PATCH …/charges/{id}`, `If-Match` de la
 * suscripción): con él la API aplica la detección de cambio de precio con la tolerancia de la suscripción.
 */
function StatementForm({
  ctx,
  f,
  subscription,
  charge,
  onSaved,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  subscription: Subscription;
  charge: SubscriptionCharge;
  onSaved: () => void;
}) {
  const currency = subscription.currentPrice.currency;
  const [raw, setRaw] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    setProblem(undefined);
    const built = buildChargeBody(raw, currency, {
      locale: ctx.formatLocale,
      scale: scaleFor(currency, ctx.scales),
    });
    if (!built.ok) {
      setError(f.t(`errors.${built.errors['amount'] ?? 'AMOUNT_INVALID'}`));
      return;
    }
    setError(undefined);
    inFlight.current = true;
    setBusy(true);
    try {
      await ctx.api.command(
        'PATCH',
        `${ctx.base}/subscriptions/${subscription.id}/charges/${charge.id}`,
        built.body,
        {
          ifMatch: subscription.version,
        },
      );
      onSaved();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void submit(e)}
      data-testid="statement-form"
      noValidate
      style={{ display: 'grid', gap: 'var(--pf-space-1)' }}
    >
      <Field
        label={f.t('charges.statementLabel', { currency })}
        hint={f.t('charges.statementHint')}
        error={error}
      >
        {(p) => (
          <input
            {...p}
            name="priceCurrencyAmount"
            inputMode="decimal"
            autoComplete="off"
            style={inputStyle}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        )}
      </Field>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="statement-submit">
          {busy ? f.t('form.saving') : f.t('charges.statementSave')}
        </button>
      </div>
    </form>
  );
}

/**
 * Cargos de la suscripción (más reciente primero): monto cobrado, precio esperado, tasa implícita (4 decimales, otra
 * moneda) o desvío (misma moneda), resultado de la detección y, para los "no comparables", el monto del extracto.
 */
export function ChargesTable({
  charges,
  f,
  locale,
  canRecord,
  renderStatement,
}: {
  charges: readonly SubscriptionCharge[];
  f: FormatContext;
  locale: string;
  canRecord: boolean;
  renderStatement: (charge: SubscriptionCharge) => ReactNode;
}) {
  if (charges.length === 0)
    return (
      <p style={mutedStyle} data-testid="charges-empty">
        {f.t('charges.empty')}
      </p>
    );
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle} data-testid="charges-table">
        <caption className="pf-sr-only">{f.t('charges.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('charges.date')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('charges.charged')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('charges.expected')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('charges.comparison')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('charges.outcome')}
            </th>
          </tr>
        </thead>
        <tbody>
          {charges.map((c) => (
            <tr key={c.id} data-testid="charge-row" data-charge-id={c.id} data-outcome={c.outcome}>
              <td style={cellStyle}>{formatBusinessDate(c.occurrenceDate)}</td>
              <td style={numCellStyle} data-testid="charge-charged">
                {formatMoney(c.charged, locale)}
              </td>
              <td style={numCellStyle} data-testid="charge-expected">
                {formatMoney(c.expectedPrice, locale)}
              </td>
              <td style={cellStyle}>
                {c.impliedRate !== null ? (
                  <span data-testid="charge-implied-rate">
                    {f.t('charges.impliedRate', {
                      rate: formatImpliedRate(c.impliedRate, locale),
                      from: c.charged.currency,
                      to: c.expectedPrice.currency,
                    })}
                  </span>
                ) : c.deviationPercent !== null ? (
                  <span data-testid="charge-deviation">
                    {f.t('charges.deviation', { percent: formatPercent(c.deviationPercent, locale) })}
                  </span>
                ) : (
                  '—'
                )}
                {c.priceCurrencyAmount ? (
                  <div style={mutedStyle} data-testid="charge-statement">
                    {f.t('charges.statementAmount', { amount: formatMoney(c.priceCurrencyAmount, locale) })}
                  </div>
                ) : null}
              </td>
              <td style={cellStyle}>
                <ChargeOutcomeBadge outcome={c.outcome} f={f} />
                {isNotComparable(c.outcome) ? (
                  <div style={mutedStyle}>{f.t('charges.notComparableHint')}</div>
                ) : null}
                {isNotComparable(c.outcome) && canRecord ? renderStatement(c) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Sección conectada: `GET …/subscriptions/{id}/charges` y el formulario del extracto de cada cargo no comparable. */
export function ChargesSection({
  ctx,
  f,
  subscription,
  canRecord,
  refreshKey,
  onChanged,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  subscription: Subscription;
  canRecord: boolean;
  refreshKey: number;
  onChanged: (message: string) => void;
}) {
  const [charges, setCharges] = useState<readonly SubscriptionCharge[] | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<Page<SubscriptionCharge>>(
        `${ctx.base}/subscriptions/${subscription.id}/charges?limit=${CHARGES_LIMIT}`,
      )
      .then((r) => {
        if (cancelled) return;
        setCharges(r.data?.data ?? []);
        setHasMore(r.data?.page.hasMore ?? false);
        setProblem(undefined);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCharges([]);
        setProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, subscription.id, refreshKey]);

  return (
    <section aria-labelledby="charges-title" style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
      <h2 id="charges-title">{f.t('charges.title')}</h2>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {charges === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : (
        <ChargesTable
          charges={charges}
          f={f}
          locale={ctx.formatLocale}
          canRecord={canRecord}
          renderStatement={(charge) => (
            <StatementForm
              ctx={ctx}
              f={f}
              subscription={subscription}
              charge={charge}
              onSaved={() => onChanged(f.t('charges.statementSaved'))}
            />
          )}
        />
      )}
      {hasMore ? <p style={mutedStyle}>{f.t('charges.truncated', { limit: CHARGES_LIMIT })}</p> : null}
    </section>
  );
}
