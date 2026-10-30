'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { problemMessage } from '../../errors/error-messages';
import { useCatalogs } from '../transactions/catalogs';
import { ConfirmPanel, mutedStyle } from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import {
  applyDecision,
  canApprove,
  hasTransferCandidates,
  importPath,
  pendingDecisionsOf,
  previewPath,
  summaryPath,
} from './logic';
import { PreviewTable, decisionButtonId } from './PreviewTable';
import {
  EMPTY_FILTER,
  bulkEditPath,
  bulkFilterBody,
  bulkSupportsFilter,
  confirmMatchesPath,
  filterIsEmpty,
  filterQuery,
  hasOccurrenceCandidates,
  highConfidenceUniqueCount,
  isDocumentJob,
  profilesPath,
  reevaluatePath,
  ruleOptionsOf,
  statementPath,
  type ReviewFilter,
} from './pipeline-logic';
import { RowDetail, hasPipelineData, type RowPatch } from './RowDetail';
import { PdfReadingPanel } from './PdfReadingPanel';
import { AdvancedFilters, BulkTools, StatementPanel } from './ReviewTools';
import {
  ApproveBar,
  ApproveSummary,
  FilterBar,
  SummaryCounts,
  TotalsCard,
  TransferNotice,
} from './ReviewPanels';
import type {
  ImportJob,
  ImportPreview,
  ImportPreviewRow,
  ImportPreviewSummary,
  ImportRowDecision,
  ImportRowDecisionResult,
} from './types';

/**
 * Paso 3 (Revisar): vista previa paginada ("Cargar más"), filtros por clasificación, decisiones de posibles duplicados
 * (crear de todos modos, omitir, excluir) y aprobación con resumen. "Aprobar" queda deshabilitado mientras haya
 * decisiones pendientes. Cada decisión envía `If-Match` con la versión del IMPORT y guarda la nueva.
 */
