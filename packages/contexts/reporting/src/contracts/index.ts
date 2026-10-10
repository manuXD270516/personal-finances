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
  // add-lifecycle-timeline (docs/31 D37): la edición financiera de una transferencia (sin re-emitir TransferCompleted).
  { type: 'transactions.TransferRevised', version: 1 },
  // docs/31 D48: la corrección financiera de una conversión (sin re-emitir ConversionRecorded).
  { type: 'transactions.ConversionRevised', version: 1 },
  { type: 'accounts.AccountOpened', version: 1 },
  { type: 'accounts.AccountArchived', version: 1 },
  { type: 'fx.RateRecorded', version: 1 },
  // add-net-worth-evolution: un cierre o una reapertura cambia la fuente (snapshot o cálculo) de un punto de la serie.
  { type: 'planning.MonthClosed', version: 1 },
  { type: 'planning.PeriodReopened', version: 1 },
  // add-demo-data: el workspace demo terminó de cargarse (invalida la caché del resumen del Home).
  { type: 'identity.DemoDataLoaded', version: 1 },
  // add-upcoming-payments: los próximos pagos se leen de la fuente de verdad (sin proyección); estos eventos solo
  // versionan los datos del workspace para el ETag y la frescura (docs/35 D117).
  { type: 'commitments.OccurrencesGenerated', version: 1 },
  { type: 'commitments.RecurringOccurrenceMaterialized', version: 1 },
  { type: 'commitments.RecurringOccurrenceChanged', version: 1 },
  { type: 'commitments.RecurringDefinitionChanged', version: 1 },
  // Una transacción pendiente nueva cambia la lista de próximos pagos y el saldo proyectado.
  { type: 'transactions.TransactionCreated', version: 1 },
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

