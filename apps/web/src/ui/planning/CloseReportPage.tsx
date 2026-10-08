'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { cardStyle, inputStyle, mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { formatInstant } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { LifecycleExportActions } from '../lifecycle/LifecycleTab';
import { BFF_API } from '../session-context';
import { CloseDiffView, CloseReportView } from './CloseReportView';
import {
  defaultComparison,
  exportPath,
  versionsNewestFirst,
  type CloseReport,
  type CloseSnapshotDiff,
  type CloseSnapshotSummary,
} from './closing-logic';
import { periodName, type FinancialPeriod } from './logic';
import { PlanningNav } from './PlanningNav';

export function CloseReportPage({ periodId }: { periodId: string }) {
  return <WithWorkspace>{(ctx) => <CloseReport_ ctx={ctx} periodId={periodId} />}</WithWorkspace>;
}

/** Etiqueta de una versión en el selector: "Versión 2 (vigente) · 03/11/2026 10:30". */
export function versionLabel(v: CloseSnapshotSummary, f: FormatContext): string {
  return f.t('report.versionOption', {
    closeNo: v.closeNo,
    current: v.isCurrent ? ` ${f.t('report.currentTag')}` : '',
    at: formatInstant(v.closedAt, f.locale, f.timeZone),
  });
}

/**
 * Pantalla "Reporte de cierre" (`/planificacion/periodos/{id}/reporte`, openspec add-month-closing 6.2): la versión
 * vigente y las anteriores del snapshot (selector de versión), KPIs con variación respecto al periodo anterior, saldos
 * por cuenta con su base de conciliación, presupuesto vs real, comparación entre dos versiones y exportación CSV/PDF de
 * la versión elegida. Un periodo nunca cerrado responde 404 y se informa sin inventar montos.
 */
