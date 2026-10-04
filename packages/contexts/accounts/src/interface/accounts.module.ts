import { Module, type DynamicModule } from '@nestjs/common';
import type { AuditPort, LifecycleMachineDto, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { BalanceQuery } from '@pf/ledger/contracts';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { AccountCatalogQueries } from '../application/account-catalog.queries.js';
import { AccountsService } from '../application/accounts.service.js';
import { InstitutionsService } from '../application/institutions.service.js';
import { ACCOUNT_LIFECYCLE } from '../domain/index.js';
import type {
  AccountsDeps,
  BaseCurrencyValuationDeps,
  OutboxPort,
  TagCatalogPort,
  WorkspaceCalendar,
} from '../application/ports/index.js';
import {
  ACCOUNTS_QUERY_PORT,
  type AccountCatalogQuery,
  type AccountOpeningBalancePort,
  type AccountsQueryPort,
} from '../contracts/index.js';
import {
  LedgerBalancesAdapter,
  PgAccountRepository,
  PgAccountsUnitOfWork,
  PgInstitutionRepository,
  pgCurrencyCatalog,
  uuidV7Ids,
} from '../infrastructure/pg-accounts.js';
import {
  ACCOUNTS_SERVICE,
  AccountsController,
  INSTITUTIONS_SERVICE,
  InstitutionsController,
} from './accounts-http.js';

export interface AccountsRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  /** Auditoría + recorrido (add-lifecycle-timeline). */
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery: LifecycleQuery;
  readonly outbox: OutboxPort;
  /** Saldos (API pública de LEDGER). */
  readonly balances: BalanceQuery;
  /** Asiento de apertura (lo compone apps/api sobre `LedgerPostingPort`, ARCHITECTURE §7). */
  readonly openingBalance: AccountOpeningBalancePort;
  /** Fecha de negocio "hoy" en la zona del workspace. */
  readonly calendar: WorkspaceCalendar;
  /** Catálogo de etiquetas (Classification); por defecto acepta cualquier id (design.md §Implementación). */
  readonly tags?: TagCatalogPort;
  /**
   * Equivalente en moneda base (`FxValuationPort` de `@pf/fx/contracts` + moneda base/zona de IDENTITY). Ausente ⇒
   * `baseCurrencyBalance: null`.
   */
  readonly valuation?: BaseCurrencyValuationDeps;
}

export interface AccountsRuntime {
  readonly accounts: AccountsService;
  readonly institutions: InstitutionsService;
  /** Puerto público para Transactions (INV-026). */
  readonly query: AccountsQueryPort;
  /** Catálogo de cuentas para Reporting (openspec add-basic-dashboard). */
  readonly catalog: AccountCatalogQuery;
}

/** Composición de ACCOUNTS sobre PostgreSQL (misma transacción que la `PgUnitOfWork` de cada comando). */
export function createAccountsRuntime(options: AccountsRuntimeOptions): AccountsRuntime {
  const deps: AccountsDeps = {
    uow: new PgAccountsUnitOfWork(options.pool),
    accounts: new PgAccountRepository(),
    institutions: new PgInstitutionRepository(),
    currencies: pgCurrencyCatalog,
    balances: new LedgerBalancesAdapter(options.balances),
    tags: options.tags ?? { assertAssignable: async () => undefined },
    openingBalance: options.openingBalance,
    outbox: options.outbox,
    audit: options.audit,
    lifecycle: options.lifecycle,
    lifecycleQuery: options.lifecycleQuery,
    ids: uuidV7Ids,
    clock: options.clock,
    calendar: options.calendar,
    ...(options.valuation ? { valuation: options.valuation } : {}),
  };
  const accounts = new AccountsService(deps);
  return {
    accounts,
    institutions: new InstitutionsService(deps, options.audit),
    query: {
      getPostingEligibility: (input) => accounts.getPostingEligibility(input.workspaceId, input.accountIds),
      assertCanPost: (input) => accounts.assertCanPost(input.workspaceId, input.accounts),
    },
    catalog: new AccountCatalogQueries(deps),
  };
}

export interface AccountsModuleOptions {
  readonly runtime: AccountsRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de ACCOUNTS (`/accounts*`, `/institutions*`); exporta `ACCOUNTS_QUERY_PORT`. */
@Module({})
export class AccountsModule {
  static register(options: AccountsModuleOptions): DynamicModule {
    return {
      module: AccountsModule,
      controllers: [AccountsController, InstitutionsController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: ACCOUNTS_SERVICE, useValue: options.runtime.accounts },
        { provide: INSTITUTIONS_SERVICE, useValue: options.runtime.institutions },
        { provide: ACCOUNTS_QUERY_PORT, useValue: options.runtime.query },
      ],
      exports: [ACCOUNTS_QUERY_PORT],
    };
  }
}

/** Máquina de estados `Account` declarada por el dominio (add-lifecycle-timeline), para AUDIT en el composition root. */
export const ACCOUNT_LIFECYCLE_MACHINE: LifecycleMachineDto = ACCOUNT_LIFECYCLE.definition;

export type {
  AccountOpeningBalancePort,
  AccountsQueryPort,
  BaseCurrencyValuationDeps,
  OutboxPort,
  TagCatalogPort,
  WorkspaceCalendar,
};
