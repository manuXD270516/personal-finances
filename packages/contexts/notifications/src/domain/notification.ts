import { DomainError } from '@pf/shared-kernel';
import type { NotificationPlan } from './type-catalog.js';
import type { NotificationState, NotificationStatus } from './types.js';

/**
 * AR `Notification` (design § Contexto): transiciones `UNREAD → READ → ARCHIVED` idempotentes. Archivar desde
 * `UNREAD` es válido (descarta sin leer); leer una archivada no la desarchiva. Las funciones son puras: la
 * persistencia aplica el mismo efecto con una sentencia atómica (`UPDATE … WHERE status = …`).
 */

export interface NewNotificationInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly sourceEventId: string;
  readonly createdAt: string;
  readonly plan: NotificationPlan;
}

export function createNotification(input: NewNotificationInput): NotificationState {
  const { plan } = input;
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    userId: input.userId,
    type: plan.type,
    severity: plan.severity,
    messageKey: plan.messageKey,
    params: plan.params,
    link: plan.link,
    dedupeKey: plan.dedupeKey,
    sourceEventId: input.sourceEventId,
    status: 'UNREAD',
    createdAt: input.createdAt,
    readAt: null,
    archivedAt: null,
  };
}

/** Marca como leída (idempotente). Una archivada se queda archivada. */
export function markRead(state: NotificationState, now: string): NotificationState {
  if (state.status !== 'UNREAD') return state;
  return { ...state, status: 'READ', readAt: now };
}

/** Archiva (idempotente). Conserva `readAt` si ya estaba leída. */
export function archive(state: NotificationState, now: string): NotificationState {
  if (state.status === 'ARCHIVED') return state;
  return { ...state, status: 'ARCHIVED', archivedAt: now };
}

/** Estados visibles por defecto en la bandeja (las archivadas solo al filtrar por ellas). */
export const DEFAULT_INBOX_STATUSES: readonly NotificationStatus[] = ['UNREAD', 'READ'];

export function parseStatusFilter(value: unknown): NotificationStatus | undefined {
  if (value === undefined) return undefined;
  if (value === 'UNREAD' || value === 'READ' || value === 'ARCHIVED') return value;
  throw new DomainError('VALIDATION_FAILED', 'status must be UNREAD, READ or ARCHIVED').at('/status');
}
