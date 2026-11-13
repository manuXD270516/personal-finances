import { DomainError, dec, type Decimal } from '@pf/shared-kernel';
import type { EvaluatedSeries } from './readiness-gate.js';

/**
 * Referencias opacas por corrida (decisión 4): `s1..sN` asignadas por una permutación que cambia en cada corrida. La
 * petición no revela qué serie es cuál; el mapeo vive solo en `forecasting.forecast_series`.
 */
export const OpaqueRefAllocator = {
  /**
   * @param keys   claves estables de las series (p. ej. `CATEGORY:<id>`).
   * @param random fuente en [0, 1) (inyectable para tests; en producción `Math.random`/`crypto`).
   */
  allocate(keys: readonly string[], random: () => number): ReadonlyMap<string, string> {
    const order = keys.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j] as number, order[i] as number];
    }
    return new Map(keys.map((k, i) => [k, `s${(order[i] as number) + 1}`]));
  },
} as const;

export interface ForecastRequestSeries {
  readonly ref: string;
  readonly kind: 'EXPENSE' | 'INCOME';
  readonly currency: string;
  readonly scale: number;
  readonly readiness: 'MODEL' | 'SIMPLE';
  readonly horizon: number;
  /** Atípicos de la parte variable (phase8-v1, decisión 11): el servicio recorta al límite para ajustar. */
  readonly outlierPolicy: 'MAD_3_5';
  readonly points: readonly { readonly period: string; readonly value: string; readonly txCount: number }[];
}

export interface ForecastRequestV1 {
  readonly schemaVersion: '1';
  readonly requestId: string;
  readonly seed: number;
  readonly policy: {
    readonly modelSet: 'phase8-v1';
    readonly horizonMax: 12;
    readonly intervalLevels: readonly [0.8, 0.95];
  };
  readonly series: readonly ForecastRequestSeries[];
}

/** Clave estable de una serie dentro de la corrida. */
export const seriesKey = (s: Pick<EvaluatedSeries, 'scope' | 'scopeRef'>): string =>
  `${s.scope}:${s.scopeRef ?? ''}`;

const sortKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
};

/** JSON canónico (claves ordenadas, sin espacios): base del `datasetSnapshotId`. */
export const canonicalJson = (value: unknown): string => JSON.stringify(sortKeys(value));

/**
 * Arma la petición al servicio (FR-FORECAST-006, NFR-COMP-001): solo montos por periodo, moneda, periodos y parámetros;
 * sin id del workspace ni de miembros, nombres, descripciones ni ids de transacciones. Las series `INSUFFICIENT` no
 * viajan. Devuelve además el mapeo clave de serie → referencia opaca.
 */
export const ForecastRequestBuilder = {
  build(input: {
    readonly requestId: string;
    readonly seed: number;
    readonly series: readonly EvaluatedSeries[];
    readonly currency: string;
    readonly scale: number;
    readonly random: () => number;
  }): { readonly request: ForecastRequestV1; readonly refs: ReadonlyMap<string, string> } {
    const sendable = input.series.filter((s) => s.readiness !== 'INSUFFICIENT');
    if (sendable.length === 0) throw new DomainError('VALIDATION_FAILED', 'no series ready to forecast');
    const refs = OpaqueRefAllocator.allocate(sendable.map(seriesKey), input.random);
    const series: ForecastRequestSeries[] = sendable
      .map((s) => ({
        ref: refs.get(seriesKey(s)) as string,
        kind: s.kind,
        currency: input.currency,
        scale: input.scale,
        readiness: s.readiness as 'MODEL' | 'SIMPLE',
        horizon: s.horizon,
        outlierPolicy: 'MAD_3_5' as const,
        points: s.points.map((p) => ({
          period: p.period,
          value: p.value.toFixed(input.scale),
          txCount: p.txCount,
        })),
      }))
      .sort((a, b) => Number(a.ref.slice(1)) - Number(b.ref.slice(1)));
    return {
      request: {
        schemaVersion: '1',
        requestId: input.requestId,
        seed: input.seed,
        policy: { modelSet: 'phase8-v1', horizonMax: 12, intervalLevels: [0.8, 0.95] },
        series,
      },
      refs,
    };
  },
} as const;

// ───────────────────────────────────────────── resultado del servicio

export interface ServiceResultPoint {
  readonly period: string;
  readonly monthsAhead: number;
  readonly prediction: string;
  readonly lower80: string;
  readonly upper80: string;
  readonly lower95: string;
  readonly upper95: string;
  readonly baselineValue: string;
  /** Motivos de la parte variable (phase8-v1). */
  readonly drivers?: {
    readonly historicalAverage: string;
    readonly seasonality: string | null;
    readonly trendAndLevel: string;
  } | null;
}

