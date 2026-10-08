import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { WorkerConfig } from '@pf/platform/config';
import {
  EventConsumerRuntime,
  EventDeliveryMetrics,
  EventSubscriptions,
  OutboxRelay,
  PgOutboxWriter,
  type EventConsumerDefinition,
  type OutboxRelayOptions,
} from '@pf/platform/events';
import {
  objectStorageCheck,
  postgresCheck,
  ReadinessProbe,
  startHealthServer,
  type HealthServer,
} from '@pf/platform/health';
import type { Logger } from '@pf/platform/logging';
import {
  createFxMarketRateJobs,
  createFxValuation,
  parseFxProviderSettings,
  type FxMarketRateJobsOptions,
} from '@pf/fx/interface/fx.module';
import { DEFAULT_RATE_VALIDITY_WINDOW_DAYS } from '@pf/reporting/interface/reporting.module';
import { createNominalFlowQuery } from '@pf/transactions/interface/transactions.module';
import { createAuditRuntime, createLifecycleBackfill } from '@pf/audit/interface/audit.module';
import { createCategoryCatalogQuery } from '@pf/classification/interface/classification.module';
import {
  createDemoDataRuntime,
  identityActiveWorkspaces,
  identityWorkspaceCalendarDirectory,
  identityWorkspaceSettingsDirectory,
  identityWorkspaceTimeZones,
} from '@pf/identity/interface/identity.module';
import {
  createLedgerMaintenance,
  createLedgerRuntime,
  ledgerActivityRange,
} from '@pf/ledger/interface/ledger.module';
import {
  createPlanningRuntime,
  planningEventConsumers,
  runVerifyClosings,
  type ClosingVerifier,
} from '@pf/planning/interface/planning.module';
import { PinoNestLogger } from '@pf/platform/nest';
import { reportingDataVersionConsumer } from '@pf/reporting/interface/reporting.module';
import { otelCounters, shutdownTelemetry } from '@pf/platform/otel';
import type { JobQueue } from '@pf/platform/queue';
import { createObjectStorageClient } from '@pf/platform/storage';
import { systemClock, type Clock } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { eventSchemaRegistry } from '../runtime/event-contracts.js';
import { createJobQueue } from '../runtime/platform-resources.js';
import { registerLifecycleBackfillJob, verifyLifecycleConsistency } from './audit-jobs.js';
import { fxEndpointsFromConfig, registerFxMarketRateJobs } from './fx-jobs.js';
import { registerLedgerDailyJob } from './ledger-jobs.js';
import { registerPlanningPeriodsJob } from './planning-jobs.js';
import { registerDemoJobs } from './demo-jobs.js';
import { DemoDataLoader } from '../demo/demo-data-loader.js';
import { AUDIT_POLICIES, demoDataOptions, outboxPort } from '../identity/identity-wiring.js';
import { WorkerModule } from './platform-jobs.js';

export interface WorkerRuntime {
  readonly context: INestApplicationContext;
  readonly queue: JobQueue;
  readonly pool: Pool;
  readonly relay: OutboxRelay;
  readonly consumers: EventConsumerRuntime;
  readonly subscriptions: EventSubscriptions;
  /** Publica `/health/live` y `/health/ready` (por defecto en WORKER_HEALTH_PORT). Devuelve el puerto. */
  listenHealth(port?: number, host?: string): Promise<number>;
  /**
   * Apagado ordenado (NFR-REL-009): readiness pasa a 503, el relay deja de publicar, la cola deja de tomar jobs y
   * espera a que terminen los activos (pg-boss `offWork({ wait: true })`), y se cierran cola, pool y telemetría.
   */
  close(): Promise<void>;
}

export interface WorkerRuntimeOptions {
  /** Consumidores de eventos registrados por los contextos (y por los tests). */
  readonly eventConsumers?: readonly EventConsumerDefinition[];
  /** Ajustes del relay (tests: lote, polling, inyección de fallos). */
  readonly relay?: Partial<Pick<OutboxRelayOptions, 'batchSize' | 'pollIntervalMs' | 'afterEnqueue'>>;
  readonly metrics?: EventDeliveryMetrics;
  /** Reloj de los comandos del ledger (tests: FixedClock). */
  readonly clock?: Clock;
  /** Encola el mantenimiento diario del ledger al arrancar (por defecto sí; los tests lo desactivan). */
  readonly ledgerMaintenanceOnStart?: boolean;
  /** Providers de tasas de mercado (tests: servidor HTTP local en lugar de los providers reales). */
  readonly fxEndpoints?: FxMarketRateJobsOptions['endpoints'];
  /** Encola un relleno de días faltantes de tasas al arrancar (por defecto sí). */
  readonly fxGapFillOnStart?: boolean;
  /** Encola la reconstrucción del recorrido desde la auditoría al arrancar (por defecto sí; add-lifecycle-timeline). */
  readonly lifecycleBackfillOnStart?: boolean;
  /** Tests (add-demo-data): falla inyectada del cargador demo (`<módulo>/<YYYY-MM>`). */
  readonly demoFailAt?: string;
  /** Encola `planning.ensure-periods` al arrancar (por defecto sí; add-financial-periods). */
  readonly planningPeriodsOnStart?: boolean;
}

