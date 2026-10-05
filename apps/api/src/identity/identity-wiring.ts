import type { ModuleMetadata } from '@nestjs/common';
import {
  AuditModule,
  createAuditRuntime,
  type AuditPort,
  type LifecyclePort,
} from '@pf/audit/interface/audit.module';
import { ACCOUNTS_AUDIT_POLICY } from '@pf/accounts/contracts';
import { ACCOUNT_LIFECYCLE_MACHINE } from '@pf/accounts/interface/accounts.module';
import { CLASSIFICATION_AUDIT_POLICY } from '@pf/classification/contracts';
import {
  ClassificationModule,
  createClassificationRuntime,
} from '@pf/classification/interface/classification.module';
import { FX_AUDIT_POLICY } from '@pf/fx/contracts';
import {
  createFxRuntime,
  EXCHANGE_RATE_LIFECYCLE_MACHINE,
  FxModule,
  parseFxProviderSettings,
} from '@pf/fx/interface/fx.module';
import { IDENTITY_AUDIT_POLICY } from '@pf/identity/contracts';
import {
  IdentityModule,
  identityUserLocales,
  identityWorkspaceSettings,
  identityWorkspaceTimeZones,
  type DemoDataOptions,
  type OutboxPort,
} from '@pf/identity/interface/identity.module';
import { JWKS_METRICS, type JwksObserver, type JwtVerifierOptions } from '@pf/platform/api';
import { otelCounters, type CounterMetrics } from '@pf/platform/otel';
import { demoDataEnabled, type ApiConfig } from '@pf/platform/config';
import type { JobQueue } from '@pf/platform/queue';
import { DEMO_MANIFEST } from '../demo/dataset/demo-plan.js';
import { demoJobsPort } from '../demo/demo-jobs-port.js';
import { PgOutboxWriter, type OutboxWriter } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import type { ApiConventionsOptions } from '@pf/platform/nest';
import { createReportingRuntime, ReportingModule } from '@pf/reporting/interface/reporting.module';
import {
  createTransactionsRuntime,
  TRANSACTION_LIFECYCLE_MACHINE,
  TransactionsModule,
} from '@pf/transactions/interface/transactions.module';
import { TRANSACTIONS_AUDIT_POLICY, type CounterpartyCategoryUsageQuery } from '@pf/transactions/contracts';
import type { AuditHistoryQuery } from '@pf/audit/contracts';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { eventSchemaRegistry } from '../runtime/event-contracts.js';
import { accountsImports, accountsRuntime } from '../accounts/accounts-wiring.js';
import { LedgerHttpModule } from '../ledger/ledger-http.js';
import { workspaceCreatedHook } from './workspace-provisioning.js';

/**
 * Logs y métricas del JWKS remoto (add-workspace-identity design §3): refetch fallido ⇒ `warn` (o `error` si ya no
 * queda JWKS de respaldo) + `pf.auth.jwks_refresh_failures`; token verificado con el JWKS de respaldo ⇒
 * `pf.auth.jwks_fallback`.
 */
export function jwksObserver(
  logger: Pick<Logger, 'warn' | 'error'>,
  counters: CounterMetrics = otelCounters('pfos.identity'),
): JwksObserver {
  return {
    refreshFailed: ({ error, fallbackAgeMs }) => {
      counters.increment(JWKS_METRICS.refreshFailures, { fallback: String(fallbackAgeMs !== null) });
      if (fallbackAgeMs === null) {
        logger.error(
          { err: error },
          'JWKS del IdP no disponible y sin JWKS de respaldo vigente: tokens rechazados',
        );
      } else {
        logger.warn(
          { err: error, fallbackAgeSeconds: Math.round(fallbackAgeMs / 1000) },
          'JWKS del IdP no disponible: se usa el último JWKS conocido',
        );
      }
    },
    fallbackUsed: () => counters.increment(JWKS_METRICS.fallback, {}),
  };
}

