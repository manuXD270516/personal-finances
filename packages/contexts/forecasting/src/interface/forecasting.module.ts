import type { CategoryMergeQuery } from '@pf/classification/contracts';
import { Module, type DynamicModule } from '@nestjs/common';
import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import { runWithRequestContext } from '@pf/platform/api';
import type { Logger } from '@pf/platform/logging';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import type {
  AnomalyDeps,
  AnomalyMetrics,
  AnomalyNotifier,
  AnomalySettings,
  ExpenseLinesPort,
  ResolvedTransactionsPort,
  TransactionStatesPort,
} from '../application/anomaly-ports.js';
import { BacktestSpendingAnomalies } from '../application/backtest-spending-anomalies.js';
import { DetectSpendingAnomalies } from '../application/detect-spending-anomalies.js';
import { ExecuteForecastRun } from '../application/execute-forecast-run.js';
import { SpendingAnomalyQueries } from '../application/spending-anomaly-queries.js';
import { ForecastQueries } from '../application/forecast-queries.js';
import type {
  CategoriesPort,
  FlowsPort,
  ForecastMetrics,
  ForecastServicePort,
  ForecastingDeps,
  ForecastingSettings,
  KnownSourcesPort,
  LiquidAccountsPort,
  OutboxPort,
  RatesPort,
  WorkspaceDirectory,
  WorkspaceSettingsPort,
} from '../application/ports.js';
import { RequestForecastRun } from '../application/request-forecast-run.js';
import { ScheduleForecastRuns } from '../application/schedule-forecast-runs.js';
import { FORECAST_RUNNER_JOB, FORECAST_SCHEDULE_JOB } from '../contracts/index.js';
import {
  DEFAULT_ANOMALY_THRESHOLDS,
  DEFAULT_RETRY_POLICY,
  DEFAULT_THRESHOLDS,
  FORECAST_RUN_LIFECYCLE,
} from '../domain/index.js';
import {
  PgAnomalyMaintenance,
  PgAnomalyRepository,
  PgAnomalyScanRepository,
} from '../infrastructure/pg-anomalies.js';
import {
  PgForecastOperations,
  PgForecastingUnitOfWork,
  PgMaintenance,
  PgRunRepository,
  PgSeriesRepository,
  uuidV7Ids,
} from '../infrastructure/pg-forecasting.js';
import { FORECASTING_QUERIES, FORECASTING_REQUEST, ForecastingController } from './forecasting-http.js';
import { SPENDING_ANOMALY_QUERIES, SpendingAnomaliesController } from './spending-anomalies-http.js';

export const DEFAULT_FORECASTING_SETTINGS: ForecastingSettings = {
  enabled: false,
  maxAgeDays: 7,
  historyMaxPeriods: 60,
  thresholds: DEFAULT_THRESHOLDS,
  retry: DEFAULT_RETRY_POLICY,
  staleDays: 35,
  rateValidityWindowDays: 7,
  coherenceGapRatio: '0.05',
};

/** Ajustes por omisión de la detección de gastos atípicos (D473, D474): habilitada, 7 días, 15, 3.0, 8 y percentil 99.5 (D513). */
export const DEFAULT_ANOMALY_SETTINGS: AnomalySettings = {
  enabled: true,
  lookbackDays: 7,
  thresholds: DEFAULT_ANOMALY_THRESHOLDS,
  rateValidityWindowDays: 7,
};

/** Puertos de la detección de gastos atípicos (add-spending-anomaly-detection); sin ellos la función queda deshabilitada. */
export interface AnomalyRuntimeOptions {
  readonly expenses: ExpenseLinesPort;
  readonly resolved: ResolvedTransactionsPort;
  readonly transactions: TransactionStatesPort;
  /** Aviso a NOTIFICATIONS (hecho de la pasada); solo el worker lo cablea. */
  readonly notifier?: AnomalyNotifier;
  readonly settings?: Partial<AnomalySettings>;
  readonly metrics?: AnomalyMetrics;
}

const NO_ANOMALY_PORTS: Pick<AnomalyRuntimeOptions, 'expenses' | 'resolved' | 'transactions'> = {
  expenses: { listExpenseLines: async () => [] },
  resolved: { transactionIds: async () => new Set() },
  transactions: { statesOf: async () => [] },
};

const NO_ANOMALY_METRICS: AnomalyMetrics = {
  evaluated: () => undefined,
  notRated: () => undefined,
  flagged: () => undefined,
  decided: () => undefined,
  passDuration: () => undefined,
};

