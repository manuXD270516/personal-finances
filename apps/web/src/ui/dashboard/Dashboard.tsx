'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { localized, useSession } from '../session-context';
import { NetWorthEvolutionCard } from '../networth/NetWorthEvolution';
import { BudgetProgressWidget } from '../planning/BudgetProgressWidget';
import { DashboardSkeleton, DashboardView } from './DashboardView';
import type { ReportSummary } from './types';

const DEFAULT_FORMAT_LOCALE = 'es-BO';
const DEFAULT_TIME_ZONE = 'America/La_Paz';

interface Loaded {
  readonly workspaceId: string;
  readonly summary: ReportSummary;
  readonly formatLocale: string;
}

/**
 * Home del workspace activo: `GET /workspaces/{id}/reports/summary` vía BFF, presentado con `DashboardView`. Una
 * sola lectura del resumen: los tops de gasto e ingreso ya traen el monto del periodo anterior por categoría
 * (`previousAmount`, FR-REPORTING-004), así que la variación por categoría no necesita otra consulta.
 */
export function Dashboard() {
  const t = useTranslations('Dashboard');
  const uiLocale = useLocale();
  const { state } = useSession();
  const [loaded, setLoaded] = useState<Loaded | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();

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
      evolutionCard={
        <NetWorthEvolutionCard
          locale={loaded.formatLocale}
          timeZone={loaded.summary.meta.timeZone || DEFAULT_TIME_ZONE}
          uiLocale={uiLocale}
        />
      }
      budgetWidget={
        <BudgetProgressWidget
          locale={loaded.formatLocale}
          timeZone={loaded.summary.meta.timeZone || DEFAULT_TIME_ZONE}
          uiLocale={uiLocale}
        />
      }
    />
  );
}