/** Opciones JWT desde el contrato de configuración (`OIDC_*`); `undefined` si no hay emisor configurado. */
export function jwtOptionsFromConfig(
  config: ApiConfig,
  logger?: Pick<Logger, 'warn' | 'error'>,
): JwtVerifierOptions | undefined {
  if (!config.OIDC_ISSUER_URL) return undefined;
  const issuer = config.OIDC_ISSUER_URL.replace(/\/+$/, '');
  const parties = (config.OIDC_AUTHORIZED_PARTIES ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  return {
    issuer,
    audience: config.OIDC_API_AUDIENCE,
    profile: config.OIDC_PROFILE,
    requiredScope: config.OIDC_REQUIRED_SCOPE,
    clockSkewSeconds: config.OIDC_CLOCK_SKEW_SECONDS,
    ...(parties.length > 0 ? { authorizedParties: parties } : {}),
    jwks: new URL(config.OIDC_JWKS_URI ?? `${issuer}/protocol/openid-connect/certs`),
    jwksFallbackMaxAgeMs: config.OIDC_JWKS_FALLBACK_MAX_AGE,
    ...(logger ? { jwksObserver: jwksObserver(logger) } : {}),
  };
}

/**
 * `OutboxPort` de IDENTITY sobre el outbox transaccional real (openspec add-event-outbox, cierra la tarea 6.3 de
 * add-workspace-identity): el evento se escribe en la transacción de la Unit of Work del caso de uso y se valida
 * contra contracts/events.
 */
export function outboxPort(writer: OutboxWriter = new PgOutboxWriter(eventSchemaRegistry())): OutboxPort {
  return {
    append: async (event) => {
      await writer.append(event);
    },
  };
}

/** `OutboxPort` de CLASSIFICATION (`classification.CategoryArchived.v1`) sobre el outbox transaccional real. */
export function classificationOutbox(writer: OutboxWriter = new PgOutboxWriter(eventSchemaRegistry())): {
  append(event: Parameters<OutboxWriter['append']>[0]): Promise<void>;
} {
  return {
    append: async (event) => {
      await writer.append(event);
    },
  };
}

/** Máquinas de estado del recorrido (add-lifecycle-timeline). */
export const LIFECYCLE_MACHINES = [
  TRANSACTION_LIFECYCLE_MACHINE,
  ACCOUNT_LIFECYCLE_MACHINE,
  EXCHANGE_RATE_LIFECYCLE_MACHINE,
];

/** Allow-lists de redacción de auditoría de cada contexto (add-audit-trail). */
export const AUDIT_POLICIES = [
  IDENTITY_AUDIT_POLICY,
  CLASSIFICATION_AUDIT_POLICY,
  ACCOUNTS_AUDIT_POLICY,
  TRANSACTIONS_AUDIT_POLICY,
  FX_AUDIT_POLICY,
];

/**
 * Composición de AUDIT (openspec add-audit-trail): `AuditPort` sobre `audit.audit_log` en la misma transacción que
 * cada comando, con las allow-lists de redacción de cada contexto y la zona horaria del workspace de IDENTITY.
 */
export function auditRuntime(input: {
  readonly config: Pick<ApiConfig, 'AUDIT_IP_HMAC_KEY'>;
  readonly pool: Pool;
  readonly conventions: ApiConventionsOptions;
  readonly logger: Logger;
}) {
  if (!input.config.AUDIT_IP_HMAC_KEY) {
    input.logger.warn('AUDIT_IP_HMAC_KEY ausente: clave HMAC de IP efímera (solo local/ci)');
  }
  return createAuditRuntime({
    pool: input.pool,
    clock: input.conventions.clock,
    ...(input.config.AUDIT_IP_HMAC_KEY ? { ipHmacKeys: input.config.AUDIT_IP_HMAC_KEY } : {}),
    policies: AUDIT_POLICIES,
    timeZones: identityWorkspaceTimeZones(input.pool),
    // add-lifecycle-timeline: máquinas de estado declaradas por cada contexto dueño (dato puro, una sola fuente).
    machines: LIFECYCLE_MACHINES,
  });
}

/** Consulta del recorrido (add-lifecycle-timeline) que reciben FX, ACCOUNTS y TRANSACTIONS. */
type FinanceLifecycleQuery = ReturnType<typeof createAuditRuntime>['lifecycleQuery'];

/**
 * Runtimes de los contextos financieros sobre PostgreSQL (CLASSIFICATION, FX, LEDGER + ACCOUNTS, TRANSACTIONS,
 * REPORTING) con sus puertos públicos cableados. Lo usan la API y el cargador de datos demo del worker (add-demo-data:
 * MISMOS casos de uso que la operación real).
 */
export function financeRuntimes(input: {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery: FinanceLifecycleQuery;
  readonly history: AuditHistoryQuery;
  readonly logger: Logger;
  readonly config: Pick<ApiConfig, 'APP_TIMEZONE'> & Parameters<typeof parseFxProviderSettings>[0];
  readonly outbox?: OutboxWriter;
}) {
  const writer = input.outbox ?? new PgOutboxWriter(eventSchemaRegistry());
  // CLASSIFICATION (add-classification): provisión síncrona de categorías al crear workspaces (design §6) + API.
  // La sugerencia `LAST_USED` lee el historial de TRANSACTIONS, que se compone después (depende del validador de
  // CLASSIFICATION): referencia diferida a su query pública.
  const deferred: { categoryUsage?: CounterpartyCategoryUsageQuery } = {};
  const classification = createClassificationRuntime({
    pool: input.pool,
    clock: input.clock,
    outbox: classificationOutbox(writer),
    audit: input.audit,
    locales: identityUserLocales(input.pool),
    lastCategoryUsed: {
      lastCategoryUsed: (query) => deferred.categoryUsage?.lastCategoryUsed(query) ?? Promise.resolve(null),
    },
  });
  // FX (add-manual-conversions): catálogo, tasas manuales y pricing de conversiones; moneda de reporte de IDENTITY.
  const fx = createFxRuntime({
    pool: input.pool,
    clock: input.clock,
    audit: input.audit,
    lifecycle: input.lifecycle,
    lifecycleQuery: input.lifecycleQuery,
    outbox: classificationOutbox(writer),
    workspaces: identityWorkspaceSettings(input.pool),
    // add-market-rate-providers: roles, obsolescencia y umbral de anomalía (la API nunca llama a un provider).
    providers: parseFxProviderSettings(input.config),
  });
  // ACCOUNTS (add-accounts-management).
  const { accounts, ledger } = accountsRuntime({
    pool: input.pool,
    clock: input.clock,
    audit: input.audit,
    lifecycle: input.lifecycle,
    lifecycleQuery: input.lifecycleQuery,
    logger: input.logger,
    defaultTimeZone: input.config.APP_TIMEZONE,
    outbox: writer,
    // Equivalente en moneda base con el puerto público de valoración de FX (misma semántica que Reporting).
    valuation: { rates: fx.valuation, workspaces: identityWorkspaceSettings(input.pool) },
    // docs/31 D45: la moneda de una cuenta debe estar habilitada en el workspace (`fx.workspace_currency`).
    workspaceCurrencies: fx.valuation,
  });
  // TRANSACTIONS (add-transaction-recording): ledger/accounts/classification/fx vía sus puertos públicos.
  const transactions = createTransactionsRuntime({
    pool: input.pool,
    clock: input.clock,
    audit: input.audit,
    lifecycle: input.lifecycle,
    lifecycleQuery: input.lifecycleQuery,
    history: input.history,
    outbox: classificationOutbox(writer),
    ledger: ledger.posting,
    accounts: accounts.query,
    classification: classification.validator,
    lookup: classification.lookup,
    fx: fx.pricing,
  });
  deferred.categoryUsage = transactions.categoryUsage;
  // REPORTING (add-basic-dashboard): lectura directa de la fuente de verdad vía contratos públicos.
  const reporting = createReportingRuntime({
    pool: input.pool,
    clock: input.clock,
    workspaces: identityWorkspaceSettings(input.pool),
    accounts: accounts.catalog,
    balances: ledger.accountBalances,
    flows: transactions.flows,
    categories: classification.categories,
    rates: fx.valuation,
  });
  return { classification, fx, accounts, ledger, transactions, reporting };
}

/**
 * Contextos de negocio montados en `/api/v1`: IDENTITY (guard global de autenticación/autorización) y AUDIT
 * (`/audit-log`). Sin emisor OIDC (solo local/ci) no hay autenticación posible y no se monta ninguno.
 */
export function identityImports(input: {
  readonly config: ApiConfig;
  readonly pool: Pool;
  readonly conventions: ApiConventionsOptions;
  readonly logger: Logger;
  readonly jwt?: JwtVerifierOptions;
  /** Sustituye el `AuditPort` (tests de atomicidad con fallos inyectados). */
  readonly audit?: (port: AuditPort) => AuditPort;
  /** Sustituye el `LifecyclePort` (tests de atomicidad del registro de transición, TC-AUDIT-LIFECYCLE-002). */
  readonly lifecycle?: (port: LifecyclePort) => LifecyclePort;
  /** Cola de jobs (add-demo-data: `demo.load`/`demo.purge` encolados en la transacción del comando). */
  readonly queue?: JobQueue;
}): NonNullable<ModuleMetadata['imports']> {
  const jwt = input.jwt ?? jwtOptionsFromConfig(input.config, input.logger);
  if (!jwt) {
    input.logger.warn(
      'OIDC_ISSUER_URL ausente: rutas /api/v1/me, /api/v1/workspaces y /audit-log no montadas (solo local/ci)',
    );
    return [];
  }
  const audit = auditRuntime(input);
  const auditPort = input.audit ? input.audit(audit.port) : audit.port;
  // Recorrido (add-lifecycle-timeline): auditoría (posiblemente envuelta) + transición en la misma unidad de trabajo.
  const lifecyclePort = input.lifecycle
    ? input.lifecycle(audit.lifecycleFor(auditPort))
    : audit.lifecycleFor(auditPort);
  const { classification, fx, accounts, ledger, transactions, reporting } = financeRuntimes({
    pool: input.pool,
    clock: input.conventions.clock,
    audit: auditPort,
    lifecycle: lifecyclePort,
    lifecycleQuery: audit.lifecycleQuery,
    history: audit.history,
    logger: input.logger,
    config: input.config,
  });
  return [
    IdentityModule.register({
      pool: input.pool,
      clock: input.conventions.clock,
      conventions: input.conventions,
      jwt,
      defaults: {
        baseCurrency: input.config.APP_REPORTING_CURRENCY,
        timeZone: input.config.APP_TIMEZONE,
        locale: input.config.APP_DEFAULT_LOCALE,
        personalWorkspaceName: 'Personal',
      },
      outbox: outboxPort(),
      audit: auditPort,
      // Provisión síncrona en la transacción de CreateWorkspace: categorías (classification) y monedas (fx).
      onWorkspaceCreated: workspaceCreatedHook({ classification, fx }),
      // add-demo-data: "Cargar/Limpiar datos de demostración" (DEMO_DATA_ENABLED, docs/31 D41).
      ...(input.queue ? { demo: demoDataOptions(input.config, input.queue) } : {}),
    }),
    AuditModule.register({ runtime: audit, conventions: input.conventions }),
    ClassificationModule.register({ runtime: classification, conventions: input.conventions }),
    // ACCOUNTS — openspec add-accounts-management.
    ...accountsImports({ runtime: accounts, conventions: input.conventions }),
    // LEDGER: solo la vista técnica de balance de comprobación (add-ledger-core 6.3, docs/31 D44).
    LedgerHttpModule.register({ balances: ledger.balances, conventions: input.conventions }),
    TransactionsModule.register({ runtime: transactions, conventions: input.conventions }),
    FxModule.register({ runtime: fx, conventions: input.conventions }),
    ReportingModule.register({ runtime: reporting, conventions: input.conventions }),
  ];
}

/** Opciones de datos de demostración de IDENTITY desde la configuración y la cola (add-demo-data). */
export function demoDataOptions(
  config: Pick<ApiConfig, 'PFOS_ENV'> & { readonly DEMO_DATA_ENABLED?: boolean | undefined },
  queue: JobQueue,
): DemoDataOptions {
  return {
    settings: {
      enabled: demoDataEnabled(config),
      datasetVersion: DEMO_MANIFEST.datasetVersion,
      workspaceName: DEMO_MANIFEST.workspaceName,
      modules: DEMO_MANIFEST.modules,
    },
    jobs: demoJobsPort(queue),
  };
}