export function ReviewStep({
  ctx,
  f,
  job,
  initialSummary,
  onJobChange,
  onApproved,
  actions,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  job: ImportJob;
  initialSummary?: ImportPreviewSummary | undefined;
  onJobChange: (job: ImportJob) => void;
  onApproved: (job: ImportJob) => void;
  /** Acciones adicionales del asistente (cambiar columnas, cancelar). */
  actions?: ReactNode;
}) {
  const { api, base } = ctx;
  const [filter, setFilter] = useState<ReviewFilter>(EMPTY_FILTER);
  const catalogs = useCatalogs(ctx);
  const [rowErrors, setRowErrors] = useState<Readonly<Record<string, string>>>({});
  const [busyAll, setBusyAll] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const pipeline = isDocumentJob(job);
  const [rows, setRows] = useState<readonly ImportPreviewRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportPreviewSummary | undefined>(initialSummary);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busyRow, setBusyRow] = useState<string | undefined>();
  const [refocus, setRefocus] = useState<string | undefined>();
  useEffect(() => {
    if (refocus === undefined) return;
    document.getElementById(refocus)?.focus();
    setRefocus(undefined);
  }, [refocus]);
  const [confirming, setConfirming] = useState(false);
  const [approving, setApproving] = useState(false);
  const [serverPending, setServerPending] = useState<number | undefined>();
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get<ImportPreview>(previewPath(base, job.id, filterQuery(filter)))
      .then((r) => {
        if (cancelled || !r.data) return;
        setRows(r.data.rows);
        setNextCursor(r.data.nextCursor);
        setSummary(r.data.summary);
        setProblem(undefined);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(problemOf(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // La versión del import cambia con cada decisión y la lista NO se recarga por eso (se actualiza la fila).
  }, [api, base, job.id, filter, reload]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const r = await api.get<ImportPreview>(
        previewPath(base, job.id, { ...filterQuery(filter), cursor: nextCursor }),
      );
      if (r.data) {
        const page = r.data;
        setRows((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...page.rows.filter((x) => !seen.has(x.id))];
        });
        setNextCursor(page.nextCursor);
        setSummary(page.summary);
      }
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setLoadingMore(false);
    }
  }, [api, base, job.id, filter, nextCursor]);

  /** Tras un conflicto de versión se vuelve a leer el import y la lista (otra pestaña pudo cambiarlos). */
  const resync = useCallback(async () => {
    try {
      const r = await api.get<ImportJob>(importPath(base, job.id));
      if (r.data) onJobChange(r.data);
    } catch {
      /* el error original ya se muestra */
    }
    setReload((n) => n + 1);
  }, [api, base, job.id, onJobChange]);

  async function decide(row: ImportPreviewRow, decision: ImportRowDecision) {
    if (row.decision === decision) return;
    setBusyRow(row.id);
    setProblem(undefined);
    setServerPending(undefined);
    try {
      const r = await api.command<ImportRowDecisionResult>(
        'PATCH',
        `${importPath(base, job.id)}/rows/${row.id}`,
        { decision },
        { ifMatch: job.version, contentType: 'application/json' },
      );
      const result = r.data;
      if (result) {
        setRows((prev) => applyDecision(prev, result));
        onJobChange({ ...job, version: result.version, counters: result.counters });
        const s = await api.get<ImportPreview>(summaryPath(base, job.id));
        if (s.data) setSummary(s.data.summary);
      }
    } catch (err) {
      setProblem(problemOf(err));
      if (err instanceof FinanceApiError && (err.status === 412 || err.status === 409)) await resync();
    } finally {
      setBusyRow(undefined);
      // El botón sigue montado pero estuvo deshabilitado (pierde el foco): se restituye al volver a habilitarse.
      setRefocus(decisionButtonId(row.id, decision));
    }
  }

  /** Edición de una fila (`PATCH` con `If-Match`): el resultado trae la fila completa y los conteos nuevos. */
  async function edit(row: ImportPreviewRow, patch: RowPatch) {
    setBusyRow(row.id);
    setProblem(undefined);
    setRowErrors((prev) => ({ ...prev, [row.id]: '' }));
    try {
      const r = await api.command<ImportRowDecisionResult>(
        'PATCH',
        `${importPath(base, job.id)}/rows/${row.id}`,
        patch,
        { ifMatch: job.version, contentType: 'application/json' },
      );
      const result = r.data;
      if (result) {
        setRows((prev) => applyDecision(prev, result));
        onJobChange({ ...job, version: result.version, counters: result.counters });
        const s = await api.get<ImportPreview>(summaryPath(base, job.id));
        if (s.data) setSummary(s.data.summary);
      }
    } catch (err) {
      const p = problemOf(err);
      if (
        err instanceof FinanceApiError &&
        (err.status === 412 || err.status === 409) &&
        p.code === 'CONCURRENCY_CONFLICT'
      ) {
        setProblem(p);
        await resync();
      } else {
        setRowErrors((prev) => ({ ...prev, [row.id]: problemMessage(p, ctx.uiLocale) }));
      }
    } finally {
      setBusyRow(undefined);
    }
  }

  /** Acción de revisión sobre todo el import (lote, reglas, coincidencias, saldo): recarga la lista al terminar. */
  async function bulkAction<T>(run: () => Promise<T>, after?: (result: T) => string | undefined) {
    setBusyAll(true);
    setProblem(undefined);
    setNotice(undefined);
    try {
      const result = await run();
      setNotice(after?.(result));
      setReload((n) => n + 1);
    } catch (err) {
      setProblem(problemOf(err));
      if (err instanceof FinanceApiError && (err.status === 412 || err.status === 409)) await resync();
    } finally {
      setBusyAll(false);
    }
  }

  const bulkCategory = (categoryId: string) =>
    bulkAction(
      async () => {
        const r = await api.command<{ updated: number; version: number }>(
          'POST',
          bulkEditPath(base, job.id),
          { filter: bulkFilterBody(filter), set: { categoryId } },
          { ifMatch: job.version },
        );
        if (r.data) onJobChange({ ...job, version: r.data.version });
        return r.data?.updated ?? 0;
      },
      (n) => f.t('bulk.done', { count: n }),
    );

  const reevaluate = () =>
    bulkAction(
      async () => {
        const r = await api.command<ImportJob>('POST', reevaluatePath(base, job.id), undefined, {
          ifMatch: job.version,
        });
        if (r.data) onJobChange(r.data);
      },
      () => f.t('bulk.reevaluated'),
    );

  const confirmMatches = () =>
    bulkAction(
      async () => {
        const r = await api.command<{ confirmed: number; version: number }>(
          'POST',
          confirmMatchesPath(base, job.id),
          { scope: 'HIGH_CONFIDENCE_UNIQUE' },
          { ifMatch: job.version },
        );
        if (r.data) onJobChange({ ...job, version: r.data.version });
        return r.data?.confirmed ?? 0;
      },
      (n) => f.t('bulk.confirmed', { count: n }),
    );

  const saveStatement = (body: {
    closingBalance: { amount: string; currency: string } | null;
    periodTo: string | null;
  }) =>
    bulkAction(async () => {
      const r = await api.command<ImportJob>('PUT', statementPath(base, job.id), body, {
        ifMatch: job.version,
      });
      if (r.data) onJobChange(r.data);
    });

  /** Perfil PDF de la cuenta: fija el diseño y su versión (add-pdf-statement-parser, tarea 6.2). */
  const pinPdfLayout = () =>
    bulkAction(
      async () => {
        const layout = job.pdf?.layout;
        if (!layout) return;
        await api.command('POST', profilesPath(base), {
          name: `${layout.id} v${layout.version}`,
          format: 'PDF',
          accountId: job.accountId,
          options: { version: 'imports.profile.v1', pdfLayout: { id: layout.id, version: layout.version } },
        });
      },
      () => f.t('pdf.pinned'),
    );

  async function approve() {
    setApproving(true);
    setProblem(undefined);
    try {
      const r = await api.command<ImportJob>('POST', `${importPath(base, job.id)}/approve`, undefined, {
        ifMatch: job.version,
      });
      if (r.data) onApproved(r.data);
    } catch (err) {
      const p = problemOf(err);
      setConfirming(false);
      setProblem(p);
      if (p.code === 'IMPORT_REVIEW_INCOMPLETE') {
        setServerPending(pendingDecisionsOf(p));
        setReload((n) => n + 1);
      } else if (err instanceof FinanceApiError && err.status === 412) await resync();
    } finally {
      setApproving(false);
    }
  }

  const pending = summary?.counts.pendingDecisions ?? 0;
  const approvable = canApprove({ canEdit: ctx.canEdit, status: job.status, summary, busy: approving });
  const transactionsHref = ctx.href(`/transacciones?cuenta=${job.accountId}`);

  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-4)' }} data-testid="import-review">
      <TransferNotice f={f} />
      {summary ? (
        <>
          <SummaryCounts summary={summary} f={f} />
          <TotalsCard summary={summary} f={f} />
        </>
      ) : null}
      {hasTransferCandidates(rows) ? (
        <p role="note" style={mutedStyle} data-testid="import-transfer-rows-note">
          {f.t('review.transferRowsNote')}
        </p>
      ) : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {serverPending !== undefined ? (
        <p role="alert" data-testid="import-server-pending">
          {f.t('review.pendingFromServer', { count: serverPending })}
        </p>
      ) : null}
      {pipeline && ctx.canEdit ? (
        <BulkTools
          f={f}
          categories={catalogs.categories}
          groups={catalogs.groups}
          filterLabel={
            filterIsEmpty(filter)
              ? f.t('filters.all', { count: summary?.counts.rows ?? 0 })
              : f.t('bulk.currentFilter')
          }
          filterSupported={bulkSupportsFilter(filter)}
          highConfidence={highConfidenceUniqueCount(rows)}
          busy={busyAll}
          onBulkCategory={(id) => void bulkCategory(id)}
          onReevaluate={() => void reevaluate()}
          onConfirmMatches={() => void confirmMatches()}
        />
      ) : null}
      {pipeline ? (
        <PdfReadingPanel
          job={job}
          f={f}
          busy={busyAll}
          {...(ctx.canEdit ? { onPinLayout: () => void pinPdfLayout() } : {})}
        />
      ) : null}
      {pipeline ? (
        <StatementPanel
          f={f}
          job={job}
          summary={summary}
          currency={catalogs.accounts.find((a) => a.id === job.accountId)?.currency ?? ctx.ws.baseCurrency}
          canEdit={ctx.canEdit}
          busy={busyAll}
          onSave={(body) => void saveStatement(body)}
        />
      ) : null}
      {notice ? (
        <p role="status" data-testid="import-notice">
          {notice}
        </p>
      ) : null}
      {summary ? (
        <FilterBar
          summary={summary}
          f={f}
          value={filter.classification}
          onChange={(classification) => setFilter({ ...filter, classification })}
        />
      ) : null}
      {pipeline ? (
        <AdvancedFilters
          f={f}
          value={filter}
          rules={ruleOptionsOf(rows)}
          onChange={(patch) => setFilter({ ...filter, ...patch })}
        />
      ) : null}
      {pipeline && hasOccurrenceCandidates(rows) ? (
        <p style={mutedStyle} data-testid="import-matches-note">
          {f.t('detail.commitmentsNote')}
        </p>
      ) : null}

      {loading ? (
        <p aria-busy="true">{f.t('loading')}</p>
      ) : rows.length === 0 ? (
        <p style={mutedStyle} data-testid="import-no-rows">
          {f.t('review.empty')}
        </p>
      ) : (
        <PreviewTable
          rows={rows}
          f={f}
          status={job.status}
          canEdit={ctx.canEdit}
          busyRowId={busyRow}
          onDecide={(row, decision) => void decide(row, decision)}
          renderExtras={
            pipeline
              ? (row) =>
                  hasPipelineData(row) ? (
                    <RowDetail
                      row={row}
                      f={f}
                      job={job}
                      canEdit={ctx.canEdit}
                      catalogs={catalogs}
                      accountId={job.accountId}
                      accountCurrency={
                        catalogs.accounts.find((a) => a.id === job.accountId)?.currency ?? ctx.ws.baseCurrency
                      }
                      busy={busyRow === row.id}
                      error={rowErrors[row.id] || undefined}
                      onEdit={(r, patch) => void edit(r, patch)}
                    />
                  ) : null
              : undefined
          }
        />
      )}
      {nextCursor ? (
        <div>
          <button
            type="button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
            data-testid="import-load-more"
          >
            {loadingMore ? f.t('loading') : f.t('review.loadMore')}
          </button>
        </div>
      ) : null}

      {confirming && summary && ctx.canEdit ? (
        <ConfirmPanel
          testId="import-approve-confirm"
          title={f.t('approve.title')}
          description={f.t('approve.description')}
          confirmLabel={f.t('approve.confirm')}
          cancelLabel={f.t('approve.cancel')}
          busy={approving}
          onConfirm={() => void approve()}
          onCancel={() => setConfirming(false)}
        >
          <ApproveSummary summary={summary} f={f} transactionsHref={transactionsHref} />
        </ConfirmPanel>
      ) : (
        <ApproveBar
          f={f}
          canEdit={ctx.canEdit}
          approvable={approvable}
          pending={pending}
          toCreate={summary?.counts.toCreate ?? 0}
          onApprove={() => setConfirming(true)}
          actions={actions}
        />
      )}
    </div>
  );
}
