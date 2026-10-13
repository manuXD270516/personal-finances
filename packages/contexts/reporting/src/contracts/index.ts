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

/** Meta del Home (Q9, add-savings-goals): mismos cálculos que `goals/savings-goals`. */
export interface GoalHomeItemDto {
  readonly goalId: string;
  readonly name: string;
  readonly priority: number;
  readonly percent: string;
  readonly progress: MoneyDto;
  readonly target: MoneyDto;
  readonly tracking: {
    readonly status: 'BEHIND' | 'ON_TRACK' | 'AHEAD' | null;
    readonly lifecycleStatus: 'ACTIVE' | 'PAUSED' | 'ACHIEVED' | 'CLOSED' | 'CANCELLED';
    readonly expected: MoneyDto | null;
    readonly deviationPercent: string | null;
  };
  readonly lifecycleStatus: 'ACTIVE' | 'PAUSED' | 'ACHIEVED' | 'CLOSED' | 'CANCELLED';
  readonly requiredMonthly: MoneyDto | null;
  readonly overdue: boolean;
  readonly expectedDate: string | null;
  readonly overAllocated: boolean;
  readonly complete: boolean;
}

/** Bloque `goals` de `ReportSummary` (Q9): `NO_DATA` con `CREATE_GOAL` si no hay metas activas, pausadas ni alcanzadas. */
export interface GoalsBlockDto {
  readonly status: 'AVAILABLE' | 'NO_DATA';
  readonly action: 'CREATE_GOAL' | null;
  /** Hasta 3, por prioridad, fecha objetivo (sin fecha al final) y nombre. */
  readonly items: readonly GoalHomeItemDto[];
  readonly moreCount: number;
  readonly complete: boolean;
  readonly ratesUsed: readonly ResolvedRateDto[];
}

/** Bloque `goalContributions` de `ReportSummary` (Q6): aportes netos a metas del periodo, sin reasignaciones. */
export interface GoalContributionsDto {
  readonly native: readonly MoneyDto[];
  /** Consolidado en la moneda de reporte con la tasa de la fecha de cada movimiento; `null` sin datos de metas. */
  readonly base: MoneyDto | null;
  readonly complete: boolean;
}

// ───────────────────────────────────────────── reporting/dashboard: disponible para gastar (add-spendable-amount, Q5)

/** Términos del disponible de una moneda (design.md decisión 2); sin redondeo intermedio, a la escala de la moneda. */
export interface SpendableCurrencyTermsDto {
  readonly currency: string;
  readonly liquid: MoneyDto;
  readonly reservedForGoals: MoneyDto;
  readonly committed: MoneyDto;
  readonly plannedGoalContributions: MoneyDto;
  /** `null` si el workspace no tiene reserva mínima en esta moneda (el término no se muestra). */
  readonly minimumReserve: MoneyDto | null;
  readonly spendable: MoneyDto;
}

/** Segunda vista "según tu presupuesto" (FR-PLANNING-024, sin cambios): sin plan del periodo ofrece crearlo. */
export interface SpendableBudgetViewDto {
  readonly status: 'AVAILABLE' | 'NO_PLAN';
  readonly action: 'CREATE_BUDGET' | null;
  readonly budgetId: string | null;
  readonly amount: MoneyDto | null;
  readonly complete: boolean | null;
}

/** Bloque `spendable` de `ReportSummary` y base de `Spendable` (sin el detalle de ítems). */
export interface SpendableSummaryDto {
  /** `id` es `null` si ningún periodo financiero cubre hoy (se usa el mes calendario; ver design.md, pendientes). */
  readonly period: { readonly id: string | null; readonly label: string; readonly start: string; readonly end: string };
  readonly reportingCurrency: string;
  readonly byCurrency: readonly SpendableCurrencyTermsDto[];
  readonly consolidated: {
    readonly total: MoneyDto;
    readonly complete: boolean;
    readonly unconverted: readonly MoneyDto[];
  };
  /** Monedas con disponible negativo mientras el consolidado no lo es ("conviene convertir"). */
  readonly shortfalls: readonly MoneyDto[];
  readonly status: 'OK' | 'WARNING';
  /** Ocurrencias y pendientes `VARIABLE` que no restan (D115). */
  readonly withoutAmountCount: number;
  /** Tarjetas con saldo adeudado y sin pago programado ni pendiente hacia ellas (D213). */
  readonly cardsWithoutPaymentCount: number;
  readonly budgetView: SpendableBudgetViewDto;
}

