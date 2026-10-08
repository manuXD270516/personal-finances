import {
  notificationLocaleOf,
  renderInApp,
  type NotificationLink,
  type NotificationParams,
  type NotificationSeverity,
  type NotificationState,
  type NotificationStatus,
  type NotificationType,
} from '../domain/index.js';
import type { DeliveryStatus, InboxDeps } from './ports/index.js';
import { targetNameIn } from './target-name.js';

/** Estado agregado de la entrega por email que expone la API (`emailStatus`); los internos se pliegan a `PENDING`. */
export type EmailStatusView = 'PENDING' | 'SENT' | 'FAILED' | 'SUPPRESSED';

/** `Notification` del contrato OpenAPI: título y cuerpo renderizados en el locale ACTUAL del usuario (decisión 3). */
export interface NotificationView {
  readonly id: string;
  readonly type: NotificationType;
  readonly severity: NotificationSeverity;
  readonly title: string;
  readonly body: string;
  readonly messageKey: string;
  readonly params: NotificationParams;
  readonly link: NotificationLink;
  readonly status: NotificationStatus;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly emailStatus?: EmailStatusView;
}

const emailStatusOf = (status: DeliveryStatus): EmailStatusView =>
  status === 'SENT' || status === 'FAILED' || status === 'SUPPRESSED' ? status : 'PENDING';

/**
 * Presenta notificaciones guardadas (message_key + params) como la API las expone: renderizadas en el locale del
 * perfil del usuario, con el nombre VIGENTE de la categoría/grupo/tag y el estado agregado del email. Cambiar el
 * locale o renombrar la categoría cambia el texto mostrado (decisión 3). Se invoca dentro de la unidad de trabajo del
 * usuario (RLS de workspace y usuario).
 */
export async function presentNotifications(
  deps: Pick<InboxDeps, 'locales' | 'catalog' | 'deliveries'>,
  input: { readonly workspaceId: string; readonly userId: string },
  states: readonly NotificationState[],
): Promise<NotificationView[]> {
  if (states.length === 0) return [];
  const { workspaceId, userId } = input;
  const locale = notificationLocaleOf(await deps.locales.localeOf(userId));
  const needsNames = states.some((s) => typeof s.params['targetId'] === 'string');
  const tree = needsNames ? await deps.catalog.categoryTree({ userId, workspaceId }) : undefined;
  const statuses = await deps.deliveries.statuses(
    workspaceId,
    states.map((s) => s.id),
  );
  return states.map((s) => {
    const kind = s.params['targetKind'];
    const id = s.params['targetId'];
    const targetName =
      tree && typeof kind === 'string' && typeof id === 'string' ? targetNameIn(tree, kind, id) : null;
    const { title, body } = renderInApp(locale, s.messageKey, s.params, { targetName });
    const delivery = statuses.get(s.id);
    return {
      id: s.id,
      type: s.type,
      severity: s.severity,
      title,
      body,
      messageKey: s.messageKey,
      params: s.params,
      link: s.link,
      status: s.status,
      createdAt: s.createdAt,
      readAt: s.readAt,
      ...(delivery ? { emailStatus: emailStatusOf(delivery) } : {}),
    };
  });
}
