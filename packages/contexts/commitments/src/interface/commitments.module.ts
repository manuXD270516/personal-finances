import { Module, type DynamicModule } from '@nestjs/common';
import type { AccountCatalogQuery, AccountsQueryPort } from '@pf/accounts/contracts';
import type { AuditPort, LifecycleMachineDto, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { ClassificationValidator } from '@pf/classification/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import { runWithRequestContext } from '@pf/platform/api';
import type { EventConsumerDefinition } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { CounterMetrics, HistogramMetrics } from '@pf/platform/otel';
import type { Clock } from '@pf/shared-kernel';
import type {
  PendingFlowQuery,
  RecurringTransactionPort,
  TransactionLinkQuery,
} from '@pf/transactions/contracts';
import type { Pool } from 'pg';
import { CommitmentsQueries } from '../application/commitments.queries.js';
import { DefinitionsService } from '../application/definitions.service.js';
import { GenerateOccurrencesService } from '../application/generate-occurrences.service.js';
import { OccurrencesService } from '../application/occurrences.service.js';
import type {
  CommitmentsDeps,
  CommitmentsMetricsPort,
  FinancialPeriodPort,
  OutboxPort,
  WorkspaceSettingsPort,
} from '../application/ports/index.js';
import {
  COMMITMENTS_CONSUMERS,
  COMMITMENTS_GENERATE_JOB,
  type CommittedQuery,
  type DefinitionStatsQuery,
  type OccurrenceLinkPort,
  type ResolvedOccurrencesQuery,
  type UpcomingPaymentsQuery,
} from '../contracts/index.js';
import { RECURRING_DEFINITION_LIFECYCLE, RECURRING_OCCURRENCE_LIFECYCLE } from '../domain/index.js';
import {
  PgCommitmentsUnitOfWork,
  PgDefinitionRepository,
  PgOccurrenceRepository,
  uuidV7Ids,
} from '../infrastructure/pg-commitments.js';
import {
  COMMITMENTS_QUERIES,
  DEFINITIONS_SERVICE,
  OCCURRENCES_SERVICE,
  RecurringController,
} from './recurring-http.js';

/** Horizonte de generación por omisión (`COMMITMENTS_HORIZON_DAYS`, D125). */
export const DEFAULT_HORIZON_DAYS = 90;

export interface CommitmentsRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  /** Auditoría + recorrido (add-lifecycle-timeline). */
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery?: LifecycleQuery;
  readonly outbox: OutboxPort;
  /** Zona horaria del workspace (IDENTITY): miembro en la API, directorio en el worker. */
  readonly calendar: WorkspaceCalendarQuery;
  /** Moneda base y zona horaria (IDENTITY). */
  readonly settings: WorkspaceSettingsPort;
  /** Periodos financieros (adapter en la composición sobre `PeriodQuery` de PLANNING; sin ciclo de dependencias). */
  readonly periods: FinancialPeriodPort;
  readonly accounts: AccountsQueryPort;
  readonly accountCatalog: Pick<AccountCatalogQuery, 'listAccounts'>;
  readonly classification: ClassificationValidator;
  readonly rates: FxValuationPort;
  /** Puertos de TRANSACTIONS (`@pf/transactions/contracts`). */
  readonly transactions: RecurringTransactionPort;
  readonly links: TransactionLinkQuery;
  readonly pending: PendingFlowQuery;
  /** `COMMITMENTS_HORIZON_DAYS` (14..366). */
  readonly horizonDays?: number;
  /** `REPORTING_RATE_VALIDITY_WINDOW` en días (la misma ventana que el Home). */
  readonly rateValidityWindowDays: number;
  readonly counters?: CounterMetrics;
  readonly histograms?: HistogramMetrics;
}

export interface CommitmentsRuntime {
  readonly definitions: DefinitionsService;
  readonly occurrences: OccurrencesService;
  readonly queries: CommitmentsQueries;
  readonly generate: GenerateOccurrencesService;
  /** Contratos públicos para Reporting (Q4 y Q8) y `add-commitment-matching`. */
  readonly committed: CommittedQuery;
  readonly upcoming: UpcomingPaymentsQuery;
  readonly resolved: ResolvedOccurrencesQuery;
  readonly stats: DefinitionStatsQuery;
  readonly linkPort: OccurrenceLinkPort;
}

/**
 * La transacción creada por una ocurrencia se audita con origen `recurring` (design decisión 18) aunque la dispare un
 * usuario: se conserva el actor y solo cambia el origen del contexto ambiental.
 */
function withRecurringOrigin(port: RecurringTransactionPort): RecurringTransactionPort {
  return { record: (input) => runWithRequestContext({ origin: 'recurring' }, () => port.record(input)) };
}