export interface SpendableCommittedItemDto {
  readonly source: 'OCCURRENCE' | 'PENDING';
  readonly id: string;
  readonly definitionId: string | null;
  readonly name: string | null;
  readonly kind: string;
  readonly date: string;
  readonly accountId: string;
  readonly amount: MoneyDto;
  readonly overdueFromPrevious: boolean;
}

export interface SpendableReservedAccountDto {
  readonly accountId: string;
  readonly name: string;
  readonly balance: MoneyDto;
  readonly reserved: MoneyDto;
  /** Lo que resta del disponible: `min(max(saldo, 0), reservado)` (D216). */
  readonly counted: MoneyDto;
}

export interface SpendablePlannedGoalDto {
  readonly goalId: string;
  readonly goalName: string;
  readonly pending: MoneyDto;
}

/** `Spendable` del contrato (`GET /workspaces/{workspaceId}/reports/spendable`). */
export interface SpendableDto extends SpendableSummaryDto {
  readonly committedItems: readonly SpendableCommittedItemDto[];
  readonly reservedByAccount: readonly SpendableReservedAccountDto[];
  readonly plannedByGoal: readonly SpendablePlannedGoalDto[];
  readonly meta: {
    readonly generatedAt: string;
    readonly rateWindowDays: number;
    readonly dataFreshness?: string;
    readonly ratesUsed: readonly ResolvedRateDto[];
    readonly attributions: readonly RateAttributionDto[];
  };
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
  /** Metas en curso (Q9, add-savings-goals). */
  readonly goals: GoalsBlockDto;
  /** Aportes netos a metas del periodo junto al ahorro (Q6); no alteran el ahorro ni la tasa de ahorro. */
  readonly goalContributions: GoalContributionsDto;
  /** Disponible para gastar (Q5, add-spendable-amount); `null` si el workspace no tiene cuentas líquidas. */
  readonly spendable: SpendableSummaryDto | null;
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

// ───────────────────────────────────────────── fx/conversion-pricing: costo de conversiones (add-conversion-cost-analysis)

export type ConversionCostGroupingDto = 'FINANCIAL_PERIOD' | 'CALENDAR_MONTH';
export type ConversionCostExclusionReasonDto = 'NO_REFERENCE' | 'NO_QUOTED_RATE' | 'NO_REPORTING_RATE';

/** Grupo del análisis: periodo, canal (contraparte + cuentas) y par, con cifras en la moneda de reporte. */
export interface ConversionCostGroupDto {
  readonly period: { readonly label: string; readonly from: string; readonly to: string };
  /** `NONE` = "Sin canal" (sin contraparte, D244). */
  readonly channel: {
    readonly kind: 'COUNTERPARTY' | 'NAMED' | 'NONE';
    readonly counterpartyId: string | null;
    readonly name: string | null;
  };
  readonly sourceAccountId: string;
  readonly sourceAccountName: string;
  readonly targetAccountId: string;
  readonly targetAccountName: string;
  readonly pair: { readonly base: string; readonly quote: string };
  readonly conversions: number;
  readonly converted: MoneyDto;
  /** Promedio ponderado por el monto convertido, 4 decimales; `null` si no hay conversiones contadas. */
  readonly spreadPct: string | null;
  readonly spreadAmount: MoneyDto;
  readonly fees: MoneyDto;
  readonly costTotal: MoneyDto;
  /** `false` si algún fee no pudo valorarse en la moneda de reporte (listado en `unvaluedFees`, nunca 1:1). */
  readonly costComplete: boolean;
  readonly unvaluedFees: readonly MoneyDto[];
  readonly excluded: readonly {
    readonly reason: ConversionCostExclusionReasonDto;
    readonly count: number;
    readonly amounts: readonly MoneyDto[];
  }[];
  readonly alternative: { readonly spreadPct: string | null; readonly excludedCount: number } | null;
}

/** `ConversionCostAnalysis` del contrato (`GET /workspaces/{workspaceId}/reports/conversion-costs`). */
export interface ConversionCostAnalysisDto {
  readonly reportingCurrency: string;
  readonly grouping: ConversionCostGroupingDto;
  readonly from: string;
  readonly to: string;
  readonly groups: readonly ConversionCostGroupDto[];
  readonly totals: {
    readonly conversions: number;
    readonly converted: MoneyDto;
    readonly spreadAmount: MoneyDto;
    readonly fees: MoneyDto;
    readonly costTotal: MoneyDto;
    readonly excludedCount: number;
    readonly costComplete: boolean;
  };
  readonly meta: {
    readonly generatedAt: string;
    readonly timeZone: string;
    readonly rateWindowDays: number;
    readonly ratesUsed: readonly ResolvedRateDto[];
    readonly attributions: readonly RateAttributionDto[];
  };
}
