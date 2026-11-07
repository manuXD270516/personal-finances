/**
 * DTOs públicos de los reportes financieros (openspec add-financial-reports; reporting/financial-reports). Montos como
 * `{amount, currency}` (nunca `number`, ADR-0006). Hoja: no importa capas internas.
 */
import type { ResolvedRateDto } from '@pf/fx/contracts';

interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
}

/** Allow-list de auditoría de la exportación de un reporte: acción `reporting.report.exported`, sin contenido. */
export const REPORTING_AUDIT_POLICY = {
  ReportExport: { reportId: 'plain', filters: 'plain', rowCount: 'plain' },
  // add-cash-flow-forecast: ajustes del disponible (`essentialCategoryIds` viaja como texto JSON).
  SpendableSettings: { horizonMode: 'plain', subtractEssentials: 'plain', essentialCategoryIds: 'plain' },
} as const;

/** Tope de filas de una exportación CSV síncrona (D370; `REPORT_EXPORT_TOO_LARGE` por encima). */
export const MAX_REPORT_EXPORT_ROWS = 50_000;

export interface ReportAmountDto {
  readonly byCurrency: readonly MoneyDto[];
  readonly consolidated: MoneyDto;
  readonly complete: boolean;
  readonly unconverted: readonly MoneyDto[];
}

export interface ReportPeriodDto {
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly partial: boolean;
  readonly days: number;
}

export interface ReportVariationDto {
  readonly compared: ReportAmountDto;
  readonly deltaAbs: MoneyDto;
  readonly deltaPct: string | null;
  readonly isNew: boolean;
}

export interface ReportBaselineDto {
  readonly periods: 3 | 6 | 12;
  readonly average: MoneyDto | null;
  readonly periodsUsed: number;
  readonly insufficient: boolean;
  readonly deltaAbs: MoneyDto | null;
  readonly deltaPct: string | null;
}

export type ReportConversionPolicyDto = 'TRANSACTION_DATE' | 'VALUATION_DATE' | 'CUTOFF_DATE';

export interface ReportConversionMetaDto {
  readonly policy: ReportConversionPolicyDto;
  readonly cutoffDate: string | null;
  readonly rateWindowDays: number;
  readonly ratesUsed: readonly ResolvedRateDto[];
  readonly attributions: readonly string[];
}

export interface ReportMetaDto {
  readonly reportId: string;
  readonly reportingCurrency: string;
  readonly grouping: 'FINANCIAL_PERIOD' | 'CALENDAR_MONTH';
  readonly from: string;
  readonly to: string;
  readonly periods: readonly ReportPeriodDto[];
  readonly comparison: {
    readonly mode: string;
    readonly from: string;
    readonly to: string;
    /** Días del rango comparado. */
    readonly days: number;
    /** Días del rango del reporte (para avisar cuando difieren). */
    readonly currentDays: number;
    readonly normalized: boolean;
  } | null;
  readonly conversion: ReportConversionMetaDto;
  readonly complete: boolean;
  readonly unconverted: readonly MoneyDto[];
  readonly dataVersion: string;
  readonly latestEntryAt: string | null;
  readonly generatedAt: string;
  readonly filters: {
    readonly accountIds: readonly string[];
    readonly currencies: readonly string[];
    readonly categoryIds: readonly string[];
    readonly tagIds: readonly string[];
    readonly counterpartyIds: readonly string[];
  };
}

export interface ReportCatalogDto {
  readonly reports: readonly {
    readonly reportId: string;
    readonly number: number;
    readonly status: 'AVAILABLE' | 'PARTIAL' | 'PLANNED';
    readonly phase: number;
    readonly plannedIn: string | null;
    readonly endpoint: string | null;
    readonly viewPath: string | null;
  }[];
}

export interface IncomeExpensesRowDto {
  readonly period: ReportPeriodDto;
  readonly income: ReportAmountDto;
  readonly expenses: ReportAmountDto;
  readonly savings: ReportAmountDto;
  readonly savingsRate: string | null;
  readonly comparison: {
    readonly income: ReportVariationDto;
    readonly expenses: ReportVariationDto;
    readonly savings: ReportVariationDto;
  } | null;
  readonly baseline: {
    readonly income: ReportBaselineDto;
    readonly expenses: ReportBaselineDto;
    readonly savings: ReportBaselineDto;
  } | null;
}

