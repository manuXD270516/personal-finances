import { Module, type DynamicModule } from '@nestjs/common';
import type { AccountCatalogQuery, AccountProvisioningPort, AccountsQueryPort } from '@pf/accounts/contracts';
import type { AuditPort, LifecycleMachineDto, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { ClassificationValidator, CounterpartyCatalogQuery } from '@pf/classification/contracts';
import type { RecurringDefinitionPort, RecurringDefinitionQuery } from '@pf/commitments/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import type { AccountBalanceHistoryQuery, AccountBalancesQuery } from '@pf/ledger/contracts';
import { runWithRequestContext } from '@pf/platform/api';
import type { EventConsumerDefinition } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type {
  AccountMovementsQuery,
  LoanTransactionsPort,
  PendingFlowQuery,
  TransactionLinkQuery,
} from '@pf/transactions/contracts';
import type { Pool } from 'pg';
import { CardActivityService } from '../application/card-activity.handler.js';
import { CardDailyService } from '../application/card-daily.runner.js';
import type { CardBalancePort, CardDeps, CardSettings } from '../application/card-ports.js';
import { CardsQueries } from '../application/cards.queries.js';
import { CardsService } from '../application/cards.service.js';
import { InstallmentsService } from '../application/installments.service.js';
import { LoansQueries } from '../application/loans.queries.js';
import { LoansService } from '../application/loans.service.js';
import { PaymentsService } from '../application/payments.service.js';
import type {
  AccountsPort,
  BalancePort,
  CounterpartyPort,
  DebtDeps,
  DebtSettings,
  OutboxPort,
} from '../application/ports/index.js';
import { ReferencesService } from '../application/references.service.js';
import { LOAN_LIFECYCLE } from '../domain/index.js';
import { DEBT_CARD_DAILY_JOB, DEBT_CONSUMERS } from '../contracts/index.js';
import {
  PgCardRepository,
  PgInstallmentPlanRepository,
  PgReminderRepository,
  PgStatementRepository,
  PgUtilizationRepository,
} from '../infrastructure/pg-cards.js';
import {
  PgDebtUnitOfWork,
  PgLoanRepository,
  PgPaymentRepository,
  PgReferenceRepository,
  PgScheduleRepository,
  pgCurrencyCatalog,
  uuidV7Ids,
} from '../infrastructure/pg-debt.js';
import { CARDS_QUERIES, CARDS_SERVICE, CreditCardsController, INSTALLMENTS_SERVICE } from './cards-http.js';
import {
  LOANS_QUERIES,
  LOANS_SERVICE,
  LoansController,
  PAYMENTS_SERVICE,
  REFERENCES_SERVICE,
} from './debt-http.js';

export const DEFAULT_DEBT_SETTINGS: DebtSettings = {
  maxReferenceBytes: 256 * 1024,
  maxReferenceRows: 600,
};

export interface DebtRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  /** Auditoría + recorrido (add-lifecycle-timeline). */
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery?: LifecycleQuery;
  readonly outbox: OutboxPort;
  readonly calendar: WorkspaceCalendarQuery;
  readonly accounts: AccountsQueryPort;
  readonly accountCatalog: Pick<AccountCatalogQuery, 'listAccounts'>;
  readonly provisioning: AccountProvisioningPort;
  readonly balances: AccountBalancesQuery;
  readonly classification: ClassificationValidator;
  readonly counterparties: CounterpartyCatalogQuery;
  /** Puertos públicos de TRANSACTIONS y COMMITMENTS. */
  readonly transactions: LoanTransactionsPort;
  readonly recurring: RecurringDefinitionPort;
  readonly settings?: Partial<DebtSettings>;
}

export interface DebtRuntime {
  readonly loans: LoansService;
  readonly payments: PaymentsService;
  readonly references: ReferencesService;
  readonly queries: LoansQueries;
}

