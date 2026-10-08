import type { FinanceApiClient } from '../../bff/finance-api-client';
import {
  inboxQuery,
  preferencesInput,
  type AppNotification,
  type InboxFilter,
  type NotificationPage,
  type NotificationPreferences,
  type PreferencesDraft,
} from './logic';

/**
 * Llamadas a la API de notificaciones (contrato `Notifications`) por el cliente del BFF. Los POST de notificaciones
 * son idempotentes por naturaleza y NO llevan `Idempotency-Key` (`idempotent: false`).
 */
type Api = Pick<FinanceApiClient, 'get' | 'command'>;

/** Contador de no leídas; `unread` es `undefined` si la API respondió 304 (sin cambios desde el `etag`). */
export async function fetchUnreadCount(
  api: Api,
  base: string,
  etag?: string,
): Promise<{ unread: number | undefined; etag: string | undefined }> {
  const r = await api.get<{ unread: number }>(`${base}/notifications/unread-count`, {
    ...(etag ? { etag } : {}),
  });
  return { unread: r.data?.unread, etag: r.etag };
}

export async function listNotifications(
  api: Api,
  base: string,
  filter: InboxFilter,
  cursor?: string | null,
): Promise<NotificationPage | undefined> {
  return (await api.get<NotificationPage>(`${base}/notifications?${inboxQuery(filter, cursor)}`)).data;
}

export async function getNotification(
  api: Api,
  base: string,
  id: string,
): Promise<AppNotification | undefined> {
  return (await api.get<AppNotification>(`${base}/notifications/${encodeURIComponent(id)}`)).data;
}

/** Marca como leída o archiva (idempotente); devuelve la notificación actualizada. */
export async function transitionNotification(
  api: Api,
  base: string,
  id: string,
  verb: 'read' | 'archive',
): Promise<AppNotification | undefined> {
  const r = await api.command<AppNotification>(
    'POST',
    `${base}/notifications/${encodeURIComponent(id)}/${verb}`,
    undefined,
    { idempotent: false },
  );
  return r.data;
}

/** Marca todas como leídas; devuelve cuántas cambiaron. */
export async function markAllNotificationsRead(api: Api, base: string): Promise<number> {
  const r = await api.command<{ updated: number }>('POST', `${base}/notifications/read-all`, undefined, {
    idempotent: false,
  });
  return r.data?.updated ?? 0;
}

/**
 * Marca como leída al abrir el detalle UNA sola vez por notificación (aunque el efecto se ejecute dos veces, p. ej.
 * React StrictMode): devuelve la notificación actualizada, o `undefined` si no correspondía o ya se había marcado.
 */
export function createReadOnce(): (
  api: Api,
  base: string,
  n: AppNotification,
) => Promise<AppNotification | undefined> {
  const done = new Set<string>();
  return async (api, base, n) => {
    const key = `${base}:${n.id}`;
    if (n.status !== 'UNREAD' || done.has(key)) return undefined;
    done.add(key);
    return transitionNotification(api, base, n.id, 'read');
  };
}

export interface SavedPreferences {
  readonly prefs: NotificationPreferences;
  /** Versión (ETag) recibida: va en `If-Match` del siguiente guardado. */
  readonly etag: string | number;
}

export async function loadPreferences(api: Api, base: string): Promise<SavedPreferences | undefined> {
  const r = await api.get<NotificationPreferences>(`${base}/notification-preferences`);
  return r.data ? { prefs: r.data, etag: r.etag ?? r.data.version } : undefined;
}

/** `PUT` de las preferencias con `If-Match` = versión recibida (412 si cambiaron desde que se cargaron). */
export async function savePreferences(
  api: Api,
  base: string,
  saved: SavedPreferences,
  draft: PreferencesDraft,
): Promise<SavedPreferences | undefined> {
  const r = await api.command<NotificationPreferences>(
    'PUT',
    `${base}/notification-preferences`,
    preferencesInput(draft),
    { ifMatch: saved.etag, idempotent: false },
  );
  return r.data ? { prefs: r.data, etag: r.etag ?? r.data.version } : undefined;
}
