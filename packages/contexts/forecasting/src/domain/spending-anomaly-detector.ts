import { MoneyDecimal, dec, type Decimal } from '@pf/shared-kernel';
import { RobustStats } from './robust-stats.js';

/**
 * `SpendingAnomalyDetector` (openspec add-spending-anomaly-detection, decisiones 4 y 5; D473): estadística robusta
 * (mediana y MAD) por categoría, por contraparte y por contraparte nueva con monto alto. Dominio puro: recibe los montos
 * ya llevados a la moneda de reporte con la tasa de su fecha y las muestras de los 365 días anteriores, y devuelve los
 * motivos explicables. No lee nada ni decide qué gastos se evalúan (eso es de la aplicación).
 */
export type AnomalyReasonKind = 'CATEGORY_OUTLIER' | 'COUNTERPARTY_OUTLIER' | 'NEW_COUNTERPARTY_HIGH_AMOUNT';

export interface AnomalyThresholds {
  /** `FORECASTING_ANOMALY_ROBUST_Z` (3.5). */
  readonly robustZ: Decimal;
  /** `FORECASTING_ANOMALY_MIN_RATIO` (3.0): el monto debe ser al menos esta cantidad de veces la mediana. */
  readonly minRatio: Decimal;
  /** `FORECASTING_ANOMALY_MIN_SAMPLE` (8): gastos de historia mínimos por categoría, contraparte y workspace. */
  readonly minSample: number;
  /** `FORECASTING_ANOMALY_NEW_COUNTERPARTY_PERCENTILE` (95). */
  readonly newCounterpartyPercentile: number;
}

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  robustZ: dec('3.5'),
  minRatio: dec('3'),
  minSample: 8,
  newCounterpartyPercentile: 95,
};

/** Un gasto a evaluar, en la moneda de reporte. */
export interface ExpenseSubject {
  /** Porciones; `categoryId = null` para «sin categoría» (no se evalúa por categoría). */
  readonly portions: readonly { readonly categoryId: string | null; readonly value: Decimal }[];
  readonly counterpartyId: string | null;
  /** Monto total del gasto (Σ de las porciones). */
  readonly total: Decimal;
}

/** Muestras de los 365 días anteriores a la fecha del gasto, sin el gasto mismo (pedidas de forma perezosa). */
export interface ExpenseHistory {
  category(categoryId: string): readonly Decimal[];
  counterparty(counterpartyId: string): readonly Decimal[];
  workspace(): readonly Decimal[];
}

export interface AnomalyReason {
  readonly kind: AnomalyReasonKind;
  readonly categoryId: string | null;
  readonly counterpartyId: string | null;
  /** Mediana (categoría y contraparte) o percentil (contraparte nueva), a la escala de la moneda de reporte. */
  readonly reference: string;
  /** Monto ÷ mediana con 1 decimal HALF_EVEN; `null` en la contraparte nueva. */
  readonly ratio: string | null;
  /** Puntaje robusto con 2 decimales; `null` con MAD igual a cero y en la contraparte nueva. */
  readonly robustScore: string | null;
  readonly sampleSize: number;
}

const present = (value: Decimal, places: number): string =>
  value.toDecimalPlaces(places, MoneyDecimal.ROUND_HALF_EVEN).toFixed(places);

/** Marca de una muestra: `null` si no hay historia suficiente, la mediana es cero o no cumple los dos umbrales. */
function outlierOf(
  value: Decimal,
  sample: readonly Decimal[],
  thresholds: AnomalyThresholds,
  scale: number,
): { reference: string; ratio: string; robustScore: string | null; sampleSize: number } | null {
  if (sample.length < thresholds.minSample) return null;
  const median = RobustStats.median(sample);
  if (!median.gt(0)) return null;
  if (value.lt(median.times(thresholds.minRatio))) return null;
  const mad = RobustStats.mad(sample, median);
  const z = RobustStats.robustScore(value, median, mad);
  // Con MAD > 0 hacen falta las dos condiciones; con MAD = 0 alcanza la razón (ya verificada).
  if (z !== null && z.lt(thresholds.robustZ)) return null;
  return {
    reference: present(median, scale),
    ratio: present(value.div(median), 1),
    robustScore: z === null ? null : present(z, 2),
    sampleSize: sample.length,
  };
}

export const SpendingAnomalyDetector = {
  /** Motivos de un gasto atípico (arreglo vacío si no lo es). Un resultado por gasto, con todos sus motivos. */
  detect(
    subject: ExpenseSubject,
    history: ExpenseHistory,
    thresholds: AnomalyThresholds,
    scale: number,
  ): AnomalyReason[] {
    const reasons: AnomalyReason[] = [];
    // Categoría: por porción; un motivo por categoría.
    const seen = new Set<string>();
    for (const portion of subject.portions) {
      if (portion.categoryId === null || seen.has(portion.categoryId)) continue;
      const hit = outlierOf(portion.value, history.category(portion.categoryId), thresholds, scale);
      if (hit) {
        seen.add(portion.categoryId);
        reasons.push({
          kind: 'CATEGORY_OUTLIER',
          categoryId: portion.categoryId,
          counterpartyId: null,
          ...hit,
        });
      }
    }
    const { counterpartyId } = subject;
    if (counterpartyId !== null) {
      const sample = history.counterparty(counterpartyId);
      if (sample.length === 0) {
        // Contraparte nueva: sin gastos previos y monto ≥ percentil del workspace (con historia suficiente).
        const workspace = history.workspace();
        if (workspace.length >= thresholds.minSample) {
          const reference = RobustStats.percentileNearestRank(
            workspace,
            thresholds.newCounterpartyPercentile,
          );
          if (subject.total.gte(reference)) {
            reasons.push({
              kind: 'NEW_COUNTERPARTY_HIGH_AMOUNT',
              categoryId: null,
              counterpartyId,
              reference: present(reference, scale),
              ratio: null,
              robustScore: null,
              sampleSize: workspace.length,
            });
          }
        }
      } else {
        const hit = outlierOf(subject.total, sample, thresholds, scale);
        if (hit) reasons.push({ kind: 'COUNTERPARTY_OUTLIER', categoryId: null, counterpartyId, ...hit });
      }
    }
    return reasons;
  },
} as const;