/** Composición de COMMITMENTS sobre PostgreSQL (misma transacción que la `PgUnitOfWork` de cada comando). */
export function createCommitmentsRuntime(options: CommitmentsRuntimeOptions): CommitmentsRuntime {
  const metrics: CommitmentsMetricsPort = {
    increment: (name, labels, value) => options.counters?.increment(name, labels, value),
    observe: (name, labels, value) => options.histograms?.record(name, value, labels),
  };
  const deps: CommitmentsDeps = {
    uow: new PgCommitmentsUnitOfWork(options.pool),
    definitions: new PgDefinitionRepository(),
    occurrences: new PgOccurrenceRepository(),
    calendar: options.calendar,
    settings: options.settings,
    periods: options.periods,
    accounts: options.accounts,
    accountCatalog: options.accountCatalog,
    classification: options.classification,
    rates: options.rates,
    transactions: withRecurringOrigin(options.transactions),
    links: options.links,
    pending: options.pending,
    audit: options.audit,
    lifecycle: options.lifecycle,
    ...(options.lifecycleQuery ? { lifecycleQuery: options.lifecycleQuery } : {}),
    outbox: options.outbox,
    ids: uuidV7Ids,
    clock: options.clock,
    horizonDays: options.horizonDays ?? DEFAULT_HORIZON_DAYS,
    rateValidityWindowDays: options.rateValidityWindowDays,
    metrics,
  };
  const queries = new CommitmentsQueries(deps);
  const occurrences = new OccurrencesService(deps);
  return {
    definitions: new DefinitionsService(deps),
    occurrences,
    queries,
    generate: new GenerateOccurrencesService(deps, occurrences),
    committed: queries,
    upcoming: queries,
    resolved: queries,
    stats: queries,
    linkPort: {
      link: async (input) => {
        const occurrence = await occurrences.link({
          workspaceId: input.workspaceId,
          userId: input.userId,
          occurrenceId: input.occurrenceId,
          transactionId: input.transactionId,
          matchedBy: input.matchedBy,
        });
        return { occurrenceId: occurrence.id, transactionId: input.transactionId };
      },
    },
  };
}

export interface CommitmentsModuleOptions {
  readonly runtime: CommitmentsRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de COMMITMENTS (`/recurring*`). */
@Module({})
export class CommitmentsModule {
  static register(options: CommitmentsModuleOptions): DynamicModule {
    return {
      module: CommitmentsModule,
      controllers: [RecurringController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: DEFINITIONS_SERVICE, useValue: options.runtime.definitions },
        { provide: OCCURRENCES_SERVICE, useValue: options.runtime.occurrences },
        { provide: COMMITMENTS_QUERIES, useValue: options.runtime.queries },
      ],
    };
  }
}

/** Máquinas declaradas por el dominio, para AUDIT en el composition root. */
export const RECURRING_DEFINITION_LIFECYCLE_MACHINE: LifecycleMachineDto =
  RECURRING_DEFINITION_LIFECYCLE.definition;
export const RECURRING_OCCURRENCE_LIFECYCLE_MACHINE: LifecycleMachineDto =
  RECURRING_OCCURRENCE_LIFECYCLE.definition;

const payloadOf = (event: { readonly payload: unknown }): Record<string, unknown> =>
  typeof event.payload === 'object' && event.payload !== null
    ? (event.payload as Record<string, unknown>)
    : {};

/**
 * Consumidores idempotentes del worker (inbox en la misma transacción, INV-028):
 *  - `commitments.transaction-voided`: `transactions.TransactionVoided.v1` libera la ocurrencia creada o vinculada.
 * Baja frecuencia (anular una transacción): `concurrency: 1` no reserva conexiones del pool del worker (D112).
 */
export function commitmentsEventConsumers(runtime: CommitmentsRuntime): EventConsumerDefinition[] {
  return [
    {
      consumer: COMMITMENTS_CONSUMERS.transactionVoided,
      concurrency: 1,
      events: [{ type: 'transactions.TransactionVoided', version: 1 }],
      handler: async (event) => {
        const transactionId = payloadOf(event)['transactionId'];
        if (typeof transactionId !== 'string') return;
        await runtime.occurrences.onTransactionVoided({ workspaceId: event.workspaceId, transactionId });
      },
    },
  ];
}

export interface ActiveWorkspaceDirectory {
  list(): Promise<readonly { readonly workspaceId: string }[]>;
}

/**
 * Job `commitments.generate-occurrences` (decisión 7): recorre los workspaces activos y, por cada uno, extiende la
 * ventana, pasa a próxima y atrasada y crea las ocurrencias automáticas, con el actor de proceso y origen `recurring`.
 * Un workspace que falla no detiene a los demás; la ejecución siguiente lo reintenta.
 */
export async function runGenerateOccurrences(
  service: GenerateOccurrencesService,
  workspaces: ActiveWorkspaceDirectory,
  logger: Pick<Logger, 'info' | 'error'>,
  trigger: 'cron' | 'startup' | 'manual',
): Promise<{ readonly workspaces: number; readonly generated: number; readonly failed: number }> {
  return runWithRequestContext(
    { actor: { type: 'WORKER', process: COMMITMENTS_GENERATE_JOB }, origin: 'recurring' },
    async () => {
      let generated = 0;
      let failed = 0;
      const all = await workspaces.list();
      for (const { workspaceId } of all) {
        try {
          const result = await service.runWorkspace(workspaceId);
          generated += result.generated;
          for (const f of result.failed) {
            failed += 1;
            logger.error(
              { workspaceId, definitionId: f.definitionId, error: f.error },
              'commitments item failed',
            );
          }
        } catch (err) {
          failed += 1;
          logger.error(
            {
              workspaceId,
              err: { type: err instanceof Error ? err.name : typeof err, message: String(err) },
            },
            'generate occurrences failed for workspace',
          );
        }
      }
      logger.info(
        { job: COMMITMENTS_GENERATE_JOB, trigger, workspaces: all.length, generated, failed },
        'occurrences generated',
      );
      return { workspaces: all.length, generated, failed };
    },
  );
}

export { COMMITMENTS_CONSUMERS, COMMITMENTS_GENERATE_JOB };
export { COMMITMENTS_AUDIT_POLICY } from '../contracts/index.js';
export type { GenerateOccurrencesService } from '../application/generate-occurrences.service.js';
export type { FinancialPeriodPort, OutboxPort, WorkspaceSettingsPort } from '../application/ports/index.js';
