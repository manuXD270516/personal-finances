'use client';

import { useEffect, useRef, useState } from 'react';
import { FinanceApiError, type ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { problemOf } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { periodName } from '../planning/logic';
import { localized } from '../session-context';
import {
  notifyNotificationsChanged,
  useNotificationsFormat,
  WithNotifications,
  type NotificationsContext,
} from './context';
import { resourcePath, type AppNotification } from './logic';
import { createReadOnce, getNotification } from './service';
import { NotificationDate, SeverityBadge, StatusTag, EmailStatusBadge } from './NotificationItem';

export function NotificationDetail({ notificationId }: { notificationId: string }) {
  return (
    <WithNotifications>{(ctx) => <Detail ctx={ctx} notificationId={notificationId} />}</WithNotifications>
  );
}

type Loaded =
  | { readonly status: 'loading' }
  | { readonly status: 'notFound' }
  | { readonly status: 'error'; readonly problem: ApiProblemBody }
  | { readonly status: 'ready'; readonly notification: AppNotification };

/**
 * Detalle (`/notificaciones/{id}`, destino del enlace de los emails): carga la notificación, la marca como leída una
 * sola vez al abrirla y ofrece el enlace al recurso de origen. Una ajena o inexistente responde 404 (indistinguibles).
 */
function Detail({ ctx, notificationId }: { ctx: NotificationsContext; notificationId: string }) {
  const f = useNotificationsFormat(ctx);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });
  const readOnce = useRef(createReadOnce());

  useEffect(() => {
    let cancelled = false;
    setLoaded({ status: 'loading' });
    (async () => {
      try {
        const notification = await getNotification(ctx.api, ctx.base, notificationId);
        if (cancelled || !notification) return;
        setLoaded({ status: 'ready', notification });
        try {
          const read = await readOnce.current(ctx.api, ctx.base, notification);
          if (read) {
            notifyNotificationsChanged();
            if (!cancelled) setLoaded({ status: 'ready', notification: read });
          }
        } catch {
          // Marcar como leída es secundario: la notificación ya se muestra; el contador se corrige en el siguiente ciclo.
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof FinanceApiError && err.status === 404) setLoaded({ status: 'notFound' });
        else setLoaded({ status: 'error', problem: problemOf(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ctx, notificationId]);

  return (
    <NotificationDetailView
      f={f}
      uiLocale={ctx.uiLocale}
      loaded={loaded}
      href={(path) => localized(ctx.uiLocale, path)}
    />
  );
}

/** Vista del detalle (presentacional y testeable con `renderToStaticMarkup`). */
export function NotificationDetailView({
  f,
  uiLocale,
  loaded,
  href,
}: {
  f: FormatContext;
  uiLocale: string;
  loaded: Loaded;
  href: (path: string) => string;
}) {
  const back = (
    <a href={href('/notificaciones')} data-testid="notification-back">
      {f.t('detail.back')}
    </a>
  );
  if (loaded.status === 'loading') {
    return (
      <section style={pageStyle} aria-busy="true">
        <h1>{f.t('title')}</h1>
        <p data-testid="notification-loading">{f.t('detail.loading')}</p>
      </section>
    );
  }
  if (loaded.status === 'notFound' || loaded.status === 'error') {
    return (
      <section style={pageStyle}>
        <h1>{f.t('title')}</h1>
        {loaded.status === 'notFound' ? (
          <p role="alert" data-error-code="RESOURCE_NOT_FOUND" data-testid="notification-not-found">
            {f.t('detail.notFound')}
          </p>
        ) : (
          <ProblemMessage problem={loaded.problem} locale={uiLocale} />
        )}
        <p>{back}</p>
      </section>
    );
  }
  const n = loaded.notification;
  const target = resourcePath(n.link);
  const period = periodName(n.link.periodLabel, f.locale);
  return (
    <section
      aria-labelledby="notification-title"
      style={pageStyle}
      data-testid="notification-detail"
      data-notification-id={n.id}
      data-status={n.status}
    >
      <p style={{ margin: 0 }}>{back}</p>
      <h1 id="notification-title" data-testid="notification-title">
        {n.title}
      </h1>
      <div style={{ ...rowStyle, alignItems: 'center' }}>
        <SeverityBadge severity={n.severity} f={f} />
        <StatusTag status={n.status} f={f} />
        {n.emailStatus ? <EmailStatusBadge status={n.emailStatus} f={f} /> : null}
      </div>
      <p style={{ margin: 0 }} data-testid="notification-body">
        {n.body}
      </p>
      <p style={mutedStyle}>
        {f.t('detail.received')}: <NotificationDate iso={n.createdAt} f={f} />
      </p>
      {target ? (
        <p style={{ margin: 0 }}>
          <a href={href(target)} data-testid="notification-open-resource" data-link-kind={n.link.kind}>
            {n.link.kind === 'PERIOD_CLOSE'
              ? f.t('detail.openPeriodClose', { period })
              : n.link.kind === 'RECURRING_OCCURRENCE'
                ? f.t('detail.openRecurringOccurrence', { period })
                : n.link.kind === 'SUBSCRIPTION'
                  ? f.t('detail.openSubscription', { period })
                  : f.t('detail.openBudgetLine', { period })}
          </a>
        </p>
      ) : null}
    </section>
  );
}
