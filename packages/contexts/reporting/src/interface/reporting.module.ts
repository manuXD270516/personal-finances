import { Module, type DynamicModule } from '@nestjs/common';
import type { AccountCatalogQuery } from '@pf/accounts/contracts';
import type { CategoryCatalogQuery } from '@pf/classification/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import type { AccountBalanceHistoryQuery, AccountBalancesQuery } from '@pf/ledger/contracts';
import type { EventConsumerDefinition } from '@pf/platform/events';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { NominalFlowQuery } from '@pf/transactions/contracts';
import type { Pool } from 'pg';
import { DataVersionProjector } from '../application/data-version-projector.js';
import { NetWorthAtQueries, PeriodFlowsQueries } from '../application/closing-figures.queries.js';
import { NetWorthHistoryQueries } from '../application/net-worth-history.queries.js';
import type {
  ClosingSnapshotsPort,
  FinancialPeriodsPort,
  NetWorthHistoryDeps,
  PendingTransactionsPort,
  ReportingMetricsPort,
  UpcomingCommitmentsPort,
  UpcomingPaymentsDeps,
  WorkspaceSettingsPort,
} from '../application/ports/index.js';
import { UpcomingPaymentsQueries } from '../application/upcoming-payments.queries.js';
import {
  DEFAULT_RATE_VALIDITY_WINDOW_DAYS,
  ReportSummaryQueries,
} from '../application/report-summary.queries.js';

export { DEFAULT_RATE_VALIDITY_WINDOW_DAYS };
import {
  REPORTING_DATA_VERSION_CONSUMER,
  REPORTING_INVALIDATING_EVENTS,
  type NetWorthQuery,
  type PeriodFlowsQuery,
} from '../contracts/index.js';
import { PgDataVersionStore, PgReportingUnitOfWork } from '../infrastructure/pg-reporting.js';
import {
  NET_WORTH_HISTORY_QUERIES,
  REPORT_SUMMARY_QUERIES,
  ReportingController,
  UPCOMING_PAYMENTS_QUERIES,
} from './reporting-http.js';

export interface ReportingRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  /** Moneda de reporte y zona horaria (IDENTITY). */
  readonly workspaces: WorkspaceSettingsPort;
  /** Contratos públicos de los otros contextos (misma transacción de lectura). */
  readonly accounts: AccountCatalogQuery;
  readonly balances: AccountBalancesQuery;
  readonly flows: NominalFlowQuery;
  readonly categories: CategoryCatalogQuery;
  readonly rates: FxValuationPort;
  /** Saldos por cuenta a varias fechas (LEDGER, add-net-worth-evolution). */
  readonly balanceHistory: AccountBalanceHistoryQuery;
  /**
   * Periodos financieros (PLANNING, `PeriodQuery`) y snapshots de cierre vigentes (`ClosingSnapshotQuery`). PLANNING
   * depende de REPORTING (cifras de cierre), así que la composición los entrega como puertos con resolución tardía.
   */
  readonly periods: FinancialPeriodsPort;
  readonly snapshots: ClosingSnapshotsPort;
  /**
   * COMMITMENTS (add-upcoming-payments): `UpcomingPaymentsQuery`, `CommittedQuery`, `ResolvedOccurrencesQuery` y
   * `DefinitionStatsQuery`. COMMITMENTS se compone después de REPORTING, así que la composición los entrega con
   * resolución tardía (como `periods`).
   */
  readonly commitments: UpcomingCommitmentsPort;
  /** Transacciones pendientes (TRANSACTIONS, `PendingFlowQuery`). */
  readonly pending: PendingTransactionsPort;
  /** Histogramas de la consulta de próximos pagos (docs/35 D117); opcional. */
  readonly metrics?: ReportingMetricsPort;
  /**
   * Ventana de vigencia (días) de las tasas de valoración y de referencia (`REPORTING_RATE_VALIDITY_WINDOW`, docs/31
   * D53). La composición entrega el MISMO valor a FX (`createFxRuntime({ windowDays })`).
   */
  readonly rateValidityWindowDays?: number;
}

export interface ReportingRuntime {
  readonly summary: ReportSummaryQueries;
  /** Evolución del patrimonio por periodo financiero (`GET /reports/net-worth/history`, add-net-worth-evolution). */
  readonly history: NetWorthHistoryQueries;
  /** Próximos pagos, comprometido del periodo, saldo proyectado y pagos sorpresa (add-upcoming-payments). */
  readonly upcoming: UpcomingPaymentsQueries;
  /** Flujos del periodo para el cierre de mes (contrato público `PeriodFlowsQuery`; sin ruta HTTP). */
  readonly periodFlows: PeriodFlowsQuery;
  /** Patrimonio a una fecha de corte para el cierre de mes (contrato público `NetWorthQuery`; sin ruta HTTP). */
  readonly netWorth: NetWorthQuery;
  /** Ventana de vigencia efectiva (días). */
  readonly rateValidityWindowDays: number;
}

/** Composición de REPORTING (solo lectura) sobre PostgreSQL. */
export function createReportingRuntime(options: ReportingRuntimeOptions): ReportingRuntime {
  const rateValidityWindowDays = options.rateValidityWindowDays ?? DEFAULT_RATE_VALIDITY_WINDOW_DAYS;
  const deps: NetWorthHistoryDeps & UpcomingPaymentsDeps = {
    uow: new PgReportingUnitOfWork(options.pool),
    workspaces: options.workspaces,
    accounts: options.accounts,
    balances: options.balances,
    flows: options.flows,
    categories: options.categories,
    rates: options.rates,
    versions: new PgDataVersionStore(),
    clock: options.clock,
    rateValidityWindowDays,
    periods: options.periods,
    snapshots: options.snapshots,
    balanceHistory: options.balanceHistory,
    commitments: options.commitments,
    pending: options.pending,
    ...(options.metrics ? { metrics: options.metrics } : {}),
  };
  return {
    rateValidityWindowDays,
    summary: new ReportSummaryQueries(deps),
    history: new NetWorthHistoryQueries(deps),
    upcoming: new UpcomingPaymentsQueries(deps),
    periodFlows: new PeriodFlowsQueries(deps),
    netWorth: new NetWorthAtQueries(deps),
  };
}

/**
 * Consumidor idempotente `reporting.data-version` para el worker: incrementa `reporting.workspace_data_version` en la
 * transacción del inbox (un evento duplicado no incrementa dos veces, INV-028).
 */
export function reportingDataVersionConsumer(): EventConsumerDefinition {
  const projector = new DataVersionProjector(new PgDataVersionStore());
  return {
    consumer: REPORTING_DATA_VERSION_CONSUMER,
    events: REPORTING_INVALIDATING_EVENTS.map((e) => ({ type: e.type, version: e.version })),
    handler: (event) => projector.on(event),
  };
}

export interface ReportingModuleOptions {
  readonly runtime: ReportingRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de REPORTING (`/reports/summary`, `/reports/net-worth/history`, próximos pagos y pagos sorpresa). */
@Module({})
export class ReportingModule {
  static register(options: ReportingModuleOptions): DynamicModule {
    return {
      module: ReportingModule,
      controllers: [ReportingController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: REPORT_SUMMARY_QUERIES, useValue: options.runtime.summary },
        { provide: NET_WORTH_HISTORY_QUERIES, useValue: options.runtime.history },
        { provide: UPCOMING_PAYMENTS_QUERIES, useValue: options.runtime.upcoming },
      ],
    };
  }
}

export { REPORTING_DATA_VERSION_CONSUMER } from '../contracts/index.js';
export type { WorkspaceSettingsPort };
