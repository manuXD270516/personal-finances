import { Module, type DynamicModule } from '@nestjs/common';
import type { AccountCatalogQuery } from '@pf/accounts/contracts';
import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { RecurringDefinitionPort } from '@pf/commitments/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import type { AccountBalancesQuery } from '@pf/ledger/contracts';
import { runWithRequestContext } from '@pf/platform/api';
import type { EventConsumerDefinition } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import { LocalDate, type Clock } from '@pf/shared-kernel';
import type { GoalTransferPort, TransactionLinkQuery } from '@pf/transactions/contracts';
import type { Pool } from 'pg';
import { GoalsQueries } from '../application/goals.queries.js';
import { GoalsService } from '../application/goals.service.js';
import { MovementsService } from '../application/movements.service.js';
import { PlanService } from '../application/plan.service.js';
import type { GoalsDeps, GoalsSettings, OutboxPort } from '../application/ports/index.js';
import { GoalReactions } from '../application/reactions.js';
import { GOALS_CONSUMERS, GOALS_DAILY_JOB } from '../contracts/index.js';
import { GOAL_LIFECYCLE } from '../domain/index.js';
import {
  PgGoalRepository,
  PgGoalsUnitOfWork,
  PgMaterializationRepository,
  PgMovementRepository,
  PgPlanRepository,
  PgReservationStateRepository,
  PgSuggestionRepository,
  pgScaleOf,
  uuidV7Ids,
} from '../infrastructure/pg-goals.js';
import {
  GOALS_MOVEMENTS_SERVICE,
  GOALS_PLAN_SERVICE,
  GOALS_QUERIES,
  GOALS_SERVICE,
  GoalsController,
} from './goals-http.js';

export const DEFAULT_GOALS_SETTINGS: Omit<GoalsSettings, 'rateValidityWindowDays'> = { pageSize: 50 };

export interface GoalsRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  /** Auditoría + recorrido (add-lifecycle-timeline). */
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery?: LifecycleQuery;
  readonly outbox: OutboxPort;
  readonly calendar: WorkspaceCalendarQuery;
  readonly accountCatalog: Pick<AccountCatalogQuery, 'listAccounts'>;
  readonly balances: AccountBalancesQuery;
  readonly rates: Pick<FxValuationPort, 'resolveValuationRates' | 'enabledCurrencies'>;
  /** Puertos públicos de TRANSACTIONS y COMMITMENTS. */
  readonly transfers: GoalTransferPort;
  readonly links: TransactionLinkQuery;
  readonly recurring: RecurringDefinitionPort;
  /** Ventana de vigencia de las tasas de valoración (`REPORTING_RATE_VALIDITY_WINDOW`). */
  readonly rateValidityWindowDays: number;
  readonly settings?: Partial<GoalsSettings>;
}

export interface GoalsRuntime {
  readonly goals: GoalsService;
  readonly movements: MovementsService;
  readonly plans: PlanService;
  readonly queries: GoalsQueries;
  readonly reactions: GoalReactions;
}

/** Composición de GOALS sobre PostgreSQL y los contratos públicos de los demás contextos. */
export function createGoalsRuntime(options: GoalsRuntimeOptions): GoalsRuntime {
  const deps: GoalsDeps = {
    uow: new PgGoalsUnitOfWork(options.pool),
    goals: new PgGoalRepository(),
    movements: new PgMovementRepository(),
    plans: new PgPlanRepository(),
    reservations: new PgReservationStateRepository(),
    materializations: new PgMaterializationRepository(),
    suggestions: new PgSuggestionRepository(),
    accounts: {
      async find(workspaceId, accountIds) {
        const all = await options.accountCatalog.listAccounts({ workspaceId, includeArchived: true });
        const wanted = new Set(accountIds);
        return all
          .filter((a) => wanted.has(a.accountId))
          .map((a) => ({
            accountId: a.accountId,
            name: a.name,
            nature: a.nature,
            currency: a.currency,
            status: a.status,
          }));
      },
    },
    balances: {
      async presentedBalances(workspaceId, accountIds) {
        // `asOf` explícito: sin él el ledger lee la zona horaria del workspace con el usuario de la petición, que el
        // worker (sin usuario) no tiene. "Hoy" sale del calendario por actor de la composición.
        const calendar = await options.calendar.calendarOf(workspaceId);
        const asOf = LocalDate.ofInstant(options.clock.now(), calendar.timeZone).toString();
        const result = await options.balances.getAccountBalances({
          workspaceId,
          accountIds: [...accountIds],
          asOf,
        });
        return new Map(
          result.balances
            .filter((b) => b.accountId !== null)
            .map((b) => [b.accountId as string, b.presented.amount] as const),
        );
      },
    },
    currencies: {
      scaleOf: pgScaleOf,
      async isEnabled(workspaceId, code) {
        return (await options.rates.enabledCurrencies(workspaceId)).some((c) => c.code === code);
      },
    },
    calendar: {
      async calendarOf(workspaceId) {
        const c = await options.calendar.calendarOf(workspaceId);
        return { timeZone: c.timeZone, startDay: c.fiscalMonthStartDay };
      },
    },
    valuation: {
      resolve: (input) =>
        options.rates.resolveValuationRates({
          workspaceId: input.workspaceId,
          requests: input.requests,
          windowDays: input.windowDays,
        }),
    },
    transfers: options.transfers,
    links: options.links,
    recurring: options.recurring,
    audit: options.audit,
    lifecycle: options.lifecycle,
    ...(options.lifecycleQuery ? { lifecycleQuery: options.lifecycleQuery } : {}),
    outbox: options.outbox,
    ids: uuidV7Ids,
    clock: options.clock,
    settings: {
      ...DEFAULT_GOALS_SETTINGS,
      rateValidityWindowDays: options.rateValidityWindowDays,
      ...options.settings,
    },
  };
  return {
    goals: new GoalsService(deps),
    movements: new MovementsService(deps),
    plans: new PlanService(deps),
    queries: new GoalsQueries(deps),
    reactions: new GoalReactions(deps),
  };
}

