import type { AccountCatalogQuery } from '@pf/accounts/contracts';
import type { CategoryCatalogQuery, CounterpartyCatalogQuery } from '@pf/classification/contracts';
import type { FxQuoteSideRatesPort, FxValuationPort, ResolvedRateDto } from '@pf/fx/contracts';
import type { AccountBalanceHistoryQuery, AccountBalancesQuery } from '@pf/ledger/contracts';
import type { Clock } from '@pf/shared-kernel';
import type { ConversionDetailQuery, NominalFlowQuery } from '@pf/transactions/contracts';

/**
 * Unidad de trabajo de LECTURA: una transacción PG con `SET LOCAL app.workspace_id` (RLS, INV-025) en la que corren
 * todas las consultas a los contratos públicos (lectura consistente; cada contexto reutiliza la transacción en curso).
 */
export interface ReportingUnitOfWork {
  run<T>(
    ctx: { readonly userId: string | null; readonly workspaceId: string },
    fn: () => Promise<T>,
  ): Promise<T>;
  /**
   * Ejecuta `fn` en la transacción del LLAMADOR si ya hay una (sin tocar su contexto RLS ni su usuario: cifras de cierre
   * invocadas desde la transacción de Planning); si no la hay, abre una de solo lectura con el RLS del workspace.
   */
  join<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}

/** Moneda de reporte y zona horaria del workspace (IDENTITY, vía composition root). */
export interface WorkspaceSettingsPort {
  settingsOf(workspaceId: string): Promise<{ readonly baseCurrency: string; readonly timeZone: string }>;
}

/** Versión derivada de los datos del workspace (`reporting.workspace_data_version`, DRV). */
export interface DataVersionStore {
  /** Versión actual (0 si el consumidor aún no vio eventos del workspace). */
  versionOf(workspaceId: string): Promise<string>;
  /** Incrementa la versión (solo el consumidor del worker, dentro de su transacción con inbox). */
  bump(workspaceId: string, at: string): Promise<void>;
  /**
   * Incrementa la versión en `count` (≥ 1) de una vez: equivale a `count` llamadas a `bump` con instantes cuyo máximo es
   * `at` (entrega agrupada, optimize-consumer-throughput).
   */
  bumpBy(workspaceId: string, count: number, at: string): Promise<void>;
}

/**
 * Puertos de `GetReportSummary` (design.md § Contextos): adapters directos a los contratos públicos de LEDGER
 * (`GetBalances` por lote), TRANSACTIONS (`SummarizeNominalFlows`), ACCOUNTS (catálogo), CLASSIFICATION (nombres) y
 * FX (`RateResolver` de valoración). Ningún join cross-schema desde REPORTING.
 */
export interface ReportingDeps {
  readonly uow: ReportingUnitOfWork;
  readonly workspaces: WorkspaceSettingsPort;
  readonly accounts: AccountCatalogQuery;
  readonly balances: AccountBalancesQuery;
  readonly flows: NominalFlowQuery;
  readonly categories: Pick<CategoryCatalogQuery, 'categoriesByIds'>;
  readonly rates: FxValuationPort;
  readonly versions: DataVersionStore;
  readonly clock: Clock;
  /**
   * Ventana de vigencia (días) de las tasas de valoración: ajuste PROPIO de Reporting (docs/31 D53,
   * `REPORTING_RATE_VALIDITY_WINDOW`); se entrega a FX en cada resolución y se informa en `meta.rateWindowDays`.
   * Por defecto `DEFAULT_RATE_VALIDITY_WINDOW_DAYS` (7).
   */
  readonly rateValidityWindowDays?: number;
  /**
   * Q4/Q8 del Home (add-upcoming-payments): ¿hay definiciones recurrentes activas o transacciones pendientes de egreso?
   * Solo estas lecturas mínimas; la lista completa usa `UpcomingPaymentsDeps`.
   */
  readonly commitments: Pick<UpcomingCommitmentsPort, 'hasActiveDefinitions'>;
  readonly pending: PendingTransactionsPort;
  /**
   * Q9 del Home (add-savings-goals): metas en curso (GOALS, `GoalSummaryQuery.listForHome`). Opcional: sin él, Q9 es
   * `NO_DATA` con la acción `CREATE_GOAL`.
   */
  readonly goalSummary?: GoalSummaryPort;
  /**
   * Aportes netos a metas del periodo (GOALS, `GoalFlowsQuery.netForRange`). Opcional: sin él, `goalContributions`
   * del resumen va vacío.
   */
  readonly goalFlows?: GoalFlowsPort;
  /**
   * Q5 del Home (add-spendable-amount): disponible para gastar libre de compromisos. Opcional: sin él el resumen no
   * trae el bloque `spendable` (cifras de cierre y pruebas que no lo necesitan).
   */
  readonly spendable?: SpendableDeps;
}

