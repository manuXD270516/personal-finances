import { Module, type DynamicModule } from '@nestjs/common';
import type { AccountsQueryPort } from '@pf/accounts/contracts';
import type {
  AuditHistoryQuery,
  AuditPort,
  LifecycleMachineDto,
  LifecyclePort,
  LifecycleQuery,
} from '@pf/audit/contracts';
import type { ClassificationLookup, ClassificationValidator } from '@pf/classification/contracts';
import type { FxConversionPricingPort } from '@pf/fx/contracts';
import type { LedgerPostingPort } from '@pf/ledger/contracts';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import type { OutboxPort, TransactionsDeps } from '../application/ports/index.js';
import { ConversionsService } from '../application/conversions.service.js';
import { TransactionsService } from '../application/transactions.service.js';
import { TRANSACTION_LIFECYCLE } from '../domain/index.js';
import {
  ClassificationCategoryLookup,
  PgTransactionRepository,
  PgTransactionsUnitOfWork,
  pgCurrencyCatalog,
  uuidV7Ids,
} from '../infrastructure/pg-transactions.js';
import { PgCounterpartyCategoryUsage, PgNominalFlowQuery } from '../infrastructure/pg-nominal-flows.js';
import type { CounterpartyCategoryUsageQuery, NominalFlowQuery } from '../contracts/index.js';
import { CONVERSIONS_SERVICE, ConversionsController } from './conversions-http.js';
import { TRANSACTIONS_SERVICE, TransactionsController } from './transactions-http.js';

export interface TransactionsRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly history: AuditHistoryQuery;
  /** Auditoría + recorrido (add-lifecycle-timeline). */
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery: LifecycleQuery;
  readonly outbox: OutboxPort;
  /** Puertos públicos de otros contextos (misma transacción BD, ARCHITECTURE §7). */
  readonly ledger: LedgerPostingPort;
  readonly accounts: AccountsQueryPort;
  readonly classification: ClassificationValidator;
  readonly lookup: ClassificationLookup;
  /** Pricing de conversiones de FX (`@pf/fx/contracts`, misma unidad de trabajo). */
  readonly fx: FxConversionPricingPort;
}

export interface TransactionsRuntime {
  readonly service: TransactionsService;
  readonly conversions: ConversionsService;
  /** Query pública `SummarizeNominalFlows` para Reporting (add-basic-dashboard). */
  readonly flows: NominalFlowQuery;
  /** Última categoría usada con una counterparty, para la sugerencia de CLASSIFICATION (add-classification). */
  readonly categoryUsage: CounterpartyCategoryUsageQuery;
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
    fx: options.fx,
    outbox: options.outbox,
    audit: options.audit,
    history: options.history,
    lifecycle: options.lifecycle,
    lifecycleQuery: options.lifecycleQuery,
    ids: uuidV7Ids,
    clock: options.clock,
  };
  return {
    service: new TransactionsService(deps),
    conversions: new ConversionsService(deps),
    flows: new PgNominalFlowQuery(deps.uow, deps.currencies),
    categoryUsage: new PgCounterpartyCategoryUsage(deps.uow),
  };
}

export interface TransactionsModuleOptions {
  readonly runtime: TransactionsRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de TRANSACTIONS (`/transactions*`, `/transfers`, `/conversions*`). */
@Module({})
export class TransactionsModule {
  static register(options: TransactionsModuleOptions): DynamicModule {
    return {
      module: TransactionsModule,
      // ConversionsController primero: `/conversions/preview` antes que `/conversions/:transactionId`.
      controllers: [ConversionsController, TransactionsController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: TRANSACTIONS_SERVICE, useValue: options.runtime.service },
        { provide: CONVERSIONS_SERVICE, useValue: options.runtime.conversions },
      ],
    };
  }
}

export { TRANSACTIONS_AUDIT_POLICY } from '../contracts/index.js';

/** Máquina de estados `Transaction` declarada por el dominio (add-lifecycle-timeline), para AUDIT en el composition root. */
export const TRANSACTION_LIFECYCLE_MACHINE: LifecycleMachineDto = TRANSACTION_LIFECYCLE.definition;
export type { OutboxPort };
