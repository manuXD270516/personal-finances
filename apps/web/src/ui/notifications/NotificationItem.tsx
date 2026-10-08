import type { CSSProperties } from 'react';
import { badgeStyle, mutedStyle } from '../common/ui';
import type { FormatContext } from '../dashboard/types';
import { formatInstant, severityPresentation, type AppNotification } from './logic';

/** Severidad con icono decorativo + TEXTO (nunca solo color, NFR-USAB-104). */
export function SeverityBadge({ severity, f }: { severity: string; f: FormatContext }) {
  const p = severityPresentation(severity);
  const key = `item.severity.${severity}`;
  return (
    <span
      style={{ ...badgeStyle, color: p.color, borderColor: p.color }}
      data-testid="notification-severity"
      data-severity={severity}
    >
      <span aria-hidden="true">{p.icon}</span> {f.has(key) ? f.t(key) : severity}
    </span>
  );
}

/** Estado de entrega del email (solo si la API lo informa); texto discreto, sin dirección. */
export function EmailStatusBadge({ status, f }: { status: string; f: FormatContext }) {
  const key = `item.emailStatus.${status}`;
  return (
    <small style={mutedStyle} data-testid="notification-email-status" data-email-status={status}>
      {f.t('item.email', { status: f.has(key) ? f.t(key) : status })}
    </small>
  );
}

export function NotificationDate({ iso, f }: { iso: string; f: FormatContext }) {
  return (
    <time dateTime={iso} style={mutedStyle} data-testid="notification-date">
      {formatInstant(iso, f.locale, f.timeZone)}
    </time>
  );
}

const statusKey = (status: AppNotification['status']): string =>
  status === 'UNREAD' ? 'item.unread' : status === 'READ' ? 'item.read' : 'item.archived';

/** Estado con texto; "Sin leer" además se resalta con borde y fondo (el texto es la señal principal). */
export function StatusTag({ status, f }: { status: AppNotification['status']; f: FormatContext }) {
  const unread = status === 'UNREAD';
  return (
    <span
      style={{
        ...badgeStyle,
        ...(unread
          ? { fontWeight: 700, color: 'var(--pf-primary)', borderColor: 'var(--pf-primary)' }
          : { color: 'var(--pf-fg-muted)' }),
      }}
      data-testid="notification-status"
      data-status={status}
    >
      {f.t(statusKey(status))}
    </span>
  );
}

const itemStyle = (unread: boolean): CSSProperties => ({
  display: 'grid',
  gap: 'var(--pf-space-2)',
  padding: 'var(--pf-space-3) var(--pf-space-4)',
  background: unread ? 'var(--pf-primary-soft)' : 'var(--pf-surface-raised)',
  border: '1px solid var(--pf-border)',
  borderLeft: `4px solid ${unread ? 'var(--pf-primary)' : 'var(--pf-border-strong)'}`,
  borderRadius: 'var(--pf-radius-md)',
  minWidth: 0,
  overflowWrap: 'anywhere',
});

/**
 * Elemento de la bandeja. `title` y `body` llegan ya renderizados por el servidor en el idioma del usuario: se
 * muestran tal cual (la UI no recompone textos de dominio).
 */
export function NotificationItemView({
  notification: n,
  f,
  detailHref,
  busy,
  onMarkRead,
  onArchive,
}: {
  notification: AppNotification;
  f: FormatContext;
  detailHref: string;
  busy: boolean;
  onMarkRead?: (n: AppNotification) => void;
  onArchive?: (n: AppNotification) => void;
}) {
  const unread = n.status === 'UNREAD';
  return (
    <li
      style={itemStyle(unread)}
      data-testid="notification-item"
      data-notification-id={n.id}
      data-status={n.status}
      data-severity={n.severity}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-space-2)', alignItems: 'center' }}>
        <SeverityBadge severity={n.severity} f={f} />
        <StatusTag status={n.status} f={f} />
        {n.emailStatus ? <EmailStatusBadge status={n.emailStatus} f={f} /> : null}
        <span style={{ marginLeft: 'auto' }}>
          <NotificationDate iso={n.createdAt} f={f} />
        </span>
      </div>
      <h2 style={{ margin: 0, fontSize: 'var(--pf-text-lg)' }}>
        <a href={detailHref} data-testid="notification-title">
          {n.title}
        </a>
      </h2>
      <p style={{ margin: 0 }} data-testid="notification-body">
        {n.body}
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--pf-space-2)' }}>
        {unread ? (
          <button
            type="button"
            disabled={busy}
            aria-label={f.t('item.markReadNamed', { title: n.title })}
            data-testid="notification-mark-read"
            onClick={() => onMarkRead?.(n)}
          >
            {f.t('item.markRead')}
          </button>
        ) : null}
        {n.status !== 'ARCHIVED' ? (
          <button
            type="button"
            disabled={busy}
            aria-label={f.t('item.archiveNamed', { title: n.title })}
            data-testid="notification-archive"
            onClick={() => onArchive?.(n)}
          >
            {f.t('item.archive')}
          </button>
        ) : null}
      </div>
    </li>
  );
}
