import type { AccountCatalogQuery } from '@pf/accounts/contracts';
import type { CategoryCatalogQuery } from '@pf/classification/contracts';
import type { FxValuationPort, ResolvedRateDto } from '@pf/fx/contracts';
import type { AccountBalanceHistoryQuery, AccountSetFlowQuery } from '@pf/ledger/contracts';
import type { Clock } from '@pf/shared-kernel';
import type { NominalFlowQuery, NominalPortionQuery } from '@pf/transactions/contracts';
import type {
  DataVersionStore,
  FinancialPeriodsPort,
  ReportingMetricsPort,
  ReportingUnitOfWork,
  WorkspaceSettingsPort,
} from './index.js';

interface MoneyRow {
  readonly amount: string;
  readonly currency: string;
}

/** Presupuesto vs real de un periodo tal como lo calcula PLANNING (`BudgetVsActualQuery.getForPeriod`); `null` sin plan. */
export interface BudgetVsActualRow {
  readonly budgetId: string;
  readonly currency: string;
  readonly lines: readonly {
    readonly budgetLineId: string;
    readonly target: { readonly kind: string; readonly id: string };
    readonly nature: string;
    readonly kind: string;
    readonly reference: MoneyRow;
    readonly actual: MoneyRow;
    readonly actualComplete: boolean;
    readonly status: string;
  }[];
  readonly totals: {
    readonly planned: MoneyRow;
    readonly actual: MoneyRow;
    readonly remaining: MoneyRow;
    readonly availableToSpend: MoneyRow;
    readonly complete: boolean;
    readonly unconverted: readonly MoneyRow[];
  };
  readonly ratesUsed: readonly ResolvedRateDto[];
}

/** PLANNING (`BudgetVsActualQuery`): REPORTING no importa `@pf/planning`; la composición entrega el adapter. */
export interface BudgetVsActualPort {
  getForPeriod(input: {
    readonly workspaceId: string;
    readonly periodId: string;
  }): Promise<BudgetVsActualRow | null>;
}

/** TRANSACTIONS (`ReconciliationMarksQuery`): fechas de extracto de las conciliaciones completadas de una cuenta. */
export interface ReconciliationMarksPort {
  closedStatementDates(input: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<readonly string[]>;
}

/** LEDGER (`LedgerActivityRangeQuery`): primer asiento del workspace (promedio móvil sin periodos previos). */
export interface LedgerActivityPort {
  getActivityRange(
    workspaceId: string,
  ): Promise<{ readonly minEntryDate: string; readonly maxEntryDate: string } | null>;
}

/** AUDIT (`AuditPort`): registro de la exportación de un reporte, sin contenido del archivo. */
export interface ReportAuditPort {
  exported(input: {
    readonly workspaceId: string;
    readonly userId: string | null;
    readonly reportId: string;
    /** Filtros del reporte como texto JSON (valores compuestos de auditoría, convención). */
    readonly filters: string;
    readonly rowCount: number;
  }): Promise<void>;
}

/**
 * Puertos de los reportes financieros (add-financial-reports): contratos públicos de TRANSACTIONS, LEDGER, ACCOUNTS,
 * CLASSIFICATION, FX, PLANNING y AUDIT, todos en la misma unidad de trabajo de lectura con RLS del workspace.
 */
export interface FinancialReportsDeps {
  readonly uow: ReportingUnitOfWork;
  readonly workspaces: WorkspaceSettingsPort;
  readonly accounts: AccountCatalogQuery;
  readonly categories: Pick<CategoryCatalogQuery, 'categoryTree'>;
  readonly rates: FxValuationPort;
  readonly versions: DataVersionStore;
  readonly clock: Clock;
  readonly flows: NominalFlowQuery;
  readonly portions: NominalPortionQuery;
  readonly accountFlows: AccountSetFlowQuery;
  readonly balanceHistory: AccountBalanceHistoryQuery;
  readonly periods: FinancialPeriodsPort;
  readonly calendar?: {
    calendarOf(
      workspaceId: string,
    ): Promise<{ readonly timeZone: string; readonly fiscalMonthStartDay: number }>;
  };
  readonly activity: LedgerActivityPort;
  readonly budgets: BudgetVsActualPort;
  readonly marks: ReconciliationMarksPort;
  readonly audit?: ReportAuditPort;
  readonly metrics?: ReportingMetricsPort;
  readonly rateValidityWindowDays?: number;
}
