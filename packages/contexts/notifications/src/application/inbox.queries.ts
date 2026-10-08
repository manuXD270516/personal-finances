import { DEFAULT_INBOX_STATUSES, parseStatusFilter, type NotificationStatus } from '../domain/index.js';
import { presentNotifications, type NotificationView } from './inbox-view.js';
import type { InboxDeps, InboxPosition } from './ports/index.js';

/**
 * Consultas de la bandeja (openspec add-alerts § Contratos): `ListNotifications` y `GetUnreadCount`. Solo lectura y
 * siempre del usuario de la petición (RLS de usuario además del filtro explícito): una notificación ajena no existe
 * para él. Las archivadas no aparecen en la lista por defecto ni en el contador (spec "Centro de notificaciones").
 */
export class InboxQueries {
  constructor(private readonly deps: InboxDeps) {}

  /** Más reciente primero; el llamador pide `limit + 1` para saber si hay otra página. */
  async list(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly status?: unknown;
    readonly after?: InboxPosition;
    readonly limit: number;
  }): Promise<NotificationView[]> {
    const filter: NotificationStatus | undefined = parseStatusFilter(input.status);
    const statuses: readonly NotificationStatus[] = filter ? [filter] : DEFAULT_INBOX_STATUSES;
    const { workspaceId, userId } = input;
    return this.deps.uow.run(workspaceId, async () => {
      const rows = await this.deps.notifications.list({
        workspaceId,
        userId,
        statuses,
        ...(input.after ? { after: input.after } : {}),
        limit: input.limit,
      });
      return presentNotifications(this.deps, { workspaceId, userId }, rows);
    });
  }

  getUnreadCount(workspaceId: string, userId: string): Promise<number> {
    return this.deps.uow.run(workspaceId, () => this.deps.notifications.unreadCount(workspaceId, userId));
  }

  /** Una notificación propia (la ruta `/notificaciones/{id}` del enlace del email); ajena o inexistente ⇒ `null`. */
  get(workspaceId: string, userId: string, id: string): Promise<NotificationView | null> {
    return this.deps.uow.run(workspaceId, async () => {
      const found = await this.deps.notifications.findOwn(workspaceId, userId, id);
      if (!found) return null;
      const [view] = await presentNotifications(this.deps, { workspaceId, userId }, [found]);
      return view ?? null;
    });
  }
}