export interface ForecastingRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  /** Auditoría + recorrido (add-lifecycle-timeline). */
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery?: LifecycleQuery;
  readonly outbox: OutboxPort;
  readonly workspaces: WorkspaceDirectory;
  /** Puertos de lectura sobre los contratos públicos de IDENTITY, TRANSACTIONS, CLASSIFICATION y FX. */
  readonly settingsOf: WorkspaceSettingsPort;
  readonly flows: FlowsPort;
  /** Ocurrencias, proyección y cuotas de los costos conocidos (COMMITMENTS y DEBT). */
  readonly known: KnownSourcesPort;
  readonly categories: CategoriesPort;
  /** D496: la historia de una categoría fusionada cuenta como la de su destino (add-category-and-counterparty-merge). */
  readonly categoryMerge?: CategoryMergeQuery;
  /** Cuentas líquidas por moneda (add-predicted-cash-flow-band); sin él no hay serie del gasto variable líquido. */
  readonly liquidAccounts?: LiquidAccountsPort;
  readonly rates: RatesPort;
  /** ACL del servicio `finance-ml` (en la API no se usa: solo el worker llama al servicio). */
  readonly service: ForecastServicePort;
  readonly settings?: Partial<ForecastingSettings>;
  readonly metrics?: ForecastMetrics;
  /** Detección de gastos atípicos (add-spending-anomaly-detection); ausente ⇒ deshabilitada. */
  readonly anomalies?: AnomalyRuntimeOptions;
}

export interface ForecastingRuntime {
  readonly request: RequestForecastRun;
  readonly queries: ForecastQueries;
  readonly schedule: ScheduleForecastRuns;
  readonly execute: ExecuteForecastRun;
  /** Gastos atípicos: paso diario de `forecasting.schedule`, lista, descarte y restauración. */
  readonly anomalies: {
    readonly detect: DetectSpendingAnomalies;
    readonly queries: SpendingAnomalyQueries;
    /** Evaluación contra las etiquetas del Large Seed (`pnpm forecast:anomalies:backtest`, nightly): no persiste nada. */
    readonly backtest: BacktestSpendingAnomalies;
  };
}

const NO_METRICS: ForecastMetrics = {
  observeDuration: () => undefined,
  failure: () => undefined,
  insufficient: () => undefined,
};

/** Composición de FORECAST sobre PostgreSQL y los contratos públicos de los demás contextos. */
export function createForecastingRuntime(options: ForecastingRuntimeOptions): ForecastingRuntime {
  const uow = new PgForecastingUnitOfWork(options.pool);
  const deps: ForecastingDeps = {
    uow,
    runs: new PgRunRepository(),
    series: new PgSeriesRepository(),
    operations: new PgForecastOperations(),
    maintenance: new PgMaintenance(uow),
    workspaces: options.workspaces,
    settingsOf: options.settingsOf,
    flows: options.flows,
    known: options.known,
    categories: options.categories,
    ...(options.categoryMerge ? { categoryMerge: options.categoryMerge } : {}),
    ...(options.liquidAccounts ? { liquidAccounts: options.liquidAccounts } : {}),
    rates: options.rates,
    service: options.service,
    audit: options.audit,
    lifecycle: options.lifecycle,
    ...(options.lifecycleQuery ? { lifecycleQuery: options.lifecycleQuery } : {}),
    outbox: options.outbox,
    ids: uuidV7Ids,
    clock: options.clock,
    settings: { ...DEFAULT_FORECASTING_SETTINGS, ...options.settings },
    metrics: options.metrics ?? NO_METRICS,
  };
  const anomalyOptions = options.anomalies;
  const anomalyRepo = new PgAnomalyRepository();
  const anomalyScans = new PgAnomalyScanRepository();
  const anomalyDeps: AnomalyDeps = {
    uow,
    workspaces: options.workspaces,
    settingsOf: options.settingsOf,
    categories: options.categories,
    ...(options.categoryMerge ? { categoryMerge: options.categoryMerge } : {}),
    rates: options.rates,
    expenses: anomalyOptions?.expenses ?? NO_ANOMALY_PORTS.expenses,
    resolved: anomalyOptions?.resolved ?? NO_ANOMALY_PORTS.resolved,
    transactions: anomalyOptions?.transactions ?? NO_ANOMALY_PORTS.transactions,
    anomalies: anomalyRepo,
    scans: anomalyScans,
    maintenance: new PgAnomalyMaintenance(uow),
    ...(anomalyOptions?.notifier ? { notifier: anomalyOptions.notifier } : {}),
    audit: options.audit,
    ids: uuidV7Ids,
    clock: options.clock,
    settings: {
      ...DEFAULT_ANOMALY_SETTINGS,
      rateValidityWindowDays: deps.settings.rateValidityWindowDays,
      ...anomalyOptions?.settings,
      // Sin los puertos de lectura la función no puede evaluar nada: queda deshabilitada.
      ...(anomalyOptions ? {} : { enabled: false }),
    },
    metrics: anomalyOptions?.metrics ?? NO_ANOMALY_METRICS,
  };
  return {
    request: new RequestForecastRun(deps),
    queries: new ForecastQueries(deps),
    schedule: new ScheduleForecastRuns(deps),
    execute: new ExecuteForecastRun(deps),
    anomalies: {
      detect: new DetectSpendingAnomalies(anomalyDeps),
      queries: new SpendingAnomalyQueries(anomalyDeps),
      backtest: new BacktestSpendingAnomalies(anomalyDeps),
    },
  };
}