/** Línea de un top de categorías (gasto o ingreso) del resumen. */
export interface TopCategoryDto {
  readonly categoryId: string;
  readonly name: string;
  /** Neto del periodo en la moneda de reporte (puede ser negativo). */
  readonly amount: MoneyDto;
  readonly complete: boolean;
  /**
   * Neto de la misma categoría en el periodo de comparación (cero si no tuvo flujos); `null` sin comparación o si
   * algún monto anterior quedó sin tasa.
   */
  readonly previousAmount: MoneyDto | null;
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
  readonly topExpenseCategories: readonly TopCategoryDto[];
  /** Principales categorías de ingreso del periodo (FR-REPORTING-004). */
  readonly topIncomeCategories: readonly TopCategoryDto[];
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

/** Símbolos de inyección de las queries de cifras de cierre (add-month-closing; las consume PLANNING). */
export const PERIOD_FLOWS_QUERY = Symbol.for('pf.reporting.PeriodFlowsQuery');
export const NET_WORTH_QUERY = Symbol.for('pf.reporting.NetWorthQuery');

/** Totales de flujos (ingresos, gastos, ahorro) de un periodo en una moneda. */
export interface PeriodFlowsCurrencyDto {
  readonly currency: string;
  readonly income: MoneyDto;
  readonly expense: MoneyDto;
  readonly net: MoneyDto;
  /** Tasa de ahorro (un decimal, HALF_EVEN) o `null` sin ingresos. */
  readonly savingsRate: string | null;
}

/** Flujos del periodo: las MISMAS cifras que `GET /reports/summary` (D15, D53). */
export interface PeriodFlowsDto {
  readonly period: { readonly from: string; readonly to: string };
  readonly reportingCurrency: string;
  readonly byCurrency: readonly PeriodFlowsCurrencyDto[];
  readonly consolidated: PeriodFlowsCurrencyDto & {
    readonly complete: boolean;
    /** Montos de ingresos/gastos sin tasa utilizable (ingresos primero), nunca convertidos 1:1. */
    readonly unconverted: readonly MoneyDto[];
  };
  /** Tasas por flujo (cierre de su día) efectivamente usadas. */
  readonly ratesUsed: readonly ResolvedRateDto[];
}

export interface PeriodFlowsQuery {
  getFlows(input: {
    readonly workspaceId: string;
    readonly dateFrom: string;
    readonly dateTo: string;
    readonly reportingCurrency?: string;
  }): Promise<PeriodFlowsDto>;
}

/** Patrimonio neto a una fecha de corte, valorado con las tasas vigentes al cierre de ese día. */
export interface NetWorthAtDto {
  readonly asOf: string;
  readonly reportingCurrency: string;
  readonly netWorth: NetWorthBreakdownDto;
  readonly accounts: readonly AccountBalanceLineDto[];
  readonly ratesUsed: readonly ResolvedRateDto[];
}

export interface NetWorthQuery {
  getNetWorth(input: {
    readonly workspaceId: string;
    readonly asOf: string;
    readonly reportingCurrency?: string;
  }): Promise<NetWorthAtDto>;
}

/** Punto de la evolución del patrimonio (`NetWorthPoint` del contrato; add-net-worth-evolution). */
export interface NetWorthPointDto {
  /** Etiqueta del periodo financiero (`YYYY-MM` del inicio, docs/33 D59). */
  readonly period: string;
  readonly periodId: string;
  /** Fecha de corte: fin del periodo, u hoy si es el periodo en curso. */
  readonly asOf: string;
  readonly assets: string;
  readonly liabilities: string;
  readonly netWorth: string;
  /** Variación del neto respecto al punto anterior; `null` en el primer punto del rango. */
  readonly change: string | null;
  /** `false` si no hay variación comparable (primer punto o algún punto incompleto). */
  readonly comparable: boolean;
  readonly complete: boolean;
  /** Saldos nativos sin tasa vigente a la fecha (excluidos de los totales, nunca 1:1). */
  readonly unconverted: readonly MoneyDto[];
  readonly source: 'COMPUTED' | 'SNAPSHOT';
  readonly closed: boolean;
  readonly partial: boolean;
  /** Tasas efectivamente usadas para valorar este punto (vacío en puntos de snapshot). */
  readonly ratesUsed: readonly ResolvedRateDto[];
}

/** `NetWorthHistory` del contrato (`GET /workspaces/{workspaceId}/reports/net-worth/history`). */
export interface NetWorthHistoryDto {
  readonly reportingCurrency: string;
  readonly points: readonly NetWorthPointDto[];
  readonly meta: {
    readonly generatedAt: string;
    readonly timeZone: string;
    readonly rateWindowDays: number;
    readonly dataFreshness?: string;
    readonly ratesUsed: readonly ResolvedRateDto[];
    readonly attributions: readonly RateAttributionDto[];
  };
}

// ───────────────────────────────────────────── reporting/cash-flow-calendar (add-upcoming-payments)

/** Totales por moneda original y consolidado en la moneda de reporte (HALF_EVEN solo al presentar). */
export interface ValuedTotalDto {
  readonly byCurrency: readonly MoneyDto[];
  readonly consolidated: {
    readonly amount: MoneyDto;
    /** `false` si algún agregado quedó sin tasa vigente (nunca convertido 1:1). */
    readonly complete: boolean;
    readonly unconverted: readonly MoneyDto[];
  };
}

export type UpcomingItemKindDto = 'OCCURRENCE' | 'PENDING_TRANSACTION';
export type UpcomingItemStatusDto = 'SCHEDULED' | 'DUE' | 'OVERDUE' | 'PENDING_APPROVAL' | 'PENDING';
export type UpcomingAmountTypeDto = 'FIXED' | 'ESTIMATED' | 'MIN_MAX' | 'VARIABLE' | 'ACTUAL';

export interface UpcomingPaymentItemDto {
  readonly kind: UpcomingItemKindDto;
  readonly occurrenceId?: string;
  readonly definitionId?: string;
  readonly transactionId?: string;
  readonly name: string;
  readonly accountId: string;
  readonly accountName: string;
  /** Vencimiento (ocurrencia, ya ajustado por fin de semana) o fecha de negocio (pendiente). */
  readonly date: string;
  readonly status: UpcomingItemStatusDto;
  readonly daysOverdue?: number;
  readonly amountType: UpcomingAmountTypeDto;
  /** `null` en `VARIABLE` y en `MIN_MAX` (ver `range`). */
  readonly amount: MoneyDto | null;
  readonly range?: { readonly min: MoneyDto; readonly max: MoneyDto };
  readonly estimated: boolean;
  readonly withoutAmount: boolean;
  /** Monto que suma, en la moneda de reporte (solo para mostrar); `null` sin monto o sin tasa vigente. */
  readonly converted: MoneyDto | null;
}

export interface CommittedBlockDto {
  readonly periodId: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly total: ValuedTotalDto;
  readonly fromCommitments: ValuedTotalDto;
  readonly fromPending: ValuedTotalDto;
  readonly withoutAmountCount: number;
  /** Ocurrencias de egreso vencidas de periodos anteriores: aparte, no suman al total (D146). */
  readonly overdueFromPreviousPeriods: ValuedTotalDto & { readonly count: number };
}

export interface ProjectedBalanceDto {
  readonly accountId: string;
  readonly accountName: string;
  readonly currency: string;
  readonly booked: MoneyDto;
  readonly pendingIn: MoneyDto;
  readonly pendingOut: MoneyDto;
  readonly projected: MoneyDto;
}

/** `UpcomingPayments` del contrato (`GET /workspaces/{workspaceId}/reports/upcoming-payments`). */
export interface UpcomingPaymentsDto {
  readonly window: { readonly from: string; readonly to: string; readonly days: number };
  readonly items: readonly UpcomingPaymentItemDto[];
  readonly totals: ValuedTotalDto & { readonly withoutAmountCount: number };
  /** `null` si ningún periodo financiero cubre hoy. */
  readonly committed: CommittedBlockDto | null;
  readonly projectedBalances: readonly ProjectedBalanceDto[];
  /** ≥ 1 definición recurrente activa o ≥ 1 pendiente de egreso (Q4/Q8 disponibles). */
  readonly hasCommitments: boolean;
  readonly meta: {
    readonly generatedAt: string;
    readonly reportingCurrency: string;
    readonly timeZone: string;
    readonly rateWindowDays: number;
    readonly dataFreshness?: string;
    readonly approx: boolean;
    /** Tasas efectivamente usadas (valoración con la tasa vigente al consultar, no la de cada vencimiento). */
    readonly rates: readonly ResolvedRateDto[];
    readonly attributions: readonly RateAttributionDto[];
  };
}

export interface SurprisePaymentItemDto {
  readonly transactionId: string;
  readonly date: string;
  readonly name: string;
  readonly amount: MoneyDto;
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly generatedOn: string;
}

/** `SurprisePayments` del contrato (`GET /workspaces/{workspaceId}/reports/surprise-payments`, SM-07). */
export interface SurprisePaymentsDto {
  readonly periodId: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly partial: boolean;
  readonly count: number;
  readonly items: readonly SurprisePaymentItemDto[];
  /** Los pagos no vinculados a ningún compromiso no se detectan. */
  readonly note: 'UNLINKED_PAYMENTS_NOT_DETECTED';
}
