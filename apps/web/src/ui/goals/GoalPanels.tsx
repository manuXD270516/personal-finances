'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { todayIn } from '../common/dates';
import { scaleFor } from '../common/money';
import type { Account, Page, Transaction } from '../common/types';
import { Field, formStyle, inputStyle, mutedStyle, rowStyle } from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import { formatLocalDate, formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { GoalFields } from './GoalForm';
import {
  buildContributionInput,
  buildPlanInput,
  buildReassignInput,
  buildUpdateInput,
  buildWithdrawInput,
  earmarkDetails,
  eligibilityReasons,
  emptyReassignForm,
  emptyWithdrawForm,
  formFromGoal,
  goalPath,
  isTerminal,
  linkableAccounts,
  linkableContributions,
  linkableWithdrawals,
  planFormFrom,
  withdrawModes,
  type BuildResult,
  type ContributionForm,
  type GoalForm,
  type GoalFormErrors,
  type PlanForm,
  type ReassignForm,
  type WithdrawForm,
} from './logic';
import type { Goal, GoalFund, GoalMovement } from './types';
import { formatDecimal } from '../AuditHistory';

export interface PanelProps {
  readonly ctx: WorkspaceContext;
  readonly f: FormatContext;
  readonly goal: Goal;
  /** Todas las cuentas del workspace (incluidas cerradas) para resolver monedas y nombres. */
  readonly accounts: readonly Account[];
  readonly onCancel: () => void;
  /** Mensaje de éxito; el detalle recarga la meta. */
  readonly onDone: (message: string) => void;
}

// ───────────────────────────── Piezas comunes ─────────────────────────────

interface PanelAction {
  readonly errors: GoalFormErrors;
  readonly problem: ApiProblemBody | undefined;
  readonly busy: boolean;
  readonly tick: number;
  readonly submit: () => void;
}

/**
 * Un intento del usuario: valida, envía con una `Idempotency-Key` que se conserva mientras el envío no tenga éxito
 * (un doble clic no duplica el movimiento; un nuevo intento tras un error genera otra clave).
 */
function usePanelAction<I>(opts: {
  build: () => BuildResult<I>;
  send: (input: I, idempotencyKey: string) => Promise<void>;
  onDone: () => void;
}): PanelAction {
  const [errors, setErrors] = useState<GoalFormErrors>({});
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const key = useRef(uuidv7());
  const submit = () => {
    void (async () => {
      setProblem(undefined);
      const built = opts.build();
      if (!built.ok) {
        setErrors(built.errors);
        setTick((n) => n + 1);
        return;
      }
      setErrors({});
      setBusy(true);
      try {
        await opts.send(built.input, key.current);
        opts.onDone();
      } catch (err) {
        key.current = uuidv7();
        setProblem(problemOf(err));
        setBusy(false);
        setTick((n) => n + 1);
      }
    })();
  };
  return { errors, problem, busy, tick, submit };
}

/** Explica el rechazo con los datos del problema: motivos de elegibilidad y saldo/reservado/disponible. */
export function ProblemExtras({ problem, f }: { problem: ApiProblemBody; f: FormatContext }) {
  if (problem.code === 'GOAL_TRANSACTION_NOT_ELIGIBLE') {
    const reasons = eligibilityReasons(problem);
    if (reasons.length === 0) return null;
    return (
      <ul style={{ margin: 0, paddingLeft: '1.25rem' }} data-testid="goal-eligibility-reasons">
        {reasons.map((r) => (
          <li key={r} data-reason={r}>
            {f.has(`eligibility.${r}`) ? f.t(`eligibility.${r}`) : r}
          </li>
        ))}
      </ul>
    );
  }
  if (problem.code === 'EARMARK_EXCEEDS_BALANCE') {
    const d = earmarkDetails(problem);
    if (!d) return null;
    return (
      <p style={mutedStyle} data-testid="goal-earmark-details">
        {f.t('earmarkDetails', {
          balance: formatDecimal(d.balance, f.locale),
          reserved: formatDecimal(d.reserved, f.locale),
          available: formatDecimal(d.available, f.locale),
        })}
      </p>
    );
  }
  return null;
}

function PanelForm({
  ctx,
  f,
  testId,
  title,
  action,
  submitLabel,
  onCancel,
  children,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  testId: string;
  title: string;
  action: PanelAction;
  submitLabel: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (action.tick > 0) ref.current?.focus();
  }, [action.tick]);
  const count = Object.keys(action.errors).length;
  return (
    <form
      style={{ display: 'grid', gap: 'var(--pf-space-3)' }}
      noValidate
      data-testid={testId}
      onSubmit={(e) => {
        e.preventDefault();
        action.submit();
      }}
    >
      <fieldset style={{ ...formStyle, margin: 0 }} disabled={action.busy}>
        <legend>{title}</legend>
        {children}
      </fieldset>
      <div ref={ref} tabIndex={-1} data-testid={`${testId}-errors`}>
        {count > 0 ? (
          <p role="alert" style={{ color: 'var(--pf-error)', margin: 0 }}>
            {f.t('form.fixErrors', { count })}
          </p>
        ) : null}
        {action.problem ? (
          <>
            <ProblemMessage problem={action.problem} locale={ctx.uiLocale} />
            <ProblemExtras problem={action.problem} f={f} />
          </>
        ) : null}
      </div>
      <div style={rowStyle}>
        <button type="submit" disabled={action.busy} data-testid={`${testId}-submit`}>
          {action.busy ? f.t('form.saving') : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={action.busy}>
          {f.t('form.cancel')}
        </button>
      </div>
    </form>
  );
}

function FundRadios({
  f,
  value,
  onChange,
  name,
  only,
}: {
  f: FormatContext;
  value: GoalFund;
  onChange: (fund: GoalFund) => void;
  name: string;
  only?: GoalFund | undefined;
}) {
  const funds: readonly GoalFund[] = only ? [only] : ['REAL', 'EARMARK'];
  return (
    <div role="radiogroup" aria-label={f.t('panels.fund')} style={rowStyle}>
      {funds.map((k) => (
        <label key={k} style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
          <input
            type="radio"
            name={name}
            checked={value === k}
            data-testid={`${name}-${k}`}
            onChange={() => onChange(k)}
          />
          {f.t(`funds.${k}`)}
        </label>
      ))}
    </div>
  );
}

const accountOptions = (accounts: readonly Account[], f: FormatContext, empty = true) => (
  <>
    {empty ? <option value="">{f.t('form.choose')}</option> : null}
    {accounts.map((a) => (
      <option key={a.id} value={a.id}>
        {a.name} ({a.currency})
      </option>
    ))}
  </>
);

/** Transacciones recientes de las cuentas dadas (para vincular un aporte o un retiro existente). */
export function useCandidateTransactions(
  ctx: WorkspaceContext,
  accountIds: readonly string[],
  enabled: boolean,
): { loading: boolean; items: readonly Transaction[] } {
  const [items, setItems] = useState<readonly Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const idsKey = accountIds.join(',');
  const { api, base } = ctx;
  useEffect(() => {
    if (!enabled || idsKey === '') {
      setItems([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all(
      idsKey.split(',').map((id) =>
        api
          .get<Page<Transaction>>(
            `${base}/transactions?${new URLSearchParams({ accountId: id, limit: '50' }).toString()}`,
          )
          .then((r) => r.data?.data ?? [])
          .catch(() => [] as Transaction[]),
      ),
    ).then((lists) => {
      if (cancelled) return;
      const seen = new Map<string, Transaction>();
      for (const tx of lists.flat()) seen.set(tx.id, tx);
      setItems([...seen.values()]);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [api, base, idsKey, enabled]);
  return { loading, items };
}

function TransactionPicker({
  f,
  candidates,
  loading,
  value,
  onChange,
  error,
}: {
  f: FormatContext;
  candidates: readonly Transaction[];
  loading: boolean;
  value: string;
  onChange: (id: string) => void;
  error: string | undefined;
}) {
  return (
    <div style={rowStyle}>
      <Field label={f.t('link.transaction')} error={error} hint={loading ? f.t('loading') : f.t('link.hint')}>
        {(p) => (
          <select
            {...p}
            style={inputStyle}
            value={candidates.some((c) => c.id === value) ? value : ''}
            data-testid="goal-link-transaction"
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">{candidates.length === 0 ? f.t('link.none') : f.t('form.choose')}</option>
            {candidates.map((tx) => (
              <option key={tx.id} value={tx.id}>
                {formatLocalDate(tx.transactionDate, f.locale)} ·{' '}
                {tx.description ?? f.t(`transactionKinds.${tx.kind}`)} · {formatMoney(tx.amount, f.locale)}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label={f.t('link.transactionId')}>
        {(p) => (
          <input
            {...p}
            style={inputStyle}
            value={value}
            data-testid="goal-link-transaction-id"
            onChange={(e) => onChange(e.target.value.trim())}
          />
        )}
      </Field>
    </div>
  );
}

// ───────────────────────────── Aportar / reservar ─────────────────────────────

export function ContributionPanel({
  ctx,
  f,
  goal,
  accounts,
  initial,
  onCancel,
  onDone,
}: PanelProps & { initial: ContributionForm }) {
  const [form, setForm] = useState<ContributionForm>(initial);
  const set = (patch: Partial<ContributionForm>) => setForm((p) => ({ ...p, ...patch }));
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const active = linkableAccounts(accounts);
  const source = byId.get(form.sourceAccountId);
  const destinations = active.filter(
    (a) =>
      goal.linkedAccountIds.includes(a.id) &&
      a.id !== form.sourceAccountId &&
      (!source || a.currency === source.currency),
  );
  const action = usePanelAction({
    build: () =>
      buildContributionInput(
        form,
        { locale: ctx.formatLocale, scaleOf: (c) => scaleFor(c, ctx.scales) },
        byId,
      ),
    send: (input, key) =>
      ctx.api
        .command<GoalMovement>('POST', `${goalPath(ctx.base, goal.id)}/contributions`, input, {
          idempotencyKey: key,
        })
        .then(() => undefined),
    onDone: () => onDone(f.t(form.fund === 'REAL' ? 'contribute.doneReal' : 'contribute.doneEarmark')),
  });
  const err = (k: string) => (action.errors[k] ? f.t(`errors.${action.errors[k]}`) : undefined);
  return (
    <PanelForm
      ctx={ctx}
      f={f}
      testId="goal-contribute-form"
      title={f.t('contribute.title')}
      action={action}
      submitLabel={f.t(form.fund === 'REAL' ? 'contribute.submitReal' : 'contribute.submitEarmark')}
      onCancel={onCancel}
    >
      <FundRadios
        f={f}
        value={form.fund}
        name="contribute-fund"
        onChange={(fund) => set({ fund, destinationAccountId: '' })}
      />
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t(`contribute.hint.${form.fund}`)}</p>
      <div style={rowStyle}>
        <Field
          label={
            source ? f.t('contribute.amountIn', { currency: source.currency }) : f.t('contribute.amount')
          }
          error={err('amount')}
        >
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="decimal"
              value={form.amount}
              data-testid="goal-contribute-amount"
              onChange={(e) => set({ amount: e.target.value })}
            />
          )}
        </Field>
        <Field label={f.t('contribute.date')} error={err('businessDate')}>
          {(p) => (
            <input
              {...p}
              type="date"
              style={inputStyle}
              value={form.businessDate}
              data-testid="goal-contribute-date"
              onChange={(e) => set({ businessDate: e.target.value })}
            />
          )}
        </Field>
      </div>
      <div style={rowStyle}>
        <Field
          label={form.fund === 'REAL' ? f.t('contribute.source') : f.t('contribute.reserveAccount')}
          error={err('sourceAccountId')}
        >
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={form.sourceAccountId}
              data-testid="goal-contribute-source"
              onChange={(e) => set({ sourceAccountId: e.target.value, destinationAccountId: '' })}
            >
              {accountOptions(active, f)}
            </select>
          )}
        </Field>
        {form.fund === 'REAL' ? (
          <Field
            label={f.t('contribute.destination')}
            error={err('destinationAccountId')}
            hint={goal.linkedAccountIds.length === 0 ? f.t('contribute.noLinked') : undefined}
          >
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={form.destinationAccountId}
                data-testid="goal-contribute-destination"
                onChange={(e) => set({ destinationAccountId: e.target.value })}
              >
                {accountOptions(destinations, f)}
              </select>
            )}
          </Field>
        ) : null}
      </div>
      <Field label={f.t('contribute.note')} error={err('note')}>
        {(p) => (
          <input
            {...p}
            style={inputStyle}
            value={form.note}
            maxLength={500}
            data-testid="goal-contribute-note"
            onChange={(e) => set({ note: e.target.value })}
          />
        )}
      </Field>
    </PanelForm>
  );
}

// ───────────────────────────── Retirar / liberar ─────────────────────────────

export function WithdrawPanel({ ctx, f, goal, accounts, onCancel, onDone }: PanelProps) {
  const [form, setForm] = useState<WithdrawForm>(() => emptyWithdrawForm(todayIn(ctx.timeZone)));
  const set = (patch: Partial<WithdrawForm>) => setForm((p) => ({ ...p, ...patch }));
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const active = linkableAccounts(accounts);
  // Con aporte real se retira de las cuentas vinculadas; una reserva puede estar en cualquier cuenta activa.
  const sources = form.fund === 'REAL' ? active.filter((a) => goal.linkedAccountIds.includes(a.id)) : active;
  const account = byId.get(form.accountId);
  const holds = goal.linkedAccounts.find((l) => l.accountId === form.accountId);
  const candidates = useCandidateTransactions(
    ctx,
    [form.accountId],
    form.mode === 'LINK' && form.accountId !== '',
  );
  const links = linkableWithdrawals(candidates.items, form.accountId);
  const targets = active.filter(
    (a) => a.id !== form.accountId && (!account || a.currency === account.currency),
  );
  const action = usePanelAction({
    build: () =>
      buildWithdrawInput(form, { locale: ctx.formatLocale, scaleOf: (c) => scaleFor(c, ctx.scales) }, byId),
    send: (input, key) =>
      ctx.api
        .command<GoalMovement>('POST', `${goalPath(ctx.base, goal.id)}/withdrawals`, input, {
          idempotencyKey: key,
        })
        .then(() => undefined),
    onDone: () => onDone(f.t(form.mode === 'RELEASE' ? 'withdraw.doneRelease' : 'withdraw.done')),
  });
  const err = (k: string) => (action.errors[k] ? f.t(`errors.${action.errors[k]}`) : undefined);
  const modes = withdrawModes(form.fund);
  return (
    <PanelForm
      ctx={ctx}
      f={f}
      testId="goal-withdraw-form"
      title={f.t('withdraw.title')}
      action={action}
      submitLabel={form.mode === 'RELEASE' ? f.t('withdraw.submitRelease') : f.t('withdraw.submit')}
      onCancel={onCancel}
    >
      <FundRadios
        f={f}
        value={form.fund}
        name="withdraw-fund"
        onChange={(fund) => set({ fund, accountId: '', mode: withdrawModes(fund)[0]! })}
      />
      <div style={rowStyle}>
        <Field
          label={f.t('withdraw.account')}
          error={err('accountId')}
          hint={
            holds
              ? f.t('withdraw.funds', {
                  amount: formatMoney(
                    form.fund === 'REAL' ? holds.funds.real : holds.funds.earmark,
                    f.locale,
                  ),
                })
              : undefined
          }
        >
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={form.accountId}
              data-testid="goal-withdraw-account"
              onChange={(e) => set({ accountId: e.target.value, toAccountId: '', transactionId: '' })}
            >
              {accountOptions(sources, f)}
            </select>
          )}
        </Field>
        <Field
          label={
            account ? f.t('contribute.amountIn', { currency: account.currency }) : f.t('contribute.amount')
          }
          error={err('amount')}
        >
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="decimal"
              value={form.amount}
              data-testid="goal-withdraw-amount"
              onChange={(e) => set({ amount: e.target.value })}
            />
          )}
        </Field>
      </div>
      <div role="radiogroup" aria-label={f.t('withdraw.mode')} style={rowStyle}>
        {modes.map((m) => (
          <label key={m} style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
            <input
              type="radio"
              name="withdraw-mode"
              checked={form.mode === m}
              data-testid={`goal-withdraw-mode-${m}`}
              onChange={() => set({ mode: m })}
            />
            {f.t(`withdraw.modes.${m}`)}
          </label>
        ))}
      </div>
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t(`withdraw.modeHint.${form.mode}`)}</p>
      {form.mode === 'TRANSFER' ? (
        <div style={rowStyle}>
          <Field label={f.t('withdraw.toAccount')} error={err('toAccountId')}>
            {(p) => (
              <select
                {...p}
                style={inputStyle}
                value={form.toAccountId}
                data-testid="goal-withdraw-to"
                onChange={(e) => set({ toAccountId: e.target.value })}
              >
                {accountOptions(targets, f)}
              </select>
            )}
          </Field>
          <Field label={f.t('contribute.date')} error={err('businessDate')}>
            {(p) => (
              <input
                {...p}
                type="date"
                style={inputStyle}
                value={form.businessDate}
                data-testid="goal-withdraw-date"
                onChange={(e) => set({ businessDate: e.target.value })}
              />
            )}
          </Field>
        </div>
      ) : null}
      {form.mode === 'LINK' ? (
        <TransactionPicker
          f={f}
          candidates={links}
          loading={candidates.loading}
          value={form.transactionId}
          onChange={(transactionId) => set({ transactionId })}
          error={err('transactionId')}
        />
      ) : null}
      <Field label={f.t('withdraw.reason')} error={err('reason')}>
        {(p) => (
          <input
            {...p}
            style={inputStyle}
            value={form.reason}
            maxLength={500}
            data-testid="goal-withdraw-reason"
            onChange={(e) => set({ reason: e.target.value })}
          />
        )}
      </Field>
    </PanelForm>
  );
}

