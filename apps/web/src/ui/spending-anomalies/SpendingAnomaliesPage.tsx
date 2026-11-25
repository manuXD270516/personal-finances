'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { problemOf, useFormat, WithWorkspace, type WorkspaceContext } from '../common/workspace';
import { useCatalogs } from '../transactions/catalogs';
import { SpendingAnomaliesView } from './SpendingAnomaliesView';
import {
  filtersFromSearch,
  filtersToSearch,
  listApiPath,
  SPENDING_ANOMALIES_PATH,
  type AnomalyFilters,
} from './logic';
import type { DismissReason, SpendingAnomaly, SpendingAnomalyPage } from './types';

function SpendingAnomalies({ ctx }: { ctx: WorkspaceContext }) {
  const f = useFormat('SpendingAnomalies', ctx);
  const search = useSearchParams();
  const catalogs = useCatalogs(ctx);
  const [filters, setFilters] = useState<AnomalyFilters>(() =>
    filtersFromSearch(new URLSearchParams(search?.toString() ?? '')),
  );
  const [items, setItems] = useState<readonly SpendingAnomaly[] | undefined>();
  const [featureStatus, setFeatureStatus] = useState<'ENABLED' | 'DISABLED'>('ENABLED');
  const [cursor, setCursor] = useState<string | null>(null);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [busyId, setBusyId] = useState<string | undefined>();
  const [reload, setReload] = useState(0);
  // Solo la última petición escribe la lista: una respuesta tardía de filtros anteriores se descarta.
  const latest = useRef(0);

  const load = useCallback(
    (append?: string | null) => {
      const seq = (latest.current += 1);
      ctx.api
        .get<SpendingAnomalyPage>(listApiPath(ctx.base, filters, append))
        .then((r) => {
          if (seq !== latest.current || !r.data) return;
          const page = r.data;
          setItems((prev) => (append ? [...(prev ?? []), ...page.items] : page.items));
          setCursor(page.nextCursor);
          setFeatureStatus(page.featureStatus);
          setProblem(undefined);
        })
        .catch((err: unknown) => {
          if (seq === latest.current) setProblem(problemOf(err));
        });
    },
    [ctx.api, ctx.base, filters],
  );

  useEffect(() => {
    load();
  }, [load, reload]);

  const onFilters = useCallback((next: Partial<AnomalyFilters>) => {
    setFilters((prev) => {
      const merged = { ...prev, ...next };
      const qs = filtersToSearch(merged).toString();
      window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
      return merged;
    });
    setItems(undefined);
  }, []);

  const decide = useCallback(
    async (id: string, action: 'dismiss' | 'restore', body?: Record<string, unknown>) => {
      setBusyId(id);
      setStatus(undefined);
      try {
        await ctx.api.command<unknown>('POST', `${ctx.base}/spending-anomalies/${id}/${action}`, body);
        setStatus(f.t(action === 'dismiss' ? 'dismiss.done' : 'restore.done'));
        setProblem(undefined);
        setReload((n) => n + 1);
      } catch (err) {
        setProblem(problemOf(err));
      } finally {
        setBusyId(undefined);
      }
    },
    [ctx.api, ctx.base, f],
  );

  const names = useMemo(
    () => ({ category: catalogs.names.category, counterparty: catalogs.names.counterparty }),
    [catalogs.names],
  );

  return (
    <div data-testid="spending-anomalies-page" aria-busy={items === undefined && !problem}>
      {problem ? <ProblemMessage problem={problem} locale={ctx.uiLocale} /> : null}
      {status ? (
        <p role="status" data-testid="anomalies-status">
          {status}
        </p>
      ) : null}
      {items === undefined && !problem ? (
        <p role="status" data-testid="anomalies-loading">
          {f.t('loading')}
        </p>
      ) : null}
      {items !== undefined ? (
        <SpendingAnomaliesView
          page={{ featureStatus }}
          items={items}
          names={names}
          filters={filters}
          f={f}
          canDecide={ctx.canEdit}
          busyId={busyId}
          hasMore={cursor !== null}
          onFilters={onFilters}
          onDismiss={(id: string, reason: DismissReason | undefined) =>
            void decide(id, 'dismiss', reason ? { reason } : {})
          }
          onRestore={(id) => void decide(id, 'restore')}
          onMore={() => load(cursor)}
          href={ctx.href}
        />
      ) : null}
    </div>
  );
}

/** Vista de gastos atípicos (`/gastos-atipicos`; add-spending-anomaly-detection, tarea 6.1). */
export function SpendingAnomaliesPage() {
  return <WithWorkspace>{(ctx) => <SpendingAnomalies ctx={ctx} />}</WithWorkspace>;
}

export { SPENDING_ANOMALIES_PATH };
