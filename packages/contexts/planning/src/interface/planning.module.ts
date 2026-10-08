import { Module, type DynamicModule } from '@nestjs/common';
import type { AuditPort, LifecycleMachineDto, LifecyclePort } from '@pf/audit/contracts';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import type { LedgerActivityRangeQuery } from '@pf/ledger/contracts';
import { runWithRequestContext } from '@pf/platform/api';
import type { EventConsumerDefinition } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import type { Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import { PeriodQueries } from '../application/period.queries.js';
import { PeriodsService } from '../application/periods.service.js';
import type { OutboxPort, PlanningDeps } from '../application/ports/index.js';
import {
  PERIOD_QUERY,
  PLANNING_CONSUMERS,
  PLANNING_EDIT_GUARD,
  PLANNING_ENSURE_PERIODS_JOB,
  type PeriodCreatedHook,
  type PeriodQuery,
  type PlanningEditGuard,
} from '../contracts/index.js';
import { FINANCIAL_PERIOD_LIFECYCLE } from '../domain/index.js';
import {
  PgFinancialPeriodRepository,
  PgPlanningUnitOfWork,
  uuidV7Ids,
} from '../infrastructure/pg-planning.js';
import { PERIOD_QUERIES, PERIODS_SERVICE, PeriodsController } from './periods-http.js';

/** Anticipación por defecto (`PLANNING_PERIOD_LOOKAHEAD`, docs/33 D63). */
export const DEFAULT_PERIOD_LOOKAHEAD = 3;

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
}

export interface PlanningRuntime {
  readonly service: PeriodsService;
  readonly queries: PeriodQueries;
  /** Contratos públicos para `add-month-closing` y pf-p2b. */
  readonly periodQuery: PeriodQuery;
  readonly editGuard: PlanningEditGuard;
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
  return { service: new PeriodsService(deps), queries, periodQuery: queries, editGuard: queries };
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
      controllers: [PeriodsController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: PERIODS_SERVICE, useValue: options.runtime.service },
        { provide: PERIOD_QUERIES, useValue: options.runtime.queries },
        { provide: PERIOD_QUERY, useValue: options.runtime.periodQuery },
        { provide: PLANNING_EDIT_GUARD, useValue: options.runtime.editGuard },
      ],
      exports: [PERIOD_QUERY, PLANNING_EDIT_GUARD],
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
  return [
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
export type { OutboxPort, PeriodCreatedHook, PeriodQuery, PlanningEditGuard };
export type { PeriodsService } from '../application/periods.service.js';
