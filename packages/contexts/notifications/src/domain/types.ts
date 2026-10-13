/** Tipos del dominio NOTIFY (openspec add-alerts, design.md § Contexto). Sin dependencias de frameworks. */

/** Tipos de notificación; el catálogo crece por fase (FR-NOTIFY-004). */
export const NOTIFICATION_TYPES = [
  'BUDGET_THRESHOLD',
  'MONTH_CLOSE_PENDING',
  // Phase 3 (add-recurrence-engine, FR-NOTIFY-004): una ocurrencia recurrente pasó a próxima.
  'RECURRING_PAYMENT_UPCOMING',
  'RECURRING_APPROVAL_REQUIRED',
  // Phase 3 (add-subscriptions, FR-NOTIFY-004): renovación, fin de trial y posible cambio de precio de una suscripción.
  'SUBSCRIPTION_RENEWAL',
  'SUBSCRIPTION_TRIAL_ENDING',
  'SUBSCRIPTION_PRICE_CHANGE',
  // Phase 4 (add-credit-cards, FR-NOTIFY-004): vencimiento del estado de cuenta y utilización del crédito de una tarjeta.
  'CARD_PAYMENT_DUE',
  'CARD_UTILIZATION',
  // Phase 4 (add-savings-goals, FR-NOTIFY-004): sobre-asignación de una cuenta, meta alcanzada e hitos 25/50/75 %.
  'GOAL_OVER_ALLOCATED',
  'GOAL_REACHED',
  'GOAL_MILESTONE',
  // Phase 5 (add-rate-feed-alerts, FR-NOTIFY-004): par sin tasa automática, par recuperado y muestra retenida como
  // anómala. Se entregan por `NotificationIntakePort` desde el job de providers de FX, sin consumidor de eventos (D249).
  'FX_RATE_FEED_STALE',
  'FX_RATE_FEED_RECOVERED',
  'FX_RATE_ANOMALY_RETAINED',
] as const;
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
  | { readonly kind: 'PERIOD_CLOSE'; readonly periodId: string; readonly periodLabel: string }
  /**
   * Ocurrencia recurrente (add-recurrence-engine): la web la traduce a `/recurring/occurrences/<occurrenceId>`.
   * `periodId` es el periodo financiero del vencimiento (el id de la ocurrencia si ninguno lo cubre) y `periodLabel`
   * el mes del vencimiento: el contrato HTTP del enlace los exige en todos sus tipos.
   */
  | {
      readonly kind: 'RECURRING_OCCURRENCE';
      readonly occurrenceId: string;
      readonly periodId: string;
      readonly periodLabel: string;
    }
  /**
   * Suscripción (add-subscriptions): la web abre `/recurring/suscripciones/<subscriptionId>` (con `?propuesta=` si hay
   * `proposalId`); si la suscripción ya no existe o fue cancelada, muestra el listado con el aviso "ya no está
   * disponible". `periodId` es el id de la suscripción y `periodLabel` el mes de la fecha del hecho: el contrato HTTP
   * del enlace los exige en todos sus tipos.
   */
  | {
      readonly kind: 'SUBSCRIPTION';
      readonly subscriptionId: string;
      readonly proposalId?: string;
      readonly periodId: string;
      readonly periodLabel: string;
    }
  /**
   * Tarjeta de crédito (add-credit-cards): la web abre la tarjeta (y su estado de cuenta si hay `statementId`); si ya
   * no existe muestra el listado con el aviso "ya no está disponible". `periodId` es el id de la tarjeta y
   * `periodLabel` el mes del vencimiento (o del cruce): el contrato HTTP del enlace los exige en todos sus tipos.
   */
  | {
      readonly kind: 'CREDIT_CARD';
      readonly cardId: string;
      readonly statementId?: string;
      readonly periodId: string;
      readonly periodLabel: string;
    }
  /**
   * Meta de ahorro (add-savings-goals): la web abre la meta; si ya no existe muestra el listado con el aviso "ya no
   * está disponible". `periodId` es el id de la meta y `periodLabel` el mes del hecho (el contrato HTTP del enlace los
   * exige en todos sus tipos).
   */
  | {
      readonly kind: 'GOAL';
      readonly goalId: string;
      readonly periodId: string;
      readonly periodLabel: string;
    }
  /**
   * Reservas de una cuenta (add-savings-goals, sobre-asignación): la web abre las reservas de la cuenta. `periodId` es
   * el id de la cuenta y `periodLabel` el mes de detección.
   */
  | {
      readonly kind: 'GOAL_RESERVATIONS';
      readonly accountId: string;
      readonly periodId: string;
      readonly periodLabel: string;
    }
  | FxNotificationLink;

/**
 * Alertas de tasas (add-rate-feed-alerts): `FX_FEED_STATUS` abre el estado de las tasas automáticas (Configuración →
 * Tasas automáticas) y `FX_RATE` la revisión de una tasa retenida (Tasas → Proveedores). En `FX_FEED_STATUS`
 * `periodId` es el id del episodio y en `FX_RATE` el de la tasa; `periodLabel` es el mes del hecho en la zona del
 * workspace (el contrato HTTP del enlace los exige en todos sus tipos).
 */
export type FxNotificationLink =
  | { readonly kind: 'FX_FEED_STATUS'; readonly periodId: string; readonly periodLabel: string }
  | {
      readonly kind: 'FX_RATE';
      readonly fxRateId: string;
      readonly periodId: string;
      readonly periodLabel: string;
    };

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
