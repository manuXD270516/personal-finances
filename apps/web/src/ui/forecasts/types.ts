/**
 * Tipos de `getLatestForecast` y `listForecastKnownItems` (finance-api.v1.yaml; add-ml-forecasting-service y
 * add-expense-forecasts, Phase 8). Los montos son `DecimalString` (INV-001): nunca `number`. Espejo de
 * `packages/contexts/forecasting/src/contracts/index.ts` (la web no importa los contextos).
 */
export interface Money {
  readonly amount: string;
  readonly currency: string;
}

export type ForecastScope =
  'TOTAL_EXPENSE' | 'CATEGORY_GROUP' | 'CATEGORY' | 'OTHER_CATEGORIES' | 'TOTAL_INCOME';
export type ForecastReadiness = 'MODEL' | 'SIMPLE' | 'INSUFFICIENT';
export type ForecastConfidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type ForecastDriverType =
  'HISTORICAL_AVERAGE' | 'SEASONALITY' | 'TREND_AND_LEVEL' | 'OUTLIERS' | 'KNOWN_RECURRING';

export interface ForecastInterval {
  readonly lower: Money;
  readonly upper: Money;
}

export interface ForecastDriver {
  readonly type: ForecastDriverType | string;
  readonly value: Money | null;
  readonly effect: Money | null;
  readonly periods: readonly string[];
  readonly refCount: number;
}

export interface ForecastPoint {
  readonly period: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly monthsAhead: number;
  readonly prediction: Money;
  readonly interval80: ForecastInterval;
  readonly interval95: ForecastInterval;
  readonly baseline: { readonly method: string; readonly n: number | null; readonly value: Money };
  readonly components?: {
    readonly knownFuture: Money;
    readonly predictedVariable: Money;
    readonly predictedVariableInterval80: ForecastInterval;
    readonly knownWithoutAmountCount: number;
  } | null;
  readonly drivers?: readonly ForecastDriver[] | null;
  readonly coherenceGap?: Money | null;
}

export interface ForecastReadinessReason {
  readonly code: string;
  readonly missingForSimple: number | null;
  readonly missingForModel: number | null;
}

export interface ForecastSeries {
  readonly scope: ForecastScope;
  readonly scopeRef: string | null;
  readonly name: string;
  readonly readiness: ForecastReadiness;
  readonly readinessReasons: readonly ForecastReadinessReason[];
  readonly historyFrom: string | null;
  readonly historyTo: string | null;
  readonly historyPeriods: number;
  readonly groupedCategoryIds: readonly string[];
  readonly currency: string;
  readonly model: {
    readonly name: string;
    readonly version: string;
    readonly selectedBy?: 'BACKTEST' | 'BASELINE_FALLBACK' | 'SIMPLE' | string | null;
    readonly mase?: string | null;
    readonly baselineMase?: string | null;
  } | null;
  readonly confidence?: ForecastConfidence | null;
  readonly points: readonly ForecastPoint[];
}

export interface LatestForecast {
  readonly status: 'AVAILABLE' | 'NONE' | 'DISABLED';
  readonly stale: boolean;
  readonly lastAttempt: {
    readonly status: string;
    readonly at: string;
    readonly failureReason: string | null;
  } | null;
  readonly run: {
    readonly id: string;
    readonly status: string;
    readonly completedAt: string | null;
    readonly asOfPeriod: string | null;
  } | null;
  readonly reportingCurrency: string;
  readonly generatedAt: string | null;
  readonly series: readonly ForecastSeries[];
  readonly disclaimerKey: string;
  readonly meta?: {
    readonly conversion: { readonly rateDate: string; readonly ratesUsed: readonly unknown[] } | null;
  };
}

export interface ForecastKnownItem {
  readonly date: string;
  readonly label: string;
  readonly kind: 'EXPENSE' | 'INCOME' | 'LOAN_INTEREST' | string;
  readonly amountType: string;
  readonly amount: Money | null;
  readonly originalAmount: Money | null;
  readonly managedBy: string | null;
  readonly sourceRef: { readonly context: string; readonly id: string };
}

export interface ForecastKnownItems {
  readonly items: readonly ForecastKnownItem[];
}
