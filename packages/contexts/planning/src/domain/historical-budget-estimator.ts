import { DomainError, dec, present, type Currency, type Decimal } from '@pf/shared-kernel';

export const SUGGESTION_METHODS = ['AVERAGE', 'SAME_PERIOD_LAST_YEAR'] as const;
export type SuggestionMethod = (typeof SUGGESTION_METHODS)[number];

export const ROUNDING_INCREMENTS = [1, 5, 10, 50, 100] as const;

export type PeriodUseStatus =
  'USED' | 'OUTLIER' | 'INCOMPLETE' | 'BEFORE_FIRST_ACTIVITY' | 'NO_RATE' | 'IN_PROGRESS' | 'USER_EXCLUDED';

export type OutlierRule = 'TUKEY_1_5_IQR' | 'NONE_SMALL_SAMPLE';

/** Un periodo de la ventana para UNA línea: `actual` solo existe cuando el periodo es elegible y tiene tasas. */
export interface EstimatorPeriod {
  readonly key: string;
  readonly base: 'ELIGIBLE' | 'BEFORE_FIRST_ACTIVITY' | 'INCOMPLETE' | 'IN_PROGRESS' | 'NO_RATE';
  readonly actual: Decimal | null;
}

export interface EstimatorConfig {
  /** Fracción de N de valores válidos que se exige (0.5 por omisión). */
  readonly minValidRatio: number;
  /** Mínimo de valores para aplicar las vallas de Tukey (4). */
  readonly outlierMinSample: number;
  /** Factor del rango intercuartil (1.5). */
  readonly iqrFactor: number;
}

export const DEFAULT_ESTIMATOR_CONFIG: EstimatorConfig = {
  minValidRatio: 0.5,
  outlierMinSample: 4,
  iqrFactor: 1.5,
};

export interface EstimateInput {
  readonly method: SuggestionMethod;
  readonly requested: number;
  readonly periods: readonly EstimatorPeriod[];
  readonly currency: Currency;
  /** Porcentaje de ajuste, entre -100.00 y 1000.00. */
  readonly adjustmentPercent: Decimal;
  readonly roundingIncrement: number | null;
  readonly exclude?: ReadonlySet<string>;
  readonly include?: ReadonlySet<string>;
  readonly config?: EstimatorConfig;
}

export interface EstimatedPeriod {
  readonly key: string;
  readonly status: PeriodUseStatus;
  readonly actual: string | null;
}

export interface Estimate {
  readonly status: 'OK' | 'INSUFFICIENT_HISTORY';
  /** Monto sugerido a la escala de la moneda; `null` con historia insuficiente. */
  readonly suggested: string | null;
  readonly periods: readonly EstimatedPeriod[];
  readonly usedCount: number;
  readonly minValid: number;
  readonly outlierRule: OutlierRule;
  readonly q1: string | null;
  readonly q3: string | null;
  readonly mean: string | null;
  readonly median: string | null;
}

const ZERO = dec('0');

const sortAsc = (values: readonly Decimal[]): Decimal[] => [...values].sort((a, b) => a.comparedTo(b));

/** Mediana exacta de valores ya ordenados (promedio de los dos centrales si hay cantidad par). */
function medianOf(sorted: readonly Decimal[]): Decimal {
  const n = sorted.length;
  const mid = n >> 1;
  return n % 2 === 1
    ? (sorted[mid] as Decimal)
    : (sorted[mid - 1] as Decimal).plus(sorted[mid] as Decimal).div(2);
}

/** Texto con al menos la escala de la moneda (nunca pierde decimales exactos). */
const exactText = (value: Decimal, scale: number): string =>
  value.decimalPlaces() < scale ? value.toFixed(scale) : value.toFixed();

/**
 * Cuartiles por medianas de las mitades (n impar: la mediana no entra en ninguna mitad), exactos con Decimal. Método
 * fijado en la spec para que el resultado sea reproducible en cualquier implementación.
 */
export function quartilesOf(sorted: readonly Decimal[]): { q1: Decimal; q3: Decimal } {
  const half = sorted.length >> 1;
  return {
    q1: medianOf(sorted.slice(0, half)),
    q3: medianOf(sorted.slice(sorted.length - half)),
  };
}

