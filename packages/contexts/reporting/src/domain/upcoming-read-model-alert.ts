/** Métrica de duración de la consulta de próximos pagos (histograma, segundos; sin etiquetas de alta cardinalidad). */
export const UPCOMING_PAYMENTS_DURATION_METRIC = 'reporting_upcoming_payments_duration_seconds' as const;
/** Ocurrencias y pendientes leídas por consulta (histograma; sin etiquetas de alta cardinalidad). */
export const UPCOMING_PAYMENTS_ROWS_METRIC = 'reporting_upcoming_payments_rows' as const;

/**
 * Alerta `UpcomingPaymentsReadModelRecommended` (docs/35 D117): la lectura directa de Phase 3 deja de ser suficiente
 * cuando el p95 de la duración supera el presupuesto del Home (NFR-PERF-004, 300 ms) durante 15 minutos o una consulta
 * lee más de 5 000 ocurrencias. Es la regla declarada en docs/18 §8 expresada como dato para poder probarla.
 */
export const UPCOMING_READ_MODEL_ALERT = {
  name: 'UpcomingPaymentsReadModelRecommended',
  p95ThresholdSeconds: 0.3,
  forMinutes: 15,
  maxRowsPerQuery: 5000,
  /** Sección del diseño que explica el read model por eventos al que conviene migrar. */
  runbook:
    'openspec/changes/add-upcoming-payments/design.md#evolución-a-read-model-decisión-del-owner-2026-10-10-docs35',
  severity: 'media',
} as const;

/** Muestra por minuto de las métricas de la consulta. */
export interface UpcomingMetricSample {
  /** p95 de la duración en el minuto, en segundos. */
  readonly p95Seconds: number;
  /** Mayor cantidad de ocurrencias leídas por una consulta en el minuto. */
  readonly maxRows: number;
}

export interface ReadModelAlertState {
  readonly firing: boolean;
  /** `SLOW_P95` si el p95 superó el umbral los últimos `forMinutes` minutos; `TOO_MANY_ROWS` por volumen. */
  readonly reasons: readonly ('SLOW_P95' | 'TOO_MANY_ROWS')[];
  readonly runbook: string;
}

/**
 * Evalúa la regla sobre las muestras por minuto (la más antigua primero). Se dispara si las últimas `forMinutes`
 * muestras tienen todas p95 > 300 ms, o si alguna consulta leyó más de 5 000 ocurrencias.
 */
export function evaluateReadModelAlert(samples: readonly UpcomingMetricSample[]): ReadModelAlertState {
  const { p95ThresholdSeconds, forMinutes, maxRowsPerQuery, runbook } = UPCOMING_READ_MODEL_ALERT;
  const recent = samples.slice(-forMinutes);
  const slow = recent.length >= forMinutes && recent.every((s) => s.p95Seconds > p95ThresholdSeconds);
  const heavy = samples.some((s) => s.maxRows > maxRowsPerQuery);
  const reasons: ('SLOW_P95' | 'TOO_MANY_ROWS')[] = [];
  if (slow) reasons.push('SLOW_P95');
  if (heavy) reasons.push('TOO_MANY_ROWS');
  return { firing: reasons.length > 0, reasons, runbook };
}
