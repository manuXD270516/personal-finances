'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiProblemBody } from '../../bff/finance-api-client';
import { ProblemMessage } from '../../errors/ProblemMessage';
import { tabTarget } from '../common/Tabs';
import { mutedStyle, pageStyle, rowStyle } from '../common/ui';
import { problemOf } from '../common/workspace';
import type { FormatContext } from '../dashboard/types';
import { localized } from '../session-context';
import {
  notifyNotificationsChanged,
  useNotificationsFormat,
  WithNotifications,
  type NotificationsContext,
} from './context';
import {
  appendPage,
  applyReadAll,
  applyUpdated,
  canMarkAllRead,
  detailPath,
  INBOX_FILTERS,
  type AppNotification,
  type InboxFilter,
} from './logic';
import { NotificationItemView } from './NotificationItem';
import { listNotifications, markAllNotificationsRead, transitionNotification } from './service';

export function NotificationInbox() {
  return <WithNotifications>{(ctx) => <Inbox ctx={ctx} />}</WithNotifications>;
}

/**
 * Bandeja de notificaciones (`/notificaciones`): filtros Recientes / Sin leer / Archivadas, "Cargar más" con cursor,
 * marcar leída, archivar y marcar todas. Tras cada acción actualiza la lista local y avisa a la campana.
 */
function Inbox({ ctx }: { ctx: NotificationsContext }) {
  const f = useNotificationsFormat(ctx);
  const [filter, setFilter] = useState<InboxFilter>('RECENT');
  const [items, setItems] = useState<readonly AppNotification[] | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [problem, setProblem] = useState<ApiProblemBody | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const request = useRef(0);

  const load = useCallback(() => {
    const mine = (request.current += 1);
    setItems(undefined);
    setProblem(undefined);
    listNotifications(ctx.api, ctx.base, filter)
      .then((page) => {
        if (mine !== request.current) return;
        setItems(page?.data ?? []);
        setHasMore(page?.page.hasMore ?? false);
        setNextCursor(page?.page.nextCursor ?? null);
      })
      .catch((err: unknown) => {
        if (mine !== request.current) return;
        setProblem(problemOf(err));
        setItems([]);
        setHasMore(false);
      });
  }, [ctx, filter]);
  useEffect(load, [load]);

  async function loadMore() {
    if (!hasMore || !nextCursor || loadingMore) return;
    const mine = request.current;
    setLoadingMore(true);
    try {
      const page = await listNotifications(ctx.api, ctx.base, filter, nextCursor);
      if (mine !== request.current) return;
      setItems((current) => appendPage(current ?? [], page?.data ?? []));
      setHasMore(page?.page.hasMore ?? false);
      setNextCursor(page?.page.nextCursor ?? null);
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setLoadingMore(false);
    }
  }

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setProblem(undefined);
    setStatus(undefined);
    try {
      await action();
      notifyNotificationsChanged();
    } catch (err) {
      setProblem(problemOf(err));
    } finally {
      setBusy(false);
    }
  }

  const transition = (n: AppNotification, verb: 'read' | 'archive') =>
    act(async () => {
      const updated = await transitionNotification(ctx.api, ctx.base, n.id, verb);
      if (updated) setItems((current) => applyUpdated(current ?? [], filter, updated));
      setStatus(f.t(verb === 'read' ? 'done.read' : 'done.archived'));
    });

  const markAll = () =>
    act(async () => {
      const updated = await markAllNotificationsRead(ctx.api, ctx.base);
      const now = new Date().toISOString();
      setItems((current) => applyReadAll(current ?? [], filter, now));
      setStatus(f.t('done.allRead', { count: updated }));
    });

  return (
    <InboxView
      f={f}
      uiLocale={ctx.uiLocale}
      filter={filter}
      onFilter={(next) => {
        setStatus(undefined);
        setFilter(next);
      }}
      items={items}
      hasMore={hasMore}
      loadingMore={loadingMore}
      busy={busy}
      problem={problem}
      status={status}
      href={(path) => localized(ctx.uiLocale, path)}
      onMarkRead={(n) => void transition(n, 'read')}
      onArchive={(n) => void transition(n, 'archive')}
      onMarkAll={() => void markAll()}
      onLoadMore={() => void loadMore()}
    />
  );
}

