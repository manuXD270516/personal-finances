import { Module, type DynamicModule } from '@nestjs/common';
import type { AccountsQueryPort } from '@pf/accounts/contracts';
import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import type { AccountBalancesQuery } from '@pf/ledger/contracts';
import type { PeriodQuery } from '@pf/planning/contracts';
import { pgExistingIds, runWithRequestContext } from '@pf/platform/api';
import type { EventConsumerDefinition } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import { DomainError, type Clock } from '@pf/shared-kernel';
import type {
  DuplicateCandidatesQuery,
  ImportedConversionsCommand,
  ImportedTransactionsCommand,
  TransactionStatusQuery,
} from '@pf/transactions/contracts';
import type { Pool } from 'pg';
import { ConnectionHooks } from '../application/banking/connection-hooks.js';
import { ConnectionJobs } from '../application/banking/connection-jobs.js';
import { ConnectionsService } from '../application/banking/connections.service.js';
import { CredentialVault } from '../application/banking/credential-vault.js';
import type {
  BankingDeps,
  BankingProvider,
  ConnectionJobQueue,
  ConnectionSettings,
  ProviderAdapters,
} from '../application/banking/ports.js';
import { ImportsMaintenanceService } from '../application/imports-maintenance.service.js';
import { ImportsQueries } from '../application/imports.queries.js';
import { ImportsService } from '../application/imports.service.js';
import { PersistImportService } from '../application/persist-import.service.js';
import { ProcessImportService } from '../application/process-import.service.js';
import { ProfilesService } from '../application/profiles.service.js';
import { RevertImportService } from '../application/revert-import.service.js';
import type {
  AccountsPort,
  BalancePort,
  CounterpartyResolverPort,
  CalendarPort,
  ClosedPeriodsPort,
  DocumentSourcePort,
  ImportsDeps,
  ImportsSettings,
  InstitutionOfAccountPort,
  OccurrenceLinkingPort,
  OccurrenceMatchingPort,
  PersistTimings,
  OutboxPort,
  ReferenceCatalogPort,
  RulesEvaluationPort,
  SystemCategoriesPort,
} from '../application/ports/index.js';
import {
  IMPORTS_CONSUMERS,
  IMPORTS_EXPIRE_JOB,
  IMPORTS_EVENTS,
  IMPORTS_PURGE_JOB,
  type ImportJobExistenceQuery,
} from '../contracts/index.js';
import {
  PgImportJobRepository,
  PgImportsUnitOfWork,
  PgRowLinkRepository,
  PgStagingRepository,
  pgCurrencyCatalog,
  uuidV7Ids,
} from '../infrastructure/pg-imports.js';
import { PgMappingProfileRepository } from '../infrastructure/pg-mapping-profiles.js';
import { PROVIDER_DESCRIPTORS } from '../infrastructure/banking/descriptors.js';
import {
  FAKE_HOST,
  FAKE_EXCHANGE_FILE_DESCRIPTOR,
  FakeExchangeBackend,
  FakeExchangeFileProvider,
  FakeExchangeProvider,
  sampleRecords,
} from '../infrastructure/banking/fake-exchange.js';
import {
  AllowlistedProviderHttp,
  nodeHttpsTransport,
  type ProviderTransport,
} from '../infrastructure/banking/provider-http.js';
import {
  X25519CredentialKeyUnwrapper,
  X25519CredentialKeyWrapper,
  nodeSymmetricCipher,
} from '../infrastructure/banking/x25519-key-wrapper.js';
import { PgConnectionRepository } from '../infrastructure/pg-connections.js';
import { ProviderRegistry, type ProviderEnvironment } from '../domain/index.js';
import { PdfStatementReader } from '../application/pdf/pdf-statement-reader.js';
import { FilePdfLayoutRegistry } from '../infrastructure/pdf/file-pdf-layout-registry.js';
import { PdfjsTextExtractor } from '../infrastructure/pdf/pdfjs-text-extractor.js';
import { DefaultStatementReader } from '../infrastructure/readers/statement-reader.js';
import { CONNECTIONS_SERVICE, ConnectionCredentialGuard, ConnectionsController } from './connections-http.js';
import {
  CsvUploadGuard,
  IMPORTS_CONNECTIONS,
  IMPORTS_HTTP_SETTINGS,
  IMPORTS_QUERIES,
  IMPORTS_REVERT,
  IMPORTS_SERVICE,
  ImportsController,
  type ImportsHttpSettings,
} from './imports-http.js';
import { IMPORT_PROFILES_SERVICE, ImportProfilesController } from './import-profiles-http.js';