export interface ServiceBacktest {
  readonly origins: readonly string[];
  readonly candidates: readonly {
    readonly name: string;
    readonly cuts: number;
    readonly mase: string | null;
    readonly coverage80: string | null;
    readonly bias: string | null;
  }[];
  readonly selected: string;
  readonly fallback: boolean;
  readonly baselineMase: string | null;
}

export interface ServiceSeriesResult {
  readonly ref: string;
  readonly status: 'OK' | 'ERROR';
  readonly error: string | null;
  readonly model: { readonly name: string; readonly version: string; readonly selectedBy: string } | null;
  readonly baseline: { readonly method: string; readonly n: number | null } | null;
  readonly points: readonly ServiceResultPoint[];
  readonly backtest?: ServiceBacktest | null;
  readonly outliers?: readonly string[] | null;
}

export interface ForecastResponseV1 {
  readonly schemaVersion: '1';
  readonly requestId: string;
  readonly serviceVersion: string;
  readonly results: readonly ServiceSeriesResult[];
  readonly durationMs: number;
}

export type ValidationFailure =
  | 'STATUS_ERROR'
  | 'MISSING_MODEL'
  | 'PERIODS_MISMATCH'
  | 'SCALE_EXCEEDED'
  | 'NOT_FINITE'
  | 'INTERVAL_ORDER'
  | 'NEGATIVE'
  | 'DRIVERS_MISMATCH';

const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;

const scaleOfText = (v: string): number => {
  const dot = v.indexOf('.');
  return dot < 0 ? 0 : v.length - dot - 1;
};

/**
 * `ForecastResultValidator` (decisión 11): cada serie devuelta se valida contra lo pedido antes de guardarse. Una serie
 * inválida se descarta con su motivo y las demás se publican.
 */
export const ForecastResultValidator = {
  validate(
    requested: ForecastRequestSeries,
    result: ServiceSeriesResult,
  ): { readonly ok: true } | { readonly ok: false; readonly reason: ValidationFailure } {
    if (result.status !== 'OK') return { ok: false, reason: 'STATUS_ERROR' };
    if (!result.model || result.model.name === '' || result.model.version === '' || !result.baseline) {
      return { ok: false, reason: 'MISSING_MODEL' };
    }
    if (result.points.length !== requested.horizon) return { ok: false, reason: 'PERIODS_MISMATCH' };
    const lastPeriod = requested.points.at(-1)?.period;
    if (!lastPeriod) return { ok: false, reason: 'PERIODS_MISMATCH' };
    for (const [i, p] of result.points.entries()) {
      if (p.monthsAhead !== i + 1 || p.period !== shift(lastPeriod, i + 1)) {
        return { ok: false, reason: 'PERIODS_MISMATCH' };
      }
      const texts = [p.prediction, p.lower80, p.upper80, p.lower95, p.upper95, p.baselineValue];
      if (texts.some((t) => !DECIMAL_TEXT.test(t))) return { ok: false, reason: 'NOT_FINITE' };
      if (texts.some((t) => scaleOfText(t) > requested.scale)) return { ok: false, reason: 'SCALE_EXCEEDED' };
      const [pred, l80, u80, l95, u95, base] = texts.map((t) => dec(t)) as [
        Decimal,
        Decimal,
        Decimal,
        Decimal,
        Decimal,
        Decimal,
      ];
      if ([pred, l80, u80, l95, u95, base].some((d) => d.isNegative()))
        return { ok: false, reason: 'NEGATIVE' };
      if (!(l80.lte(pred) && pred.lte(u80) && l95.lte(l80) && u80.lte(u95))) {
        return { ok: false, reason: 'INTERVAL_ORDER' };
      }
      // phase8-v1: los motivos de la parte variable deben cerrar con la predicción (residuo de redondeo incluido).
      if (p.drivers) {
        const d = p.drivers;
        const texts8 = [
          d.historicalAverage,
          d.trendAndLevel,
          ...(d.seasonality === null ? [] : [d.seasonality]),
        ];
        if (texts8.some((t) => !DECIMAL_TEXT.test(t))) return { ok: false, reason: 'DRIVERS_MISMATCH' };
        const sum = dec(d.historicalAverage)
          .plus(d.trendAndLevel)
          .plus(d.seasonality ?? '0');
        if (!sum.eq(pred)) return { ok: false, reason: 'DRIVERS_MISMATCH' };
      }
    }
    return { ok: true };
  },
} as const;

function shift(period: string, months: number): string {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) + months;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}
