import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { Clock, FlowRateResolverInput, FlowResolvedRate } from '@pf/shared-kernel';
import type {
  CategoryInfo,
  Confidence,
  Driver,
  FlowRow,
  InstallmentInput,
  KnownItem,
  LoanComponentInput,
  OccurrenceInput,
  ResolvedInput,
  FailureReason,
  ForecastRequestV1,
  ForecastResponseV1,
  ForecastRun,
  ForecastRunStatus,
  GroupInfo,
  ReadinessReason,
  ReadinessThresholds,
  RetryPolicy,
  SeriesScope,
} from '../domain/index.js';

/** Transacción PG con `SET LOCAL app.workspace_id` (RLS, ADR-0023); reutiliza la del llamador si existe. */
export interface UnitOfWork {
  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}

export interface IdGenerator {
  next(): string;
}

export interface OutboxPort {
  append(event: {
    readonly eventId: string;
    readonly eventType: string;
    readonly eventVersion: number;
    readonly occurredAt: string;
    readonly workspaceId: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly aggregateVersion: number;
    readonly actor?: { readonly type: 'USER' | 'SYSTEM' | 'SERVICE'; readonly id: string };
    readonly payload: object;
  }): Promise<void>;
}

/** Zona horaria, día de inicio del mes financiero y moneda de reporte del workspace (IDENTITY; adapter en la composición). */
export interface WorkspaceSettingsPort {
  settingsOf(workspaceId: string): Promise<{
    readonly timeZone: string;
    readonly startDay: number;
    readonly reportingCurrency: string;
    /** Escala de la moneda de reporte. */
    readonly reportingScale: number;
  }>;
}

