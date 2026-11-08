'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Category } from '../common/types';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { HOME_CSS } from '../dashboard/styles';
import { listAll, problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { BUDGETS_PATH, SPENDABLE_SETTINGS_PATH, UPCOMING_PATH } from './logic';
import type { Spendable } from './types';
import { SpendableDetailView } from './SpendableView';

function SpendableDetail({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('Dashboard', ctx);
  const [spendable, setSpendable] = useState<Spendable | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [categories, setCategories] = useState<readonly Category[]>([]);

  // Los avisos de esenciales traen solo el id de la categoría: el nombre sale del catálogo (si no carga, un texto genérico).
  useEffect(() => {
    let cancelled = false;
    listAll<Category>(ctx.api, `${ctx.base}/categories`, new URLSearchParams({ includeArchived: 'true' }))
      .then((rows) => !cancelled && setCategories(rows))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base]);
  const categoryNames = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

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
            categoryNames={categoryNames}
            links={{
              settingsHref: ctx.href(SPENDABLE_SETTINGS_PATH),
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
