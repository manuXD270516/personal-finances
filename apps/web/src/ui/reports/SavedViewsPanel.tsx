'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { Field, formStyle, inputStyle, mutedStyle, rowStyle, warningStyle } from '../common/ui';
import type { FormatContext } from '../dashboard/types';
import { problemOf, type WorkspaceContext } from '../common/workspace';
import {
  RANGELESS_SLUGS,
  REPORT_SLUGS,
  savedViewParams,
  type OpenedSavedView,
  type ReportFilters,
  type ReportSlug,
  type SavedViewLite,
} from './logic';

type RangeChoice = 'FIXED' | 'LAST_3' | 'LAST_6' | 'LAST_12';

/**
 * Vistas guardadas del reporte (FR-REPORTING-019): menú en la barra de filtros para guardar la combinación aplicada con un
 * nombre y un rango fijo o relativo, y para abrir, renombrar o borrar las del propio usuario. Las vistas son personales
 * (la API solo devuelve las del usuario) y guardan ids y filtros, nunca cifras. Al abrir una vista con un filtro
 * archivado o inexistente se muestra el aviso sin fallar.
 */
export function SavedViewsPanel(p: {
  readonly ctx: WorkspaceContext;
  readonly f: FormatContext;
  readonly slug: ReportSlug;
  readonly applied: ReportFilters;
  readonly onOpen: (query: OpenedSavedView['query']) => void;
}) {
  const { ctx, f, slug } = p;
  const reportId = REPORT_SLUGS[slug].id;
  const [views, setViews] = useState<readonly SavedViewLite[]>([]);
  const [name, setName] = useState('');
  const [range, setRange] = useState<RangeChoice>('FIXED');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [warnings, setWarnings] = useState<OpenedSavedView['warnings']>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    ctx.api
      .get<{ data: SavedViewLite[] }>(`${ctx.base}/reports/saved-views?reportId=${reportId}`)
      .then((r) => setViews(r.data?.data ?? []))
      .catch((err: unknown) => setProblem(problemOf(err)));
  }, [ctx.api, ctx.base, reportId]);
  useEffect(() => {
    reload();
  }, [reload]);

  const run = async (action: () => Promise<void>, done?: string) => {
    setBusy(true);
    setProblem(undefined);
    setStatus(undefined);
    try {
      await action();
      if (done) setStatus(done);
      reload();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      await ctx.api.command('POST', `${ctx.base}/reports/saved-views`, {
        reportId,
        name: name.trim(),
        params: savedViewParams(p.applied, RANGELESS_SLUGS.includes(slug) ? 'FIXED' : range, slug),
      });
      setName('');
    }, f.t('views.saved'));

  const open = (id: string) =>
    run(async () => {
      const r = await ctx.api.get<OpenedSavedView>(`${ctx.base}/reports/saved-views/${id}`);
      if (!r.data) return;
      setWarnings(r.data.warnings);
      p.onOpen(r.data.query);
    });

  const rename = () =>
    run(async () => {
      const target = views.find((v) => v.id === renaming?.id);
      if (!renaming || !target) return;
      await ctx.api.command(
        'PATCH',
        `${ctx.base}/reports/saved-views/${target.id}`,
        { name: renaming.name.trim() },
        { ifMatch: target.version },
      );
      setRenaming(undefined);
    });

  const remove = (id: string) =>
    run(async () => {
      await ctx.api.command('DELETE', `${ctx.base}/reports/saved-views/${id}`, undefined);
    }, f.t('views.deleted'));

  return (
    <section style={formStyle} aria-label={f.t('views.title')} data-testid="saved-views">
      <h2 style={{ margin: 0, fontSize: 'var(--pf-text-lg)' }}>{f.t('views.title')}</h2>
      {views.length === 0 ? (
        <p style={mutedStyle}>{f.t('views.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--pf-space-2)' }}>
          {views.map((v) => (
            <li key={v.id} style={rowStyle} data-testid="saved-view">
              <button
                type="button"
                className="pf-rp-link"
                aria-label={f.t('views.open', { name: v.name })}
                disabled={busy}
                onClick={() => void open(v.id)}
                data-testid="saved-view-open"
              >
                {v.name}
              </button>
              <button
                type="button"
                aria-label={f.t('views.rename', { name: v.name })}
                disabled={busy}
                onClick={() => setRenaming({ id: v.id, name: v.name })}
              >
                {f.t('views.renameDo')}
              </button>
              <button
                type="button"
                aria-label={f.t('views.delete', { name: v.name })}
                disabled={busy}
                onClick={() => void remove(v.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {renaming && (
        <form
          style={rowStyle}
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <Field label={f.t('views.renameLabel')}>
            {(c) => (
              <input
                {...c}
                style={inputStyle}
                maxLength={80}
                value={renaming.name}
                onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
              />
            )}
          </Field>
          <button type="submit" disabled={busy || renaming.name.trim() === ''}>
            {f.t('views.renameDo')}
          </button>
        </form>
      )}
      <form
        style={rowStyle}
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() !== '') void save();
        }}
      >
        <Field label={f.t('views.name')}>
          {(c) => (
            <input
              {...c}
              style={inputStyle}
              name="viewName"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        {!RANGELESS_SLUGS.includes(slug) && (
          <Field label={f.t('views.range')}>
            {(c) => (
              <select
                {...c}
                style={inputStyle}
                value={range}
                onChange={(e) => setRange(e.target.value as RangeChoice)}
              >
                {(['FIXED', 'LAST_3', 'LAST_6', 'LAST_12'] as const).map((r) => (
                  <option key={r} value={r}>
                    {f.t(`views.ranges.${r}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <button type="submit" disabled={busy || name.trim() === ''} data-testid="saved-view-save">
          {f.t('views.save')}
        </button>
      </form>
      {status && (
        <p role="status" style={mutedStyle}>
          {status}
        </p>
      )}
      {problem && <ProblemMessage problem={problem} locale={ctx.uiLocale} />}
      {warnings.map((w) => (
        <p key={`${w.kind}-${w.id}`} role="note" style={warningStyle} data-testid="saved-view-warning">
          {f.t(`views.warning.${w.code}`, { kind: f.t(`views.kinds.${w.kind}`), name: w.name ?? w.id })}
        </p>
      ))}
    </section>
  );
}
