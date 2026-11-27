'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormatContext } from '../dashboard/types';
import { InfoTip } from '../common/InfoTip';
import { badgeStyle, cardStyle, mutedStyle } from '../common/ui';
import { useFormat, type WorkspaceContext } from '../common/workspace';
import type { NameResolver } from '../transactions/TransactionTimeline';
import { batchesOf, marksApiPath, reasonsText, SPENDING_ANOMALIES_PATH } from './logic';
import type { SpendingAnomaly, SpendingAnomalyPage } from './types';

/** Marcas de gasto atípico abiertas por transacción (las descartadas y las reemplazadas no se muestran). */
export type AnomalyMarks = ReadonlyMap<string, SpendingAnomaly>;

/**
 * Lee, para las filas visibles, qué transacciones tienen un gasto atípico ABIERTO (`GET /spending-anomalies?transactionId=…`,
 * hasta 100 ids por consulta, en serie). Es un dato accesorio: si la consulta falla, no se muestra ninguna marca y la lista
 * sigue igual. TRANSACTIONS no sabe nada de FORECAST: la web une las dos lecturas (decisión 10).
 */
export function useAnomalyMarks(ctx: WorkspaceContext, transactionIds: readonly string[]): AnomalyMarks {
  const [marks, setMarks] = useState<AnomalyMarks>(new Map());
  const key = useMemo(() => [...new Set(transactionIds)].sort().join(','), [transactionIds]);
  useEffect(() => {
    if (key === '') {
      setMarks(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const found = new Map<string, SpendingAnomaly>();
      try {
        for (const batch of batchesOf(key.split(','))) {
          const r = await ctx.api.get<SpendingAnomalyPage>(marksApiPath(ctx.base, batch));
          for (const a of r.data?.items ?? []) if (a.status === 'OPEN') found.set(a.transactionId, a);
        }
      } catch {
        found.clear();
      }
      if (!cancelled) setMarks(found);
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx.api, ctx.base, key]);
  return marks;
}

/** Marca compacta de la fila del listado: el texto «Atípico» lleva la señal; el motivo va en el `title` y el enlace a la lista. */
export function AnomalyBadge({
  anomaly,
  f,
  names,
  href,
}: {
  anomaly: SpendingAnomaly;
  f: FormatContext;
  names: NameResolver;
  href: (path: string) => string;
}) {
  const reasons = reasonsText(anomaly, f, names).join('; ');
  return (
    <>
      <a
        href={href(SPENDING_ANOMALIES_PATH)}
        data-testid="tx-anomaly-mark"
        style={{
          ...badgeStyle,
          borderColor: 'var(--pf-warning-border)',
          background: 'var(--pf-warning-bg)',
          color: 'var(--pf-warning-fg)',
          textDecoration: 'none',
        }}
      >
        {f.t('mark.label')}
      </a>
      <InfoTip label={f.t('infoTip', { subject: f.t('mark.label') })}>
        {f.t('mark.hint', { reasons })}
      </InfoTip>
    </>
  );
}

/** Marca del detalle de la transacción: el motivo por plantilla y el enlace a la lista de gastos atípicos. */
export function AnomalyDetail({
  ctx,
  transactionId,
  names,
}: {
  ctx: WorkspaceContext;
  transactionId: string;
  names: NameResolver;
}) {
  const f = useFormat('SpendingAnomalies', ctx);
  const ids = useMemo(() => [transactionId], [transactionId]);
  const marks = useAnomalyMarks(ctx, ids);
  const anomaly = marks.get(transactionId);
  if (!anomaly) return null;
  return (
    <section aria-labelledby="tx-anomaly-title" style={cardStyle} data-testid="tx-anomaly-detail">
      <h2 id="tx-anomaly-title" style={{ fontSize: '1rem', marginTop: 0 }}>
        {f.t('detail.title')}
      </h2>
      <p style={mutedStyle}>{f.t('detail.intro')}</p>
      <ul>
        {reasonsText(anomaly, f, names).map((text, i) => (
          <li key={i} data-testid="tx-anomaly-reason">
            {text}
          </li>
        ))}
      </ul>
      {anomaly.transactionChanged ? <p style={mutedStyle}>{f.t('changed')}</p> : null}
      <a href={ctx.href(SPENDING_ANOMALIES_PATH)} data-testid="tx-anomaly-link">
        {f.t('detail.open')}
      </a>
    </section>
  );
}
