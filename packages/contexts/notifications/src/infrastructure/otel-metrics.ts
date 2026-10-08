import type { CounterMetrics, HistogramMetrics } from '@pf/platform/otel';
import type { NotificationMetricsPort } from '../application/ports/index.js';
import { NOTIFICATION_METRICS } from '../contracts/index.js';

/**
 * Métricas de NOTIFY sobre OpenTelemetry (design decisión 12). Etiquetas de baja cardinalidad: tipo de notificación
 * o estado de la entrega; nunca workspace, usuario ni notificación (docs/18 §5). El exportador Prometheus agrega
 * `_total`: `notifications_created_total{type}`, `notifications_email_deliveries_total{status}`.
 */
export class OtelNotificationMetrics implements NotificationMetricsPort {
  constructor(
    private readonly counters: CounterMetrics,
    private readonly histograms: HistogramMetrics,
  ) {}

  created(type: string): void {
    this.counters.increment(NOTIFICATION_METRICS.created, { type });
  }

  emailDelivery(status: 'sent' | 'retry' | 'failed' | 'suppressed'): void {
    this.counters.increment(NOTIFICATION_METRICS.emailDeliveries, { status });
  }

  lagSeconds(type: string, seconds: number): void {
    this.histograms.record(NOTIFICATION_METRICS.eventLag, seconds, { type });
  }
}
