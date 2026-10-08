'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, type ReactNode } from 'react';
import type { FinanceApiClient } from '../../bff/finance-api-client';
import { DEFAULT_TIME_ZONE } from '../common/dates';
import type { FormatContext } from '../dashboard/types';
import { useSession } from '../session-context';
import { formatLocaleFor, NOTIFICATIONS_CHANGED } from './logic';

/**
 * Datos que necesitan las pantallas de notificaciones: cliente de la API, ruta del workspace activo y, para formatear,
 * el idioma de la UI y la zona horaria del USUARIO (las notificaciones son personales; no usan la del workspace).
 */
export interface NotificationsContext {
  readonly api: FinanceApiClient;
  readonly base: string;
  readonly workspaceId: string;
  readonly uiLocale: string;
  readonly formatLocale: string;
  readonly timeZone: string;
}

/** `undefined` mientras no haya sesión lista con un workspace activo. */
export function useNotificationsContext(): NotificationsContext | undefined {
  const { state } = useSession();
  const uiLocale = useLocale();
  return useMemo(() => {
    if (state.status !== 'ready' || !state.active) return undefined;
    const workspaceId = state.active.workspaceId;
    return {
      api: state.api,
      base: `/workspaces/${workspaceId}`,
      workspaceId,
      uiLocale,
      formatLocale: formatLocaleFor(uiLocale),
      timeZone: state.me.timezone || DEFAULT_TIME_ZONE,
    };
  }, [state, uiLocale]);
}

/** Contexto de formato del namespace `Notifications` con la zona del usuario. */
export function useNotificationsFormat(
  ctx: Pick<NotificationsContext, 'formatLocale' | 'timeZone'>,
): FormatContext {
  const t = useTranslations('Notifications');
  return useMemo(
    () => ({
      locale: ctx.formatLocale,
      timeZone: ctx.timeZone,
      t: (key: string, values?: Record<string, string | number>) => t(key as never, values as never),
      has: (key: string) => t.has(key as never),
    }),
    [t, ctx.formatLocale, ctx.timeZone],
  );
}

/** Espera sesión y workspace activo; si no hay workspace muestra el aviso común. */
export function WithNotifications({ children }: { children: (ctx: NotificationsContext) => ReactNode }) {
  const ctx = useNotificationsContext();
  const t = useTranslations('Notifications');
  const { state } = useSession();
  if (ctx) return <>{children(ctx)}</>;
  if (state.status === 'ready') return <p data-testid="no-workspace">{t('noWorkspace')}</p>;
  return (
    <p data-testid="page-loading" aria-busy="true">
      {t('loading')}
    </p>
  );
}

/** Avisa a la campana de que cambió el estado de alguna notificación (refresca el contador). */
export function notifyNotificationsChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}
