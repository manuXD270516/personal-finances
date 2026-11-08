/**
 * API pública de `@pf/notifications` (openspec add-alerts). Hoja: no importa capas internas. NOTIFY no produce eventos
 * de dominio en Phase 2 (solo consume `planning.BudgetThresholdReached.v1`, `planning.MonthClosePending.v1` y `commitments.RecurringOccurrenceDue.v1`).
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';

export const NOTIFICATIONS_CONTEXT = 'notifications' as const;

/** Consumidores del worker: clave del inbox y nombre de la cola `events.<consumer>` (design decisión 2). */
export const NOTIFICATION_CONSUMERS = {
  budgetThreshold: 'notifications.budget-threshold',
  monthClosePending: 'notifications.month-close-pending',
  occurrenceDue: 'notifications.occurrence-due',
  subscriptionRenewal: 'notifications.subscription-renewal',
  subscriptionTrialEnding: 'notifications.subscription-trial-ending',
  subscriptionPriceChange: 'notifications.subscription-price-change',
  cardPaymentDue: 'notifications.card-payment-due',
  creditUtilization: 'notifications.card-utilization',
  goalOverAllocated: 'notifications.goal-over-allocated',
  goalReached: 'notifications.goal-reached',
  goalMilestone: 'notifications.goal-milestone',
} as const;

/** Colas de trabajos pg-boss del worker (design decisiones 7 y 11). */
export const EMAIL_DISPATCH_QUEUE = 'notifications.email-dispatch' as const;
export const EMAIL_SWEEP_QUEUE = 'notifications.email-sweep' as const;
export const PURGE_QUEUE = 'notifications.purge' as const;
/** Digest periódico del Home (add-cash-flow-forecast, D385): un job de la `JobQueue`, sin consumidor de eventos. */
export const DIGEST_QUEUE = 'notifications.digest' as const;

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
  /** Avisos existentes actualizados por una muestra posterior del mismo grupo (refine-rate-anomaly-alert-grouping). */
  refreshed: 'notifications.refreshed',
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
    // add-cash-flow-forecast (FR-NOTIFY-007): frecuencia del digest por email (OFF | WEEKLY | MONTHLY).
    digestFrequency: 'plain',
  },
} as const satisfies AuditFieldPoliciesDto;

/**
 * Entrega directa de alertas desde otro contexto (openspec add-rate-feed-alerts; D249). Hoy solo FX (job de providers de
 * tasas): tasa sin actualizar, tasa recuperada y muestras retenidas como anómalas (agrupadas por par). NOTIFY resuelve destinatarios (OWNER y
 * EDITOR activos), preferencias, idioma, horario de silencio y email, y deduplica por `(tipo, factKey, destinatario)`
 * (FR-NOTIFY-005); el aviso de anomalías, además, se actualiza con cada foto nueva del grupo. Sin consumidor de eventos: no crea colas `events.notifications.*` ni conexiones nuevas.
 */
export type NotificationIntakeType =
  | 'FX_RATE_FEED_STALE'
  | 'FX_RATE_FEED_RECOVERED'
  | 'FX_RATE_ANOMALY_RETAINED'
  | 'CASH_FLOW_SHORTFALL_RISK';

/**
 * `CASH_FLOW_SHORTFALL_RISK` (add-cash-flow-forecast, D381/D382): se abrió un episodio de riesgo de déficit (`HIGH`) en una
 * moneda del calendario de flujo de caja. `factKey` = `episodeId`: un aviso por episodio y destinatario (OWNER y EDITOR);
 * el cierre del episodio no notifica (D380). Severidad `CRITICAL` si `belowZero`, si no `WARNING`.
 */
export interface CashFlowShortfallRiskFact {
  readonly episodeId: string;
  readonly currency: string;
  readonly horizonDays: number;
  /** Primera fecha (`YYYY-MM-DD`, zona del workspace) con el saldo esperado bajo el umbral. */
  readonly firstShortfallDate: string;
  /** Saldo más bajo esperado (con signo) y su fecha. */
  readonly lowest: { readonly amount: string; readonly currency: string };
  readonly lowestDate: string;
  /** Reserva mínima (o cero) de esa moneda. */
  readonly threshold: { readonly amount: string; readonly currency: string };
  readonly belowZero: boolean;
  readonly detectedAt: string;
  readonly timeZone: string;
}

/** `FX_RATE_FEED_STALE`: un par configurado lleva más de N horas sin tasa aceptada de ningún provider. */
export interface RateFeedStaleFact {
  readonly episodeId: string;
  readonly base: string;
  readonly quote: string;
  /** Vigencia de la última tasa aceptada del par; `null` si nunca tuvo una. */
  readonly lastRateAsOf: string | null;
  readonly staleAfterSeconds: number;
  readonly detectedAt: string;
  /** Zona IANA del workspace: las horas del aviso se muestran en ella. */
  readonly timeZone: string;
}

/** `FX_RATE_FEED_RECOVERED`: llegó una tasa fresca y el episodio de obsolescencia se cerró. */
export interface RateFeedRecoveredFact {
  readonly episodeId: string;
  readonly base: string;
  readonly quote: string;
  readonly rateId: string;
  readonly asOf: string;
  readonly openedAt: string;
  readonly detectedAt: string;
  readonly timeZone: string;
}

