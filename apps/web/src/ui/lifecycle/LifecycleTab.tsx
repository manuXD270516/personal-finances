'use client';

import { useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import { LifecycleReport } from './LifecycleReport';
import type { Lifecycle, TransactionLifecycle } from './types';

/**
 * Pestaña "Recorrido" (openspec add-lifecycle-timeline, tarea 6.1): carga `GET {W}/{path}/lifecycle` (VIEWER+) y lo
 * presenta con `LifecycleReport`; recarga cuando cambia `refreshKey` (versión del agregado tras cada acción).
 */
export function LifecycleTab({
  ctx,
  path,
  refreshKey,
  stateLabel,
  fieldLabel,
  accountName,
  idPrefix,
}: {
  ctx: WorkspaceContext;
  /** Recurso relativo al workspace, p. ej. `transactions/{id}` o `accounts/{id}`. */
  path: string;
  refreshKey?: string | number;
  stateLabel: (code: string) => string;
  fieldLabel?: (name: string) => string;
  accountName?: (id: string) => string | undefined;
  idPrefix: string;
}) {
  const f = useFormat('Lifecycle', ctx);
  const [lifecycle, setLifecycle] = useState<Lifecycle | TransactionLifecycle | undefined>();
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();

  useEffect(() => {
    let cancelled = false;
    ctx.api
      .get<Lifecycle | TransactionLifecycle>(`${ctx.base}/${path}/lifecycle`)
      .then((r) => {
        if (cancelled) return;
        setLifecycle(r.data);
        setProblem(undefined);
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(problemOf(err));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, path, refreshKey]);

  if (problem) return <ProblemMessage problem={problem} locale={ctx.uiLocale} />;
  if (!lifecycle) return <p aria-busy="true">{f.t('loading')}</p>;
  return (
    <LifecycleReport
      lifecycle={lifecycle}
      f={f}
      stateLabel={stateLabel}
      {...(fieldLabel ? { fieldLabel } : {})}
      {...(accountName ? { accountName } : {})}
      currentUserId={ctx.me.id}
      idPrefix={idPrefix}
    />
  );
}
