import type { AuditPort } from '@pf/audit/contracts';
import type { OutboxWriter } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { LedgerService } from '../application/ledger.service.js';
import type { BalanceQuery, LedgerPeriodLockPort, LedgerPostingPort } from '../contracts/index.js';
import { PgBalanceQuery } from '../infrastructure/pg-balance.queries.js';
import {
  PgJournalEntryRepository,
  PgLedgerAccountRepository,
  PgLedgerUnitOfWork,
  PgPeriodLockRepository,
  pgCurrencyCatalog,
  platformLedgerContext,
  uuidV7Ids,
  type LedgerMetrics,
} from '../infrastructure/pg-ledger.js';

export interface LedgerRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  readonly outbox: OutboxWriter;
  readonly logger?: Logger;
  readonly metrics?: LedgerMetrics;
}

/** Puertos públicos de LEDGER ya compuestos (los consumen Accounts/Transactions/Reporting y Planning en Phase 2). */
export interface LedgerRuntime {
  readonly posting: LedgerPostingPort;
  readonly periodLock: LedgerPeriodLockPort;
  readonly balances: BalanceQuery;
}

/**
 * Composición de LEDGER sobre PostgreSQL. Sin módulo HTTP en este change: el ledger es invisible para el usuario y
 * el endpoint técnico de balance de comprobación (Could, tarea 6.3) queda pendiente.
 */
export function createLedgerRuntime(options: LedgerRuntimeOptions): LedgerRuntime {
  const uow = new PgLedgerUnitOfWork(options.pool, options.logger, options.metrics);
  const accounts = new PgLedgerAccountRepository(uuidV7Ids, pgCurrencyCatalog);
  const service = new LedgerService(
    {
      uow,
      currencies: pgCurrencyCatalog,
      accounts,
      entries: new PgJournalEntryRepository(accounts),
      periods: new PgPeriodLockRepository(),
      outbox: options.outbox,
      ids: uuidV7Ids,
      clock: options.clock,
      context: platformLedgerContext,
    },
    options.audit,
  );
  return { posting: service, periodLock: service, balances: new PgBalanceQuery(uow, pgCurrencyCatalog) };
}

export type { BalanceQuery, LedgerMetrics, LedgerPeriodLockPort, LedgerPostingPort };