/** Composición de DEBT sobre PostgreSQL (misma transacción que la `PgUnitOfWork` de cada comando). */
export function createDebtRuntime(options: DebtRuntimeOptions): DebtRuntime {
  const accounts: AccountsPort = {
    async find(workspaceId, accountIds) {
      const all = await options.accountCatalog.listAccounts({ workspaceId, includeArchived: true });
      const wanted = new Set(accountIds);
      return all
        .filter((a) => wanted.has(a.accountId))
        .map((a) => ({
          accountId: a.accountId,
          name: a.name,
          type: a.type,
          nature: a.nature,
          currency: a.currency,
          status: a.status,
        }));
    },
    async assertCanPost(workspaceId, list) {
      await options.accounts.assertCanPost({ workspaceId, accounts: list });
    },
  };
  const balances: BalancePort = {
    async presentedBalance(workspaceId, accountId, asOf) {
      const result = await options.balances.getAccountBalances({
        workspaceId,
        accountIds: [accountId],
        ...(asOf ? { asOf } : {}),
      });
      return result.balances.find((b) => b.accountId === accountId)?.presented.amount ?? '0';
    },
    async presentedBalances(workspaceId, accountIds) {
      const result = await options.balances.getAccountBalances({ workspaceId, accountIds: [...accountIds] });
      return new Map(
        result.balances
          .filter((b) => b.accountId !== null)
          .map((b) => [b.accountId as string, b.presented.amount] as const),
      );
    },
  };
  const counterparties: CounterpartyPort = {
    async assertUsable(userId, workspaceId, counterpartyId) {
      await options.classification.validate({ userId, workspaceId, counterpartyId });
    },
    async names(workspaceId, ids) {
      const found = await options.counterparties.counterpartiesByIds({ workspaceId, counterpartyIds: ids });
      return new Map(found.map((c) => [c.counterpartyId, c.name] as const));
    },
  };
  const deps: DebtDeps = {
    uow: new PgDebtUnitOfWork(options.pool),
    loans: new PgLoanRepository(),
    schedules: new PgScheduleRepository(),
    payments: new PgPaymentRepository(),
    references: new PgReferenceRepository(),
    accounts,
    provisioning: options.provisioning,
    balances,
    counterparties,
    currencies: pgCurrencyCatalog,
    calendar: {
      timeZoneOf: async (workspaceId) => (await options.calendar.calendarOf(workspaceId)).timeZone,
    },
    transactions: options.transactions,
    recurring: options.recurring,
    audit: options.audit,
    lifecycle: options.lifecycle,
    ...(options.lifecycleQuery ? { lifecycleQuery: options.lifecycleQuery } : {}),
    outbox: options.outbox,
    ids: uuidV7Ids,
    clock: options.clock,
    settings: { ...DEFAULT_DEBT_SETTINGS, ...options.settings },
  };
  const loans = new LoansService(deps);
  const references = new ReferencesService(deps);
  loans.comparisonHook = (workspaceId, loan, scale) => references.snapshotLatest(workspaceId, loan, scale);
  return {
    loans,
    payments: new PaymentsService(deps),
    references,
    queries: new LoansQueries(deps),
  };
}

export interface CardsRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly outbox: OutboxPort;
  readonly calendar: WorkspaceCalendarQuery;
  readonly accounts: AccountsQueryPort;
  readonly accountCatalog: Pick<AccountCatalogQuery, 'listAccounts'>;
  /** Saldos presentados a varias fechas (INV-022). */
  readonly balanceHistory: AccountBalanceHistoryQuery;
  readonly movements: AccountMovementsQuery;
  readonly pending: PendingFlowQuery;
  readonly links: TransactionLinkQuery;
  readonly recurring: RecurringDefinitionPort;
  readonly recurringQuery: RecurringDefinitionQuery;
  readonly rates: Pick<FxValuationPort, 'resolveValuationRates'>;
  /** Ventana de vigencia de las tasas de valoración (`REPORTING_RATE_VALIDITY_WINDOW`). */
  readonly rateValidityWindowDays: number;
  readonly settings?: Partial<CardSettings>;
}

export const DEFAULT_CARD_SETTINGS: Omit<CardSettings, 'rateValidityWindowDays'> = {
  historyCycles: 12,
  planHorizonDays: 90,
};

export interface CardsRuntime {
  readonly cards: CardsService;
  readonly queries: CardsQueries;
  readonly installments: InstallmentsService;
  readonly activity: CardActivityService;
  readonly daily: CardDailyService;
}

/** Composición de las tarjetas sobre PostgreSQL y los contratos públicos de los demás contextos. */
export function createCardsRuntime(options: CardsRuntimeOptions): CardsRuntime {
  const accounts: AccountsPort = {
    async find(workspaceId, accountIds) {
      const all = await options.accountCatalog.listAccounts({ workspaceId, includeArchived: true });
      const wanted = new Set(accountIds);
      return all
        .filter((a) => wanted.has(a.accountId))
        .map((a) => ({
          accountId: a.accountId,
          name: a.name,
          type: a.type,
          nature: a.nature,
          currency: a.currency,
          status: a.status,
        }));
    },
    async assertCanPost(workspaceId, list) {
      await options.accounts.assertCanPost({ workspaceId, accounts: list });
    },
  };
  const balances: CardBalancePort = {
    async at(workspaceId, accountId, dates) {
      const result = await options.balanceHistory.getAccountBalancesAtDates({
        workspaceId,
        accountIds: [accountId],
        dates: [...dates],
      });
      return new Map(
        result.byDate.map(
          (d) =>
            [d.asOf, d.balances.find((b) => b.accountId === accountId)?.presented.amount ?? '0'] as const,
        ),
      );
    },
    async today() {
      return new Map();
    },
  };
  const deps: CardDeps = {
    uow: new PgDebtUnitOfWork(options.pool),
    cards: new PgCardRepository(),
    statements: new PgStatementRepository(),
    plans: new PgInstallmentPlanRepository(),
    utilization: new PgUtilizationRepository(),
    reminders: new PgReminderRepository(),
    accounts,
    balances,
    movements: options.movements,
    pending: options.pending,
    links: options.links,
    recurring: options.recurring,
    recurringQuery: options.recurringQuery,
    rates: options.rates,
    calendar: {
      timeZoneOf: async (workspaceId) => (await options.calendar.calendarOf(workspaceId)).timeZone,
    },
    currencies: pgCurrencyCatalog,
    audit: options.audit,
    outbox: options.outbox,
    ids: uuidV7Ids,
    clock: options.clock,
    settings: {
      ...DEFAULT_CARD_SETTINGS,
      rateValidityWindowDays: options.rateValidityWindowDays,
      ...options.settings,
    },
  };
  return {
    cards: new CardsService(deps),
    queries: new CardsQueries(deps),
    installments: new InstallmentsService(deps),
    activity: new CardActivityService(deps),
    daily: new CardDailyService(deps),
  };
}