/** Valores por omisión de `IMPORT_*` (docs/config-reference.md). */
export const DEFAULT_IMPORTS_SETTINGS: ImportsSettings = {
  maxBytes: 2_097_152,
  maxRows: 5000,
  maxColumns: 50,
  batchSize: 200,
  reviewTtlMs: 30 * 86_400_000,
  stagingRetentionMs: 90 * 86_400_000,
  futureToleranceDays: 3,
  duplicateWindowDays: 3,
  processingTimeoutMs: 600_000,
  duplicateHighScore: '0.9000',
  duplicateLowScore: '0.6000',
  documentMaxBytes: 20 * 1024 * 1024,
  pdfExtractionTimeoutMs: 30_000,
  pdfMaxPages: 200,
  pdfMaxTextItems: 300_000,
  pdfMaxTextChars: 4_194_304,
  pdfWorkerMaxOldMb: 192,
  pdfMinPageTextChars: 20,
};

/** Solo el benchmark: puerto de medición de la persistencia (stabilize-import-persist-perf). */
export type { PersistStep, PersistTimings } from '../application/ports/index.js';

export interface ImportsRuntimeOptions {
  /** Solo el benchmark: mide la persistencia por etapa y paso. */
  readonly timings?: PersistTimings;
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly outbox: OutboxPort;
  /** Zona horaria del workspace (IDENTITY): miembro en la API, directorio en el worker. */
  readonly calendar: WorkspaceCalendarQuery;
  readonly accounts: AccountsQueryPort;
  readonly balances: AccountBalancesQuery;
  readonly periods: Pick<PeriodQuery, 'listPeriods'>;
  /** Contratos públicos de TRANSACTIONS. */
  readonly transactions: {
    readonly imported: ImportedTransactionsCommand;
    readonly duplicateCandidates: DuplicateCandidatesQuery;
    readonly statuses: TransactionStatusQuery;
    /** Conversiones importadas entre cuentas propias (add-import-pipeline decisión 12). */
    readonly importedConversions: ImportedConversionsCommand;
  };
  /** Auditoría + recorrido del job (máquina `ImportJob`). */
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery?: LifecycleQuery;
  /** Documentos del workspace (add-document-attachments): consulta, lectura en streaming y vínculo. */
  readonly documents: DocumentSourcePort;
  /** Evaluación de reglas (add-rule-engine); sin el motor aplicado, un adaptador que falla deja `IMPORT_RULES_UNAVAILABLE`. */
  readonly rules: RulesEvaluationPort;
  /** Contraparte por alias y categoría por defecto (CLASSIFICATION). */
  readonly counterparties: CounterpartyResolverPort;
  /** Coincidencias con compromisos y vínculo con la ocurrencia confirmada (COMMITMENTS). */
  readonly matching: OccurrenceMatchingPort;
  readonly occurrenceLinks: OccurrenceLinkingPort;
  /** Institución de la cuenta (ACCOUNTS). */
  readonly institutions: InstitutionOfAccountPort;
  /** Validación de categorías, contrapartes y etiquetas editadas en la vista previa (CLASSIFICATION). */
  readonly refs: ReferenceCatalogPort;
  readonly settings?: Partial<ImportsSettings>;
  /** Conexiones con proveedores (add-banking-providers); sin ella el módulo de conexiones queda deshabilitado. */
  readonly banking?: BankingRuntimeOptions;
  /** Categoría de sistema «comisiones» (CLASSIFICATION) para las filas de comisión de un exchange. */
  readonly systemCategories?: SystemCategoriesPort;
}

export interface BankingRuntimeOptions {
  readonly environment: ProviderEnvironment;
  /** `IMPORTS_PROVIDER_FAKE_ENABLED`: prohibido en staging y producción (el arranque falla). */
  readonly fakeEnabled: boolean;
  /** `CONNECTION_CREDENTIALS_PUBLIC_KEYS` (`kid:clave`, la primera es la vigente). Sin ella no hay conexiones. */
  readonly publicKeys?: string | undefined;
  /** Claves privadas (`kid:clave`): SOLO el worker (D342: leídas de un archivo 0400 fuera del repositorio). */
  readonly privateKeys?: string | null | undefined;
  readonly queue: ConnectionJobQueue;
  readonly settings?: Partial<ConnectionSettings>;
  /** Transporte HTTP de los proveedores reales (por omisión `node:https`); los tests inyectan el suyo. */
  readonly transport?: ProviderTransport;
  /** Servidor del proveedor simulado (por omisión uno con el historial de ejemplo). */
  readonly fakeBackend?: FakeExchangeBackend;
  /** Adapters reales (puerta del owner, grupo 9); el simulado se agrega solo si está habilitado. */
  readonly extraProviders?: readonly BankingProvider[];
}

