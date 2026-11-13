/**
 * Contrato público de FORECAST (openspec add-ml-forecasting-service). Los demás contextos (REPORTING en el change 66)
 * leen el pronóstico vigente solo por aquí (ARCHITECTURE §2).
 */

/** Trabajo periódico diario: crea las corridas programadas y purga según la retención. */
export const FORECAST_SCHEDULE_JOB = 'forecasting.schedule';
/** Ejecutor: procesa UNA corrida por pasada dentro de la reserva de trabajos periódicos del worker (D249). */
export const FORECAST_RUNNER_JOB = 'forecasting.runner';
export const FORECAST_GENERATED_EVENT = { type: 'forecast.ForecastGenerated', version: 1 } as const;

export type ForecastRunStatusDto =
  'REQUESTED' | 'RUNNING' | 'COMPLETED' | 'INSUFFICIENT_DATA' | 'FAILED' | 'SUPERSEDED';
export type ForecastFailureReasonDto =
  'SERVICE_UNAVAILABLE' | 'SERVICE_REJECTED' | 'TIMEOUT' | 'INVALID_OUTPUT';
export type ForecastScopeDto =
  | 'TOTAL_EXPENSE'
  | 'CATEGORY_GROUP'
  | 'CATEGORY'
  | 'OTHER_CATEGORIES'
  | 'TOTAL_INCOME'
  /** Gasto variable pagado desde cuentas líquidas de UNA moneda, en esa moneda (`currency` de la serie). */
  | 'LIQUID_VARIABLE_OUTFLOW';
export type ForecastReadinessDto = 'MODEL' | 'SIMPLE' | 'INSUFFICIENT';

export interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
}

export interface ForecastRunSummaryDto {
  readonly id: string;
  readonly trigger: 'MANUAL' | 'SCHEDULED';
  readonly status: ForecastRunStatusDto;
  readonly requestedAt: string;
  readonly requestedBy: string | null;
  readonly completedAt: string | null;
  readonly asOfPeriod: string | null;
  readonly attempts: number;
  readonly failureReason: ForecastFailureReasonDto | null;
  readonly seriesCount: {
    readonly published: number;
    readonly insufficient: number;
    readonly invalid: number;
  };
}

export type ForecastSelectedByDto = 'BACKTEST' | 'BASELINE_FALLBACK' | 'SIMPLE';
export type ForecastConfidenceDto = 'LOW' | 'MEDIUM' | 'HIGH';
export type ForecastDriverTypeDto =
  'HISTORICAL_AVERAGE' | 'SEASONALITY' | 'TREND_AND_LEVEL' | 'OUTLIERS' | 'KNOWN_RECURRING';

/** Motivo del pronóstico de un punto (add-expense-forecasts, decisión 8): sobre la parte variable. */
export interface ForecastDriverDto {
  readonly type: ForecastDriverTypeDto;
  readonly value: MoneyDto | null;
  readonly effect: MoneyDto | null;
  readonly periods: readonly string[];
  readonly refCount: number;
}

/** Descomposición del punto: conocidos (deterministas) + variable predicho (decisión 1). */
export interface ForecastPointComponentsDto {
  readonly knownFuture: MoneyDto;
  readonly predictedVariable: MoneyDto;
  readonly predictedVariableInterval80: { readonly lower: MoneyDto; readonly upper: MoneyDto };
  readonly knownWithoutAmountCount: number;
}

export interface ForecastKnownItemDto {
  readonly date: string;
  readonly label: string;
  readonly kind: 'EXPENSE' | 'INCOME' | 'LOAN_INTEREST';
  readonly amountType: string;
  readonly amount: MoneyDto | null;
  readonly originalAmount: MoneyDto | null;
  readonly managedBy: string | null;
  readonly sourceRef: { readonly context: 'COMMITMENTS' | 'DEBT'; readonly id: string };
}

export interface ForecastKnownItemsDto {
  readonly items: readonly ForecastKnownItemDto[];
}

export interface ForecastPointDto {
  readonly period: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly monthsAhead: number;
  readonly prediction: MoneyDto;
  readonly interval80: { readonly lower: MoneyDto; readonly upper: MoneyDto };
  readonly interval95: { readonly lower: MoneyDto; readonly upper: MoneyDto };
  readonly baseline: { readonly method: string; readonly n: number | null; readonly value: MoneyDto };
  /** `null` en las corridas anteriores a add-expense-forecasts. */
  readonly components: ForecastPointComponentsDto | null;
  readonly drivers: readonly ForecastDriverDto[] | null;
  /** Solo en el gasto total y solo si supera `FORECASTING_COHERENCE_GAP_RATIO`: total − Σ categorías del periodo. */
  readonly coherenceGap: MoneyDto | null;
}

