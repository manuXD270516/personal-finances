import { Module, type DynamicModule } from '@nestjs/common';
import type { AccountCatalogQuery, AccountProvisioningPort, AccountsQueryPort } from '@pf/accounts/contracts';
import type { AuditPort, LifecycleMachineDto, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { ClassificationValidator, CounterpartyCatalogQuery } from '@pf/classification/contracts';
import type { RecurringDefinitionPort } from '@pf/commitments/contracts';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import type { AccountBalancesQuery } from '@pf/ledger/contracts';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { LoanTransactionsPort } from '@pf/transactions/contracts';
import type { Pool } from 'pg';
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
import {
  PgDebtUnitOfWork,
  PgLoanRepository,
  PgPaymentRepository,
  PgReferenceRepository,
  PgScheduleRepository,
  pgCurrencyCatalog,
  uuidV7Ids,
} from '../infrastructure/pg-debt.js';
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

export interface DebtModuleOptions {
  readonly runtime: DebtRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de DEBT (`/loans*`). */
@Module({})
export class DebtModule {
  static register(options: DebtModuleOptions): DynamicModule {
    return {
      module: DebtModule,
      controllers: [LoansController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: LOANS_SERVICE, useValue: options.runtime.loans },
        { provide: PAYMENTS_SERVICE, useValue: options.runtime.payments },
        { provide: REFERENCES_SERVICE, useValue: options.runtime.references },
        { provide: LOANS_QUERIES, useValue: options.runtime.queries },
      ],
    };
  }
}

/** Máquina declarada por el dominio, para AUDIT en el composition root. */
export const LOAN_LIFECYCLE_MACHINE: LifecycleMachineDto = LOAN_LIFECYCLE.definition;

export { DEBT_AUDIT_POLICY, DEBT_EVENTS, LOAN_PORTFOLIO_QUERY } from '../contracts/index.js';
export type { OutboxPort } from '../application/ports/index.js';
