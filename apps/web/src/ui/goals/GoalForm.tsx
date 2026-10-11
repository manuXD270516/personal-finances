'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { scaleFor } from '../common/money';
import { todayIn } from '../common/dates';
import type { Account } from '../common/types';
import { Field, formStyle, inputStyle, mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { useCatalogs } from '../transactions/catalogs';
import {
  buildCreateInput,
  emptyGoalForm,
  goalsPath,
  linkableAccounts,
  type GoalForm,
  type GoalFormErrors,
} from './logic';
import { GOAL_TYPES, type GoalDetail } from './types';

export function NewGoalPage() {
  return <WithWorkspace>{(ctx) => <NewGoal ctx={ctx} />}</WithWorkspace>;
}

/**
 * Campos de la meta (presentacional): tipo, objetivo, fechas, cuentas vinculadas (solo activas y de naturaleza
 * activo), prioridad y tolerancia. En edición la fecha de inicio no cambia y la moneda solo si aún no hay movimientos.
 */
export function GoalFields({
  f,
  form,
  set,
  errors,
  accounts,
  currencies,
  disabled,
  editing = false,
  currencyLocked = false,
}: {
  f: FormatContext;
  form: GoalForm;
  set: (patch: Partial<GoalForm>) => void;
  errors: GoalFormErrors;
  accounts: readonly Account[];
  currencies: readonly string[];
  disabled?: boolean;
  editing?: boolean;
  currencyLocked?: boolean;
}) {
  const err = (key: string) => (errors[key] ? f.t(`errors.${errors[key]}`) : undefined);
  // Las cuentas ya vinculadas se muestran siempre (aunque hoy no sean elegibles) para poder desvincularlas.
  const options = useMemo(() => {
    const eligible = linkableAccounts(accounts);
    const extra = accounts.filter((a) => form.linkedAccountIds.includes(a.id) && !eligible.includes(a));
    return [...eligible, ...extra];
  }, [accounts, form.linkedAccountIds]);
  const toggle = (id: string, on: boolean) =>
    set({
      linkedAccountIds: on ? [...form.linkedAccountIds, id] : form.linkedAccountIds.filter((x) => x !== id),
    });
  return (
    <>
      <fieldset style={{ ...formStyle, margin: 0 }} disabled={disabled}>
        <legend>{f.t('form.basics')}</legend>
        <div style={rowStyle}>
          <Field label={f.t('form.name')} error={err('name')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                value={form.name}
                maxLength={120}
                data-testid="goal-name"
                onChange={(e) => set({ name: e.target.value })}
              />
            )}
          </Field>
          <Field label={f.t('form.type')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={form.type}
                data-testid="goal-type"
                onChange={(e) => set({ type: e.target.value as GoalForm['type'] })}
              >
                {GOAL_TYPES.map((k) => (
                  <option key={k} value={k}>
                    {f.t(`types.${k}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={f.t('form.priority')} error={err('priority')} hint={f.t('form.priorityHint')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={form.priority}
                data-testid="goal-priority"
                onChange={(e) => set({ priority: e.target.value })}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={String(n)}>
                    {n}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div style={rowStyle}>
          <Field label={f.t('form.target')} error={err('target')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={form.target}
                data-testid="goal-target"
                onChange={(e) => set({ target: e.target.value })}
              />
            )}
          </Field>
          <Field label={f.t('form.currency')} hint={currencyLocked ? f.t('form.currencyLocked') : undefined}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={form.currency}
                disabled={currencyLocked}
                data-testid="goal-currency"
                onChange={(e) => set({ currency: e.target.value })}
              >
                {(currencies.includes(form.currency) ? currencies : [form.currency, ...currencies]).map(
                  (c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ),
                )}
              </select>
            )}
          </Field>
        </div>
        <div style={rowStyle}>
          <Field
            label={f.t('form.startDate')}
            error={err('startDate')}
            hint={editing ? f.t('form.startDateLocked') : undefined}
          >
            {(p) => (
              <input
                {...p}
                type="date"
                style={inputStyle}
                value={form.startDate}
                disabled={editing}
                data-testid="goal-start-date"
                onChange={(e) => set({ startDate: e.target.value })}
              />
            )}
          </Field>
          <Field label={f.t('form.targetDate')} error={err('targetDate')} hint={f.t('form.targetDateHint')}>
            {(p) => (
              <input
                {...p}
                type="date"
                style={inputStyle}
                value={form.targetDate}
                data-testid="goal-target-date-input"
                onChange={(e) => set({ targetDate: e.target.value })}
              />
            )}
          </Field>
        </div>
      </fieldset>

      <fieldset style={{ ...formStyle, margin: 0 }} disabled={disabled} data-testid="goal-accounts">
        <legend>{f.t('form.accounts')}</legend>
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t('form.accountsHint')}</p>
        {options.length === 0 ? (
          <p style={mutedStyle} data-testid="goal-no-accounts">
            {f.t('form.noAccounts')}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-1)' }}>
            {options.map((a) => (
              <li key={a.id}>
                <label style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={form.linkedAccountIds.includes(a.id)}
                    data-testid="goal-account"
                    data-account-id={a.id}
                    onChange={(e) => toggle(a.id, e.target.checked)}
                  />
                  {a.name} ({a.currency})
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset style={{ ...formStyle, margin: 0 }} disabled={disabled}>
        <legend>{f.t('form.tracking')}</legend>
        <div style={rowStyle}>
          <Field
            label={f.t('form.tolerance')}
            error={err('tolerancePercent')}
            hint={f.t('form.toleranceHint')}
          >
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={form.tolerancePercent}
                data-testid="goal-tolerance"
                onChange={(e) => set({ tolerancePercent: e.target.value })}
              />
            )}
          </Field>
          <Field
            label={f.t('form.pacePeriods')}
            error={err('pacePeriods')}
            hint={f.t('form.pacePeriodsHint')}
          >
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="numeric"
                value={form.pacePeriods}
                data-testid="goal-pace-periods"
                onChange={(e) => set({ pacePeriods: e.target.value })}
              />
            )}
          </Field>
        </div>
        <Field label={f.t('form.notes')} error={err('notes')}>
          {(p) => (
            <textarea
              {...p}
              style={inputStyle}
              rows={3}
              maxLength={2000}
              value={form.notes}
              data-testid="goal-notes"
              onChange={(e) => set({ notes: e.target.value })}
            />
          )}
        </Field>
      </fieldset>
    </>
  );
}

function NewGoal({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Goals', ctx);
  const catalogs = useCatalogs(ctx);
  const today = todayIn(ctx.timeZone);
  const [form, setForm] = useState<GoalForm>(() => emptyGoalForm(ctx.ws.baseCurrency, today));
  const [errors, setErrors] = useState<GoalFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const attemptKey = useRef(uuidv7());
  const errorsRef = useRef<HTMLDivElement>(null);
  // El foco se aplica tras el render que muestra los errores (un `setTimeout` puede ganarle a React).
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick > 0) errorsRef.current?.focus();
  }, [focusTick]);
  const set = (patch: Partial<GoalForm>) => setForm((prev) => ({ ...prev, ...patch }));

  const currencies = useMemo(() => {
    const codes = ctx.currencies.filter((c) => c.enabled).map((c) => c.code);
    return codes.length > 0 ? codes : [ctx.ws.baseCurrency];
  }, [ctx.currencies, ctx.ws.baseCurrency]);

  async function submit() {
    setProblem(undefined);
    const built = buildCreateInput(form, {
      locale: ctx.formatLocale,
      scale: scaleFor(form.currency, ctx.scales),
    });
    if (!built.ok) {
      setErrors(built.errors);
      setFocusTick((n) => n + 1);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await ctx.api.command<GoalDetail>('POST', goalsPath(ctx.base), built.input, {
        idempotencyKey: attemptKey.current,
      });
      window.location.assign(ctx.href(`/goals/${r.data!.id}?creada=1`));
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

  const errorCount = Object.keys(errors).length;
  return (
    <section aria-labelledby="goal-form-title" style={pageStyle} data-testid="goal-form-page">
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/goals')}>{f.t('back')}</a>
      </p>
      <h1 id="goal-form-title">{f.t('form.title')}</h1>
      <form
        style={{ display: 'grid', gap: 'var(--pf-space-4)' }}
        noValidate
        data-testid="goal-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <GoalFields
          f={f}
          form={form}
          set={set}
          errors={errors}
          accounts={catalogs.accounts}
          currencies={currencies}
          disabled={busy}
        />
        <div ref={errorsRef} tabIndex={-1} data-testid="goal-form-errors">
          {errorCount > 0 ? (
            <p role="alert" style={{ color: 'var(--pf-error)', margin: 0 }}>
              {f.t('form.fixErrors', { count: errorCount })}
            </p>
          ) : null}
          {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
        </div>
        <div>
          <button type="submit" disabled={busy} data-testid="goal-submit">
            {busy ? f.t('form.saving') : f.t('form.save')}
          </button>
        </div>
      </form>
    </section>
  );
}
