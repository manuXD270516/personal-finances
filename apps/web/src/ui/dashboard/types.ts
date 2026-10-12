/**
 * Tipos del contrato `getReportSummary` (`GET /workspaces/{workspaceId}/reports/summary`, finance-api.v1.yaml):
 * `ReportSummary` y sus esquemas. Los montos y tasas son `DecimalString` (INV-001): nunca `number`.
 */

import type { GoalContributionsNet, GoalsHomeBlock } from '../goals/types';
import type { Money, RateAttribution, ResolvedRate } from '../common/fx-types';
import type { SpendableSummary } from '../spendable/types';

export type {
  Money,
  FxRateType,
  FxRateSource,
  FxRateProvider,
  RateSelection,
  RateAttribution,
  ResolvedRate,
} from '../common/fx-types';

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

/** Categoría del top-N de gasto (o ingreso) neto del periodo (moneda de reporte; puede ser negativa). */
export interface TopCategory {
  readonly categoryId: string;
  readonly name: string;
  readonly amount: Money;
  readonly complete: boolean;
  /**
   * Neto de la misma categoría en el periodo de comparación (cero si no tuvo flujos); `null` sin comparación o si la
   * API no pudo convertirlo (FR-REPORTING-004).
   */
  readonly previousAmount?: Money | null;
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
  readonly topExpenseCategories: readonly TopCategory[];
  /** Principales categorías de ingreso del periodo (FR-REPORTING-004). */
  readonly topIncomeCategories?: readonly TopCategory[];
  readonly netWorth: NetWorthBreakdown;
  readonly questions: readonly HomeQuestionStatus[];
  /** Q9 (add-savings-goals): metas en curso; puede faltar en respuestas anteriores a la fase 4. */
  readonly goals?: GoalsHomeBlock | null;
  /** Aportes netos a metas del periodo junto al ahorro (Q6); no cambia el ahorro ni su tasa. */
  readonly goalContributions?: GoalContributionsNet | null;
  /** Q5 (add-spendable-amount): disponible para gastar libre de compromisos; `null` sin cuentas líquidas. */
  readonly spendable?: SpendableSummary | null;
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
