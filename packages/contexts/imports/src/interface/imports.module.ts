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
  OutboxPort,
  ReferenceCatalogPort,
  RulesEvaluationPort,
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
import { DefaultStatementReader } from '../infrastructure/readers/statement-reader.js';
import {
  CsvUploadGuard,
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
};

export interface ImportsRuntimeOptions {
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
}

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
    readers: new DefaultStatementReader(),
    refs: options.refs,
  };
  return {
    service: new ImportsService(deps),
    queries: new ImportsQueries(deps),
    persist: new PersistImportService(deps),
    process: new ProcessImportService(deps),
    revert: new RevertImportService(deps),
    profiles: new ProfilesService(deps),
    maintenance: new ImportsMaintenanceService(deps),
    settings,
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
      controllers: [ImportsController, ImportProfilesController],
      providers: [
        CsvUploadGuard,
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
export { IMPORTS_AUDIT_POLICY } from '../contracts/index.js';
export type { ImportsMaintenanceService } from '../application/imports-maintenance.service.js';
export type { ImportsSettings, OutboxPort } from '../application/ports/index.js';

/** ImportJobExistenceQuery: ids existentes en el workspace (`imports.import_job`, bajo RLS en la unidad de trabajo en curso). */
export const importJobExistenceQuery: ImportJobExistenceQuery = {
  existing: pgExistingIds('imports.import_job'),
};

import { IMPORT_JOB_LIFECYCLE } from '../domain/import-job.js';

/** Máquina `ImportJob` declarada (dato puro) para el recorrido (add-lifecycle-timeline, add-import-pipeline). */
export const IMPORT_JOB_LIFECYCLE_MACHINE = IMPORT_JOB_LIFECYCLE.definition;
