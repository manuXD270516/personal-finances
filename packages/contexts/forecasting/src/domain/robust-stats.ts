import { DomainError, dec, type Decimal } from '@pf/shared-kernel';

/** Constante de Iglewicz y Hoaglin del puntaje robusto: 0.6745 × (x − mediana) / MAD. */
export const ROBUST_Z_FACTOR = '0.6745';

const ascending = (a: Decimal, b: Decimal): number => a.comparedTo(b);

const sorted = (values: readonly Decimal[]): Decimal[] => [...values].sort(ascending);

/**
 * Estadística robusta de los gastos atípicos (openspec add-spending-anomaly-detection, decisión 4). Dominio puro: todo con
 * Decimal (precisión 40, sin redondeo intermedio); HALF_EVEN solo al presentar. Ninguna función modifica su entrada.
 */
export const RobustStats = {
  /** Mediana: el valor central, o el promedio de los dos centrales con `n` par. Lanza con una muestra vacía. */
  median(values: readonly Decimal[]): Decimal {
    if (values.length === 0) throw new DomainError('VALIDATION_FAILED', 'the sample is empty');
    const s = sorted(values);
    const mid = s.length >> 1;
    const upper = s[mid] as Decimal;
    return s.length % 2 === 1 ? upper : (s[mid - 1] as Decimal).plus(upper).div(2);
  },

  /** MAD: la mediana de las desviaciones absolutas respecto de la mediana (que se puede pasar ya calculada). */
  mad(values: readonly Decimal[], median?: Decimal): Decimal {
    const center = median ?? RobustStats.median(values);
    return RobustStats.median(values.map((v) => v.minus(center).abs()));
  },

  /** Puntaje robusto; `null` con MAD igual a cero (no está definido: la razón con la mediana decide sola). */
  robustScore(value: Decimal, median: Decimal, mad: Decimal): Decimal | null {
    if (mad.isZero()) return null;
    return dec(ROBUST_Z_FACTOR).times(value.minus(median)).div(mad);
  },

  /** Percentil por rango más cercano: el valor de la posición ⌈p/100 × n⌉ en orden ascendente. */
  percentileNearestRank(values: readonly Decimal[], percentile: number): Decimal {
    if (values.length === 0) throw new DomainError('VALIDATION_FAILED', 'the sample is empty');
    if (!(percentile > 0 && percentile <= 100)) {
      throw new DomainError('VALIDATION_FAILED', 'the percentile must be in (0, 100]');
    }
    const s = sorted(values);
    const rank = Math.min(s.length, Math.max(1, Math.ceil((percentile / 100) * s.length)));
    return s[rank - 1] as Decimal;
  },
} as const;
