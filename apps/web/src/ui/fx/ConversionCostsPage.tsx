'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { BFF_API } from '../session-context';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import {
  costExportPath,
  costPath,
  DEFAULT_COST_FILTERS,
  filterError,
  type ConversionCostAnalysis,
  type CostFilters,
} from './conversion-costs-logic';
import { ConversionCostsView } from './ConversionCostsView';

/** `/fx/costos`: costo de convertir por canal, par y periodo (FR-FX-011, US-183). Solo lectura. */
export function ConversionCostsPage() {
  return <WithWorkspace>{(ctx) => <Costs ctx={ctx} />}</WithWorkspace>;
}

function Costs({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('ConversionCosts', ctx);
  const [draft, setDraft] = useState<CostFilters>(DEFAULT_COST_FILTERS);
  const [applied, setApplied] = useState<CostFilters>(DEFAULT_COST_FILTERS);
  const [analysis, setAnalysis] = useState<ConversionCostAnalysis | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();

  const load = useCallback(
    (filters: CostFilters) => {
      if (filterError(filters)) return () => undefined;
      let cancelled = false;
      setAnalysis(undefined);
      setProblem(undefined);
      ctx.api
        .get<ConversionCostAnalysis>(costPath(ctx.base, filters))
        .then((r) => {
          if (!cancelled) setAnalysis(r.data);
        })
        .catch((err: unknown) => {
          if (!cancelled) setProblem(problemOf(err));
        });
      return () => {
        cancelled = true;
      };
    },
    [ctx.api, ctx.base],
  );
  useEffect(() => load(applied), [load, applied]);

  return (
    <ConversionCostsView
      f={f}
      draft={draft}
      onDraft={setDraft}
      onApply={() => setApplied(draft)}
      analysis={analysis}
      exportHref={`${BFF_API}${costExportPath(ctx.base, applied)}`}
      fxHref={ctx.href('/fx')}
      problem={problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
    />
  );
}
