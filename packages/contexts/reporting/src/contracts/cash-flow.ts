/**
 * Contratos del pronóstico de flujo de caja (openspec add-cash-flow-forecast, Phase 7, change 60): calendario 7/30/60/90,
 * riesgo de déficit, ajustes del disponible, variación por categoría (Q7) y digest del Home. Montos como
 * `{amount: "<decimal>", currency}` (nunca `number`, ADR-0006).
 */
import type { RateAttributionDto, ResolvedRateDto } from '@pf/fx/contracts';

interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
}

/** Job periódico que evalúa el riesgo de déficit de cada workspace (design decisión 13; D381). */
export const CASH_FLOW_WATCH_JOB = 'reporting.cash-flow-watch';

/** Hechos de dominio que publica el job (productor REPORTING, agregado `CashFlowShortfallEpisode`; sin consumidores). */
export const REPORTING_SHORTFALL_EVENTS = {
  detected: { type: 'reporting.CashFlowShortfallRiskDetected', version: 1 },
  cleared: { type: 'reporting.CashFlowShortfallRiskCleared', version: 1 },
} as const;

/** Horizontes admitidos del calendario (días). */
export const CASH_FLOW_HORIZONS = [7, 30, 60, 90] as const;
export type CashFlowHorizonDays = (typeof CASH_FLOW_HORIZONS)[number];

export type CashFlowRiskDto = 'NONE' | 'LOW' | 'POSSIBLE' | 'HIGH';
export type CashFlowEventKindDto =
  | 'INCOME'
  | 'EXPENSE'
  | 'TRANSFER'
  | 'CONVERSION'
  | 'LOAN_PAYMENT'
  | 'CARD_PAYMENT';
export type CashFlowCertaintyDto = 'KNOWN' | 'ESTIMATED' | 'EXPECTED';

export interface CashFlowDayDto {
  readonly date: string;
  /** Saldo esperado al cierre del día. */
  readonly balance: MoneyDto;
  /** Saldo más bajo del día: el del día anterior más los egresos del día (egresos antes que ingresos). */
  readonly low: MoneyDto;
}

export interface CashFlowCurrencyDto {
  readonly currency: string;
  readonly threshold: { readonly amount: MoneyDto; readonly source: 'MINIMUM_RESERVE' | 'ZERO' };
  readonly startBalance: MoneyDto;
  readonly endBalance: MoneyDto;
  readonly lowest: { readonly amount: MoneyDto; readonly date: string };
  readonly risk: CashFlowRiskDto;
  readonly firstShortfallDate: string | null;
  readonly shortfallAmount: MoneyDto | null;
  readonly belowZero: boolean;
  readonly outflowTotal: MoneyDto;
  readonly inflowTotal: MoneyDto;
  /** Movimientos `VARIABLE` listados sin monto (nunca 0). */
  readonly withoutAmountCount: number;
  readonly series: readonly CashFlowDayDto[];
  /** Serie con el gasto planificado restante del plan (Should); `null` sin plan aplicable. */
  readonly planned: {
    readonly lowest: { readonly amount: MoneyDto; readonly date: string };
    readonly endBalance: MoneyDto;
    readonly series: readonly { readonly date: string; readonly balance: MoneyDto }[];
  } | null;
  /** Peor caso sin ingresos esperados (Should). */
  readonly withoutExpectedIncome: {
    readonly lowest: { readonly amount: MoneyDto; readonly date: string };
    readonly endBalance: MoneyDto;
  };
}

export interface CashFlowAccountDto {
  readonly accountId: string;
  readonly name: string;
  readonly currency: string;
  readonly startBalance: MoneyDto;
  readonly endBalance: MoneyDto;
  readonly lowest: { readonly amount: MoneyDto; readonly date: string };
  /** Solo al pedir esa cuenta (`accountId`); `null` en el resto. */
  readonly series: readonly CashFlowDayDto[] | null;
}

export interface CashFlowEventDto {
  readonly id: string;
  /** Fecha en que se aplica al saldo (hoy para lo atrasado). */
  readonly date: string;
  readonly originalDate: string;
  readonly source: 'OCCURRENCE' | 'PENDING';
  readonly kind: CashFlowEventKindDto;
  readonly certainty: CashFlowCertaintyDto;
  readonly amountType: 'FIXED' | 'ESTIMATED' | 'MIN_MAX' | 'VARIABLE' | null;
  readonly name: string | null;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly amount: MoneyDto | null;
  readonly toAmount: MoneyDto | null;
  readonly overdue: boolean;
  readonly daysOverdue: number | null;
  readonly managedBy: 'USER' | 'SUBSCRIPTION' | 'DEBT' | 'GOAL' | null;
  readonly sourceRef: { readonly context: 'COMMITMENTS' | 'TRANSACTIONS'; readonly id: string };
}

export interface CashFlowSuggestionDto {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  /** Equivalente aproximado (HALF_EVEN) en `fromCurrency`; nunca ejecuta nada. */
  readonly approxAmount: MoneyDto;
  readonly rate: ResolvedRateDto;
  readonly before: string;
}

