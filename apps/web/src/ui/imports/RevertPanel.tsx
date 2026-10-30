'use client';

import { useState } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { ConfirmPanel, cardStyle, mutedStyle, rowStyle } from '../common/ui';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { blockedOf, blockedReasonKey, revertPath, revertPreviewPath } from './pipeline-logic';
import type { ImportJob, ImportRevertBlocked, ImportRevertPreview } from './types';

/**
 * Deshacer una importación terminada (openspec add-import-pipeline, tarea 7.3; FR-IMPORTS-012): primero la VISTA PREVIA
 * (cuántas transacciones se anulan, cuáles ya estaban anuladas y cuáles están bloqueadas por reconciliación o periodo
 * cerrado), luego la confirmación. Con bloqueadas, el deshacer completo se rechaza; solo el deshacer PARCIAL, pedido
 * de forma explícita, anula las demás y deja la importación «deshecha parcialmente». Nada se borra: cada anulación
 * lleva su reversa.
 */
export function RevertPanel({
  ctx,
  f,
  job,
  onJobChange,
}: {
  ctx: WorkspaceContext;
  f: FormatContext;
  job: ImportJob;
  onJobChange: (job: ImportJob) => void;
}) {
  const [preview, setPreview] = useState<ImportRevertPreview | undefined>();
  const [blockedList, setBlockedList] = useState<readonly ImportRevertBlocked[] | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'ALL' | 'PARTIAL' | undefined>();

  async function openPreview() {
    setLoading(true);
    setProblem(undefined);
    try {
      const r = await ctx.api.get<ImportRevertPreview>(revertPreviewPath(ctx.base, job.id));
      setPreview(r.data);
      setBlockedList(r.data?.blocked);
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setLoading(false);
    }
  }

  async function revert(allowPartial: boolean) {
    setBusy(true);
    setProblem(undefined);
    try {
      const r = await ctx.api.command<ImportJob>(
        'POST',
        revertPath(ctx.base, job.id),
        { allowPartial },
        { ifMatch: job.version },
      );
      setConfirm(undefined);
      setPreview(undefined);
      if (r.data) onJobChange(r.data);
    } catch (err) {
      const p = problemOf(err);
      setConfirm(undefined);
      setProblem(p);
      if (err instanceof FinanceApiError && p.code === 'IMPORT_REVERT_BLOCKED') {
        const list = blockedOf(p);
        if (list.length > 0) setBlockedList(list);
      }
    } finally {
      setBusy(false);
    }
  }

  const blocked = blockedList ?? [];
  return (
    <section
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
      aria-labelledby="revert-title"
      data-testid="import-revert"
    >
      <h3 id="revert-title" style={{ margin: 0 }}>
        {f.t('revert.title')}
      </h3>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {!preview ? (
        <div>
          <button
            type="button"
            disabled={loading}
            data-testid="revert-open"
            onClick={() => void openPreview()}
          >
            {loading ? f.t('loading') : f.t('revert.open')}
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--pf-space-2)' }} data-testid="revert-preview">
          <p style={{ margin: 0 }} data-testid="revert-counts">
            {f.t('revert.counts', {
              toVoid: preview.toVoid,
              already: preview.alreadyVoided,
              blocked: blocked.length,
            })}
          </p>
          {preview.editedAfterImport > 0 ? (
            <p style={{ ...mutedStyle, margin: 0 }} data-testid="revert-edited">
              {f.t('revert.edited', { count: preview.editedAfterImport })}
            </p>
          ) : null}
          {blocked.length > 0 ? (
            <div data-testid="revert-blocked">
              <p style={{ margin: 0 }}>
                <strong>{f.t('revert.blockedTitle', { count: blocked.length })}</strong>
              </p>
              <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {blocked.map((b) => (
                  <li key={b.rowId} data-reason={b.reason}>
                    {f.t('revert.blockedItem', {
                      line: b.lineNumber,
                      reason: f.t(blockedReasonKey(b.reason)),
                    })}
                  </li>
                ))}
              </ul>
              <p style={{ ...mutedStyle, margin: 0 }}>{f.t('revert.partialHint')}</p>
            </div>
          ) : null}
          {confirm ? (
            <ConfirmPanel
              testId="revert-confirm"
              title={confirm === 'ALL' ? f.t('revert.confirmAllTitle') : f.t('revert.confirmPartialTitle')}
              description={
                confirm === 'ALL'
                  ? f.t('revert.confirmAllBody', { count: preview.toVoid })
                  : f.t('revert.confirmPartialBody', { count: preview.toVoid, blocked: blocked.length })
              }
              confirmLabel={f.t('revert.confirm')}
              cancelLabel={f.t('revert.keep')}
              busy={busy}
              onConfirm={() => void revert(confirm === 'PARTIAL')}
              onCancel={() => setConfirm(undefined)}
            />
          ) : (
            <div style={rowStyle}>
              <button
                type="button"
                disabled={busy || blocked.length > 0 || preview.toVoid === 0}
                data-testid="revert-all"
                onClick={() => setConfirm('ALL')}
              >
                {f.t('revert.all')}
              </button>
              {blocked.length > 0 && preview.toVoid > 0 ? (
                <button
                  type="button"
                  disabled={busy}
                  data-testid="revert-partial"
                  onClick={() => setConfirm('PARTIAL')}
                >
                  {f.t('revert.partial')}
                </button>
              ) : null}
              <button type="button" onClick={() => setPreview(undefined)}>
                {f.t('revert.close')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
