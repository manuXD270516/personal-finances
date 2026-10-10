'use client';

import { useMemo, useRef, useState, type FormEvent } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { scaleFor } from '../common/money';
import { Field, formStyle, inputStyle, mutedStyle, rowStyle, warningStyle } from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { MATERIALIZATION_MODES } from '../recurring/types';
import { notifyRecurringChanged } from '../recurring/logic';
import { categoryOptions, type Catalogs } from '../transactions/catalogs';
import { CounterpartyPicker } from '../transactions/CounterpartyPicker';
import {
  accountCurrencyOf,
  buildCreateBody,
  buildUpdateBody,
  currencyMismatch,
  type FormErrors,
  type SubscriptionForm as FormState,
} from './logic';
import { SUBSCRIPTION_CADENCES, type Subscription } from './types';

/** Monedas habilitadas del workspace (con el catálogo base de la UI mientras `GET /currencies` no responde). */
export function enabledCurrencies(ctx: Pick<WorkspaceContext, 'currencies' | 'scales'>): string[] {
  const fromApi = ctx.currencies.filter((c) => c.enabled).map((c) => c.code);
  return fromApi.length > 0 ? fromApi : Object.keys(ctx.scales);
}

/**
 * Formulario de suscripción. `create`: alta (`POST /subscriptions`, `Idempotency-Key` del intento), con provider
 * (contraparte, con creación en línea), precio y moneda, ciclo, primera renovación, trial opcional y cuenta de pago.
 * `edit`: `PATCH` con `If-Match` de lo que cambió; la cuenta de pago o el ciclo piden una fecha de efecto y no tocan
 * los cargos ya materializados. Avisa cuando la moneda del precio difiere de la de la cuenta.
 */