/**
 * DS `HistoricalBudgetEstimator` (puro; openspec add-historical-budgets decisiones 4 y 5): sugiere el monto de UNA línea
 * desde su real en la ventana. Orden fijo: exclusión manual -> vallas de Tukey (n >= 4) -> mínimo de valores válidos ->
 * promedio -> ajuste -> escala de la moneda -> múltiplo, todo con HALF_EVEN. Determinista: no depende del orden de los
 * periodos.
 */
export const HistoricalBudgetEstimator = {
  estimate(input: EstimateInput): Estimate {
    const config = input.config ?? DEFAULT_ESTIMATOR_CONFIG;
    const exclude = input.exclude ?? new Set<string>();
    const include = input.include ?? new Set<string>();
    const scale = input.currency.scale;
    const known = new Map(input.periods.map((p) => [p.key, p]));
    for (const key of [...exclude, ...include]) {
      if (!known.has(key)) {
        throw new DomainError('VALIDATION_FAILED', `period ${key} is not in the suggestion window`).at(
          '/overrides',
        );
      }
    }
    for (const key of include) {
      const p = known.get(key) as EstimatorPeriod;
      if (p.base !== 'ELIGIBLE') {
        throw new DomainError('VALIDATION_FAILED', `period ${key} cannot be included: it is ${p.base}`).at(
          '/overrides',
        );
      }
      if (exclude.has(key)) {
        throw new DomainError('VALIDATION_FAILED', `period ${key} is both excluded and included`).at(
          '/overrides',
        );
      }
    }

    const status = new Map<string, PeriodUseStatus>();
    const candidates: { key: string; value: Decimal }[] = [];
    for (const p of input.periods) {
      if (p.base !== 'ELIGIBLE') status.set(p.key, p.base);
      else if (exclude.has(p.key)) status.set(p.key, 'USER_EXCLUDED');
      else {
        status.set(p.key, 'USED');
        candidates.push({ key: p.key, value: p.actual as Decimal });
      }
    }

    let outlierRule: OutlierRule = 'NONE_SMALL_SAMPLE';
    let q1: Decimal | null = null;
    let q3: Decimal | null = null;
    if (input.method === 'AVERAGE' && candidates.length >= config.outlierMinSample) {
      outlierRule = 'TUKEY_1_5_IQR';
      const sorted = sortAsc(candidates.map((c) => c.value));
      ({ q1, q3 } = quartilesOf(sorted));
      const reach = q3.minus(q1).times(dec(String(config.iqrFactor)));
      const lower = q1.minus(reach);
      const upper = q3.plus(reach);
      for (const c of candidates) {
        if ((c.value.lt(lower) || c.value.gt(upper)) && !include.has(c.key)) status.set(c.key, 'OUTLIER');
      }
    }

    const used = candidates.filter((c) => status.get(c.key) === 'USED').map((c) => c.value);
    const minValid =
      input.method === 'SAME_PERIOD_LAST_YEAR'
        ? 1
        : Math.max(1, Math.ceil(input.requested * config.minValidRatio));
    const periods: EstimatedPeriod[] = input.periods.map((p) => ({
      key: p.key,
      status: status.get(p.key) as PeriodUseStatus,
      actual: p.actual === null ? null : present(p.actual, input.currency).toFixed(),
    }));
    const base = {
      periods,
      usedCount: used.length,
      minValid,
      outlierRule,
      q1: q1 === null ? null : exactText(q1, scale),
      q3: q3 === null ? null : exactText(q3, scale),
    };
    if (used.length < minValid) {
      return { ...base, status: 'INSUFFICIENT_HISTORY', suggested: null, mean: null, median: null };
    }

    const sum = used.reduce((acc, v) => acc.plus(v), ZERO);
    const exactMean = sum.div(used.length);
    const adjusted = exactMean.times(dec('100').plus(input.adjustmentPercent)).div(100);
    let suggested = present(adjusted, input.currency);
    if (input.roundingIncrement !== null) {
      const inc = dec(String(input.roundingIncrement));
      // HALF_EVEN al múltiplo más cercano (2.5 múltiplos -> 2), después de la escala de la moneda.
      const multiples = suggested.toDecimal().div(inc).toDecimalPlaces(0, 6);
      suggested = present(multiples.times(inc), input.currency);
    }
    return {
      ...base,
      status: 'OK',
      suggested: suggested.toFixed(),
      mean: present(exactMean, input.currency).toFixed(),
      median: present(medianOf(sortAsc(used)), input.currency).toFixed(),
    };
  },
} as const;
