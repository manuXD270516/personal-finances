'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { FinanceApiError } from '../../bff/finance-api-client';
import { todayIn } from '../common/dates';
import { formatMoney } from '../dashboard/format';
import type { FormatContext } from '../dashboard/types';
import { localized, useSession } from '../session-context';
import type { Budget, Page } from './budget-logic';
import type { FinancialPeriod } from './logic';

/**
 * Vista del widget del Home (openspec add-budgets 6.2; Q3 + Q5 parcial): "disponible para gastar" del plan del
 * periodo en curso, con lo planificado y lo gastado. Sin plan, lo dice y ofrece crearlo (nunca un cero sustituto).
 */
export function BudgetProgressWidgetView({
  budget,
  href,
  f,
}: {
  budget: Budget | null;
  href: string;
  f: FormatContext;
}) {
  return (
    <section
      data-testid="budget-widget"
      data-state={budget ? 'ready' : 'none'}
      aria-labelledby="budget-widget-title"
      className="pf-home-group"
    >
      <h2 id="budget-widget-title">{f.t('widget.title')}</h2>
      {budget ? (
        <div className="pf-home-card" style={{ display: 'grid', gap: 'var(--pf-space-2)' }}>
          <p style={{ margin: 0 }}>{f.t('widget.available')}</p>
          <p
            data-testid="budget-widget-available"
            style={{ margin: 0, fontSize: 'var(--pf-text-2xl)', fontVariantNumeric: 'tabular-nums' }}
          >
            {formatMoney(budget.totals.availableToSpend, f.locale)}
          </p>
          <p style={{ margin: 0 }} data-testid="budget-widget-detail">
            {f.t('widget.detail', {
              planned: formatMoney(budget.totals.planned, f.locale),
              actual: formatMoney(budget.totals.actual, f.locale),
            })}
          </p>
          {!budget.totals.complete ? (
            <p
              role="status"
              style={{ margin: 0, color: 'var(--pf-fin-warning)' }}
              data-testid="budget-widget-incomplete"
            >
              <span aria-hidden="true">⚠</span> {f.t('widget.incomplete')}
            </p>
          ) : null}
          <a href={href}>{f.t('widget.goToBudgets')}</a>
        </div>
      ) : (
        <div className="pf-home-card" data-testid="budget-widget-none">
          <p>{f.t('widget.noPlan')}</p>
          <a href={href}>{f.t('widget.createPlan')}</a>
        </div>
      )}
    </section>
  );
}

/** Carga el plan del periodo que contiene hoy (zona del workspace) y lo presenta; 404 = sin plan. */
export function BudgetProgressWidget({
  locale,
  timeZone,
  uiLocale,
}: {
  locale: string;
  timeZone: string;
  uiLocale: string;
}) {
  const t = useTranslations('Budgets');
  const { state } = useSession();
  const ready = state.status === 'ready' ? state : undefined;
  const api = ready?.api;
  const workspaceId = ready?.active?.workspaceId;
  const [budget, setBudget] = useState<Budget | null | undefined>();

  useEffect(() => {
    if (!api || !workspaceId) return;
    let cancelled = false;
    const today = todayIn(timeZone);
    api
      .get<Page<FinancialPeriod>>(`/workspaces/${workspaceId}/periods?containsDate=${today}`)
      .then((periods) => {
        const period = periods.data?.data[0];
        if (!period) return null;
        return api
          .get<Budget>(`/workspaces/${workspaceId}/periods/${period.id}/budget`)
          .then((r) => r.data ?? null);
      })
      .catch((err: unknown) => {
        if (err instanceof FinanceApiError && err.status === 404) return null;
        throw err;
      })
      .then((b) => {
        if (!cancelled) setBudget(b);
      })
      .catch(() => {
        // Si la lectura falla el Home sigue funcionando: el widget dice que no hay plan.
        if (!cancelled) setBudget(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, workspaceId, timeZone]);

  if (budget === undefined) return null;
  const f: FormatContext = {
    locale,
    timeZone,
    t: (key, values) => t(key as never, values as never),
    has: (key) => t.has(key as never),
  };
  return (
    <BudgetProgressWidgetView
      budget={budget}
      href={localized(uiLocale, '/planificacion/presupuestos')}
      f={f}
    />
  );
}
