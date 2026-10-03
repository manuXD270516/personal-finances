'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { formatInstant } from '../dashboard/format';
import { formatDecimal } from '../AuditHistory';
import { localDateTimeIn, todayIn, zonedLocalToInstant } from '../common/dates';
import { parseAmount, parseRate, scaleFor, trimRate } from '../common/money';
import {
  CONVERSION_FEE_TYPES,
  type Account,
  type ConversionFeeType,
  type ConversionPricing,
  type FxRate,
  type Transaction,
} from '../common/types';
import { cardStyle, Field, formStyle, inputStyle, mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { listAll, problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { PricingSummary } from './ConversionDetailView';
import { pairOrientation } from './logic';

export function NewConversionPage(props: {
  sourceAccountId?: string;
  targetAccountId?: string;
  amount?: string;
}) {
  return <WithWorkspace>{(ctx) => <ConversionForm ctx={ctx} {...props} />}</WithWorkspace>;
}

interface FeeRow {
  key: string;
  type: ConversionFeeType;
  amount: string;
  /** `target` / `source`: descontada de ese lado; si no, id de la cuenta que la paga (tercera moneda). */
  paidBy: string;
}

let feeSeq = 0;
const newFee = (): FeeRow => ({ key: `f${(feeSeq += 1)}`, type: 'PROVIDER', amount: '', paidBy: 'target' });

/**
 * Formulario de conversión (add-manual-conversions 6.2, docs/28 §4.3): dos de tres valores (monto entregado,
 * monto recibido, tasa cotizada) y el tercero lo calcula la vista previa sin efectos; comisiones por tipo y moneda
 * (incluida una tercera cuenta); resumen con tasa efectiva, referencia, spread y costo total ANTES de registrar.
 */
function ConversionForm({
  ctx,
  sourceAccountId,
  targetAccountId,
  amount,
}: {
  ctx: WorkspaceContext;
  sourceAccountId?: string;
  targetAccountId?: string;
  amount?: string;
}) {
  const f = useFormat('Fx', ctx);
  const { t, locale } = f;
  const [accounts, setAccounts] = useState<readonly Account[]>([]);
  const [rates, setRates] = useState<readonly FxRate[]>([]);
  const [s, setS] = useState({
    sourceAccountId: sourceAccountId ?? '',
    targetAccountId: targetAccountId ?? '',
    sourceAmount: amount ?? '',
    targetAmount: '',
    quotedRate: '',
    referenceFxRateId: '',
    transactionDate: todayIn(ctx.timeZone),
    executedAt: localDateTimeIn(ctx.timeZone),
    providerName: '',
    description: '',
  });
  const [fees, setFees] = useState<FeeRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ key: string; pricing: ConversionPricing } | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const attemptKey = useRef(uuidv7());
  const set = (patch: Partial<typeof s>) => setS((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    listAll<Account>(ctx.api, `${ctx.base}/accounts`)
      .then((list) => setAccounts(list.filter((a) => a.status === 'ACTIVE')))
      .catch(() => setAccounts([]));
  }, [ctx.api, ctx.base]);

  const source = accounts.find((a) => a.id === s.sourceAccountId);
  const target = accounts.find((a) => a.id === s.targetAccountId);
  const pair =
    source && target ? pairOrientation(source.currency, target.currency, ctx.ws.baseCurrency) : undefined;

  const pairBase = pair?.base;
  const pairQuote = pair?.quote;
  useEffect(() => {
    if (!pairBase || !pairQuote) return;
    const q = new URLSearchParams({ base: pairBase, quote: pairQuote, limit: '20' });
    ctx.api
      .get<{ data: FxRate[] }>(`${ctx.base}/fx-rates?${q.toString()}`)
      .then((r) => setRates(r.data?.data ?? []))
      .catch(() => setRates([]));
  }, [ctx.api, ctx.base, pairBase, pairQuote]);

  /** Cuerpo común (vista previa y registro) o errores de validación. */
  function build(): { errors: Record<string, string>; body?: Record<string, unknown>; given: number } {
    const e: Record<string, string> = {};
    if (!source) e['sourceAccountId'] = t('errors.accountRequired');
    if (!target) e['targetAccountId'] = t('errors.accountRequired');
    if (source && target && source.currency === target.currency)
      e['targetAccountId'] = t('errors.sameCurrency');
    if (!source || !target || !pair) return { errors: e, given: 0 };
    const opt = (raw: string, currency: string, key: string) => {
      if (!raw.trim()) return undefined;
      const r = parseAmount(raw, { locale, currency, scale: scaleFor(currency, ctx.scales) });
      if (!r.ok) e[key] = t(`errors.amount.${r.error}`, { scale: scaleFor(currency, ctx.scales), currency });
      return r.ok ? { amount: r.value, currency } : undefined;
    };
    const sourceAmount = opt(s.sourceAmount, source.currency, 'sourceAmount');
    const targetAmount = opt(s.targetAmount, target.currency, 'targetAmount');
    let quotedRate: { base: string; quote: string; value: string } | undefined;
    if (s.quotedRate.trim()) {
      const r = parseRate(s.quotedRate, locale);
      if (r.ok) quotedRate = { base: pair.base, quote: pair.quote, value: r.value };
      else e['quotedRate'] = t(`errors.rate.${r.error}`);
    }
    const feeInputs = fees.flatMap((fee, i) => {
      const payer =
        fee.paidBy === 'source'
          ? source
          : fee.paidBy === 'target'
            ? target
            : accounts.find((a) => a.id === fee.paidBy);
      if (!payer) return [];
      const m = opt(fee.amount, payer.currency, `fee-${i}`);
      if (!m) {
        if (!fee.amount.trim()) e[`fee-${i}`] = t('errors.amount.EMPTY');
        return [];
      }
      return [
        {
          type: fee.type,
          amount: m,
          ...(fee.paidBy !== 'source' && fee.paidBy !== 'target' ? { paidFromAccountId: payer.id } : {}),
        },
      ];
    });
    const given = [sourceAmount, targetAmount, quotedRate].filter(Boolean).length;
    if (given < 2) e['amounts'] = t('errors.twoOfThree');
    const executedAt = zonedLocalToInstant(s.executedAt, ctx.timeZone);
    if (!executedAt) e['executedAt'] = t('errors.executedAt');
    return {
      errors: e,
      given,
      body: {
        sourceAmount,
        targetAmount,
        quotedRate,
        fees: feeInputs,
        executedAt,
        ...(s.referenceFxRateId ? { referenceFxRateId: s.referenceFxRateId } : {}),
      },
    };
  }

  const inputKey = JSON.stringify({ s, fees });

  async function runPreview() {
    const b = build();
    setErrors(b.errors);
    if (Object.keys(b.errors).length || !b.body || !source || !target) return;
    // La vista previa exige exactamente dos de los tres: con los tres, se previsualiza con los montos (mandan).
    const {
      sourceAmount,
      targetAmount,
      quotedRate,
      fees: feeInputs,
      executedAt,
      ...rest
    } = b.body as Record<string, unknown>;
    const two =
      sourceAmount && targetAmount
        ? { sourceAmount, targetAmount }
        : {
            ...(sourceAmount ? { sourceAmount } : {}),
            ...(targetAmount ? { targetAmount } : {}),
            quotedRate,
          };
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await ctx.api.command<ConversionPricing>(
        'POST',
        `${ctx.base}/conversions/preview`,
        {
          sourceCurrency: source.currency,
          targetCurrency: target.currency,
          ...two,
          fees: feeInputs,
          executedAt,
          ...rest,
        },
        { idempotent: false },
      );
      const pricing = r.data!;
      // Completa el valor derivado para que el registro use exactamente lo previsualizado.
      const next = {
        ...s,
        ...(sourceAmount ? {} : { sourceAmount: pricing.sourceAmount.amount }),
        ...(targetAmount ? {} : { targetAmount: pricing.targetAmount.amount }),
      };
      setS(next);
      setPreview({ key: JSON.stringify({ s: next, fees }), pricing });
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!preview || preview.key !== inputKey || busy) return;
    const b = build();
    setErrors(b.errors);
    if (Object.keys(b.errors).length || !b.body || !source || !target) return;
    const body = Object.fromEntries(
      Object.entries({
        ...b.body,
        transactionDate: s.transactionDate,
        sourceAccountId: source.id,
        targetAccountId: target.id,
        ...(s.providerName.trim() ? { provider: { name: s.providerName.trim() } } : {}),
        ...(s.description.trim() ? { description: s.description.trim() } : {}),
      }).filter(([, v]) => v !== undefined),
    );
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await ctx.api.command<Transaction>('POST', `${ctx.base}/conversions`, body, {
        idempotencyKey: attemptKey.current,
      });
      attemptKey.current = uuidv7();
      window.location.assign(ctx.href(`/transacciones/${r.data!.id}?aviso=registrada`));
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const otherAccounts = useMemo(
    () => accounts.filter((a) => a.id !== source?.id && a.id !== target?.id),
    [accounts, source?.id, target?.id],
  );
  const stale = preview && preview.key !== inputKey;

  return (
    <section style={pageStyle}>
      <p>
        <a href={ctx.href('/fx')}>{t('backToRates')}</a>
      </p>
      <form
        onSubmit={(e) => void submit(e)}
        aria-labelledby="conversion-form-title"
        style={formStyle}
        noValidate
        data-testid="conversion-form"
      >
        <h1 id="conversion-form-title" style={{ margin: 0, fontSize: '1.5rem' }}>
          {t('form.title')}
        </h1>
        <p style={mutedStyle}>{t('form.intro')}</p>
        <div style={rowStyle}>
          <Field label={t('form.sourceAccount')} error={errors['sourceAccountId']}>
            {(p) => (
              <select
                {...p}
                name="sourceAccountId"
                style={inputStyle}
                value={s.sourceAccountId}
                onChange={(e) => set({ sourceAccountId: e.target.value })}
              >
                <option value="">{t('form.chooseAccount')}</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label={t('form.sourceAmount', { currency: source?.currency ?? '' })}
            error={errors['sourceAmount']}
          >
            {(p) => (
              <input
                {...p}
                name="sourceAmount"
                inputMode="decimal"
                autoComplete="off"
                style={inputStyle}
                value={s.sourceAmount}
                onChange={(e) => set({ sourceAmount: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div style={rowStyle}>
          <Field label={t('form.targetAccount')} error={errors['targetAccountId']}>
            {(p) => (
              <select
                {...p}
                name="targetAccountId"
                style={inputStyle}
                value={s.targetAccountId}
                onChange={(e) => set({ targetAccountId: e.target.value })}
              >
                <option value="">{t('form.chooseAccount')}</option>
                {accounts
                  .filter((a) => !source || a.currency !== source.currency)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <Field
            label={t('form.targetAmount', { currency: target?.currency ?? '' })}
            hint={t('form.targetAmountHint')}
            error={errors['targetAmount']}
          >
            {(p) => (
              <input
                {...p}
                name="targetAmount"
                inputMode="decimal"
                autoComplete="off"
                style={inputStyle}
                value={s.targetAmount}
                onChange={(e) => set({ targetAmount: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div style={rowStyle}>
          <Field
            label={
              pair ? t('form.quotedRatePair', { base: pair.base, quote: pair.quote }) : t('form.quotedRate')
            }
            hint={t('form.quotedRateHint')}
            error={errors['quotedRate']}
          >
            {(p) => (
              <input
                {...p}
                name="quotedRate"
                inputMode="decimal"
                autoComplete="off"
                style={inputStyle}
                value={s.quotedRate}
                onChange={(e) => set({ quotedRate: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('form.reference')} hint={t('form.referenceHint')}>
            {(p) => (
              <select
                {...p}
                name="referenceFxRateId"
                style={inputStyle}
                value={s.referenceFxRateId}
                onChange={(e) => set({ referenceFxRateId: e.target.value })}
              >
                <option value="">{t('form.referenceAuto')}</option>
                {rates.map((r) => (
                  <option key={r.id} value={r.id}>
                    {formatDecimal(trimRate(r.value), locale)} {r.quote}/{r.base} · {r.rateType} ·{' '}
                    {formatInstant(r.asOf, locale, ctx.timeZone)}
                    {r.sourceLabel ? ` · ${r.sourceLabel}` : ''}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {errors['amounts'] ? (
          <p role="alert" style={{ color: '#cf222e', margin: 0 }}>
            {errors['amounts']}
          </p>
        ) : null}
        <fieldset
          style={{
            border: '1px solid #d0d7de',
            padding: '0.5rem',
            display: 'grid',
            gap: '0.5rem',
            minWidth: 0,
          }}
        >
          <legend>{t('form.fees')}</legend>
          {fees.map((fee, i) => (
            <div key={fee.key} style={rowStyle} data-testid="fee-row">
              <Field label={t('form.feeType', { n: i + 1 })}>
                {(p) => (
                  <select
                    {...p}
                    name={`fee-${i}-type`}
                    style={inputStyle}
                    value={fee.type}
                    onChange={(e) =>
                      setFees(
                        fees.map((x) =>
                          x.key === fee.key ? { ...x, type: e.target.value as ConversionFeeType } : x,
                        ),
                      )
                    }
                  >
                    {CONVERSION_FEE_TYPES.map((ft) => (
                      <option key={ft} value={ft}>
                        {t(`feeTypes.${ft}`)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label={t('form.feePaidBy', { n: i + 1 })}>
                {(p) => (
                  <select
                    {...p}
                    name={`fee-${i}-paidBy`}
                    style={inputStyle}
                    value={fee.paidBy}
                    onChange={(e) =>
                      setFees(fees.map((x) => (x.key === fee.key ? { ...x, paidBy: e.target.value } : x)))
                    }
                  >
                    <option value="target">
                      {t('form.feeFromTarget', { currency: target?.currency ?? '' })}
                    </option>
                    <option value="source">
                      {t('form.feeFromSource', { currency: source?.currency ?? '' })}
                    </option>
                    {otherAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {t('form.feeFromAccount', { name: a.name, currency: a.currency })}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field
                label={t('form.feeAmount', { n: i + 1 })}
                error={errors[`fee-${i}`]}
                style={{ flex: '0 1 9rem' }}
              >
                {(p) => (
                  <input
                    {...p}
                    name={`fee-${i}-amount`}
                    inputMode="decimal"
                    autoComplete="off"
                    style={inputStyle}
                    value={fee.amount}
                    onChange={(e) =>
                      setFees(fees.map((x) => (x.key === fee.key ? { ...x, amount: e.target.value } : x)))
                    }
                  />
                )}
              </Field>
              <button
                type="button"
                aria-label={t('form.feeRemove', { n: i + 1 })}
                onClick={() => setFees(fees.filter((x) => x.key !== fee.key))}
              >
                {t('form.remove')}
              </button>
            </div>
          ))}
          <div>
            <button type="button" onClick={() => setFees([...fees, newFee()])}>
              {t('form.addFee')}
            </button>
          </div>
        </fieldset>
        <div style={rowStyle}>
          <Field label={t('form.date')}>
            {(p) => (
              <input
                {...p}
                type="date"
                name="transactionDate"
                style={inputStyle}
                value={s.transactionDate}
                onChange={(e) => set({ transactionDate: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('form.executedAt', { tz: ctx.timeZone })} error={errors['executedAt']}>
            {(p) => (
              <input
                {...p}
                type="datetime-local"
                name="executedAt"
                style={inputStyle}
                value={s.executedAt}
                onChange={(e) => set({ executedAt: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('form.provider')}>
            {(p) => (
              <input
                {...p}
                name="provider"
                maxLength={100}
                style={inputStyle}
                value={s.providerName}
                onChange={(e) => set({ providerName: e.target.value })}
              />
            )}
          </Field>
          <Field label={t('form.description')}>
            {(p) => (
              <input
                {...p}
                name="description"
                maxLength={500}
                style={inputStyle}
                value={s.description}
                onChange={(e) => set({ description: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div style={rowStyle}>
          <button type="button" onClick={() => void runPreview()} disabled={busy}>
            {t('form.preview')}
          </button>
          <button type="submit" disabled={busy || !preview || Boolean(stale)}>
            {t('form.record')}
          </button>
        </div>
        {preview ? (
          <section
            aria-labelledby="conversion-preview-title"
            style={cardStyle}
            data-testid="conversion-preview"
            data-stale={stale ? 'true' : 'false'}
          >
            <h2 id="conversion-preview-title" style={{ fontSize: '1rem', marginTop: 0 }}>
              {t('form.summary')}
            </h2>
            {stale ? <p role="status">{t('form.summaryStale')}</p> : null}
            <PricingSummary pricing={preview.pricing} f={f} />
          </section>
        ) : null}
        {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      </form>
    </section>
  );
}
