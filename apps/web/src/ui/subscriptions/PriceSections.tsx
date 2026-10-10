'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { scaleFor } from '../common/money';
import {
  cellStyle,
  Field,
  formStyle,
  inputStyle,
  mutedStyle,
  numCellStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
  warningStyle,
} from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { Badge } from '../recurring/Badges';
import { ChangePercent } from './Badges';
import {
  buildPriceBody,
  buildSupersedeBody,
  historyRows,
  isAfter,
  lastEffectiveFrom,
  priceInForce,
} from './logic';
import type { Subscription, SubscriptionPrice } from './types';

/**
 * Historial de precios (append-only): vigencia, precio, origen y estado. Las entradas reemplazadas se conservan,
 * marcadas con texto + icono ("Reemplazada") y la entrada que las sustituye; la vigente de hoy se identifica y las
 * futuras figuran "Programada". "Corregir" registra un reemplazo con la misma vigencia (solo entradas no reemplazadas).
 */
export function PriceHistoryTable({
  history,
  f,
  locale,
  today,
  canSupersede,
  onSupersede,
}: {
  history: readonly SubscriptionPrice[];
  f: FormatContext;
  locale: string;
  today: string;
  canSupersede: boolean;
  onSupersede: (entry: SubscriptionPrice) => void;
}) {
  const inForce = priceInForce(history, today);
  const byId = new Map(history.map((p) => [p.id, p]));
  return (
    <div style={tableWrapStyle}>
      <table style={tableStyle} data-testid="price-history">
        <caption className="pf-sr-only">{f.t('history.caption')}</caption>
        <thead>
          <tr>
            <th scope="col" style={cellStyle}>
              {f.t('history.effectiveFrom')}
            </th>
            <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
              {f.t('history.price')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('history.origin')}
            </th>
            <th scope="col" style={cellStyle}>
              {f.t('history.state')}
            </th>
            {canSupersede ? (
              <th scope="col" style={cellStyle}>
                <span className="pf-sr-only">{f.t('history.actions')}</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {historyRows(history).map((p) => {
            const replacer = p.supersededBy ? byId.get(p.supersededBy) : undefined;
            const superseded = p.supersededBy !== null;
            return (
              <tr
                key={p.id}
                data-testid="price-row"
                data-price-id={p.id}
                data-superseded={superseded}
                data-origin={p.origin}
              >
                <td style={cellStyle}>{formatBusinessDate(p.effectiveFrom)}</td>
                <td style={numCellStyle} data-testid="price-amount">
                  {superseded ? <s>{formatMoney(p.price, locale)}</s> : formatMoney(p.price, locale)}
                </td>
                <td style={cellStyle}>{f.t(`history.origins.${p.origin}`)}</td>
                <td style={cellStyle}>
                  {superseded ? (
                    <span data-testid="price-superseded">
                      <span aria-hidden="true">↺</span>{' '}
                      {replacer
                        ? f.t('history.supersededBy', { price: formatMoney(replacer.price, locale) })
                        : f.t('history.superseded')}
                    </span>
                  ) : inForce?.id === p.id ? (
                    <span data-testid="price-current">
                      <span aria-hidden="true">●</span> {f.t('history.current')}
                    </span>
                  ) : p.effectiveFrom > today ? (
                    <span data-testid="price-scheduled">
                      <span aria-hidden="true">◷</span> {f.t('history.scheduled')}
                    </span>
                  ) : (
                    <span style={mutedStyle}>{f.t('history.past')}</span>
                  )}
                </td>
                {canSupersede ? (
                  <td style={cellStyle}>
                    {!superseded ? (
                      <button type="button" data-testid="supersede-price" onClick={() => onSupersede(p)}>
                        {f.t('history.correct')}
                        <span className="pf-sr-only">
                          {' '}
                          {f.t('history.correctFor', { date: formatBusinessDate(p.effectiveFrom) })}
                        </span>
                      </button>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Propuesta de cambio de precio pendiente (detección de un cargo distinto): precio anterior y propuesto, variación y
 * vigencia, con Aceptar y Rechazar. Si aceptar responde `SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL` pide una fecha posterior
 * a la última vigencia y reintenta con `effectiveFrom`. `highlighted` la destaca (enlace de la notificación).
 */
export function ProposalCard({
  ctx,
  f,
  subscription,
  canDecide,
  highlighted,
  onChanged,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  subscription: Subscription;
  canDecide: boolean;
  highlighted: boolean;
  onChanged: (message: string) => void;
}) {
  const proposal = subscription.pendingProposal;
  const [needsDate, setNeedsDate] = useState(false);
  const [date, setDate] = useState('');
  const [dateError, setDateError] = useState<string | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const attemptKey = useRef(uuidv7());
  const last = lastEffectiveFrom(subscription.priceHistory ?? []);

  useEffect(() => {
    if (highlighted) ref.current?.focus();
  }, [highlighted]);

  if (!proposal) return null;
  const base = `${ctx.base}/subscriptions/${subscription.id}/price-proposals/${proposal.id}`;

  async function accept() {
    if (needsDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isAfter(date, last)) {
        setDateError(f.t('errors.NOT_CHRONOLOGICAL'));
        return;
      }
    }
    setDateError(undefined);
    setProblem(undefined);
    setBusy(true);
    try {
      await ctx.api.command('POST', `${base}/accept`, needsDate ? { effectiveFrom: date } : {}, {
        ifMatch: subscription.version,
        idempotencyKey: attemptKey.current,
      });
      attemptKey.current = uuidv7();
      onChanged(f.t('proposal.accepted'));
    } catch (err) {
      const p = problemOf(err);
      if (p.code === 'SUBSCRIPTION_PRICE_NOT_CHRONOLOGICAL') setNeedsDate(true);
      setProblem(p);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setProblem(undefined);
    setBusy(true);
    try {
      await ctx.api.command('POST', `${base}/reject`, undefined, {
        ifMatch: subscription.version,
        idempotent: false,
      });
      onChanged(f.t('proposal.rejected'));
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby="proposal-title"
      style={{
        ...warningStyle,
        display: 'grid',
        gap: 'var(--pf-space-2)',
        ...(highlighted ? { outline: '3px solid var(--pf-primary)', outlineOffset: '2px' } : {}),
      }}
      data-testid="pending-proposal"
      data-proposal-id={proposal.id}
      data-highlighted={highlighted}
    >
      <h2 id="proposal-title" style={{ margin: 0 }}>
        <span aria-hidden="true">⚠</span> {f.t('proposal.title')}
      </h2>
      <p style={{ margin: 0 }} data-testid="proposal-summary">
        {f.t('proposal.summary', {
          previous: formatMoney(proposal.previousPrice, ctx.formatLocale),
          proposed: formatMoney(proposal.proposedPrice, ctx.formatLocale),
          date: formatBusinessDate(proposal.effectiveFrom),
        })}{' '}
        <ChangePercent value={proposal.changePercent} f={f} />
      </p>
      <p style={mutedStyle}>{f.t('proposal.note')}</p>
      {needsDate ? (
        <Field
          label={f.t('proposal.dateLabel')}
          hint={f.t('proposal.dateHint', { date: last ? formatBusinessDate(last) : '—' })}
          error={dateError}
        >
          {(p) => (
            <input
              {...p}
              type="date"
              name="effectiveFrom"
              min={last}
              style={inputStyle}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
        </Field>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {canDecide ? (
        <div style={rowStyle} role="group" aria-label={f.t('proposal.actions')}>
          <button type="button" disabled={busy} data-testid="accept-proposal" onClick={() => void accept()}>
            {f.t('proposal.accept')}
          </button>
          <button type="button" disabled={busy} data-testid="reject-proposal" onClick={() => void reject()}>
            {f.t('proposal.reject')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/** Aviso cuando el enlace apuntaba a una propuesta que ya no está pendiente (decidida, reemplazada o retirada). */
export function ProposalGone({ f }: { f: FormatContext }) {
  return (
    <p role="status" data-testid="proposal-gone">
      <Badge
        presentation={{ icon: 'ℹ', tone: 'neutral' }}
        label={f.t('proposal.goneBadge')}
        status="GONE"
        testId="proposal-gone-badge"
      />{' '}
      {f.t('proposal.gone')}
    </p>
  );
}

/** Registrar un precio nuevo (`POST …/prices`): monto en la moneda de la suscripción y su vigencia (posterior a la última). */
export function PriceForm({
  ctx,
  f,
  subscription,
  today,
  onSaved,
  onCancel,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  subscription: Subscription;
  today: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const currency = subscription.currentPrice.currency;
  const last = lastEffectiveFrom(subscription.priceHistory ?? []);
  const [price, setPrice] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const attemptKey = useRef(uuidv7());
  const inFlight = useRef(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    setProblem(undefined);
    const built = buildPriceBody(price, effectiveFrom, currency, {
      locale: ctx.formatLocale,
      scale: scaleFor(currency, ctx.scales),
    });
    if (!built.ok) {
      setErrors(Object.fromEntries(Object.entries(built.errors).map(([k, v]) => [k, f.t(`errors.${v}`)])));
      return;
    }
    if (!isAfter(effectiveFrom, last)) {
      setErrors({ effectiveFrom: f.t('errors.NOT_CHRONOLOGICAL') });
      return;
    }
    setErrors({});
    inFlight.current = true;
    setBusy(true);
    try {
      await ctx.api.command('POST', `${ctx.base}/subscriptions/${subscription.id}/prices`, built.body, {
        ifMatch: subscription.version,
        idempotencyKey: attemptKey.current,
      });
      attemptKey.current = uuidv7();
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
      style={formStyle}
      aria-labelledby="price-form-title"
      data-testid="price-form"
      noValidate
    >
      <h2 id="price-form-title" style={{ margin: 0 }}>
        {f.t('priceForm.title')}
      </h2>
      <p style={mutedStyle}>{f.t('priceForm.note')}</p>
      <div style={rowStyle}>
        <Field label={f.t('priceForm.price', { currency })} error={errors['price']}>
          {(p) => (
            <input
              {...p}
              name="price"
              inputMode="decimal"
              autoComplete="off"
              style={inputStyle}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          )}
        </Field>
        <Field
          label={f.t('priceForm.effectiveFrom')}
          hint={f.t('priceForm.effectiveFromHint', { date: last ? formatBusinessDate(last) : '—' })}
          error={errors['effectiveFrom']}
        >
          {(p) => (
            <input
              {...p}
              type="date"
              name="effectiveFrom"
              style={inputStyle}
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          )}
        </Field>
      </div>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="price-submit">
          {busy ? f.t('form.saving') : f.t('priceForm.save')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          {f.t('cancel')}
        </button>
      </div>
    </form>
  );
}

/** Corregir una entrada (`POST …/prices/{id}/supersede`): mismo vigencia, otro monto y un motivo opcional. */
export function SupersedeForm({
  ctx,
  f,
  subscription,
  entry,
  onSaved,
  onCancel,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  subscription: Subscription;
  entry: SubscriptionPrice;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const currency = entry.price.currency;
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const attemptKey = useRef(uuidv7());
  const inFlight = useRef(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    setProblem(undefined);
    const built = buildSupersedeBody(price, reason, currency, {
      locale: ctx.formatLocale,
      scale: scaleFor(currency, ctx.scales),
    });
    if (!built.ok) {
      setError(f.t(`errors.${built.errors['price'] ?? 'AMOUNT_INVALID'}`));
      return;
    }
    setError(undefined);
    inFlight.current = true;
    setBusy(true);
    try {
      await ctx.api.command(
        'POST',
        `${ctx.base}/subscriptions/${subscription.id}/prices/${entry.id}/supersede`,
        built.body,
        { ifMatch: subscription.version, idempotencyKey: attemptKey.current },
      );
      attemptKey.current = uuidv7();
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
      style={formStyle}
      aria-labelledby="supersede-form-title"
      data-testid="supersede-form"
      noValidate
    >
      <h2 id="supersede-form-title" style={{ margin: 0 }}>
        {f.t('supersede.title', { date: formatBusinessDate(entry.effectiveFrom) })}
      </h2>
      <p style={mutedStyle}>{f.t('supersede.note', { price: formatMoney(entry.price, ctx.formatLocale) })}</p>
      <div style={rowStyle}>
        <Field label={f.t('supersede.price', { currency })} error={error}>
          {(p) => (
            <input
              {...p}
              name="price"
              inputMode="decimal"
              autoComplete="off"
              style={inputStyle}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          )}
        </Field>
        <Field label={f.t('supersede.reason')}>
          {(p) => (
            <input
              {...p}
              name="reason"
              maxLength={500}
              autoComplete="off"
              style={inputStyle}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </div>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="supersede-submit">
          {busy ? f.t('form.saving') : f.t('supersede.save')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          {f.t('cancel')}
        </button>
      </div>
    </form>
  );
}