export interface IncomeExpensesReportDto {
  readonly meta: ReportMetaDto;
  readonly granularity: 'PERIOD' | 'WEEK';
  readonly rows: readonly IncomeExpensesRowDto[];
  readonly totals: Omit<IncomeExpensesRowDto, 'period' | 'baseline'>;
}

export interface CategoryLeafReportDto {
  readonly categoryId: string;
  readonly name: string;
  readonly archived: boolean;
  readonly amount: ReportAmountDto;
  readonly negativeNet: boolean;
  readonly comparison: ReportVariationDto | null;
}

export interface CategoryNodeReportDto extends CategoryLeafReportDto {
  readonly subcategories: readonly CategoryLeafReportDto[];
}

export interface ExpensesByCategoryReportDto {
  readonly meta: ReportMetaDto;
  readonly groups: readonly {
    readonly groupId: string;
    readonly name: string;
    readonly amount: ReportAmountDto;
    readonly negativeNet: boolean;
    readonly comparison: ReportVariationDto | null;
    readonly categories: readonly CategoryNodeReportDto[];
  }[];
  readonly others: ReportAmountDto | null;
  readonly total: ReportAmountDto;
}

export interface BudgetVsActualReportDto {
  readonly meta: ReportMetaDto;
  readonly periods: readonly {
    readonly period: ReportPeriodDto;
    readonly status: 'BUDGETED' | 'NO_BUDGET';
    readonly budgetId: string | null;
    readonly periodId: string;
    readonly currency: string | null;
    readonly lines: readonly {
      readonly budgetLineId: string;
      readonly target: { readonly kind: string; readonly id: string; readonly name: string };
      readonly nature: string;
      readonly kind: string;
      readonly reference: MoneyDto;
      readonly actual: MoneyDto;
      readonly actualComplete: boolean;
      readonly status: string;
    }[];
    readonly totals: {
      readonly planned: MoneyDto;
      readonly actual: MoneyDto;
      readonly remaining: MoneyDto;
      readonly availableToSpend: MoneyDto;
      readonly complete: boolean;
      readonly unconverted: readonly MoneyDto[];
    } | null;
    readonly ratesUsed: readonly ResolvedRateDto[];
  }[];
}

export interface CashFlowReportDto {
  readonly meta: ReportMetaDto;
  readonly periods: readonly {
    readonly period: ReportPeriodDto;
    readonly byCurrency: readonly {
      readonly currency: string;
      readonly opening: MoneyDto;
      readonly operating: MoneyDto;
      readonly debt: MoneyDto;
      readonly savingsInvestments: MoneyDto;
      readonly currencyExchange: MoneyDto;
      readonly adjustments: MoneyDto;
      readonly closing: MoneyDto;
    }[];
    readonly consolidated: {
      readonly opening: MoneyDto;
      readonly operating: MoneyDto;
      readonly debt: MoneyDto;
      readonly savingsInvestments: MoneyDto;
      readonly currencyExchange: MoneyDto;
      readonly adjustments: MoneyDto;
      readonly revaluation: MoneyDto;
      readonly closing: MoneyDto;
      readonly complete: boolean;
      readonly unconverted: readonly MoneyDto[];
    };
    readonly comparison: Readonly<Record<string, ReportVariationDto>> | null;
  }[];
}

export interface AccountBalanceHistoryReportDto {
  readonly meta: ReportMetaDto;
  readonly accountId: string;
  readonly currency: string;
  readonly opening: MoneyDto;
  readonly days: readonly {
    readonly date: string;
    readonly balance: MoneyDto;
    readonly valued: MoneyDto | null;
    readonly hasMovements: boolean;
    readonly reconciled: boolean;
  }[];
  readonly closing: MoneyDto;
}