function CloseReport_({ ctx, periodId }: { ctx: WorkspaceContext; periodId: string }) {
  const f = useFormat('Closing', ctx);
  const nav = useFormat('Budgets', ctx);
  const pf = useFormat('Planning', ctx);
  const [period, setPeriod] = useState<FinancialPeriod | undefined>();
  const [closeNo, setCloseNo] = useState<number | undefined>();
  const [report, setReport] = useState<CloseReport | undefined>();
  const [never, setNever] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [versions, setVersions] = useState<readonly CloseSnapshotSummary[]>([]);
  const [from, setFrom] = useState<number | undefined>();
  const [to, setTo] = useState<number | undefined>();
  const [diff, setDiff] = useState<CloseSnapshotDiff | undefined>();
  const [diffProblem, setDiffProblem] = useState<ApiProblemBody | undefined>();
  const versionId = useId();
  const fromId = useId();
  const toId = useId();

  useEffect(() => {
    ctx.api
      .get<FinancialPeriod>(`${ctx.base}/periods/${periodId}`)
      .then((r) => setPeriod(r.data))
      .catch((err: unknown) => setProblem(problemOf(err)));
  }, [ctx, periodId]);

  useEffect(() => {
    let cancelled = false;
    setReport(undefined);
    ctx.api
      .get<CloseReport>(
        `${ctx.base}/periods/${periodId}/close-report${closeNo === undefined ? '' : `?closeNo=${closeNo}`}`,
      )
      .then((r) => {
        if (cancelled || !r.data) return;
        setReport(r.data);
        setNever(false);
        setVersions(r.data.versions);
        setFrom((cur) => cur ?? defaultComparison(r.data!.versions)?.from);
        setTo((cur) => cur ?? defaultComparison(r.data!.versions)?.to);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof FinanceApiError && err.status === 404) setNever(true);
        else setProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, periodId, closeNo]);

  useEffect(() => {
    if (from === undefined || to === undefined || from === to) {
      setDiff(undefined);
      return;
    }
    let cancelled = false;
    setDiffProblem(undefined);
    ctx.api
      .get<CloseSnapshotDiff>(`${ctx.base}/periods/${periodId}/close-snapshots/compare?from=${from}&to=${to}`)
      .then((r) => {
        if (!cancelled) setDiff(r.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setDiffProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, periodId, from, to]);

  const sorted = useMemo(() => versionsNewestFirst(versions), [versions]);
  const shown = report?.snapshot.closeNo;
  const accountName = useMemo(() => {
    const names = new Map(report?.snapshot.balances.map((b) => [b.accountId, b.accountName]));
    return (id: string) => names.get(id) ?? id.slice(-8);
  }, [report]);

  return (
    <section aria-labelledby="report-title" style={pageStyle}>
      <PlanningNav f={nav} current="closing" />
      <h1 id="report-title">{f.t('report.title')}</h1>
      {period ? (
        <p style={mutedStyle} data-testid="report-period">
          {f.t('report.period', {
            name: periodName(period.label, f.locale),
            status: pf.t(`status.${period.status}`),
          })}
        </p>
      ) : null}
      <p style={{ margin: 0 }}>
        <a href={ctx.href(`/planificacion/periodos/${periodId}/cierre`)}>{f.t('report.backToClosing')}</a>
      </p>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {never ? (
        <p style={mutedStyle} data-testid="report-never-closed">
          {f.t('report.neverClosed')}
        </p>
      ) : !report ? (
        problem ? null : (
          <p aria-busy="true">{f.t('report.loading')}</p>
        )
      ) : (
        <>
          <div style={{ ...cardStyle, ...rowStyle, alignItems: 'end' }}>
            <div style={{ display: 'grid', gap: 'var(--pf-space-1)', minWidth: 0 }}>
              <label htmlFor={versionId}>{f.t('report.version')}</label>
              <select
                id={versionId}
                style={inputStyle}
                value={shown}
                onChange={(e) => setCloseNo(Number(e.target.value))}
                data-testid="report-version"
              >
                {sorted.map((v) => (
                  <option key={v.closeNo} value={v.closeNo}>
                    {versionLabel(v, f)}
                  </option>
                ))}
              </select>
            </div>
            <LifecycleExportActions
              href={(format) => `${BFF_API}${exportPath(ctx.base, periodId, format, shown)}`}
              label={f.t('report.export.label')}
              csv={f.t('report.export.csv')}
              pdf={f.t('report.export.pdf')}
              idPrefix="close-report"
            />
          </div>
          <CloseReportView report={report} f={f} href={ctx.href} />
          {sorted.length >= 2 ? (
            <section
              aria-labelledby="report-compare-title"
              style={{ display: 'grid', gap: 'var(--pf-space-3)' }}
            >
              <h2 id="report-compare-title">{f.t('diff.title')}</h2>
              <div style={rowStyle}>
                <div style={{ display: 'grid', gap: 'var(--pf-space-1)', minWidth: 0 }}>
                  <label htmlFor={fromId}>{f.t('diff.from')}</label>
                  <select
                    id={fromId}
                    style={inputStyle}
                    value={from}
                    onChange={(e) => setFrom(Number(e.target.value))}
                    data-testid="diff-from"
                  >
                    {sorted.map((v) => (
                      <option key={v.closeNo} value={v.closeNo}>
                        {versionLabel(v, f)}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'grid', gap: 'var(--pf-space-1)', minWidth: 0 }}>
                  <label htmlFor={toId}>{f.t('diff.to')}</label>
                  <select
                    id={toId}
                    style={inputStyle}
                    value={to}
                    onChange={(e) => setTo(Number(e.target.value))}
                    data-testid="diff-to"
                  >
                    {sorted.map((v) => (
                      <option key={v.closeNo} value={v.closeNo}>
                        {versionLabel(v, f)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {from === to ? <p style={mutedStyle}>{f.t('diff.same')}</p> : null}
              {diffProblem ? <ProblemMessage problem={diffProblem} locale={ctx.uiLocale} /> : null}
              {diff ? <CloseDiffView diff={diff} accountName={accountName} f={f} /> : null}
            </section>
          ) : (
            <p style={mutedStyle} data-testid="report-single-version">
              {f.t('diff.singleVersion')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
