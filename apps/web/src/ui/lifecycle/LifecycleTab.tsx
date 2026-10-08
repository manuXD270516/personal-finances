'use client';

import { useEffect, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { problemOf, useFormat, type WorkspaceContext } from '../common/workspace';
import { BFF_API } from '../session-context';
import type { ReactNode } from 'react';
import { LifecycleReport } from './LifecycleReport';
import type { TimelineRow } from './logic';
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
  extra,
}: {
  ctx: WorkspaceContext;
  /** Recurso relativo al workspace, p. ej. `transactions/{id}` o `accounts/{id}`. */
  path: string;
  refreshKey?: string | number;
  stateLabel: (code: string) => string;
  fieldLabel?: (name: string) => string;
  accountName?: (id: string) => string | undefined;
  idPrefix: string;
  /** Líneas adicionales por fila, con el recorrido completo cargado (sesiones enlazadas, saldos del extracto…). */
  extra?: (row: TimelineRow, lifecycle: Lifecycle | TransactionLifecycle) => ReactNode;
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
    <>
      <LifecycleExportActions
        href={(format) => `${BFF_API}${ctx.base}/${path}/lifecycle/export?format=${format}`}
        label={f.t('export.label')}
        csv={f.t('export.csv')}
        pdf={f.t('export.pdf')}
        idPrefix={idPrefix}
      />
      <LifecycleReport
        lifecycle={lifecycle}
        f={f}
        stateLabel={stateLabel}
        {...(fieldLabel ? { fieldLabel } : {})}
        {...(accountName ? { accountName } : {})}
        {...(extra ? { extra: (row: TimelineRow) => extra(row, lifecycle) } : {})}
        currentUserId={ctx.me.id}
        idPrefix={idPrefix}
      />
    </>
  );
}

/**
 * Acciones "Exportar CSV" y "Exportar PDF" del recorrido (docs/31 D52): enlaces de descarga al proxy del BFF (GET
 * autenticado con la cookie de sesión; la API responde `Content-Disposition: attachment`). Mismo rol que el recorrido
 * (VIEWER incluido).
 */
export function LifecycleExportActions({
  href,
  label,
  csv,
  pdf,
  idPrefix,
}: {
  href: (format: 'csv' | 'pdf') => string;
  label: string;
  csv: string;
  pdf: string;
  idPrefix: string;
}) {
  const linkStyle = {
    display: 'inline-block',
    padding: '0.375rem 0.75rem',
    border: '1px solid #8c959f',
    borderRadius: 6,
    textDecoration: 'none',
    color: 'inherit',
  } as const;
  return (
    <nav aria-label={label} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
      <a href={href('csv')} download data-testid={`${idPrefix}-export-csv`} style={linkStyle}>
        {csv}
      </a>
      <a href={href('pdf')} download data-testid={`${idPrefix}-export-pdf`} style={linkStyle}>
        {pdf}
      </a>
    </nav>
  );
}