// ───────────────────────────────────────────── reporting/dashboard: metas (add-savings-goals)

interface GoalMoneyRow {
  readonly amount: string;
  readonly currency: string;
}

/** Meta del Home (GOALS, `GoalHomeItemDto`; estructuralmente compatible: REPORTING no importa `@pf/goals`). */
export interface GoalHomeItemRow {
  readonly goalId: string;
  readonly name: string;
  readonly priority: number;
  readonly percent: string;
  readonly progress: GoalMoneyRow;
  readonly target: GoalMoneyRow;
  readonly tracking: {
    readonly status: 'BEHIND' | 'ON_TRACK' | 'AHEAD' | null;
    readonly lifecycleStatus: 'ACTIVE' | 'PAUSED' | 'ACHIEVED' | 'CLOSED' | 'CANCELLED';
    readonly expected: GoalMoneyRow | null;
    readonly deviationPercent: string | null;
  };
  readonly lifecycleStatus: 'ACTIVE' | 'PAUSED' | 'ACHIEVED' | 'CLOSED' | 'CANCELLED';
  readonly requiredMonthly: GoalMoneyRow | null;
  readonly overdue: boolean;
  readonly expectedDate: string | null;
  readonly overAllocated: boolean;
  readonly complete: boolean;
}

export interface GoalHomeSummaryRow {
  /** Hasta `limit` metas por prioridad, fecha objetivo (sin fecha al final) y nombre: el orden lo da GOALS. */
  readonly items: readonly GoalHomeItemRow[];
  readonly moreCount: number;
  /** Metas `ACTIVE`, `PAUSED` o `ACHIEVED` no archivadas. */
  readonly goalCount: number;
  readonly ratesUsed: readonly ResolvedRateDto[];
}

/** Lo que REPORTING necesita de GOALS para Q9 (adapter sobre `GoalSummaryQuery.listForHome`). */
export interface GoalSummaryPort {
  listForHome(input: { readonly workspaceId: string; readonly limit: number }): Promise<GoalHomeSummaryRow>;
}

/** Flujo neto de metas por día de negocio y moneda (GOALS, `GoalFlowDto`; sin reasignaciones). */
export interface GoalFlowRow {
  readonly date: string;
  readonly amount: GoalMoneyRow;
}

