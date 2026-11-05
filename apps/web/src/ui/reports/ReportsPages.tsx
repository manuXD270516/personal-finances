'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { mutedStyle, pageStyle } from '../common/ui';
import { problemOf, listAll, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { todayIn } from '../common/dates';
import { BFF_API } from '../session-context';
import { REPORT_CHART_CSS } from './ReportChart';
import { ConversionBlock, DrillDownPanel, FiltersBar, REPORTS_CSS } from './ReportParts';
import {
  AccountHistoryView,
  BudgetVsActualView,
  CashFlowView,
  ExpensesByCategoryView,
  IncomeExpensesView,
  NetWorthReportView,
} from './ReportViews';
import {
  defaultFilters,
  drillExportPath,
  drillPath,
  exportApiPath,
  filterError,
  filtersFromSearch,
  filtersToParams,
  reportApiPath,
  REPORT_SLUGS,
  slugOf,
  type CatalogEntry,
  type DrillCell,
  type DrillDownPage,
  type ReportFilters,
  type ReportMeta,
  type ReportSlug,
} from './logic';

/** `/reportes`: catálogo de los 16 reportes con su disponibilidad (FR-REPORTING-008). Solo lectura. */
export function ReportsCatalogPage() {
  return <WithWorkspace>{(ctx) => <Catalog ctx={ctx} />}</WithWorkspace>;
}

function Catalog({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Reports', ctx);
  const [entries, setEntries] = useState<readonly CatalogEntry[] | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<{ reports: CatalogEntry[] }>(`${ctx.base}/reports/catalog`)
      .then((r) => !cancelled && setEntries(r.data?.reports ?? []))
      .catch((err: unknown) => !cancelled && setProblem(problemOf(err)));
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base]);
  return (
    <section style={pageStyle} aria-labelledby="reports-title" data-testid="reports-catalog">
      <style>{REPORTS_CSS}</style>
      <header>
        <h1 id="reports-title">{f.t('title')}</h1>
        <p style={mutedStyle}>{f.t('subtitle')}</p>
      </header>
      {problem && <ProblemMessage problem={problem} locale={ctx.uiLocale} />}
      {!entries && !problem && <p aria-busy="true">{f.t('loading')}</p>}
      {entries && (
        <ul className="pf-rp-catalog">
          {entries.map((e) => {
            const slug = slugOf(e.reportId);
            const href = slug ? ctx.href(`/reportes/${slug}`) : e.viewPath ? ctx.href(e.viewPath) : null;
            return (
              <li key={e.reportId} className="pf-rp-card" data-testid="catalog-entry" data-status={e.status}>
                <h2 style={{ margin: 0, fontSize: 'var(--pf-text-lg)' }}>
                  {e.number}. {f.t(`names.${e.reportId}`)}
                </h2>
                <p style={mutedStyle}>{f.t(`purposes.${e.reportId}`)}</p>
                <span className="pf-rp-status">{f.t(`catalog.status.${e.status}`)}</span>
                {e.status === 'AVAILABLE' && href && <a href={href}>{f.t('catalog.open')}</a>}
                {e.status === 'PARTIAL' && href && <a href={href}>{f.t('catalog.partial')}</a>}
                {e.status === 'PLANNED' && <small>{f.t('catalog.planned', { phase: e.phase })}</small>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** `/reportes/<slug>`: un reporte con barra de filtros en la URL, gráfico + tabla, drill-down y exportación CSV. */
export function ReportPage({ slug }: { slug: ReportSlug }) {
  return <WithWorkspace>{(ctx) => <Report ctx={ctx} slug={slug} />}</WithWorkspace>;
}

function Report({ ctx, slug }: { ctx: WorkspaceContext; slug: ReportSlug }) {
  const f = useFormat('Reports', ctx);
  const search = useSearchParams();
  const today = useMemo(() => todayIn(ctx.timeZone), [ctx.timeZone]);
  const defaults = useMemo(() => defaultFilters(today), [today]);
  const [applied, setApplied] = useState<ReportFilters>(() =>
    filtersFromSearch(new URLSearchParams(search?.toString() ?? ''), today),
  );
  const [draft, setDraft] = useState<ReportFilters>(applied);
  const [data, setData] = useState<unknown>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [accounts, setAccounts] = useState<readonly { id: string; name: string }[]>([]);
  const [cell, setCell] = useState<DrillCell | undefined>();
  const [drill, setDrill] = useState<DrillDownPage | undefined>();
  const [drillProblem, setDrillProblem] = useState<ApiProblemBody | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);

  const needsAccount = slug === 'historial-de-saldo';
  useEffect(() => {
    if (!needsAccount) return;
    let cancelled = false;
    listAll<{ id: string; name: string }>(ctx.api, `${ctx.base}/accounts`)
      .then((rows) => !cancelled && setAccounts(rows.map((a) => ({ id: a.id, name: a.name }))))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, needsAccount]);

  const ready = !filterError(applied) && (!needsAccount || applied.accountId !== '');
  useEffect(() => {
    if (!ready) return undefined;
    let cancelled = false;
    setData(undefined);
    setProblem(undefined);
    ctx.api
      .get<unknown>(reportApiPath(ctx.base, slug, applied, defaults))
      .then((r) => !cancelled && setData(r.data))
      .catch((err: unknown) => !cancelled && setProblem(problemOf(err)));
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, slug, applied, defaults, ready]);

  const apply = useCallback(() => {
    setApplied(draft);
    setCell(undefined);
    window.history.replaceState(null, '', `?${filtersToParams(draft, defaults).toString()}`);
  }, [draft, defaults]);

  const openDrill = useCallback(
    (next: DrillCell) => {
      setCell(next);
      setDrill(undefined);
      setDrillProblem(undefined);
      ctx.api
        .get<DrillDownPage>(drillPath(ctx.base, next, applied, defaults))
        .then((r) => setDrill(r.data))
        .catch((err: unknown) => setDrillProblem(problemOf(err)));
    },
    [ctx.api, ctx.base, applied, defaults],
  );
  const moreDrill = useCallback(() => {
    if (!cell || !drill?.nextCursor) return;
    setLoadingMore(true);
    ctx.api
      .get<DrillDownPage>(drillPath(ctx.base, cell, applied, defaults, drill.nextCursor))
      .then((r) => r.data && setDrill({ ...r.data, rows: [...drill.rows, ...r.data.rows] }))
      .catch((err: unknown) => setDrillProblem(problemOf(err)))
      .finally(() => setLoadingMore(false));
  }, [ctx.api, ctx.base, cell, drill, applied, defaults]);

  const show = {
    // El presupuesto vs real agrupa siempre por periodo financiero (la API rechaza el mes calendario).
    grouping: slug !== 'historial-de-saldo' && slug !== 'presupuesto-vs-real',
    compare: slug === 'ingresos-gastos' || slug === 'gastos-por-categoria' || slug === 'flujo-de-caja',
    rolling: slug === 'ingresos-gastos',
    conversion: slug === 'ingresos-gastos' || slug === 'gastos-por-categoria',
    lists: slug === 'ingresos-gastos' || slug === 'gastos-por-categoria',
    ...(slug === 'ingresos-gastos' ? { granularity: ['PERIOD', 'WEEK'] as const } : {}),
    ...(slug === 'patrimonio' ? { granularity: ['PERIOD', 'DAY'] as const } : {}),
    ...(slug === 'gastos-por-categoria' ? { topN: true } : {}),
    ...(needsAccount ? { account: accounts } : {}),
  };
  const body = (() => {
    if (!data) return null;
    const props = { f, onDrill: openDrill };
    switch (slug) {
      case 'ingresos-gastos':
        return <IncomeExpensesView {...props} data={data as never} />;
      case 'gastos-por-categoria':
        return <ExpensesByCategoryView {...props} data={data as never} />;
      case 'presupuesto-vs-real':
        return <BudgetVsActualView {...props} data={data as never} />;
      case 'flujo-de-caja':
        return <CashFlowView {...props} data={data as never} />;
      case 'historial-de-saldo':
        return <AccountHistoryView {...props} data={data as never} />;
      default:
        return <NetWorthReportView {...props} data={data as never} />;
    }
  })();
  const meta = data ? (data as { meta: ReportMeta }).meta : undefined;
  const id = REPORT_SLUGS[slug].id;
  return (
    <section style={pageStyle} aria-labelledby="report-title" data-testid={`report-${slug}`}>
      <style>{REPORTS_CSS + REPORT_CHART_CSS}</style>
      <header>
        <h1 id="report-title">{f.t(`names.${id}`)}</h1>
        <p style={mutedStyle}>{f.t(`purposes.${id}`)}</p>
        <p>
          <a href={ctx.href('/reportes')}>{f.t('backToCatalog')}</a>
        </p>
      </header>
      <FiltersBar
        f={f}
        draft={draft}
        onDraft={setDraft}
        onApply={apply}
        currencies={ctx.currencies.filter((c) => c.enabled !== false).map((c) => c.code)}
        show={show}
      />
      {needsAccount && applied.accountId === '' && <p>{f.t('filters.accountPick')}</p>}
      {problem && <ProblemMessage problem={problem} locale={ctx.uiLocale} />}
      {ready && !data && !problem && (
        <p aria-busy="true" data-testid="report-loading">
          {f.t('loading')}
        </p>
      )}
      {meta && (
        <div className="pf-rp-layout" data-drill={cell ? 'open' : 'closed'}>
          <div className="pf-rp">
            {body}
            <ConversionBlock meta={meta} f={f} />
            <p>
              <a
                className="pf-rp-btn"
                href={`${BFF_API}${exportApiPath(ctx.base, slug, applied, defaults)}`}
                download
                data-testid="report-export"
              >
                {f.t('export')}
              </a>
            </p>
          </div>
          {cell && (
            <DrillDownPanel
              f={f}
              cell={cell}
              page={drill}
              loadingMore={loadingMore}
              hasError={drillProblem ? <ProblemMessage problem={drillProblem} locale={ctx.uiLocale} /> : null}
              transactionHref={(tid) => ctx.href(`/transacciones/${tid}`)}
              accountHistoryHref={(id, from, to) =>
                ctx.href(`/reportes/historial-de-saldo?from=${from}&to=${to}&historyAccount=${id}`)
              }
              exportHref={`${BFF_API}${drillExportPath(ctx.base, cell, applied, defaults)}`}
              onMore={moreDrill}
              onClose={() => setCell(undefined)}
            />
          )}
        </div>
      )}
    </section>
  );
}
