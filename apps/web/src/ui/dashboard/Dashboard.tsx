'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { localized, useSession } from '../session-context';
import { MAX_TOP_CATEGORIES, previousCategoriesQuery, type PreviousCategories } from './category-comparison';
import { DashboardSkeleton, DashboardView } from './DashboardView';
import type { ReportSummary } from './types';

const DEFAULT_FORMAT_LOCALE = 'es-BO';
const DEFAULT_TIME_ZONE = 'America/La_Paz';

interface Loaded {
  readonly workspaceId: string;
  readonly summary: ReportSummary;
  readonly formatLocale: string;
}

const UNAVAILABLE: PreviousCategories = { status: 'unavailable' };
const LOADING: PreviousCategories = { status: 'loading' };

/**
 * Home del workspace activo: `GET /workspaces/{id}/reports/summary` vía BFF, presentado con `DashboardView`. Tras
 * mostrarlo, pide el top de categorías del mismo tramo del mes anterior (mismo endpoint, `compare=NONE`) para la
 * variación por categoría (FR-REPORTING-004); si esa lectura falla, el Home queda igual pero sin variaciones.
 */
export function Dashboard() {
  const t = useTranslations('Dashboard');
  const uiLocale = useLocale();
  const { state } = useSession();
  const [loaded, setLoaded] = useState<Loaded | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [previous, setPrevious] = useState<{ key: string; value: PreviousCategories } | undefined>();

  const ready = state.status === 'ready' ? state : undefined;
  const api = ready?.api;
  const workspaceId = ready?.active?.workspaceId;

  useEffect(() => {
    if (!api || !workspaceId) return;
    let cancelled = false;
    Promise.all([
      api.get<ReportSummary>(`/workspaces/${workspaceId}/reports/summary`),
      // Locale de formato del workspace (es-BO por defecto); si esta lectura falla no bloquea el Home.
      api.get<{ locale?: string }>(`/workspaces/${workspaceId}`).catch(() => undefined),
    ])
      .then(([summary, ws]) => {
        if (cancelled) return;
        setProblem(undefined);
        setLoaded({
          workspaceId,
          summary: summary.data!,
          formatLocale: ws?.data?.locale ?? DEFAULT_FORMAT_LOCALE,
        });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setProblem(err instanceof FinanceApiError ? err.problem : { code: 'SERVICE_UNAVAILABLE' });
      });
    return () => {
      cancelled = true;
    };
  }, [api, workspaceId]);

  const previousQuery = loaded ? previousCategoriesQuery(loaded.summary) : undefined;
  const previousKey = loaded && previousQuery ? `${loaded.workspaceId}?${previousQuery}` : undefined;

  useEffect(() => {
    if (!api || !loaded || !previousQuery || !previousKey) return;
    let cancelled = false;
    api
      .get<ReportSummary>(`/workspaces/${loaded.workspaceId}/reports/summary?${previousQuery}`)
      .then((r) => {
        if (cancelled) return;
        const items = r.data?.topExpenseCategories ?? [];
        setPrevious({
          key: previousKey,
          value: { status: 'ready', items, saturated: items.length >= MAX_TOP_CATEGORIES },
        });
      })
      .catch(() => {
        if (!cancelled) setPrevious({ key: previousKey, value: UNAVAILABLE });
      });
    return () => {
      cancelled = true;
    };
  }, [api, loaded, previousQuery, previousKey]);

  if (!ready) return null;
  if (!workspaceId) return <p data-testid="dashboard-no-workspace">{t('noWorkspace')}</p>;
  if (problem) return <ProblemMessage problem={problem} locale={uiLocale} />;
  if (!loaded || loaded.workspaceId !== workspaceId) return <DashboardSkeleton label={t('loading')} />;
  return (
    <DashboardView
      summary={loaded.summary}
      locale={loaded.formatLocale}
      timeZone={loaded.summary.meta.timeZone || DEFAULT_TIME_ZONE}
      t={(key, values) => t(key, values)}
      has={(key) => t.has(key)}
      createAccountHref={localized(uiLocale, '/cuentas/nueva')}
      registerRateHref={localized(uiLocale, '/fx')}
      registerExpenseHref={localized(uiLocale, '/transacciones/nueva')}
      previousCategories={
        !previousKey ? UNAVAILABLE : previous?.key === previousKey ? previous.value : LOADING
      }
    />
  );
}
