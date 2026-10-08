'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { useNotificationsContext } from './context';
import { createUnreadPoller, unreadBadge } from './logic';
import { fetchUnreadCount } from './service';

type T = (key: string, values?: Record<string, string | number>) => string;

/**
 * Campana de la barra superior (presentacional): enlace a la bandeja con el contador de no leídas. El nombre accesible
 * es "Notificaciones (N sin leer)" (texto `sr-only`); el contador visual es decorativo y la región `aria-live`
 * anuncia solo cuando el contador cambia (no en cada consulta).
 */
export function NotificationBellView({
  count,
  href,
  current,
  t,
}: {
  count: number;
  href: string;
  current?: boolean;
  t: T;
}) {
  return (
    <span className="pf-bell-wrap">
      <a
        className="pf-icon-button pf-bell"
        href={href}
        data-testid="notification-bell"
        aria-current={current ? 'page' : undefined}
      >
        <BellIcon />
        {count > 0 ? (
          <span className="pf-bell-count" data-testid="notification-unread-count" aria-hidden="true">
            {unreadBadge(count)}
          </span>
        ) : null}
        <span className="pf-sr-only">
          {t('bell.label')}
          {count > 0 ? ` ${t('bell.unreadHint', { count })}` : ''}
        </span>
      </a>
      <span className="pf-sr-only" aria-live="polite" data-testid="notification-live">
        {count > 0 ? t('bell.announce', { count }) : ''}
      </span>
    </span>
  );
}

/**
 * Campana conectada: consulta el contador al montar, cada 60 s, al recuperar foco/visibilidad y cuando la bandeja
 * avisa de un cambio; sin SSE y en pausa con la pestaña oculta. Un fallo de la consulta se ignora.
 */
export function NotificationBell({ href, current }: { href: string; current?: boolean }) {
  const t = useTranslations('Notifications');
  const ctx = useNotificationsContext();
  const [count, setCount] = useState(0);
  const etag = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!ctx) return;
    setCount(0);
    etag.current = undefined;
    const poller = createUnreadPoller({
      fetchCount: async () => {
        const result = await fetchUnreadCount(ctx.api, ctx.base, etag.current);
        etag.current = result.etag;
        return result.unread;
      },
      onCount: setCount,
      doc: document,
      win: window,
    });
    poller.start();
    return () => poller.stop();
  }, [ctx]);

  if (!ctx) return null;
  return (
    <NotificationBellView
      count={count}
      href={href}
      {...(current !== undefined ? { current } : {})}
      t={(key, values) => t(key as never, values as never)}
    />
  );
}

function BellIcon() {
  return (
    <svg
      className="pf-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7zM10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}