export const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings = {
  syncMaxDays: 365,
  requestsPerMinute: 10,
  maxPages: 1000,
};

/** Cola que no hace nada útil: las conexiones sin cola configurada rechazan encolar. */
const DISABLED_QUEUE: ConnectionJobQueue = {
  enqueueVerify: () =>
    Promise.reject(new DomainError('SERVICE_UNAVAILABLE', 'connection jobs are not enabled')),
  enqueueSync: () =>
    Promise.reject(new DomainError('SERVICE_UNAVAILABLE', 'connection jobs are not enabled')),
};

export interface ImportsRuntime {
  readonly service: ImportsService;
  readonly queries: ImportsQueries;
  readonly persist: PersistImportService;
  /** Etapas del import en el worker (lectura → vista previa) y deshacer. */
  readonly process: ProcessImportService;
  readonly revert: RevertImportService;
  readonly profiles: ProfilesService;
  readonly maintenance: ImportsMaintenanceService;
  readonly settings: ImportsSettings;
  /** Conexiones con proveedores y sus jobs (add-banking-providers). */
  readonly connections: ConnectionsService;
  readonly connectionJobs: ConnectionJobs;
  readonly providers: ProviderRegistry;
  /** El worker puede descifrar credenciales (tiene las claves privadas). */
  readonly canDecryptCredentials: boolean;
}

/**
 * Las transacciones de un import se auditan con origen `import` y como actor quien aprobó (decisión 9): se fija el
 * contexto ambiental alrededor del contrato de TRANSACTIONS (auditoría, recorrido y outbox lo leen de ahí).
 */
function withImportContext(port: ImportedTransactionsCommand): ImportedTransactionsCommand {
  return {
    recordBatch: (input) =>
      runWithRequestContext({ actor: { type: 'USER', userId: input.actorUserId }, origin: 'import' }, () =>
        port.recordBatch(input),
      ),
    voidBatch: (input) =>
      runWithRequestContext({ actor: { type: 'USER', userId: input.actorUserId }, origin: 'import' }, () =>
        port.voidBatch(input),
      ),
  };
}