export interface NetWorthReportDto {
  readonly meta: ReportMetaDto;
  readonly granularity: 'PERIOD' | 'DAY';
  readonly points: readonly { readonly date: string; readonly netWorth: ReportAmountDto }[];
  readonly decomposition: readonly {
    readonly period: ReportPeriodDto;
    readonly opening: MoneyDto;
    readonly closing: MoneyDto;
    readonly savings: MoneyDto;
    readonly conversionResult: MoneyDto;
    readonly adjustments: MoneyDto;
    readonly otherMovements: MoneyDto;
    readonly fxRevaluation: MoneyDto;
    readonly assetRevaluation: MoneyDto;
    readonly revaluationByCurrency: readonly {
      readonly currency: string;
      readonly kind: 'FX' | 'ASSET';
      readonly amount: MoneyDto;
    }[];
    readonly complete: boolean;
    readonly unvalued: readonly MoneyDto[];
  }[];
}

export type ReportDrillDownKindDto =
  'PORTION' | 'LIQUIDITY_MOVEMENT' | 'ACCOUNT_MOVEMENT' | 'NET_WORTH_ACCOUNT';

export interface ReportDrillDownRowDto {
  readonly transactionId: string | null;
  readonly splitId: string | null;
  readonly journalEntryId: string | null;
  readonly date: string;
  readonly accountId: string | null;
  readonly accountIds: readonly string[] | null;
  readonly categoryId: string | null;
  readonly counterpartyId: string | null;
  readonly description: string | null;
  readonly nature: string | null;
  readonly component: string | null;
  readonly amount: MoneyDto;
  readonly valued: MoneyDto | null;
  readonly rate: ResolvedRateDto | null;
}

export interface ReportDrillDownPageDto {
  readonly meta: ReportMetaDto;
  readonly kind: ReportDrillDownKindDto;
  readonly totals: ReportAmountDto;
  readonly count: number;
  readonly rows: readonly ReportDrillDownRowDto[];
  readonly nextCursor: string | null;
}

// ───────────────────────────────────────────── reportes ampliados (add-financial-reports-extended)

export interface ExpensesByTagReportDto {
  readonly meta: ReportMetaDto;
  /** Una porción con varias etiquetas suma en cada una: la suma de las etiquetas NO es el gasto total. */
  readonly nonAdditive: true;
  readonly tagMatch: 'ANY' | 'ALL';
  readonly tags: readonly {
    readonly tagId: string;
    readonly name: string;
    readonly archived: boolean;
    readonly amount: ReportAmountDto;
    readonly comparison: ReportVariationDto | null;
  }[];
}

export interface ExpensesByAccountReportDto {
  readonly meta: ReportMetaDto;
  readonly accounts: readonly {
    readonly accountId: string;
    readonly name: string;
    readonly type: string;
    readonly institutionId: string | null;
    readonly amount: ReportAmountDto;
    readonly comparison: ReportVariationDto | null;
    readonly byCategory: readonly {
      readonly categoryId: string;
      readonly name: string;
      readonly amount: ReportAmountDto;
    }[];
  }[];
  readonly total: ReportAmountDto;
  readonly totalComparison: ReportVariationDto | null;
}

export interface TrendsReportDto {
  readonly meta: ReportMetaDto;
  readonly normalized: boolean;
  readonly series: readonly {
    /** `null` = la serie "Otras categorías". */
    readonly categoryId: string | null;
    readonly name: string;
    readonly total: ReportAmountDto;
    readonly cells: readonly { readonly period: ReportPeriodDto; readonly amount: ReportAmountDto }[];
  }[];
}

export type FeeTypeDto = 'CONVERSION' | 'TRANSFER' | 'LOAN' | 'FEE_CATEGORY';

export interface FeesReportDto {
  readonly meta: ReportMetaDto;
  readonly months: readonly {
    readonly period: ReportPeriodDto;
    readonly byType: readonly { readonly type: FeeTypeDto; readonly amount: ReportAmountDto }[];
    readonly total: ReportAmountDto;
  }[];
  /** Total de los 12 periodos completos anteriores al que contiene hoy. */
  readonly last12Months: ReportAmountDto;
}

