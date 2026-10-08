'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { todayIn } from '../common/dates';
import { cardStyle, mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import type { Page } from '../common/types';
import { defaultPeriodId, formatBusinessDate, periodName, type FinancialPeriod } from './logic';
import { PeriodSelector } from './PeriodSelector';
import { PeriodsListView } from './PeriodsListView';

/** Todas las páginas de periodos (la API admite `limit` ≤ 100; `listAll` usa 200). */
async function loadPeriods(ctx: WorkspaceContext): Promise<FinancialPeriod[]> {
  const out: FinancialPeriod[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i += 1) {
    const q = new URLSearchParams({ limit: '100' });
    if (cursor) q.set('cursor', cursor);
    const r = await ctx.api.get<Page<FinancialPeriod>>(`${ctx.base}/periods?${q.toString()}`);
    out.push(...(r.data?.data ?? []));
    if (!r.data?.page.hasMore || !r.data.page.nextCursor) break;
    cursor = r.data.page.nextCursor;
  }
  return out;
}

export function PeriodsPage() {
  return <WithWorkspace>{(ctx) => <Periods ctx={ctx} />}</WithWorkspace>;
}

/**
 * Pantalla "Periodos" (`/planificacion/periodos`, openspec add-financial-periods 6.1): calendario financiero del
 * workspace con el selector de periodo (6.2) y la activación manual. "Hoy" es la fecha en la zona del workspace
 * (RISK-020). Los periodos se crean de forma asíncrona (docs/33 D64): si aún no hay, un EDITOR puede pedirlos.
 */
function Periods({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Planning', ctx);
  const today = todayIn(ctx.timeZone);
  const [periods, setPeriods] = useState<readonly FinancialPeriod[] | undefined>();
  const [selected, setSelected] = useState<string | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | undefined>();

  const load = useCallback(() => {
    loadPeriods(ctx)
      .then(setPeriods)
      .catch((err: unknown) => {
        setProblem(problemOf(err));
        setPeriods([]);
      });
  }, [ctx]);
  useEffect(load, [load]);

  async function activate(p: FinancialPeriod) {
    setBusyId(p.id);
    setProblem(undefined);
    try {
      await ctx.api.command('POST', `${ctx.base}/periods/${p.id}/activate`, undefined, {
        ifMatch: p.version,
        idempotent: false,
      });
      setStatus(f.t('activated', { name: periodName(p.label, f.locale) }));
      load();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusyId(undefined);
    }
  }

  async function ensure() {
    setBusyId('ensure');
    setProblem(undefined);
    try {
      await ctx.api.command('POST', `${ctx.base}/periods`, { through: today }, { idempotent: false });
      setStatus(f.t('created'));
      load();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusyId(undefined);
    }
  }

  const currentId = periods ? (selected ?? defaultPeriodId(periods, today)) : undefined;
  const current = periods?.find((p) => p.id === currentId);
  return (
    <section aria-labelledby="periods-title" style={pageStyle}>
      <h1 id="periods-title">{f.t('title')}</h1>
      <p style={mutedStyle}>{f.t('intro', { today: formatBusinessDate(today) })}</p>
      {status ? <p role="status">{status}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {periods === undefined ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : (
        <>
          {periods.length > 0 ? (
            <div
              style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
              data-testid="period-summary"
            >
              <PeriodSelector periods={periods} today={today} value={selected} onChange={setSelected} f={f} />
              {current ? (
                <p style={{ margin: 0 }} aria-live="polite">
                  {f.t('summary', {
                    name: periodName(current.label, f.locale),
                    from: formatBusinessDate(current.periodStart),
                    to: formatBusinessDate(current.periodEnd),
                    status: f.t(`status.${current.status}`),
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
          <PeriodsListView
            periods={periods}
            today={today}
            canEdit={ctx.canEdit}
            f={f}
            busyId={busyId}
            onActivate={(p) => void activate(p)}
          />
          {periods.length === 0 && ctx.canEdit ? (
            <div style={rowStyle}>
              <button type="button" onClick={() => void ensure()} disabled={busyId === 'ensure'}>
                {f.t('create')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