/** Composición de IMPORTS sobre PostgreSQL (misma transacción que la `PgUnitOfWork` de cada comando). */
export function createImportsRuntime(options: ImportsRuntimeOptions): ImportsRuntime {
  const settings: ImportsSettings = { ...DEFAULT_IMPORTS_SETTINGS, ...options.settings };
  const accounts: AccountsPort = {
    async getAccount(workspaceId, accountId) {
      const [e] = await options.accounts.getPostingEligibility({ workspaceId, accountIds: [accountId] });
      return e ? { accountId: e.accountId, currency: e.currency, nature: e.nature, status: e.status } : null;
    },
    async assertActive(workspaceId, accountId) {
      const [e] = await options.accounts.assertCanPost({ workspaceId, accounts: [{ accountId }] });
      if (!e) throw new DomainError('REFERENCE_NOT_FOUND', 'account not found').at('/accountId');
      return { accountId: e.accountId, currency: e.currency, nature: e.nature, status: e.status };
    },
  };
  const balances: BalancePort = {
    async presentedBalance(workspaceId, accountId, asOf) {
      const result = await options.balances.getAccountBalances({
        workspaceId,
        accountIds: [accountId],
        ...(asOf ? { asOf } : {}),
      });
      return result.balances.find((b) => b.accountId === accountId)?.presented.amount ?? null;
    },
  };
  const calendar: CalendarPort = {
    timeZoneOf: async (workspaceId) => (await options.calendar.calendarOf(workspaceId)).timeZone,
  };
  const periods: ClosedPeriodsPort = {
    listClosed: async (workspaceId) =>
      (await options.periods.listPeriods({ workspaceId, statuses: ['CLOSED'] })).map((p) => ({
        start: p.periodStart,
        end: p.periodEnd,
      })),
  };
  const connections = new PgConnectionRepository();
  const holder: { deps?: ImportsDeps } = {};
  const hooks = new ConnectionHooks(() => holder.deps as ImportsDeps, connections);
  const deps: ImportsDeps = {
    uow: new PgImportsUnitOfWork(options.pool),
    jobs: new PgImportJobRepository(),
    staging: new PgStagingRepository(),
    links: new PgRowLinkRepository(),
    accounts,
    balances,
    currencies: pgCurrencyCatalog,
    calendar,
    periods,
    imported: withImportContext(options.transactions.imported),
    duplicates: options.transactions.duplicateCandidates,
    statuses: options.transactions.statuses,
    audit: options.audit,
    outbox: options.outbox,
    ids: uuidV7Ids,
    clock: options.clock,
    settings,
    lifecycle: options.lifecycle,
    ...(options.lifecycleQuery ? { lifecycleQuery: options.lifecycleQuery } : {}),
    profiles: new PgMappingProfileRepository(),
    documents: options.documents,
    rules: options.rules,
    counterparties: options.counterparties,
    matching: options.matching,
    occurrenceLinks: options.occurrenceLinks,
    institutions: options.institutions,
    conversions: options.transactions.importedConversions,
    connectionHooks: hooks,
    ...(options.timings ? { timings: options.timings } : {}),
    ...(options.systemCategories ? { systemCategories: options.systemCategories } : {}),
    readers: new DefaultStatementReader(),
    refs: options.refs,
    // Lector de extractos PDF (add-pdf-statement-parser): extracción en un hilo aislado, sin consumidores nuevos.
    pdf: new PdfStatementReader(
      new PdfjsTextExtractor({
        timeoutMs: settings.pdfExtractionTimeoutMs,
        maxPages: settings.pdfMaxPages,
        maxTextItems: settings.pdfMaxTextItems,
        maxTextChars: settings.pdfMaxTextChars,
        workerMaxOldMb: settings.pdfWorkerMaxOldMb,
      }),
      new FilePdfLayoutRegistry(),
      { minPageTextChars: settings.pdfMinPageTextChars },
    ),
  };
  holder.deps = deps;
  const banking = bankingRuntime(options.banking, connections);
  const process = new ProcessImportService(deps);
  return {
    service: new ImportsService(deps),
    queries: new ImportsQueries(deps),
    persist: new PersistImportService(deps),
    process,
    revert: new RevertImportService(deps),
    profiles: new ProfilesService(deps),
    maintenance: new ImportsMaintenanceService(deps),
    settings,
    connections: new ConnectionsService(deps, banking.deps),
    connectionJobs: new ConnectionJobs(deps, banking.deps, process),
    providers: banking.deps.registry,
    canDecryptCredentials: banking.deps.vault.canDecrypt,
  };
}

/** Registro de proveedores, adapters, cliente HTTP con allowlist y almacén de credenciales (decisiones 1–3 y 10). */
function bankingRuntime(
  options: BankingRuntimeOptions | undefined,
  connections: PgConnectionRepository,
): { readonly deps: BankingDeps } {
  const environment = options?.environment ?? 'local';
  const fakeEnabled = options?.fakeEnabled ?? false;
  // Falla al arrancar si el simulado está habilitado en staging o producción, o si un descriptor es inválido.
  const registry = ProviderRegistry.create(PROVIDER_DESCRIPTORS, { environment, fakeEnabled });
  const backend = fakeEnabled ? (options?.fakeBackend ?? new FakeExchangeBackend(sampleRecords())) : null;
  const real = options?.transport ?? nodeHttpsTransport;
  // El host del simulado nunca sale a la red: se enruta al servidor simulado en proceso.
  const transport: ProviderTransport = backend
    ? (url, headers, timeoutMs) =>
        url.hostname === FAKE_HOST
          ? backend.transport(url, headers, timeoutMs)
          : real(url, headers, timeoutMs)
    : real;
  const apis = new Map<string, BankingProvider>();
  if (fakeEnabled) apis.set('FAKE_EXCHANGE', new FakeExchangeProvider());
  for (const p of options?.extraProviders ?? []) apis.set(p.descriptor.id, p);
  const adapters: ProviderAdapters = {
    api: (id) => apis.get(id) ?? null,
    file: (id) =>
      fakeEnabled && id === FAKE_EXCHANGE_FILE_DESCRIPTOR.id ? new FakeExchangeFileProvider() : null,
  };
  const wrapper = options?.publicKeys ? new X25519CredentialKeyWrapper(options.publicKeys) : null;
  const unwrapper =
    options?.publicKeys && options.privateKeys
      ? new X25519CredentialKeyUnwrapper(options.publicKeys, options.privateKeys)
      : null;
  return {
    deps: {
      registry,
      adapters,
      connections,
      vault: new CredentialVault(nodeSymmetricCipher, wrapper, unwrapper),
      queue: options?.queue ?? DISABLED_QUEUE,
      http: new AllowlistedProviderHttp(transport),
      settings: { ...DEFAULT_CONNECTION_SETTINGS, ...options?.settings },
    },
  };
}