export function SubscriptionFormView({
  ctx,
  f,
  catalogs,
  today,
  mode,
  initial,
  subscription,
  onSaved,
  onCancel,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  catalogs: Catalogs;
  today: string;
  mode: 'create' | 'edit';
  initial: FormState;
  /** Solo en `edit`: la suscripción que se cambia. */
  subscription?: Subscription;
  onSaved: (saved: Subscription) => void;
  onCancel: () => void;
}) {
  const editing = mode === 'edit';
  const [s, setS] = useState<FormState>(initial);
  const [effectiveFrom, setEffectiveFrom] = useState(subscription?.nextRenewalOn ?? today);
  const [errors, setErrors] = useState<FormErrors>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const attemptKey = useRef(uuidv7());
  const inFlight = useRef(false);
  const set = (patch: Partial<FormState>) => setS((prev) => ({ ...prev, ...patch }));

  const accountCurrency = accountCurrencyOf(catalogs.accounts, s.paymentAccountId);
  const scale = scaleFor(s.currency, ctx.scales);
  const env = { locale: ctx.formatLocale, scale };
  const currencies = useMemo(() => enabledCurrencies(ctx), [ctx]);
  const accountOptions = catalogs.accounts.filter(
    (a) => a.status === 'ACTIVE' || a.id === s.paymentAccountId,
  );
  const groups = useMemo(
    () => categoryOptions(catalogs.categories, catalogs.groups, 'EXPENSE'),
    [catalogs.categories, catalogs.groups],
  );
  const mismatch = currencyMismatch(s.currency, accountCurrency);
  const needsEffective =
    editing &&
    (s.paymentAccountId !== initial.paymentAccountId ||
      s.cadence !== initial.cadence ||
      s.interval !== initial.interval);

  const err = (field: string): string | undefined => {
    const code = errors[field];
    return code ? f.t(`errors.${code}`) : undefined;
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    setProblem(undefined);
    const built = editing ? buildUpdateBody(initial, s, effectiveFrom, env) : buildCreateBody(s, env);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    inFlight.current = true;
    setBusy(true);
    try {
      const r =
        editing && subscription
          ? await ctx.api.command<Subscription>(
              'PATCH',
              `${ctx.base}/subscriptions/${subscription.id}`,
              built.body,
              { ifMatch: subscription.version },
            )
          : await ctx.api.command<Subscription>('POST', `${ctx.base}/subscriptions`, built.body, {
              idempotencyKey: attemptKey.current,
            });
      attemptKey.current = uuidv7();
      notifyRecurringChanged();
      if (r.data) onSaved(r.data);
    } catch (error) {
      setProblem(problemOf(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(ev) => void submit(ev)}
      aria-labelledby="subscription-form-title"
      style={formStyle}
      data-testid="subscription-form"
      noValidate
    >
      <h2 id="subscription-form-title" style={{ margin: 0 }}>
        {editing ? f.t('form.editTitle') : f.t('form.createTitle')}
      </h2>

      {!editing ? (
        <div>
          <CounterpartyPicker
            ctx={ctx}
            f={f}
            counterparties={catalogs.counterparties}
            value={s.counterpartyId}
            onChange={(id) => set({ counterpartyId: id })}
            onCreated={catalogs.addCounterparty}
          />
          {errors['counterpartyId'] ? (
            <p role="alert" style={{ margin: 0, color: 'var(--pf-error)' }} data-testid="field-error">
              {err('counterpartyId')}
            </p>
          ) : (
            <small style={mutedStyle}>{f.t('form.providerHint')}</small>
          )}
        </div>
      ) : null}

      <div style={rowStyle}>
        <Field label={f.t('form.name')} error={err('name')}>
          {(p) => (
            <input
              {...p}
              name="name"
              required
              maxLength={120}
              autoComplete="off"
              style={inputStyle}
              value={s.name}
              onChange={(ev) => set({ name: ev.target.value })}
            />
          )}
        </Field>
        <Field label={f.t('form.plan')}>
          {(p) => (
            <input
              {...p}
              name="planName"
              maxLength={120}
              autoComplete="off"
              style={inputStyle}
              value={s.planName}
              onChange={(ev) => set({ planName: ev.target.value })}
            />
          )}
        </Field>
      </div>

      {!editing ? (
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
          <legend>{f.t('form.priceLegend')}</legend>
          <div style={rowStyle}>
            <Field label={f.t('form.price')} error={err('price')}>
              {(p) => (
                <input
                  {...p}
                  name="price"
                  inputMode="decimal"
                  autoComplete="off"
                  style={inputStyle}
                  value={s.price}
                  onChange={(ev) => set({ price: ev.target.value })}
                />
              )}
            </Field>
            <Field label={f.t('form.currency')}>
              {(p) => (
                <select
                  {...p}
                  name="currency"
                  style={inputStyle}
                  value={s.currency}
                  onChange={(ev) => set({ currency: ev.target.value })}
                >
                  {currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        </fieldset>
      ) : null}

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
        <legend>{f.t('form.cycleLegend')}</legend>
        <div style={rowStyle}>
          <Field label={f.t('form.cadence')}>
            {(p) => (
              <select
                {...p}
                name="cadence"
                style={inputStyle}
                value={s.cadence}
                onChange={(ev) => set({ cadence: ev.target.value as FormState['cadence'] })}
              >
                {SUBSCRIPTION_CADENCES.map((c) => (
                  <option key={c} value={c}>
                    {f.t(`cadences.${c}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={f.t('form.interval')} hint={f.t('form.intervalHint')} error={err('interval')}>
            {(p) => (
              <input
                {...p}
                type="number"
                name="interval"
                min={1}
                max={120}
                inputMode="numeric"
                style={inputStyle}
                value={s.interval}
                onChange={(ev) => set({ interval: ev.target.value })}
              />
            )}
          </Field>
          {!editing ? (
            <>
              <Field
                label={f.t('form.firstRenewal')}
                hint={f.t('form.firstRenewalHint')}
                error={err('firstRenewalOn')}
              >
                {(p) => (
                  <input
                    {...p}
                    type="date"
                    name="firstRenewalOn"
                    style={inputStyle}
                    value={s.firstRenewalOn}
                    onChange={(ev) => set({ firstRenewalOn: ev.target.value })}
                  />
                )}
              </Field>
              <Field
                label={f.t('form.trialEnds')}
                hint={f.t('form.trialEndsHint')}
                error={err('trialEndsOn')}
              >
                {(p) => (
                  <input
                    {...p}
                    type="date"
                    name="trialEndsOn"
                    style={inputStyle}
                    value={s.trialEndsOn}
                    onChange={(ev) => set({ trialEndsOn: ev.target.value })}
                  />
                )}
              </Field>
            </>
          ) : null}
        </div>
      </fieldset>

      <div style={rowStyle}>
        <Field label={f.t('form.paymentAccount')} error={err('paymentAccountId')}>
          {(p) => (
            <select
              {...p}
              name="paymentAccountId"
              style={inputStyle}
              value={s.paymentAccountId}
              onChange={(ev) => set({ paymentAccountId: ev.target.value })}
            >
              <option value="">{f.t('form.chooseAccount')}</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={f.t('form.category')}>
          {(p) => (
            <select
              {...p}
              name="categoryId"
              style={inputStyle}
              value={s.categoryId}
              onChange={(ev) => set({ categoryId: ev.target.value })}
            >
              <option value="">{f.t('form.noCategory')}</option>
              {groups.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </Field>
      </div>
      {mismatch && accountCurrency ? (
        <div role="note" style={warningStyle} data-testid="currency-mismatch">
          <span aria-hidden="true">ℹ</span>{' '}
          {f.t('form.currencyMismatch', { price: s.currency, account: accountCurrency })}
        </div>
      ) : null}
      {needsEffective ? (
        <Field
          label={f.t('form.effectiveFrom')}
          hint={f.t('form.effectiveFromHint')}
          error={err('effectiveFrom')}
        >
          {(p) => (
            <input
              {...p}
              type="date"
              name="effectiveFrom"
              style={inputStyle}
              value={effectiveFrom}
              onChange={(ev) => setEffectiveFrom(ev.target.value)}
            />
          )}
        </Field>
      ) : null}

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
        <legend>{f.t('form.modeLegend')}</legend>
        <div
          role="radiogroup"
          aria-label={f.t('form.modeLegend')}
          style={{ display: 'grid', gap: 'var(--pf-space-1)' }}
        >
          {MATERIALIZATION_MODES.map((m) => (
            <label key={m} style={{ display: 'flex', gap: '0.5rem', alignItems: 'start' }}>
              <input
                type="radio"
                name="mode"
                value={m}
                checked={s.mode === m}
                onChange={() => set({ mode: m })}
              />
              <span>
                {f.t(`modes.${m}`)}
                <small style={{ ...mutedStyle, display: 'block' }}>{f.t(`form.modeHint.${m}`)}</small>
              </span>
            </label>
          ))}
        </div>
        {s.mode === 'AUTO_CREATE' ? (
          <Field label={f.t('form.autoCreateStatus')}>
            {(p) => (
              <select
                {...p}
                name="autoCreateStatus"
                style={inputStyle}
                value={s.autoCreateStatus}
                onChange={(ev) => set({ autoCreateStatus: ev.target.value as FormState['autoCreateStatus'] })}
              >
                <option value="PENDING">{f.t('form.statusPending')}</option>
                <option value="POSTED">{f.t('form.statusPosted')}</option>
              </select>
            )}
          </Field>
        ) : null}
      </fieldset>

      <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
        <legend>{f.t('form.alertsLegend')}</legend>
        <div style={rowStyle}>
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              name="reminderEnabled"
              checked={s.reminderEnabled}
              onChange={(ev) => set({ reminderEnabled: ev.target.checked })}
            />
            {f.t('form.reminderEnabled')}
          </label>
          <Field
            label={f.t('form.reminderDays')}
            hint={f.t('form.reminderDaysHint')}
            error={err('reminderDays')}
          >
            {(p) => (
              <input
                {...p}
                type="number"
                name="reminderDays"
                min={1}
                max={30}
                inputMode="numeric"
                style={inputStyle}
                value={s.reminderDays}
                disabled={!s.reminderEnabled}
                onChange={(ev) => set({ reminderDays: ev.target.value })}
              />
            )}
          </Field>
          <Field label={f.t('form.tolerance')} hint={f.t('form.toleranceHint')} error={err('tolerance')}>
            {(p) => (
              <input
                {...p}
                name="tolerance"
                inputMode="decimal"
                autoComplete="off"
                style={inputStyle}
                value={s.tolerance}
                onChange={(ev) => set({ tolerance: ev.target.value })}
              />
            )}
          </Field>
        </div>
        <Field
          label={f.t('form.cancellationUrl')}
          hint={f.t('form.cancellationUrlHint')}
          error={err('cancellationUrl')}
        >
          {(p) => (
            <input
              {...p}
              type="url"
              name="cancellationUrl"
              maxLength={500}
              autoComplete="off"
              style={inputStyle}
              value={s.cancellationUrl}
              onChange={(ev) => set({ cancellationUrl: ev.target.value })}
            />
          )}
        </Field>
      </fieldset>

      {errors['form'] ? (
        <p role="alert" style={{ margin: 0, color: 'var(--pf-error)' }} data-testid="form-error">
          {err('form')}
        </p>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="subscription-submit">
          {busy ? f.t('form.saving') : editing ? f.t('form.save') : f.t('form.create')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          {f.t('cancel')}
        </button>
      </div>
    </form>
  );
}
