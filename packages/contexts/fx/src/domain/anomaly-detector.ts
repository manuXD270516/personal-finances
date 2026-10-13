import { dec, MoneyDecimal, type Decimal } from '@pf/shared-kernel';
import type { AnomalyMark } from './exchange-rate.js';
import type { AssetClass } from './rate-pairs.js';

/** Línea base de la detección: la última tasa ACEPTADA del mismo workspace, provider, par y tipo. */
export interface AnomalyBaseline {
  readonly rateId: string;
  readonly value: string;
}

export interface AnomalyAssessment {
  /** Variación con signo, a precisión 40, cuantizada HALF_EVEN a 4 decimales (`"12.3128"`). */
  readonly variationPct: string;
  readonly flagged: boolean;
  /** Marca a persistir en la fila (solo si `flagged`). */
  readonly mark: AnomalyMark | null;
}

/** Variación porcentual exacta `(v − b) / b × 100` (precisión 40, sin redondeo intermedio). */
export function variationPct(value: Decimal | string, baseline: Decimal | string): Decimal {
  const b = dec(baseline);
  return dec(value).minus(b).div(b).times(100);
}

/**
 * DS `AnomalyDetector` (design.md decisión 8), puro: una muestra cuya variación respecto de la línea base supera el
 * umbral (en valor absoluto, estrictamente mayor) queda marcada como anómala y no se usa para valorar hasta que un
 * EDITOR/OWNER la confirme. Sin línea base (primera muestra) nunca es anómala.
 */
export class AnomalyDetector {
  private readonly threshold: Decimal;

  constructor(thresholdPct: string) {
    const t = dec(thresholdPct);
    if (!t.isFinite() || t.lte(0)) throw new RangeError('anomaly threshold must be a decimal > 0');
    this.threshold = t;
  }

  get thresholdPct(): string {
    return this.threshold.toFixed();
  }

  assess(value: string, baseline: AnomalyBaseline | null): AnomalyAssessment | null {
    if (!baseline) return null;
    const exact = variationPct(value, baseline.value);
    const pct = exact.toDecimalPlaces(4, MoneyDecimal.ROUND_HALF_EVEN).toFixed(4);
    const flagged = exact.abs().gt(this.threshold);
    return {
      variationPct: pct,
      flagged,
      mark: flagged ? { baselineRateId: baseline.rateId, variationPct: pct } : null,
    };
  }
}

/**
 * Umbrales de anomalía por clase de activo (D228, configurables): 5 % para fiat y estables (`FX_ANOMALY_THRESHOLD_PCT`)
 * y 10 % para cripto volátil (`FX_ANOMALY_THRESHOLD_VOLATILE_PCT`).
 */
export interface AnomalyThresholds {
  readonly fiatStablePct: string;
  readonly volatilePct: string;
}

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = Object.freeze({
  fiatStablePct: '5',
  volatilePct: '10',
});

/** Umbral que aplica a la moneda base de un par según su clase de activo. */
export function anomalyThresholdFor(thresholds: AnomalyThresholds, assetClass: AssetClass | null): string {
  return assetClass === 'VOLATILE_CRYPTO' ? thresholds.volatilePct : thresholds.fiatStablePct;
}

/** `AnomalyDetector` con el umbral de la clase de activo de la moneda base del par. */
export function anomalyDetectorFor(
  thresholds: AnomalyThresholds,
  assetClass: AssetClass | null,
): AnomalyDetector {
  return new AnomalyDetector(anomalyThresholdFor(thresholds, assetClass));
}
