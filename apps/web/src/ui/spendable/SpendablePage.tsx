'use client';

import { useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { HOME_CSS } from '../dashboard/styles';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { BUDGETS_PATH, UPCOMING_PATH } from './logic';
import type { Spendable } from './types';
import { SpendableDetailView } from './SpendableView';

function SpendableDetail({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Dashboard', ctx);
  const [spendable, setSpendable] = useState<Spendable | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<Spendable>(`${ctx.base}/reports/spendable`)
      .then((r) => {
        if (cancelled) return;
        setProblem(undefined);
        setSpendable(r.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base]);

  return (
    <div className="pf-home" data-testid="spendable-page">
      <style>{HOME_CSS}</style>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {!spendable && !problem ? (
        <p aria-busy="true" role="status">
          {f.t('spendable.detail.loading')}
        </p>
      ) : null}
      {spendable ? (
        spendable.byCurrency.length === 0 ? (
          <p data-testid="spendable-no-accounts">{f.t('spendable.detail.noAccounts')}</p>
        ) : (
          <SpendableDetailView
            spendable={spendable}
            ctx={f}
            links={{
              homeHref: ctx.href('/'),
              createBudgetHref: ctx.href(BUDGETS_PATH),
              upcomingHref: ctx.href(UPCOMING_PATH),
            }}
          />
        )
      ) : null}
    </div>
  );
}

/** Vista de detalle del disponible para gastar (`/disponible`; add-spendable-amount, tarea 6.2). */
export function SpendablePage() {
  return <WithWorkspace>{(ctx) => <SpendableDetail ctx={ctx} />}</WithWorkspace>;
}
