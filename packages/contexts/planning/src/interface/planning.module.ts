import { Module, type DynamicModule } from '@nestjs/common';
import type { AuditHistoryQuery, AuditPort, LifecycleMachineDto, LifecyclePort } from '@pf/audit/contracts';
import type { CategoryCatalogQuery } from '@pf/classification/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import type { LedgerActivityRangeQuery } from '@pf/ledger/contracts';
import { runWithRequestContext } from '@pf/platform/api';
import type { EventConsumerDefinition } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { NominalFlowQuery } from '@pf/transactions/contracts';
import type { Pool } from 'pg';
import { BudgetQueries } from '../application/budget.queries.js';
import { BudgetCalculator } from '../application/budget-calculator.js';
import { BudgetThresholdService } from '../application/budget-thresholds.service.js';
import { BudgetsService } from '../application/budgets.service.js';
import { PeriodQueries } from '../application/period.queries.js';
import { RolloverService } from '../application/rollover.service.js';
import { PeriodsService } from '../application/periods.service.js';
import type {
  BudgetsDeps,
  OutboxPort,
  PlanningDeps,
  WorkspaceSettingsPort,
} from '../application/ports/index.js';
import {
  BUDGET_VS_ACTUAL_QUERY,
  PERIOD_QUERY,
  PLANNING_CONSUMERS,
  PLANNING_EDIT_GUARD,
  PLANNING_ENSURE_PERIODS_JOB,
  type BudgetVsActualQuery,
  type PeriodCreatedHook,
  type PeriodQuery,
  type PlanningEditGuard,
} from '../contracts/index.js';
import { FINANCIAL_PERIOD_LIFECYCLE } from '../domain/index.js';
import {
  cachedCalendar,
  PgBudgetRepository,
  PgThresholdCrossingRepository,
  requestActor,
} from '../infrastructure/pg-budgets.js';
import {
  PgFinancialPeriodRepository,
  PgPlanningUnitOfWork,
  uuidV7Ids,
} from '../infrastructure/pg-planning.js';
import { BUDGET_QUERIES, BUDGETS_SERVICE, BudgetsController } from './budgets-http.js';
import { PERIOD_QUERIES, PERIODS_SERVICE, PeriodsController } from './periods-http.js';

/** Anticipación por defecto (`PLANNING_PERIOD_LOOKAHEAD`, docs/33 D63). */
export const DEFAULT_PERIOD_LOOKAHEAD = 3;

/**
 * Puertos de los presupuestos (openspec add-budgets): lectura de la fuente de verdad vía contratos públicos de
 * TRANSACTIONS (flujos nominales), CLASSIFICATION (árbol de categorías) y FX (valoración con la ventana de Reporting).
 */
export interface BudgetsRuntimeOptions {
  readonly flows: NominalFlowQuery;
  readonly catalog: Pick<CategoryCatalogQuery, 'categoryTree'>;
  readonly rates: FxValuationPort;
  /** `REPORTING_RATE_VALIDITY_WINDOW` en días (docs/31 D53): la misma ventana que el resumen del Home. */
  readonly rateValidityWindowDays: number;
  /** Moneda base del workspace (solo la API, para crear planes). */
  readonly settings?: WorkspaceSettingsPort;
  /** Historial de auditoría del plan (solo la API). */
  readonly history?: AuditHistoryQuery;
  /**
   * Caché (ms) del calendario del workspace para los casos de uso de presupuestos: el worker lo usa para no abrir una
   * conexión extra del directorio por cada evento evaluado (ver `cachedCalendar`). Sin él, sin caché (la API).
   */
  readonly calendarCacheMs?: number;
}

export interface PlanningRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  /** Auditoría + recorrido (add-lifecycle-timeline). */
  readonly lifecycle: LifecyclePort;
  readonly outbox: OutboxPort;
  /** Zona horaria y día de inicio (IDENTITY): miembro en la API, directorio en el worker. */
  readonly calendar: WorkspaceCalendarQuery;
  /** Rango de fechas con asientos (LEDGER) en la unidad de trabajo en curso. */
  readonly activity: LedgerActivityRangeQuery;
  /** `PLANNING_PERIOD_LOOKAHEAD` (mínimo 1). */
  readonly lookahead?: number;
  /** Participantes de la creación de periodos (decisión 15; `add-budget-templates` registra el suyo). */
  readonly onPeriodCreated?: readonly PeriodCreatedHook[];
  /** Presupuestos (add-budgets); sin él solo se componen los periodos. */
  readonly budgets?: BudgetsRuntimeOptions;
}

export interface BudgetsRuntime {
  readonly service: BudgetsService;
  readonly queries: BudgetQueries;
  readonly thresholds: BudgetThresholdService;
  readonly rollover: RolloverService;
  /** Contrato público para `add-month-closing`. */
  readonly vsActual: BudgetVsActualQuery;
}

export interface PlanningRuntime {
  readonly service: PeriodsService;
  readonly queries: PeriodQueries;
  /** Contratos públicos para `add-month-closing` y pf-p2b. */
  readonly periodQuery: PeriodQuery;
  readonly editGuard: PlanningEditGuard;
  readonly budgets?: BudgetsRuntime;
}

