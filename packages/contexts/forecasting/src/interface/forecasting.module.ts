import { Module, type DynamicModule } from '@nestjs/common';
import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import { runWithRequestContext } from '@pf/platform/api';
import type { Logger } from '@pf/platform/logging';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { ExecuteForecastRun } from '../application/execute-forecast-run.js';
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
import { DEFAULT_RETRY_POLICY, DEFAULT_THRESHOLDS, FORECAST_RUN_LIFECYCLE } from '../domain/index.js';
import {
  PgForecastOperations,
  PgForecastingUnitOfWork,
  PgMaintenance,
  PgRunRepository,
  PgSeriesRepository,
  uuidV7Ids,
} from '../infrastructure/pg-forecasting.js';
import { FORECASTING_QUERIES, FORECASTING_REQUEST, ForecastingController } from './forecasting-http.js';

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
  /** Cuentas líquidas por moneda (add-predicted-cash-flow-band); sin él no hay serie del gasto variable líquido. */
  readonly liquidAccounts?: LiquidAccountsPort;
  readonly rates: RatesPort;
  /** ACL del servicio `finance-ml` (en la API no se usa: solo el worker llama al servicio). */
  readonly service: ForecastServicePort;
  readonly settings?: Partial<ForecastingSettings>;
  readonly metrics?: ForecastMetrics;
}

export interface ForecastingRuntime {
  readonly request: RequestForecastRun;
  readonly queries: ForecastQueries;
  readonly schedule: ScheduleForecastRuns;
  readonly execute: ExecuteForecastRun;
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
  return {
    request: new RequestForecastRun(deps),
    queries: new ForecastQueries(deps),
    schedule: new ScheduleForecastRuns(deps),
    execute: new ExecuteForecastRun(deps),
  };
}

/** Job `forecasting.schedule` (diario): corridas programadas y retención, con el actor de proceso. */
export function runForecastSchedule(
  runtime: Pick<ForecastingRuntime, 'schedule'>,
  logger: Pick<Logger, 'info' | 'warn'>,
  trigger: 'cron' | 'startup' | 'manual',
) {
  return runWithRequestContext(
    { actor: { type: 'WORKER', process: FORECAST_SCHEDULE_JOB }, origin: 'recurring' },
    async () => {
      const summary = await runtime.schedule.run();
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
      return summary;
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
  readonly runtime: Pick<ForecastingRuntime, 'request' | 'queries'>;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de FORECAST (`/forecasts*`). */
@Module({})
export class ForecastingModule {
  static register(options: ForecastingModuleOptions): DynamicModule {
    return {
      module: ForecastingModule,
      controllers: [ForecastingController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: FORECASTING_REQUEST, useValue: options.runtime.request },
        { provide: FORECASTING_QUERIES, useValue: options.runtime.queries },
      ],
    };
  }
}

/** Máquina declarada por el dominio, para AUDIT en el composition root. */
export const FORECAST_RUN_LIFECYCLE_MACHINE = FORECAST_RUN_LIFECYCLE.definition;

export {
  FORECASTING_AUDIT_POLICY,
  FORECAST_GENERATED_EVENT,
  FORECAST_RUNNER_JOB,
  FORECAST_SCHEDULE_JOB,
  LATEST_FORECAST_QUERY,
  LIQUID_VARIABLE_SPEND_QUERY,
} from '../contracts/index.js';
export { MlForecastingServiceClient } from '../infrastructure/ml-service-client.js';
export type { OutboxPort } from '../application/ports.js';
export { BacktestReport, collectBacktestReport } from './backtest-report-runner.js';
