import type { AuditPort } from '@pf/audit/contracts';
import type { Clock } from '@pf/shared-kernel';
import type {
  AnomalyReasonKind,
  AnomalyThresholds,
  SpendingAnomaly,
  SpendingAnomalyStatus,
} from '../domain/index.js';
import type {
  CategoriesPort,
  IdGenerator,
  RatesPort,
  UnitOfWork,
  WorkspaceDirectory,
  WorkspaceSettingsPort,
} from './ports.js';

/**
 * Puertos de la detección de gastos atípicos (openspec add-spending-anomaly-detection, decisiones 2, 6 y 9). Los adapters
 * de lectura viven en la composición (`apps/api`) sobre los contratos públicos de TRANSACTIONS, COMMITMENTS y NOTIFICATIONS.
 */

/** Porción de gasto (`ExpenseLineQuery.listExpenseLines` de TRANSACTIONS), ya sin los gastos administrados por otro módulo. */
export interface ExpenseLineInput {
  readonly transactionId: string;
  readonly version: number;
  /** Fecha de negocio `YYYY-MM-DD`. */
  readonly date: string;
  readonly counterpartyId: string | null;
  readonly categoryId: string;
  readonly splitIndex: number;
  readonly amount: { readonly amount: string; readonly currency: string };
}

export interface ExpenseLinesPort {
  /**
   * Todas las porciones de gastos `POSTED | CLEARED | RECONCILED` entre las fechas (inclusive), recorridas por keyset en serie
   * (nunca en paralelo sobre el mismo cliente) y SIN las administradas por otro módulo (préstamos, cargos de tarjeta, metas).
   */
  listExpenseLines(workspaceId: string, from: string, to: string): Promise<readonly ExpenseLineInput[]>;
}

/** Transacciones vinculadas a una ocurrencia de un compromiso (COMMITMENTS `ResolvedOccurrencesQuery`): no se evalúan. */
export interface ResolvedTransactionsPort {
  transactionIds(workspaceId: string, from: string, to: string): Promise<ReadonlySet<string>>;
}

/** Estado y versión actuales de las transacciones (TRANSACTIONS `ExpenseLineQuery.transactionStates`). */
export interface TransactionStatesPort {
  statesOf(
    workspaceId: string,
    transactionIds: readonly string[],
  ): Promise<
    readonly { readonly transactionId: string; readonly version: number; readonly status: string }[]
  >;
}

/**
 * Hecho de la pasada para NOTIFICATIONS (`SpendingAnomaliesDetectedFact`): una notificación por pasada y destinatario.
 * El adapter de la composición lo entrega al `NotificationIntakePort` dentro de la misma unidad de trabajo.
 */
export interface SpendingAnomaliesPassFact {
  readonly workspaceId: string;
  /** Fecha de la pasada (`YYYY-MM-DD`, zona del workspace). */
  readonly passDate: string;
  readonly count: number;
  /** El gasto atípico de mayor monto en la moneda de reporte. */
  readonly top: {
    readonly anomalyId: string;
    readonly transactionDate: string;
    readonly reportingAmount: { readonly amount: string; readonly currency: string };
    readonly reasons: readonly AnomalyReasonKind[];
  };
  readonly timeZone: string;
  /** Id de la pasada (origen de las notificaciones; NOTIFY lo guarda como `source_event_id`). */
  readonly passId: string;
  readonly occurredAt: string;
}

export interface AnomalyNotifier {
  notify(fact: SpendingAnomaliesPassFact): Promise<void>;
}

export interface ListAnomaliesFilter {
  readonly status: 'OPEN' | 'DISMISSED' | 'ALL';
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly cursor?: { readonly date: string; readonly id: string } | undefined;
  readonly limit: number;
}