/**
 * Consumidores del worker (inbox en la misma transacción, INV-028). Cada uno usa `concurrency: 1` (D112): las ráfagas
 * se serializan por agregado y no reservan conexiones adicionales del pool del worker.
 */
export function goalsEventConsumers(runtime: Pick<GoalsRuntime, 'reactions'>): EventConsumerDefinition[] {
  const wrap =
    (
      handler: (e: {
        workspaceId: string;
        eventType: string;
        eventId: string;
        payload: unknown;
      }) => Promise<void>,
    ) =>
    async (event: { workspaceId: string; eventType: string; eventId: string; payload: unknown }) => {
      await handler({
        workspaceId: event.workspaceId,
        eventType: event.eventType,
        eventId: event.eventId,
        payload: event.payload,
      });
    };
  const r = runtime.reactions;
  return [
    {
      consumer: GOALS_CONSUMERS.transactionChanges,
      concurrency: 1,
      events: [
        { type: 'transactions.TransactionVoided', version: 1 },
        { type: 'transactions.TransferRevised', version: 1 },
        { type: 'transactions.TransactionUpdated', version: 1 },
      ],
      handler: wrap((e) => r.onTransactionChange(e)),
    },
    {
      consumer: GOALS_CONSUMERS.balanceWatch,
      concurrency: 1,
      events: [{ type: 'ledger.JournalEntryPosted', version: 1 }],
      handler: wrap((e) => r.onJournalEntryPosted(e)),
    },
    {
      consumer: GOALS_CONSUMERS.recurringContributions,
      concurrency: 1,
      events: [{ type: 'commitments.RecurringOccurrenceMaterialized', version: 1 }],
      handler: wrap((e) => r.onOccurrenceMaterialized(e)),
    },
    {
      consumer: GOALS_CONSUMERS.contributionSuggestions,
      concurrency: 1,
      events: [{ type: 'transactions.TransferCompleted', version: 1 }],
      handler: wrap((e) => r.onTransferCompleted(e)),
    },
  ];
}

export interface ActiveWorkspaceDirectory {
  list(): Promise<readonly { readonly workspaceId: string }[]>;
}

/**
 * Job `goals.daily-evaluation` (decisiones 6 y 15): recorre los workspaces activos con el actor de proceso. Un workspace
 * que falla no detiene a los demás; la ejecución siguiente lo reintenta.
 */
export async function runGoalsDaily(
  reactions: Pick<GoalReactions, 'runDaily'>,
  workspaces: ActiveWorkspaceDirectory,
  logger: Pick<Logger, 'info' | 'error'>,
  trigger: 'cron' | 'startup' | 'manual',
): Promise<{ readonly workspaces: number; readonly reached: number; readonly failed: number }> {
  return runWithRequestContext(
    { actor: { type: 'WORKER', process: GOALS_DAILY_JOB }, origin: 'recurring' },
    async () => {
      let reached = 0;
      let failed = 0;
      const all = await workspaces.list();
      for (const { workspaceId } of all) {
        try {
          reached += (await reactions.runDaily(workspaceId)).reached;
        } catch (err) {
          failed += 1;
          logger.error(
            {
              workspaceId,
              err: { type: err instanceof Error ? err.name : typeof err, message: String(err) },
            },
            'goals daily evaluation failed for workspace',
          );
        }
      }
      logger.info(
        { job: GOALS_DAILY_JOB, trigger, workspaces: all.length, reached, failed },
        'goals evaluated',
      );
      return { workspaces: all.length, reached, failed };
    },
  );
}

export interface GoalsModuleOptions {
  readonly runtime: GoalsRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de GOALS (`/goals*`). */
@Module({})
export class GoalsModule {
  static register(options: GoalsModuleOptions): DynamicModule {
    return {
      module: GoalsModule,
      controllers: [GoalsController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: GOALS_SERVICE, useValue: options.runtime.goals },
        { provide: GOALS_MOVEMENTS_SERVICE, useValue: options.runtime.movements },
        { provide: GOALS_PLAN_SERVICE, useValue: options.runtime.plans },
        { provide: GOALS_QUERIES, useValue: options.runtime.queries },
      ],
    };
  }
}

/** Máquina declarada por el dominio, para AUDIT en el composition root. */
export const GOAL_LIFECYCLE_MACHINE = GOAL_LIFECYCLE.definition;

export {
  GOALS_AUDIT_POLICY,
  GOALS_CONSUMERS,
  GOALS_DAILY_JOB,
  GOALS_EVENTS,
  GOAL_FLOWS_QUERY,
  GOAL_PLANS_QUERY,
  GOAL_RESERVATIONS_QUERY,
  GOAL_SUMMARY_QUERY,
} from '../contracts/index.js';
export type { OutboxPort } from '../application/ports/index.js';