/** Una muestra de provider retenida como anómala que espera su revisión (el "pico" del grupo). */
export interface RateAnomalyRetainedFact {
  readonly rateId: string;
  readonly base: string;
  readonly quote: string;
  readonly rateType: string;
  readonly provider: string;
  readonly value: string;
  readonly baselineRateId: string;
  readonly baselineValue: string;
  /** Variación con signo, 4 decimales (`"10.7692"`). */
  readonly variationPct: string;
  readonly thresholdPct: string;
  readonly detectedAt: string;
  readonly timeZone: string;
}

/**
 * `FX_RATE_ANOMALY_RETAINED` (refine-rate-anomaly-alert-grouping): foto del grupo de muestras retenidas pendientes de un
 * par en un workspace (de cualquier provider y tipo de tasa). `factKey` = `anchorRateId`, la primera muestra del grupo:
 * un aviso por grupo y destinatario que las muestras siguientes ACTUALIZAN (sin volverlo a no leído ni otro email).
 */
export interface RateAnomalyGroupFact {
  readonly anchorRateId: string;
  readonly base: string;
  readonly quote: string;
  /** Muestras del grupo pendientes de revisión ahora (≥ 1). */
  readonly pendingCount: number;
  /** Todas las muestras del grupo (≥ `pendingCount`). */
  readonly retainedCount: number;
  /** Providers distintos de las pendientes, en orden alfabético. */
  readonly providers: readonly string[];
  /** La pendiente más antigua: destino del enlace. */
  readonly reviewRateId: string;
  /** La pendiente con mayor variación absoluta (empate ⇒ la más reciente). */
  readonly peak: RateAnomalyRetainedFact;
  readonly firstRetainedAt: string;
  /** Instante de la foto: una foto más vieja nunca reemplaza a una más nueva. */
  readonly lastRetainedAt: string;
  readonly detectedAt: string;
  readonly timeZone: string;
}

interface IntakeFactBase {
  readonly workspaceId: string;
  /** Clave de negocio del hecho: `episodeId` (obsolescencia y recuperación) o `anchorRateId` (grupo de anomalías). */
  readonly factKey: string;
  /** Id del evento de dominio que FX escribió en el outbox en la misma unidad de trabajo (origen de la notificación). */
  readonly sourceEventId: string;
  readonly occurredAt: string;
}

export type NotificationIntakeFact =
  | (IntakeFactBase & { readonly type: 'FX_RATE_FEED_STALE'; readonly payload: RateFeedStaleFact })
  | (IntakeFactBase & { readonly type: 'FX_RATE_FEED_RECOVERED'; readonly payload: RateFeedRecoveredFact })
  | (IntakeFactBase & {
      readonly type: 'FX_RATE_ANOMALY_RETAINED';
      readonly payload: RateAnomalyGroupFact;
    })
  | (IntakeFactBase & {
      readonly type: 'CASH_FLOW_SHORTFALL_RISK';
      readonly payload: CashFlowShortfallRiskFact;
    });

export interface NotificationIntakeOutcome {
  /** Notificaciones in-app nuevas (una por destinatario sin notificación previa de ese hecho). */
  readonly created: number;
  /** Notificaciones existentes actualizadas con una foto más nueva del grupo (sin email nuevo). */
  readonly refreshed: number;
  /** Entregas por email programadas. */
  readonly deliveries: number;
}

/**
 * Puerto síncrono que FX llama desde su job de providers, DENTRO de la unidad de trabajo del workspace (la
 * transacción del llamador se reutiliza: episodio, evento y notificación se confirman o se revierten juntos). Un
 * hecho mal formado o un fallo de NOTIFY lanza y revierte la transacción del llamador (se reintenta en el ciclo siguiente).
 */
export interface NotificationIntakePort {
  notify(fact: NotificationIntakeFact): Promise<NotificationIntakeOutcome>;
}

// ───────────────────────────────────────────── digest del Home (add-cash-flow-forecast)

/** Frecuencia del digest por email que elige cada usuario (D385: desactivado por omisión). */
export const DIGEST_FREQUENCIES = ['OFF', 'WEEKLY', 'MONTHLY'] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];

/**
 * Una pregunta del digest (copia estructural de `HomeDigestQuestionDto` de `@pf/reporting/contracts`: NOTIFY no importa
 * REPORTING). REPORTING entrega todo, incluidos los montos en `amounts`; NOTIFY descarta `amounts` si el destinatario no
 * activó los detalles (FR-NOTIFY-006, D386).
 */
export interface HomeDigestQuestionSnapshot {
  readonly question: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7' | 'Q8' | 'Q9';
  readonly status: 'AVAILABLE' | 'NO_DATA';
  readonly counts: Readonly<Record<string, number>>;
  readonly percents: Readonly<Record<string, string>>;
  readonly dates: Readonly<Record<string, string>>;
  readonly states: Readonly<Record<string, string>>;
  readonly amounts: Readonly<Record<string, { readonly amount: string; readonly currency: string }>>;
}

export interface HomeDigestSnapshot {
  readonly workspaceId: string;
  readonly generatedAt: string;
  readonly timeZone: string;
  readonly today: string;
  readonly reportingCurrency: string;
  readonly questions: readonly HomeDigestQuestionSnapshot[];
}

/**
 * Puerto estructural de NOTIFY hacia el contenido del digest: la composición de `apps/api` lo cablea a `HomeDigestQuery`
 * de `@pf/reporting/contracts` (mismo patrón que `SpendableDeps`; sin dependencia de paquete NOTIFY → REPORTING).
 */
export interface HomeDigestSourcePort {
  compose(input: { readonly workspaceId: string }): Promise<HomeDigestSnapshot>;
}

export const NOTIFICATION_INTAKE_PORT = Symbol.for('pf.notifications.NotificationIntakePort');

export * from './portability.js';
