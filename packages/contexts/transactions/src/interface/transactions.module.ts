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
import { BulkEditService } from '../application/bulk-edit.service.js';
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
import { PgTransactionsClosingQuery } from '../infrastructure/pg-closing.js';
import { PgPendingFlowQuery, PgTransactionLinkQuery } from '../infrastructure/pg-recurring.js';
import { RecurringTransactionAdapter } from '../application/recurring-transaction.port.js';
import { LoanTransactionsAdapter } from '../application/loan-transactions.port.js';
import { ImportedTransactionsAdapter } from '../application/imported-transactions.adapter.js';
import {
  PgDuplicateCandidatesQuery,
  PgImportedRefReader,
  PgTransactionStatusQuery,
} from '../infrastructure/pg-imported.js';
import { PgReconciliationRepository } from '../infrastructure/pg-reconciliations.js';
import { LOAN_TRANSACTIONS_PORT } from '../contracts/index.js';
import type {
  CounterpartyCategoryUsageQuery,
  LoanTransactionsPort,
  DuplicateCandidatesQuery,
  ImportedTransactionsCommand,
  PendingFlowQuery,
  RecurringTransactionPort,
  TransactionLinkQuery,
  TransactionStatusQuery,
  NominalFlowQuery,
  ReconciliationStatusQuery,
  TransactionsClosingQuery,
} from '../contracts/index.js';
import { BULK_EDIT_SERVICE, BulkEditController } from './bulk-edit-http.js';
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
  /** Edición masiva de clasificación y `cleared` (add-bulk-edit). */
  readonly bulkEdit: BulkEditService;
  readonly conversions: ConversionsService;
  /** Sesiones de reconciliación (add-reconciliation). */
  readonly reconciliations: ReconciliationsService;
  /** Query pública `ReconciliationStatusQuery.getCoverage` para PLANNING (cierre de mes, decisión 9). */
  readonly reconciliationStatus: ReconciliationStatusQuery;
  /** Query pública `SummarizeNominalFlows` para Reporting (add-basic-dashboard). */
  readonly flows: NominalFlowQuery;
  /** Última categoría usada con una counterparty, para la sugerencia de CLASSIFICATION (add-classification). */
  readonly categoryUsage: CounterpartyCategoryUsageQuery;
  /** Query pública `TransactionsClosingQuery` para el checklist y el snapshot del cierre de PLANNING (add-month-closing). */
  readonly closing: TransactionsClosingQuery;
  /** Escritura para COMMITMENTS (add-recurrence-engine): crea la transacción de una ocurrencia en la UoW del llamador. */
  readonly recurring: RecurringTransactionPort;
  /** Escritura para DEBT (add-loans): desembolso y pago de préstamo administrados, en la UoW del llamador. */
  readonly loans: LoanTransactionsPort;
  /** Lectura de una transacción para vincularla a una ocurrencia (add-recurrence-engine). */
  readonly links: TransactionLinkQuery;
  /** Transacciones `PENDING` (add-recurrence-engine, comprometido del periodo). */
  readonly pending: PendingFlowQuery;
  /** Registro en lote de filas importadas, en la UoW del llamador (add-basic-csv-import). */
  readonly imported: ImportedTransactionsCommand;
  /** Candidatos a duplicado de un lote de filas de un extracto (add-basic-csv-import). */
  readonly duplicateCandidates: DuplicateCandidatesQuery;
  /** Estado actual de transacciones por id (add-basic-csv-import: vínculos superados). */
  readonly statuses: TransactionStatusQuery;
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
    bulkEdit: new BulkEditService(deps, service),
    conversions: new ConversionsService(deps),
    reconciliations,
    reconciliationStatus: reconciliations,
    flows: new PgNominalFlowQuery(deps.uow, deps.currencies),
    categoryUsage: new PgCounterpartyCategoryUsage(deps.uow),
    closing: new PgTransactionsClosingQuery(deps.uow, deps.currencies, deps.categories),
    recurring: new RecurringTransactionAdapter(service),
    loans: new LoanTransactionsAdapter(service),
    links: new PgTransactionLinkQuery(deps.uow, deps.currencies),
    pending: new PgPendingFlowQuery(deps.uow, deps.currencies),
    imported: new ImportedTransactionsAdapter(service, new PgImportedRefReader(), deps.uow),
    duplicateCandidates: new PgDuplicateCandidatesQuery(deps.uow, deps.currencies),
    statuses: new PgTransactionStatusQuery(deps.uow),
  };
}

/**
 * Lecturas de COMMITMENTS para procesos sin comandos (el worker; add-recurrence-engine): vincular y pendientes leen
 * solo en la unidad de trabajo del llamador, sin puertos de escritura.
 */
export function createPendingFlowQuery(pool: Pool): PendingFlowQuery {
  return new PgPendingFlowQuery(new PgTransactionsUnitOfWork(pool), pgCurrencyCatalog);
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
      controllers: [
        ConversionsController,
        ReconciliationsController,
        BulkEditController,
        TransactionsController,
      ],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: TRANSACTIONS_SERVICE, useValue: options.runtime.service },
        { provide: BULK_EDIT_SERVICE, useValue: options.runtime.bulkEdit },
        { provide: CONVERSIONS_SERVICE, useValue: options.runtime.conversions },
        { provide: RECONCILIATIONS_SERVICE, useValue: options.runtime.reconciliations },
        // Puerto de escritura de DEBT (add-loans): otros módulos Nest lo inyectan con `LOAN_TRANSACTIONS_PORT`.
        { provide: LOAN_TRANSACTIONS_PORT, useValue: options.runtime.loans },
      ],
      exports: [LOAN_TRANSACTIONS_PORT],
    };
  }
}

export { TRANSACTIONS_AUDIT_POLICY } from '../contracts/index.js';

/** Máquina de estados `Transaction` declarada por el dominio (add-lifecycle-timeline), para AUDIT en el composition root. */
export const TRANSACTION_LIFECYCLE_MACHINE: LifecycleMachineDto = TRANSACTION_LIFECYCLE.definition;

/** Máquina de estados `Reconciliation` (add-reconciliation), para AUDIT en el composition root. */
export const RECONCILIATION_LIFECYCLE_MACHINE: LifecycleMachineDto = RECONCILIATION_LIFECYCLE.definition;
export type { OutboxPort };
