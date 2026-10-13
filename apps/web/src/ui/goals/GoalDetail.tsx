'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FinanceApiError, uuidv7, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { Tabs } from '../common/Tabs';
import { todayIn } from '../common/dates';
import { scaleFor } from '../common/money';
import { ConfirmPanel, Field, cardStyle, inputStyle, mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { LifecycleTab } from '../lifecycle/LifecycleTab';
import { useCatalogs } from '../transactions/catalogs';
import { GoalOverview, LinkedAccountsTable, MovementsTable, PlanCard, SimulationResult } from './DetailParts';
import {
  ContributionPanel,
  EditPanel,
  LinkPanel,
  PlanPanel,
  ProblemExtras,
  ReassignPanel,
  WithdrawPanel,
} from './GoalPanels';
import {
  appendMovements,
  availableGoalActions,
  buildSimulationInput,
  EMPTY_SIMULATION,
  emptyContributionForm,
  goalPath,
  goalsPath,
  movementsQuery,
  type SimulationForm,
  type GoalFormErrors,
} from './logic';
import { GoalStatusBadge, OverAllocatedMark, RatesUsed } from './parts';
import { NegativeFundsNotice } from './VoidImpact';
import type { Goal, GoalDetail, GoalList, GoalMovement, GoalMovementPage, GoalSimulation } from './types';

export interface GoalPrefill {
  /** `?creada=1`: la meta acaba de crearse. */
  readonly created?: boolean;
  /** `?aportar=1`: abre el formulario de aporte. */
  readonly contribute?: boolean;
}

export function GoalDetailPage({ goalId, prefill = {} }: { goalId: string; prefill?: GoalPrefill }) {
  return <WithWorkspace>{(ctx) => <Detail ctx={ctx} goalId={goalId} prefill={prefill} />}</WithWorkspace>;
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'notFound' }
  | { readonly status: 'error'; readonly problem: ApiProblemBody }
  | {
      readonly status: 'ready';
      readonly goal: GoalDetail;
      readonly etag: string | undefined;
      readonly movements: readonly GoalMovement[];
      readonly nextCursor: string | null;
    };

type Panel =
  | 'contribute'
  | 'withdraw'
  | 'reassign'
  | 'link'
  | 'plan'
  | 'edit'
  | 'cancel'
  | 'close'
  | 'archive'
  | 'removePlan';

/** Simulación what-if de la meta (`POST …/simulations`): sin efectos ni auditoría; omitidos conservan el valor actual. */
function SimulationSection({ ctx, goal }: { ctx: WorkspaceContext; goal: Goal }) {
  const f = useFormat('Goals', ctx);
  const [form, setForm] = useState<SimulationForm>(EMPTY_SIMULATION);
  const [errors, setErrors] = useState<GoalFormErrors>({});
  const [result, setResult] = useState<GoalSimulation | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const currency = goal.target.currency;
  const err = (k: string) => (errors[k] ? f.t(`errors.${errors[k]}`) : undefined);

  async function run() {
    setProblem(undefined);
    const built = buildSimulationInput(form, {
      locale: ctx.formatLocale,
      scale: scaleFor(currency, ctx.scales),
      currency,
    });
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const r = await ctx.api.command<GoalSimulation>(
        'POST',
        `${goalPath(ctx.base, goal.id)}/simulations`,
        built.input,
        {
          idempotent: false,
        },
      );
      setResult(r.data);
    } catch (e) {
      setResult(undefined);
      setProblem(problemOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="goal-sim-title" style={cardStyle} data-testid="goal-simulation">
      <h2 id="goal-sim-title" style={{ fontSize: '1rem', marginTop: 0 }}>
        {f.t('simulation.title')}
      </h2>
      <p style={mutedStyle}>{f.t('simulation.intro')}</p>
      <form
        noValidate
        data-testid="goal-simulation-form"
        style={{ display: 'grid', gap: 'var(--pf-space-3)' }}
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div style={rowStyle}>
          <Field label={f.t('simulation.monthly', { currency })} error={err('monthlyContribution')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={form.monthlyContribution}
                data-testid="goal-sim-monthly"
                onChange={(e) => setForm((s) => ({ ...s, monthlyContribution: e.target.value }))}
              />
            )}
          </Field>
          <Field label={f.t('simulation.targetAmount', { currency })} error={err('targetAmount')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                inputMode="decimal"
                value={form.targetAmount}
                data-testid="goal-sim-target"
                onChange={(e) => setForm((s) => ({ ...s, targetAmount: e.target.value }))}
              />
            )}
          </Field>
          <Field label={f.t('simulation.targetDate')} error={err('targetDate')}>
            {(p) => (
              <input
                {...p}
                type="date"
                style={inputStyle}
                value={form.targetDate}
                data-testid="goal-sim-date"
                onChange={(e) => setForm((s) => ({ ...s, targetDate: e.target.value }))}
              />
            )}
          </Field>
        </div>
        <div>
          <button type="submit" disabled={busy} data-testid="goal-sim-submit">
            {f.t('simulation.run')}
          </button>
        </div>
      </form>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {result ? <SimulationResult sim={result} f={f} /> : null}
    </section>
  );
}

