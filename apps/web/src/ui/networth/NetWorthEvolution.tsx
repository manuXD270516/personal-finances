'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { HOME_CSS } from '../dashboard/styles';
import type { FormatContext } from '../dashboard/types';
import { localized, useSession } from '../session-context';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { NetWorthEvolutionView } from './NetWorthEvolutionView';
import type { NetWorthHistory } from './types';

/**
 * Tarjeta compacta del Home (docs/33 D104): últimos 6 periodos con enlace a la vista completa. Si la lectura falla el
 * Home sigue funcionando y la tarjeta lo dice (la evolución es secundaria frente al patrimonio actual).
 */
export function NetWorthEvolutionCard({
  locale,
  timeZone,
  uiLocale,
}: {
  locale: string;
  timeZone: string;
  uiLocale: string;
}) {
  const t = useTranslations('NetWorthEvolution');
  const { state } = useSession();
  const ready = state.status === 'ready' ? state : undefined;
  const api = ready?.api;
  const workspaceId = ready?.active?.workspaceId;
  const [history, setHistory] = useState<NetWorthHistory | 'error' | undefined>();

  useEffect(() => {
    if (!api || !workspaceId) return;
    let cancelled = false;
    api
      .get<NetWorthHistory>(`/workspaces/${workspaceId}/reports/net-worth/history`)
      .then((r) => {
        if (!cancelled) setHistory(r.data ?? 'error');
      })
      .catch(() => {
        if (!cancelled) setHistory('error');
      });
    return () => {
      cancelled = true;
    };
  }, [api, workspaceId]);

  const f: FormatContext = useMemo(
    () => ({
      locale,
      timeZone,
      t: (key, values) => t(key as never, values as never),
      has: (key) => t.has(key as never),
    }),
    [t, locale, timeZone],
  );
  if (history === undefined) return null;
  if (history === 'error') {
    return (
      <section
        className="pf-home-card"
        data-testid="net-worth-evolution-error"
        aria-labelledby="nw-card-heading"
      >
        <h3 id="nw-card-heading">{f.t('title')}</h3>
        <p role="status">{f.t('error')}</p>
      </section>
    );
  }
  return (
    <NetWorthEvolutionView
      history={history}
      f={f}
      variant="compact"
      fullHref={localized(uiLocale, '/patrimonio')}
    />
  );
}

function Evolution({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('NetWorthEvolution', ctx);
  const [history, setHistory] = useState<NetWorthHistory | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<NetWorthHistory>(`${ctx.base}/reports/net-worth/history`)
      .then((r) => {
        if (!cancelled) setHistory(r.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base]);

  return (
    <div className="pf-home" data-testid="net-worth-evolution-page">
      <style>{HOME_CSS}</style>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {!history && !problem ? <p aria-busy="true">{f.t('loading')}</p> : null}
      {history ? (
        <NetWorthEvolutionView history={history} f={f} variant="full" homeHref={ctx.href('/')} />
      ) : null}
    </div>
  );
}

/** Vista completa `/patrimonio`: 12 periodos con tabla de datos, tasas usadas y atribuciones. */
export function NetWorthEvolutionPage() {
  return <WithWorkspace>{(ctx) => <Evolution ctx={ctx} />}</WithWorkspace>;
}