/**
 * Job `forecasting.schedule` (diario), con el actor de proceso: dos pasos INDEPENDIENTES (add-spending-anomaly-detection,
 * decisión 6). Primero las corridas programadas y su retención (solo con `FORECASTING_ENABLED`; deshabilitado, el paso no
 * hace nada) y después la detección de gastos atípicos (solo con `FORECASTING_ANOMALIES_ENABLED`). La falla de un paso se
 * registra y no impide el otro.
 */
export function runForecastSchedule(
  runtime: Pick<ForecastingRuntime, 'schedule'> & Partial<Pick<ForecastingRuntime, 'anomalies'>>,
  logger: Pick<Logger, 'info' | 'warn'>,
  trigger: 'cron' | 'startup' | 'manual',
) {
  return runWithRequestContext(
    { actor: { type: 'WORKER', process: FORECAST_SCHEDULE_JOB }, origin: 'recurring' },
    async () => {
      let summary: Awaited<ReturnType<ScheduleForecastRuns['run']>> = {
        workspaces: 0,
        created: 0,
        purged: 0,
        failed: 0,
        errors: [],
      };
      try {
        summary = await runtime.schedule.run();
      } catch (err) {
        logger.warn(
          { trigger, error: err instanceof Error ? err.name : typeof err },
          'forecast schedule: the run scheduling step failed',
        );
      }
      if (summary.failed > 0) {
        logger.warn(
          { trigger, failed: summary.failed, errors: summary.errors },
          'forecast schedule: some steps failed',
        );
      }
      logger.info(
        {
          job: FORECAST_SCHEDULE_JOB,
          trigger,
          workspaces: summary.workspaces,
          created: summary.created,
          purged: summary.purged,
        },
        'forecast runs scheduled',
      );
      let anomalies: Awaited<ReturnType<DetectSpendingAnomalies['run']>> | null = null;
      if (runtime.anomalies) {
        try {
          anomalies = await runtime.anomalies.detect.run();
          if (anomalies.failed > 0) {
            logger.warn(
              { trigger, failed: anomalies.failed, errors: anomalies.errors },
              'spending anomalies: some workspaces failed',
            );
          }
          logger.info(
            {
              job: FORECAST_SCHEDULE_JOB,
              trigger,
              workspaces: anomalies.workspaces,
              evaluated: anomalies.evaluated,
              flagged: anomalies.flagged,
              purged: anomalies.purged,
            },
            'spending anomalies detected',
          );
        } catch (err) {
          logger.warn(
            { trigger, error: err instanceof Error ? err.name : typeof err },
            'spending anomalies: the detection step failed',
          );
        }
      }
      return { ...summary, anomalies };
    },
  );
}

/** Job `forecasting.runner` (cada minuto): UNA corrida por pasada, con el actor de proceso. */
export function runForecastRunner(
  runtime: Pick<ForecastingRuntime, 'execute'>,
  logger: Pick<Logger, 'info'>,
) {
  return runWithRequestContext(
    { actor: { type: 'WORKER', process: FORECAST_RUNNER_JOB }, origin: 'recurring' },
    async () => {
      const outcome = await runtime.execute.runOnce();
      if (outcome.kind !== 'IDLE')
        logger.info({ job: FORECAST_RUNNER_JOB, outcome: outcome.kind }, 'forecast run processed');
      return outcome;
    },
  );
}

export interface ForecastingModuleOptions {
  readonly runtime: Pick<ForecastingRuntime, 'request' | 'queries' | 'anomalies'>;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de FORECAST (`/forecasts*` y `/spending-anomalies*`). */
@Module({})
export class ForecastingModule {
  static register(options: ForecastingModuleOptions): DynamicModule {
    return {
      module: ForecastingModule,
      controllers: [ForecastingController, SpendingAnomaliesController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: FORECASTING_REQUEST, useValue: options.runtime.request },
        { provide: FORECASTING_QUERIES, useValue: options.runtime.queries },
        { provide: SPENDING_ANOMALY_QUERIES, useValue: options.runtime.anomalies.queries },
      ],
    };
  }
}

/** Máquina declarada por el dominio, para AUDIT en el composition root. */
export const FORECAST_RUN_LIFECYCLE_MACHINE = FORECAST_RUN_LIFECYCLE.definition;

export {
  ANOMALY_METRICS,
  FORECASTING_AUDIT_POLICY,
  FORECAST_ANOMALY_BACKTEST,
  FORECAST_GENERATED_EVENT,
  FORECAST_RUNNER_JOB,
  FORECAST_SCHEDULE_JOB,
  LATEST_FORECAST_QUERY,
  LIQUID_VARIABLE_SPEND_QUERY,
} from '../contracts/index.js';
export { MlForecastingServiceClient } from '../infrastructure/ml-service-client.js';
export type { OutboxPort } from '../application/ports.js';
export type { AnomalyThresholds } from '../domain/index.js';
export { BacktestReport, collectBacktestReport } from './backtest-report-runner.js';
export {
  MIN_PRECISION,
  MIN_RECALL,
  buildBacktestReport,
  formatBacktestReport,
  type AnomalyBacktestReport,
  type AnomalyLabel,
  type BacktestThresholds,
} from '../application/backtest-spending-anomalies.js';
