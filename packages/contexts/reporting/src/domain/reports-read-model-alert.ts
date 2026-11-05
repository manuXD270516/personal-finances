import { REPORT_IDS, type ReportId } from './report-catalog.js';

/** Métrica de duración de los reportes (histograma, segundos; etiqueta `report` ∈ los 16 ids, baja cardinalidad). */
export const REPORT_DURATION_METRIC = 'reporting_report_duration_seconds' as const;

/**
 * Alerta `ReportsReadModelRecommended` (add-financial-reports, D361): la lectura por conjunto sin read models deja de
 * ser suficiente para un reporte cuando su p95 supera el 75 % de su presupuesto de latencia (NFR-PERF-006, 800 ms ⇒
 * 600 ms) durante 7 días. Es la regla declarada en docs/18 §8 expresada como dato para poder probarla; recomienda
 * introducir el read model de ese reporte (docs/14 §2.1), nunca otro reporte.
 */
export const REPORTS_READ_MODEL_ALERT = {
  name: 'ReportsReadModelRecommended',
  durationMetric: REPORT_DURATION_METRIC,
  /** 75 % del presupuesto de 800 ms. */
  p95ThresholdSeconds: 0.6,
  forDays: 7,
  runbook: 'openspec/changes/add-financial-reports/design.md#decisiones',
  severity: 'media',
} as const;

/** p95 diario (segundos) de un reporte, la más antigua primero. */
export interface ReportDurationSample {
  readonly report: ReportId;
  readonly p95Seconds: number;
}

export interface ReportsReadModelAlertState {
  readonly firing: boolean;
  /** Reportes que superaron el umbral los últimos `forDays` días (cada uno con su propia recomendación). */
  readonly reports: readonly ReportId[];
  readonly runbook: string;
}

/**
 * Evalúa la regla por reporte: se dispara para el reporte cuyas últimas `forDays` muestras diarias tienen todas p95 por
 * encima del umbral (exclusivo). Las muestras de reportes que no existen se ignoran.
 */
export function evaluateReportsReadModelAlert(
  samples: readonly ReportDurationSample[],
): ReportsReadModelAlertState {
  const { p95ThresholdSeconds, forDays, runbook } = REPORTS_READ_MODEL_ALERT;
  const firing: ReportId[] = [];
  for (const id of REPORT_IDS) {
    const recent = samples.filter((s) => s.report === id).slice(-forDays);
    if (recent.length >= forDays && recent.every((s) => s.p95Seconds > p95ThresholdSeconds)) firing.push(id);
  }
  return { firing: firing.length > 0, reports: firing, runbook };
}
