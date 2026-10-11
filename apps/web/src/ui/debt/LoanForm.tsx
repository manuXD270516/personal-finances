'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { scaleFor } from '../common/money';
import { todayIn } from '../common/dates';
import type { Account, Counterparty } from '../common/types';
import { Field, formStyle, inputStyle, mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { useCatalogs } from '../transactions/catalogs';
import {
  buildLoanInput,
  buildPreviewInput,
  emptyLoanForm,
  previewPath,
  loansPath,
  type ChargeForm,
  type LoanForm,
  type LoanFormErrors,
} from './logic';
import { SchedulePreviewTable } from './Tables';
import {
  CHARGE_KEYS,
  DAY_COUNTS,
  FREQUENCIES,
  type ChargeKey,
  type LoanDetail,
  type SchedulePreview,
} from './types';

export function NewLoanPage() {
  return <WithWorkspace>{(ctx) => <NewLoan ctx={ctx} />}</WithWorkspace>;
}

/** Campos del alta (presentacional): cambia entre "Préstamo nuevo" y "Préstamo en curso" y muestra errores por campo. */
export function LoanFields({
  f,
  form,
  set,
  errors,
  accounts,
  counterparties,
  currencies,
  disabled,
}: {
  f: FormatContext;
  form: LoanForm;
  set: (patch: Partial<LoanForm>) => void;
  errors: LoanFormErrors;
  accounts: readonly Account[];
  counterparties: readonly Counterparty[];
  currencies: readonly string[];
  disabled?: boolean;
}) {
  const err = (key: string) => (errors[key] ? f.t(`errors.${errors[key]}`) : undefined);
  const existing = form.origin === 'EXISTING';
  const sameCurrency = accounts.filter((a) => a.currency === form.currency && a.status === 'ACTIVE');
  const loanAccounts = sameCurrency.filter((a) => a.type === 'LOAN');
  const funding = sameCurrency.filter((a) => a.type !== 'LOAN' && a.classification === 'ASSET');
  const setCharge = (key: ChargeKey, patch: Partial<ChargeForm>) =>
    set({ charges: { ...form.charges, [key]: { ...form.charges[key], ...patch } } });

  return (
    <>
      <fieldset style={{ ...formStyle, margin: 0 }} disabled={disabled}>
        <legend>{f.t('form.origin')}</legend>
        <div style={rowStyle} role="radiogroup" aria-label={f.t('form.origin')}>
          {(['NEW', 'EXISTING'] as const).map((o) => (
            <label key={o} style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
              <input
                type="radio"
                name="loan-origin"
                value={o}
                checked={form.origin === o}
                data-testid={`loan-origin-${o}`}
                onChange={() => set({ origin: o })}
              />
              {f.t(`form.origins.${o}`)}
            </label>
          ))}
        </div>
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t(`form.originHint.${form.origin}`)}</p>
      </fieldset>

      <fieldset style={{ ...formStyle, margin: 0 }} disabled={disabled}>
        <legend>{f.t('form.terms')}</legend>
        <div style={rowStyle}>
          <Field label={f.t('form.name')} error={err('name')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                value={form.name}
                maxLength={120}
                data-testid="loan-name"
                onChange={(e) => set({ name: e.target.value })}
              />
            )}
          </Field>
          <Field label={f.t('form.currency')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={form.currency}
                data-testid="loan-currency"
                onChange={(e) => set({ currency: e.target.value })}
              >
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label={existing ? f.t('form.outstanding') : f.t('form.principal')}
            error={err('principal')}
            hint={existing ? f.t('form.outstandingHint') : undefined}
          >
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={form.principal}
                data-testid="loan-principal"
                onChange={(e) => set({ principal: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div style={rowStyle}>
          <Field label={f.t('form.rate')} error={err('ratePct')} hint={f.t('form.rateHint')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={form.ratePct}
                data-testid="loan-rate"
                onChange={(e) => set({ ratePct: e.target.value })}
              />
            )}
          </Field>
          <Field label={f.t('form.dayCount')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={form.dayCount}
                data-testid="loan-daycount"
                onChange={(e) => set({ dayCount: e.target.value as LoanForm['dayCount'] })}
              >
                {DAY_COUNTS.map((d) => (
                  <option key={d} value={d}>
                    {f.t(`dayCount.${d}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={f.t('form.frequency')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={form.frequency}
                data-testid="loan-frequency"
                onChange={(e) => set({ frequency: e.target.value as LoanForm['frequency'] })}
              >
                {FREQUENCIES.map((d) => (
                  <option key={d} value={d}>
                    {f.t(`frequency.${d}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field
            label={existing ? f.t('form.remaining') : f.t('form.term')}
            error={err('termInstallments')}
            hint={f.t('form.termHint')}
          >
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="numeric"
                value={form.termInstallments}
                data-testid="loan-term"
                onChange={(e) => set({ termInstallments: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div style={rowStyle}>
          {existing ? (
            <>
              <Field label={f.t('form.asOf')} error={err('asOf')}>
                {(p) => (
                  <input
                    {...p}
                    type="date"
                    style={inputStyle}
                    value={form.asOf}
                    data-testid="loan-as-of"
                    onChange={(e) => set({ asOf: e.target.value })}
                  />
                )}
              </Field>
              <Field label={f.t('form.nextNo')} error={err('nextInstallmentNo')}>
                {(p) => (
                  <input
                    {...p}
                    style={inputStyle}
                    inputMode="numeric"
                    value={form.nextInstallmentNo}
                    data-testid="loan-next-no"
                    onChange={(e) => set({ nextInstallmentNo: e.target.value })}
                  />
                )}
              </Field>
              <Field label={f.t('form.nextDue')} error={err('firstDueDate')}>
                {(p) => (
                  <input
                    {...p}
                    type="date"
                    style={inputStyle}
                    value={form.firstDueDate}
                    data-testid="loan-first-due"
                    onChange={(e) => set({ firstDueDate: e.target.value })}
                  />
                )}
              </Field>
            </>
          ) : (
            <>
              <Field label={f.t('form.disbursementDate')} error={err('disbursementDate')}>
                {(p) => (
                  <input
                    {...p}
                    type="date"
                    style={inputStyle}
                    value={form.disbursementDate}
                    data-testid="loan-disbursement-date"
                    onChange={(e) => set({ disbursementDate: e.target.value })}
                  />
                )}
              </Field>
              <Field label={f.t('form.firstDue')} error={err('firstDueDate')}>
                {(p) => (
                  <input
                    {...p}
                    type="date"
                    style={inputStyle}
                    value={form.firstDueDate}
                    data-testid="loan-first-due"
                    onChange={(e) => set({ firstDueDate: e.target.value })}
                  />
                )}
              </Field>
            </>
          )}
        </div>
      </fieldset>

      <fieldset style={{ ...formStyle, margin: 0 }} disabled={disabled}>
        <legend>{f.t('form.charges')}</legend>
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t('form.chargesHint')}</p>
        {CHARGE_KEYS.map((key) => {
          const c = form.charges[key];
          return (
            <div key={key} style={rowStyle}>
              <Field label={f.t(`form.chargeKind.${key}`)}>
                {(p) => (
                  <select
                    {...p}
                    style={inputStyle}
                    value={c.mode}
                    data-testid={`charge-${key}-mode`}
                    onChange={(e) => setCharge(key, { mode: e.target.value as ChargeForm['mode'] })}
                  >
                    <option value="NONE">{f.t('form.chargeModes.NONE')}</option>
                    <option value="FIXED">{f.t('form.chargeModes.FIXED')}</option>
                    <option value="RATE_ON_BALANCE">{f.t('form.chargeModes.RATE_ON_BALANCE')}</option>
                  </select>
                )}
              </Field>
              {c.mode !== 'NONE' ? (
                <Field
                  label={c.mode === 'FIXED' ? f.t('form.chargeFixed') : f.t('form.chargeRate')}
                  error={err(`charges.${key}`)}
                  hint={c.mode === 'RATE_ON_BALANCE' ? f.t('form.chargeRateHint') : undefined}
                >
                  {(p) => (
                    <input
                      {...p}
                      style={inputStyle}
                      inputMode="decimal"
                      value={c.value}
                      data-testid={`charge-${key}-value`}
                      onChange={(e) => setCharge(key, { value: e.target.value })}
                    />
                  )}
                </Field>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <fieldset style={{ ...formStyle, margin: 0 }} disabled={disabled}>
        <legend>{f.t('form.accounts')}</legend>
        <div style={rowStyle}>
          <Field label={f.t('form.lender')} hint={f.t('form.lenderHint')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={form.lenderCounterpartyId}
                data-testid="loan-lender"
                onChange={(e) => set({ lenderCounterpartyId: e.target.value })}
              >
                <option value="">{f.t('form.none')}</option>
                {counterparties
                  .filter((c) => !c.archivedAt)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
        </div>
        <div role="radiogroup" aria-label={f.t('form.loanAccount')} style={rowStyle}>
          {(['CREATE', 'EXISTING'] as const).map((m) => (
            <label key={m} style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
              <input
                type="radio"
                name="loan-account-mode"
                checked={form.accountMode === m}
                data-testid={`loan-account-mode-${m}`}
                onChange={() => set({ accountMode: m })}
              />
              {f.t(`form.accountModes.${m}`)}
            </label>
          ))}
        </div>
        <div style={rowStyle}>
          {form.accountMode === 'CREATE' ? (
            <Field
              label={f.t('form.newAccountName')}
              error={err('newAccountName')}
              hint={f.t('form.newAccountHint')}
            >
              {(p) => (
                <input
                  {...p}
                  style={inputStyle}
                  value={form.newAccountName}
                  maxLength={120}
                  data-testid="loan-new-account-name"
                  onChange={(e) => set({ newAccountName: e.target.value })}
                />
              )}
            </Field>
          ) : (
            <Field label={f.t('form.existingAccount')} error={err('accountId')}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={form.accountId}
                  data-testid="loan-account"
                  onChange={(e) => set({ accountId: e.target.value })}
                >
                  <option value="">{f.t('form.choose')}</option>
                  {loanAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {!existing ? (
            <Field label={f.t('form.disbursementAccount')} error={err('disbursementAccountId')}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={form.disbursementAccountId}
                  data-testid="loan-disbursement-account"
                  onChange={(e) => set({ disbursementAccountId: e.target.value })}
                >
                  <option value="">{f.t('form.choose')}</option>
                  {funding.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.currency})
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
          <Field
            label={f.t('form.paymentAccount')}
            error={err('paymentAccountId')}
            hint={f.t('form.paymentAccountHint')}
          >
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={form.paymentAccountId}
                data-testid="loan-payment-account"
                onChange={(e) => set({ paymentAccountId: e.target.value })}
              >
                <option value="">{f.t('form.choose')}</option>
                {funding.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.currency})
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        {!existing ? (
          <div style={rowStyle}>
            <label style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={form.disburseNow}
                data-testid="loan-disburse-now"
                onChange={(e) => set({ disburseNow: e.target.checked })}
              />
              {f.t('form.disburseNow')}
            </label>
            {form.disburseNow ? (
              <Field
                label={f.t('form.retainedFee')}
                error={err('retainedFee')}
                hint={f.t('form.retainedFeeHint')}
              >
                {(p) => (
                  <input
                    {...p}
                    style={inputStyle}
                    inputMode="decimal"
                    value={form.retainedFee}
                    data-testid="loan-retained-fee"
                    onChange={(e) => set({ retainedFee: e.target.value })}
                  />
                )}
              </Field>
            ) : null}
          </div>
        ) : null}
      </fieldset>
    </>
  );
}

type PreviewState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly preview: SchedulePreview }
  | { readonly status: 'error'; readonly problem: ApiProblemBody };

function NewLoan({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Debt', ctx);
  const catalogs = useCatalogs(ctx);
  const today = todayIn(ctx.timeZone);
  const [form, setForm] = useState<LoanForm>(() => emptyLoanForm(ctx.ws.baseCurrency, today));
  const [errors, setErrors] = useState<LoanFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });
  const attemptKey = useRef(uuidv7());
  const errorsRef = useRef<HTMLDivElement>(null);
  // El foco se aplica tras el render que muestra los errores (un `setTimeout` puede ganarle a React).
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick > 0) errorsRef.current?.focus();
  }, [focusTick]);
  const set = (patch: Partial<LoanForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const currencies = useMemo(() => {
    const codes = ctx.currencies.filter((c) => c.enabled && c.kind === 'FIAT').map((c) => c.code);
    return codes.length > 0 ? codes : [ctx.ws.baseCurrency];
  }, [ctx.currencies, ctx.ws.baseCurrency]);

  const opts = useMemo(
    () => ({ locale: ctx.formatLocale, scale: scaleFor(form.currency, ctx.scales) }),
    [ctx.formatLocale, ctx.scales, form.currency],
  );

  // Vista previa en vivo (sin persistir): se pide cuando las condiciones están completas y válidas.
  const previewBody = useMemo(() => buildPreviewInput(form, opts), [form, opts]);
  const previewKey = previewBody ? JSON.stringify(previewBody) : '';
  useEffect(() => {
    if (!previewBody) {
      setPreview({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setPreview((p) => (p.status === 'ready' ? p : { status: 'loading' }));
    const timer = setTimeout(() => {
      ctx.api
        .command<SchedulePreview>('POST', previewPath(ctx.base), previewBody, { idempotent: false })
        .then((r) => {
          if (!cancelled && r.data) setPreview({ status: 'ready', preview: r.data });
        })
        .catch((err: unknown) => {
          if (!cancelled) setPreview({ status: 'error', problem: problemOf(err) });
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `previewKey` resume `previewBody`: evita repetir la petición por cambios que no alteran las condiciones.
  }, [ctx.api, ctx.base, previewKey]);

  async function submit() {
    setProblem(undefined);
    const built = buildLoanInput(form, opts);
    if (!built.ok) {
      setErrors(built.errors);
      setFocusTick((n) => n + 1);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await ctx.api.command<LoanDetail>('POST', loansPath(ctx.base), built.input, {
        idempotencyKey: attemptKey.current,
      });
      window.location.assign(ctx.href(`/debts/${r.data!.id}?creado=1`));
    } catch (err) {
      attemptKey.current = uuidv7();
      setProblem(problemOf(err));
      setBusy(false);
      setFocusTick((n) => n + 1);
    }
  }

  if (!ctx.canEdit)
    return (
      <section style={pageStyle}>
        <h1>{f.t('form.title')}</h1>
        <p style={mutedStyle}>{f.t('viewerNotice')}</p>
      </section>
    );

  const errorList = Object.keys(errors);
  return (
    <section aria-labelledby="loan-form-title" style={pageStyle} data-testid="loan-form-page">
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/debts')}>{f.t('back')}</a>
      </p>
      <h1 id="loan-form-title">{f.t('form.title')}</h1>
      <form
        style={{ display: 'grid', gap: 'var(--pf-space-4)' }}
        noValidate
        data-testid="loan-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <LoanFields
          f={f}
          form={form}
          set={set}
          errors={errors}
          accounts={catalogs.accounts}
          counterparties={catalogs.counterparties}
          currencies={currencies}
          disabled={busy}
        />
        <section aria-labelledby="loan-preview-title" aria-live="polite" data-testid="loan-preview">
          <h2 id="loan-preview-title" style={{ fontSize: '1.125rem' }}>
            {f.t('preview.title')}
          </h2>
          {preview.status === 'ready' ? (
            <SchedulePreviewTable f={f} preview={preview.preview} />
          ) : preview.status === 'error' ? (
            <ProblemMessage problem={preview.problem} locale={ctx.uiLocale} />
          ) : (
            <p style={mutedStyle} aria-busy={preview.status === 'loading'}>
              {preview.status === 'loading' ? f.t('preview.loading') : f.t('preview.waiting')}
            </p>
          )}
        </section>
        <div ref={errorsRef} tabIndex={-1} data-testid="loan-form-errors">
          {errorList.length > 0 ? (
            <p role="alert" style={{ color: 'var(--pf-error)', margin: 0 }}>
              {f.t('form.fixErrors', { count: errorList.length })}
            </p>
          ) : null}
          {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
        </div>
        <div>
          <button type="submit" disabled={busy} data-testid="loan-submit">
            {busy
              ? f.t('form.saving')
              : form.disburseNow && form.origin === 'NEW'
                ? f.t('form.saveAndDisburse')
                : f.t('form.save')}
          </button>
        </div>
      </form>
    </section>
  );
}
