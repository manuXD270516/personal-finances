import type { AuditPort } from '@pf/audit/contracts';
import type { OutboxWriter } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { LedgerMaintenance } from '../application/ledger-maintenance.js';
import { LedgerService } from '../application/ledger.service.js';
import type { LedgerInvariantViolation, MetricsPort } from '../application/ports/index.js';
import type {
  AccountBalancesQuery,
  BalanceQuery,
  LedgerActivityRangeQuery,
  LedgerOpeningBalanceQuery,
  LedgerPeriodLockPort,
  LedgerPostingPort,
} from '../contracts/index.js';
import { PgLedgerActivityRangeQuery } from '../infrastructure/pg-activity-range.queries.js';
import { PgLedgerOpeningBalanceQuery } from '../infrastructure/pg-opening-balance.queries.js';
import { PgBalanceQuery } from '../infrastructure/pg-balance.queries.js';
import { PgLedgerMaintenanceRepository } from '../infrastructure/pg-ledger-maintenance.js';
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
  /** Saldos por cuenta en lote (Reporting, add-basic-dashboard). */
  readonly accountBalances: AccountBalancesQuery;
  /** Rango de fechas con asientos (Planning, add-financial-periods: cobertura retroactiva de periodos). */
  readonly activityRange: LedgerActivityRangeQuery;
  /** Saldo inicial de una cuenta (Transactions, add-reconciliation: base del saldo confirmado). */
  readonly openingBalance: LedgerOpeningBalanceQuery;
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
  const balances = new PgBalanceQuery(uow, options.clock);
  return {
    posting: service,
    periodLock: service,
    balances,
    accountBalances: balances,
    activityRange: ledgerActivityRange(),
    openingBalance: ledgerOpeningBalance(),
  };
}

/**
 * `LedgerOpeningBalanceQuery` sin pool propio: corre en la unidad de trabajo del llamador (la sesión de reconciliación
 * de TRANSACTIONS, con el RLS del workspace ya fijado).
 */
export function ledgerOpeningBalance(): LedgerOpeningBalanceQuery {
  return new PgLedgerOpeningBalanceQuery();
}

/**
 * `LedgerActivityRangeQuery` sin pool propio: corre en la unidad de trabajo del llamador (la API o el consumidor del
 * worker de PLANNING, con el RLS del workspace ya fijado).
 */
export function ledgerActivityRange(): LedgerActivityRangeQuery {
  return new PgLedgerActivityRangeQuery();
}

export interface LedgerMaintenanceOptions {
  /** Pool del worker (rol `pf_worker`, que puede asumir `pf_ledger_maintenance`). */
  readonly pool: Pool;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly metrics: MetricsPort;
}

/**
 * Comandos internos `RebuildBalanceSnapshots` y `VerifyLedgerIntegrity` (tarea 4.5) para el job diario del worker y
 * `restore:local` (tarea 5.6).
 */
export function createLedgerMaintenance(options: LedgerMaintenanceOptions): LedgerMaintenance {
  return new LedgerMaintenance({
    repository: new PgLedgerMaintenanceRepository(options.pool),
    metrics: options.metrics,
    logger: options.logger,
    clock: options.clock,
  });
}

/** Cola del job diario del ledger (verificador de invariantes + reconstrucción de snapshots). */
export const LEDGER_DAILY_MAINTENANCE_QUEUE = 'ledger.daily-maintenance';

export {
  LEDGER_INVARIANT_VIOLATIONS_METRIC,
  LEDGER_SNAPSHOTS_REBUILT_METRIC,
} from '../application/ledger-maintenance.js';
export type {
  BalanceQuery,
  LedgerActivityRangeQuery,
  LedgerOpeningBalanceQuery,
  LedgerInvariantViolation,
  LedgerMaintenance,
  LedgerMetrics,
  LedgerPeriodLockPort,
  LedgerPostingPort,
  MetricsPort,
};
