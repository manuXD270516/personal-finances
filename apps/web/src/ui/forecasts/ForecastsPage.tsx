'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { ForecastsView } from './ForecastsView';
import {
  FORECASTS_PATH,
  knownItemsApiPath,
  latestApiPath,
  pickSeries,
  pointsUpTo,
  selectionFromSearch,
  selectionToSearch,
  type ForecastHorizon,
} from './logic';
import type { ForecastKnownItems, LatestForecast } from './types';

const POLL_MS = 2500;
const POLL_MAX = 48;

const nextPeriod = (period: string): string => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + 1;
  return `${String(Math.floor(i / 12)).padStart(4, '0')}-${String((i % 12) + 1).padStart(2, '0')}`;
};

function Forecasts({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Forecasts', ctx);
  const search = useSearchParams();
  const [selection, setSelection] = useState(() =>
    selectionFromSearch(new URLSearchParams(search?.toString() ?? '')),
  );
  const [period, setPeriod] = useState<string | undefined>();
  const [latest, setLatest] = useState<LatestForecast | undefined>();
  const [known, setKnown] = useState<ForecastKnownItems | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [loading, setLoading] = useState(true);
  const [run, setRun] = useState<'idle' | 'requesting' | 'pending' | 'failed'>('idle');
  const [reload, setReload] = useState(0);
  const polling = useRef(false);
  const { horizon } = selection;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ctx.api
      .get<LatestForecast>(latestApiPath(ctx.base, horizon))
      .then((r) => {
        if (cancelled) return;
        setProblem(undefined);
        setLatest(r.data);
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
  }, [ctx.api, ctx.base, horizon, reload]);

  const selected = latest ? pickSeries(latest.series, selection.series) : undefined;
  const firstPoint = selected ? pointsUpTo(selected, horizon)[0] : undefined;
  // Sin puntos (datos insuficientes) se listan los conocidos del periodo en curso: el siguiente al último terminado.
  const fallbackPeriod = latest?.run?.asOfPeriod ? nextPeriod(latest.run.asOfPeriod) : undefined;
  const knownPeriod =
    (period && selected && pointsUpTo(selected, horizon).some((p) => p.period === period)
      ? period
      : undefined) ??
    firstPoint?.period ??
    fallbackPeriod;
  const scope = selected?.scope;
  const scopeRef = selected?.scopeRef ?? null;

  useEffect(() => {
    if (!scope || !knownPeriod) {
      setKnown(undefined);
      return;
    }
    let cancelled = false;
    setKnown(undefined);
    ctx.api
      .get<ForecastKnownItems>(knownItemsApiPath(ctx.base, { scope, scopeRef }, knownPeriod))
      .then((r) => {
        if (!cancelled) setKnown(r.data);
      })
      .catch(() => {
        if (!cancelled) setKnown({ items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, scope, scopeRef, knownPeriod, latest?.run?.id]);

  const onSelect = useCallback((next: { horizon?: ForecastHorizon; series?: string }) => {
    setSelection((prev) => {
      const merged = { ...prev, ...next };
      const qs = selectionToSearch(merged).toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
      return merged;
    });
    if (next.series !== undefined) setPeriod(undefined);
  }, []);

  /** Solicita una corrida (202) y sondea la corrida hasta que termina: entonces vuelve a leer el pronóstico vigente. */
  const onRun = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    setRun('requesting');
    try {
      const started = await ctx.api.command<{ id: string }>('POST', `${ctx.base}/forecasts`, undefined);
      const id = started.data?.id;
      setRun('pending');
      for (let i = 0; id && i < POLL_MAX; i += 1) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const r = await ctx.api.get<{ status: string }>(`${ctx.base}/forecasts/${id}`);
        const status = r.data?.status;
        if (status === 'COMPLETED' || status === 'INSUFFICIENT_DATA') {
          setRun('idle');
          setReload((n) => n + 1);
          return;
        }
        if (status === 'FAILED' || status === 'SUPERSEDED') {
          setRun('failed');
          return;
        }
      }
      setRun('idle');
      setReload((n) => n + 1);
    } catch (err) {
      setProblem(problemOf(err));
      setRun('idle');
    } finally {
      polling.current = false;
    }
  }, [ctx.api, ctx.base]);

  return (
    <div data-testid="forecasts-page" aria-busy={loading}>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {loading && !latest && !problem ? (
        <p role="status" data-testid="forecasts-loading">
          {f.t('loading')}
        </p>
      ) : null}
      {latest ? (
        <ForecastsView
          latest={latest}
          selection={selection}
          selectedPeriod={knownPeriod}
          known={known}
          f={f}
          canRun={ctx.canEdit}
          run={run}
          onSelect={onSelect}
          onSelectPeriod={setPeriod}
          onRun={() => void onRun()}
          href={ctx.href}
        />
      ) : null}
    </div>
  );
}

/** Vista de pronósticos (`/pronosticos`; add-expense-forecasts, tarea 7.1). */
export function ForecastsPage() {
  return <WithWorkspace>{(ctx) => <Forecasts ctx={ctx} />}</WithWorkspace>;
}

export { FORECASTS_PATH };
