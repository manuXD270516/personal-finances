/** Tipos del dominio NOTIFY (openspec add-alerts, design.md § Contexto). Sin dependencias de frameworks. */

/** Tipos de notificación de Phase 2; el catálogo crece por fase (FR-NOTIFY-004). */
export const NOTIFICATION_TYPES = ['BUDGET_THRESHOLD', 'MONTH_CLOSE_PENDING'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const isNotificationType = (value: unknown): value is NotificationType =>
  typeof value === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(value);

/** Canales del usuario (preferencias). El in-app es el canal de referencia; el email es el único externo. */
export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export type NotificationSeverity = 'INFO' | 'WARNING';
export type NotificationStatus = 'UNREAD' | 'READ' | 'ARCHIVED';
export const NOTIFICATION_STATUSES: readonly NotificationStatus[] = ['UNREAD', 'READ', 'ARCHIVED'];

export type WorkspaceRoleName = 'OWNER' | 'EDITOR' | 'VIEWER';

/** Idiomas con catálogo de mensajes (NFR-USAB-001); español de respaldo. */
export const NOTIFICATION_LOCALES = ['es', 'en', 'pt'] as const;
export type NotificationLocale = (typeof NOTIFICATION_LOCALES)[number];
export const FALLBACK_LOCALE: NotificationLocale = 'es';

/** `es-*`→`es`, `en-*`→`en`, `pt-*`→`pt`, cualquier otro (o ausente) → español (design decisión 3). */
export function notificationLocaleOf(tag: string | null | undefined): NotificationLocale {
  const language = (tag ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';
  return (NOTIFICATION_LOCALES as readonly string[]).includes(language)
    ? (language as NotificationLocale)
    : FALLBACK_LOCALE;
}

export interface MoneyParam {
  readonly amount: string;
  readonly currency: string;
}

export type BudgetTargetKind = 'CATEGORY' | 'GROUP' | 'TAG';

/**
 * Enlace al recurso de origen (design decisión 4). La web lo traduce a ruta; si la línea ya no existe, el plan del
 * periodo muestra el aviso "ya no disponible" (la notificación no se modifica).
 */
export type NotificationLink =
  | {
      readonly kind: 'BUDGET_LINE';
      readonly periodId: string;
      readonly periodLabel: string;
      readonly budgetId: string;
      readonly budgetLineId: string;
      readonly targetKind: BudgetTargetKind;
      readonly targetId: string;
    }
  | { readonly kind: 'PERIOD_CLOSE'; readonly periodId: string; readonly periodLabel: string };

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Parámetros guardados con la notificación: ids, umbral, montos como string decimal + moneda y periodo (decisión 3). */
export type NotificationParams = { readonly [key: string]: JsonValue };

/** Estado persistido de una notificación (AR `Notification`). */
export interface NotificationState {
  readonly id: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly type: NotificationType;
  readonly severity: NotificationSeverity;
  readonly messageKey: string;
  readonly params: NotificationParams;
  readonly link: NotificationLink;
  readonly dedupeKey: string;
  readonly sourceEventId: string;
  readonly status: NotificationStatus;
  readonly createdAt: string;
  readonly readAt: string | null;
  readonly archivedAt: string | null;
}