/** Composición de PLANNING sobre PostgreSQL (misma transacción que la `PgUnitOfWork` de cada comando). */
export function createPlanningRuntime(options: PlanningRuntimeOptions): PlanningRuntime {
  const deps: PlanningDeps = {
    uow: new PgPlanningUnitOfWork(options.pool),
    periods: new PgFinancialPeriodRepository(),
    calendar: options.calendar,
    activity: options.activity,
    outbox: options.outbox,
    audit: options.audit,
    lifecycle: options.lifecycle,
    ids: uuidV7Ids,
    clock: options.clock,
    lookahead: options.lookahead ?? DEFAULT_PERIOD_LOOKAHEAD,
    onPeriodCreated: options.onPeriodCreated ?? [],
  };
  const queries = new PeriodQueries(deps);
  const b = options.budgets;
  let budgets: BudgetsRuntime | undefined;
  if (b) {
    const budgetsDeps: BudgetsDeps = {
      uow: deps.uow,
      periods: deps.periods,
      budgets: new PgBudgetRepository(),
      crossings: new PgThresholdCrossingRepository(),
      calendar: b.calendarCacheMs ? cachedCalendar(options.calendar, b.calendarCacheMs) : options.calendar,
      ...(b.settings ? { settings: b.settings } : {}),
      flows: b.flows,
      catalog: b.catalog,
      rates: b.rates,
      guard: queries,
      outbox: options.outbox,
      audit: options.audit,
      ...(b.history ? { history: b.history } : {}),
      actor: requestActor,
      ids: uuidV7Ids,
      clock: options.clock,
      rateValidityWindowDays: b.rateValidityWindowDays,
    };
    const budgetQueries = new BudgetQueries(budgetsDeps);
    budgets = {
      service: new BudgetsService(budgetsDeps),
      queries: budgetQueries,
      thresholds: new BudgetThresholdService(budgetsDeps, new BudgetCalculator(budgetsDeps)),
      rollover: new RolloverService(budgetsDeps),
      vsActual: budgetQueries,
    };
  }
  return {
    service: new PeriodsService(deps),
    queries,
    periodQuery: queries,
    editGuard: queries,
    ...(budgets ? { budgets } : {}),
  };
}

export interface PlanningModuleOptions {
  readonly runtime: PlanningRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de PLANNING (`/periods*`); exporta `PERIOD_QUERY` y `PLANNING_EDIT_GUARD`. */
@Module({})
export class PlanningModule {
  static register(options: PlanningModuleOptions): DynamicModule {
    return {
      module: PlanningModule,
      controllers: options.runtime.budgets ? [PeriodsController, BudgetsController] : [PeriodsController],
      providers: [
        ...(options.runtime.budgets
          ? [
              { provide: BUDGETS_SERVICE, useValue: options.runtime.budgets.service },
              { provide: BUDGET_QUERIES, useValue: options.runtime.budgets.queries },
              { provide: BUDGET_VS_ACTUAL_QUERY, useValue: options.runtime.budgets.vsActual },
            ]
          : []),
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: PERIODS_SERVICE, useValue: options.runtime.service },
        { provide: PERIOD_QUERIES, useValue: options.runtime.queries },
        { provide: PERIOD_QUERY, useValue: options.runtime.periodQuery },
        { provide: PLANNING_EDIT_GUARD, useValue: options.runtime.editGuard },
      ],
      exports: [
        PERIOD_QUERY,
        PLANNING_EDIT_GUARD,
        ...(options.runtime.budgets ? [BUDGET_VS_ACTUAL_QUERY] : []),
      ],
    };
  }
}

/** Máquina `FinancialPeriod` declarada por el dominio, para AUDIT en el composition root. */
export const FINANCIAL_PERIOD_LIFECYCLE_MACHINE: LifecycleMachineDto = FINANCIAL_PERIOD_LIFECYCLE.definition;

const payloadOf = (event: { readonly payload: unknown }): Record<string, unknown> =>
  typeof event.payload === 'object' && event.payload !== null
    ? (event.payload as Record<string, unknown>)
    : {};

/**
 * Consumidores idempotentes del worker (decisión 6; inbox en la misma transacción, INV-028):
 * - `identity.WorkspaceCreated.v1` ⇒ periodos iniciales sin esperar al cron (docs/33 D64, asíncrono);
 * - `identity.WorkspaceSettingsChanged.v1` con `fiscalMonthStartDay` o `timeZone` ⇒ recálculo de DRAFT / activación;
 * - `ledger.JournalEntryPosted.v1` ⇒ cobertura solo si `entryDate` cae fuera del rango cubierto.
 */