export interface GoalsReportDto {
  readonly meta: ReportMetaDto;
  readonly goals: readonly {
    readonly goalId: string;
    readonly name: string;
    readonly currency: string;
    readonly target: MoneyDto;
    readonly startDate: string;
    readonly targetDate: string | null;
    readonly months: readonly {
      readonly period: string;
      readonly monthEnd: string;
      readonly contributions: MoneyDto;
      readonly withdrawals: MoneyDto;
      readonly accumulated: MoneyDto;
      readonly percent: string | null;
      readonly expected: MoneyDto | null;
      readonly status: 'BEHIND' | 'ON_TRACK' | 'AHEAD' | null;
      readonly complete: boolean;
    }[];
  }[];
}

export interface DebtsReportDto {
  readonly meta: ReportMetaDto;
  readonly debts: readonly {
    readonly debtId: string;
    readonly kind: 'LOAN' | 'CARD';
    readonly name: string;
    readonly currency: string;
    readonly accountId: string;
    readonly months: readonly {
      readonly period: ReportPeriodDto;
      readonly outstanding: MoneyDto;
      readonly principalPaid: MoneyDto | null;
      readonly interestPaid: MoneyDto | null;
      readonly chargesPaid: MoneyDto | null;
    }[];
  }[];
  readonly consolidated: readonly {
    readonly period: ReportPeriodDto;
    readonly outstanding: ReportAmountDto;
    readonly principalPaid: ReportAmountDto;
    readonly interestPaid: ReportAmountDto;
  }[];
}

export interface RecurringCostsReportDto {
  readonly meta: ReportMetaDto;
  readonly items: readonly {
    readonly definitionId: string;
    readonly name: string;
    readonly categoryId: string | null;
    readonly cadence: string;
    readonly interval: number;
    readonly variable: boolean;
    readonly monthly: MoneyDto | null;
    readonly annual: MoneyDto | null;
    readonly monthlyReporting: MoneyDto | null;
  }[];
  readonly totals: { readonly monthly: ReportAmountDto; readonly annual: ReportAmountDto };
  readonly variableCount: number;
}

export interface SubscriptionsReportDto {
  readonly meta: ReportMetaDto;
  readonly months: readonly {
    readonly period: ReportPeriodDto;
    readonly monthlyCost: ReportAmountDto;
    readonly active: number;
    readonly events: readonly {
      readonly date: string;
      readonly subscriptionId: string;
      readonly name: string;
      readonly kind: 'STARTED' | 'CANCELLED' | 'PRICE_CHANGED';
      readonly previousPrice: MoneyDto | null;
      readonly newPrice: MoneyDto | null;
    }[];
  }[];
}

export interface ConversionsReportDto {
  readonly meta: ReportMetaDto;
  readonly points: readonly {
    readonly transactionId: string;
    readonly date: string;
    readonly pair: string;
    readonly effectiveRate: string;
    readonly referenceRate: string | null;
  }[];
  readonly months: readonly {
    readonly period: ReportPeriodDto;
    readonly cost: MoneyDto;
    readonly conversions: number;
    readonly excluded: number;
    readonly costComplete: boolean;
  }[];
  readonly costTotal: MoneyDto;
  readonly costComplete: boolean;
}

export type SavedViewRangeDto =
  | { readonly kind: 'FIXED'; readonly from: string; readonly to: string }
  | { readonly kind: 'LAST_N_PERIODS'; readonly periods: number }
  | { readonly kind: 'CURRENT_PERIOD' }
  | { readonly kind: 'PREVIOUS_PERIOD' };

export interface SavedReportViewDto {
  readonly id: string;
  readonly reportId: string;
  readonly name: string;
  /** Rango y filtros guardados; nunca montos ni resultados. */
  readonly params: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SavedViewWarningDto {
  readonly code: 'ARCHIVED_FILTER' | 'MISSING_FILTER';
  readonly kind: 'CATEGORY' | 'ACCOUNT' | 'TAG' | 'COUNTERPARTY';
  readonly id: string;
  readonly name: string | null;
}

export interface OpenedSavedReportViewDto extends SavedReportViewDto {
  /** Parámetros de consulta listos para pedir el reporte, con el rango relativo calculado desde hoy. */
  readonly query: Readonly<Record<string, string | readonly string[]>>;
  readonly warnings: readonly SavedViewWarningDto[];
}
