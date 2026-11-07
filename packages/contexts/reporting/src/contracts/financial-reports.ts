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
