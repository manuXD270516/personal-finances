/**
 * Tipos del contrato `getReportSummary` (`GET /workspaces/{workspaceId}/reports/summary`, finance-api.v1.yaml):
 * `ReportSummary` y sus esquemas. Los montos y tasas son `DecimalString` (INV-001): nunca `number`.
 */

export interface Money {
  readonly amount: string;
  readonly currency: string;
}

export type FxRateType = 'OFFICIAL' | 'PARALLEL' | 'P2P' | 'BANK' | 'CUSTOM';
export type FxRateSource = 'MANUAL' | 'PROVIDER' | 'USER_CONVERSION';
export type FxRateProvider = 'PARALELO_BO' | 'DOLARAPI_BO';
export type RateSelection = 'PRIMARY' | 'FALLBACK' | 'LAST_KNOWN_STALE' | 'MANUAL';
export type AccountType =
  | 'BANK'
  | 'CASH'
  | 'DIGITAL_WALLET'
  | 'CREDIT_CARD'
  | 'LOAN'
  | 'CRYPTO_WALLET'
  | 'INVESTMENT'
  | 'SAVINGS'
  | 'VIRTUAL'
  | 'MANUAL_ASSET'
  | 'MANUAL_LIABILITY';

export interface RateAttribution {
  readonly provider: FxRateProvider;
  readonly text: string;
  readonly url: string;
  readonly license?: string | null;
  readonly licenseUrl?: string | null;
}

export interface ResolvedRate {
  readonly rate: { readonly base: string; readonly quote: string; readonly value: string };
  readonly fxRateId?: string | null;
  readonly derivation: 'DIRECT' | 'INVERSE' | 'CROSS';
  readonly rateType: FxRateType;
  readonly source: FxRateSource;
  readonly asOf: string;
  readonly ageDays: number;
  readonly approx: boolean;
  readonly ageSeconds?: number;
  readonly provider?: FxRateProvider | null;
  readonly selection?: RateSelection;
  readonly stale?: boolean;
  readonly attribution?: RateAttribution | null;
  /** Fuente declarada de una tasa manual (p. ej. "Casa de cambio centro"). */
  readonly sourceLabel?: string | null;
}

export interface CurrencyTotals {
  readonly currency: string;
  readonly income: Money;
  readonly expense: Money;
  readonly net: Money;
  readonly liquidBalance?: Money;
  readonly savingsRate?: string | null;
  readonly assets?: Money;
  readonly liabilities?: Money;
  readonly netWorth?: Money;
}

export interface ConsolidatedTotals {
  readonly currency: string;
  readonly income: Money;
  readonly expense: Money;
  readonly net: Money;
  readonly liquidBalance: Money;
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
  readonly savingsRate?: string | null;
  readonly complete: boolean;
  readonly unconverted: readonly Money[];
}

export interface MoneyVariation {
  readonly current: Money;
  readonly previous: Money;
  readonly deltaAbs: Money;
  readonly deltaPct?: string | null;
  readonly isNew: boolean;
}

export interface PeriodComparison {
  readonly mode: 'PREVIOUS_PERIOD_TO_DATE' | 'PREVIOUS_PERIOD';
  readonly previousPeriod: { readonly from: string; readonly to: string };
  readonly income: MoneyVariation;
  readonly expense: MoneyVariation;
  readonly savings: MoneyVariation;
}

export interface AccountBalanceLine {
  readonly accountId: string;
  readonly name: string;
  readonly type: AccountType;
  readonly nature: 'ASSET' | 'LIABILITY';
  readonly balance: Money;
  readonly convertedBalance?: Money | null;
  readonly rate?: ResolvedRate | null;
  readonly includeInNetWorth: boolean;
  readonly liquid: boolean;
}

export interface NetWorthBreakdown {
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
  readonly complete: boolean;
  readonly byCurrency: readonly {
    readonly currency: string;
    readonly assets: Money;
    readonly liabilities: Money;
    readonly net: Money;
    readonly converted: Money | null;
  }[];
  readonly byAccountType: readonly { readonly type: AccountType; readonly amount: Money }[];
  readonly unvalued: readonly Money[];
}

export type HomeQuestion = 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7' | 'Q8' | 'Q9';
export type HomeQuestionAvailability = 'AVAILABLE' | 'NO_DATA' | 'NOT_AVAILABLE_IN_PHASE';

export interface HomeQuestionStatus {
  readonly question: HomeQuestion;
  readonly status: HomeQuestionAvailability;
  /** Código de acción sugerida (`CREATE_ACCOUNT`, `AVAILABLE_IN_PHASE_3`…), traducido en la UI. */
  readonly actionHint: string | null;
}

export interface ReportSummary {
  readonly period: { readonly from: string; readonly to: string };
  readonly byCurrency: readonly CurrencyTotals[];
  readonly consolidated: ConsolidatedTotals;
  readonly comparison?: PeriodComparison | null;
  readonly accounts: readonly AccountBalanceLine[];
  readonly topExpenseCategories: readonly {
    readonly categoryId: string;
    readonly name: string;
    readonly amount: Money;
    readonly complete: boolean;
  }[];
  readonly netWorth: NetWorthBreakdown;
  readonly questions: readonly HomeQuestionStatus[];
  readonly meta: {
    readonly generatedAt: string;
    readonly reportingCurrency: string;
    readonly approx: boolean;
    readonly timeZone: string;
    readonly rateWindowDays: number;
    readonly complete: boolean;
    readonly dataFreshness?: string;
    readonly ratesUsed?: readonly ResolvedRate[];
    readonly attributions?: readonly RateAttribution[];
  };
}

/** Traductor del namespace `Dashboard` (inyectado para que los componentes sean presentacionales y testeables). */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** Contexto de formato: locale del workspace (`es-BO`) y su zona horaria (`America/La_Paz`). */
export interface FormatContext {
  readonly locale: string;
  readonly timeZone: string;
  readonly t: Translate;
  readonly has: (key: string) => boolean;
}
