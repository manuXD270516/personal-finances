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
import { EngineManagedDefinitions } from '../application/managed-definitions.js';
import { EngineRecurringDefinitionPort } from '../application/recurring-definition-port.js';
import { MatchingQueries } from '../application/matching.queries.js';
import { MatchingService } from '../application/matching.service.js';
import { OccurrencesService } from '../application/occurrences.service.js';
import type {
  CommitmentsDeps,
  CommitmentsMetricsPort,
  FinancialPeriodPort,
  OutboxPort,
  WorkspaceSettingsPort,
} from '../application/ports/index.js';
import type { CounterpartyNames, SubscriptionsDeps } from '../application/ports/subscriptions.js';
import { SubscriptionChargesService } from '../application/subscription-charges.service.js';
import { SubscriptionDailyService } from '../application/subscription-daily.service.js';
import { SubscriptionsQueries } from '../application/subscriptions.queries.js';
import { SubscriptionsService } from '../application/subscriptions.service.js';
import {
  COMMITMENTS_CONSUMERS,
  COMMITMENTS_GENERATE_JOB,
  COMMITMENTS_SUBSCRIPTION_JOB,
  type CommittedQuery,
  type DefinitionStatsQuery,
  type OccurrenceLinkPort,
  type OccurrenceMatchCandidatesQuery,
  type RecurringDefinitionPort,
  RECURRING_DEFINITION_PORT,
  type ResolvedOccurrencesQuery,
  type SubscriptionsQuery,
  type UpcomingPaymentsQuery,
} from '../contracts/index.js';
import {
  RECURRING_DEFINITION_LIFECYCLE,
  RECURRING_OCCURRENCE_LIFECYCLE,
  SUBSCRIPTION_LIFECYCLE,
} from '../domain/index.js';
import {
  PgCommitmentsUnitOfWork,
  PgDefinitionRepository,
  PgOccurrenceRepository,
  uuidV7Ids,
} from '../infrastructure/pg-commitments.js';
import { PgMatchSuggestionRepository } from '../infrastructure/pg-matching.js';
import {
  PgChargeRepository,
  PgProposalRepository,
  PgReminderRepository,
  PgSubscriptionRepository,
} from '../infrastructure/pg-subscriptions.js';
import { MATCHING_QUERIES, MATCHING_SERVICE, MatchSuggestionsController } from './matching-http.js';
import {
  COMMITMENTS_QUERIES,
  DEFINITIONS_SERVICE,
  OCCURRENCES_SERVICE,
  RecurringController,
} from './recurring-http.js';
import {
  SUBSCRIPTION_CHARGES_SERVICE,
  SUBSCRIPTIONS_QUERIES,
  SUBSCRIPTIONS_SERVICE,
  SubscriptionsController,
} from './subscriptions-http.js';

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
  /** Nombre del provider (contraparte) por id, para los hechos y las vistas de suscripciones (CLASSIFICATION). */
  readonly counterpartyNames: CounterpartyNames;
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
  /** Puerto público de definiciones administradas por otro contexto (openspec add-loans, N1). */
  readonly recurringDefinitions: RecurringDefinitionPort;
  /** Matching sugerido (openspec add-commitment-matching). */
  readonly matching: MatchingService;
  readonly matchingQueries: MatchingQueries;
  /** Contrato público para Imports (Phase 6): candidatas de filas sin registrar, sin persistir. */
  readonly matchCandidates: OccurrenceMatchCandidatesQuery;
  /** Suscripciones (openspec add-subscriptions). */
  readonly subscriptions: SubscriptionsService;
  readonly subscriptionQueries: SubscriptionsQueries;
  readonly subscriptionCharges: SubscriptionChargesService;
  readonly subscriptionDaily: SubscriptionDailyService;
  /** Contrato público para lectores futuros (Reporting, Planning). */
  readonly subscriptionsQuery: SubscriptionsQuery;
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
    matching: new PgMatchSuggestionRepository(),
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
  const definitions = new DefinitionsService(deps);
  const matchingQueries = new MatchingQueries(deps);
  const subscriptionDeps: SubscriptionsDeps = {
    ...deps,
    subscriptions: new PgSubscriptionRepository(),
    proposals: new PgProposalRepository(),
    charges: new PgChargeRepository(),
    reminders: new PgReminderRepository(),
    managed: new EngineManagedDefinitions(deps, definitions),
    counterpartyNames: options.counterpartyNames,
  };
  const subscriptionQueries = new SubscriptionsQueries(subscriptionDeps);
  return {
    definitions,
    occurrences,
    subscriptions: new SubscriptionsService(subscriptionDeps),
    subscriptionQueries,
    subscriptionCharges: new SubscriptionChargesService(subscriptionDeps),
    subscriptionDaily: new SubscriptionDailyService(subscriptionDeps),
    subscriptionsQuery: subscriptionQueries,
    queries,
    matching: new MatchingService(deps, occurrences),
    matchingQueries,
    matchCandidates: matchingQueries,
    generate: new GenerateOccurrencesService(deps, occurrences),
    committed: queries,
    upcoming: queries,
    resolved: queries,
    stats: queries,
    recurringDefinitions: new EngineRecurringDefinitionPort(deps, definitions),
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
      // `match-suggestions` va antes que `RecurringController` (`:definitionId` no debe capturarla).
      controllers: [MatchSuggestionsController, RecurringController, SubscriptionsController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: DEFINITIONS_SERVICE, useValue: options.runtime.definitions },
        { provide: OCCURRENCES_SERVICE, useValue: options.runtime.occurrences },
        { provide: COMMITMENTS_QUERIES, useValue: options.runtime.queries },
        { provide: MATCHING_SERVICE, useValue: options.runtime.matching },
        { provide: MATCHING_QUERIES, useValue: options.runtime.matchingQueries },
        { provide: SUBSCRIPTIONS_SERVICE, useValue: options.runtime.subscriptions },
        { provide: SUBSCRIPTION_CHARGES_SERVICE, useValue: options.runtime.subscriptionCharges },
        { provide: SUBSCRIPTIONS_QUERIES, useValue: options.runtime.subscriptionQueries },
        { provide: RECURRING_DEFINITION_PORT, useValue: options.runtime.recurringDefinitions },
      ],
      exports: [RECURRING_DEFINITION_PORT],
    };
  }
}

