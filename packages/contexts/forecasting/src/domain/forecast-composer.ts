import { dec, type Decimal } from '@pf/shared-kernel';
import type { ServiceResultPoint } from './forecast-request.js';

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type DriverType =
  'HISTORICAL_AVERAGE' | 'SEASONALITY' | 'TREND_AND_LEVEL' | 'OUTLIERS' | 'KNOWN_RECURRING';

export interface Driver {
  readonly type: DriverType;
  /** Cifra del motivo (promedio o conocidos); `null` en los que solo tienen efecto. */
  readonly value: string | null;
  /** Efecto con signo sobre la parte variable (estacionalidad, tendencia y nivel). */
  readonly effect: string | null;
  /** Periodos señalados (atípicos). */
  readonly periods: readonly string[];
  /** Cantidad de referencias (compromisos conocidos o periodos atípicos). */
  readonly refCount: number;
}

export interface ComposedPoint {
  readonly period: string;
  readonly monthsAhead: number;
  readonly prediction: string;
  readonly lower80: string;
  readonly upper80: string;
  readonly lower95: string;
  readonly upper95: string;
  readonly baselineValue: string;
  readonly knownFuture: string;
  readonly predictedVariable: string;
  readonly variableLower80: string;
  readonly variableUpper80: string;
  readonly knownBlankCount: number;
  readonly drivers: readonly Driver[];
}

export interface KnownForPeriod {
  readonly amount: Decimal;
  readonly withoutAmountCount: number;
  readonly itemCount: number;
}

const nonNegative = (v: Decimal): Decimal => (v.isNegative() ? dec('0') : v);

/**
 * `ForecastComposer` (decisiones 1, 8 y 10): el valor esperado es la suma EXACTA de lo conocido (determinista) y la parte
 * variable que predijo el servicio; los límites de cada intervalo suman lo conocido a los límites de la parte variable
 * (un límite variable negativo se trunca a 0 antes de sumar). Los motivos cierran: promedio + estacionalidad + tendencia
 * y nivel = parte variable, con el residuo de redondeo en `TREND_AND_LEVEL`. Todo con Decimal: no se redondea porque
 * todas las cifras ya vienen a la escala de la moneda de reporte.
 */
export const ForecastComposer = {
  compose(input: {
    readonly point: ServiceResultPoint;
    readonly known: KnownForPeriod;
    readonly scale: number;
    readonly outlierPeriods: readonly string[];
  }): ComposedPoint {
    const { point, known, scale } = input;
    const fx = (d: Decimal) => d.toFixed(scale);
    const variable = dec(point.prediction);
    const v80 = [nonNegative(dec(point.lower80)), dec(point.upper80)] as const;
    const v95 = [nonNegative(dec(point.lower95)), dec(point.upper95)] as const;
    const knownAmount = known.amount;

    const average = point.drivers ? dec(point.drivers.historicalAverage) : variable;
    const seasonality =
      point.drivers?.seasonality !== undefined && point.drivers.seasonality !== null
        ? dec(point.drivers.seasonality)
        : null;
    // El residuo (también el de redondeo) cae en tendencia y nivel: la suma es exacta por construcción.
    const trend = variable.minus(average).minus(seasonality ?? dec('0'));
    const drivers: Driver[] = [
      {
        type: 'HISTORICAL_AVERAGE',
        value: fx(average),
        effect: null,
        periods: [],
        refCount: 0,
      },
      ...(seasonality !== null
        ? [
            {
              type: 'SEASONALITY' as const,
              value: null,
              effect: fx(seasonality),
              periods: [],
              refCount: 0,
            },
          ]
        : []),
      { type: 'TREND_AND_LEVEL', value: null, effect: fx(trend), periods: [], refCount: 0 },
      ...(input.outlierPeriods.length > 0
        ? [
            {
              type: 'OUTLIERS' as const,
              value: null,
              effect: null,
              periods: [...input.outlierPeriods],
              refCount: input.outlierPeriods.length,
            },
          ]
        : []),
      {
        type: 'KNOWN_RECURRING',
        value: fx(knownAmount),
        effect: null,
        periods: [],
        refCount: known.itemCount,
      },
    ];
    return {
      period: point.period,
      monthsAhead: point.monthsAhead,
      prediction: fx(knownAmount.plus(variable)),
      lower80: fx(knownAmount.plus(v80[0])),
      upper80: fx(knownAmount.plus(v80[1])),
      lower95: fx(knownAmount.plus(v95[0])),
      upper95: fx(knownAmount.plus(v95[1])),
      baselineValue: fx(knownAmount.plus(dec(point.baselineValue))),
      knownFuture: fx(knownAmount),
      predictedVariable: fx(variable),
      variableLower80: fx(v80[0]),
      variableUpper80: fx(v80[1]),
      knownBlankCount: known.withoutAmountCount,
      drivers,
    };
  },

  /**
   * Confianza (docs/15 §9, decisión 9): `LOW` con menos de 12 periodos, estimación simple o MASE > 1; `HIGH` con 24 o más
   * periodos, MASE < 0.8 y cobertura del 80 % entre 0.75 y 0.85; `MEDIUM` en los demás casos.
   */
  confidence(input: {
    readonly historyPeriods: number;
    readonly selectedBy: 'BACKTEST' | 'BASELINE_FALLBACK' | 'SIMPLE';
    readonly mase: string | null;
    readonly coverage80: string | null;
  }): Confidence {
    const mase = input.mase === null ? null : dec(input.mase);
    if (input.historyPeriods < 12 || input.selectedBy === 'SIMPLE' || (mase !== null && mase.gt(1))) {
      return 'LOW';
    }
    const coverage = input.coverage80 === null ? null : dec(input.coverage80);
    if (
      input.historyPeriods >= 24 &&
      mase !== null &&
      mase.lt('0.8') &&
      coverage !== null &&
      coverage.gte('0.75') &&
      coverage.lte('0.85')
    ) {
      return 'HIGH';
    }
    return 'MEDIUM';
  },

  /**
   * Diferencia entre categorías y total (decisión 14): `total − Σ categorías` del periodo, con signo. `exceeds` si su
   * valor absoluto supera `ratio` veces el total (por omisión 5 %).
   */
  coherenceGap(input: {
    readonly total: string;
    readonly categories: readonly string[];
    readonly scale: number;
    readonly ratio: string;
  }): { readonly gap: string; readonly exceeds: boolean } {
    const total = dec(input.total);
    const sum = input.categories.reduce((a, c) => a.plus(c), dec('0'));
    const gap = total.minus(sum);
    return {
      gap: gap.toFixed(input.scale),
      exceeds: !total.isZero() && gap.abs().gt(total.abs().times(input.ratio)),
    };
  },
} as const;
