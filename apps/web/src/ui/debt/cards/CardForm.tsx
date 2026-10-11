'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uuidv7, type ApiProblemBody } from '../../../bff/finance-api-client';
import { ProblemMessage } from '../../../errors/ProblemMessage';
import { AccountForm } from '../../accounts/AccountForm';
import type { Account, Institution } from '../../common/types';
import { Field, formStyle, inputStyle, mutedStyle, pageStyle, rowStyle, warningStyle } from '../../common/ui';
import { listAll, problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../../common/workspace';
import type { FormatContext } from '../../dashboard/types';
import { useCatalogs } from '../../transactions/catalogs';
import {
  buildCardInput,
  cardHref,
  cardsPath,
  EMPTY_CARD_ACCOUNT,
  emptyCardForm,
  type CardAccountForm,
  type CardForm,
  type CardFormErrors,
} from './logic';
import { CARD_MATERIALIZATION_MODES, PAYMENT_POLICIES, WEEKEND_ADJUSTMENTS, type CreditCard } from './types';

export const STEPS = ['accounts', 'limits', 'calendar', 'plan'] as const;
export type Step = (typeof STEPS)[number];

/** Paso al que pertenece un campo con error (para saltar al primero con problemas). */
export function stepOfField(field: string): Step {
  if (field === 'name' || field === 'accounts') return 'accounts';
  if (field === 'limitMode' || field === 'sharedLimit') return 'limits';
  if (/^account\..+\.(creditLimit|percent|floor|fixed)$/.test(field)) return 'limits';
  if (/^account\..+\.plan$/.test(field)) return 'plan';
  return 'calendar';
}

/** Primer paso (en orden) con algún error. */
export function firstStepWithErrors(errors: CardFormErrors): Step | undefined {
  const steps = new Set(Object.keys(errors).map(stepOfField));
  return STEPS.find((s) => steps.has(s));
}

export function NewCardPage() {
  return <WithWorkspace>{(ctx) => <NewCard ctx={ctx} />}</WithWorkspace>;
}

interface AccountChoice {
  readonly account: Account;
  /** Ya pertenece a otra tarjeta activa (`CREDIT_CARD_ACCOUNT_IN_USE`). */
  readonly inUse: boolean;
}

/**
 * Pasos del alta (presentacional): cuentas, límites y mínimo, calendario y umbrales, plan de pago opcional. Cada paso
 * muestra sus errores por campo; las cuentas de la misma moneda que una ya elegida se deshabilitan (una por moneda).
 */
export function StepFields({
  step,
  f,
  form,
  set,
  setAccount,
  errors,
  choices,
  assets,
  onCreateAccount,
  canCreateAccount,
}: {
  step: Step;
  f: FormatContext;
  form: CardForm;
  set: (patch: Partial<CardForm>) => void;
  setAccount: (accountId: string, patch: Partial<CardAccountForm>) => void;
  errors: CardFormErrors;
  choices: readonly AccountChoice[];
  assets: readonly Account[];
  onCreateAccount?: () => void;
  canCreateAccount: boolean;
}) {
  const err = (key: string) => (errors[key] ? f.t(`errors.${errors[key]}`) : undefined);
  const byId = new Map(choices.map((c) => [c.account.id, c.account]));
  const selected = form.selected.map((id) => byId.get(id)).filter((a): a is Account => !!a);
  const currencies = selected.map((a) => a.currency);

  if (step === 'accounts') {
    const takenCurrency = (a: Account) => !form.selected.includes(a.id) && currencies.includes(a.currency);
    return (
      <fieldset style={{ ...formStyle, margin: 0 }} data-testid="card-step-accounts">
        <legend>{f.t('form.steps.accounts')}</legend>
        <Field label={f.t('form.name')} error={err('name')} hint={f.t('form.nameHint')}>
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              value={form.name}
              maxLength={120}
              data-testid="card-name"
              onChange={(e) => set({ name: e.target.value })}
            />
          )}
        </Field>
        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
          <legend>{f.t('form.accountsLegend')}</legend>
          <p style={{ ...mutedStyle, margin: 0 }}>{f.t('form.accountsHint')}</p>
          {choices.length === 0 ? (
            <p style={mutedStyle} data-testid="card-no-accounts">
              {f.t('form.noAccounts')}
            </p>
          ) : (
            choices.map(({ account, inUse }) => {
              const blocked = inUse || takenCurrency(account);
              const hintId = `card-acc-${account.id}-hint`;
              return (
                <label
                  key={account.id}
                  style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}
                >
                  <input
                    type="checkbox"
                    checked={form.selected.includes(account.id)}
                    disabled={blocked}
                    aria-describedby={blocked ? hintId : undefined}
                    data-testid={`card-account-${account.id}`}
                    onChange={(e) =>
                      set({
                        selected: e.target.checked
                          ? [...form.selected, account.id]
                          : form.selected.filter((id) => id !== account.id),
                      })
                    }
                  />
                  <span>
                    {account.name} ({account.currency})
                    {blocked ? (
                      <small id={hintId} style={mutedStyle}>
                        {' '}
                        — {inUse ? f.t('form.accountInUse') : f.t('form.currencyTaken')}
                      </small>
                    ) : null}
                  </span>
                </label>
              );
            })
          )}
          {err('accounts') ? (
            <p role="alert" style={{ color: 'var(--pf-error)', margin: 0 }} data-testid="field-error">
              {err('accounts')}
            </p>
          ) : null}
        </fieldset>
        {canCreateAccount && onCreateAccount ? (
          <p style={{ margin: 0 }}>
            <button type="button" onClick={onCreateAccount} data-testid="card-create-account">
              {f.t('form.createAccount')}
            </button>
          </p>
        ) : null}
      </fieldset>
    );
  }

  if (step === 'limits') {
    return (
      <fieldset style={{ ...formStyle, margin: 0 }} data-testid="card-step-limits">
        <legend>{f.t('form.steps.limits')}</legend>
        <div role="radiogroup" aria-label={f.t('form.limitMode')} style={rowStyle}>
          {(['SEPARATE', 'SHARED'] as const).map((m) => (
            <label key={m} style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
              <input
                type="radio"
                name="card-limit-mode"
                checked={form.limitMode === m}
                data-testid={`card-limit-${m}`}
                onChange={() => set({ limitMode: m })}
              />
              {f.t(`form.limitModes.${m}`)}
            </label>
          ))}
        </div>
        {err('limitMode') ? (
          <p role="alert" style={{ color: 'var(--pf-error)', margin: 0 }}>
            {err('limitMode')}
          </p>
        ) : null}
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t(`form.limitHint.${form.limitMode}`)}</p>
        {form.limitMode === 'SHARED' ? (
          <div style={rowStyle}>
            <Field label={f.t('form.sharedLimit')} error={err('sharedLimit')}>
              {(p) => (
                <input
                  {...p}
                  style={inputStyle}
                  inputMode="decimal"
                  value={form.sharedLimit}
                  data-testid="card-shared-limit"
                  onChange={(e) => set({ sharedLimit: e.target.value })}
                />
              )}
            </Field>
            <Field label={f.t('form.sharedCurrency')}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={form.sharedCurrency || currencies[0] || ''}
                  data-testid="card-shared-currency"
                  onChange={(e) => set({ sharedCurrency: e.target.value })}
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
        ) : null}
        {selected.map((a) => {
          const v = form.accounts[a.id] ?? EMPTY_CARD_ACCOUNT;
          const key = `account.${a.id}`;
          return (
            <fieldset key={a.id} style={{ ...formStyle, margin: 0 }} data-testid="card-account-terms">
              <legend>{f.t('form.accountTerms', { name: a.name, currency: a.currency })}</legend>
              {form.limitMode === 'SEPARATE' ? (
                <Field
                  label={f.t('form.creditLimit', { currency: a.currency })}
                  error={err(`${key}.creditLimit`)}
                >
                  {(p) => (
                    <input
                      {...p}
                      style={inputStyle}
                      inputMode="decimal"
                      value={v.creditLimit}
                      data-testid={`card-limit-${a.currency}`}
                      onChange={(e) => setAccount(a.id, { creditLimit: e.target.value })}
                    />
                  )}
                </Field>
              ) : null}
              <div role="radiogroup" aria-label={f.t('form.minimumRule')} style={rowStyle}>
                {(['PERCENT', 'FIXED'] as const).map((m) => (
                  <label key={m} style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
                    <input
                      type="radio"
                      name={`card-min-${a.id}`}
                      checked={v.minimumType === m}
                      data-testid={`card-min-type-${a.currency}-${m}`}
                      onChange={() => setAccount(a.id, { minimumType: m })}
                    />
                    {f.t(`form.minimumTypes.${m}`)}
                  </label>
                ))}
              </div>
              {v.minimumType === 'PERCENT' ? (
                <div style={rowStyle}>
                  <Field
                    label={f.t('form.minPercent')}
                    error={err(`${key}.percent`)}
                    hint={f.t('form.minPercentHint')}
                  >
                    {(p) => (
                      <input
                        {...p}
                        style={inputStyle}
                        inputMode="decimal"
                        value={v.percent}
                        data-testid={`card-percent-${a.currency}`}
                        onChange={(e) => setAccount(a.id, { percent: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field
                    label={f.t('form.minFloor', { currency: a.currency })}
                    error={err(`${key}.floor`)}
                    hint={f.t('form.minFloorHint')}
                  >
                    {(p) => (
                      <input
                        {...p}
                        style={inputStyle}
                        inputMode="decimal"
                        value={v.floor}
                        data-testid={`card-floor-${a.currency}`}
                        onChange={(e) => setAccount(a.id, { floor: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
              ) : (
                <Field label={f.t('form.minFixed', { currency: a.currency })} error={err(`${key}.fixed`)}>
                  {(p) => (
                    <input
                      {...p}
                      style={inputStyle}
                      inputMode="decimal"
                      value={v.fixed}
                      data-testid={`card-fixed-${a.currency}`}
                      onChange={(e) => setAccount(a.id, { fixed: e.target.value })}
                    />
                  )}
                </Field>
              )}
            </fieldset>
          );
        })}
      </fieldset>
    );
  }

  if (step === 'calendar') {
    return (
      <fieldset style={{ ...formStyle, margin: 0 }} data-testid="card-step-calendar">
        <legend>{f.t('form.steps.calendar')}</legend>
        <p style={{ ...mutedStyle, margin: 0 }}>{f.t('form.calendarHint')}</p>
        <div style={rowStyle}>
          <Field label={f.t('form.statementDay')} error={err('statementDay')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="numeric"
                value={form.statementDay}
                data-testid="card-statement-day"
                onChange={(e) => set({ statementDay: e.target.value })}
              />
            )}
          </Field>
          <Field label={f.t('form.dueDay')} error={err('dueDay')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="numeric"
                value={form.dueDay}
                data-testid="card-due-day"
                onChange={(e) => set({ dueDay: e.target.value })}
              />
            )}
          </Field>
          <Field label={f.t('form.weekend')} hint={f.t('form.weekendHint')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={form.weekend}
                data-testid="card-weekend"
                onChange={(e) => set({ weekend: e.target.value as CardForm['weekend'] })}
              >
                {WEEKEND_ADJUSTMENTS.map((w) => (
                  <option key={w} value={w}>
                    {f.t(`weekend.${w}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <div style={rowStyle}>
          <Field label={f.t('form.annualRate')} error={err('annualRate')} hint={f.t('form.annualRateHint')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={form.annualRate}
                data-testid="card-annual-rate"
                onChange={(e) => set({ annualRate: e.target.value })}
              />
            )}
          </Field>
          <Field label={f.t('form.thresholds')} error={err('thresholds')} hint={f.t('form.thresholdsHint')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                value={form.thresholds}
                placeholder="30; 80"
                data-testid="card-thresholds"
                onChange={(e) => set({ thresholds: e.target.value })}
              />
            )}
          </Field>
          <Field label={f.t('form.reminderDays')} error={err('reminderDays')} hint={f.t('form.reminderHint')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="numeric"
                value={form.reminderDays}
                data-testid="card-reminder-days"
                onChange={(e) => set({ reminderDays: e.target.value })}
              />
            )}
          </Field>
        </div>
      </fieldset>
    );
  }

  return (
    <fieldset style={{ ...formStyle, margin: 0 }} data-testid="card-step-plan">
      <legend>{f.t('form.steps.plan')}</legend>
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t('form.planHint')}</p>
      {selected.map((a) => {
        const v = form.accounts[a.id] ?? EMPTY_CARD_ACCOUNT;
        const sources = assets.filter((s) => s.currency === a.currency && s.id !== a.id);
        return (
          <fieldset key={a.id} style={{ ...formStyle, margin: 0 }} data-testid="card-plan-account">
            <legend>{f.t('form.accountTerms', { name: a.name, currency: a.currency })}</legend>
            <label style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={v.planEnabled}
                data-testid={`card-plan-enable-${a.currency}`}
                onChange={(e) => setAccount(a.id, { planEnabled: e.target.checked })}
              />
              {f.t('form.planEnable', { currency: a.currency })}
            </label>
            {v.planEnabled ? (
              <div style={rowStyle}>
                <Field label={f.t('form.planSource')} error={err(`account.${a.id}.plan`)}>
                  {(p) => (
                    <select
                      {...p}
                      style={inputStyle}
                      value={v.planSourceId}
                      data-testid={`card-plan-source-${a.currency}`}
                      onChange={(e) => setAccount(a.id, { planSourceId: e.target.value })}
                    >
                      <option value="">{f.t('form.chooseAccount')}</option>
                      {sources.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.currency})
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label={f.t('plan.policy')}>
                  {(p) => (
                    <select
                      {...p}
                      style={inputStyle}
                      value={v.planPolicy}
                      data-testid={`card-plan-policy-${a.currency}`}
                      onChange={(e) =>
                        setAccount(a.id, { planPolicy: e.target.value as CardAccountForm['planPolicy'] })
                      }
                    >
                      {PAYMENT_POLICIES.map((pol) => (
                        <option key={pol} value={pol}>
                          {f.t(`plan.policies.${pol}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label={f.t('plan.mode')}>
                  {(p) => (
                    <select
                      {...p}
                      style={inputStyle}
                      value={v.planMode}
                      data-testid={`card-plan-mode-${a.currency}`}
                      onChange={(e) =>
                        setAccount(a.id, { planMode: e.target.value as CardAccountForm['planMode'] })
                      }
                    >
                      {CARD_MATERIALIZATION_MODES.map((m) => (
                        <option key={m} value={m}>
                          {f.t(`plan.modes.${m}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
            ) : null}
          </fieldset>
        );
      })}
    </fieldset>
  );
}

/** Aviso tras el alta cuando algún plan de pago no se activó por una transferencia recurrente del usuario. */
export function ConflictNotice({
  card,
  f,
  nameOf,
  href,
}: {
  card: CreditCard;
  f: FormatContext;
  nameOf: (accountId: string) => string;
  href: (path: string) => string;
}) {
  const conflicts = card.paymentPlanConflicts ?? [];
  return (
    <section style={pageStyle} data-testid="card-created">
      <h1>{f.t('form.createdTitle', { name: card.name })}</h1>
      {conflicts.length > 0 ? (
        <div role="alert" style={warningStyle} data-testid="plan-conflicts">
          <p style={{ margin: 0 }}>{f.t('form.conflictIntro')}</p>
          <ul>
            {conflicts.map((c) => (
              <li key={c.accountId}>
                {nameOf(c.accountId)}:{' '}
                {c.conflictingDefinitions.map((d) => (
                  <a key={d.definitionId} href={href(`/recurring/${d.definitionId}`)}>
                    {d.name}
                  </a>
                ))}
              </li>
            ))}
          </ul>
          <p style={{ margin: 0 }}>{f.t('form.conflictAction')}</p>
        </div>
      ) : null}
      <p>
        <a href={href(cardHref(card.id))} data-testid="card-open">
          {f.t('form.openCard')}
        </a>
      </p>
    </section>
  );
}

function NewCard({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Cards', ctx);
  const catalogs = useCatalogs(ctx);
  const [form, setForm] = useState<CardForm>(() => emptyCardForm());
  const [step, setStep] = useState<Step>('accounts');
  const [errors, setErrors] = useState<CardFormErrors>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [created, setCreated] = useState<CreditCard | undefined>();
  const [usedIds, setUsedIds] = useState<ReadonlySet<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [institutions, setInstitutions] = useState<readonly Institution[]>([]);
  const attemptKey = useRef(uuidv7());
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<{ data: CreditCard[] }>(`${cardsPath(ctx.base)}?status=ACTIVE`)
      .then((r) => {
        if (!cancelled)
          setUsedIds(new Set((r.data?.data ?? []).flatMap((c) => c.accounts.map((a) => a.accountId))));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base]);

  useEffect(() => {
    if (!creating) return;
    let cancelled = false;
    listAll<Institution>(
      ctx.api,
      `${ctx.base}/institutions`,
      new URLSearchParams({ includeArchived: 'true' }),
    )
      .then((list) => {
        if (!cancelled) setInstitutions(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [creating, ctx.api, ctx.base]);

  const set = useCallback((patch: Partial<CardForm>) => setForm((p) => ({ ...p, ...patch })), []);
  const setAccount = useCallback(
    (accountId: string, patch: Partial<CardAccountForm>) =>
      setForm((p) => ({
        ...p,
        accounts: {
          ...p.accounts,
          [accountId]: { ...(p.accounts[accountId] ?? EMPTY_CARD_ACCOUNT), ...patch },
        },
      })),
    [],
  );

  const choices = useMemo<readonly AccountChoice[]>(
    () =>
      catalogs.activeAccounts
        .filter((a) => a.type === 'CREDIT_CARD')
        .map((account) => ({ account, inUse: usedIds.has(account.id) })),
    [catalogs.activeAccounts, usedIds],
  );
  const assets = useMemo(
    () => catalogs.activeAccounts.filter((a) => a.classification === 'ASSET'),
    [catalogs.activeAccounts],
  );
  const refs = useMemo(
    () => choices.map(({ account }) => ({ id: account.id, currency: account.currency })),
    [choices],
  );
  const opts = useMemo(
    () => ({ locale: ctx.formatLocale, scales: ctx.scales, accounts: refs }),
    [ctx.formatLocale, ctx.scales, refs],
  );

  // El foco va al título del paso al cambiar de paso (teclado y lector de pantalla).
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick > 0) headingRef.current?.focus();
  }, [focusTick]);

  const goTo = (target: Step) => {
    setStep(target);
    setFocusTick((n) => n + 1);
  };

  function next() {
    const built = buildCardInput(form, opts);
    const own = built.ok
      ? {}
      : Object.fromEntries(Object.entries(built.errors).filter(([k]) => stepOfField(k) === step));
    setErrors(own);
    if (Object.keys(own).length > 0) return;
    const index = STEPS.indexOf(step);
    const target = STEPS[index + 1];
    if (target) goTo(target);
  }

  async function submit() {
    setProblem(undefined);
    const built = buildCardInput(form, opts);
    if (!built.ok) {
      setErrors(built.errors);
      const first = firstStepWithErrors(built.errors);
      if (first) goTo(first);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await ctx.api.command<CreditCard>('POST', cardsPath(ctx.base), built.input, {
        idempotencyKey: attemptKey.current,
      });
      const card = r.data!;
      if ((card.paymentPlanConflicts ?? []).length > 0) {
        setCreated(card);
        setBusy(false);
        return;
      }
      window.location.assign(ctx.href(cardHref(card.id)));
    } catch (err) {
      attemptKey.current = uuidv7();
      setProblem(problemOf(err));
      setBusy(false);
    }
  }

  if (!ctx.canEdit)
    return (
      <section style={pageStyle}>
        <h1>{f.t('form.title')}</h1>
        <p style={mutedStyle}>{f.t('viewerNotice')}</p>
      </section>
    );

  if (created)
    return (
      <ConflictNotice
        card={created}
        f={f}
        nameOf={(id) => catalogs.names.account(id) ?? id}
        href={ctx.href}
      />
    );

  const index = STEPS.indexOf(step);
  const last = index === STEPS.length - 1;
  return (
    <section aria-labelledby="card-form-title" style={pageStyle} data-testid="card-form-page">
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/debts?vista=tarjetas')}>{f.t('back')}</a>
      </p>
      <h1 id="card-form-title">{f.t('form.title')}</h1>
      <ol
        aria-label={f.t('form.stepsLabel')}
        style={{ ...rowStyle, listStyle: 'none', padding: 0, margin: 0 }}
        data-testid="card-steps"
      >
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={s === step ? 'step' : undefined}
            style={{
              fontWeight: s === step ? 600 : 400,
              color: s === step ? 'var(--pf-primary)' : 'var(--pf-fg-muted)',
            }}
          >
            {f.t('form.stepOf', { n: i + 1, total: STEPS.length, name: f.t(`form.steps.${s}`) })}
          </li>
        ))}
      </ol>
      <form
        style={{ display: 'grid', gap: 'var(--pf-space-4)' }}
        noValidate
        data-testid="card-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (last) void submit();
          else next();
        }}
      >
        <h2
          ref={headingRef}
          tabIndex={-1}
          style={{ margin: 0, fontSize: 'var(--pf-text-lg)' }}
          data-testid="card-step-title"
        >
          {f.t(`form.steps.${step}`)}
        </h2>
        <StepFields
          step={step}
          f={f}
          form={form}
          set={set}
          setAccount={setAccount}
          errors={errors}
          choices={choices}
          assets={assets}
          canCreateAccount={ctx.canEdit}
          onCreateAccount={() => setCreating(true)}
        />
        {Object.keys(errors).length > 0 ? (
          <p role="alert" style={{ color: 'var(--pf-error)', margin: 0 }}>
            {f.t('form.fixErrors', { count: Object.keys(errors).length })}
          </p>
        ) : null}
        {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
        <div style={rowStyle}>
          {index > 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => goTo(STEPS[index - 1]!)}
              data-testid="card-prev"
            >
              {f.t('form.prev')}
            </button>
          ) : null}
          <button type="submit" disabled={busy} data-testid={last ? 'card-submit' : 'card-next'}>
            {last ? (busy ? f.t('form.saving') : f.t('form.save')) : f.t('form.next')}
          </button>
        </div>
      </form>
      {creating ? (
        <div data-testid="card-account-create" role="region" aria-label={f.t('form.createAccountRegion')}>
          <AccountForm
            ctx={ctx}
            fixedType="CREDIT_CARD"
            institutions={institutions}
            onCancel={() => setCreating(false)}
            onSaved={(account) => {
              setCreating(false);
              catalogs.reload();
              set({ selected: [...form.selected, account.id] });
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