// ───────────────────────────── Reasignar ─────────────────────────────

export function ReassignPanel({
  ctx,
  f,
  goal,
  accounts,
  otherGoals,
  onCancel,
  onDone,
}: PanelProps & { otherGoals: readonly Goal[] }) {
  const [form, setForm] = useState<ReassignForm>(emptyReassignForm);
  const set = (patch: Partial<ReassignForm>) => setForm((p) => ({ ...p, ...patch }));
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const active = linkableAccounts(accounts);
  const sources = form.fund === 'REAL' ? active.filter((a) => goal.linkedAccountIds.includes(a.id)) : active;
  const account = byId.get(form.accountId);
  const targets = otherGoals.filter(
    (g) => g.id !== goal.id && !isTerminal(g.status) && g.archivedAt === null,
  );
  const action = usePanelAction({
    build: () =>
      buildReassignInput(
        form,
        goal.id,
        { locale: ctx.formatLocale, scaleOf: (c) => scaleFor(c, ctx.scales) },
        byId,
      ),
    send: (input, key) =>
      ctx.api
        .command('POST', `${goalPath(ctx.base, goal.id)}/reassignments`, input, { idempotencyKey: key })
        .then(() => undefined),
    onDone: () => onDone(f.t('reassign.done')),
  });
  const err = (k: string) => (action.errors[k] ? f.t(`errors.${action.errors[k]}`) : undefined);
  return (
    <PanelForm
      ctx={ctx}
      f={f}
      testId="goal-reassign-form"
      title={f.t('reassign.title')}
      action={action}
      submitLabel={f.t('reassign.submit')}
      onCancel={onCancel}
    >
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t('reassign.hint')}</p>
      <div style={rowStyle}>
        <Field label={f.t('reassign.target')} error={err('targetGoalId')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={form.targetGoalId}
              data-testid="goal-reassign-target"
              onChange={(e) => set({ targetGoalId: e.target.value })}
            >
              <option value="">{f.t('form.choose')}</option>
              {targets.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <FundRadios
        f={f}
        value={form.fund}
        name="reassign-fund"
        onChange={(fund) => set({ fund, accountId: '' })}
      />
      <div style={rowStyle}>
        <Field label={f.t('withdraw.account')} error={err('accountId')}>
          {(p) => (
            <select
              {...p}
              style={inputStyle}
              value={form.accountId}
              data-testid="goal-reassign-account"
              onChange={(e) => set({ accountId: e.target.value })}
            >
              {accountOptions(sources, f)}
            </select>
          )}
        </Field>
        <Field
          label={
            account ? f.t('contribute.amountIn', { currency: account.currency }) : f.t('contribute.amount')
          }
          error={err('amount')}
        >
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="decimal"
              value={form.amount}
              data-testid="goal-reassign-amount"
              onChange={(e) => set({ amount: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label={f.t('withdraw.reason')} error={err('reason')}>
        {(p) => (
          <input
            {...p}
            style={inputStyle}
            value={form.reason}
            maxLength={500}
            data-testid="goal-reassign-reason"
            onChange={(e) => set({ reason: e.target.value })}
          />
        )}
      </Field>
    </PanelForm>
  );
}

// ───────────────────────────── Vincular una transacción existente ─────────────────────────────

export function LinkPanel({ ctx, f, goal, onCancel, onDone }: PanelProps) {
  const [transactionId, setTransactionId] = useState('');
  const candidates = useCandidateTransactions(ctx, goal.linkedAccountIds, true);
  const options = linkableContributions(candidates.items, goal.linkedAccountIds);
  const action = usePanelAction({
    build: (): BuildResult<{ transactionId: string }> =>
      transactionId === ''
        ? { ok: false, errors: { transactionId: 'REQUIRED' } }
        : { ok: true, input: { transactionId } },
    send: (input, key) =>
      ctx.api
        .command<GoalMovement>('POST', `${goalPath(ctx.base, goal.id)}/contributions/link`, input, {
          idempotencyKey: key,
        })
        .then(() => undefined),
    onDone: () => onDone(f.t('link.done')),
  });
  return (
    <PanelForm
      ctx={ctx}
      f={f}
      testId="goal-link-form"
      title={f.t('link.title')}
      action={action}
      submitLabel={f.t('link.submit')}
      onCancel={onCancel}
    >
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t('link.intro')}</p>
      <TransactionPicker
        f={f}
        candidates={options}
        loading={candidates.loading}
        value={transactionId}
        onChange={setTransactionId}
        error={action.errors['transactionId'] ? f.t(`errors.${action.errors['transactionId']}`) : undefined}
      />
    </PanelForm>
  );
}

// ───────────────────────────── Plan mensual y programación recurrente ─────────────────────────────

export function PlanPanel({ ctx, f, goal, accounts, onCancel, onDone }: PanelProps) {
  const [form, setForm] = useState<PlanForm>(() => planFormFrom(goal.plan));
  const set = (patch: Partial<PlanForm>) => setForm((p) => ({ ...p, ...patch }));
  const currency = goal.target.currency;
  const active = linkableAccounts(accounts).filter((a) => a.currency === currency);
  const destinations = active.filter((a) => goal.linkedAccountIds.includes(a.id));
  const recurring = form.automation === 'RECURRING';
  const action = usePanelAction({
    build: () =>
      buildPlanInput(form, { locale: ctx.formatLocale, scale: scaleFor(currency, ctx.scales), currency }),
    send: (input, key) =>
      ctx.api
        .command('PUT', `${goalPath(ctx.base, goal.id)}/plan`, input, {
          ifMatch: goal.version,
          idempotencyKey: key,
        })
        .then(() => undefined),
    onDone: () => onDone(f.t('plan.done')),
  });
  const err = (k: string) => (action.errors[k] ? f.t(`errors.${action.errors[k]}`) : undefined);
  return (
    <PanelForm
      ctx={ctx}
      f={f}
      testId="goal-plan-form"
      title={f.t('plan.formTitle')}
      action={action}
      submitLabel={f.t('plan.save')}
      onCancel={onCancel}
    >
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t('plan.intro')}</p>
      <div style={rowStyle}>
        <Field label={f.t('plan.monthlyAmount', { currency })} error={err('monthlyAmount')}>
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="decimal"
              value={form.monthlyAmount}
              data-testid="goal-plan-amount"
              onChange={(e) => set({ monthlyAmount: e.target.value })}
            />
          )}
        </Field>
        <Field label={f.t('plan.dayOfMonth')} error={err('dayOfMonth')} hint={f.t('plan.dayHint')}>
          {(p) => (
            <input
              {...p}
              style={inputStyle}
              inputMode="numeric"
              value={form.dayOfMonth}
              data-testid="goal-plan-day"
              onChange={(e) => set({ dayOfMonth: e.target.value })}
            />
          )}
        </Field>
      </div>
      <FundRadios
        f={f}
        value={form.fund}
        name="plan-fund"
        onChange={(fund) => set({ fund, ...(fund === 'EARMARK' ? { automation: 'NONE' as const } : {}) })}
      />
      <label style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={recurring}
          disabled={form.fund !== 'REAL'}
          data-testid="goal-plan-recurring"
          onChange={(e) => set({ automation: e.target.checked ? 'RECURRING' : 'NONE' })}
        />
        {f.t('plan.recurring')}
      </label>
      <p style={{ ...mutedStyle, margin: 0 }}>
        {form.fund === 'REAL' ? f.t('plan.recurringHint') : f.t('plan.recurringOnlyReal')}
      </p>
      {recurring ? (
        <div style={{ display: 'grid', gap: 'var(--pf-space-2)' }} data-testid="goal-plan-recurring-fields">
          <div style={rowStyle}>
            <Field label={f.t('plan.source')} error={err('sourceAccountId')}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={form.sourceAccountId}
                  data-testid="goal-plan-source"
                  onChange={(e) => set({ sourceAccountId: e.target.value })}
                >
                  {accountOptions(active, f)}
                </select>
              )}
            </Field>
            <Field label={f.t('plan.destination')} error={err('destinationAccountId')}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={form.destinationAccountId}
                  data-testid="goal-plan-destination"
                  onChange={(e) => set({ destinationAccountId: e.target.value })}
                >
                  {accountOptions(destinations, f)}
                </select>
              )}
            </Field>
          </div>
          <div role="radiogroup" aria-label={f.t('plan.materialization')} style={rowStyle}>
            {(['PENDING_APPROVAL', 'AUTO_CREATE'] as const).map((m) => (
              <label key={m} style={{ display: 'flex', gap: 'var(--pf-space-1)', alignItems: 'center' }}>
                <input
                  type="radio"
                  name="plan-mode"
                  checked={form.mode === m}
                  data-testid={`goal-plan-mode-${m}`}
                  onChange={() => set({ mode: m })}
                />
                {f.t(`plan.modes.${m}`)}
              </label>
            ))}
          </div>
          {form.mode === 'AUTO_CREATE' ? (
            <Field label={f.t('plan.autoStatus')}>
              {(p) => (
                <select
                  {...p}
                  style={inputStyle}
                  value={form.autoCreateStatus}
                  data-testid="goal-plan-auto-status"
                  onChange={(e) => set({ autoCreateStatus: e.target.value as PlanForm['autoCreateStatus'] })}
                >
                  {(['POSTED', 'PENDING'] as const).map((s) => (
                    <option key={s} value={s}>
                      {f.t(`plan.autoStatuses.${s}`)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
        </div>
      ) : null}
    </PanelForm>
  );
}

// ───────────────────────────── Edición ─────────────────────────────

export function EditPanel({
  ctx,
  f,
  goal,
  accounts,
  etag,
  onCancel,
  onDone,
}: PanelProps & { etag: string | undefined }) {
  const [form, setForm] = useState<GoalForm>(() => formFromGoal(goal));
  const currencies = useMemo(() => {
    const codes = ctx.currencies.filter((c) => c.enabled).map((c) => c.code);
    return codes.length > 0 ? codes : [goal.target.currency];
  }, [ctx.currencies, goal.target.currency]);
  // La moneda del objetivo se bloquea apenas la meta tiene fondos o un plan (`GOAL_CURRENCY_LOCKED`).
  const currencyLocked = goal.progress.byCurrency.length > 0 || goal.plan !== null;
  const action = usePanelAction({
    build: () =>
      buildUpdateInput(form, goal, {
        locale: ctx.formatLocale,
        scale: scaleFor(form.currency, ctx.scales),
      }),
    send: (input, key) =>
      ctx.api
        .command('PATCH', goalPath(ctx.base, goal.id), input, {
          ifMatch: etag ?? goal.version,
          idempotencyKey: key,
          contentType: 'application/json',
        })
        .then(() => undefined),
    onDone: () => onDone(f.t('edit.done')),
  });
  return (
    <form
      style={{ display: 'grid', gap: 'var(--pf-space-4)' }}
      noValidate
      data-testid="goal-edit-form"
      onSubmit={(e) => {
        e.preventDefault();
        action.submit();
      }}
    >
      <GoalFields
        f={f}
        form={form}
        set={(patch) => setForm((p) => ({ ...p, ...patch }))}
        errors={action.errors}
        accounts={accounts}
        currencies={currencies}
        disabled={action.busy}
        editing
        currencyLocked={currencyLocked}
      />
      <EditFooter ctx={ctx} f={f} action={action} onCancel={onCancel} />
    </form>
  );
}

function EditFooter({
  ctx,
  f,
  action,
  onCancel,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  action: PanelAction;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (action.tick > 0) ref.current?.focus();
  }, [action.tick]);
  const count = Object.keys(action.errors).length;
  return (
    <>
      <div ref={ref} tabIndex={-1} data-testid="goal-edit-form-errors">
        {count > 0 ? (
          <p role="alert" style={{ color: 'var(--pf-error)', margin: 0 }}>
            {action.errors['form'] === 'NO_CHANGES'
              ? f.t('errors.NO_CHANGES')
              : f.t('form.fixErrors', { count })}
          </p>
        ) : null}
        {action.problem ? <ProblemMessage problem={action.problem} locale={ctx.uiLocale} /> : null}
      </div>
      <div style={rowStyle}>
        <button type="submit" disabled={action.busy} data-testid="goal-edit-form-submit">
          {action.busy ? f.t('form.saving') : f.t('form.saveChanges')}
        </button>
        <button type="button" onClick={onCancel} disabled={action.busy}>
          {f.t('form.cancel')}
        </button>
      </div>
    </>
  );
}