export interface ImportsModuleOptions {
  readonly runtime: ImportsRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de IMPORTS (`/imports*`). */
@Module({})
export class ImportsModule {
  static register(options: ImportsModuleOptions): DynamicModule {
    const http: ImportsHttpSettings = { maxBytes: options.runtime.settings.maxBytes };
    return {
      module: ImportsModule,
      controllers: [ConnectionsController, ImportsController, ImportProfilesController],
      providers: [
        CsvUploadGuard,
        ConnectionCredentialGuard,
        { provide: CONNECTIONS_SERVICE, useValue: options.runtime.connections },
        { provide: IMPORTS_CONNECTIONS, useValue: options.runtime.connections },
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: IMPORTS_HTTP_SETTINGS, useValue: http },
        { provide: IMPORTS_SERVICE, useValue: options.runtime.service },
        { provide: IMPORTS_QUERIES, useValue: options.runtime.queries },
        { provide: IMPORTS_REVERT, useValue: options.runtime.revert },
        { provide: IMPORT_PROFILES_SERVICE, useValue: options.runtime.profiles },
      ],
    };
  }
}

const payloadOf = (event: { readonly payload: unknown }): Record<string, unknown> =>
  typeof event.payload === 'object' && event.payload !== null
    ? (event.payload as Record<string, unknown>)
    : {};

/**
 * Consumidor idempotente del worker (inbox en la misma transacción, INV-028): `imports.persist` consume
 * `imports.ImportApproved.v1` y crea las transacciones por lotes. Concurrencia 1 (un lote = una transacción de BD
 * independiente; ocupa además la conexión de la entrega): entra en el presupuesto de conexiones del worker (D112).
 * Si el worker cae a mitad, la re-entrega reanuda por el estado de las filas sin duplicar.
 */
export function importsEventConsumers(
  runtime: ImportsRuntime,
  logger?: Pick<Logger, 'info'>,
): EventConsumerDefinition[] {
  return [
    {
      consumer: IMPORTS_CONSUMERS.persist,
      concurrency: 1,
      // Sin consumidores nuevos (D249): el mismo consumidor atiende la persistencia, las etapas del import y el deshacer.
      events: [
        { type: 'imports.ImportApproved', version: 1 },
        { type: 'imports.ImportFileUploaded', version: 1 },
        { type: 'imports.ImportRevertRequested', version: 1 },
      ],
      handler: async (event) => {
        const importId = payloadOf(event)['importJobId'];
        if (typeof importId !== 'string') return;
        const input = { workspaceId: event.workspaceId, importId };
        if (event.eventType === 'imports.ImportFileUploaded') {
          const outcome = await runtime.process.process(input);
          logger?.info({ importJobId: importId, outcome }, 'import processed');
        } else if (event.eventType === 'imports.ImportRevertRequested') {
          const outcome = await runtime.revert.process(input);
          logger?.info({ importJobId: importId, outcome }, 'import reverted');
        } else {
          const outcome = await runtime.persist.persist(input);
          logger?.info(
            {
              importJobId: importId,
              outcome: outcome.status,
              batches: outcome.batches,
              failedBatches: outcome.failedBatches,
            },
            'import persisted',
          );
        }
      },
    },
  ];
}

export interface ActiveWorkspaceDirectory {
  list(): Promise<readonly { readonly workspaceId: string }[]>;
}

type JobLogger = Pick<Logger, 'info' | 'error'>;

async function sweepWorkspaces(
  job: string,
  workspaces: ActiveWorkspaceDirectory,
  logger: JobLogger,
  trigger: 'cron' | 'startup' | 'manual',
  step: (workspaceId: string) => Promise<number>,
): Promise<{ readonly workspaces: number; readonly affected: number; readonly failed: number }> {
  return runWithRequestContext({ actor: { type: 'WORKER', process: job }, origin: 'system' }, async () => {
    let affected = 0;
    let failed = 0;
    const all = await workspaces.list();
    for (const { workspaceId } of all) {
      try {
        affected += await step(workspaceId);
      } catch (err) {
        failed += 1;
        logger.error(
          { workspaceId, err: { type: err instanceof Error ? err.name : typeof err, message: String(err) } },
          'imports job failed for workspace',
        );
      }
    }
    logger.info({ job, trigger, workspaces: all.length, affected, failed }, 'imports job finished');
    return { workspaces: all.length, affected, failed };
  });
}

