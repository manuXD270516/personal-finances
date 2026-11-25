'use client';

import { useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { cardStyle, mutedStyle } from '../common/ui';
import { problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { monthRange, rateText, statsPath, type SuggestionStats } from './logic';

/** Tasa de aceptación del mes con el desglose por canal (presentacional, testeable sin red). */
export function AcceptanceRateView({
  stats,
  f,
  locale,
}: {
  stats: SuggestionStats;
  f: FormatContext;
  locale: string;
}) {
  if (stats.shown === 0) {
    return (
      <p style={mutedStyle} data-testid="acceptance-empty">
        {f.t('rate.empty')}
      </p>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 'var(--pf-space-2)' }} data-testid="acceptance-view">
      <p style={{ margin: 0, fontSize: 'var(--pf-text-lg)' }}>
        <span style={mutedStyle}>{f.t('rate.rate')}: </span>
        <strong data-testid="acceptance-rate">{rateText(stats.acceptanceRate, locale)}</strong>{' '}
        <span style={mutedStyle}>({stats.acceptanceRate})</span>
      </p>
      <p style={{ margin: 0 }} data-testid="acceptance-summary">
        {f.t('rate.summary', {
          shown: stats.shown,
          accepted: stats.accepted,
          corrected: stats.corrected,
          ignored: stats.ignored,
        })}
      </p>
      <ul style={{ margin: 0, paddingLeft: '1.25rem' }} aria-label={f.t('rate.bySurface')}>
        {stats.bySurface
          .filter((s) => s.shown > 0)
          .map((s) => (
            <li key={s.surface} data-testid="acceptance-surface" data-surface={s.surface}>
              {f.t(`rate.surface.${s.surface}`)}:{' '}
              {f.t('rate.summary', {
                shown: s.shown,
                accepted: s.accepted,
                corrected: s.corrected,
                ignored: s.ignored,
              })}
            </li>
          ))}
      </ul>
    </div>
  );
}

/** Tarjeta de la vista de reglas: qué hizo el usuario con las sugerencias de categoría este mes. */
export function AcceptanceRateCard({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('CategorySuggestions', ctx);
  const [stats, setStats] = useState<SuggestionStats | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [loading, setLoading] = useState(true);
  const { api, base } = ctx;

  useEffect(() => {
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    const { from, to } = monthRange(today);
    api
      .get<SuggestionStats>(statsPath(base, from, to))
      .then((r) => {
        if (!cancelled) setStats(r.data);
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
  }, [api, base]);

  return (
    <section
      style={{ ...cardStyle, display: 'grid', gap: 'var(--pf-space-2)' }}
      aria-labelledby="acceptance-title"
      data-testid="acceptance-card"
    >
      <h3 id="acceptance-title" style={{ margin: 0 }}>
        {f.t('rate.title')}
      </h3>
      <p style={{ ...mutedStyle, margin: 0 }}>{f.t('rate.intro')}</p>
      {loading ? <p aria-busy="true">{f.t('rate.loading')}</p> : null}
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {stats ? <AcceptanceRateView stats={stats} f={f} locale={ctx.formatLocale} /> : null}
    </section>
  );
}
