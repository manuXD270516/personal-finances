import type { AccountCatalogQuery } from '@pf/accounts/contracts';
import type { CategoryCatalogQuery } from '@pf/classification/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import type { AccountBalanceHistoryQuery, AccountBalancesQuery } from '@pf/ledger/contracts';
import type { Clock } from '@pf/shared-kernel';
import type { NominalFlowQuery } from '@pf/transactions/contracts';

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
  readonly kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
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