/**
 * Job `imports.expire-reviews` (decisión 15): por workspace activo cancela (actor `SYSTEM`, auditado) las
 * importaciones sin aprobar vencidas y descarta sus celdas crudas. Un workspace que falla no detiene a los demás; la
 * ejecución siguiente lo reintenta. Los logs llevan solo conteos.
 */
export function runImportsExpire(
  service: ImportsMaintenanceService,
  workspaces: ActiveWorkspaceDirectory,
  logger: JobLogger,
  trigger: 'cron' | 'startup' | 'manual',
) {
  return sweepWorkspaces(IMPORTS_EXPIRE_JOB, workspaces, logger, trigger, (ws) => service.expireReviews(ws));
}

/**
 * Job `imports.purge-staging` (decisión 15): por workspace activo borra las filas del staging de las importaciones
 * terminadas o canceladas hace más de `IMPORT_STAGING_RETENTION` (se conservan job, conteos y vínculos).
 */
export function runImportsPurge(
  service: ImportsMaintenanceService,
  workspaces: ActiveWorkspaceDirectory,
  logger: JobLogger,
  trigger: 'cron' | 'startup' | 'manual',
) {
  return sweepWorkspaces(IMPORTS_PURGE_JOB, workspaces, logger, trigger, (ws) => service.purgeStaging(ws));
}

export { IMPORTS_CONSUMERS, IMPORTS_EVENTS, IMPORTS_EXPIRE_JOB, IMPORTS_PURGE_JOB };

/**
 * Gancho de importación del workspace (add-banking-providers): una conexión de API importada NO trae su credencial,
 * así que queda `NEEDS_CREDENTIAL` (sin error ni cursor de sincronización en curso) hasta que el OWNER cargue una; las de
 * archivo (sin credencial) y las revocadas no cambian.
 */
export function connectionRestoreHook(ctx: { readonly rows: Record<string, unknown>[] }): void {
  const credentialed = new Set(
    PROVIDER_DESCRIPTORS.filter((d) => d.credentialMode !== 'NONE').map((d) => d.id),
  );
  for (const row of ctx.rows) {
    if (row['status'] === 'REVOKED' || !credentialed.has(String(row['provider_id']))) continue;
    row['status'] = 'NEEDS_CREDENTIAL';
    row['last_error_code'] = null;
  }
}
export {
  CONNECTION_SYNC_JOB,
  CONNECTION_VERIFY_JOB,
  CREDENTIALS_REWRAP_JOB,
  type ConnectionJobs,
} from '../application/banking/connection-jobs.js';
export type { ConnectionJobPayload, ConnectionJobQueue } from '../application/banking/ports.js';
export { FakeExchangeBackend, sampleRecords } from '../infrastructure/banking/fake-exchange.js';
export {
  generateCredentialKeyPair,
  loadPrivateKeyring,
} from '../infrastructure/banking/x25519-key-wrapper.js';
export { IMPORTS_AUDIT_POLICY, IMPORTS_CONNECTION_RESTORE_HOOK } from '../contracts/index.js';
export type { ImportsMaintenanceService } from '../application/imports-maintenance.service.js';
export type { ImportsSettings, OutboxPort } from '../application/ports/index.js';

/** ImportJobExistenceQuery: ids existentes en el workspace (`imports.import_job`, bajo RLS en la unidad de trabajo en curso). */
export const importJobExistenceQuery: ImportJobExistenceQuery = {
  existing: pgExistingIds('imports.import_job'),
};

import { IMPORT_JOB_LIFECYCLE } from '../domain/import-job.js';
import { CONNECTION_LIFECYCLE } from '../domain/banking/connection.js';

/** Máquina `ImportJob` declarada (dato puro) para el recorrido (add-lifecycle-timeline, add-import-pipeline). */
export const IMPORT_JOB_LIFECYCLE_MACHINE = IMPORT_JOB_LIFECYCLE.definition;

/** Máquina `ImportConnection` declarada (dato puro) para el recorrido (add-banking-providers, D52). */
export const IMPORT_CONNECTION_LIFECYCLE_MACHINE = CONNECTION_LIFECYCLE.definition;
