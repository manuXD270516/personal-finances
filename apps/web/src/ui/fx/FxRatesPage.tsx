'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { formatInstant } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { formatDecimal } from '../AuditHistory';
import { localDateTimeIn, zonedLocalToInstant } from '../common/dates';
import { parseRate, trimRate } from '../common/money';
import { FX_RATE_TYPES, type FxRate, type FxRatePreference, type FxRateType } from '../common/types';
import {
  badgeStyle,
  cardStyle,
  cellStyle,
  Field,
  formStyle,
  inputStyle,
  mutedStyle,
  numCellStyle,
  pageStyle,
  rowStyle,
  tableStyle,
  tableWrapStyle,
} from '../common/ui';
import { listAll, problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { Tabs } from '../common/Tabs';
import { RateAttributionLink } from '../dashboard/RateSourceBadge';
import { groupRatesByPair, withPreference, type RatePairGroup } from './logic';
import { ProvidersPanel, rateTypeLabel } from './ProvidersPanel';

export function FxRatesPage({ base, quote, view }: { base?: string; quote?: string; view?: string }) {
  return (
    <WithWorkspace>
      {(ctx) => (
        <FxScreen
          ctx={ctx}
          {...(base ? { base } : {})}
          {...(quote ? { quote } : {})}
          {...(view ? { view } : {})}
        />
      )}
    </WithWorkspace>
  );
}

/** `/fx`: pestañas Tasas (manuales y de provider) y Proveedores (estado, carga histórica y anomalías). */
function FxScreen({
  ctx,
  base,
  quote,
  view,
}: {
  ctx: WorkspaceContext;
  base?: string;
  quote?: string;
  view?: string;
}) {
  const { t } = useFormat('Fx', ctx);
  return (
    <section aria-labelledby="fx-title" style={pageStyle}>
      <h1 id="fx-title">{t('screen.title')}</h1>
      <Tabs
        label={t('screen.tabs')}
        idPrefix="fx"
        initial={view === 'proveedores' ? 'providers' : 'rates'}
        tabs={[
          {
            id: 'rates',
            label: t('screen.rates'),
            content: <FxRates ctx={ctx} {...(base ? { base } : {})} {...(quote ? { quote } : {})} />,
          },
          { id: 'providers', label: t('screen.providers'), content: <ProvidersPanel ctx={ctx} /> },
        ]}
      />
    </section>
  );
}

/** "1 USDT = 6,95 BOB" (valor exacto, sin ceros de persistencia). */
export const rateSentence = (r: { base: string; quote: string; value: string }, locale: string) =>
  `1 ${r.base} = ${formatDecimal(trimRate(r.value), locale)} ${r.quote}`;

/**
 * Pantalla `/fx` → Tasas (add-manual-conversions 6.1): tasas por par con tipo, fuente y vigencia; alta manual;
 * corrección con motivo (nueva versión que reemplaza a la original, que se conserva); vista de versiones
 * reemplazadas y preferencia de tipo por par.
 */
function FxRates({ ctx, base, quote }: { ctx: WorkspaceContext; base?: string; quote?: string }) {
  const f = useFormat('Fx', ctx);
  const { t } = f;
  const enabled = ctx.currencies.filter((c) => c.enabled).map((c) => c.code);
  const currencies = enabled.length ? enabled : [ctx.ws.baseCurrency];
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [rates, setRates] = useState<readonly FxRate[] | undefined>();
  const [prefs, setPrefs] = useState<{ data: readonly FxRatePreference[]; etag?: string }>({ data: [] });
  const [form, setForm] = useState({
    base: base ?? currencies.find((c) => c !== ctx.ws.baseCurrency) ?? 'USD',
    quote: quote ?? ctx.ws.baseCurrency,
    value: '',
    rateType: 'P2P' as FxRateType,
    asOf: localDateTimeIn(ctx.timeZone),
    sourceLabel: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const key = useRef(uuidv7());

  const load = useCallback(() => {
    listAll<FxRate>(
      ctx.api,
      `${ctx.base}/fx-rates`,
      new URLSearchParams(showSuperseded ? { includeSuperseded: 'true' } : {}),
      3,
    )
      .then(setRates)
      .catch((err: unknown) => setProblem(problemOf(err)));
    ctx.api
      .get<{ data: FxRatePreference[] }>(`${ctx.base}/fx-rate-preferences`)
      .then((r) => setPrefs({ data: r.data?.data ?? [], ...(r.etag ? { etag: r.etag } : {}) }))
      .catch(() => setPrefs({ data: [] }));
  }, [ctx.api, ctx.base, showSuperseded]);
  useEffect(load, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const next: Record<string, string> = {};
    const v = parseRate(form.value, ctx.formatLocale);
    if (!v.ok) next['value'] = t(`errors.rate.${v.error}`);
    if (form.base === form.quote) next['quote'] = t('errors.samePair');
    const asOf = zonedLocalToInstant(form.asOf, ctx.timeZone);
    if (!asOf) next['asOf'] = t('errors.executedAt');
    setErrors(next);
    if (Object.keys(next).length || !v.ok || !asOf) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await ctx.api.command(
        'POST',
        `${ctx.base}/fx-rates`,
        {
          base: form.base,
          quote: form.quote,
          value: v.value,
          rateType: form.rateType,
          asOf,
          ...(form.sourceLabel.trim() ? { sourceLabel: form.sourceLabel.trim() } : {}),
        },
        { idempotencyKey: key.current },
      );
      key.current = uuidv7();
      setStatus(t('rates.recorded', { rate: rateSentence({ ...form, value: v.value }, ctx.formatLocale) }));
      setForm({ ...form, value: '', sourceLabel: '' });
      load();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function supersede(rate: FxRate, value: string, reason: string): Promise<boolean> {
    setProblem(undefined);
    try {
      await ctx.api.command('POST', `${ctx.base}/fx-rates/${rate.id}/supersede`, { value, reason });
      setStatus(t('rates.corrected', { pair: `${rate.base}/${rate.quote}` }));
      load();
      return true;
    } catch (err) {
      setProblem(problemOf(err));
      return false;
    }
  }

  async function setPreference(g: RatePairGroup, rateType: FxRateType | '') {
    setProblem(undefined);
    try {
      const r = await ctx.api.command<{ data: FxRatePreference[] }>(
        'PUT',
        `${ctx.base}/fx-rate-preferences`,
        { data: withPreference(prefs.data, g.base, g.quote, rateType) },
        { ifMatch: prefs.etag ?? 1 },
      );
      setPrefs({ data: r.data?.data ?? [], ...(r.etag ? { etag: r.etag } : {}) });
      setStatus(t('rates.preferenceSaved', { pair: g.pair }));
    } catch (err) {
      setProblem(problemOf(err));
    }
  }

  const groups = groupRatesByPair(rates ?? [], prefs.data);

  return (
    <div style={{ display: 'grid', gap: '1rem', minWidth: 0 }} data-testid="fx-rates">
      <h2 style={{ fontSize: '1.1rem', margin: 0 }}>{t('rates.title')}</h2>
      <nav aria-label={t('rates.actions')} style={rowStyle}>
        {ctx.canEdit ? <a href={ctx.href('/fx/conversiones/nueva')}>{t('rates.newConversion')}</a> : null}
        <a href={ctx.href('/transacciones?tipo=CONVERSION')}>{t('rates.conversions')}</a>
      </nav>
      {ctx.canEdit ? (
        <form
          onSubmit={(e) => void create(e)}
          style={formStyle}
          aria-labelledby="rate-new-title"
          noValidate
          data-testid="rate-form"
        >
          <h2 id="rate-new-title" style={{ margin: 0, fontSize: '1rem' }}>
            {t('rates.new')}
          </h2>
          <div style={rowStyle}>
            <Field label={t('rates.base')}>
              {(p) => (
                <select
                  {...p}
                  name="base"
                  style={inputStyle}
                  value={form.base}
                  onChange={(e) => setForm({ ...form, base: e.target.value })}
                >
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('rates.quote')} error={errors['quote']}>
              {(p) => (
                <select
                  {...p}
                  name="quote"
                  style={inputStyle}
                  value={form.quote}
                  onChange={(e) => setForm({ ...form, quote: e.target.value })}
                >
                  {currencies.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t('rates.value', { base: form.base, quote: form.quote })} error={errors['value']}>
              {(p) => (
                <input
                  {...p}
                  name="value"
                  inputMode="decimal"
                  autoComplete="off"
                  style={inputStyle}
                  value={form.value}
                  onChange={(e) => setForm({ ...form, value: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('rates.type')}>
              {(p) => (
                <select
                  {...p}
                  name="rateType"
                  style={inputStyle}
                  value={form.rateType}
                  onChange={(e) => setForm({ ...form, rateType: e.target.value as FxRateType })}
                >
                  {FX_RATE_TYPES.map((rt) => (
                    <option key={rt} value={rt}>
                      {t(`rateTypes.${rt}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <div style={rowStyle}>
            <Field label={t('rates.asOf', { tz: ctx.timeZone })} error={errors['asOf']}>
              {(p) => (
                <input
                  {...p}
                  type="datetime-local"
                  name="asOf"
                  style={inputStyle}
                  value={form.asOf}
                  onChange={(e) => setForm({ ...form, asOf: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('rates.sourceLabel')}>
              {(p) => (
                <input
                  {...p}
                  name="sourceLabel"
                  maxLength={200}
                  style={inputStyle}
                  value={form.sourceLabel}
                  onChange={(e) => setForm({ ...form, sourceLabel: e.target.value })}
                />
              )}
            </Field>
          </div>
          <div>
            <button type="submit" disabled={busy}>
              {t('rates.record')}
            </button>
          </div>
        </form>
      ) : null}
      <label style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
        <input
          type="checkbox"
          name="includeSuperseded"
          checked={showSuperseded}
          onChange={(e) => setShowSuperseded(e.target.checked)}
        />
        {t('rates.showSuperseded')}
      </label>
      {status ? <p role="status">{status}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {rates && groups.length === 0 ? <p data-testid="rates-empty">{t('rates.empty')}</p> : null}
      {groups.map((g) => (
        <RatePairSection
          key={g.pair}
          group={g}
          f={f}
          canEdit={ctx.canEdit}
          onSupersede={supersede}
          onPreference={(rt) => void setPreference(g, rt)}
        />
      ))}
    </div>
  );
}

function RatePairSection({
  group: g,
  f,
  canEdit,
  onSupersede,
  onPreference,
}: {
  group: RatePairGroup;
  f: FormatContext;
  canEdit: boolean;
  onSupersede: (rate: FxRate, value: string, reason: string) => Promise<boolean>;
  onPreference: (rateType: FxRateType | '') => void;
}) {
  const { t, locale, timeZone } = f;
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const id = `pair-${g.base}-${g.quote}`;
  return (
    <section aria-labelledby={id} style={cardStyle} data-testid="rate-pair" data-pair={g.pair}>
      <h2 id={id} style={{ fontSize: '1rem', marginTop: 0 }}>
        {g.pair}
      </h2>
      <div style={rowStyle}>
        <Field label={t('rates.preference', { pair: g.pair })} hint={t('rates.preferenceHint')}>
          {(p) => (
            <select
              {...p}
              name={`preference-${g.pair}`}
              style={inputStyle}
              value={g.preferred ?? ''}
              disabled={!canEdit}
              onChange={(e) => onPreference(e.target.value as FxRateType | '')}
            >
              <option value="">{t('rates.noPreference')}</option>
              {FX_RATE_TYPES.map((rt) => (
                <option key={rt} value={rt}>
                  {t(`rateTypes.${rt}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th scope="col" style={numCellStyle}>
                {t('rates.valueColumn')}
              </th>
              <th scope="col" style={cellStyle}>
                {t('rates.type')}
              </th>
              <th scope="col" style={cellStyle}>
                {t('rates.source')}
              </th>
              <th scope="col" style={cellStyle}>
                {t('rates.asOfColumn')}
              </th>
              <th scope="col" style={cellStyle}>
                {t('rates.state')}
              </th>
            </tr>
          </thead>
          <tbody>
            {g.rates.map((r) => (
              <tr
                key={r.id}
                data-testid="rate-row"
                data-rate-id={r.id}
                data-superseded={r.supersededByRateId ? 'true' : 'false'}
              >
                <td style={numCellStyle} data-testid="rate-value">
                  {rateSentence(r, locale)}
                </td>
                <td style={cellStyle}>
                  {rateTypeLabel(f, r.rateType)}
                  {r.anomaly ? (
                    <span style={badgeStyle} data-testid="rate-anomaly">
                      {' '}
                      {t(`providers.anomalies.status.${r.anomaly.status}`)}
                    </span>
                  ) : null}
                </td>
                <td style={cellStyle}>
                  {r.attribution ? (
                    <RateAttributionLink attribution={r.attribution} />
                  ) : (
                    <>
                      {t(`sources.${r.source}`)}
                      {r.sourceLabel ? ` · ${r.sourceLabel}` : ''}
                    </>
                  )}
                </td>
                <td style={cellStyle}>{formatInstant(r.asOf, locale, timeZone)}</td>
                <td style={cellStyle}>
                  {r.supersededByRateId ? (
                    <span style={badgeStyle}>{t('rates.superseded')}</span>
                  ) : (
                    <span style={badgeStyle}>{t('rates.current')}</span>
                  )}
                  {r.supersedeReason ? (
                    <span style={mutedStyle}> {t('rates.reason', { reason: r.supersedeReason })}</span>
                  ) : null}
                  {canEdit && !r.supersededByRateId && r.source === 'MANUAL' ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCorrecting(r.id);
                        setValue('');
                        setReason('');
                        setError(undefined);
                      }}
                    >
                      {t('rates.correct')}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {correcting ? (
        <form
          style={{ ...rowStyle, marginTop: '0.5rem' }}
          aria-label={t('rates.correctTitle')}
          data-testid="rate-correct-form"
          onSubmit={(e) => {
            e.preventDefault();
            const rate = g.rates.find((x) => x.id === correcting);
            const v = parseRate(value, locale);
            if (!rate) return;
            if (!v.ok) return setError(t(`errors.rate.${v.error}`));
            if (reason.trim().length < 3) return setError(t('errors.reasonMin'));
            void onSupersede(rate, v.value, reason.trim()).then((ok) => ok && setCorrecting(null));
          }}
        >
          <Field label={t('rates.newValue')} error={error}>
            {(p) => (
              <input
                {...p}
                name="newValue"
                inputMode="decimal"
                style={inputStyle}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('rates.correctReason')}>
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
          <button type="submit">{t('rates.saveCorrection')}</button>
          <button type="button" onClick={() => setCorrecting(null)}>
            {t('form.cancel')}
          </button>
        </form>
      ) : null}
    </section>
  );
}