/**
 * Consumidor del worker (inbox en la misma transacción, INV-028): `debt.card-activity` reacciona a los movimientos de
 * las cuentas de tarjeta (compras, pagos, reversas) y a las compras pendientes, anuladas o corregidas. Filtra en
 * memoria por las cuentas de tarjeta activas. Usa `concurrency: 1` (D112): la ráfaga se serializa por agregado y no
 * reserva conexiones adicionales del pool del worker.
 */
export function debtEventConsumers(runtime: CardsRuntime): EventConsumerDefinition[] {
  return [
    {
      consumer: DEBT_CONSUMERS.cardActivity,
      concurrency: 1,
      events: [
        { type: 'ledger.JournalEntryPosted', version: 1 },
        { type: 'transactions.TransactionCreated', version: 1 },
        { type: 'transactions.TransactionUpdated', version: 1 },
        { type: 'transactions.TransactionVoided', version: 1 },
      ],
      handler: async (event) => {
        await runtime.activity.onEvent({
          workspaceId: event.workspaceId,
          eventType: event.eventType,
          eventId: event.eventId,
          payload: event.payload,
        });
      },
    },
  ];
}

export interface ActiveWorkspaceDirectory {
  list(): Promise<readonly { readonly workspaceId: string }[]>;
}

/**
 * Job `debt.card-daily` (decisiones 5 y 8): recorre los workspaces activos con el actor de proceso. Un workspace que
 * falla no detiene a los demás; la ejecución siguiente lo reintenta.
 */
export async function runCardDaily(
  service: CardDailyService,
  workspaces: ActiveWorkspaceDirectory,
  logger: Pick<Logger, 'info' | 'error'>,
  trigger: 'cron' | 'startup' | 'manual',
): Promise<{
  readonly workspaces: number;
  readonly issued: number;
  readonly reminders: number;
  readonly failed: number;
}> {
  return runWithRequestContext(
    { actor: { type: 'WORKER', process: DEBT_CARD_DAILY_JOB }, origin: 'recurring' },
    async () => {
      let issued = 0;
      let reminders = 0;
      let failed = 0;
      const all = await workspaces.list();
      for (const { workspaceId } of all) {
        try {
          const result = await service.runWorkspace(workspaceId);
          issued += result.issued;
          reminders += result.reminders;
          for (const f of result.failed) {
            failed += 1;
            logger.error({ workspaceId, cardId: f.cardId, error: f.error }, 'credit card item failed');
          }
        } catch (err) {
          failed += 1;
          logger.error(
            {
              workspaceId,
              err: { type: err instanceof Error ? err.name : typeof err, message: String(err) },
            },
            'card daily failed for workspace',
          );
        }
      }
      logger.info(
        { job: DEBT_CARD_DAILY_JOB, trigger, workspaces: all.length, issued, reminders, failed },
        'cards processed',
      );
      return { workspaces: all.length, issued, reminders, failed };
    },
  );
}

export interface DebtModuleOptions {
  readonly runtime: DebtRuntime;
  readonly cards: CardsRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de DEBT (`/loans*`). */
@Module({})
export class DebtModule {
  static register(options: DebtModuleOptions): DynamicModule {
    return {
      module: DebtModule,
      controllers: [LoansController, CreditCardsController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: LOANS_SERVICE, useValue: options.runtime.loans },
        { provide: PAYMENTS_SERVICE, useValue: options.runtime.payments },
        { provide: REFERENCES_SERVICE, useValue: options.runtime.references },
        { provide: LOANS_QUERIES, useValue: options.runtime.queries },
        { provide: CARDS_SERVICE, useValue: options.cards.cards },
        { provide: CARDS_QUERIES, useValue: options.cards.queries },
        { provide: INSTALLMENTS_SERVICE, useValue: options.cards.installments },
      ],
    };
  }
}

/** Máquina declarada por el dominio, para AUDIT en el composition root. */
export const LOAN_LIFECYCLE_MACHINE: LifecycleMachineDto = LOAN_LIFECYCLE.definition;

export {
  CARD_PORTFOLIO_QUERY,
  DEBT_AUDIT_POLICY,
  DEBT_CARD_DAILY_JOB,
  DEBT_CONSUMERS,
  DEBT_EVENTS,
  LOAN_PORTFOLIO_QUERY,
} from '../contracts/index.js';
export type { OutboxPort } from '../application/ports/index.js';