/** Flujos nominales diarios (TRANSACTIONS `NominalFlowQuery`; adapter en la composición). */
export interface FlowsPort {
  loadFlows(workspaceId: string, dateFrom: string, dateTo: string): Promise<readonly FlowRow[]>;
  /** Porciones de gasto con componente de préstamo (`NominalFlowQuery` con `groupBy: ['ORIGIN']`; add-expense-forecasts). */
  loadLoanComponents(
    workspaceId: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<readonly LoanComponentInput[]>;
}

/**
 * Insumos de los costos conocidos (add-expense-forecasts, decisiones 2 a 4): COMMITMENTS (ocurrencias resueltas y
 * no resueltas con la proyección sin guardar) y DEBT (cuotas futuras con componentes). Adapters en la composición; las
 * lecturas se hacen en serie dentro de la transacción de lectura de la corrida.
 */
export interface KnownSourcesPort {
  listResolved(
    workspaceId: string,
    from: string,
    to: string,
    direction: 'OUTFLOW' | 'INFLOW',
  ): Promise<readonly ResolvedInput[]>;
  project(workspaceId: string, from: string, to: string): Promise<readonly OccurrenceInput[]>;
  installments(workspaceId: string, from: string, to: string): Promise<readonly InstallmentInput[]>;
}

/** Catálogo de categorías con su grupo (CLASSIFICATION `CategoryCatalogQuery`; adapter en la composición). */
export interface CategoriesPort {
  catalog(workspaceId: string): Promise<{
    readonly groups: readonly GroupInfo[];
    readonly categories: readonly CategoryInfo[];
  }>;
}

/** Valoración de FX con la ventana de REPORTING (`FlowValuation.resolveRates`). */
export interface RatesPort {
  resolve(
    workspaceId: string,
    input: FlowRateResolverInput,
  ): Promise<readonly (FlowResolvedRate<unknown> | null | undefined)[]>;
}

/** Error del cliente del servicio, ya mapeado a un motivo de falla de la corrida. */
export class ForecastServiceError extends Error {
  constructor(
    readonly reason: FailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'ForecastServiceError';
  }
}

/** ACL del servicio `finance-ml`: `POST /v1/forecasts`. Lanza `ForecastServiceError`. Nunca se llama dentro de una UoW. */
export interface ForecastServicePort {
  forecast(request: ForecastRequestV1): Promise<ForecastResponseV1>;
}

export interface StoredPoint {
  readonly period: string;
  readonly monthsAhead: number;
  readonly prediction: string;
  readonly lower80: string;
  readonly upper80: string;
  readonly lower95: string;
  readonly upper95: string;
  readonly baselineValue: string;
  /** Componentes (add-expense-forecasts); `null` en las corridas anteriores a este change. */
  readonly knownFuture: string | null;
  readonly predictedVariable: string | null;
  readonly variableLower80: string | null;
  readonly variableUpper80: string | null;
  readonly knownBlankCount: number;
  readonly drivers: readonly Driver[] | null;
}

export interface StoredBacktest {
  readonly modelName: string;
  readonly origins: number;
  readonly mase: string | null;
  readonly coverage80: string | null;
  readonly bias: string | null;
  readonly selected: boolean;
}

export interface StoredKnownItem extends KnownItem {
  readonly currency: string;
}

export interface RunMetadata {
  readonly seed: number;
  readonly modelSet: string;
  /** Conversión de los conocidos con la tasa de hoy (declarada en `LatestForecast.meta.conversion`). */
  readonly conversion: { readonly rateDate: string; readonly ratesUsed: readonly unknown[] } | null;
}

export type StoredSeriesStatus = 'PUBLISHED' | 'INSUFFICIENT' | 'INVALID';

export interface StoredSeries {
  readonly id: string;
  readonly runId: string;
  readonly workspaceId: string;
  readonly opaqueRef: string;
  readonly scope: SeriesScope;
  readonly scopeRef: string | null;
  readonly name: string;
  readonly currency: string;
  readonly scale: number;
  readonly readiness: 'MODEL' | 'SIMPLE' | 'INSUFFICIENT';
  readonly readinessReasons: readonly ReadinessReason[];
  readonly historyFrom: string | null;
  readonly historyTo: string | null;
  readonly historyPeriods: number;
  readonly groupedCategoryIds: readonly string[];
  readonly modelName: string | null;
  readonly modelVersion: string | null;
  readonly baselineMethod: string | null;
  readonly baselineN: number | null;
  readonly status: StoredSeriesStatus;
  readonly points: readonly StoredPoint[];
  readonly selectedBy: 'BACKTEST' | 'BASELINE_FALLBACK' | 'SIMPLE' | null;
  readonly mase: string | null;
  readonly baselineMase: string | null;
  readonly coverage80: string | null;
  readonly confidence: Confidence | null;
  /** Resultado del backtesting por candidato (con `insertAll`; no se lee con `listByRun`). */
  readonly backtest?: readonly StoredBacktest[];
  /** Conocidos del horizonte de la serie (con `insertAll`; se leen con `listKnownItems`). */
  readonly knownItems?: readonly StoredKnownItem[];
}

export interface ListRunsFilter {
  readonly statuses?: readonly ForecastRunStatus[];
  readonly cursor?: { readonly requestedAt: string; readonly id: string };
  readonly limit: number;
}

export interface RunRepository {
  /** Inserta la corrida si el workspace no tiene otra solicitada o en curso; `false` si ya hay una activa. */
  insertIfNoActive(run: ForecastRun): Promise<boolean>;
  findById(workspaceId: string, id: string): Promise<ForecastRun | null>;
  /** Reclama (`FOR UPDATE SKIP LOCKED`) la corrida `REQUESTED` más antigua con `next_attempt_at ≤ now`. */
  claimNext(workspaceId: string, nowIso: string): Promise<ForecastRun | null>;
  /** Corridas `RUNNING` sin progreso desde antes de `beforeIso`, bloqueadas. */
  claimStalled(workspaceId: string, beforeIso: string): Promise<readonly ForecastRun[]>;
  /** Control optimista por versión; `false` si otro cambio ganó. */
  save(run: ForecastRun, expectedVersion: number): Promise<boolean>;
  /** Última corrida `COMPLETED` (la vigente), bloqueada si `lock`. */
  latestCompleted(workspaceId: string, options?: { lock?: boolean }): Promise<ForecastRun | null>;
  /** La corrida más reciente de cualquier estado (por solicitud). */
  latestAttempt(workspaceId: string): Promise<ForecastRun | null>;
  hasActive(workspaceId: string): Promise<boolean>;
  list(workspaceId: string, filter: ListRunsFilter): Promise<readonly ForecastRun[]>;
  /** Instante de solicitud de la última corrida programada, o `null`. */
  lastScheduledAt(workspaceId: string): Promise<string | null>;
}

export interface SeriesRepository {
  insertAll(series: readonly StoredSeries[]): Promise<void>;
  listByRun(workspaceId: string, runId: string): Promise<readonly StoredSeries[]>;
  /** Conocidos de un periodo de una serie de la corrida, por fecha y etiqueta. */
  listKnownItems(
    workspaceId: string,
    runId: string,
    series: { readonly scope: SeriesScope; readonly scopeRef: string | null },
    period: string,
  ): Promise<readonly StoredKnownItem[]>;
  saveRunMetadata(workspaceId: string, runId: string, metadata: RunMetadata): Promise<void>;
  runMetadata(workspaceId: string, runId: string): Promise<RunMetadata | null>;
}

/** Operación asíncrona consultable (`platform.operation`, kind `FORECAST`): mismo id que la corrida. */
export interface OperationPort {
  create(input: {
    readonly id: string;
    readonly workspaceId: string;
    readonly requestedBy: string;
  }): Promise<void>;
  update(
    workspaceId: string,
    id: string,
    patch: {
      readonly status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
      readonly progressPct?: number;
      readonly error?: Readonly<Record<string, unknown>> | null;
    },
  ): Promise<void>;
}

export interface RunRef {
  readonly workspaceId: string;
  readonly runId: string;
}

/** Barridos entre workspaces como `pf_maintenance` (SIN contexto de workspace) y purga por retención. */
export interface MaintenancePort {
  /** Corridas `REQUESTED` con la espera cumplida, o `RUNNING` colgadas, la más antigua primero. */
  dueRuns(nowIso: string, stalledBeforeIso: string, limit: number): Promise<readonly RunRef[]>;
  /** Candidatos a purga: `SUPERSEDED` anteriores a `supersededBefore` y `FAILED`/`INSUFFICIENT_DATA` anteriores a `failedBefore`. */
  purgeCandidates(input: { readonly supersededBeforeIso: string; readonly failedBeforeIso: string }): Promise<
    readonly {
      readonly workspaceId: string;
      readonly runId: string;
      readonly status: ForecastRunStatus;
      readonly completedAt: string | null;
      readonly requestedAt: string;
    }[]
  >;
  /** Borra las corridas indicadas (cascada a series y puntos); corre en la unidad de trabajo del workspace. */
  deleteRuns(workspaceId: string, runIds: readonly string[]): Promise<number>;
}

export interface WorkspaceDirectory {
  list(): Promise<readonly { readonly workspaceId: string }[]>;
}

export interface ForecastingSettings {
  readonly enabled: boolean;
  readonly maxAgeDays: number;
  readonly historyMaxPeriods: number;
  readonly thresholds: ReadinessThresholds;
  readonly retry: RetryPolicy;
  readonly staleDays: number;
  readonly rateValidityWindowDays: number;
  /** `FORECASTING_COHERENCE_GAP_RATIO` (por omisión 0.05): umbral de la diferencia entre categorías y total. */
  readonly coherenceGapRatio: string;
}

export interface ForecastMetrics {
  /** Duración de una corrida por resultado. */
  observeDuration(outcome: 'completed' | 'insufficient_data' | 'failed' | 'retry', seconds: number): void;
  /** Falla de una corrida por motivo (`unavailable`, `rejected`, `timeout`, `invalid_output`). */
  failure(reason: 'unavailable' | 'rejected' | 'timeout' | 'invalid_output'): void;
  insufficient(count: number): void;
}

export interface ForecastingDeps {
  readonly uow: UnitOfWork;
  readonly runs: RunRepository;
  readonly series: SeriesRepository;
  readonly operations: OperationPort;
  readonly maintenance: MaintenancePort;
  readonly workspaces: WorkspaceDirectory;
  readonly settingsOf: WorkspaceSettingsPort;
  readonly flows: FlowsPort;
  readonly known: KnownSourcesPort;
  readonly categories: CategoriesPort;
  readonly rates: RatesPort;
  readonly service: ForecastServicePort;
  readonly audit: AuditPort;
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery?: LifecycleQuery;
  readonly outbox: OutboxPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly settings: ForecastingSettings;
  readonly metrics: ForecastMetrics;
}
