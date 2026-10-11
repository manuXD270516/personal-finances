'use client';

import { useEffect, useRef, useState } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { scaleFor } from '../common/money';
import { ConfirmPanel, Field, formStyle, inputStyle, mutedStyle, rowStyle, warningStyle } from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import type { Account, Counterparty } from '../common/types';
import { PAYMENT_METHODS } from '../common/types';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import {
  BREAKDOWN_FIELDS,
  breakdownDelta,
  breakdownSum,
  buildPaymentInput,
  loanPath,
  parseDisburseFee,
  type LoanFormErrors,
  type PaymentForm,
} from './logic';
import { isZeroAmount } from '../common/money';
import { formatDecimal } from '../AuditHistory';
import type { LoanDetail, LoanPaymentResult } from './types';

interface PanelProps {
  readonly ctx: WorkspaceContext;
  readonly f: FormatContext;
  readonly loan: LoanDetail;
  readonly onCancel: () => void;
  /** `loan` es el préstamo actualizado cuando la respuesta lo trae. */
  readonly onDone: (message: string) => void;
}

/** Campos del pago (presentacional): modo automático o desglose del recibo con la suma y su diferencia. */
export function PaymentFields({
  f,
  form,
  set,
  errors,
  accounts,
  currency,
  locale,
  scale,
  disabled,
}: {
  f: FormatContext;
  form: PaymentForm;
  set: (patch: Partial<PaymentForm>) => void;
  errors: LoanFormErrors;
  accounts: readonly Account[];
  currency: string;
  locale: string;
  scale: number;
  disabled?: boolean;
}) {
  const err = (k: string) => (errors[k] ? f.t(`errors.${errors[k]}`) : undefined);
  const funding = accounts.filter(
    (a) => a.status === 'ACTIVE' && a.currency === currency && a.type !== 'LOAN',
  );
  const o = { locale, scale, currency };
  const sum = form.mode === 'BREAKDOWN' ? breakdownSum(form, o) : null;
  const delta = form.mode === 'BREAKDOWN' ? breakdownDelta(form, o) : null;
  return (
    <fieldset style={{ ...formStyle, margin: 0 }} disabled={disabled}>
      <legend>{f.t('payment.title')}</legend>
      <div style={rowStyle}>
        <Field label={f.t('payment.amount', { currency })} error={err('amount')}>
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="decimal"
              value={form.amount}
              data-testid="payment-amount"
              onChange={(e) => set({ amount: e.target.value })}
            />
          )}
        </Field>
        <Field label={f.t('payment.date')} error={err('businessDate')}>
          {(p) => (
            <input
              {...p}
              type="date"
              style={inputStyle}
              value={form.businessDate}
              data-testid="payment-date"
              onChange={(e) => set({ businessDate: e.target.value })}
            />
          )}
        </Field>
        <Field label={f.t('payment.account')} error={err('accountId')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={form.accountId}
              data-testid="payment-account"
              onChange={(e) => set({ accountId: e.target.value })}
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
        <Field label={f.t('payment.method')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={form.paymentMethod}
              data-testid="payment-method"
              onChange={(e) => set({ paymentMethod: e.target.value })}
            >
              <option value="">{f.t('form.none')}</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {f.t(`paymentMethods.${m}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <div role="radiogroup" aria-label={f.t('payment.mode')} style={rowStyle}>
        {(['AUTO', 'BREAKDOWN'] as const).map((m) => (
          <label key={m} style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
            <input
              type="radio"
              name="payment-mode"
              checked={form.mode === m}
              data-testid={`payment-mode-${m}`}
              onChange={() => set({ mode: m })}
            />
            {f.t(`payment.modes.${m}`)}
          </label>
        ))}
      </div>
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t(`payment.modeHint.${form.mode}`)}</p>
      {form.mode === 'BREAKDOWN' ? (
        <div style={{ display: 'grid', gap: 'var(--pf-space-2)' }} data-testid="payment-breakdown">
          <div style={rowStyle}>
            <Field label={f.t('payment.installmentNo')} error={err('installmentNo')}>
              {(p) => (
                <input
                  {...p}
                  style={inputStyle}
                  inputMode="numeric"
                  value={form.installmentNo}
                  data-testid="payment-installment-no"
                  onChange={(e) => set({ installmentNo: e.target.value })}
                />
              )}
            </Field>
            {BREAKDOWN_FIELDS.map((k) => (
              <Field key={k} label={f.t(`components.${k}`)} error={err(k)}>
                {(p) => (
                  <input
                    {...p}
                    style={inputStyle}
                    inputMode="decimal"
                    value={form[k]}
                    data-testid={`payment-${k}`}
                    onChange={(e) => set({ [k]: e.target.value } as Partial<PaymentForm>)}
                  />
                )}
              </Field>
            ))}
          </div>
          <p aria-live="polite" style={{ margin: 0 }} data-testid="payment-breakdown-sum">
            {sum === null
              ? f.t('payment.sumInvalid')
              : f.t('payment.sum', { sum: formatDecimal(sum, locale), currency })}
            {delta !== null && !isZeroAmount(delta) ? (
              <span style={{ color: 'var(--pf-error)' }} data-testid="payment-breakdown-delta">
                {' '}
                <span aria-hidden="true">⚠</span>{' '}
                {f.t('payment.sumMismatch', { delta: formatDecimal(delta, locale), currency })}
              </span>
            ) : delta !== null ? (
              <span data-testid="payment-breakdown-ok"> ✓ {f.t('payment.sumMatches')}</span>
            ) : null}
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}

/** Panel "Registrar pago": imputación automática o desglose del recibo; muestra `PAYMENT_BREAKDOWN_MISMATCH` / `LOAN_OVERPAYMENT`. */
export function PaymentPanel({
  ctx,
  f,
  loan,
  accounts,
  initial,
  onCancel,
  onDone,
}: PanelProps & { accounts: readonly Account[]; initial: PaymentForm }) {
  const [form, setForm] = useState<PaymentForm>(initial);
  const [errors, setErrors] = useState<LoanFormErrors>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const key = useRef(uuidv7());
  const alertRef = useRef<HTMLDivElement>(null);
  // El foco se aplica tras el render que muestra los errores (un `setTimeout` puede ganarle a React).
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick > 0) alertRef.current?.focus();
  }, [focusTick]);
  const currency = loan.principal.currency;
  const scale = scaleFor(currency, ctx.scales);

  async function submit() {
    setProblem(undefined);
    const built = buildPaymentInput(form, { locale: ctx.formatLocale, scale, currency });
    if (!built.ok) {
      setErrors(built.errors);
      setFocusTick((n) => n + 1);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await ctx.api.command<LoanPaymentResult>(
        'POST',
        `${loanPath(ctx.base, loan.id)}/payments`,
        built.input,
        {
          idempotencyKey: key.current,
        },
      );
      onDone(f.t('payment.done'));
    } catch (err) {
      key.current = uuidv7();
      setProblem(problemOf(err));
      setBusy(false);
      setFocusTick((n) => n + 1);
    }
  }

  return (
    <form
      style={{ display: 'grid', gap: 'var(--pf-space-3)' }}
      noValidate
      data-testid="payment-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <PaymentFields
        f={f}
        form={form}
        set={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
        errors={errors}
        accounts={accounts}
        currency={currency}
        locale={ctx.formatLocale}
        scale={scale}
        disabled={busy}
      />
      <div ref={alertRef} tabIndex={-1} data-testid="payment-errors">
        {Object.keys(errors).length > 0 ? (
          <p role="alert" style={{ color: 'var(--pf-error)', margin: 0 }}>
            {f.t('form.fixErrors', { count: Object.keys(errors).length })}
          </p>
        ) : null}
        {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      </div>
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="payment-submit">
          {busy ? f.t('payment.saving') : f.t('payment.submit')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {f.t('cancelAction')}
        </button>
      </div>
    </form>
  );
}

/** Desembolsar un borrador, con comisión retenida opcional. */
export function DisbursePanel({ ctx, f, loan, onCancel, onDone }: PanelProps) {
  const [fee, setFee] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const key = useRef(uuidv7());
  const currency = loan.principal.currency;

  async function submit() {
    setProblem(undefined);
    const parsed = parseDisburseFee(fee, {
      locale: ctx.formatLocale,
      scale: scaleFor(currency, ctx.scales),
      currency,
    });
    if (!parsed.ok) {
      setError(f.t(`errors.${parsed.error}`));
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      await ctx.api.command<LoanDetail>(
        'POST',
        `${loanPath(ctx.base, loan.id)}/disburse`,
        parsed.value === undefined ? {} : { retainedFee: parsed.value },
        { idempotencyKey: key.current },
      );
      onDone(f.t('disburse.done'));
    } catch (err) {
      key.current = uuidv7();
      setProblem(problemOf(err));
      setBusy(false);
    }
  }
  return (
    <form
      style={formStyle}
      noValidate
      data-testid="disburse-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <h2 style={{ fontSize: '1.125rem', margin: 0 }}>{f.t('disburse.title')}</h2>
      <p style={{ ...mutedStyle, margin: 0 }}>
        {f.t('disburse.hint', { amount: formatMoney(loan.principal, ctx.formatLocale) })}
      </p>
      <Field label={f.t('form.retainedFee')} error={error} hint={f.t('form.retainedFeeHint')}>
        {(p) => (
          <input
            {...p}
            style={inputStyle}
            inputMode="decimal"
            value={fee}
            data-testid="disburse-fee"
            onChange={(e) => setFee(e.target.value)}
          />
        )}
      </Field>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="disburse-submit">
          {f.t('disburse.submit')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {f.t('cancelAction')}
        </button>
      </div>
    </form>
  );
}

/** Confirmación con motivo obligatorio (cancelar el préstamo o anular el último pago). */
export function ReasonPanel({
  ctx,
  f,
  kind,
  loan,
  paymentId,
  onCancel,
  onDone,
}: PanelProps & { kind: 'cancel' | 'void'; paymentId?: string }) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const key = useRef(uuidv7());
  async function confirm() {
    setBusy(true);
    setProblem(undefined);
    try {
      const path =
        kind === 'cancel'
          ? `${loanPath(ctx.base, loan.id)}/cancel`
          : `${loanPath(ctx.base, loan.id)}/payments/${paymentId}/void`;
      await ctx.api.command(
        'POST',
        path,
        { reason: reason.trim() },
        { ifMatch: loan.version, idempotencyKey: key.current },
      );
      onDone(f.t(`${kind}.done`));
    } catch (err) {
      key.current = uuidv7();
      setProblem(problemOf(err));
      setBusy(false);
    }
  }
  return (
    <ConfirmPanel
      title={f.t(`${kind}.title`)}
      description={f.t(`${kind}.description`)}
      confirmLabel={f.t(`${kind}.confirm`)}
      cancelLabel={f.t('cancelAction')}
      busy={busy}
      confirmDisabled={reason.trim() === ''}
      onConfirm={() => void confirm()}
      onCancel={onCancel}
      testId={`${kind}-panel`}
    >
      <Field label={f.t('reason')}>
        {(p) => (
          <textarea
            {...p}
            rows={2}
            maxLength={500}
            style={inputStyle}
            value={reason}
            data-testid={`${kind}-reason`}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
    </ConfirmPanel>
  );
}

/** Edición con el loan activo: nombre, prestamista y cuenta de pago; las condiciones quedan bloqueadas (`LOAN_TERMS_LOCKED`). */
export function EditPanel({
  ctx,
  f,
  loan,
  accounts,
  counterparties,
  onCancel,
  onDone,
}: PanelProps & { accounts: readonly Account[]; counterparties: readonly Counterparty[] }) {
  const [name, setName] = useState(loan.name);
  const [lender, setLender] = useState(loan.lenderCounterpartyId ?? '');
  const [payment, setPayment] = useState(loan.paymentAccountId);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const funding = accounts.filter(
    (a) => a.status === 'ACTIVE' && a.currency === loan.principal.currency && a.type !== 'LOAN',
  );
  async function save() {
    setBusy(true);
    setProblem(undefined);
    const body: Record<string, unknown> = {};
    if (name.trim() !== loan.name) body['name'] = name.trim();
    if (lender !== (loan.lenderCounterpartyId ?? ''))
      body['lenderCounterpartyId'] = lender === '' ? null : lender;
    if (payment !== loan.paymentAccountId) body['paymentAccountId'] = payment;
    try {
      await ctx.api.command('PATCH', loanPath(ctx.base, loan.id), body, { ifMatch: loan.version });
      onDone(f.t('edit.done'));
    } catch (err) {
      setProblem(problemOf(err));
      setBusy(false);
    }
  }
  return (
    <form
      style={formStyle}
      noValidate
      data-testid="loan-edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 style={{ fontSize: '1.125rem', margin: 0 }}>{f.t('edit.title')}</h2>
      <p style={{ ...warningStyle, margin: 0 }} data-testid="loan-terms-locked">
        {loan.status === 'DRAFT' ? f.t('edit.draftNote') : f.t('edit.locked')}
      </p>
      <div style={rowStyle}>
        <Field label={f.t('form.name')}>
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              value={name}
              maxLength={120}
              data-testid="edit-name"
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label={f.t('form.lender')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={lender}
              data-testid="edit-lender"
              onChange={(e) => setLender(e.target.value)}
            >
              <option value="">{f.t('form.none')}</option>
              {counterparties
                .filter((c) => !c.archivedAt || c.id === loan.lenderCounterpartyId)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          )}
        </Field>
        <Field label={f.t('form.paymentAccount')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={payment}
              data-testid="edit-payment-account"
              onChange={(e) => setPayment(e.target.value)}
            >
              {funding.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      <div style={rowStyle}>
        <button type="submit" disabled={busy || name.trim() === ''} data-testid="edit-submit">
          {f.t('edit.save')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {f.t('cancelAction')}
        </button>
      </div>
    </form>
  );
}
