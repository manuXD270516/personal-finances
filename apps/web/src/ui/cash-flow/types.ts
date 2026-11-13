/**
 * Tipos de los contratos `getCashFlowCalendar` (`GET /workspaces/{workspaceId}/reports/cash-flow-calendar`),
 * `ReportSummary.cashFlow` y los ajustes del disponible (finance-api.v1.yaml; add-cash-flow-forecast, Phase 7). Los
 * montos son `DecimalString` (INV-001): nunca `number`. Espejo de `packages/contexts/reporting/src/contracts/cash-flow.ts`
 * (la web no importa los contextos).
 */
import type { Money, RateAttribution, ResolvedRate } from '../common/fx-types';

export type { Money, RateAttribution, ResolvedRate };

export type CashFlowRisk = 'NONE' | 'LOW' | 'POSSIBLE' | 'HIGH';
export type CashFlowEventKind =
  'INCOME' | 'EXPENSE' | 'TRANSFER' | 'CONVERSION' | 'LOAN_PAYMENT' | 'CARD_PAYMENT';
export type CashFlowCertainty = 'KNOWN' | 'ESTIMATED' | 'EXPECTED';

export interface CashFlowDay {
  readonly date: string;
  /** Saldo esperado al cierre del día. */
  readonly balance: Money;
  /** Saldo más bajo del día (egresos antes que ingresos). */
  readonly low: Money;
}

export interface CashFlowLowest {
  readonly amount: Money;
  readonly date: string;
}

export type PredictedUnavailableReason =
  'DISABLED' | 'NO_FORECAST' | 'NO_SERIES' | 'INSUFFICIENT_DATA' | 'NO_CURRENT_PERIOD';
export type ShortfallLikelihood = 'LIKELY' | 'POSSIBLE' | 'UNLIKELY' | 'NOT_AVAILABLE';

/**
 * Banda del gasto variable predicho de una moneda (add-predicted-cash-flow-band). `expected`, `high` y `low` son SALDOS:
 * la serie principal menos el gasto variable predicho acumulado con el valor esperado, el límite superior (gasto alto,
 * el saldo más bajo) y el inferior (gasto bajo, el más alto) del intervalo del 80 %. Nunca se suman a la serie principal.
 */
export interface PredictedCashFlow {
  readonly status: 'AVAILABLE' | 'NOT_AVAILABLE';
  readonly reason: PredictedUnavailableReason | null;
  readonly forecastRunId: string | null;
  readonly generatedAt: string | null;
  readonly stale: boolean;
  readonly intervalLevel: '0.8';
  readonly series: readonly {
    readonly date: string;
    readonly expected: Money;
    readonly high: Money;
    readonly low: Money;
  }[];
  readonly lowest: { readonly expected: CashFlowLowest; readonly high: CashFlowLowest } | null;
  readonly shortfallLikelihood: ShortfallLikelihood;
  readonly firstShortfallDate: string | null;
}

export interface CashFlowCurrency {
  readonly currency: string;
  readonly threshold: { readonly amount: Money; readonly source: 'MINIMUM_RESERVE' | 'ZERO' };
  readonly startBalance: Money;
  readonly endBalance: Money;
  readonly lowest: CashFlowLowest;
  readonly risk: CashFlowRisk;
  readonly firstShortfallDate: string | null;
  readonly shortfallAmount: Money | null;
  readonly belowZero: boolean;
  readonly outflowTotal: Money;
  readonly inflowTotal: Money;
  readonly withoutAmountCount: number;
  readonly series: readonly CashFlowDay[];
  readonly planned: {
    readonly lowest: CashFlowLowest;
    readonly endBalance: Money;
    readonly series: readonly { readonly date: string; readonly balance: Money }[];
  } | null;
  readonly withoutExpectedIncome: { readonly lowest: CashFlowLowest; readonly endBalance: Money };
  /** Banda del gasto variable predicho y probabilidad de déficit; puede faltar en respuestas anteriores a la Phase 8. */
  readonly predicted?: PredictedCashFlow;
}

