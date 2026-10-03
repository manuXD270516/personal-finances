import { Module, type DynamicModule } from '@nestjs/common';
import type { AccountsQueryPort } from '@pf/accounts/contracts';
import type { AuditHistoryQuery, AuditPort } from '@pf/audit/contracts';
import type { ClassificationLookup, ClassificationValidator } from '@pf/classification/contracts';
import type { LedgerPostingPort } from '@pf/ledger/contracts';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import type { OutboxPort, TransactionsDeps } from '../application/ports/index.js';
import { TransactionsService } from '../application/transactions.service.js';
import {
  ClassificationCategoryLookup,
  PgTransactionRepository,
  PgTransactionsUnitOfWork,
  pgCurrencyCatalog,
  uuidV7Ids,
} from '../infrastructure/pg-transactions.js';
import { TRANSACTIONS_SERVICE, TransactionsController } from './transactions-http.js';

export interface TransactionsRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly history: AuditHistoryQuery;
  readonly outbox: OutboxPort;
  /** Puertos públicos de otros contextos (misma transacción BD, ARCHITECTURE §7). */
  readonly ledger: LedgerPostingPort;
  readonly accounts: AccountsQueryPort;
  readonly classification: ClassificationValidator;
  readonly lookup: ClassificationLookup;
}

export interface TransactionsRuntime {
  readonly service: TransactionsService;
}

/** Composición de TRANSACTIONS sobre PostgreSQL. */
export function createTransactionsRuntime(options: TransactionsRuntimeOptions): TransactionsRuntime {
  const deps: TransactionsDeps = {
    uow: new PgTransactionsUnitOfWork(options.pool),
    transactions: new PgTransactionRepository(),
    currencies: pgCurrencyCatalog,
    accounts: options.accounts,
    ledger: options.ledger,
    classification: options.classification,
    categories: new ClassificationCategoryLookup(options.lookup),
    outbox: options.outbox,
    audit: options.audit,
    history: options.history,
    ids: uuidV7Ids,
    clock: options.clock,
  };
  return { service: new TransactionsService(deps) };
}

export interface TransactionsModuleOptions {
  readonly runtime: TransactionsRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de TRANSACTIONS (`/transactions*`). */
@Module({})
export class TransactionsModule {
  static register(options: TransactionsModuleOptions): DynamicModule {
    return {
      module: TransactionsModule,
      controllers: [TransactionsController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: TRANSACTIONS_SERVICE, useValue: options.runtime.service },
      ],
    };
  }
}

export { TRANSACTIONS_AUDIT_POLICY } from '../contracts/index.js';
export type { OutboxPort };
