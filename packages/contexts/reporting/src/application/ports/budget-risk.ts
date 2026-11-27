import type { CategoryCatalogQuery } from '@pf/classification/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import type { Clock } from '@pf/shared-kernel';
import type { BudgetRiskLineKind } from '../../domain/index.js';
import type {
  CashFlowOccurrencesRow,
  FinancialPeriodsPort,
  PredictedForecastPort,
  ReportingMetricsPort,
  ReportingUnitOfWork,
  WorkspaceSettingsPort,
} from './index.js';

interface MoneyRow {
  readonly amount: string;
  readonly currency: string;
}

/** Línea del plan (PLANNING, `BudgetVsActualLineDto`) con lo que necesita el riesgo de presupuesto. */
export interface BudgetRiskPlanLineRow {
  readonly budgetLineId: string;
  readonly target: { readonly kind: string; readonly id: string };
  readonly nature: string;
  readonly kind: BudgetRiskLineKind;
  readonly reference: MoneyRow;
  readonly actual: MoneyRow;
  readonly actualComplete: boolean;
}

export interface BudgetRiskPlanRow {
  readonly budgetId: string;
  readonly currency: string;
  readonly lines: readonly BudgetRiskPlanLineRow[];
}

/** Ocurrencia resuelta con su categoría (COMMITMENTS, `ResolvedOccurrencesQuery.listResolved`). */
export interface ResolvedOccurrenceRow {
  readonly occurrenceId: string;
  readonly kind: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'LOAN_PAYMENT' | 'CARD_PAYMENT';
  readonly categoryId: string | null;
  readonly transactionDate: string;
  readonly amount: MoneyRow;
}

/**
 * Lo que el riesgo de presupuesto necesita de los otros contextos (openspec add-budget-overrun-risk, decisión 5). Se
 * declara aquí (REPORTING no importa `@pf/planning` ni `@pf/commitments`): la composición entrega adapters con resolución
 * tardía sobre sus contratos públicos (`BudgetVsActualQuery`, `UpcomingPaymentsQuery.listForCashFlow`,
 * `ResolvedOccurrencesQuery.listResolved` y `LatestForecastQuery`).
 */
export interface BudgetRiskDeps {
  readonly uow: ReportingUnitOfWork;
  readonly workspaces: WorkspaceSettingsPort;
  readonly periods: FinancialPeriodsPort;
  readonly clock: Clock;
  readonly rates: Pick<FxValuationPort, 'resolveValuationRates' | 'workspaceCurrencies'>;
  readonly categories: Pick<CategoryCatalogQuery, 'categoryTree'>;
  readonly budgets: {
    getForPeriod(input: {
      readonly workspaceId: string;
      readonly periodId: string;
    }): Promise<BudgetRiskPlanRow | null>;
  };
  readonly commitments: {
    listForCashFlow(input: {
      readonly workspaceId: string;
      readonly through: string;
    }): Promise<CashFlowOccurrencesRow>;
    listResolved(input: {
      readonly workspaceId: string;
      readonly from: string;
      readonly to: string;
      readonly direction: 'OUTFLOW' | 'INFLOW';
    }): Promise<readonly ResolvedOccurrenceRow[]>;
  };
  /** Pronóstico vigente; ausente (o `DISABLED`) = solo el ritmo del periodo. */
  readonly forecast?: Pick<PredictedForecastPort, 'getLatest'>;
  /** `REPORTING_BUDGET_RISK_ENABLED`; con `false` la consulta responde `DISABLED` y el paso de avisos no corre. */
  readonly enabled: boolean;
  /** `REPORTING_BUDGET_RISK_MIN_ELAPSED_DAYS` (7 por omisión). */
  readonly minElapsedDays: number;
  readonly rateValidityWindowDays?: number;
  readonly metrics?: ReportingMetricsPort;
}

/** Aviso ya emitido por línea y periodo (`reporting.budget_overrun_notice`). */
export interface BudgetOverrunNoticeRepository {
  /** `true` si se insertó (primera vez); `false` si ya existía (no se avisa otra vez). */
  insertIfAbsent(input: {
    readonly workspaceId: string;
    readonly periodId: string;
    readonly budgetLineId: string;
    readonly level: 'LIKELY';
    readonly estimatedDate: string | null;
    readonly notifiedAt: string;
  }): Promise<boolean>;
}

/** Notificación directa a NOTIFY (`NotificationIntakePort`, D249), dentro de la unidad de trabajo del llamador. */
export interface BudgetRiskNotifierPort {
  notify(fact: {
    readonly workspaceId: string;
    readonly periodId: string;
    readonly periodLabel: string;
    readonly budgetId: string;
    readonly budgetLineId: string;
    readonly target: { readonly kind: 'CATEGORY' | 'GROUP'; readonly id: string; readonly name: string };
    readonly projected: { readonly amount: string; readonly currency: string };
    readonly reference: { readonly amount: string; readonly currency: string };
    readonly estimatedDate: string | null;
    readonly basis: 'RUN_RATE' | 'FORECAST';
    readonly detectedAt: string;
    readonly timeZone: string;
  }): Promise<void>;
}
