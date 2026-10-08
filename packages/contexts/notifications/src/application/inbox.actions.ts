import { DomainError } from '@pf/shared-kernel';
import { presentNotifications, type NotificationView } from './inbox-view.js';
import type { InboxDeps } from './ports/index.js';

const notFound = (id: string): DomainError =>
  new DomainError('RESOURCE_NOT_FOUND', `notification ${id} not found`);

/**
 * Acciones del usuario sobre SU bandeja (openspec add-alerts): marcar leída, marcar todas y archivar. Idempotentes.
 * Sin auditoría: leer/archivar no es dato financiero ni de configuración y es de alto volumen (docs/33 D92); los
 * cambios de preferencias sí se auditan (`PreferencesService`). Acceder a una notificación de otro usuario o de otro
 * workspace responde `RESOURCE_NOT_FOUND`, indistinguible de una inexistente (RLS + filtro por usuario).
 */
export class InboxActions {
  constructor(private readonly deps: InboxDeps) {}

  markRead(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly notificationId: string;
  }): Promise<NotificationView> {
    return this.change(input, (repo, now) =>
      repo.markRead(input.workspaceId, input.userId, input.notificationId, now),
    );
  }

  archive(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly notificationId: string;
  }): Promise<NotificationView> {
    return this.change(input, (repo, now) =>
      repo.archive(input.workspaceId, input.userId, input.notificationId, now),
    );
  }

  /** Marca como leídas las no leídas del usuario; devuelve cuántas cambió. */
  markAllRead(input: { readonly workspaceId: string; readonly userId: string }): Promise<number> {
    const { workspaceId, userId } = input;
    return this.deps.uow.run(workspaceId, () =>
      this.deps.notifications.markAllRead(workspaceId, userId, this.deps.clock.now().toString()),
    );
  }

  private change(
    input: { readonly workspaceId: string; readonly userId: string; readonly notificationId: string },
    apply: (repo: InboxDeps['notifications'], now: string) => Promise<boolean>,
  ): Promise<NotificationView> {
    const { workspaceId, userId, notificationId } = input;
    return this.deps.uow.run(workspaceId, async () => {
      if (!(await apply(this.deps.notifications, this.deps.clock.now().toString()))) {
        throw notFound(notificationId);
      }
      const state = await this.deps.notifications.findOwn(workspaceId, userId, notificationId);
      if (!state) throw notFound(notificationId);
      const [view] = await presentNotifications(this.deps, { workspaceId, userId }, [state]);
      if (!view) throw notFound(notificationId);
      return view;
    });
  }
}