/** Máquinas declaradas por el dominio, para AUDIT en el composition root. */
export const RECURRING_DEFINITION_LIFECYCLE_MACHINE: LifecycleMachineDto =
  RECURRING_DEFINITION_LIFECYCLE.definition;
export const RECURRING_OCCURRENCE_LIFECYCLE_MACHINE: LifecycleMachineDto =
  RECURRING_OCCURRENCE_LIFECYCLE.definition;
/** add-subscriptions: máquina `Subscription` (docs/35 D138). */
export const SUBSCRIPTION_LIFECYCLE_MACHINE: LifecycleMachineDto = SUBSCRIPTION_LIFECYCLE.definition;

const payloadOf = (event: { readonly payload: unknown }): Record<string, unknown> =>
  typeof event.payload === 'object' && event.payload !== null
    ? (event.payload as Record<string, unknown>)
    : {};

/** Cambios de una transacción que pueden alterar su compatibilidad con una ocurrencia (design decisión 4). */
const MATCH_RELEVANT_FIELDS: ReadonlySet<string> = new Set([
  'amount',
  'businessDate',
  'accountId',
  'counterpartyId',
  'splits',
]);

/**
 * Consumidores idempotentes del worker (inbox en la misma transacción, INV-028):
 *  - `commitments.transaction-voided`: `transactions.TransactionVoided.v1` libera la ocurrencia creada o vinculada.
 *  - `commitments.occurrence-matcher` (add-commitment-matching): `TransactionCreated/Updated/Voided.v1` ⇒ sugerencias
 *    de coincidencia. Recibe ráfagas (imports de Phase 6): usa la concurrencia y el lote por omisión del runtime
 *    (`EVENT_CONSUMER_CONCURRENCY` / `EVENT_CONSUMER_BATCH_SIZE`), así que entra en el presupuesto de conexiones del
 *    worker (D112: Σ concurrencia + 4 reservadas ≤ `DATABASE_POOL_MAX`; 1 en el host de 2 GB, 4 en desarrollo) y la
 *    ráfaga de 1 000 transacciones se mide en la suite `perf`.
 *  - `commitments.match-backfill`: `OccurrencesGenerated.v1` y `RecurringDefinitionChanged.v1` ⇒ transacciones ya
 *    registradas para las ocurrencias nuevas, reinstauradas o reescritas (misma concurrencia por omisión).
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
    {
      consumer: COMMITMENTS_CONSUMERS.occurrenceMatcher,
      events: [
        { type: 'transactions.TransactionCreated', version: 1 },
        { type: 'transactions.TransactionUpdated', version: 1 },
        { type: 'transactions.TransactionVoided', version: 1 },
      ],
      handler: async (event) => {
        const p = payloadOf(event);
        const transactionId = p['transactionId'];
        if (typeof transactionId !== 'string') return;
        const { workspaceId, eventId } = event;
        if (event.eventType === 'transactions.TransactionVoided') {
          await runtime.matching.onTransactionVoided({ workspaceId, transactionId });
          return;
        }
        if (event.eventType === 'transactions.TransactionUpdated') {
          const changed = Array.isArray(p['changedFields']) ? (p['changedFields'] as unknown[]) : [];
          if (!changed.some((f) => typeof f === 'string' && MATCH_RELEVANT_FIELDS.has(f))) return;
        } else if ((p['origin'] as { type?: unknown } | undefined)?.type === 'RECURRING') {
          // La creó una ocurrencia: nunca es candidata (externalRef `commitments.occurrence`).
          return;
        }
        await runtime.matching.onTransactionChanged({ workspaceId, transactionId, eventId });
      },
    },
    {
      consumer: COMMITMENTS_CONSUMERS.matchBackfill,
      events: [
        { type: 'commitments.OccurrencesGenerated', version: 1 },
        { type: 'commitments.RecurringDefinitionChanged', version: 1 },
      ],
      handler: async (event) => {
        const p = payloadOf(event);
        const ids: string[] = [];
        if (event.eventType === 'commitments.OccurrencesGenerated') {
          for (const o of Array.isArray(p['occurrences']) ? (p['occurrences'] as unknown[]) : []) {
            const id = (o as { occurrenceId?: unknown }).occurrenceId;
            if (typeof id === 'string') ids.push(id);
          }
        } else {
          // Reinstauradas (reanudar) y reescritas (revisión): vuelven a ser candidatas de pagos ya registrados.
          for (const key of ['reinstatedOccurrenceIds', 'rewrittenOccurrenceIds']) {
            for (const id of Array.isArray(p[key]) ? (p[key] as unknown[]) : []) {
              if (typeof id === 'string') ids.push(id);
            }
          }
        }
        await runtime.matching.onOccurrencesAvailable({
          workspaceId: event.workspaceId,
          occurrenceIds: [...new Set(ids)],
          eventId: event.eventId,
        });
      },
    },
    // add-subscriptions: cargos de suscripciones (detección de cambios de precio) y próxima renovación.
    {
      consumer: COMMITMENTS_CONSUMERS.subscriptionCharges,
      concurrency: 1,
      events: [
        { type: 'commitments.RecurringOccurrenceMaterialized', version: 1 },
        { type: 'commitments.RecurringOccurrenceChanged', version: 1 },
      ],
      handler: async (event) => {
        const p = payloadOf(event);
        const str = (key: string): string => (typeof p[key] === 'string' ? (p[key] as string) : '');
        if (event.eventType === 'commitments.RecurringOccurrenceMaterialized') {
          const amount = p['amount'] as { amount?: unknown; currency?: unknown } | undefined;
          if (typeof amount?.amount !== 'string' || typeof amount.currency !== 'string') return;
          await runtime.subscriptionCharges.onOccurrenceMaterialized({
            workspaceId: event.workspaceId,
            occurrenceId: str('occurrenceId'),
            definitionId: str('definitionId'),
            occurrenceDate: str('occurrenceDate'),
            managedBy: str('managedBy'),
            transactionId: str('transactionId'),
            amount: { amount: amount.amount, currency: amount.currency },
          });
          return;
        }
        await runtime.subscriptionCharges.onOccurrenceChanged({
          workspaceId: event.workspaceId,
          occurrenceId: str('occurrenceId'),
          definitionId: str('definitionId'),
          managedBy: str('managedBy'),
          transition: str('transition'),
        });
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

/**
 * Job `commitments.subscription-daily` (openspec add-subscriptions, decisión 12): recorre los workspaces activos y, por
 * cada uno, termina los trials vencidos, ejecuta las cancelaciones programadas y emite los recordatorios, con el actor
 * de proceso. Un workspace que falla no detiene a los demás; la ejecución siguiente lo reintenta.
 */
