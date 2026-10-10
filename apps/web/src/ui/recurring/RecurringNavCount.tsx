'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { Page } from '../common/types';
import { useSession } from '../session-context';
import { approvalBadge, RECURRING_CHANGED, trayCountOf, trayQuery } from './logic';
import type { RecurringOccurrence } from './types';

/** Intervalo de consulta del contador de la sidebar (sin SSE), en pausa con la pestaña oculta. */
const POLL_MS = 60_000;

/** Contador visual (decorativo) + texto para lector de pantalla; sin pendientes no muestra nada. */
export function NavCountView({ count, hasMore, label }: { count: number; hasMore: boolean; label: string }) {
  if (count <= 0) return null;
  return (
    <>
      <span className="pf-nav-count" data-testid="recurring-approval-count" aria-hidden="true">
        {approvalBadge(count, hasMore)}
      </span>
      <span className="pf-sr-only">{label}</span>
    </>
  );
}

/**
 * Contador de la entrada "Recurrentes" de la sidebar: ocurrencias por aprobar de la bandeja
 * (`GET …/recurring/occurrences?requiresApproval=true`, una página). Se consulta al montar, cada 60 s, al volver a la
 * pestaña y cuando una acción de la pantalla avisa de un cambio. Un fallo se ignora (el contador es auxiliar).
 */
export function RecurringNavCount() {
  const t = useTranslations('App');
  const { state } = useSession();
  const [tray, setTray] = useState({ count: 0, hasMore: false });
  const api = state.status === 'ready' ? state.api : undefined;
  const workspaceId = state.status === 'ready' ? state.active?.workspaceId : undefined;

  useEffect(() => {
    if (!api || !workspaceId) return;
    let cancelled = false;
    setTray({ count: 0, hasMore: false });
    const refresh = () => {
      if (document.hidden) return;
      api
        .get<Page<RecurringOccurrence>>(`/workspaces/${workspaceId}/recurring/occurrences?${trayQuery()}`)
        .then((r) => {
          if (!cancelled && r.data) setTray(trayCountOf(r.data));
        })
        .catch(() => undefined);
    };
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    window.addEventListener(RECURRING_CHANGED, refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener(RECURRING_CHANGED, refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [api, workspaceId]);

  return (
    <NavCountView
      count={tray.count}
      hasMore={tray.hasMore}
      label={t('recurringPending', { count: tray.count })}
    />
  );
}
