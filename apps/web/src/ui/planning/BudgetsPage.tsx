'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { AuditHistory } from '../AuditHistory';
import { scaleFor } from '../common/money';
import { todayIn } from '../common/dates';
import { cardStyle, ConfirmPanel, mutedStyle, pageStyle, rowStyle, warningStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import {
  buildLineBody,
  emptyLineForm,
  formFromLine,
  type Budget,
  type BudgetLine,
  type LineBody,
  type LineFormErrors,
  type LineFormValues,
} from './budget-logic';
import { BudgetLineForm, natureOf, type TargetOptions } from './BudgetLineForm';
import { loadCatalog, type Catalog } from './catalog';
import { BudgetLinesTable, targetName, type TargetNames } from './BudgetLinesTable';
import { BudgetTotalsView } from './BudgetTotalsView';
import { defaultPeriodId, formatBusinessDate, periodName, type FinancialPeriod } from './logic';
import { loadPeriods } from './PeriodsPage';
import { PeriodSelector } from './PeriodSelector';
import { PlanOriginInfo, PlanOriginPanel, OmittedLinesNotice, type PlanSource } from './PlanOriginPanel';
import { PlanTemplateActions } from './PlanTemplateActions';
import { PlanningNav } from './PlanningNav';
import type { OmittedLine } from './template-logic';

/** Cuerpo de un POST: sin campos nulos (el contrato no los admite en la creación). */
function createBody(values: LineFormValues, body: LineBody) {
  const out: Record<string, unknown> = {
    target: { kind: values.targetKind, id: values.targetId },
    kind: body.kind,
    rolloverPolicy: body.rolloverPolicy,
  };
  for (const key of [
    'planned',
    'min',
    'max',
    'percent',
    'incomeBasis',
    'rolloverCap',
    'thresholds',
  ] as const) {
    if (body[key] !== null) out[key] = body[key];
  }
  return out;
}

export function BudgetsPage() {
  return <WithWorkspace>{(ctx) => <Budgets ctx={ctx} />}</WithWorkspace>;
}

type Panel = { readonly type: 'add' } | { readonly type: 'edit'; readonly line: BudgetLine } | undefined;

/**
 * Pantalla "Presupuestos" del periodo (`/planificacion/presupuestos`, openspec add-budgets 6.1): plan mensual con el
 * selector de periodo existente, líneas con planificado/gastado/restante/uso/proyección y estado (texto + icono),
 * umbrales, disponible para gastar, tasas usadas y montos sin convertir, rollover provisional/definitivo y edición con
 * los errores de la API traducidos por `code` (NFR-USAB-009). Un periodo cerrado es de solo lectura.
 */
function Budgets({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Budgets', ctx);
  const pf = useFormat('Planning', ctx);
  const today = todayIn(ctx.timeZone);
  const [periods, setPeriods] = useState<readonly FinancialPeriod[] | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  const [catalog, setCatalog] = useState<Catalog | undefined>();
  const [budget, setBudget] = useState<Budget | null | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<Panel>();
  const [form, setForm] = useState<LineFormValues>(emptyLineForm());
  const [errors, setErrors] = useState<LineFormErrors>({});
  const [removing, setRemoving] = useState<BudgetLine | undefined>();
  const [omitted, setOmitted] = useState<readonly OmittedLine[]>([]);

  useEffect(() => {
    loadPeriods(ctx)
      .then(setPeriods)
      .catch((err: unknown) => {
        setProblem(problemOf(err));
        setPeriods([]);
      });
    loadCatalog(ctx)
      .then(setCatalog)
      .catch((err: unknown) => setProblem(problemOf(err)));
  }, [ctx]);

  const periodId = periods ? (selected ?? defaultPeriodId(periods, today)) : undefined;
  const period = periods?.find((p) => p.id === periodId);

  const loadBudget = useCallback(() => {
    if (!periodId) return;
    setBudget(undefined);
    ctx.api
      .get<Budget>(`${ctx.base}/periods/${periodId}/budget`)
      .then((r) => setBudget(r.data ?? null))
      .catch((err: unknown) => {
        if (err instanceof FinanceApiError && err.status === 404) setBudget(null);
        else {
          setProblem(problemOf(err));
          setBudget(null);
        }
      });
  }, [ctx, periodId]);
  useEffect(loadBudget, [loadBudget]);

  const scale = scaleFor(budget?.currency ?? ctx.ws.baseCurrency, ctx.scales);
  const closed = budget?.periodStatus === 'CLOSED' || period?.status === 'CLOSED';
  const canWrite = ctx.canEdit && !closed;
  const names: TargetNames = catalog?.names ?? { CATEGORY: new Map(), GROUP: new Map(), TAG: new Map() };
  const options: TargetOptions = catalog?.options ?? { CATEGORY: [], GROUP: [], TAG: [] };

  async function run<T>(action: () => Promise<T>, done?: string): Promise<T | undefined> {
    setBusy(true);
    setProblem(undefined);
    setStatus(undefined);
    try {
      const result = await action();
      if (done) setStatus(done);
      return result;
    } catch (err) {
      setProblem(problemOf(err));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function createPlan(source: PlanSource) {
    if (!periodId) return;
    const created = await run(
      () => ctx.api.command<Budget>('POST', `${ctx.base}/budgets`, { periodId, source }),
      f.t('planCreated'),
    );
    if (created) {
      setOmitted(created.data?.omittedLines ?? []);
      loadBudget();
    }
  }

  async function toggleZeroBased() {
    if (!budget) return;
    const ok = await run(() =>
      ctx.api.command(
        'PATCH',
        `${ctx.base}/budgets/${budget.id}`,
        { zeroBased: !budget.zeroBased },
        {
          ifMatch: budget.version,
          idempotent: false,
        },
      ),
    );
    if (ok) loadBudget();
  }

  async function submit() {
    if (!budget) return;
    const nature = natureOf(options, form);
    const adjusted: LineFormValues = nature === 'INCOME' ? { ...form, kind: 'FIXED' } : form;
    const built = buildLineBody(adjusted, {
      currency: budget.currency,
      scale,
      locale: ctx.formatLocale,
      nature,
    });
    const formErrors: Record<string, 'required' | 'invalid' | 'scale'> = built.ok ? {} : { ...built.errors };
    if (panel?.type === 'add' && adjusted.targetId === '') formErrors['targetId'] = 'required';
    if (!built.ok || Object.keys(formErrors).length > 0) {
      setErrors(formErrors as LineFormErrors);
      return;
    }
    setErrors({});
    const path = `${ctx.base}/budgets/${budget.id}/lines`;
    const saved =
      panel?.type === 'edit'
        ? await run(
            () =>
              ctx.api.command('PATCH', `${path}/${panel.line.id}`, built.body, {
                ifMatch: panel.line.version,
                idempotent: false,
              }),
            f.t('lineSaved'),
          )
        : await run(() => ctx.api.command('POST', path, createBody(adjusted, built.body)), f.t('lineAdded'));
    if (saved) {
      setPanel(undefined);
      loadBudget();
    }
  }

  async function remove(line: BudgetLine) {
    if (!budget) return;
    const ok = await run(
      () =>
        ctx.api.command('DELETE', `${ctx.base}/budgets/${budget.id}/lines/${line.id}`, undefined, {
          idempotent: false,
        }),
      f.t('lineRemoved'),
    );
    setRemoving(undefined);
    if (ok) loadBudget();
  }

  const nameOfRemoving = useMemo(
    () => (removing ? targetName(names, removing.target.kind, removing.target.id) : ''),
    [removing, names],
  );

  return (
    <section aria-labelledby="budgets-title" style={{ ...pageStyle, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <PlanningNav f={f} />
      <h1 id="budgets-title">{f.t('title')}</h1>
      <p style={mutedStyle}>{f.t('intro')}</p>
      {status ? <p role="status">{status}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {periods === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : periods.length === 0 ? (
        <p data-testid="budgets-no-periods" style={mutedStyle}>
          {f.t('noPeriods')}
        </p>
      ) : (
        <>
          <div style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}>
            <PeriodSelector
              periods={periods}
              today={today}
              value={selected}
              onChange={(id) => {
                setSelected(id);
                setPanel(undefined);
                setRemoving(undefined);
                setOmitted([]);
              }}
              f={pf}
            />
            {period ? (
              <p style={{ margin: 0 }} aria-live="polite">
                {f.t('periodSummary', {
                  name: periodName(period.label, pf.locale),
                  from: formatBusinessDate(period.periodStart),
                  to: formatBusinessDate(period.periodEnd),
                  status: pf.t(`status.${period.status}`),
                })}
              </p>
            ) : null}
          </div>
          {closed ? (
            <p role="note" style={warningStyle} data-testid="budget-closed">
              {f.t('periodClosed')}
            </p>
          ) : null}
          {budget === undefined ? (
            <p aria-busy="true">{f.t('loadingPlan')}</p>
          ) : budget === null ? (
            <div
              style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
              data-testid="budget-none"
            >
              <p style={{ margin: 0 }}>{f.t('noPlan')}</p>
              {canWrite ? (
                <PlanOriginPanel ctx={ctx} f={f} busy={busy} onCreate={(source) => void createPlan(source)} />
              ) : null}
            </div>
          ) : (
            <PlanView
              ctx={ctx}
              f={f}
              budget={budget}
              names={names}
              options={options}
              canWrite={canWrite}
              busy={busy}
              panel={panel}
              form={form}
              errors={errors}
              removing={removing}
              nameOfRemoving={nameOfRemoving}
              onToggleZeroBased={() => void toggleZeroBased()}
              onOpenAdd={() => {
                setForm(emptyLineForm());
                setErrors({});
                setPanel({ type: 'add' });
              }}
              onEdit={(line) => {
                setForm(formFromLine(line));
                setErrors({});
                setPanel({ type: 'edit', line });
              }}
              onClosePanel={() => {
                setPanel(undefined);
                setErrors({});
              }}
              onForm={setForm}
              onSubmit={() => void submit()}
              onAskRemove={setRemoving}
              onConfirmRemove={(line) => void remove(line)}
              omitted={omitted}
              onChanged={loadBudget}
            />
          )}
        </>
      )}
    </section>
  );
}

function PlanView({
  ctx,
  f,
  budget,
  names,
  options,
  canWrite,
  busy,
  panel,
  form,
  errors,
  removing,
  nameOfRemoving,
  onToggleZeroBased,
  onOpenAdd,
  onEdit,
  onClosePanel,
  onForm,
  onSubmit,
  onAskRemove,
  onConfirmRemove,
  omitted,
  onChanged,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  budget: Budget;
  names: TargetNames;
  options: TargetOptions;
  canWrite: boolean;
  busy: boolean;
  panel: Panel;
  form: LineFormValues;
  errors: LineFormErrors;
  removing: BudgetLine | undefined;
  nameOfRemoving: string;
  onToggleZeroBased: () => void;
  onOpenAdd: () => void;
  onEdit: (line: BudgetLine) => void;
  onClosePanel: () => void;
  onForm: (next: LineFormValues) => void;
  onSubmit: () => void;
  onAskRemove: (line: BudgetLine | undefined) => void;
  onConfirmRemove: (line: BudgetLine) => void;
  omitted: readonly OmittedLine[];
  onChanged: () => void;
}) {
  return (
    <>
      <PlanOriginInfo origin={budget.origin} templateVersion={budget.templateVersion} f={f} />
      <OmittedLinesNotice omitted={omitted} names={names} f={f} />
      <BudgetTotalsView budget={budget} f={f} />
      {canWrite ? (
        <div style={rowStyle}>
          <label style={{ display: 'flex', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={budget.zeroBased}
              disabled={busy}
              onChange={onToggleZeroBased}
              data-testid="zero-based"
            />
            {f.t('totals.zeroBased')}
          </label>
        </div>
      ) : null}
      <section
        aria-labelledby="budget-lines-title"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 'var(--pf-space-3)',
          minWidth: 0,
        }}
      >
        <h2 id="budget-lines-title">{f.t('lines.title')}</h2>
        {removing ? (
          <ConfirmPanel
            title={f.t('lines.confirmRemoveTitle', { name: nameOfRemoving })}
            description={f.t('lines.confirmRemoveBody')}
            confirmLabel={f.t('lines.remove')}
            cancelLabel={f.t('form.cancel')}
            busy={busy}
            onConfirm={() => onConfirmRemove(removing)}
            onCancel={() => onAskRemove(undefined)}
            testId="confirm-remove-line"
          />
        ) : null}
        <BudgetLinesTable
          budget={budget}
          names={names}
          f={f}
          canEdit={canWrite}
          editingId={panel?.type === 'edit' ? panel.line.id : undefined}
          busyId={busy ? '*' : undefined}
          onEdit={onEdit}
          onRemove={onAskRemove}
        />
        {canWrite && !panel ? (
          <div style={rowStyle}>
            <button type="button" onClick={onOpenAdd} disabled={busy} data-testid="add-line">
              {f.t('lines.add')}
            </button>
          </div>
        ) : null}
        {canWrite && !panel ? (
          <PlanTemplateActions ctx={ctx} f={f} budget={budget} names={names} onChanged={onChanged} />
        ) : null}
        {canWrite && panel ? (
          <BudgetLineForm
            mode={panel.type}
            values={form}
            errors={errors}
            targets={options}
            currency={budget.currency}
            f={f}
            busy={busy}
            onChange={onForm}
            onSubmit={onSubmit}
            onCancel={onClosePanel}
          />
        ) : null}
      </section>
      {/* Las tablas de cambios son anchas: scroll propio en móvil, no de la página (NFR-USAB-006). */}
      <div style={{ minWidth: 0, overflowX: 'auto', position: 'relative' }}>
        <AuditHistory
          workspaceId={ctx.ws.id}
          aggregateType="Budget"
          aggregateId={budget.id}
          role={ctx.ws.role}
          locale={ctx.formatLocale}
          timeZone={ctx.timeZone}
          refreshKey={budget.version}
        />
      </div>
    </>
  );
}
