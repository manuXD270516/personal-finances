'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { todayIn } from '../common/dates';
import { cardStyle, mutedStyle, pageStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { LifecycleTab } from '../lifecycle/LifecycleTab';
import { ClosingBody } from './ClosingBody';
import { ClosingChecklistView } from './ClosingChecklistView';
import {
  closeBlock,
  closeBody,
  problemItems,
  reopenReasonError,
  type CloseBlock,
  type CloseChecklist,
} from './closing-logic';
import { defaultPeriodId, formatBusinessDate, newestFirst, periodName, type FinancialPeriod } from './logic';
import { loadPeriods } from './PeriodsPage';
import { PeriodSelector } from './PeriodSelector';
import { PlanningNav } from './PlanningNav';

export function CloseMonthPage({ periodId }: { periodId?: string | undefined }) {
  return <WithWorkspace>{(ctx) => <CloseMonth ctx={ctx} periodId={periodId} />}</WithWorkspace>;
}

/** Periodo por defecto sin `periodId` en la ruta: el más antiguo terminado y sin cerrar; si no, el de hoy. */
export function defaultClosingPeriodId(
  periods: readonly FinancialPeriod[],
  today: string,
): string | undefined {
  const pending = newestFirst(periods)
    .filter((p) => p.pendingClosure)
    .at(-1);
  return pending?.id ?? defaultPeriodId(periods, today);
}

/**
 * Pantalla "Cierre de mes" (`/planificacion/periodos/{id}/cierre`, openspec add-month-closing 6.1): checklist de
 * cierre con ítems por severidad, reconocimiento EXPLÍCITO de las advertencias, nota opcional, resultado del cierre con
 * su versión y enlace al reporte, errores 409 con los ítems que bloquean o faltan por reconocer, "Reabrir" solo para
 * el OWNER (motivo obligatorio y confirmación) y el recorrido del periodo con su exportación. La API decide la
 * autorización y todas las reglas; la UI solo evita llamadas inútiles y oculta o deshabilita las acciones.
 */
function CloseMonth({ ctx, periodId }: { ctx: WorkspaceContext; periodId: string | undefined }) {
  const f = useFormat('Closing', ctx);
  const pf = useFormat('Planning', ctx);
  const nav = useFormat('Budgets', ctx);
  const today = todayIn(ctx.timeZone);
  const [periods, setPeriods] = useState<readonly FinancialPeriod[] | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  const [checklist, setChecklist] = useState<CloseChecklist | undefined>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<'REQUIRED' | 'TOO_LONG' | undefined>();

  const loadAll = useCallback(() => {
    loadPeriods(ctx)
      .then(setPeriods)
      .catch((err: unknown) => {
        setProblem(problemOf(err));
        setPeriods([]);
      });
  }, [ctx]);
  useEffect(loadAll, [loadAll]);

  const currentId = periods ? (periodId ?? selected ?? defaultClosingPeriodId(periods, today)) : undefined;
  const period = periods?.find((p) => p.id === currentId);
  // La versión del periodo cambia con cada acción (cerrar, reabrir): re-evalúa el checklist.
  const checkId = period?.id;
  const checkStatus = period?.status;
  const checkVersion = period?.version;
  const loadChecklist = useCallback(() => {
    if (!checkId || (checkStatus !== 'ACTIVE' && checkStatus !== 'REOPENED')) {
      setChecklist(undefined);
      return;
    }
    ctx.api
      .get<CloseChecklist>(`${ctx.base}/periods/${checkId}/close-checklist`)
      .then((r) => setChecklist(r.data))
      .catch((err: unknown) => setProblem(problemOf(err)));
  }, [ctx, checkId, checkStatus, checkVersion]);
  useEffect(loadChecklist, [loadChecklist]);

  function resetForPeriod() {
    setChecklist(undefined);
    setAcknowledged(false);
    setNote('');
    setProblem(undefined);
    setStatus(undefined);
    setReopening(false);
    setReason('');
    setReasonError(undefined);
  }

  async function close() {
    if (!period) return;
    setBusy(true);
    setProblem(undefined);
    setStatus(undefined);
    try {
      const r = await ctx.api.command<FinancialPeriod>(
        'POST',
        `${ctx.base}/periods/${period.id}/close`,
        closeBody(acknowledged, note),
        { ifMatch: period.version },
      );
      setStatus(
        f.t('closedOk', {
          name: periodName(period.label, f.locale),
          closeNo: r.data?.latestCloseNo ?? period.closeCount + 1,
        }),
      );
      setAcknowledged(false);
      setNote('');
      loadAll();
    } catch (err) {
      setProblem(problemOf(err));
      // El checklist pudo cambiar (o la versión del periodo): se vuelve a evaluar.
      loadChecklist();
    } finally {
      setBusy(false);
    }
  }

  async function reopen() {
    if (!period) return;
    const invalid = reopenReasonError(reason);
    if (invalid) {
      setReasonError(invalid);
      return;
    }
    setReasonError(undefined);
    setBusy(true);
    setProblem(undefined);
    setStatus(undefined);
    try {
      await ctx.api.command(
        'POST',
        `${ctx.base}/periods/${period.id}/reopen`,
        { reason: reason.trim() },
        {
          ifMatch: period.version,
        },
      );
      setStatus(f.t('reopenedOk', { name: periodName(period.label, f.locale) }));
      setReopening(false);
      setReason('');
      loadAll();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const block =
    period && periods
      ? closeBlock({ canEdit: ctx.canEdit, period, checklist, today, acknowledged })
      : 'UNAVAILABLE';
  const items = problem ? problemItems(problem) : { blocking: [], warning: [] };
  return (
    <section aria-labelledby="closing-title" style={pageStyle}>
      <PlanningNav f={nav} current="closing" />
      <h1 id="closing-title">{f.t('title')}</h1>
      <p style={mutedStyle}>{f.t('intro')}</p>
      {status ? (
        <p role="status" data-testid="close-result">
          {status}{' '}
          {period ? (
            <a
              href={ctx.href(`/planificacion/periodos/${period.id}/reporte`)}
              data-testid="close-report-link"
            >
              {f.t('viewReport')}
            </a>
          ) : null}
        </p>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {items.blocking.length > 0 ? (
        <section
          aria-labelledby="problem-blocking-title"
          style={cardStyle}
          data-testid="close-problem-blocking"
        >
          <h2 id="problem-blocking-title">{f.t('problem.blocking')}</h2>
          <ClosingChecklistView
            items={items.blocking}
            f={f}
            href={ctx.href}
            titleId="problem-blocking-title"
            testId="close-problem-blocking-items"
          />
        </section>
      ) : null}
      {items.warning.length > 0 ? (
        <section
          aria-labelledby="problem-warning-title"
          style={cardStyle}
          data-testid="close-problem-warning"
        >
          <h2 id="problem-warning-title">{f.t('problem.warning')}</h2>
          <ClosingChecklistView
            items={items.warning}
            f={f}
            href={ctx.href}
            titleId="problem-warning-title"
            testId="close-problem-warning-items"
          />
        </section>
      ) : null}
      {periods === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : periods.length === 0 ? (
        <p style={mutedStyle} data-testid="close-no-periods">
          {f.t('noPeriods')}
        </p>
      ) : (
        <>
          <div style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}>
            {periodId ? null : (
              <PeriodSelector
                periods={periods}
                today={today}
                value={currentId}
                onChange={(id) => {
                  resetForPeriod();
                  setSelected(id);
                }}
                f={pf}
              />
            )}
            {period ? (
              <p style={{ margin: 0 }} aria-live="polite" data-testid="close-period-summary">
                {pf.t('summary', {
                  name: periodName(period.label, pf.locale),
                  from: formatBusinessDate(period.periodStart),
                  to: formatBusinessDate(period.periodEnd),
                  status: pf.t(`status.${period.status}`),
                })}
              </p>
            ) : (
              <p role="alert">{f.t('periodNotFound')}</p>
            )}
          </div>
          {period ? (
            <PeriodBody
              ctx={ctx}
              f={f}
              period={period}
              today={today}
              checklist={checklist}
              block={block}
              busy={busy}
              acknowledged={acknowledged}
              note={note}
              onAcknowledged={setAcknowledged}
              onNote={setNote}
              onClose={() => void close()}
              reopening={reopening}
              reason={reason}
              reasonError={reasonError}
              onAskReopen={() => {
                setReopening(true);
                setReasonError(undefined);
              }}
              onReason={(v) => {
                setReason(v);
                setReasonError(undefined);
              }}
              onCancelReopen={() => {
                setReopening(false);
                setReason('');
                setReasonError(undefined);
              }}
              onReopen={() => void reopen()}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function PeriodBody({
  ctx,
  f,
  period,
  today,
  checklist,
  block,
  busy,
  acknowledged,
  note,
  onAcknowledged,
  onNote,
  onClose,
  reopening,
  reason,
  reasonError,
  onAskReopen,
  onReason,
  onCancelReopen,
  onReopen,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  period: FinancialPeriod;
  today: string;
  checklist: CloseChecklist | undefined;
  block: CloseBlock | null;
  busy: boolean;
  acknowledged: boolean;
  note: string;
  onAcknowledged: (v: boolean) => void;
  onNote: (v: string) => void;
  onClose: () => void;
  reopening: boolean;
  reason: string;
  reasonError: 'REQUIRED' | 'TOO_LONG' | undefined;
  onAskReopen: () => void;
  onReason: (v: string) => void;
  onCancelReopen: () => void;
  onReopen: () => void;
}) {
  const pf = useFormat('Planning', ctx);
  const isOwner = ctx.ws.role === 'OWNER';
  return (
    <>
      <ClosingBody
        f={f}
        pf={pf}
        href={ctx.href}
        period={period}
        today={today}
        checklist={checklist}
        block={block}
        busy={busy}
        canEdit={ctx.canEdit}
        isOwner={isOwner}
        acknowledged={acknowledged}
        note={note}
        onAcknowledged={onAcknowledged}
        onNote={onNote}
        onClose={onClose}
        reopening={reopening}
        reason={reason}
        reasonError={reasonError}
        onAskReopen={onAskReopen}
        onReason={onReason}
        onCancelReopen={onCancelReopen}
        onReopen={onReopen}
      />
      <section aria-labelledby="period-lifecycle-title" style={{ display: 'grid', gap: 'var(--pf-space-3)' }}>
        <h2 id="period-lifecycle-title">{f.t('lifecycle.title')}</h2>
        <div>
          <LifecycleTab
            ctx={ctx}
            path={`periods/${period.id}`}
            refreshKey={period.version}
            stateLabel={(code) => (pf.has(`status.${code}`) ? pf.t(`status.${code}`) : code)}
            idPrefix="period-lifecycle"
            extra={(row) => {
              const closeNo = row.detailRefs['closeNo'];
              if (row.kind !== 'TRANSITION' || closeNo === undefined) return null;
              return (
                <p style={{ margin: '0.25rem 0' }} data-testid="period-lifecycle-close-no">
                  {f.t('lifecycle.closeNo', { closeNo })}{' '}
                  <a href={ctx.href(`/planificacion/periodos/${period.id}/reporte`)}>{f.t('viewReport')}</a>
                </p>
              );
            }}
          />
        </div>
      </section>
    </>
  );
}
