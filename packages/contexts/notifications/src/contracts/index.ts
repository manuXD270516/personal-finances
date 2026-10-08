/**
 * API pública de `@pf/notifications` (openspec add-alerts). Hoja: no importa capas internas. NOTIFY no produce eventos
 * de dominio en Phase 2 (solo consume `planning.BudgetThresholdReached.v1` y `planning.MonthClosePending.v1`).
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';

export const NOTIFICATIONS_CONTEXT = 'notifications' as const;

/** Consumidores del worker: clave del inbox y nombre de la cola `events.<consumer>` (design decisión 2). */
export const NOTIFICATION_CONSUMERS = {
  budgetThreshold: 'notifications.budget-threshold',
  monthClosePending: 'notifications.month-close-pending',
} as const;

/** Colas de trabajos pg-boss del worker (design decisiones 7 y 11). */
export const EMAIL_DISPATCH_QUEUE = 'notifications.email-dispatch' as const;
export const EMAIL_SWEEP_QUEUE = 'notifications.email-sweep' as const;
export const PURGE_QUEUE = 'notifications.purge' as const;

/** Carga del trabajo `notifications.email-dispatch`: solo ids opacos (nunca la dirección ni el contenido). */
export interface EmailDispatchJob {
  readonly workspaceId: string;
  readonly deliveryId: string;
}

/** Carga de los trabajos periódicos del worker. */
export interface NotificationsMaintenanceJob {
  readonly trigger: 'cron' | 'startup' | 'manual';
}

/** Instrumentos OTel (el exportador Prometheus agrega `_total`): docs/18 §5, design decisión 12. */
export const NOTIFICATION_METRICS = {
  created: 'notifications.created',
  emailDeliveries: 'notifications.email_deliveries',
  eventLag: 'notifications.event_lag',
} as const;

/**
 * Allow-list de auditoría de las preferencias (add-audit-trail, NFR-SEC-015): los cambios de preferencias SÍ se
 * auditan (docs/33 D92); `byType.<TIPO>.<CANAL>` es un campo dinámico (comodín de prefijo) y el horario de silencio
 * viaja como texto JSON.
 */
export const NOTIFICATIONS_AUDIT_POLICY = {
  NotificationPreferences: {
    'byType.*': 'plain',
    quietHours: 'plain',
    includeDetailsInEmail: 'plain',
  },
} as const satisfies AuditFieldPoliciesDto;
