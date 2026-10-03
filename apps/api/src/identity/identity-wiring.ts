import type { ModuleMetadata } from '@nestjs/common';
import { AuditModule, createAuditRuntime, type AuditPort } from '@pf/audit/interface/audit.module';
import { ACCOUNTS_AUDIT_POLICY } from '@pf/accounts/contracts';
import { CLASSIFICATION_AUDIT_POLICY } from '@pf/classification/contracts';
import {
  ClassificationModule,
  createClassificationRuntime,
} from '@pf/classification/interface/classification.module';
import { FX_AUDIT_POLICY } from '@pf/fx/contracts';
import { createFxRuntime, FxModule, parseFxProviderSettings } from '@pf/fx/interface/fx.module';
import { IDENTITY_AUDIT_POLICY } from '@pf/identity/contracts';
import {
  IdentityModule,
  identityUserLocales,
  identityWorkspaceSettings,
  identityWorkspaceTimeZones,
  type OutboxPort,
} from '@pf/identity/interface/identity.module';
import type { JwtVerifierOptions } from '@pf/platform/api';
import type { ApiConfig } from '@pf/platform/config';
import { PgOutboxWriter, type OutboxWriter } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import type { ApiConventionsOptions } from '@pf/platform/nest';
import { createReportingRuntime, ReportingModule } from '@pf/reporting/interface/reporting.module';
import {
  createTransactionsRuntime,
  TransactionsModule,
} from '@pf/transactions/interface/transactions.module';
import { TRANSACTIONS_AUDIT_POLICY } from '@pf/transactions/contracts';
import type { Pool } from 'pg';
import { eventSchemaRegistry } from '../runtime/event-contracts.js';
import { accountsImports, accountsRuntime } from '../accounts/accounts-wiring.js';

/** Opciones JWT desde el contrato de configuración (`OIDC_*`); `undefined` si no hay emisor configurado. */
export function jwtOptionsFromConfig(config: ApiConfig): JwtVerifierOptions | undefined {
  if (!config.OIDC_ISSUER_URL) return undefined;
  const issuer = config.OIDC_ISSUER_URL.replace(/\/+$/, '');
  return {
    issuer,
    audience: config.OIDC_API_AUDIENCE,
    requiredScope: config.OIDC_REQUIRED_SCOPE,
    clockSkewSeconds: config.OIDC_CLOCK_SKEW_SECONDS,
    jwks: new URL(config.OIDC_JWKS_URI ?? `${issuer}/protocol/openid-connect/certs`),
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
    policies: [
      IDENTITY_AUDIT_POLICY,
      CLASSIFICATION_AUDIT_POLICY,
      ACCOUNTS_AUDIT_POLICY,
      TRANSACTIONS_AUDIT_POLICY,
      FX_AUDIT_POLICY,
    ],
    timeZones: identityWorkspaceTimeZones(input.pool),
  });
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
}): NonNullable<ModuleMetadata['imports']> {
  const jwt = input.jwt ?? jwtOptionsFromConfig(input.config);
  if (!jwt) {
    input.logger.warn(
      'OIDC_ISSUER_URL ausente: rutas /api/v1/me, /api/v1/workspaces y /audit-log no montadas (solo local/ci)',
    );
    return [];
  }
  const audit = auditRuntime(input);
  const auditPort = input.audit ? input.audit(audit.port) : audit.port;
  // CLASSIFICATION (add-classification): provisión síncrona de categorías al crear workspaces (design §6) + API.
  const classification = createClassificationRuntime({
    pool: input.pool,
    clock: input.conventions.clock,
    outbox: classificationOutbox(),
    audit: auditPort,
    locales: identityUserLocales(input.pool),
  });
  // ACCOUNTS (add-accounts-management).
  const { accounts, ledger } = accountsRuntime({
    pool: input.pool,
    clock: input.conventions.clock,
    audit: auditPort,
    logger: input.logger,
    defaultTimeZone: input.config.APP_TIMEZONE,
  });
  // FX (add-manual-conversions): catálogo, tasas manuales y pricing de conversiones; moneda de reporte de IDENTITY.
  const fx = createFxRuntime({
    pool: input.pool,
    clock: input.conventions.clock,
    audit: auditPort,
    outbox: classificationOutbox(),
    workspaces: identityWorkspaceSettings(input.pool),
    // add-market-rate-providers: roles, obsolescencia y umbral de anomalía (la API nunca llama a un provider).
    providers: parseFxProviderSettings(input.config),
  });
  // TRANSACTIONS (add-transaction-recording): ledger/accounts/classification/fx vía sus puertos públicos.
  const transactions = createTransactionsRuntime({
    pool: input.pool,
    clock: input.conventions.clock,
    audit: auditPort,
    history: audit.history,
    outbox: classificationOutbox(),
    ledger: ledger.posting,
    accounts: accounts.query,
    classification: classification.validator,
    lookup: classification.lookup,
    fx: fx.pricing,
  });
  // REPORTING (add-basic-dashboard): lectura directa de la fuente de verdad vía contratos públicos.
  const reporting = createReportingRuntime({
    pool: input.pool,
    clock: input.conventions.clock,
    workspaces: identityWorkspaceSettings(input.pool),
    accounts: accounts.catalog,
    balances: ledger.accountBalances,
    flows: transactions.flows,
    categories: classification.categories,
    rates: fx.valuation,
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
      onWorkspaceCreated: {
        onWorkspaceCreated: async (created) => {
          await classification.provisioner.onWorkspaceCreated(created);
          await fx.provisioner.onWorkspaceCreated(created);
        },
      },
    }),
    AuditModule.register({ runtime: audit, conventions: input.conventions }),
    ClassificationModule.register({ runtime: classification, conventions: input.conventions }),
    // ACCOUNTS (+ LEDGER sin HTTP) — openspec add-accounts-management.
    ...accountsImports({ runtime: accounts, conventions: input.conventions }),
    TransactionsModule.register({ runtime: transactions, conventions: input.conventions }),
    FxModule.register({ runtime: fx, conventions: input.conventions }),
    ReportingModule.register({ runtime: reporting, conventions: input.conventions }),
  ];
}
