/**
 * API pública de `@pf/reporting` (openspec add-basic-dashboard; ADR-0003). Hoja: no importa capas internas.
 * REPORTING es de solo lectura (CQRS, docs/14 §1): no publica eventos ni escribe en otros schemas. Montos como
 * `{amount: "<decimal>", currency: "<código>"}` (nunca `number`, ADR-0006).
 */
import type { ResolvedRateDto, RateAttributionDto } from '@pf/fx/contracts';

export const REPORTING_CONTEXT = 'reporting' as const;

/** Consumidor idempotente (`platform.inbox`) que versiona los datos del workspace para el ETag del resumen. */
export const REPORTING_DATA_VERSION_CONSUMER = 'reporting.data-version';

/** Eventos que invalidan el resumen (design.md decisión 7; contracts/events). */
export const REPORTING_INVALIDATING_EVENTS = [
  { type: 'ledger.JournalEntryPosted', version: 1 },
  { type: 'transactions.TransactionPosted', version: 1 },
  { type: 'transactions.TransactionVoided', version: 1 },
  { type: 'transactions.TransactionCategorized', version: 1 },
  { type: 'accounts.AccountOpened', version: 1 },
  { type: 'accounts.AccountArchived', version: 1 },
  { type: 'fx.RateRecorded', version: 1 },
] as const;

export interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
}

export interface MoneyVariationDto {
  readonly current: MoneyDto;
  readonly previous: MoneyDto;
  readonly deltaAbs: MoneyDto;
  readonly deltaPct: string | null;
  readonly isNew: boolean;
}

export interface CurrencyTotalsDto {
  readonly currency: string;
  readonly income: MoneyDto;
  readonly expense: MoneyDto;
  readonly net: MoneyDto;
  readonly liquidBalance: MoneyDto;
  readonly savingsRate: string | null;
  readonly assets: MoneyDto;
  readonly liabilities: MoneyDto;
  readonly netWorth: MoneyDto;
}

export interface ConsolidatedTotalsDto {
  readonly currency: string;
  readonly income: MoneyDto;
  readonly expense: MoneyDto;
  readonly net: MoneyDto;
  readonly liquidBalance: MoneyDto;
  readonly assets: MoneyDto;
  readonly liabilities: MoneyDto;
  readonly netWorth: MoneyDto;
  readonly savingsRate: string | null;
  readonly complete: boolean;
  readonly unconverted: readonly MoneyDto[];
}

export interface AccountBalanceLineDto {
  readonly accountId: string;
  readonly name: string;
  readonly type: string;
  readonly nature: 'ASSET' | 'LIABILITY';
  readonly balance: MoneyDto;
  readonly convertedBalance: MoneyDto | null;
  readonly rate: ResolvedRateDto | null;
  readonly includeInNetWorth: boolean;
  readonly liquid: boolean;
}

export interface NetWorthBreakdownDto {
  readonly assets: MoneyDto;
  readonly liabilities: MoneyDto;
  readonly netWorth: MoneyDto;
  readonly complete: boolean;
  readonly byCurrency: readonly {
    readonly currency: string;
    readonly assets: MoneyDto;
    readonly liabilities: MoneyDto;
    readonly net: MoneyDto;
    readonly converted: MoneyDto | null;
  }[];
  readonly byAccountType: readonly { readonly type: string; readonly amount: MoneyDto }[];
  readonly unvalued: readonly MoneyDto[];
}

export interface HomeQuestionStatusDto {
  readonly question: 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'Q5' | 'Q6' | 'Q7' | 'Q8' | 'Q9';
  readonly status: 'AVAILABLE' | 'NO_DATA' | 'NOT_AVAILABLE_IN_PHASE';
  readonly actionHint: string | null;
}

/** `ReportSummary` del contrato (`GET /workspaces/{workspaceId}/reports/summary`). */
export interface ReportSummaryDto {
  readonly period: { readonly from: string; readonly to: string };
  readonly byCurrency: readonly CurrencyTotalsDto[];
  readonly consolidated: ConsolidatedTotalsDto;
  readonly comparison: {
    readonly mode: 'PREVIOUS_PERIOD_TO_DATE' | 'PREVIOUS_PERIOD';
    readonly previousPeriod: { readonly from: string; readonly to: string };
    readonly income: MoneyVariationDto;
    readonly expense: MoneyVariationDto;
    readonly savings: MoneyVariationDto;
  } | null;
  readonly accounts: readonly AccountBalanceLineDto[];
  readonly topExpenseCategories: readonly {
    readonly categoryId: string;
    readonly name: string;
    readonly amount: MoneyDto;
    readonly complete: boolean;
  }[];
  readonly netWorth: NetWorthBreakdownDto;
  readonly questions: readonly HomeQuestionStatusDto[];
  readonly meta: {
    readonly generatedAt: string;
    readonly reportingCurrency: string;
    readonly approx: boolean;
    readonly timeZone: string;
    readonly rateWindowDays: number;
    readonly complete: boolean;
    readonly dataFreshness?: string;
    readonly ratesUsed: readonly ResolvedRateDto[];
    readonly attributions: readonly RateAttributionDto[];
  };
}
