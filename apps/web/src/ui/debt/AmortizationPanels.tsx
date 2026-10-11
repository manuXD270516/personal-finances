'use client';

import { useEffect, useRef, useState } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { scaleFor } from '../common/money';
import type { Account } from '../common/types';
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
} from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { formatBusinessDate } from '../planning/logic';
import { formatDecimal } from '../AuditHistory';
import {
  buildCustomRows,
  buildPrepaymentInput,
  buildRateChangeInput,
  customPrincipalSum,
  customSchedulePath,
  emptyCustomRow,
  fractionToPercent,
  prepaymentsPath,
  principalGap,
  rateChangesPath,
  type CustomRowForm,
  type LoanFormErrors,
  type PrepaymentForm,
  type RateChangeForm,
} from './logic';
import {
  PREPAYMENT_OPTIONS,
  type LoanDetail,
  type PrepaymentOption,
  type PrepaymentPreview,
  type RateChange,
  type RateChangePreview,
  type ReferenceSchedule,
  type ScheduleTail,
  type ScheduleVersion,
} from './types';

interface PanelProps {
  readonly ctx: WorkspaceContext;
  readonly f: FormatContext;
  readonly loan: LoanDetail;
  readonly onCancel: () => void;
  readonly onDone: (message: string) => void;
}

/** Aviso de errores + problema de la API con el foco para lectores de pantalla (patrón de los demás paneles). */
function Feedback({
  f,
  ctx,
  errors,
  problem,
  alertRef,
  testId,
}: {
  f: FormatContext;
  ctx: WorkspaceContext;
  errors: LoanFormErrors;
  problem: ApiProblemBody | undefined;
  alertRef: React.RefObject<HTMLDivElement | null>;
  testId: string;
}) {
  const count = Object.keys(errors).length;
  return (
    <div ref={alertRef} tabIndex={-1} data-testid={testId}>
      {count > 0 ? (
        <p role="alert" style={{ color: 'var(--pf-error)', margin: 0 }}>
          {f.t('form.fixErrors', { count })}
        </p>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
    </div>
  );
}

function useFocusOnFeedback() {
  const ref = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (tick > 0) ref.current?.focus();
  }, [tick]);
  return { ref, bump: () => setTick((n) => n + 1) };
}

const tailMoney = (f: FormatContext, m: { amount: string; currency: string } | null): string =>
  m ? formatMoney(m, f.locale) : '—';

/** Comparación del cronograma vigente con una alternativa: cuota, fin, interés restante y ahorro. */
function TailCells({ f, tail }: { f: FormatContext; tail: ScheduleTail }) {
  return (
    <>
      <td style={numCellStyle}>{tailMoney(f, tail.installmentAmount)}</td>
      <td style={cellStyle}>{tail.endDate ? formatBusinessDate(tail.endDate) : '—'}</td>
      <td style={numCellStyle}>{tailMoney(f, tail.remainingInterest)}</td>
    </>
  );
}

// ───────────────────────────── Pago extraordinario ─────────────────────────────