function Detail({ ctx, goalId, prefill }: { ctx: WorkspaceContext; goalId: string; prefill: GoalPrefill }) {
  const f = useFormat('Goals', ctx);
  const dashboard = useFormat('Dashboard', ctx);
  const lf = useFormat('Lifecycle', ctx);
  const catalogs = useCatalogs(ctx);
  const today = todayIn(ctx.timeZone);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const [panel, setPanel] = useState<Panel | undefined>(prefill.contribute ? 'contribute' : undefined);
  const [status, setStatus] = useState<string | undefined>(prefill.created ? f.t('created') : undefined);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [otherGoals, setOtherGoals] = useState<readonly Goal[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const attempt = useRef(uuidv7());

  const load = useCallback(async () => {
    try {
      const r = await ctx.api.get<GoalDetail>(goalPath(ctx.base, goalId));
      const page = await ctx.api
        .get<GoalMovementPage>(`${goalPath(ctx.base, goalId)}/movements?${movementsQuery().toString()}`)
        .then((m) => m.data)
        .catch(() => undefined);
      setLoaded({
        status: 'ready',
        goal: r.data!,
        etag: r.etag,
        movements: page?.data ?? [],
        nextCursor: page?.page.hasMore ? page.page.nextCursor : null,
      });
    } catch (err) {
      if (err instanceof FinanceApiError && err.status === 404) setLoaded({ status: 'notFound' });
      else setLoaded({ status: 'error', problem: problemOf(err) });
    }
  }, [ctx.api, ctx.base, goalId]);
  useEffect(() => {
    void load();
  }, [load]);

  // La reasignación necesita las demás metas: se piden al abrir el panel.
  useEffect(() => {
    if (panel !== 'reassign') return;
    let cancelled = false;
    ctx.api
      .get<GoalList>(goalsPath(ctx.base))
      .then((r) => {
        if (!cancelled) setOtherGoals(r.data?.data ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [panel, ctx.api, ctx.base]);

  const accountName = useCallback((id: string) => catalogs.names.account(id), [catalogs.names]);

  if (loaded.status === 'loading')
    return (
      <section style={pageStyle} aria-busy="true">
        <p data-testid="goal-loading">{f.t('loading')}</p>
      </section>
    );
  if (loaded.status !== 'ready')
    return (
      <section style={pageStyle}>
        <h1>{f.t('title')}</h1>
        {loaded.status === 'notFound' ? (
          <p role="alert" data-error-code="RESOURCE_NOT_FOUND" data-testid="goal-not-found">
            {f.t('notFound')}
          </p>
        ) : (
          <ProblemMessage problem={loaded.problem} locale={ctx.uiLocale} />
        )}
        <p>
          <a href={ctx.href('/goals')}>{f.t('back')}</a>
        </p>
      </section>
    );

  const { goal, etag, movements, nextCursor } = loaded;
  const actions = availableGoalActions(goal);
  const close = () => {
    setPanel(undefined);
    setReason('');
    setProblem(undefined);
  };
  const done = (message: string) => {
    close();
    setStatus(message);
    attempt.current = uuidv7();
    void load();
  };

  /** Transiciones (`pause`, `resume`, `close`, `cancel`, `archive`) y retiro del plan, con `If-Match` del ETag. */
  async function run(kind: 'pause' | 'resume' | 'close' | 'cancel' | 'archive' | 'removePlan') {
    setProblem(undefined);
    setBusy(true);
    try {
      const base = goalPath(ctx.base, goal.id);
      if (kind === 'removePlan')
        await ctx.api.command('DELETE', `${base}/plan`, undefined, { ifMatch: etag ?? goal.version });
      else
        await ctx.api.command(
          'POST',
          `${base}/${kind}`,
          kind === 'cancel' && reason.trim() !== ''
            ? { reason: reason.trim() }
            : kind === 'cancel'
              ? {}
              : undefined,
          { ifMatch: etag ?? goal.version, idempotencyKey: attempt.current },
        );
      done(f.t(`transitions.${kind}`));
    } catch (err) {
      attempt.current = uuidv7();
      setProblem(problemOf(err));
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await ctx.api.get<GoalMovementPage>(
        `${goalPath(ctx.base, goal.id)}/movements?${movementsQuery(nextCursor).toString()}`,
      );
      setLoaded((prev) =>
        prev.status === 'ready'
          ? {
              ...prev,
              movements: appendMovements(prev.movements, r.data?.data ?? []),
              nextCursor: r.data?.page.hasMore ? r.data.page.nextCursor : null,
            }
          : prev,
      );
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setLoadingMore(false);
    }
  }

  const panelProps = { ctx, f, goal, accounts: catalogs.accounts, onCancel: close, onDone: done };
  const lifecycleLabel = (code: string) => (f.has(`status.${code}`) ? f.t(`status.${code}`) : code);

  return (
    <section
      aria-labelledby="goal-title"
      style={pageStyle}
      data-testid="goal-detail"
      data-status={goal.status}
    >
      <p style={{ margin: 0 }}>
        <a href={ctx.href('/goals')}>{f.t('back')}</a>
      </p>
      <div style={{ ...rowStyle, alignItems: 'center' }}>
        <h1 id="goal-title" style={{ margin: 0 }}>
          {goal.name}
        </h1>
        <GoalStatusBadge tracking={goal.tracking} f={f} />
        {goal.overAllocated ? <OverAllocatedMark f={f} /> : null}
      </div>
      <p style={mutedStyle}>
        {f.t(`types.${goal.type}`)} · {f.t('list.priority', { priority: goal.priority })}
        {goal.archivedAt ? ` · ${f.t('list.archived')}` : ''}
      </p>
      <NegativeFundsNotice negativeFunds={goal.negativeFunds ?? []} f={f} accountName={accountName} />
      {goal.tracking.status === null && goal.status === 'PAUSED' ? (
        <p role="note" style={mutedStyle} data-testid="goal-paused-note">
          {f.t('pausedNote')}
        </p>
      ) : null}
      {status ? (
        <p role="status" data-testid="goal-status-message">
          {status}
        </p>
      ) : null}
      {problem && panel === undefined ? (
        <>
          <ProblemMessage problem={problem} locale={ctx.uiLocale} />
          <ProblemExtras problem={problem} f={f} />
        </>
      ) : null}

      {ctx.canEdit ? (
        <div style={rowStyle} role="group" aria-label={f.t('actions.label')}>
          {actions.contribute ? (
            <>
              <button type="button" data-testid="goal-contribute" onClick={() => setPanel('contribute')}>
                {f.t('actions.contribute')}
              </button>
              <button type="button" data-testid="goal-withdraw" onClick={() => setPanel('withdraw')}>
                {f.t('actions.withdraw')}
              </button>
              <button type="button" data-testid="goal-reassign" onClick={() => setPanel('reassign')}>
                {f.t('actions.reassign')}
              </button>
              <button type="button" data-testid="goal-link" onClick={() => setPanel('link')}>
                {f.t('actions.link')}
              </button>
            </>
          ) : null}
          {actions.edit ? (
            <button type="button" data-testid="goal-edit" onClick={() => setPanel('edit')}>
              {f.t('actions.edit')}
            </button>
          ) : null}
          {actions.pause ? (
            <button type="button" data-testid="goal-pause" disabled={busy} onClick={() => void run('pause')}>
              {f.t('actions.pause')}
            </button>
          ) : null}
          {actions.resume ? (
            <button
              type="button"
              data-testid="goal-resume"
              disabled={busy}
              onClick={() => void run('resume')}
            >
              {f.t('actions.resume')}
            </button>
          ) : null}
          {actions.close ? (
            <button type="button" data-testid="goal-close" onClick={() => setPanel('close')}>
              {f.t('actions.close')}
            </button>
          ) : null}
          {actions.cancel ? (
            <button type="button" data-testid="goal-cancel" onClick={() => setPanel('cancel')}>
              {f.t('actions.cancel')}
            </button>
          ) : null}
          {actions.archive ? (
            <button type="button" data-testid="goal-archive" onClick={() => setPanel('archive')}>
              {f.t('actions.archive')}
            </button>
          ) : null}
        </div>
      ) : null}

      {panel === 'contribute' ? (
        <ContributionPanel
          {...panelProps}
          initial={emptyContributionForm(today, {
            destinationAccountId: goal.linkedAccountIds.length === 1 ? (goal.linkedAccountIds[0] ?? '') : '',
          })}
        />
      ) : null}
      {panel === 'withdraw' ? <WithdrawPanel {...panelProps} /> : null}
      {panel === 'reassign' ? <ReassignPanel {...panelProps} otherGoals={otherGoals} /> : null}
      {panel === 'link' ? <LinkPanel {...panelProps} /> : null}
      {panel === 'plan' ? <PlanPanel {...panelProps} /> : null}
      {panel === 'edit' ? <EditPanel {...panelProps} etag={etag} /> : null}
      {panel === 'close' ? (
        <ConfirmPanel
          title={f.t('confirm.closeTitle')}
          description={f.t('confirm.closeText')}
          confirmLabel={f.t('confirm.close')}
          cancelLabel={f.t('form.cancel')}
          busy={busy}
          onConfirm={() => void run('close')}
          onCancel={close}
          testId="goal-close-confirm"
        >
          {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
        </ConfirmPanel>
      ) : null}
      {panel === 'cancel' ? (
        <ConfirmPanel
          title={f.t('confirm.cancelTitle')}
          description={f.t('confirm.cancelText')}
          confirmLabel={f.t('confirm.cancel')}
          cancelLabel={f.t('form.cancel')}
          busy={busy}
          onConfirm={() => void run('cancel')}
          onCancel={close}
          testId="goal-cancel-confirm"
        >
          <Field label={f.t('confirm.reason')}>
            {(p) => (
              <input
                {...p}
                style={inputStyle}
                value={reason}
                maxLength={500}
                data-testid="goal-cancel-reason"
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
          {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
        </ConfirmPanel>
      ) : null}
      {panel === 'archive' ? (
        <ConfirmPanel
          title={f.t('confirm.archiveTitle')}
          description={f.t('confirm.archiveText')}
          confirmLabel={f.t('confirm.archive')}
          cancelLabel={f.t('form.cancel')}
          busy={busy}
          onConfirm={() => void run('archive')}
          onCancel={close}
          testId="goal-archive-confirm"
        >
          {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
        </ConfirmPanel>
      ) : null}
      {panel === 'removePlan' ? (
        <ConfirmPanel
          title={f.t('confirm.removePlanTitle')}
          description={f.t('confirm.removePlanText')}
          confirmLabel={f.t('confirm.removePlan')}
          cancelLabel={f.t('form.cancel')}
          busy={busy}
          onConfirm={() => void run('removePlan')}
          onCancel={close}
          testId="goal-remove-plan-confirm"
        >
          {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
        </ConfirmPanel>
      ) : null}

      <Tabs
        idPrefix="goal"
        label={lf.t('tabs.label')}
        tabs={[
          {
            id: 'detail',
            label: lf.t('tabs.detail'),
            content: (
              <div style={{ display: 'grid', gap: 'var(--pf-space-4)' }}>
                <GoalOverview goal={goal} f={f} />
                <LinkedAccountsTable goal={goal} f={f} accountName={accountName} href={ctx.href} />
                <PlanCard
                  goal={goal}
                  f={f}
                  href={ctx.href}
                  accountName={accountName}
                  actions={
                    ctx.canEdit && actions.plan ? (
                      <div style={{ ...rowStyle, marginTop: 'var(--pf-space-2)' }}>
                        <button type="button" data-testid="goal-plan-edit" onClick={() => setPanel('plan')}>
                          {goal.plan ? f.t('plan.edit') : f.t('plan.set')}
                        </button>
                        {goal.plan ? (
                          <button
                            type="button"
                            data-testid="goal-plan-remove"
                            onClick={() => setPanel('removePlan')}
                          >
                            {f.t('plan.remove')}
                          </button>
                        ) : null}
                      </div>
                    ) : null
                  }
                />
                <SimulationSection ctx={ctx} goal={goal} />
                <RatesUsed
                  rates={goal.meta.ratesUsed}
                  windowDays={goal.meta.rateWindowDays}
                  f={f}
                  dashboard={dashboard}
                />
              </div>
            ),
          },
          {
            id: 'movements',
            label: f.t('tabs.movements'),
            content: (
              <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }}>
                <MovementsTable movements={movements} f={f} accountName={accountName} href={ctx.href} />
                {nextCursor ? (
                  <div>
                    <button
                      type="button"
                      data-testid="goal-movements-more"
                      disabled={loadingMore}
                      onClick={() => void loadMore()}
                    >
                      {f.t('movements.more')}
                    </button>
                  </div>
                ) : null}
              </div>
            ),
          },
          {
            id: 'lifecycle',
            label: lf.t('tabs.lifecycle'),
            content: (
              <LifecycleTab
                ctx={ctx}
                path={`goals/${goal.id}`}
                refreshKey={goal.version}
                stateLabel={lifecycleLabel}
                accountName={accountName}
                idPrefix="goal-lifecycle"
              />
            ),
          },
        ]}
      />
    </section>
  );
}