export async function createWorkerRuntime(
  config: WorkerConfig,
  logger: Logger,
  options: WorkerRuntimeOptions = {},
): Promise<WorkerRuntime> {
  // pf_worker: relay del outbox entre workspaces, inbox y dead-letter (openspec add-event-outbox, design §4).
  const databaseUrl = config.WORKER_DATABASE_URL;
  if (!databaseUrl) throw new Error('WORKER_DATABASE_URL es obligatoria en el worker');
  const queue = createJobQueue(config, databaseUrl, logger, 'consumer');
  const pool = new Pool({
    connectionString: databaseUrl,
    max: Math.min(config.DATABASE_POOL_MAX, 6),
    connectionTimeoutMillis: config.HEALTH_CHECK_TIMEOUT_MS,
    application_name: 'finance-worker',
  });
  pool.on('error', (err) =>
    logger.warn({ err: { type: err.name, message: err.message } }, 'idle database client error'),
  );
  const storage = createObjectStorageClient(config);
  const probe = new ReadinessProbe(
    [postgresCheck(pool), objectStorageCheck(storage, config.OBJECT_STORAGE_BUCKET)],
    config.HEALTH_CHECK_TIMEOUT_MS,
    (dependency, error) =>
      logger.warn(
        { dependency, err: { type: error instanceof Error ? error.name : typeof error } },
        'readiness check failed',
      ),
  );

  const context = await NestFactory.createApplicationContext(
    WorkerModule.register({
      queue,
      logger,
      pool,
      concurrency: config.WORKER_CONCURRENCY,
      diagnostics: config.PFOS_ENV === 'local' || config.PFOS_ENV === 'ci',
    }),
    { logger: new PinoNestLogger(logger), abortOnError: false },
  );

  const ledgerMaintenance = createLedgerMaintenance({
    pool,
    clock: options.clock ?? systemClock,
    logger,
    metrics: otelCounters('@pf/ledger'),
  });

  // Job diario del ledger: verificador de invariantes + snapshots (add-ledger-core 5.6). Corre también al arrancar,
  // así `restore:local` (que reinicia el worker) verifica el ledger restaurado.
  const closings: { verifier?: ClosingVerifier } = {};
  const activeWorkspaces = identityActiveWorkspaces(pool);
  const auditMetrics = otelCounters('@pf/audit');
  await registerLedgerDailyJob(queue, ledgerMaintenance, logger, {
    cron: config.LEDGER_INTEGRITY_CRON,
    tz: config.LEDGER_INTEGRITY_CRON_TZ,
    runOnStart: options.ledgerMaintenanceOnStart ?? true,
    afterIntegrity: async () => {
      await verifyLifecycleConsistency(pool, activeWorkspaces, logger, auditMetrics);
      // add-month-closing decisión 14: snapshot vigente ↔ ledger, hash y bloqueo por periodo cerrado.
      if (closings.verifier) await runVerifyClosings(closings.verifier, activeWorkspaces, logger);
    },
  });
  await registerLifecycleBackfillJob(queue, createLifecycleBackfill(pool), activeWorkspaces, logger, {
    runOnStart: options.lifecycleBackfillOnStart ?? true,
  });

  // Providers de tasas de mercado (add-market-rate-providers): polling, carga histórica y relleno; la configuración
  // inválida o `none` no impide arrancar el worker (degradación).
  const fxClock = options.clock ?? systemClock;
  // Tests: servidor HTTP local en proceso; E2E: providers simulados por `FX_PROVIDER_*_URL` (solo local/ci).
  const fxEndpoints = options.fxEndpoints ?? fxEndpointsFromConfig(config);
  const fxOutbox = new PgOutboxWriter(eventSchemaRegistry());
  const fxConsumers = await registerFxMarketRateJobs(
    queue,
    createFxMarketRateJobs({
      pool,
      clock: fxClock,
      outbox: {
        append: async (event) => {
          await fxOutbox.append(event);
        },
      },
      workspaces: activeWorkspaces,
      settings: parseFxProviderSettings(config),
      ...(fxEndpoints ? { endpoints: fxEndpoints } : {}),
    }),
    logger,
    { gapFillOnStart: options.fxGapFillOnStart ?? true },
  );

  // Datos de demostración (add-demo-data): carga por casos de uso (`demo.load`) y purga acotada (`demo.purge`).
  const demoAudit = createAuditRuntime({
    pool,
    clock: systemClock,
    policies: AUDIT_POLICIES,
    timeZones: identityWorkspaceTimeZones(pool),
  });
  const demo = createDemoDataRuntime({
    pool,
    clock: options.clock ?? systemClock,
    outbox: outboxPort(fxOutbox),
    audit: demoAudit.port,
    defaults: {
      baseCurrency: config.APP_REPORTING_CURRENCY,
      timeZone: config.APP_TIMEZONE,
      locale: config.APP_DEFAULT_LOCALE,
      personalWorkspaceName: 'Personal',
    },
    // En el worker la habilitación no aplica (solo la API crea demos); la cola sí: la purga se encola desde la API.
    demo: demoDataOptions({ PFOS_ENV: config.PFOS_ENV, DEMO_DATA_ENABLED: false }, queue),
  });
  await registerDemoJobs(queue, {
    demo,
    logger,
    loader: new DemoDataLoader({
      pool,
      logger,
      demo,
      config,
      ledgerMaintenance,
      ...(options.demoFailAt ? { failAt: options.demoFailAt } : {}),
    }),
  });

  const rateValidityWindowDays = config.REPORTING_RATE_VALIDITY_WINDOW ?? DEFAULT_RATE_VALIDITY_WINDOW_DAYS;
  // PLANNING (add-financial-periods): job horario `planning.ensure-periods` + consumidores de IDENTITY y LEDGER. El
  // calendario de cada workspace se lee con el rol de directorio (pf_worker no ve iam.workspace por membresía).
  // Solo lectura del ledger para el verificador de cierres (rol pf_worker, miembro de pf_app).
  const closingLedger = createLedgerRuntime({
    pool,
    clock: options.clock ?? systemClock,
    audit: demoAudit.port,
    outbox: fxOutbox,
    logger,
  });
  const closingLedgerPorts = { balances: closingLedger.accountBalances, ledger: closingLedger.posting };
  const planning = createPlanningRuntime({
    pool,
    clock: options.clock ?? systemClock,
    audit: demoAudit.port,
    lifecycle: demoAudit.lifecycle,
    outbox: outboxPort(fxOutbox),
    calendar: identityWorkspaceCalendarDirectory(pool),
    activity: ledgerActivityRange(),
    lookahead: config.PLANNING_PERIOD_LOOKAHEAD,
    closePendingDelayDays: config.PLANNING_CLOSE_PENDING_DELAY_DAYS,
    verification: {
      ...closingLedgerPorts,
      metrics: otelCounters('@pf/planning'),
    },
    // add-budgets: el consumidor de umbrales lee la fuente de verdad con la MISMA valoración y ventana de vigencia que
    // el Home (`REPORTING_RATE_VALIDITY_WINDOW`, docs/31 D53 y docs/33 D109).
    budgets: {
      flows: createNominalFlowQuery(pool),
      catalog: createCategoryCatalogQuery({ pool, clock: options.clock ?? systemClock }),
      rates: createFxValuation({
        pool,
        clock: options.clock ?? systemClock,
        windowDays: rateValidityWindowDays,
        providers: parseFxProviderSettings(config),
      }),
      rateValidityWindowDays,
      // add-budget-templates: el hook de creación de periodos crea el plan del predeterminado en la moneda base.
      settings: identityWorkspaceSettingsDirectory(pool),
      calendarCacheMs: 60_000,
    },
  });
  if (planning.verifier) closings.verifier = planning.verifier;
  await registerPlanningPeriodsJob(queue, planning.service, planning.closePending, activeWorkspaces, logger, {
    cron: config.PLANNING_PERIODS_CRON,
    runOnStart: options.planningPeriodsOnStart ?? true,
  });

  const metrics = options.metrics ?? new EventDeliveryMetrics(pool);
  // REPORTING (add-basic-dashboard): versión derivada de los datos por workspace (ETag del resumen del Home).
  const subscriptions = new EventSubscriptions([
    ...(options.eventConsumers ?? []),
    ...fxConsumers,
    reportingDataVersionConsumer(),
    ...planningEventConsumers(planning),
  ]);
  const consumers = new EventConsumerRuntime({ pool, queue, subscriptions, logger, metrics });
  const relay = new OutboxRelay({
    pool,
    queue,
    routes: subscriptions,
    logger,
    metrics,
    listenConnectionString: databaseUrl,
    pollIntervalMs: Math.round(config.JOB_QUEUE_POLLING_INTERVAL_SECONDS * 1000),
    ...options.relay,
  });
  await consumers.start();
  await relay.start();

  let draining = false;
  let health: HealthServer | undefined;
  let closed = false;
  return {
    context,
    queue,
    pool,
    relay,
    consumers,
    subscriptions,
    async listenHealth(port = config.WORKER_HEALTH_PORT, host = config.WORKER_HEALTH_BIND_ADDRESS) {
      health = await startHealthServer({ port, host, probe, isDraining: () => draining });
      logger.info({ port: health.port }, 'worker health listening');
      return health.port;
    },
    async close() {
      if (closed) return;
      closed = true;
      draining = true;
      await relay.stop();
      await queue.drain();
      await context.close();
      await queue.stop();
      await health?.close();
      await pool.end();
      storage.destroy();
      await shutdownTelemetry();
    },
  };
}