export interface AnomalyRepository {
  /** Inserta el gasto atípico; `false` si ya existe uno de esa transacción y versión (idempotencia). */
  insert(anomaly: SpendingAnomaly): Promise<boolean>;
  findById(workspaceId: string, id: string): Promise<SpendingAnomaly | null>;
  /** Control optimista por versión; `false` si otro cambio ganó. */
  save(anomaly: SpendingAnomaly, expectedVersion: number): Promise<boolean>;
  /** Marca `SUPERSEDED` los gastos atípicos de la transacción con una versión menor que `currentVersion`. */
  supersedeOlder(workspaceId: string, transactionId: string, currentVersion: number): Promise<number>;
  /** Página por fecha de la transacción y id, del más reciente al más antiguo (hasta `limit + 1` para saber si hay más). */
  list(workspaceId: string, filter: ListAnomaliesFilter): Promise<readonly SpendingAnomaly[]>;
  /** Los vigentes (`OPEN` y `DISMISSED`) de las transacciones indicadas. */
  byTransactionIds(
    workspaceId: string,
    transactionIds: readonly string[],
  ): Promise<readonly SpendingAnomaly[]>;
  countByStatus(workspaceId: string, status: SpendingAnomalyStatus): Promise<number>;
}

export interface AnomalyScanRepository {
  /** Pares `transactionId:version` ya evaluados con fecha de evaluación posterior o igual a `since` (ISO). */
  evaluated(workspaceId: string, sinceIso: string): Promise<ReadonlySet<string>>;
  record(
    workspaceId: string,
    rows: readonly { readonly transactionId: string; readonly version: number }[],
    atIso: string,
  ): Promise<void>;
}

/** Barrido de retención como `pf_maintenance` y borrado en la unidad de trabajo de cada workspace. */
export interface AnomalyMaintenancePort {
  /** Workspaces con gastos atípicos de transacciones anteriores a `transactionBefore` o evaluaciones anteriores a `scanBefore`. */
  purgeCandidates(input: {
    readonly transactionBefore: string;
    readonly scanBeforeIso: string;
  }): Promise<readonly string[]>;
  purge(
    workspaceId: string,
    input: { readonly transactionBefore: string; readonly scanBeforeIso: string },
  ): Promise<{ readonly anomalies: number; readonly scans: number }>;
}

export interface AnomalySettings {
  /** `FORECASTING_ANOMALIES_ENABLED`. */
  readonly enabled: boolean;
  /** `FORECASTING_ANOMALY_LOOKBACK_DAYS` (7). */
  readonly lookbackDays: number;
  readonly thresholds: AnomalyThresholds;
  /** Ventana de vigencia de las tasas de valoración (`REPORTING_RATE_VALIDITY_WINDOW`). */
  readonly rateValidityWindowDays: number;
}

/** Métricas `forecast_anomaly_*`: sin montos ni identificadores en las etiquetas. */
export interface AnomalyMetrics {
  evaluated(count: number): void;
  /** Gastos no evaluados por falta de tasa. */
  notRated(count: number): void;
  flagged(
    reason: 'CATEGORY_OUTLIER' | 'COUNTERPARTY_OUTLIER' | 'NEW_COUNTERPARTY_HIGH_AMOUNT',
    count: number,
  ): void;
  decided(decision: 'DISMISS' | 'RESTORE'): void;
  passDuration(seconds: number): void;
}

export interface AnomalyDeps {
  readonly uow: UnitOfWork;
  readonly workspaces: WorkspaceDirectory;
  readonly settingsOf: WorkspaceSettingsPort;
  readonly categories: CategoriesPort;
  readonly rates: RatesPort;
  readonly expenses: ExpenseLinesPort;
  readonly resolved: ResolvedTransactionsPort;
  readonly transactions: TransactionStatesPort;
  readonly anomalies: AnomalyRepository;
  readonly scans: AnomalyScanRepository;
  readonly maintenance: AnomalyMaintenancePort;
  readonly notifier?: AnomalyNotifier;
  readonly audit: AuditPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly settings: AnomalySettings;
  readonly metrics: AnomalyMetrics;
}
