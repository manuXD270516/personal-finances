import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { WorkerConfig } from '@pf/platform/config';
import {
  EventConsumerRuntime,
  EventDeliveryMetrics,
  EventSubscriptions,
  OutboxRelay,
  assertConsumerConnectionBudget,
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
  commitmentsEventConsumers,
  createCommitmentsRuntime,
} from '@pf/commitments/interface/commitments.module';
import { createImportsRuntime, importsEventConsumers } from '@pf/imports/interface/imports.module';
import {
  createDemoDataRuntime,
  createPortabilityRuntime,
  identityActiveWorkspaces,
  identityWorkspaceRecipients,
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
import {
  createEmailSender,
  createNotificationsWorkerRuntime,
  notificationEventConsumers,
} from '@pf/notifications/interface/notifications.module';
import type { EmailSender } from '@pf/notifications/interface/notifications.module';
import { PinoNestLogger } from '@pf/platform/nest';
import { reportingDataVersionConsumer } from '@pf/reporting/interface/reporting.module';
import { otelCounters, otelHistograms, shutdownTelemetry } from '@pf/platform/otel';
import type { JobQueue } from '@pf/platform/queue';
import { createObjectStorageClient } from '@pf/platform/storage';
import { systemClock, type Clock } from '@pf/shared-kernel';
import { Pool } from 'pg';
import { eventSchemaRegistry } from '../runtime/event-contracts.js';
import { createJobQueue } from '../runtime/platform-resources.js';
import { registerLifecycleBackfillJob, verifyLifecycleConsistency } from './audit-jobs.js';
import { fxEndpointsFromConfig, registerFxMarketRateJobs } from './fx-jobs.js';
import { registerLedgerDailyJob } from './ledger-jobs.js';
import { registerCommitmentsJob, registerSubscriptionsJob } from './commitments-jobs.js';
import { registerImportsJobs } from './imports-jobs.js';
import { registerNotificationsJobs } from './notifications-jobs.js';
import { registerPlanningPeriodsJob } from './planning-jobs.js';
import { registerDemoJobs } from './demo-jobs.js';
import { registerPortabilityJobs } from './portability-jobs.js';
import { portabilityOptions } from '../portability/portability-wiring.js';
import { DemoDataLoader } from '../demo/demo-data-loader.js';
import {
  AUDIT_POLICIES,
  counterpartyNamesOf,
  importsSettingsFrom,
  demoDataOptions,
  financeRuntimes,
  financialPeriodPort,
  outboxPort,
} from '../identity/identity-wiring.js';
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
  /** add-workspace-export: ganchos de prueba (pausa tras tomar la instantánea) y barrido programado de retención. */
  readonly portability?: {
    readonly afterSnapshot?: () => Promise<void>;
    readonly scheduleCrons?: boolean;
  };
  /** Encola `planning.ensure-periods` al arrancar (por defecto sí; add-financial-periods). */
  readonly planningPeriodsOnStart?: boolean;
  /** Encola `commitments.generate-occurrences` al arrancar (por defecto sí; add-recurrence-engine). */
  readonly commitmentsOnStart?: boolean;
  /** Encola `imports.expire-reviews` e `imports.purge-staging` al arrancar (por defecto sí; add-basic-csv-import). */
  readonly importsOnStart?: boolean;
  /** Tests (add-alerts): sustituye el adaptador de email (por defecto, el de `EMAIL_DRIVER`). */
  readonly emailSender?: EmailSender;
  /** Tests (add-alerts): backoff y lease del despacho de email, y barridos periódicos. */
  readonly notifications?: {
    readonly backoffMs?: readonly number[];
    readonly leaseMs?: number;
    /** Programa los barridos de entregas y la purga (por defecto sí). */
    readonly scheduleCrons?: boolean;
    /** Encola un barrido de entregas pendientes al arrancar (por defecto sí). */
    readonly sweepOnStart?: boolean;
  };
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
    max: config.DATABASE_POOL_MAX,
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

  // Exportación/importación del workspace (add-workspace-export): sin llavero de claves maestras no se registran los jobs.
  const portability = portabilityOptions({
    storage,
    bucket: config.OBJECT_STORAGE_EXPORTS_BUCKET,
    keys: config.EXPORT_ENCRYPTION_KEYS,
    activeKeyId: config.EXPORT_ENCRYPTION_ACTIVE_KEY_ID,
    retentionMs: config.EXPORT_RETENTION,
    // Solo la API aplica la re-autenticación y el tope de subida; el worker no los usa.
    reauthMaxAgeMs: 600_000,
    maxImportBytes: 209_715_200,
    defaultLocale: config.APP_DEFAULT_LOCALE,
    queue,
    pool,
    ...(options.portability?.afterSnapshot
      ? { builderOverride: { afterSnapshot: options.portability.afterSnapshot } }
      : {}),
  });
  if (portability) {
    const runtime = createPortabilityRuntime({
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
      portability,
    });
    await registerPortabilityJobs(queue, {
      exports: runtime.exports,
      imports: runtime.imports,
      logger,
      ...(options.portability?.scheduleCrons !== undefined
        ? { scheduleCrons: options.portability.scheduleCrons }
        : {}),
    });
  } else {
    logger.warn('EXPORT_ENCRYPTION_KEYS ausente: exportar e importar el workspace está deshabilitado');
  }

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

  // COMMITMENTS (add-recurrence-engine): job `commitments.generate-occurrences` y consumidor de transacciones anuladas.
  // La creación automática usa los MISMOS casos de uso de TRANSACTIONS que la API (puertos públicos), compuestos con el
  // pool del worker (`pf_worker`, miembro de `pf_app`).
  const finance = financeRuntimes({
    pool,
    clock: options.clock ?? systemClock,
    audit: demoAudit.port,
    lifecycle: demoAudit.lifecycle,
    lifecycleQuery: demoAudit.lifecycleQuery,
    history: demoAudit.history,
    logger,
    config,
    outbox: fxOutbox,
  });
  const commitments = createCommitmentsRuntime({
    pool,
    clock: options.clock ?? systemClock,
    audit: demoAudit.port,
    lifecycle: demoAudit.lifecycle,
    lifecycleQuery: demoAudit.lifecycleQuery,
    outbox: outboxPort(fxOutbox),
    calendar: identityWorkspaceCalendarDirectory(pool),
    settings: identityWorkspaceSettingsDirectory(pool),
    periods: financialPeriodPort(planning.periodQuery),
    accounts: finance.accounts.query,
    accountCatalog: finance.accounts.catalog,
    classification: finance.classification.validator,
    rates: finance.fx.valuation,
    transactions: finance.transactions.recurring,
    links: finance.transactions.links,
    pending: finance.transactions.pending,
    counterpartyNames: counterpartyNamesOf(finance.classification.counterparties),
    horizonDays: config.COMMITMENTS_HORIZON_DAYS,
    rateValidityWindowDays,
    counters: otelCounters('@pf/commitments'),
    histograms: otelHistograms('@pf/commitments'),
  });
  await registerCommitmentsJob(queue, commitments.generate, activeWorkspaces, logger, {
    cron: config.COMMITMENTS_SCHEDULER_CRON,
    runOnStart: options.commitmentsOnStart ?? true,
  });
  await registerSubscriptionsJob(queue, commitments.subscriptionDaily, activeWorkspaces, logger, {
    cron: config.COMMITMENTS_SUBSCRIPTIONS_CRON,
    runOnStart: options.commitmentsOnStart ?? true,
  });

  // IMPORTS (add-basic-csv-import): consumidor `imports.persist` (crea las transacciones por lotes con los MISMOS casos
  // de uso de TRANSACTIONS que la API, vía su contrato público) y jobs diarios de expiración y purga del staging.
  const imports = createImportsRuntime({
    pool,
    clock: options.clock ?? systemClock,
    audit: demoAudit.port,
    outbox: outboxPort(fxOutbox),
    calendar: identityWorkspaceCalendarDirectory(pool),
    accounts: finance.accounts.query,
    balances: finance.ledger.accountBalances,
    periods: planning.periodQuery,
    transactions: {
      imported: finance.transactions.imported,
      duplicateCandidates: finance.transactions.duplicateCandidates,
      statuses: finance.transactions.statuses,
    },
    settings: importsSettingsFrom(config),
  });
  await registerImportsJobs(queue, imports.maintenance, activeWorkspaces, logger, {
    cron: config.IMPORT_MAINTENANCE_CRON,
    runOnStart: options.importsOnStart ?? true,
  });

  // NOTIFY (add-alerts): consumidores de `planning.BudgetThresholdReached.v1` y `planning.MonthClosePending.v1`, despacho
  // del email (adaptador por EMAIL_DRIVER: smtp → Mailpit en local/CI, none → solo in-app), barrido y purga. La cola de
  // despacho se crea antes de arrancar los consumidores: estos encolan en la transacción de la notificación.
  const notificationsClock = options.clock ?? systemClock;
  const emailDriver = config.EMAIL_DRIVER ?? 'none';
  const notifications = createNotificationsWorkerRuntime({
    pool,
    clock: notificationsClock,
    queue,
    logger,
    recipients: identityWorkspaceRecipients(pool),
    catalog: createCategoryCatalogQuery({ pool, clock: notificationsClock }),
    sender:
      options.emailSender ??
      createEmailSender({
        driver: emailDriver,
        ...(emailDriver === 'smtp' && config.SMTP_HOST
          ? {
              smtp: {
                host: config.SMTP_HOST,
                port: config.SMTP_PORT,
                secure: config.SMTP_SECURE,
                user: config.SMTP_USER,
                password: config.SMTP_PASSWORD,
                from: config.EMAIL_FROM,
              },
            }
          : {}),
      }),
    counters: otelCounters('@pf/notifications'),
    histograms: otelHistograms('@pf/notifications'),
    appPublicUrl: config.APP_PUBLIC_URL,
    emailFrom: config.EMAIL_FROM,
    maxAttempts: config.NOTIFY_EMAIL_MAX_ATTEMPTS,
    retentionMonths: config.NOTIFY_RETENTION,
    ...(options.notifications?.backoffMs ? { backoffMs: options.notifications.backoffMs } : {}),
    ...(options.notifications?.leaseMs ? { leaseMs: options.notifications.leaseMs } : {}),
  });
  await registerNotificationsJobs(queue, {
    dispatch: notifications.dispatch,
    purge: notifications.purge,
    workspaces: activeWorkspaces,
    logger,
    ...(options.notifications?.scheduleCrons !== undefined
      ? { scheduleCrons: options.notifications.scheduleCrons }
      : {}),
    ...(options.notifications?.sweepOnStart !== undefined
      ? { sweepOnStart: options.notifications.sweepOnStart }
      : {}),
  });

  const metrics = options.metrics ?? new EventDeliveryMetrics(pool);
  // REPORTING (add-basic-dashboard): versión derivada de los datos por workspace (ETag del resumen del Home).
  const subscriptions = new EventSubscriptions([
    ...(options.eventConsumers ?? []),
    ...fxConsumers,
    reportingDataVersionConsumer(),
    ...planningEventConsumers(planning),
    ...commitmentsEventConsumers(commitments),
    ...importsEventConsumers(imports, logger),
    ...notificationEventConsumers(notifications),
  ]);
  // Presupuesto de conexiones (improve-event-throughput, TC-PLATFORM-EVENTS-018): la concurrencia sumada de los
  // consumidores cabe en el pool del worker; si no, el arranque falla antes de tomar un solo evento.
  const consumerDefaults = {
    concurrency: config.EVENT_CONSUMER_CONCURRENCY,
    batchSize: config.EVENT_CONSUMER_BATCH_SIZE,
  };
  try {
    assertConsumerConnectionBudget({
      consumers: subscriptions.definitions(),
      defaults: consumerDefaults,
      poolMax: config.DATABASE_POOL_MAX,
    });
  } catch (err) {
    await queue.stop().catch(() => undefined);
    await context.close().catch(() => undefined);
    await pool.end().catch(() => undefined);
    storage.destroy();
    throw err;
  }
  const consumers = new EventConsumerRuntime({
    pool,
    queue,
    subscriptions,
    logger,
    metrics,
    ...consumerDefaults,
  });
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
