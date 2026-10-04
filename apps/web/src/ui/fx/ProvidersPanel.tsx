'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { formatDecimal } from '../AuditHistory';
import { roundForDisplay, trimRate } from '../common/money';
import type { FxRate, FxRateType } from '../common/types';
import {
  badgeStyle,
  cardStyle,
  cellStyle,
  Field,
  inputStyle,
  mutedStyle,
  numCellStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
} from '../common/ui';
import { listAll, problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import { formatAge, formatInstant, formatLocalDate } from '../dashboard/format';
import { RateAttributionLink, RateSourceBadge } from '../dashboard/RateSourceBadge';
import type { FormatContext, ResolvedRate } from '../dashboard/types';
import {
  pendingAnomalies,
  providerName,
  providerWindowStart,
  quoteSidesByProviderPair,
  reviewedAnomalies,
  reviewReasonError,
  signedPct,
  VALUATION_FEEDS,
  type FxProviderStatus,
  type QuoteSides,
} from './providers-logic';

/** Etiqueta traducida de un tipo de tasa; un tipo desconocido (conjunto abierto) se muestra con su código. */
export const rateTypeLabel = (f: FormatContext, rateType: string): string =>
  f.has?.(`rateTypes.${rateType}`) ? f.t(`rateTypes.${rateType}`) : rateType;

/** "1 USD = 12,02 BOB" (valor exacto, sin ceros de persistencia). */
const sentence = (r: { base: string; quote: string; value: string }, locale: string) =>
  `1 ${r.base} = ${formatDecimal(trimRate(r.value), locale)} ${r.quote}`;

interface Valuation {
  readonly base: string;
  readonly quote: string;
  readonly rateType: FxRateType;
  readonly rate: ResolvedRate | null;
  readonly problem?: ApiProblemBody;
}

/**
 * Pantalla `/fx` → Proveedores (add-market-rate-providers 6.2; FR-FX-014/016): tasa de valoración por par con su
 * fuente, nivel de fallback y obsolescencia; estado de cada provider y feed; carga histórica; compra/venta; bandeja
 * de anomalías (confirmar/rechazar con motivo, solo EDITOR/OWNER). Nunca llama a un provider: solo lee la API.
 */
export function ProvidersPanel({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Fx', ctx);
  const dash = useFormat('Dashboard', ctx);
  const { t } = f;
  const [statuses, setStatuses] = useState<readonly FxProviderStatus[] | undefined>();
  const [rates, setRates] = useState<readonly FxRate[]>([]);
  const [valuations, setValuations] = useState<readonly Valuation[]>([]);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();

  const load = useCallback(() => {
    ctx.api
      .get<{ data: FxProviderStatus[] }>(`${ctx.base}/fx-providers/status`)
      .then((r) => setStatuses(r.data?.data ?? []))
      .catch((err: unknown) => setProblem(problemOf(err)));
    listAll<FxRate>(
      ctx.api,
      `${ctx.base}/fx-rates`,
      new URLSearchParams({ source: 'PROVIDER', asOfFrom: providerWindowStart() }),
      3,
    )
      .then(setRates)
      .catch(() => setRates([]));
    void Promise.all(
      VALUATION_FEEDS.map((v) =>
        ctx.api
          .get<ResolvedRate>(
            `${ctx.base}/fx-rates/latest?${new URLSearchParams({ base: v.base, quote: v.quote, rateType: v.rateType }).toString()}`,
          )
          .then((r): Valuation => ({ ...v, rate: r.data ?? null }))
          .catch((err: unknown): Valuation => ({ ...v, rate: null, problem: problemOf(err) })),
      ),
    ).then(setValuations);
  }, [ctx.api, ctx.base]);
  useEffect(load, [load]);

  async function review(rate: FxRate, decision: 'CONFIRM' | 'REJECT', reason: string): Promise<boolean> {
    setProblem(undefined);
    try {
      await ctx.api.command(
        'POST',
        `${ctx.base}/fx-rates/${rate.id}/anomaly-review`,
        { decision, reason: reason.trim() },
        { idempotencyKey: uuidv7() },
      );
      setStatus(
        t(decision === 'CONFIRM' ? 'providers.anomalies.confirmed' : 'providers.anomalies.rejected', {
          rate: sentence(rate, ctx.formatLocale),
        }),
      );
      load();
      return true;
    } catch (err) {
      setProblem(problemOf(err));
      return false;
    }
  }

  const sides = quoteSidesByProviderPair(rates);
  return (
    <section
      aria-labelledby="fx-providers-title"
      data-testid="fx-providers"
      style={{ display: 'grid', gap: '1rem' }}
    >
      <h2 id="fx-providers-title" style={{ fontSize: '1.1rem', margin: 0 }}>
        {t('providers.title')}
      </h2>
      <p style={{ ...mutedStyle, margin: 0 }}>{t('providers.intro')}</p>
      {status ? <p role="status">{status}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <ValuationList valuations={valuations} f={f} dash={dash} />
      {statuses === undefined ? (
        <p aria-busy="true">{t('providers.loading')}</p>
      ) : (
        statuses.map((s) => <ProviderCard key={s.provider} status={s} f={f} dash={dash} sides={sides} />)
      )}
      <AnomalyInbox
        pending={pendingAnomalies(rates)}
        reviewed={reviewedAnomalies(rates)}
        f={f}
        canReview={ctx.canEdit}
        onReview={review}
      />
    </section>
  );
}

/** Tasa de valoración vigente por par y tipo, con la insignia de fuente (atribución, nivel, antigüedad, obsoleta). */
export function ValuationList({
  valuations,
  f,
  dash,
}: {
  valuations: readonly Valuation[];
  f: FormatContext;
  dash: FormatContext;
}) {
  const { t } = f;
  return (
    <section aria-labelledby="fx-valuation-title" style={cardStyle} data-testid="valuation-rates">
      <h3 id="fx-valuation-title" style={{ fontSize: '1rem', marginTop: 0 }}>
        {t('providers.valuation.title')}
      </h3>
      <p style={{ ...mutedStyle, marginTop: 0 }}>{t('providers.valuation.hint')}</p>
      <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: '0.5rem' }}>
        {valuations.map((v) => (
          <li
            key={`${v.base}/${v.quote}/${v.rateType}`}
            data-testid="valuation-rate"
            data-pair={`${v.base}/${v.quote}`}
            data-rate-type={v.rateType}
          >
            <strong>
              {v.base}/{v.quote} · {rateTypeLabel(f, v.rateType)}
            </strong>
            {v.rate ? (
              <>
                {' '}
                <span data-testid="valuation-level">
                  ({t(`providers.selection.${v.rate.selection ?? 'MANUAL'}`)})
                </span>
                <RateSourceBadge rate={v.rate} ctx={dash} />
              </>
            ) : (
              <span style={mutedStyle} data-testid="valuation-missing">
                {' '}
                {t('providers.valuation.none')}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Estado de un provider: salud, intentos, error, feeds con su última tasa, compra/venta y carga histórica. */
export function ProviderCard({
  status: s,
  f,
  dash,
  sides,
}: {
  status: FxProviderStatus;
  f: FormatContext;
  dash: FormatContext;
  sides: ReadonlyMap<string, QuoteSides>;
}) {
  const { t, locale, timeZone } = f;
  const titleId = useId();
  const when = (iso: string | null | undefined) =>
    iso ? formatInstant(iso, locale, timeZone) : t('providers.never');
  const pairs = [
    ...new Set(s.feeds.filter((x) => x.rateType === 'PARALLEL').map((x) => `${x.base}/${x.quote}`)),
  ];
  return (
    <section
      aria-labelledby={titleId}
      style={cardStyle}
      data-testid="provider-card"
      data-provider={s.provider}
      data-health={s.health}
    >
      <h3 id={titleId} style={{ fontSize: '1rem', marginTop: 0 }}>
        {providerName(s.provider)}{' '}
        <span style={badgeStyle} data-testid="provider-health">
          {t(`providers.health.${s.health}`)}
        </span>
      </h3>
      <p style={{ marginTop: 0 }} data-testid="provider-attribution">
        <RateAttributionLink attribution={s.attribution} />
      </p>
      {s.enabled ? (
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'max-content 1fr',
            gap: '0.25rem 0.75rem',
            margin: 0,
          }}
        >
          <dt>{t('providers.lastAttempt')}</dt>
          <dd style={{ margin: 0 }}>{when(s.lastAttemptAt)}</dd>
          <dt>{t('providers.lastSuccess')}</dt>
          <dd style={{ margin: 0 }} data-testid="provider-last-success">
            {when(s.lastSuccessAt)}
          </dd>
          <dt>{t('providers.failures')}</dt>
          <dd style={{ margin: 0 }} data-testid="provider-failures">
            {s.consecutiveFailures}
          </dd>
          {s.lastError ? (
            <>
              <dt>{t('providers.lastError')}</dt>
              <dd style={{ margin: 0 }} data-testid="provider-error">
                {t(`providers.errors.${s.lastError.code}`)}
                {s.lastError.httpStatus !== null ? ` (HTTP ${s.lastError.httpStatus})` : ''} ·{' '}
                {formatInstant(s.lastError.at, locale, timeZone)}
              </dd>
            </>
          ) : null}
          <dt>{t('providers.nextAttempt')}</dt>
          <dd style={{ margin: 0 }}>{when(s.nextAttemptAt)}</dd>
          {s.rateLimit?.retryAfterUntil ? (
            <>
              <dt>{t('providers.retryAfter')}</dt>
              <dd style={{ margin: 0 }}>{when(s.rateLimit.retryAfterUntil)}</dd>
            </>
          ) : null}
        </dl>
      ) : (
        <p style={mutedStyle} data-testid="provider-disabled">
          {t('providers.disabled')}
        </p>
      )}
      {s.feeds.length > 0 ? (
        <div style={tableWrapStyle}>
          <table style={{ ...tableStyle, marginTop: '0.5rem' }}>
            <caption style={{ textAlign: 'left', fontWeight: 600 }}>{t('providers.feeds')}</caption>
            <thead>
              <tr>
                <th scope="col" style={cellStyle}>
                  {t('providers.feed')}
                </th>
                <th scope="col" style={cellStyle}>
                  {t('providers.role')}
                </th>
                <th scope="col" style={numCellStyle}>
                  {t('providers.lastRate')}
                </th>
                <th scope="col" style={cellStyle}>
                  {t('providers.age')}
                </th>
              </tr>
            </thead>
            <tbody>
              {s.feeds.map((feed) => (
                <tr
                  key={`${feed.base}/${feed.quote}/${feed.rateType}`}
                  data-testid="provider-feed"
                  data-pair={`${feed.base}/${feed.quote}`}
                  data-rate-type={feed.rateType}
                  data-stale={feed.stale ? 'true' : 'false'}
                >
                  <td style={cellStyle}>
                    {feed.base}/{feed.quote} · {rateTypeLabel(f, feed.rateType)}
                  </td>
                  <td style={cellStyle}>{t(`providers.roles.${feed.role}`)}</td>
                  <td style={numCellStyle} data-testid="feed-rate">
                    {feed.lastRate ? sentence(feed.lastRate, locale) : t('providers.noRate')}
                  </td>
                  <td style={cellStyle}>
                    {feed.ageSeconds !== null ? (
                      <span data-testid="feed-age">{formatAge(feed.ageSeconds, dash.t)}</span>
                    ) : null}
                    {feed.stale ? (
                      <>
                        {' '}
                        <strong data-testid="feed-stale">{t('providers.stale')}</strong>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {pairs.map((pair) => {
        const side = sides.get(`${s.provider}:${pair}`);
        if (!side || (!side.buy && !side.sell)) return null;
        return (
          <p key={pair} data-testid="quote-sides" data-pair={pair} style={{ marginBottom: 0 }}>
            <strong>{pair}</strong>{' '}
            {side.buy ? (
              <span data-testid="quote-buy">
                {t('rateTypes.PARALLEL_BUY')} {formatDecimal(trimRate(side.buy.value), locale)}{' '}
                {side.buy.quote}
              </span>
            ) : null}
            {side.buy && side.sell ? ' · ' : null}
            {side.sell ? (
              <span data-testid="quote-sell">
                {t('rateTypes.PARALLEL_SELL')} {formatDecimal(trimRate(side.sell.value), locale)}{' '}
                {side.sell.quote}
              </span>
            ) : null}
            <br />
            <small style={mutedStyle}>
              {t('providers.quoteSidesHint', { base: pair.split('/')[0] ?? '' })}
            </small>
          </p>
        );
      })}
      {s.backfill.status !== 'NOT_APPLICABLE' ? (
        <p data-testid="provider-backfill" data-status={s.backfill.status} style={{ marginBottom: 0 }}>
          <strong>{t('providers.backfill.title')}</strong>:{' '}
          {t(`providers.backfill.status.${s.backfill.status}`)}
          {s.backfill.status === 'COMPLETED' || s.backfill.status === 'FAILED' ? (
            <>
              {' · '}
              {t('providers.backfill.points', { n: s.backfill.pointsImported ?? 0 })}
              {s.backfill.from && s.backfill.to
                ? ` · ${t('providers.backfill.range', {
                    from: formatLocalDate(s.backfill.from, locale),
                    to: formatLocalDate(s.backfill.to, locale),
                  })}`
                : ''}
              {s.backfill.lastRunAt
                ? ` · ${t('providers.backfill.lastRun', { date: formatInstant(s.backfill.lastRunAt, locale, timeZone) })}`
                : ''}
            </>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

/**
 * Bandeja de anomalías (FR-FX-016; design.md decisión 13): muestras retenidas por variar más que el umbral. Un
 * EDITOR/OWNER confirma (pasa a usarse) o rechaza (no se usa nunca) con motivo; un VIEWER solo las ve.
 */
export function AnomalyInbox({
  pending,
  reviewed,
  f,
  canReview,
  onReview,
}: {
  pending: readonly FxRate[];
  reviewed: readonly FxRate[];
  f: FormatContext;
  canReview: boolean;
  onReview: (rate: FxRate, decision: 'CONFIRM' | 'REJECT', reason: string) => Promise<boolean>;
}) {
  const { t, locale, timeZone } = f;
  return (
    <section aria-labelledby="fx-anomalies-title" style={cardStyle} data-testid="anomaly-inbox">
      <h3 id="fx-anomalies-title" style={{ fontSize: '1rem', marginTop: 0 }}>
        {t('providers.anomalies.title', { n: pending.length })}
      </h3>
      <p style={{ ...mutedStyle, marginTop: 0 }}>
        {canReview ? t('providers.anomalies.hint') : t('providers.anomalies.readOnly')}
      </p>
      {pending.length === 0 ? (
        <p data-testid="anomalies-empty">{t('providers.anomalies.empty')}</p>
      ) : (
        <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'grid', gap: '0.75rem' }}>
          {pending.map((r) => (
            <li key={r.id} data-testid="anomaly" data-rate-id={r.id} data-pair={`${r.base}/${r.quote}`}>
              <AnomalyLine rate={r} f={f} />
              {canReview ? <ReviewForm rate={r} f={f} onReview={onReview} /> : null}
            </li>
          ))}
        </ul>
      )}
      {reviewed.length > 0 ? (
        <>
          <h4 style={{ fontSize: '0.95rem', marginBottom: '0.25rem' }}>
            {t('providers.anomalies.reviewed')}
          </h4>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {reviewed.map((r) => (
              <li key={r.id} data-testid="anomaly-reviewed" data-status={r.anomaly?.status}>
                <AnomalyLine rate={r} f={f} /> ·{' '}
                <strong>{t(`providers.anomalies.status.${r.anomaly?.status ?? 'PENDING'}`)}</strong>
                {r.anomaly?.reviewedAt ? ` · ${formatInstant(r.anomaly.reviewedAt, locale, timeZone)}` : ''}
                {r.anomaly?.reason
                  ? ` · ${t('providers.anomalies.reason', { reason: r.anomaly.reason })}`
                  : ''}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

function AnomalyLine({ rate: r, f }: { rate: FxRate; f: FormatContext }) {
  const { t, locale, timeZone } = f;
  return (
    <span>
      <strong data-testid="anomaly-value">{sentence(r, locale)}</strong> · {rateTypeLabel(f, r.rateType)} ·{' '}
      {r.provider ? providerName(r.provider) : t(`sources.${r.source}`)} ·{' '}
      <span data-testid="anomaly-variation">
        {t('providers.anomalies.variation', {
          pct: formatDecimal(signedPct(roundForDisplay(r.anomaly?.variationPct ?? '0', 2)), locale),
          threshold: formatDecimal(r.anomaly?.thresholdPct ?? '0', locale),
        })}
      </span>{' '}
      · {formatInstant(r.asOf, locale, timeZone)}
    </span>
  );
}

function ReviewForm({
  rate,
  f,
  onReview,
}: {
  rate: FxRate;
  f: FormatContext;
  onReview: (rate: FxRate, decision: 'CONFIRM' | 'REJECT', reason: string) => Promise<boolean>;
}) {
  const { t } = f;
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const submit = (decision: 'CONFIRM' | 'REJECT') => (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    const invalid = reviewReasonError(reason);
    if (invalid) return setError(t(`providers.anomalies.errors.${invalid}`));
    setError(undefined);
    setBusy(true);
    void onReview(rate, decision, reason).finally(() => setBusy(false));
  };
  return (
    <form
      onSubmit={submit('CONFIRM')}
      style={{ ...rowStyle, marginTop: '0.25rem' }}
      aria-label={t('providers.anomalies.reviewLabel', { rate: `${rate.base}/${rate.quote}` })}
      data-testid="anomaly-review-form"
      noValidate
    >
      <Field label={t('providers.anomalies.reasonLabel')} error={error}>
        {(p) => (
          <input
            {...p}
            name="reason"
            maxLength={500}
            style={inputStyle}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      <button type="submit" disabled={busy}>
        {t('providers.anomalies.confirm')}
      </button>
      <button type="button" disabled={busy} onClick={() => submit('REJECT')()}>
        {t('providers.anomalies.reject')}
      </button>
    </form>
  );
}