export async function runSubscriptionDaily(
  service: SubscriptionDailyService,
  workspaces: ActiveWorkspaceDirectory,
  logger: Pick<Logger, 'info' | 'error'>,
  trigger: 'cron' | 'startup' | 'manual',
): Promise<{
  readonly workspaces: number;
  readonly trialsEnded: number;
  readonly cancelled: number;
  readonly reminders: number;
  readonly failed: number;
}> {
  return runWithRequestContext(
    { actor: { type: 'WORKER', process: COMMITMENTS_SUBSCRIPTION_JOB }, origin: 'recurring' },
    async () => {
      let trialsEnded = 0;
      let cancelled = 0;
      let reminders = 0;
      let failed = 0;
      const all = await workspaces.list();
      for (const { workspaceId } of all) {
        try {
          const result = await service.runWorkspace(workspaceId);
          trialsEnded += result.trialsEnded;
          cancelled += result.cancelled;
          reminders += result.reminders;
          for (const f of result.failed) {
            failed += 1;
            logger.error(
              { workspaceId, subscriptionId: f.subscriptionId, error: f.error },
              'subscription item failed',
            );
          }
        } catch (err) {
          failed += 1;
          logger.error(
            {
              workspaceId,
              err: { type: err instanceof Error ? err.name : typeof err, message: String(err) },
            },
            'subscription daily failed for workspace',
          );
        }
      }
      logger.info(
        {
          job: COMMITMENTS_SUBSCRIPTION_JOB,
          trigger,
          workspaces: all.length,
          trialsEnded,
          cancelled,
          reminders,
          failed,
        },
        'subscriptions processed',
      );
      return { workspaces: all.length, trialsEnded, cancelled, reminders, failed };
    },
  );
}

export { RECURRING_DEFINITION_PORT };
export { COMMITMENTS_CONSUMERS, COMMITMENTS_GENERATE_JOB, COMMITMENTS_SUBSCRIPTION_JOB };
export { COMMITMENTS_AUDIT_POLICY } from '../contracts/index.js';
export type { GenerateOccurrencesService } from '../application/generate-occurrences.service.js';
export type { FinancialPeriodPort, OutboxPort, WorkspaceSettingsPort } from '../application/ports/index.js';
export type { CounterpartyNames } from '../application/ports/subscriptions.js';
export type { SubscriptionDailyService } from '../application/subscription-daily.service.js';