export interface ForecastSeriesSummaryDto {
  readonly scope: ForecastScopeDto;
  readonly scopeRef: string | null;
  readonly name: string;
  readonly readiness: ForecastReadinessDto;
  readonly readinessReasons: readonly {
    readonly code: string;
    readonly missingForSimple: number | null;
    readonly missingForModel: number | null;
  }[];
  readonly historyFrom: string | null;
  readonly historyTo: string | null;
  readonly historyPeriods: number;
  readonly groupedCategoryIds: readonly string[];
}

export interface ForecastSeriesDto extends ForecastSeriesSummaryDto {
  readonly currency: string;
  readonly model: {
    readonly name: string;
    readonly version: string;
    readonly selectedBy: ForecastSelectedByDto | null;
    /** Decimal con 4 decimales. */
    readonly mase: string | null;
    readonly baselineMase: string | null;
  } | null;
  readonly confidence: ForecastConfidenceDto | null;
  readonly points: readonly ForecastPointDto[];
}

export interface ForecastRunDto extends ForecastRunSummaryDto {
  readonly datasetSnapshotId: string | null;
  readonly serviceVersion: string | null;
  readonly reportingCurrency: string;
  readonly series: readonly ForecastSeriesSummaryDto[];
}

export interface LatestForecastDto {
  readonly status: 'AVAILABLE' | 'NONE' | 'DISABLED';
  /** `true` si el pronóstico tiene más de 35 días o si la última corrida posterior falló. */
  readonly stale: boolean;
  readonly lastAttempt: {
    readonly status: ForecastRunStatusDto;
    readonly at: string;
    readonly failureReason: ForecastFailureReasonDto | null;
  } | null;
  readonly run: ForecastRunSummaryDto | null;
  readonly reportingCurrency: string;
  readonly generatedAt: string | null;
  readonly series: readonly ForecastSeriesDto[];
  readonly disclaimerKey: string;
  /** Conversión de los conocidos en otra moneda con la tasa de hoy (`null` si no hubo ninguno). */
  readonly meta: {
    readonly conversion: { readonly rateDate: string; readonly ratesUsed: readonly unknown[] } | null;
  };
}

/**
 * Query pública (para el change 66, REPORTING): el pronóstico vigente del workspace por series y horizonte. Sin `scopes`
 * devuelve las series de siempre (no incluye `LIQUID_VARIABLE_OUTFLOW`: hay que pedirla); cada serie informa su `currency`.
 */
export interface LatestForecastQuery {
  getLatest(input: {
    readonly workspaceId: string;
    readonly scopes?: readonly ForecastScopeDto[];
    readonly scopeRef?: string;
    readonly horizon?: 1 | 3 | 6 | 12;
  }): Promise<LatestForecastDto>;
}

export const LATEST_FORECAST_QUERY = Symbol.for('pf.forecasting.LatestForecastQuery');

export interface LiquidVariableSpendDto {
  readonly currency: string;
  /** Decimal a la escala de la moneda. */
  readonly amount: string;
}

/**
 * Gasto variable ya hecho desde cuentas líquidas (add-predicted-cash-flow-band): el mismo criterio que la historia de la
 * serie `LIQUID_VARIABLE_OUTFLOW`, por moneda y sin conversión, entre `from` y `to` (inclusive). Lo usa REPORTING para
 * saber cuánto falta del gasto predicho del periodo en curso. En la unidad de trabajo del llamador si existe.
 */
export interface LiquidVariableSpendQuery {
  spentBetween(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<readonly LiquidVariableSpendDto[]>;
}

export const LIQUID_VARIABLE_SPEND_QUERY = Symbol.for('pf.forecasting.LiquidVariableSpendQuery');

/**
 * Allow-list de redacción de la auditoría (add-audit-trail): la solicitud manual de la corrida (sin montos). Los valores
 * compuestos viajan como texto JSON.
 */
export const FORECASTING_AUDIT_POLICY = {
  ForecastRun: {
    trigger: 'plain',
    status: 'plain',
    requestedBy: 'plain',
    attempts: 'plain',
    failureReason: 'plain',
    asOfPeriod: 'plain',
  },
} as const;

export const FORECAST_DISCLAIMER_KEY = 'forecast.disclaimer';

export * from './portability.js';