/** Lo que REPORTING necesita de GOALS para Q6 (adapter sobre `GoalFlowsQuery.netForRange`). */
export interface GoalFlowsPort {
  netForRange(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<readonly GoalFlowRow[]>;
}

/**
 * Periodos financieros del workspace (PLANNING, `PeriodQuery.listPeriods`; add-financial-periods). REPORTING no importa
 * `@pf/planning` (PLANNING ya depende de REPORTING): el contrato se declara aquí y la composición entrega el adapter.
 */
export interface FinancialPeriodsPort {
  listPeriods(input: { readonly workspaceId: string }): Promise<
    readonly {
      readonly id: string;
      readonly label: string;
      readonly periodStart: string;
      readonly periodEnd: string;
      readonly status: string;
      /** Día de inicio con que se calculó el periodo (`FinancialPeriodDto.startDay`). */
      readonly startDay?: number;
    }[]
  >;
}

/** Snapshot de cierre vigente por periodo (PLANNING, `ClosingSnapshotQuery.listCurrent`; add-month-closing). */
export interface ClosingSnapshotsPort {
  listCurrent(input: { readonly workspaceId: string; readonly periodIds: readonly string[] }): Promise<
    readonly {
      readonly periodId: string;
      readonly baseCurrency: string;
      readonly netWorth: {
        readonly amount: { readonly amount: string; readonly currency: string };
        readonly complete: boolean;
        readonly unconverted: readonly { readonly amount: string; readonly currency: string }[];
      };
      readonly assets: { readonly amount: string; readonly currency: string };
      readonly liabilities: { readonly amount: string; readonly currency: string };
    }[]
  >;
}

/** Puertos de `GetNetWorthHistory` (add-net-worth-evolution): los de `ReportingDeps` más periodos, snapshots y saldos por fecha. */
export interface NetWorthHistoryDeps extends ReportingDeps {
  readonly periods: FinancialPeriodsPort;
  readonly snapshots: ClosingSnapshotsPort;
  readonly balanceHistory: AccountBalanceHistoryQuery;
}

/**
 * Puertos de `GetConversionCostAnalysis` (add-conversion-cost-analysis, D245): REPORTING compone el análisis desde los
 * contratos públicos de TRANSACTIONS (`ConversionDetailQuery`), ACCOUNTS (nombres de cuentas), CLASSIFICATION (nombres
 * de contrapartes), FX (valoración y, para el Could, compra/venta paralela) y PLANNING (periodos financieros).
 */
export interface ConversionCostDeps {
  readonly uow: ReportingUnitOfWork;
  readonly workspaces: WorkspaceSettingsPort;
  readonly accounts: AccountCatalogQuery;
  readonly counterparties: CounterpartyCatalogQuery;
  readonly conversions: ConversionDetailQuery;
  readonly rates: FxValuationPort;
  /** Compra/venta paralela para el spread alternativo (Could); sin él, el alternativo excluye todo. */
  readonly quoteSide?: FxQuoteSideRatesPort;
  readonly periods: FinancialPeriodsPort;
  /**
   * Día de inicio del mes financiero del workspace (IDENTITY): para asignar una fecha que aún no tiene periodo en la
   * tabla con la regla del día de inicio. Sin él, el de los periodos existentes más cercanos (o 1).
   */
  readonly calendar?: {
    calendarOf(
      workspaceId: string,
    ): Promise<{ readonly timeZone: string; readonly fiscalMonthStartDay: number }>;
  };
  readonly clock: Clock;
  readonly rateValidityWindowDays?: number;
}

// ───────────────────────────────────────────── reporting/cash-flow-calendar (add-upcoming-payments)

interface MoneyRow {
  readonly amount: string;
  readonly currency: string;
}

/** Ocurrencia de egreso no resuelta (COMMITMENTS, `UpcomingPaymentsQuery.listUpcoming`). */
export interface UpcomingOccurrenceRow {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly kind: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'LOAN_PAYMENT' | 'CARD_PAYMENT';
  readonly dueDate: string;
  readonly status: 'SCHEDULED' | 'DUE' | 'OVERDUE';
  readonly requiresApproval: boolean;
  readonly expected: {
    readonly type: 'FIXED' | 'ESTIMATED' | 'MIN_MAX' | 'VARIABLE';
    readonly amount: string | null;
    readonly min: string | null;
    readonly max: string | null;
    readonly currency: string;
  };
  /** Monto proyectado (máximo en `MIN_MAX`); `null` si es `VARIABLE`. */
  readonly projected: MoneyRow | null;
  readonly accountId: string;
  readonly toAccountId: string | null;
}

/** Comprometido de un rango en montos NATIVOS (COMMITMENTS, `CommittedQuery.getForRange`). */
export interface CommittedRangeRow {
  readonly fromCommitments: readonly MoneyRow[];
  readonly fromPending: readonly MoneyRow[];
  readonly withoutAmountCount: number;
  readonly overdueBefore: { readonly count: number; readonly amounts: readonly MoneyRow[] };
}

/** Egreso resuelto por una transacción no anulada (COMMITMENTS, `ResolvedOccurrencesQuery`). */
export interface ResolvedOutflowRow {
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly definitionName: string;
  readonly generatedAt: string;
  readonly transactionId: string;
  readonly transactionDate: string;
  readonly amount: MoneyRow;
}

/**
 * Lo que REPORTING necesita de COMMITMENTS. Se declara aquí (no se importa `@pf/commitments`, decisión 2): la composición
 * de `apps/api` entrega un adapter sobre `UpcomingPaymentsQuery`, `CommittedQuery`, `ResolvedOccurrencesQuery` y
 * `DefinitionStatsQuery` de `@pf/commitments/contracts`.
 */
export interface UpcomingCommitmentsPort {
  /** Ocurrencias de egreso sin resolver con vencimiento ≤ `through` (de cualquier antigüedad). */
  listUpcoming(input: {
    readonly workspaceId: string;
    readonly through: string;
  }): Promise<readonly UpcomingOccurrenceRow[]>;
  getForRange(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<CommittedRangeRow>;
  listResolvedOutflows(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<readonly ResolvedOutflowRow[]>;
  hasActiveDefinitions(input: { readonly workspaceId: string }): Promise<boolean>;
}

/** Transacción `PENDING` (TRANSACTIONS, `PendingFlowQuery.listPending`). */
export interface PendingTransactionRow {
  readonly transactionId: string;
  readonly kind: string;
  readonly businessDate: string;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly direction: 'IN' | 'OUT';
  readonly amount: MoneyRow;
  readonly description: string | null;
  readonly externalRef: { readonly namespace: string; readonly id: string } | null;
}

export interface PendingTransactionsPort {
  listPending(input: {
    readonly workspaceId: string;
    readonly accountIds?: readonly string[];
    readonly dateFrom?: string;
    readonly dateTo?: string;
  }): Promise<readonly PendingTransactionRow[]>;
}

/** Métricas de la consulta (D117): histogramas sin etiquetas de alta cardinalidad. */
export interface ReportingMetricsPort {
  observe(name: string, value: number): void;
}

/** Puertos de `GetUpcomingPayments` y `GetSurprisePayments`: los de `ReportingDeps` más periodos y métricas. */
export interface UpcomingPaymentsDeps extends ReportingDeps {
  readonly periods: FinancialPeriodsPort;
  readonly commitments: UpcomingCommitmentsPort;
  readonly metrics?: ReportingMetricsPort;
}

// ───────────────────────────────────────────── reporting/dashboard: disponible para gastar (add-spendable-amount)

/** Ítem de egreso para Q5 (COMMITMENTS, `CommittedQuery.listForSpendable`; estructuralmente compatible). */
export interface SpendableCommittedRow {
  readonly source: 'OCCURRENCE' | 'PENDING';
  readonly id: string;
  readonly definitionId: string | null;
  readonly name: string | null;
  readonly kind: string;
  readonly date: string;
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly sourceLiquid: boolean;
  readonly targetLiquid: boolean | null;
  readonly managedBy: 'USER' | 'SUBSCRIPTION' | 'DEBT' | 'GOAL' | null;
  readonly amount: MoneyRow | null;
  readonly overdueFromPrevious: boolean;
}

/** Reservado por metas en una cuenta (GOALS, `GoalReservationsQuery.getReservedByAccount`). */
export interface AccountReservationRow {
  readonly accountId: string;
  readonly currency: string;
  readonly reserved: string;
}

/** Aporte planificado de una meta en el periodo (GOALS, `GoalPlansQuery.getForPeriod`). */
export interface GoalPlanRow {
  readonly goalId: string;
  readonly goalName: string;
  readonly currency: string;
  readonly pending: string;
}

/** Disponible del plan del periodo (PLANNING, `BudgetVsActualQuery.getForPeriod`); `null` si no hay plan. */
export interface BudgetAvailabilityRow {
  readonly budgetId: string;
  readonly totals: {
    readonly availableToSpend: MoneyRow;
    readonly complete: boolean;
  };
}

/**
 * Lo que REPORTING necesita de los otros contextos para Q5. Se declara aquí (no se importan `@pf/goals`, `@pf/planning`
 * ni `@pf/commitments`: PLANNING ya depende de REPORTING y GOALS/COMMITMENTS se componen después); la composición de
 * `apps/api` entrega adapters con resolución tardía sobre sus contratos públicos.
 */
export interface SpendableDeps {
  readonly commitments: {
    listForSpendable(input: {
      readonly workspaceId: string;
      readonly periodFrom: string;
      readonly periodTo: string;
    }): Promise<{ readonly items: readonly SpendableCommittedRow[]; readonly withoutAmountCount: number }>;
  };
  readonly reservations: {
    getReservedByAccount(input: {
      readonly workspaceId: string;
      readonly accountIds?: readonly string[];
    }): Promise<readonly AccountReservationRow[]>;
  };
  readonly goalPlans: {
    getForPeriod(input: {
      readonly workspaceId: string;
      readonly from: string;
      readonly to: string;
    }): Promise<readonly GoalPlanRow[]>;
  };
  /** Reserva mínima de liquidez (IDENTITY, `WorkspaceSettingsQuery.getMinimumLiquidityReserve`). */
  readonly minimumReserve: {
    getMinimumLiquidityReserve(input: { readonly workspaceId: string }): Promise<MoneyRow | null>;
  };
  readonly budgets: {
    getForPeriod(input: {
      readonly workspaceId: string;
      readonly periodId: string;
    }): Promise<BudgetAvailabilityRow | null>;
  };
  readonly periods: FinancialPeriodsPort;
  readonly metrics?: ReportingMetricsPort;
}