export interface CashFlowAccount {
  readonly accountId: string;
  readonly name: string;
  readonly currency: string;
  readonly startBalance: Money;
  readonly endBalance: Money;
  readonly lowest: CashFlowLowest;
  readonly series: readonly CashFlowDay[] | null;
}

export interface CashFlowEvent {
  readonly id: string;
  /** Fecha en que se aplica al saldo (hoy para lo atrasado). */
  readonly date: string;
  readonly originalDate: string;
  readonly source: 'OCCURRENCE' | 'PENDING';
  readonly kind: CashFlowEventKind;
  readonly certainty: CashFlowCertainty;
  readonly amountType: 'FIXED' | 'ESTIMATED' | 'MIN_MAX' | 'VARIABLE' | null;
  readonly name: string | null;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly amount: Money | null;
  readonly toAmount: Money | null;
  readonly overdue: boolean;
  readonly daysOverdue: number | null;
  readonly managedBy: 'USER' | 'SUBSCRIPTION' | 'DEBT' | 'GOAL' | null;
  readonly sourceRef: { readonly context: 'COMMITMENTS' | 'TRANSACTIONS'; readonly id: string };
}

export interface CashFlowSuggestion {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  readonly approxAmount: Money;
  readonly rate: ResolvedRate;
  readonly before: string;
}

export interface CashFlowPlannedPeriod {
  readonly periodId: string | null;
  readonly label: string;
  readonly status: 'PLAN' | 'NO_PLAN';
}

export interface CashFlowCalendar {
  readonly horizonDays: number;
  readonly today: string;
  readonly from: string;
  readonly to: string;
  readonly reportingCurrency: string;
  readonly coverage: { readonly through: string; readonly complete: boolean };
  readonly currencies: readonly CashFlowCurrency[];
  readonly accounts: readonly CashFlowAccount[];
  readonly events: readonly CashFlowEvent[];
  readonly plannedSpending: { readonly periods: readonly CashFlowPlannedPeriod[] };
  readonly suggestions: readonly CashFlowSuggestion[];
  readonly consolidated: {
    readonly lowest: CashFlowLowest | null;
    readonly complete: boolean;
    readonly unconverted: readonly Money[];
  };
  readonly meta: {
    readonly generatedAt: string;
    readonly dataFreshness?: string;
    readonly rateWindowDays: number;
    readonly ratesUsed: readonly ResolvedRate[];
    readonly attributions: readonly RateAttribution[];
  };
}

/** Bloque `cashFlow` del resumen del Home (Q8); `null` sin cuentas líquidas. */
export interface CashFlowHomeBlock {
  readonly horizonDays: 30;
  readonly worst: {
    readonly currency: string;
    readonly risk: CashFlowRisk;
    readonly lowest: Money;
    readonly lowestDate: string;
    readonly firstShortfallDate: string | null;
  } | null;
  readonly consolidatedLowest: CashFlowLowest | null;
  readonly complete: boolean;
  /** Probabilidad de déficit con el gasto predicho, aparte del riesgo de los pagos conocidos. */
  readonly predictedShortfall?: {
    readonly currency: string;
    readonly likelihood: Exclude<ShortfallLikelihood, 'NOT_AVAILABLE'>;
    readonly date: string | null;
  } | null;
}

/** Variación por categoría de los tops del Home (Q7). */
export interface CategoryVariation {
  readonly amount: Money;
  /** Porcentaje con dos decimales (`"8.75"`); `null` si el monto anterior es cero (ver `isNew`). */
  readonly percent: string | null;
  readonly isNew: boolean;
  readonly direction: 'FAVORABLE' | 'UNFAVORABLE' | 'NONE';
}

export type SpendableHorizonMode = 'FINANCIAL_PERIOD' | 'NEXT_INCOME';

export interface SpendableSettings {
  readonly horizonMode: SpendableHorizonMode;
  readonly subtractEssentials: boolean;
  readonly essentialCategoryIds: readonly string[];
  readonly version: number;
}

export interface SpendableSettingsInput {
  readonly horizonMode: SpendableHorizonMode;
  readonly subtractEssentials: boolean;
  readonly essentialCategoryIds: readonly string[];
}
