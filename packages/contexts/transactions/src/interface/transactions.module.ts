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
import type { LedgerOpeningBalanceQuery, LedgerPostingPort } from '@pf/ledger/contracts';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import type { OutboxPort, TransactionsDeps, WorkspaceCalendar } from '../application/ports/index.js';
import { ConversionsService } from '../application/conversions.service.js';
import { ReconciliationsService } from '../application/reconciliations.service.js';
import { TransactionsService } from '../application/transactions.service.js';
import { RECONCILIATION_LIFECYCLE, TRANSACTION_LIFECYCLE } from '../domain/index.js';
import {
  ClassificationCategoryLookup,
  PgTransactionRepository,
  PgTransactionsUnitOfWork,
  pgCurrencyCatalog,
  uuidV7Ids,
} from '../infrastructure/pg-transactions.js';
import { PgCounterpartyCategoryUsage, PgNominalFlowQuery } from '../infrastructure/pg-nominal-flows.js';
import { PgReconciliationRepository } from '../infrastructure/pg-reconciliations.js';
import type {
  CounterpartyCategoryUsageQuery,
  NominalFlowQuery,
  ReconciliationStatusQuery,
} from '../contracts/index.js';
import { CONVERSIONS_SERVICE, ConversionsController } from './conversions-http.js';
import { RECONCILIATIONS_SERVICE, ReconciliationsController } from './reconciliations-http.js';
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
  /** Saldo inicial de una cuenta en el ledger (add-reconciliation: base del saldo confirmado). */
  readonly openingBalance: LedgerOpeningBalanceQuery;
  /** Fecha de hoy en la zona horaria del workspace (add-reconciliation, RISK-020). */
  readonly calendar: WorkspaceCalendar;
}

export interface TransactionsRuntime {
  readonly service: TransactionsService;
  readonly conversions: ConversionsService;
  /** Sesiones de reconciliación (add-reconciliation). */
  readonly reconciliations: ReconciliationsService;
  /** Query pública `ReconciliationStatusQuery.getCoverage` para PLANNING (cierre de mes, decisión 9). */
  readonly reconciliationStatus: ReconciliationStatusQuery;
  /** Query pública `SummarizeNominalFlows` para Reporting (add-basic-dashboard). */
  readonly flows: NominalFlowQuery;
  /** Última categoría usada con una counterparty, para la sugerencia de CLASSIFICATION (add-classification). */
  readonly categoryUsage: CounterpartyCategoryUsageQuery;
}

/**
 * `SummarizeNominalFlows` para procesos sin comandos (el worker de PLANNING; openspec add-budgets): solo lee los
 * splits vigentes en la unidad de trabajo del llamador, sin puertos de escritura.
 */
export function createNominalFlowQuery(pool: Pool): NominalFlowQuery {
  return new PgNominalFlowQuery(new PgTransactionsUnitOfWork(pool), pgCurrencyCatalog);
}

/** Composición de TRANSACTIONS sobre PostgreSQL. */
export function createTransactionsRuntime(options: TransactionsRuntimeOptions): TransactionsRuntime {
  const transactionsRepository = new PgTransactionRepository();
  const deps: TransactionsDeps = {
    uow: new PgTransactionsUnitOfWork(options.pool),
    transactions: transactionsRepository,
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
    reconciliations: new PgReconciliationRepository(transactionsRepository),
    openingBalances: {
      openingBalance: (input) =>
        options.openingBalance.getOpeningBalance({
          workspaceId: input.workspaceId,
          accountId: input.accountId,
          asOf: input.asOf,
        }),
    },
    calendar: options.calendar,
  };
  const service = new TransactionsService(deps);
  const reconciliations = new ReconciliationsService(deps, service);
  return {
    service,
    conversions: new ConversionsService(deps),
    reconciliations,
    reconciliationStatus: reconciliations,
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
      controllers: [ConversionsController, ReconciliationsController, TransactionsController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: TRANSACTIONS_SERVICE, useValue: options.runtime.service },
        { provide: CONVERSIONS_SERVICE, useValue: options.runtime.conversions },
        { provide: RECONCILIATIONS_SERVICE, useValue: options.runtime.reconciliations },
      ],
    };
  }
}

export { TRANSACTIONS_AUDIT_POLICY } from '../contracts/index.js';

/** Máquina de estados `Transaction` declarada por el dominio (add-lifecycle-timeline), para AUDIT en el composition root. */
export const TRANSACTION_LIFECYCLE_MACHINE: LifecycleMachineDto = TRANSACTION_LIFECYCLE.definition;

/** Máquina de estados `Reconciliation` (add-reconciliation), para AUDIT en el composition root. */
export const RECONCILIATION_LIFECYCLE_MACHINE: LifecycleMachineDto = RECONCILIATION_LIFECYCLE.definition;
export type { OutboxPort };
