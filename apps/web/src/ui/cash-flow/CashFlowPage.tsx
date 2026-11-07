'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { CashFlowView } from './CashFlowView';
import {
  calendarApiPath,
  selectionFromSearch,
  selectionToSearch,
  CASH_FLOW_PATH,
  type CashFlowSelection,
} from './logic';
import type { CashFlowCalendar } from './types';

function CashFlow({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('CashFlow', ctx);
  const rateCtx = useFormat('Dashboard', ctx);
  const search = useSearchParams();
  const [selection, setSelection] = useState<CashFlowSelection>(() =>
    selectionFromSearch(new URLSearchParams(search?.toString() ?? '')),
  );
  const [calendar, setCalendar] = useState<CashFlowCalendar | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [loading, setLoading] = useState(true);
  const { horizon, accountId } = selection;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ctx.api
      .get<CashFlowCalendar>(calendarApiPath(ctx.base, { horizon, accountId, currency: undefined }))
      .then((r) => {
        if (cancelled) return;
        setProblem(undefined);
        setCalendar(r.data);
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
  }, [ctx.api, ctx.base, horizon, accountId]);

  const onSelect = useCallback((next: Partial<CashFlowSelection>) => {
    setSelection((prev) => {
      const merged = { ...prev, ...next } as CashFlowSelection;
      // La URL refleja la selección (enlazable y compatible con el de la notificación de riesgo).
      const qs = selectionToSearch(merged).toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
      return merged;
    });
  }, []);

  return (
    <div data-testid="cash-flow-root" aria-busy={loading}>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {loading && !calendar && !problem ? (
        <p role="status" data-testid="cash-flow-loading">
          {f.t('loading')}
        </p>
      ) : null}
      {calendar ? (
        <>
          {loading ? (
            <p role="status" className="pf-cf-muted" data-testid="cash-flow-refreshing">
              {f.t('refreshing')}
            </p>
          ) : null}
          <CashFlowView
            calendar={calendar}
            selection={selection}
            f={f}
            rateCtx={rateCtx}
            onSelect={onSelect}
            href={ctx.href}
            createAccountHref={ctx.href('/cuentas/nueva')}
          />
        </>
      ) : null}
    </div>
  );
}

/** Calendario de flujo de caja (`/flujo-de-caja`; add-cash-flow-forecast, tarea 6.1). */
export function CashFlowPage() {
  return <WithWorkspace>{(ctx) => <CashFlow ctx={ctx} />}</WithWorkspace>;
}

export { CASH_FLOW_PATH };
