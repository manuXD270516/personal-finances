'use client';

import { useCallback, useEffect, useState } from 'react';
import { type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { cardStyle, mutedStyle, rowStyle, warningStyle } from '../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { targetName, type TargetNames } from './BudgetLinesTable';
import { SpecSummary } from './TemplateLinesTable';
import {
  groupByPeriod,
  hasPropagationChanges,
  type PropagationPreview,
  type PropagationSource,
} from './template-logic';

/**
 * Vista previa de una propagación a meses futuros (openspec add-budget-templates 6.2): por periodo en borrador, las
 * líneas que cambiarán (agregar, cambiar de X a Y, quitar) y las que NO se tocan por estar modificadas a mano. Pura:
 * sin estado ni red.
 */
export function PropagationView({
  preview,
  names,
  f,
  fb,
}: {
  preview: PropagationPreview;
  names: TargetNames;
  f: FormatContext;
  fb: FormatContext;
}) {
  const groups = groupByPeriod(preview);
  const v = preview.newVersionPreview;
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-3)' }} data-testid="propagation-preview">
      <p style={{ margin: 0 }}>
        {f.t('propagation.newVersion', {
          versionNo: v.versionNo,
          added: v.added,
          updated: v.updated,
          removed: v.removed,
        })}
      </p>
      {groups.length === 0 ? (
        <p style={mutedStyle} data-testid="propagation-no-periods">
          {f.t('propagation.noPeriods')}
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--pf-space-3)' }}>
          {groups.map(({ period, changes, conflicts }) => (
            <li
              key={period.budgetId}
              style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
              data-testid="propagation-period"
              data-period={period.periodLabel}
            >
              <h4 style={{ margin: 0 }}>{period.periodLabel}</h4>
              {changes.length === 0 && conflicts.length === 0 ? (
                <p style={mutedStyle}>{f.t('propagation.noChangesInPeriod')}</p>
              ) : null}
              {changes.length > 0 ? (
                <ul aria-label={f.t('propagation.changesLabel', { period: period.periodLabel })}>
                  {changes.map((c) => (
                    <li
                      key={`${c.action}:${c.target.kind}:${c.target.id}`}
                      data-testid="propagation-change"
                      data-action={c.action}
                    >
                      <strong>{targetName(names, c.target.kind, c.target.id)}</strong>{' '}
                      <span>{f.t(`propagation.action.${c.action}`)}</span>
                      {': '}
                      {c.from ? <SpecSummary spec={c.from} fb={fb} /> : null}
                      {c.from && c.to ? <span aria-label={f.t('propagation.to')}> → </span> : null}
                      {c.to ? <SpecSummary spec={c.to} fb={fb} /> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {conflicts.length > 0 ? (
                <ul
                  aria-label={f.t('propagation.conflictsLabel', { period: period.periodLabel })}
                  style={warningStyle}
                >
                  {conflicts.map((c) => (
                    <li
                      key={`${c.action}:${c.target.kind}:${c.target.id}`}
                      data-testid="propagation-conflict"
                      data-reason={c.reason}
                    >
                      <span aria-hidden="true">⚠</span>{' '}
                      <strong>{targetName(names, c.target.kind, c.target.id)}</strong>:{' '}
                      {f.t(`propagation.reason.${c.reason}`)}
                      {c.current ? (
                        <>
                          {' '}
                          ({f.t('propagation.keeps')} <SpecSummary spec={c.current} fb={fb} />)
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Diálogo "Aplicar a meses futuros": pide la vista previa (sin efectos), la muestra y, al confirmar, publica la versión
 * nueva del template y actualiza los planes alcanzados. Si algo cambió desde la vista previa
 * (`BUDGET_PROPAGATION_STALE`) ofrece recargarla (nada se aplicó).
 */
export function PropagationPanel({
  ctx,
  source,
  names,
  onClose,
}: {
  ctx: WorkspaceContext;
  source: PropagationSource;
  names: TargetNames;
  /** `applied` = true cuando se confirmó (la pantalla recarga sus datos). */
  onClose: (applied: boolean) => void;
}) {
  const f = useFormat('Templates', ctx);
  const fb = useFormat('Budgets', ctx);
  const [preview, setPreview] = useState<PropagationPreview | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(() => {
    setPreview(undefined);
    setProblem(undefined);
    ctx.api
      .command<PropagationPreview>(
        'POST',
        `${ctx.base}/budget-propagations/preview`,
        { source },
        { idempotent: false },
      )
      .then((r) => setPreview(r.data))
      .catch((err: unknown) => setProblem(problemOf(err)));
  }, [ctx, source]);
  useEffect(load, [load]);

  async function confirm() {
    if (!preview) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await ctx.api.command('POST', `${ctx.base}/budget-propagations/confirm`, {
        source,
        token: preview.token,
      });
      setDone(true);
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const stale = problem?.code === 'BUDGET_PROPAGATION_STALE';
  return (
    <section
      aria-labelledby="propagation-title"
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-3)' }}
      data-testid="propagation-panel"
    >
      <h3 id="propagation-title" style={{ margin: 0 }}>
        {f.t('propagation.title')}
      </h3>
      <p style={mutedStyle}>{f.t('propagation.intro')}</p>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {done ? (
        <>
          <p role="status" data-testid="propagation-done">
            {f.t('propagation.done')}
          </p>
          <div style={rowStyle}>
            <button type="button" onClick={() => onClose(true)} data-testid="propagation-close">
              {f.t('propagation.close')}
            </button>
          </div>
        </>
      ) : preview === undefined && !problem ? (
        <p aria-busy="true">{f.t('propagation.loading')}</p>
      ) : (
        <>
          {preview ? <PropagationView preview={preview} names={names} f={f} fb={fb} /> : null}
          <div style={rowStyle}>
            {stale ? (
              <button type="button" onClick={load} data-testid="propagation-reload">
                {f.t('propagation.reload')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void confirm()}
                disabled={busy || !preview || !hasPropagationChanges(preview)}
                data-testid="propagation-confirm"
              >
                {f.t('propagation.confirm')}
              </button>
            )}
            <button
              type="button"
              onClick={() => onClose(false)}
              disabled={busy}
              data-testid="propagation-cancel"
            >
              {f.t('propagation.cancel')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
