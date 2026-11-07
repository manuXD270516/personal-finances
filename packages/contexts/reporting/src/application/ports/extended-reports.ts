import type { CounterpartyCatalogQuery } from '@pf/classification/contracts';
import type { ConversionDetailQuery } from '@pf/transactions/contracts';
import type { ConversionCostAnalysisDto } from '../../contracts/index.js';

interface MoneyRow {
  readonly amount: string;
  readonly currency: string;
}

/**
 * Puertos de los reportes ampliados (add-financial-reports-extended). Cada uno es la forma estructural de un contrato
 * público de otro contexto (`GoalProgressHistoryQuery`, `DebtHistoryQuery`, `LoanPortfolioQuery`, `CardPortfolioQuery`,
 * `RecurringCostQuery`, `SubscriptionHistoryQuery`): REPORTING no importa `@pf/goals`, `@pf/debt` ni `@pf/commitments`
 * (se componen después que él); la composición entrega los adapters con resolución tardía.
 */
export interface GoalHistoryPort {
  monthly(input: {
    readonly workspaceId: string;
    readonly goalIds?: readonly string[];
    readonly from: string;
    readonly to: string;
  }): Promise<
    readonly {
      readonly goalId: string;
      readonly name: string;
      readonly currency: string;
      readonly target: MoneyRow;
      readonly startDate: string;
      readonly targetDate: string | null;
      readonly months: readonly {
        readonly monthEnd: string;
        readonly contributions: MoneyRow;
        readonly withdrawals: MoneyRow;
        readonly accumulated: MoneyRow;
        readonly expected: MoneyRow | null;
        readonly status: 'BEHIND' | 'ON_TRACK' | 'AHEAD' | null;
        readonly complete: boolean;
      }[];
    }[]
  >;
}

export interface DebtHistoryPort {
  monthly(input: { readonly workspaceId: string; readonly from: string; readonly to: string }): Promise<
    readonly {
      readonly loanId: string;
      readonly month: string;
      readonly currency: string;
      readonly principal: string;
      readonly interest: string;
      readonly charges: string;
      readonly payments: readonly {
        readonly date: string;
        readonly principal: string;
        readonly interest: string;
        readonly charges: string;
      }[];
    }[]
  >;
}

/** Préstamos y cuentas de tarjeta con la cuenta del usuario cuyo saldo contable es la deuda. */
export interface DebtPortfolioPort {
  listLoans(input: {
    readonly workspaceId: string;
    readonly statuses: readonly ('ACTIVE' | 'PAID_OFF')[];
  }): Promise<
    readonly {
      readonly loanId: string;
      readonly name: string;
      readonly accountId: string;
      readonly currency: string;
    }[]
  >;
  listCards(input: { readonly workspaceId: string }): Promise<
    readonly {
      readonly cardId: string;
      readonly cardName: string;
      readonly cardAccountId: string;
      readonly accountId: string;
      readonly currency: string;
    }[]
  >;
}

export interface RecurringCostPort {
  listCosts(input: { readonly workspaceId: string }): Promise<
    readonly {
      readonly definitionId: string;
      readonly name: string;
      readonly categoryId: string | null;
      readonly cadence: string;
      readonly interval: number;
      readonly currency: string;
      readonly renewalsPerYear: string | null;
      readonly price: string | null;
      readonly variable: boolean;
    }[]
  >;
}

export interface SubscriptionHistoryPort {
  listEvents(input: { readonly workspaceId: string; readonly from: string; readonly to: string }): Promise<
    readonly {
      readonly subscriptionId: string;
      readonly name: string;
      readonly date: string;
      readonly kind: 'STARTED' | 'CANCELLED' | 'PRICE_CHANGED';
      readonly previousPrice: MoneyRow | null;
      readonly newPrice: MoneyRow | null;
      readonly renewalsPerYear: string;
    }[]
  >;
}

/** Análisis de costo de conversiones del propio contexto (la misma regla y exclusiones del análisis de Phase 5). */
export interface ConversionCostPort {
  getAnalysis(query: {
    readonly userId: string | null;
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
    readonly grouping: 'FINANCIAL_PERIOD' | 'CALENDAR_MONTH';
    readonly reportingCurrency?: string;
  }): Promise<ConversionCostAnalysisDto>;
}

export interface SavedViewRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly reportId: string;
  readonly name: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Repositorio de vistas guardadas (`reporting.saved_report_view`): RLS por workspace Y usuario, así que solo ve y toca las
 * del usuario de la unidad de trabajo. Corre dentro de `ReportingUnitOfWork.run({userId, workspaceId})`.
 */
export interface SavedViewRepository {
  list(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly reportId?: string;
  }): Promise<readonly SavedViewRecord[]>;
  find(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly id: string;
  }): Promise<SavedViewRecord | null>;
  /** Serializa las altas del usuario en el workspace y cuenta sus vistas (tope de 50). */
  lockAndCount(input: { readonly workspaceId: string; readonly userId: string }): Promise<number>;
  /** `true` si ya hay una vista del reporte con ese nombre (sin distinguir mayúsculas). */
  nameTaken(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly reportId: string;
    readonly name: string;
    readonly exceptId?: string;
  }): Promise<boolean>;
  insert(record: SavedViewRecord): Promise<void>;
  /** Control optimista por `version`; `false` si cambió o ya no existe. */
  update(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly name: string;
    readonly params: Readonly<Record<string, unknown>>;
    readonly updatedAt: string;
  }): Promise<boolean>;
  delete(input: {
    readonly workspaceId: string;
    readonly userId: string;
    readonly id: string;
  }): Promise<boolean>;
}

/** Todo lo que los reportes ampliados necesitan además de `FinancialReportsDeps`. */
export interface ExtendedReportDeps {
  readonly goals: GoalHistoryPort;
  readonly debtHistory: DebtHistoryPort;
  readonly portfolio: DebtPortfolioPort;
  readonly recurring: RecurringCostPort;
  readonly subscriptions: SubscriptionHistoryPort;
  readonly conversions: ConversionDetailQuery;
  readonly conversionCosts: ConversionCostPort;
  readonly counterparties?: CounterpartyCatalogQuery;
  readonly savedViews: SavedViewRepository;
}