/** Panel "Pago extraordinario": vista previa comparada de ambas opciones (cuota, fin, ahorro) y comisión opcional. */
export function PrepaymentPanel({
  ctx,
  f,
  loan,
  accounts,
  initial,
  onCancel,
  onDone,
}: PanelProps & { accounts: readonly Account[]; initial: PrepaymentForm }) {
  const [form, setForm] = useState<PrepaymentForm>(initial);
  const [errors, setErrors] = useState<LoanFormErrors>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [preview, setPreview] = useState<PrepaymentPreview | undefined>();
  const [busy, setBusy] = useState(false);
  const key = useRef(uuidv7());
  const { ref, bump } = useFocusOnFeedback();
  const currency = loan.principal.currency;
  const o = { locale: ctx.formatLocale, scale: scaleFor(currency, ctx.scales), currency };
  const set = (patch: Partial<PrepaymentForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    if ('amount' in patch || 'businessDate' in patch || 'fee' in patch) setPreview(undefined);
  };
  const err = (k: string) => (errors[k] ? f.t(`errors.${errors[k]}`) : undefined);
  const funding = accounts.filter(
    (a) => a.status === 'ACTIVE' && a.currency === currency && a.type !== 'LOAN',
  );

  async function calculate() {
    setProblem(undefined);
    const built = buildPrepaymentInput(form, o, true);
    if (!built.ok) {
      setErrors(built.errors);
      bump();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await ctx.api.command<PrepaymentPreview>(
        'POST',
        `${prepaymentsPath(ctx.base, loan.id)}/preview`,
        built.input,
        { idempotent: false },
      );
      setPreview(r.data);
    } catch (e) {
      setPreview(undefined);
      setProblem(problemOf(e));
      bump();
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setProblem(undefined);
    const built = buildPrepaymentInput(form, o);
    if (!built.ok) {
      setErrors(built.errors);
      bump();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await ctx.api.command('POST', prepaymentsPath(ctx.base, loan.id), built.input, {
        idempotencyKey: key.current,
      });
      onDone(f.t('prepayment.done'));
    } catch (e) {
      key.current = uuidv7();
      setProblem(problemOf(e));
      setBusy(false);
      bump();
    }
  }

  return (
    <form
      style={formStyle}
      noValidate
      data-testid="prepayment-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset style={{ ...formStyle, margin: 0 }} disabled={busy}>
        <legend>{f.t('prepayment.title')}</legend>
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t('prepayment.hint')}</p>
        <div style={rowStyle}>
          <Field label={f.t('prepayment.amount', { currency })} error={err('amount')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={form.amount}
                data-testid="prepayment-amount"
                onChange={(e) => set({ amount: e.target.value })}
              />
            )}
          </Field>
          <Field label={f.t('prepayment.date')} error={err('businessDate')} hint={f.t('prepayment.dateHint')}>
            {(p) => (
              <input
                {...p}
                type="date"
                style={inputStyle}
                value={form.businessDate}
                data-testid="prepayment-date"
                onChange={(e) => set({ businessDate: e.target.value })}
              />
            )}
          </Field>
          <Field
            label={f.t('prepayment.fee', { currency })}
            error={err('fee')}
            hint={f.t('prepayment.feeHint')}
          >
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={form.fee}
                data-testid="prepayment-fee"
                onChange={(e) => set({ fee: e.target.value })}
              />
            )}
          </Field>
          <Field label={f.t('payment.account')} error={err('accountId')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={form.accountId}
                data-testid="prepayment-account"
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
        </div>
        <div role="radiogroup" aria-label={f.t('prepayment.option')} style={rowStyle}>
          {PREPAYMENT_OPTIONS.map((opt: PrepaymentOption) => (
            <label key={opt} style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
              <input
                type="radio"
                name="prepayment-option"
                checked={form.option === opt}
                data-testid={`prepayment-option-${opt}`}
                onChange={() => setForm((prev) => ({ ...prev, option: opt }))}
              />
              {f.t(`prepayment.options.${opt}`)}
            </label>
          ))}
        </div>
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t(`prepayment.optionHint.${form.option}`)}</p>
        <div style={rowStyle}>
          <button type="button" onClick={() => void calculate()} data-testid="prepayment-preview-button">
            {f.t('prepayment.compare')}
          </button>
        </div>
      </fieldset>
      {preview ? (
        <section
          aria-live="polite"
          data-testid="prepayment-preview"
          aria-label={f.t('prepayment.previewTitle')}
        >
          <h3 style={{ fontSize: '1rem' }}>{f.t('prepayment.previewTitle')}</h3>
          {preview.paysOff ? (
            <p role="note" data-testid="prepayment-pays-off">
              {f.t('prepayment.paysOff')}
            </p>
          ) : (
            <div
              style={tableWrapStyle}
              tabIndex={0}
              role="region"
              aria-label={f.t('prepayment.previewTitle')}
            >
              <table style={tableStyle}>
                <caption className="pf-sr-only">{f.t('prepayment.previewCaption')}</caption>
                <thead>
                  <tr>
                    <th scope="col" style={cellStyle}>
                      {f.t('prepayment.columns.option')}
                    </th>
                    <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                      {f.t('prepayment.columns.installment')}
                    </th>
                    <th scope="col" style={cellStyle}>
                      {f.t('prepayment.columns.end')}
                    </th>
                    <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                      {f.t('prepayment.columns.interest')}
                    </th>
                    <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                      {f.t('prepayment.columns.saved')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr data-testid="prepayment-current">
                    <th scope="row" style={cellStyle}>
                      {f.t('prepayment.current')}
                    </th>
                    <TailCells f={f} tail={preview.current} />
                    <td style={numCellStyle}>—</td>
                  </tr>
                  {preview.options.map((opt) => (
                    <tr key={opt.option} data-testid="prepayment-option-row" data-option={opt.option}>
                      <th scope="row" style={cellStyle}>
                        {f.t(`prepayment.options.${opt.option}`)}
                      </th>
                      <TailCells f={f} tail={opt} />
                      <td style={numCellStyle} data-testid="prepayment-saved">
                        {formatMoney(opt.interestSaved, f.locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
      <Feedback f={f} ctx={ctx} errors={errors} problem={problem} alertRef={ref} testId="prepayment-errors" />
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="prepayment-submit">
          {busy ? f.t('prepayment.saving') : f.t('prepayment.submit')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {f.t('cancelAction')}
        </button>
      </div>
    </form>
  );
}

// ───────────────────────────── Cambio de tasa ─────────────────────────────

export function RateChangePanel({
  ctx,
  f,
  loan,
  initial,
  onCancel,
  onDone,
}: PanelProps & { initial: RateChangeForm }) {
  const [form, setForm] = useState<RateChangeForm>(initial);
  const [errors, setErrors] = useState<LoanFormErrors>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [preview, setPreview] = useState<RateChangePreview | undefined>();
  const [busy, setBusy] = useState(false);
  const { ref, bump } = useFocusOnFeedback();
  const err = (k: string) => (errors[k] ? f.t(`errors.${errors[k]}`) : undefined);
  const set = (patch: Partial<RateChangeForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setPreview(undefined);
  };

  async function calculate() {
    setProblem(undefined);
    const built = buildRateChangeInput(form, ctx.formatLocale);
    if (!built.ok) {
      setErrors(built.errors);
      bump();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await ctx.api.command<RateChangePreview>(
        'POST',
        `${rateChangesPath(ctx.base, loan.id)}/preview`,
        built.input,
        { idempotent: false },
      );
      setPreview(r.data);
    } catch (e) {
      setPreview(undefined);
      setProblem(problemOf(e));
      bump();
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    setProblem(undefined);
    const built = buildRateChangeInput(form, ctx.formatLocale);
    if (!built.ok) {
      setErrors(built.errors);
      bump();
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await ctx.api.command('POST', rateChangesPath(ctx.base, loan.id), built.input, {
        ifMatch: loan.version,
      });
      onDone(f.t('rateChange.done'));
    } catch (e) {
      setProblem(problemOf(e));
      setBusy(false);
      bump();
    }
  }

  return (
    <form
      style={formStyle}
      noValidate
      data-testid="rate-change-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <fieldset style={{ ...formStyle, margin: 0 }} disabled={busy}>
        <legend>{f.t('rateChange.title')}</legend>
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t('rateChange.hint')}</p>
        <div style={rowStyle}>
          <Field label={f.t('rateChange.rate')} error={err('ratePct')} hint={f.t('form.rateHint')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={form.ratePct}
                data-testid="rate-change-rate"
                onChange={(e) => set({ ratePct: e.target.value })}
              />
            )}
          </Field>
          <Field
            label={f.t('rateChange.effectiveFrom')}
            error={err('effectiveFrom')}
            hint={f.t('rateChange.effectiveHint')}
          >
            {(p) => (
              <input
                {...p}
                type="date"
                style={inputStyle}
                value={form.effectiveFrom}
                data-testid="rate-change-date"
                onChange={(e) => set({ effectiveFrom: e.target.value })}
              />
            )}
          </Field>
        </div>
        <div style={rowStyle}>
          <button type="button" onClick={() => void calculate()} data-testid="rate-change-preview-button">
            {f.t('rateChange.compare')}
          </button>
        </div>
      </fieldset>
      {preview ? (
        <section
          aria-live="polite"
          data-testid="rate-change-preview"
          aria-label={f.t('rateChange.previewTitle')}
        >
          <h3 style={{ fontSize: '1rem' }}>{f.t('rateChange.previewTitle')}</h3>
          <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('rateChange.previewTitle')}>
            <table style={tableStyle}>
              <caption className="pf-sr-only">{f.t('rateChange.previewCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col" style={cellStyle}>
                    {f.t('prepayment.columns.option')}
                  </th>
                  <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                    {f.t('prepayment.columns.installment')}
                  </th>
                  <th scope="col" style={cellStyle}>
                    {f.t('prepayment.columns.end')}
                  </th>
                  <th scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                    {f.t('prepayment.columns.interest')}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" style={cellStyle}>
                    {f.t('prepayment.current')}
                  </th>
                  <TailCells f={f} tail={preview.current} />
                </tr>
                <tr data-testid="rate-change-proposed">
                  <th scope="row" style={cellStyle}>
                    {f.t('rateChange.proposed', {
                      rate: formatDecimal(fractionToPercent(preview.annualRate), f.locale),
                    })}
                  </th>
                  <TailCells f={f} tail={preview.proposed} />
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      <Feedback
        f={f}
        ctx={ctx}
        errors={errors}
        problem={problem}
        alertRef={ref}
        testId="rate-change-errors"
      />
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="rate-change-submit">
          {busy ? f.t('rateChange.saving') : f.t('rateChange.submit')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {f.t('cancelAction')}
        </button>
      </div>
    </form>
  );
}

// ───────────────────────────── Cronograma custom ─────────────────────────────

const CUSTOM_COLUMNS = ['principal', 'interest', 'fees', 'insurance', 'taxes'] as const;

/**
 * Cronograma custom: grilla editable cuota por cuota o "usar la tabla del banco cargada". La suma de principal se
 * compara en vivo con el principal esperado (el servidor valida de todos modos: `CUSTOM_SCHEDULE_INVALID`).
 */
export function CustomSchedulePanel({
  ctx,
  f,
  loan,
  references,
  initialRows,
  onCancel,
  onDone,
}: PanelProps & { references: readonly ReferenceSchedule[]; initialRows: readonly CustomRowForm[] }) {
  const [rows, setRows] = useState<readonly CustomRowForm[]>(
    initialRows.length > 0 ? initialRows : [emptyCustomRow()],
  );
  const [referenceId, setReferenceId] = useState(references[0]?.id ?? '');
  const [errors, setErrors] = useState<LoanFormErrors>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const { ref, bump } = useFocusOnFeedback();
  const currency = loan.principal.currency;
  const o = { locale: ctx.formatLocale, scale: scaleFor(currency, ctx.scales), currency };
  const expected =
    loan.status === 'ACTIVE' && loan.outstandingPrincipal
      ? loan.outstandingPrincipal.amount
      : loan.principal.amount;
  const total = customPrincipalSum(rows, o);
  const gap = total.invalid ? null : principalGap(expected, total.sum);
  const update = (i: number, patch: Partial<CustomRowForm>) =>
    setRows((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  async function send<T>(run: () => Promise<T>) {
    setProblem(undefined);
    setBusy(true);
    try {
      await run();
      onDone(f.t('custom.done'));
    } catch (e) {
      setProblem(problemOf(e));
      setBusy(false);
      bump();
    }
  }

  function save() {
    const built = buildCustomRows(rows, o);
    if (!built.ok) {
      setErrors(built.errors);
      bump();
      return;
    }
    setErrors({});
    void send(() =>
      ctx.api.command('PUT', customSchedulePath(ctx.base, loan.id), built.input, { ifMatch: loan.version }),
    );
  }

  return (
    <form
      style={formStyle}
      noValidate
      data-testid="custom-schedule-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <fieldset style={{ ...formStyle, margin: 0 }} disabled={busy}>
        <legend>{f.t('custom.title')}</legend>
        <p style={{ ...mutedStyle, margin: 0 }}>
          {loan.status === 'ACTIVE' ? f.t('custom.hintActive') : f.t('custom.hintDraft')}
        </p>
        {references.length > 0 ? (
          <div style={rowStyle}>
            <Field label={f.t('custom.reference')}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={referenceId}
                  data-testid="custom-reference"
                  onChange={(e) => setReferenceId(e.target.value)}
                >
                  {references.map((r) => (
                    <option key={r.id} value={r.id}>
                      {f.t('custom.referenceOption', { version: r.referenceVersion, rows: r.rowCount })}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <button
              type="button"
              data-testid="custom-adopt"
              onClick={() =>
                void send(() =>
                  ctx.api.command(
                    'POST',
                    `${customSchedulePath(ctx.base, loan.id)}/adopt`,
                    { referenceId },
                    { ifMatch: loan.version, idempotent: false },
                  ),
                )
              }
            >
              {f.t('custom.adopt')}
            </button>
          </div>
        ) : (
          <p style={{ ...mutedStyle, margin: 0 }}>{f.t('custom.noReference')}</p>
        )}
        <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('custom.gridLabel')}>
          <table style={tableStyle} data-testid="custom-grid">
            <caption className="pf-sr-only">{f.t('custom.gridLabel')}</caption>
            <thead>
              <tr>
                <th scope="col" style={cellStyle}>
                  {f.t('columns.n')}
                </th>
                <th scope="col" style={cellStyle}>
                  {f.t('columns.due')}
                </th>
                {CUSTOM_COLUMNS.map((k) => (
                  <th key={k} scope="col" style={{ ...cellStyle, textAlign: 'right' }}>
                    {f.t(`components.${k}`)}
                  </th>
                ))}
                <th scope="col" style={cellStyle}>
                  <span className="pf-sr-only">{f.t('custom.remove')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} data-testid="custom-row">
                  <th scope="row" style={cellStyle}>
                    {i + 1}
                  </th>
                  <td style={cellStyle}>
                    <input
                      type="date"
                      aria-label={f.t('custom.cellLabel', { n: i + 1, field: f.t('columns.due') })}
                      aria-invalid={errors[`rows.${i}.dueDate`] ? true : undefined}
                      value={row.dueDate}
                      data-testid={`custom-due-${i}`}
                      onChange={(e) => update(i, { dueDate: e.target.value })}
                    />
                  </td>
                  {CUSTOM_COLUMNS.map((k) => (
                    <td key={k} style={numCellStyle}>
                      <input
                        inputMode="decimal"
                        size={10}
                        aria-label={f.t('custom.cellLabel', { n: i + 1, field: f.t(`components.${k}`) })}
                        aria-invalid={errors[`rows.${i}.${k}`] ? true : undefined}
                        value={row[k]}
                        data-testid={`custom-${k}-${i}`}
                        onChange={(e) => update(i, { [k]: e.target.value } as Partial<CustomRowForm>)}
                      />
                    </td>
                  ))}
                  <td style={cellStyle}>
                    <button
                      type="button"
                      disabled={rows.length === 1}
                      onClick={() => setRows((prev) => prev.filter((_, k) => k !== i))}
                    >
                      {f.t('custom.remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={rowStyle}>
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, emptyCustomRow()])}
            data-testid="custom-add"
          >
            {f.t('custom.add')}
          </button>
        </div>
        <p aria-live="polite" style={{ margin: 0 }} data-testid="custom-sum">
          {total.invalid
            ? f.t('payment.sumInvalid')
            : f.t('custom.sum', {
                sum: formatDecimal(total.sum, ctx.formatLocale),
                expected: formatDecimal(expected, ctx.formatLocale),
                currency,
              })}
          {gap !== null && !/^0*(\.0*)?$/.test(gap) ? (
            <span style={{ color: 'var(--pf-error)' }} data-testid="custom-gap">
              {' '}
              <span aria-hidden="true">⚠</span>{' '}
              {f.t('custom.gap', { gap: formatDecimal(gap, ctx.formatLocale), currency })}
            </span>
          ) : gap !== null ? (
            <span data-testid="custom-ok"> ✓ {f.t('custom.sumMatches')}</span>
          ) : null}
        </p>
      </fieldset>
      <Feedback f={f} ctx={ctx} errors={errors} problem={problem} alertRef={ref} testId="custom-errors" />
      <div style={rowStyle}>
        <button type="submit" disabled={busy} data-testid="custom-submit">
          {busy ? f.t('custom.saving') : f.t('custom.submit')}
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          {f.t('cancelAction')}
        </button>
      </div>
    </form>
  );
}

// ───────────────────────────── Historial de versiones y de tasas ─────────────────────────────

export function VersionsSection({
  f,
  versions,
  rates,
  viewing,
  onView,
}: {
  f: FormatContext;
  versions: readonly ScheduleVersion[];
  rates: readonly RateChange[];
  viewing: number | undefined;
  onView: (version: number) => void;
}) {
  return (
    <section aria-labelledby="loan-versions-title" data-testid="loan-versions">
      <h2 id="loan-versions-title" style={{ fontSize: '1.125rem' }}>
        {f.t('versions.title')}
      </h2>
      <div style={tableWrapStyle} tabIndex={0} role="region" aria-label={f.t('versions.title')}>
        <table style={tableStyle}>
          <caption className="pf-sr-only">{f.t('versions.caption')}</caption>
          <thead>
            <tr>
              <th scope="col" style={cellStyle}>
                {f.t('versions.version')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('versions.reason')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('versions.effectiveFrom')}
              </th>
              <th scope="col" style={cellStyle}>
                {f.t('versions.range')}
              </th>
              <th scope="col" style={cellStyle}>
                <span className="pf-sr-only">{f.t('versions.view')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr
                key={v.scheduleVersion}
                data-testid="version-row"
                data-version={v.scheduleVersion}
                data-current={v.current ? 'true' : 'false'}
              >
                <th scope="row" style={cellStyle}>
                  {v.scheduleVersion}
                  {v.current ? ` (${f.t('versions.currentTag')})` : ` (${f.t('versions.replacedTag')})`}
                </th>
                <td style={cellStyle}>
                  {f.has(`versions.reasons.${v.reason}`) ? f.t(`versions.reasons.${v.reason}`) : v.reason}
                </td>
                <td style={cellStyle}>{formatBusinessDate(v.effectiveFrom)}</td>
                <td style={cellStyle}>
                  {v.replacedFromInstallmentNo !== null
                    ? f.t('versions.rangeReplaced', {
                        from: v.fromInstallmentNo,
                        replaced: v.replacedFromInstallmentNo,
                      })
                    : f.t('versions.rangeCurrent', { from: v.fromInstallmentNo })}
                </td>
                <td style={cellStyle}>
                  <button
                    type="button"
                    disabled={viewing === v.scheduleVersion}
                    onClick={() => onView(v.scheduleVersion)}
                  >
                    {f.t('versions.view')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rates.length > 1 ? (
        <>
          <h3 style={{ fontSize: '1rem' }}>{f.t('versions.ratesTitle')}</h3>
          <ul style={{ margin: 0, paddingLeft: '1.25rem' }} data-testid="rate-history">
            {rates.map((r) => (
              <li key={r.id ?? 'initial'}>
                {f.t(r.initial ? 'versions.rateInitial' : 'versions.rateChanged', {
                  rate: formatDecimal(fractionToPercent(r.annualRate), f.locale),
                  date: formatBusinessDate(r.effectiveFrom),
                })}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
