import { Module, type DynamicModule } from '@nestjs/common';
import type { AccountCatalogQuery } from '@pf/accounts/contracts';
import type {
  AuditHistoryQuery,
  AuditPort,
  LifecycleMachineDto,
  LifecyclePort,
  LifecycleQuery,
} from '@pf/audit/contracts';
import type { CategoryCatalogQuery } from '@pf/classification/contracts';
import type { FxValuationPort } from '@pf/fx/contracts';
import type { WorkspaceCalendarQuery } from '@pf/identity/contracts';
import type {
  AccountBalancesQuery,
  LedgerActivityRangeQuery,
  LedgerPeriodLockPort,
  LedgerPostingPort,
} from '@pf/ledger/contracts';
import { runWithRequestContext } from '@pf/platform/api';
import type { EventConsumerDefinition } from '@pf/platform/events';
import type { Logger } from '@pf/platform/logging';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import { dec, type Clock } from '@pf/shared-kernel';
import type { NetWorthQuery, PeriodFlowsQuery } from '@pf/reporting/contracts';
import type {
  NominalFlowQuery,
  ReconciliationStatusQuery,
  TransactionsClosingQuery,
} from '@pf/transactions/contracts';
import type { Pool } from 'pg';
import {
  assembleSnapshotContent,
  mapBalanceRows,
  mapWithoutRows,
  snapshotContentSha256,
} from '../infrastructure/pg-closing.js';
import { BudgetQueries } from '../application/budget.queries.js';
import { BudgetCalculator } from '../application/budget-calculator.js';
import { BudgetThresholdService } from '../application/budget-thresholds.service.js';
import { BudgetsService } from '../application/budgets.service.js';
import { ClosePendingService } from '../application/close-pending-publisher.js';
import { ClosingQueries, type CloseReportPdfRenderer } from '../application/closing.queries.js';
import { ClosingService } from '../application/closing.service.js';
import { ClosingVerifier } from '../application/closing-verifier.js';
import { PeriodQueries } from '../application/period.queries.js';
import { RolloverService } from '../application/rollover.service.js';
import { PeriodsService } from '../application/periods.service.js';
import { PropagationService } from '../application/propagation.service.js';
import { TemplatePeriodHook } from '../application/period-created.hook.js';
import { TemplateQueries } from '../application/template.queries.js';
import { TemplatesService } from '../application/templates.service.js';
import type {
  BudgetsDeps,
  ClosingDeps,
  ClosingMetricsPort,
  OutboxPort,
  PlanningDeps,
  WorkspaceSettingsPort,
} from '../application/ports/index.js';
import {
  BUDGET_VS_ACTUAL_QUERY,
  CLOSING_SNAPSHOT_QUERY,
  DEFAULT_CLOSE_PENDING_DELAY_DAYS,
  PERIOD_QUERY,
  PLANNING_CONSUMERS,
  PLANNING_EDIT_GUARD,
  PLANNING_ENSURE_PERIODS_JOB,
  type BudgetVsActualQuery,
  type ClosingSnapshotQuery,
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
import { PdfkitCloseReportPdf } from '../infrastructure/pdfkit-close-report.js';
import {
  PgClosePendingNoticeRepository,
  PgClosingPolicyRepository,
  PgCloseSnapshotRepository,
  PgPeriodReopeningRepository,
  sha256Hex,
} from '../infrastructure/pg-closing.js';
import { PgBudgetTemplateRepository } from '../infrastructure/pg-templates.js';
import {
  PgFinancialPeriodRepository,
  PgPlanningUnitOfWork,
  uuidV7Ids,
} from '../infrastructure/pg-planning.js';
import { BUDGET_QUERIES, BUDGETS_SERVICE, BudgetsController } from './budgets-http.js';
import { CLOSING_QUERIES, CLOSING_SERVICE, ClosingController } from './closing-http.js';
import { PERIOD_QUERIES, PERIODS_SERVICE, PeriodsController } from './periods-http.js';
import {
  PROPAGATION_SERVICE,
  TEMPLATE_QUERIES,
  TEMPLATES_SERVICE,
  TemplatesController,
} from './templates-http.js';

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

/**
 * Puertos del cierre de mes (openspec add-month-closing): consultas de TRANSACTIONS, ACCOUNTS, LEDGER y REPORTING y el
 * bloqueo del ledger en la misma transacción. Solo la API los aporta; el worker solo necesita el aviso de cierre pendiente.
 */
export interface ClosingRuntimeOptions {
  readonly settings: WorkspaceSettingsPort;
  readonly lock: LedgerPeriodLockPort;
  readonly ledger: Pick<LedgerPostingPort, 'assertPeriodOpen'>;
  readonly accounts: AccountCatalogQuery;
  readonly balances: AccountBalancesQuery;
  readonly closing: TransactionsClosingQuery;
  readonly reconciliation: ReconciliationStatusQuery;
  readonly flows: PeriodFlowsQuery;
  readonly netWorth: NetWorthQuery;
  readonly lifecycleQuery?: LifecycleQuery;
  /** Renderizador del PDF del reporte (pdfkit); sin él, solo CSV. */
  readonly pdf?: CloseReportPdfRenderer;
  readonly metrics?: ClosingMetricsPort;
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
  /** Cierre de mes (add-month-closing); sin él solo se compone el aviso de cierre pendiente. */
  readonly closing?: ClosingRuntimeOptions;
  /** `PLANNING_CLOSE_PENDING_DELAY_DAYS` (default 3). */
  readonly closePendingDelayDays?: number;
  /** Verificador de cierres (`planning.verify-closings`): solo lectura del ledger y de los snapshots. */
  readonly verification?: {
    readonly balances: AccountBalancesQuery;
    readonly ledger: Pick<LedgerPostingPort, 'assertPeriodOpen'>;
    readonly metrics?: ClosingMetricsPort;
  };
}

export interface BudgetsRuntime {
  readonly service: BudgetsService;
  /** Templates versionados y su propagación (add-budget-templates). */
  readonly templates: TemplatesService;
  readonly templateQueries: TemplateQueries;
  readonly propagation: PropagationService;
  readonly queries: BudgetQueries;
  readonly thresholds: BudgetThresholdService;
  readonly rollover: RolloverService;
  /** Contrato público para `add-month-closing`. */
  readonly vsActual: BudgetVsActualQuery;
}

export interface ClosingRuntime {
  readonly service: ClosingService;
  readonly queries: ClosingQueries;
  /** Contrato público para `add-net-worth-evolution`. */
  readonly snapshots: ClosingSnapshotQuery;
}

export interface PlanningRuntime {
  readonly service: PeriodsService;
  /** Job `planning.close-pending` (corre dentro del cron `planning.ensure-periods`). */
  readonly closePending: ClosePendingService;
  readonly closing?: ClosingRuntime;
  /** Verificador de cierres (INV-015/INV-022) para el job diario del worker. */
  readonly verifier?: ClosingVerifier;
  readonly queries: PeriodQueries;
  /** Contratos públicos para `add-month-closing` y pf-p2b. */
  readonly periodQuery: PeriodQuery;
  readonly editGuard: PlanningEditGuard;
  readonly budgets?: BudgetsRuntime;
}

/** Composición de PLANNING sobre PostgreSQL (misma transacción que la `PgUnitOfWork` de cada comando). */
export function createPlanningRuntime(options: PlanningRuntimeOptions): PlanningRuntime {
  // Participantes síncronos de la creación de periodos (decisión 15): el de templates se agrega al componer los
  // presupuestos (misma lista, mismo arreglo).
  const periodHooks: PeriodCreatedHook[] = [...(options.onPeriodCreated ?? [])];
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
    onPeriodCreated: periodHooks,
  };
  const queries = new PeriodQueries(deps);
  const b = options.budgets;
  let budgets: BudgetsRuntime | undefined;
  if (b) {
    const budgetsDeps: BudgetsDeps = {
      uow: deps.uow,
      periods: deps.periods,
      budgets: new PgBudgetRepository(),
      templates: new PgBudgetTemplateRepository(),
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
    const budgetsService = new BudgetsService(budgetsDeps);
    periodHooks.push(new TemplatePeriodHook(budgetsService));
    budgets = {
      service: budgetsService,
      templates: new TemplatesService(budgetsDeps),
      templateQueries: new TemplateQueries(budgetsDeps),
      propagation: new PropagationService(budgetsDeps),
      queries: budgetQueries,
      thresholds: new BudgetThresholdService(budgetsDeps, new BudgetCalculator(budgetsDeps)),
      rollover: new RolloverService(budgetsDeps),
      vsActual: budgetQueries,
    };
  }
  const closeBase = {
    uow: deps.uow,
    periods: deps.periods,
    notices: new PgClosePendingNoticeRepository(),
    calendar: options.calendar,
    outbox: options.outbox,
    ids: uuidV7Ids,
    clock: options.clock,
    closePendingDelayDays: options.closePendingDelayDays ?? DEFAULT_CLOSE_PENDING_DELAY_DAYS,
  };
  const closePending = new ClosePendingService(closeBase as ClosingDeps);
  let closing: ClosingRuntime | undefined;
  const c = options.closing;
  if (c) {
    const closingDeps: ClosingDeps = {
      ...closeBase,
      policies: new PgClosingPolicyRepository(),
      snapshots: new PgCloseSnapshotRepository(),
      reopenings: new PgPeriodReopeningRepository(),
      settings: c.settings,
      lock: c.lock,
      ledger: c.ledger,
      accounts: c.accounts,
      balances: c.balances,
      closing: c.closing,
      reconciliation: c.reconciliation,
      flows: c.flows,
      netWorth: c.netWorth,
      ...(budgets ? { budgets: budgets.vsActual } : {}),
      ...(b?.catalog ? { catalog: b.catalog } : {}),
      audit: options.audit,
      lifecycle: options.lifecycle,
      actor: requestActor,
      ...(c.metrics ? { metrics: c.metrics } : {}),
    };
    const closingQueries = new ClosingQueries(
      closingDeps,
      c.pdf ?? new PdfkitCloseReportPdf(),
      c.lifecycleQuery,
    );
    closing = {
      service: new ClosingService(closingDeps),
      queries: closingQueries,
      snapshots: closingQueries,
    };
  }
  const v =
    options.verification ??
    (c
      ? { balances: c.balances, ledger: c.ledger, ...(c.metrics ? { metrics: c.metrics } : {}) }
      : undefined);
  const verifier = v
    ? new ClosingVerifier(
        {
          uow: deps.uow,
          periods: deps.periods,
          snapshots: new PgCloseSnapshotRepository(),
          balances: v.balances,
          ledger: v.ledger,
          ...(v.metrics ? { metrics: v.metrics } : {}),
        },
        sha256Hex,
      )
    : undefined;
  return {
    service: new PeriodsService(deps),
    closePending,
    ...(verifier ? { verifier } : {}),
    ...(closing ? { closing } : {}),
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
      controllers: [
        PeriodsController,
        ...(options.runtime.budgets ? [BudgetsController, TemplatesController] : []),
        ...(options.runtime.closing ? [ClosingController] : []),
      ],
      providers: [
        ...(options.runtime.closing
          ? [
              { provide: CLOSING_SERVICE, useValue: options.runtime.closing.service },
              { provide: CLOSING_QUERIES, useValue: options.runtime.closing.queries },
              { provide: CLOSING_SNAPSHOT_QUERY, useValue: options.runtime.closing.snapshots },
            ]
          : []),
        ...(options.runtime.budgets
          ? [
              { provide: BUDGETS_SERVICE, useValue: options.runtime.budgets.service },
              { provide: BUDGET_QUERIES, useValue: options.runtime.budgets.queries },
              { provide: TEMPLATES_SERVICE, useValue: options.runtime.budgets.templates },
              { provide: TEMPLATE_QUERIES, useValue: options.runtime.budgets.templateQueries },
              { provide: PROPAGATION_SERVICE, useValue: options.runtime.budgets.propagation },
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
        ...(options.runtime.closing ? [CLOSING_SNAPSHOT_QUERY] : []),
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
      // Baja frecuencia (una vez por workspace o cambio de ajustes): no reserva conexiones del pool del worker.
      concurrency: 1,
      events: [{ type: 'identity.WorkspaceCreated', version: 1 }],
      handler: async (event) => {
        await runtime.service.ensurePeriods({ workspaceId: event.workspaceId });
      },
    },
    {
      consumer: PLANNING_CONSUMERS.settingsChanged,
      // Baja frecuencia (una vez por workspace o cambio de ajustes): no reserva conexiones del pool del worker.
      concurrency: 1,
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
      // Baja frecuencia (cierre o reapertura de mes): no reserva conexiones del pool del worker.
      concurrency: 1,
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

/**
 * Job `planning.verify-closings` (NFR-DATA-008; design.md decisión 14): tras el verificador del ledger, revisa por
 * workspace que los saldos del snapshot vigente igualen el ledger, que el hash coincida y que cada periodo cerrado
 * tenga su bloqueo. Las violaciones se registran con `alert=planning.closing_violation` y la métrica
 * `planning_closing_violations_total{check}`; un workspace que falla no detiene a los demás.
 */
export async function runVerifyClosings(
  verifier: ClosingVerifier,
  workspaces: ActiveWorkspaceDirectory,
  logger: Pick<Logger, 'info' | 'error'>,
): Promise<number> {
  return runWithRequestContext(
    { actor: { type: 'WORKER', process: 'planning.verify-closings' }, origin: 'system' },
    async () => {
      let violations = 0;
      for (const { workspaceId } of await workspaces.list()) {
        try {
          for (const v of await verifier.verify(workspaceId)) {
            violations += 1;
            logger.error({ alert: 'planning.closing_violation', workspaceId, ...v }, 'closing violation');
          }
        } catch (err) {
          logger.error(
            {
              workspaceId,
              err: { type: err instanceof Error ? err.name : typeof err, message: String(err) },
            },
            'verify closings failed for workspace',
          );
        }
      }
      logger.info({ job: 'planning.verify-closings', violations }, 'closings verified');
      return violations;
    },
  );
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
  closePending?: ClosePendingService,
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
          // add-month-closing decisión 16: el aviso de cierre pendiente corre dentro del mismo cron.
          await closePending?.publishDue(workspaceId);
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
export type {
  BudgetVsActualQuery,
  ClosingSnapshotQuery,
  OutboxPort,
  PeriodCreatedHook,
  PeriodQuery,
  PlanningEditGuard,
};
export type { ClosingVerifier } from '../application/closing-verifier.js';
export type { ClosePendingService } from '../application/close-pending-publisher.js';
export type { PeriodsService } from '../application/periods.service.js';

// ───────────────────────────── add-workspace-export: restauración de snapshots de cierre

type RestoreRow = Record<string, unknown>;

/**
 * Gancho de importación de `planning.close_snapshot` (openspec add-workspace-export): el `content_sha256` cubre el contenido
 * canónico del snapshot, que incluye los identificadores de cuentas, periodo y conciliaciones. Al importar, la
 * importación remapea esos ids, así que el hash se RECALCULA con el contenido restaurado (mismo armado que la lectura:
 * `assembleSnapshotContent`) para que el verificador diario de cierres (`planning.verify-closings`) siga validando la
 * integridad. Recibe las filas del lote YA remapeadas y las de las secciones hijas.
 */
export function closeSnapshotRestoreHook(ctx: {
  readonly rows: RestoreRow[];
  related(sectionName: string): RestoreRow[];
}): void {
  const group = (rows: RestoreRow[]) => {
    const by = new Map<string, RestoreRow[]>();
    for (const r of rows) by.set(String(r['snapshot_id']), [...(by.get(String(r['snapshot_id'])) ?? []), r]);
    return by;
  };
  const balances = group(ctx.related('close-snapshot-balances'));
  const withoutStatement = group(ctx.related('close-snapshot-without-statement'));
  const fixed = (value: unknown, scale: unknown): string => dec(String(value)).toFixed(Number(scale));
  for (const row of ctx.rows) {
    const id = String(row['id']);
    const balanceRows = (balances.get(id) ?? []).map((b) => ({
      account_id: String(b['account_id']),
      ledger_account_id: b['ledger_account_id'] === null ? null : String(b['ledger_account_id']),
      account_name: String(b['account_name']),
      currency: String(b['currency']),
      balance: fixed(b['balance'], b['scale']),
      presented: fixed(b['presented'], b['scale']),
      reconciliation_id: b['reconciliation_id'] === null ? null : String(b['reconciliation_id']),
      statement_date: b['statement_date'] === null ? null : String(b['statement_date']),
      statement_balance: b['statement_balance'] === null ? null : fixed(b['statement_balance'], b['scale']),
      reconciliation_basis: b['reconciliation_basis'] as 'STATEMENT' | 'WITHOUT_STATEMENT' | null,
    }));
    const withoutRows = (withoutStatement.get(id) ?? []).map((w) => ({
      transaction_id: String(w['transaction_id']),
      account_id: String(w['account_id']),
      business_date: String(w['business_date']),
      amount: fixed(w['amount'], w['scale']),
      currency: String(w['currency']),
    }));
    const content = assembleSnapshotContent(
      {
        periodId: String(row['period_id']),
        label: String(row['label']),
        periodStart: String(row['period_start']),
        periodEnd: String(row['period_end']),
        startDay: Number(row['start_day']),
        baseCurrency: String(row['base_currency']),
        schemaVersion: Number(row['content_schema_version']),
        flows: row['flows'] as never,
        netWorth: row['net_worth'] as never,
        budgetVsActual: row['budget_vs_actual'] as never,
        checklist: row['checklist'] as never,
        acknowledgedWarnings: row['acknowledged_warnings'] as never,
      },
      mapBalanceRows(balanceRows),
      mapWithoutRows(withoutRows),
    );
    row['content_sha256'] = snapshotContentSha256(content);
  }
}