/** `CashFlowCalendar` del contrato (`GET /workspaces/{workspaceId}/reports/cash-flow-calendar`). */
export interface CashFlowCalendarDto {
  readonly horizonDays: number;
  readonly today: string;
  readonly from: string;
  readonly to: string;
  readonly reportingCurrency: string;
  readonly coverage: { readonly through: string; readonly complete: boolean };
  readonly currencies: readonly CashFlowCurrencyDto[];
  readonly accounts: readonly CashFlowAccountDto[];
  readonly events: readonly CashFlowEventDto[];
  readonly plannedSpending: {
    readonly periods: readonly {
      readonly periodId: string | null;
      readonly label: string;
      readonly status: 'PLAN' | 'NO_PLAN';
    }[];
  };
  readonly suggestions: readonly CashFlowSuggestionDto[];
  readonly consolidated: {
    readonly lowest: { readonly amount: MoneyDto; readonly date: string } | null;
    readonly complete: boolean;
    readonly unconverted: readonly MoneyDto[];
  };
  readonly meta: {
    readonly generatedAt: string;
    readonly dataFreshness?: string;
    readonly rateWindowDays: number;
    readonly ratesUsed: readonly ResolvedRateDto[];
    readonly attributions: readonly RateAttributionDto[];
  };
}

/** Bloque `cashFlow` del resumen del Home (Q8): calendario de 30 días sin la serie del plan; `null` sin cuentas líquidas. */
export interface CashFlowHomeBlockDto {
  readonly horizonDays: 30;
  readonly worst: {
    readonly currency: string;
    readonly risk: CashFlowRiskDto;
    readonly lowest: MoneyDto;
    readonly lowestDate: string;
    readonly firstShortfallDate: string | null;
  } | null;
  readonly consolidatedLowest: { readonly amount: MoneyDto; readonly date: string } | null;
  readonly complete: boolean;
}

/** Variación por categoría de los tops del Home (Q7, D389). */
export interface CategoryVariationDto {
  readonly amount: MoneyDto;
  /** Porcentaje con dos decimales (`"8.75"`); `null` si el monto anterior es cero (ver `isNew`). */
  readonly percent: string | null;
  readonly isNew: boolean;
  readonly direction: 'FAVORABLE' | 'UNFAVORABLE' | 'NONE';
}

// ───────────────────────────────────────────── ajustes del disponible (D377, D378)

export type SpendableHorizonModeDto = 'FINANCIAL_PERIOD' | 'NEXT_INCOME';

export interface SpendableSettingsDto {
  readonly horizonMode: SpendableHorizonModeDto;
  readonly subtractEssentials: boolean;
  readonly essentialCategoryIds: readonly string[];
  readonly version: number;
}

export interface SpendableSettingsInputDto {
  readonly horizonMode: SpendableHorizonModeDto;
  readonly subtractEssentials: boolean;
  readonly essentialCategoryIds: readonly string[];
}

// ───────────────────────────────────────────── digest del Home (D385, D386)

/**
 * Una pregunta del digest. REPORTING entrega TODO lo que sabe (incluidos los montos en `amounts`); NOTIFY guarda en los
 * parámetros solo lo que va a mostrar y descarta `amounts` si el destinatario no activó los detalles (FR-NOTIFY-006).
 * Claves documentadas (todas opcionales): `counts` (`upcoming7d`, `overdue`, `goals`, `goalsBehind`, `goalsOnTrack`,
 * `goalsAhead`), `percents` (`incomeChange`, `expenseChange`, `savingsRate`), `dates` (`firstShortfall`), `states`
 * (`spendableSign`: `POSITIVE`|`ZERO`|`NEGATIVE`; `risk`: nivel; `riskCurrency`) y `amounts` (`liquid`, `income`, `expense`,
 * `committed`, `spendable`, `savings`, `lowestBalance`).
 */
export interface HomeDigestQuestionDto {
  readonly question: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7' | 'Q8' | 'Q9';
  readonly status: 'AVAILABLE' | 'NO_DATA';
  readonly counts: Readonly<Record<string, number>>;
  readonly percents: Readonly<Record<string, string>>;
  readonly dates: Readonly<Record<string, string>>;
  readonly states: Readonly<Record<string, string>>;
  readonly amounts: Readonly<Record<string, MoneyDto>>;
}

export interface HomeDigestDto {
  readonly workspaceId: string;
  readonly generatedAt: string;
  readonly timeZone: string;
  readonly today: string;
  readonly reportingCurrency: string;
  readonly questions: readonly HomeDigestQuestionDto[];
}

/** Contrato público para NOTIFY (que lo declara estructuralmente como `HomeDigestSourcePort`). */
export interface HomeDigestQuery {
  compose(input: { readonly workspaceId: string }): Promise<HomeDigestDto>;
}
export const HOME_DIGEST_QUERY = Symbol.for('pf.reporting.HomeDigestQuery');