/** Vista de la bandeja (presentacional y testeable con `renderToStaticMarkup`). */
export function InboxView({
  f,
  uiLocale,
  filter,
  onFilter,
  items,
  hasMore,
  loadingMore,
  busy,
  problem,
  status,
  href,
  onMarkRead,
  onArchive,
  onMarkAll,
  onLoadMore,
}: {
  f: FormatContext;
  uiLocale: string;
  filter: InboxFilter;
  onFilter: (filter: InboxFilter) => void;
  items: readonly AppNotification[] | undefined;
  hasMore: boolean;
  loadingMore: boolean;
  busy: boolean;
  problem?: ApiProblemBody | undefined;
  status?: string | undefined;
  href: (path: string) => string;
  onMarkRead?: (n: AppNotification) => void;
  onArchive?: (n: AppNotification) => void;
  onMarkAll?: () => void;
  onLoadMore?: () => void;
}) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const markAllEnabled = canMarkAllRead(filter, items ?? [], hasMore);

  return (
    <section
      aria-labelledby="notifications-title"
      style={{ ...pageStyle, gridTemplateColumns: 'minmax(0, 1fr)' }}
    >
      <h1 id="notifications-title">{f.t('title')}</h1>
      <p style={mutedStyle}>{f.t('intro')}</p>
      <div style={{ ...rowStyle, justifyContent: 'space-between', alignItems: 'center' }}>
        <div
          role="tablist"
          aria-label={f.t('filters.label')}
          style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}
        >
          {INBOX_FILTERS.map((id, i) => {
            const selected = id === filter;
            return (
              <button
                key={id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`inbox-tab-${id}`}
                aria-selected={selected}
                aria-controls="inbox-panel"
                tabIndex={selected ? 0 : -1}
                data-testid={`notifications-filter-${id}`}
                style={{
                  font: 'inherit',
                  minHeight: '2.75rem',
                  padding: 'var(--pf-space-2) var(--pf-space-3)',
                  borderRadius: 'var(--pf-radius-sm)',
                  fontWeight: selected ? 700 : 500,
                  color: selected ? 'var(--pf-primary)' : 'var(--pf-fg)',
                  borderColor: selected ? 'var(--pf-primary)' : 'var(--pf-control-border)',
                  background: selected ? 'var(--pf-primary-soft)' : 'var(--pf-bg)',
                }}
                onClick={() => onFilter(id)}
                onKeyDown={(e) => {
                  const next = tabTarget(e.key, i, INBOX_FILTERS.length);
                  if (next === null) return;
                  e.preventDefault();
                  onFilter(INBOX_FILTERS[next]!);
                  tabRefs.current[next]?.focus();
                }}
              >
                {f.t(`filters.${id}`)}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          disabled={busy || !markAllEnabled}
          data-testid="notifications-mark-all-read"
          onClick={onMarkAll}
        >
          {f.t('markAllRead')}
        </button>
      </div>
      <p role="status" data-testid="notifications-status" style={{ margin: 0 }}>
        {status}
      </p>
      {problem ? <ProblemMessage problem={problem} locale={uiLocale} /> : null}
      <div
        id="inbox-panel"
        role="tabpanel"
        aria-labelledby={`inbox-tab-${filter}`}
        style={{ display: 'grid', gap: 'var(--pf-space-3)' }}
      >
        {items === undefined ? (
          <p aria-busy="true" data-testid="notifications-loading">
            {f.t('loading')}
          </p>
        ) : items.length === 0 ? (
          problem ? null : (
            <p data-testid="notifications-empty" style={mutedStyle}>
              {f.t('empty')}
            </p>
          )
        ) : (
          <ul
            aria-label={f.t('list.label')}
            data-testid="notification-list"
            style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--pf-space-3)' }}
          >
            {items.map((n) => (
              <NotificationItemView
                key={n.id}
                notification={n}
                f={f}
                detailHref={href(detailPath(n.id))}
                busy={busy}
                {...(onMarkRead ? { onMarkRead } : {})}
                {...(onArchive ? { onArchive } : {})}
              />
            ))}
          </ul>
        )}
        {hasMore && items ? (
          <div>
            <button
              type="button"
              disabled={loadingMore}
              data-testid="notifications-load-more"
              onClick={onLoadMore}
            >
              {loadingMore ? f.t('loadingMore') : f.t('loadMore')}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