export function planningEventConsumers(runtime: PlanningRuntime): EventConsumerDefinition[] {
  const budgets = runtime.budgets;
  return [
    ...(budgets ? budgetEventConsumers(budgets) : []),
    {
      consumer: PLANNING_CONSUMERS.workspaceCreated,
      events: [{ type: 'identity.WorkspaceCreated', version: 1 }],
      handler: async (event) => {
        await runtime.service.ensurePeriods({ workspaceId: event.workspaceId });
      },
    },
    {
      consumer: PLANNING_CONSUMERS.settingsChanged,
      events: [{ type: 'identity.WorkspaceSettingsChanged', version: 1 }],
      handler: async (event) => {
        const changes = payloadOf(event)['changes'];
        const fields = Array.isArray(changes) ? changes.map((c) => (c as { field?: unknown }).field) : [];
        if (!fields.includes('fiscalMonthStartDay') && !fields.includes('timeZone')) return;
        await runtime.service.ensurePeriods({ workspaceId: event.workspaceId });
      },
    },
    {
      consumer: PLANNING_CONSUMERS.journalEntryPosted,
      events: [{ type: 'ledger.JournalEntryPosted', version: 1 }],
      handler: async (event) => {
        const entryDate = payloadOf(event)['entryDate'];
        if (typeof entryDate !== 'string') return;
        await runtime.service.onJournalEntryPosted({ workspaceId: event.workspaceId, entryDate });
      },
    },
  ];
}

/**
 * Consumidores de presupuestos (openspec add-budgets decisiones 9 y 10; inbox en la misma transacción, INV-028):
 *  - `planning.budget-thresholds`: ante cambios del gastado (transacciones, transferencias, conversiones, tasas)
 *    reevalúa los umbrales de los planes de periodos no cerrados (emisión única por objetivo, umbral y periodo);
 *  - `planning.rollover-finalizer`: `planning.MonthClosed.v1` congela el rollover del periodo siguiente y
 *    `planning.PeriodReopened.v1` lo vuelve provisional.
 */
export function budgetEventConsumers(budgets: BudgetsRuntime): EventConsumerDefinition[] {
  const spendEvents = [
    'transactions.TransactionPosted',
    'transactions.TransactionVoided',
    'transactions.TransactionCategorized',
    'transactions.TransactionUpdated',
    'transactions.TransferCompleted',
    'transactions.TransferRevised',
    'transactions.ConversionRecorded',
    'transactions.ConversionRevised',
    'fx.RateRecorded',
  ];
  return [
    {
      consumer: PLANNING_CONSUMERS.budgetThresholds,
      events: spendEvents.map((type) => ({ type, version: 1 })),
      handler: async (event) => {
        await budgets.thresholds.evaluateWorkspace(event.workspaceId);
      },
    },
    {
      consumer: PLANNING_CONSUMERS.rolloverFinalizer,
      events: [
        { type: 'planning.MonthClosed', version: 1 },
        { type: 'planning.PeriodReopened', version: 1 },
      ],
      handler: async (event) => {
        const periodId = payloadOf(event)['periodId'];
        if (typeof periodId !== 'string') return;
        const input = { workspaceId: event.workspaceId, periodId };
        if (event.eventType === 'planning.PeriodReopened') await budgets.rollover.onPeriodReopened(input);
        else await budgets.rollover.onPeriodClosed(input);
      },
    },
  ];
}

export interface ActiveWorkspaceDirectory {
  list(): Promise<readonly { readonly workspaceId: string }[]>;
}

/**
 * Job `planning.ensure-periods` (decisiones 6 y 7): recorre los workspaces activos y ejecuta `EnsurePeriods` (activa
 * los DRAFT iniciados, recalcula DRAFT y crea los que falten) con el actor de proceso `planning.ensure-periods`. Un
 * workspace que falla no detiene a los demás (log `error`); la ejecución siguiente lo reintenta.
 */
export async function runEnsurePeriods(
  service: PeriodsService,
  workspaces: ActiveWorkspaceDirectory,
  logger: Pick<Logger, 'info' | 'error'>,
  trigger: 'cron' | 'startup' | 'manual',
): Promise<{ readonly workspaces: number; readonly created: number; readonly failed: number }> {
  return runWithRequestContext(
    { actor: { type: 'WORKER', process: `${PLANNING_ENSURE_PERIODS_JOB}:${trigger}` }, origin: 'system' },
    async () => {
      let created = 0;
      let failed = 0;
      const all = await workspaces.list();
      for (const { workspaceId } of all) {
        try {
          created += (await service.ensurePeriods({ workspaceId })).created.length;
        } catch (err) {
          failed += 1;
          logger.error(
            {
              workspaceId,
              err: { type: err instanceof Error ? err.name : typeof err, message: String(err) },
            },
            'ensure periods failed for workspace',
          );
        }
      }
      logger.info(
        { job: PLANNING_ENSURE_PERIODS_JOB, workspaces: all.length, created, failed },
        'periods ensured',
      );
      return { workspaces: all.length, created, failed };
    },
  );
}

export { PLANNING_ENSURE_PERIODS_JOB, PLANNING_CONSUMERS };
export type { BudgetVsActualQuery, OutboxPort, PeriodCreatedHook, PeriodQuery, PlanningEditGuard };
export type { PeriodsService } from '../application/periods.service.js';
