/**
 * API pública de `@pf/planning` (consumida por otros contextos y por `apps/api`; openspec add-financial-periods
 * § Contratos). Hoja: no importa capas internas. `PeriodQuery` es el ÚNICO nombre del catálogo de periodos (los
 * borradores de pf-p2b lo llamaban `PeriodCatalog`).
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';
import type { ResolvedRateDto } from '@pf/fx/contracts';

export const PLANNING_CONTEXT = 'planning' as const;

export type FinancialPeriodStatusDto = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'REOPENED';

/** Periodo financiero tal como lo publica el contrato (`FinancialPeriod` del OpenAPI). */
export interface FinancialPeriodDto {
  readonly id: string;
  /** `YYYY-MM` del inicio (docs/33 D59). */
  readonly label: string;
  /** Fechas de negocio inclusivas `YYYY-MM-DD`. */
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: FinancialPeriodStatusDto;
  readonly startDay: number;
  readonly isTransition: boolean;
  /** Derivada de hoy en la zona del workspace: terminado y no cerrado (docs/33 D60). */
  readonly pendingClosure: boolean;
  readonly closeCount: number;
  readonly reopenCount: number;
  readonly latestCloseNo: number | null;
  readonly version: number;
  readonly createdAt: string;
  readonly activatedAt: string | null;
}

/**
 * Catálogo de periodos para otros contextos (`add-month-closing`, `add-budgets`, `add-budget-templates`): corre en la
 * unidad de trabajo en curso del llamador (o abre una con el usuario de la petición) y respeta RLS. Sin efectos.
 */
export interface PeriodQuery {
  /** `null` si no existe en el workspace. */
  getPeriod(input: { readonly workspaceId: string; readonly periodId: string }): Promise<FinancialPeriodDto | null>;
  /** Periodo que contiene la fecha de negocio `date` (`YYYY-MM-DD`); `null` si ningún periodo la cubre. */
  getPeriodContaining(input: {
    readonly workspaceId: string;
    readonly date: string;
  }): Promise<FinancialPeriodDto | null>;
  /** Periodos ordenados por inicio ascendente, opcionalmente filtrados por estado. */
  listPeriods(input: {
    readonly workspaceId: string;
    readonly statuses?: readonly FinancialPeriodStatusDto[];
  }): Promise<readonly FinancialPeriodDto[]>;
  /** Periodo inmediatamente anterior (`null` si es el primero o no existe). */
  getPrevious(input: { readonly workspaceId: string; readonly periodId: string }): Promise<FinancialPeriodDto | null>;
}

/**
 * Guard de edición de la planificación (decisión 10). pf-p2b lo invoca ANTES de toda mutación del plan mensual o sus
 * presupuestos, en su unidad de trabajo: toma `SELECT … FOR SHARE` sobre el periodo (cierra la carrera con el cierre,
 * que lo actualiza con `FOR UPDATE`). `CLOSED` ⇒ `PERIOD_CLOSED`; inexistente ⇒ `REFERENCE_NOT_FOUND`;
 * `DRAFT`/`ACTIVE`/`REOPENED` ⇒ ok.
 */
export interface PlanningEditGuard {
  assertPlanEditable(input: { readonly workspaceId: string; readonly periodId: string }): Promise<void>;
}

/**
 * Participante de la creación de periodos (decisión 15, contrato con `add-budget-templates`). `EnsurePeriods` lo
 * invoca de forma SÍNCRONA, dentro de su misma unidad de trabajo (la transacción en curso, accesible por la
 * plataforma), por cada periodo efectivamente insertado. Una excepción revierte la creación; la ejecución siguiente lo
 * reintenta, así que los participantes deben ser idempotentes.
 */
export interface PeriodCreatedHook {
  onPeriodCreated(input: { readonly workspaceId: string; readonly period: FinancialPeriodDto }): Promise<void>;
}

/** Payload de `planning.PeriodActivated.v1` (contracts/events/planning/PeriodActivated.v1.schema.json). */
export interface PeriodActivatedV1 {
  readonly workspaceId: string;
  readonly periodId: string;
  readonly label: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly startDay: number;
  readonly isTransition: boolean;
  readonly activatedAt: string;
  readonly activation: 'AUTOMATIC' | 'MANUAL';
}

export const PERIOD_ACTIVATED = { eventType: 'planning.PeriodActivated', eventVersion: 1 } as const;

/** Job cron del worker (decisión 6). */
export const PLANNING_ENSURE_PERIODS_JOB = 'planning.ensure-periods' as const;

/** Consumidores idempotentes del worker (inbox, INV-028). */
export const PLANNING_CONSUMERS = {
  workspaceCreated: 'planning.workspace-created',
  settingsChanged: 'planning.settings-changed',
  journalEntryPosted: 'planning.journal-entry-posted',
  /** add-budgets: reevalúa los umbrales de los planes abiertos ante cambios del gastado. */
  budgetThresholds: 'planning.budget-thresholds',
  /** add-budgets: congela el rollover al cerrar el periodo anterior y lo vuelve provisional al reabrirlo. */
  rolloverFinalizer: 'planning.rollover-finalizer',
} as const;

export const PERIOD_QUERY = Symbol.for('pf.planning.PeriodQuery');
export const BUDGET_VS_ACTUAL_QUERY = Symbol.for('pf.planning.BudgetVsActualQuery');
export const PLANNING_EDIT_GUARD = Symbol.for('pf.planning.PlanningEditGuard');

// ───────────────────────────────────────────── add-budgets (planning/budgets)

export interface BudgetMoneyDto {
  readonly amount: string;
  readonly currency: string;
}

export type BudgetLineKindDto = 'FIXED' | 'MAXIMUM' | 'MINIMUM' | 'RANGE' | 'PERCENT_OF_INCOME';
export type BudgetTargetKindDto = 'CATEGORY' | 'GROUP' | 'TAG';
export type BudgetNatureDto = 'EXPENSE' | 'INCOME';
export type BudgetLineStatusDto =
  | 'UNDER'
  | 'ON_TARGET'
  | 'OVER'
  | 'WITHIN'
  | 'BELOW'
  | 'ABOVE'
  | 'PENDING'
  | 'MET'
  | 'NO_BUDGET';

export interface BudgetVsActualLineDto {
  readonly budgetLineId: string;
  readonly target: { readonly kind: BudgetTargetKindDto; readonly id: string };
  readonly nature: BudgetNatureDto;
  readonly kind: BudgetLineKindDto;
  /** Planificado efectivo (con rollover) o máximo/mínimo según el tipo. */
  readonly reference: BudgetMoneyDto;
  readonly actual: BudgetMoneyDto;
  /** `false` si parte del gastado no tiene tasa de valoración (se informa aparte, nunca 1:1). */
  readonly actualComplete: boolean;
  readonly status: BudgetLineStatusDto;
}

export interface BudgetVsActualTotalsDto {
  readonly planned: BudgetMoneyDto;
  readonly actual: BudgetMoneyDto;
  readonly remaining: BudgetMoneyDto;
  readonly availableToSpend: BudgetMoneyDto;
  readonly complete: boolean;
  readonly unconverted: readonly BudgetMoneyDto[];
}

/** Presupuesto vs real de un periodo, derivado de las transacciones en cada lectura (INV-034). */
export interface BudgetVsActual {
  readonly budgetId: string;
  readonly currency: string;
  readonly lines: readonly BudgetVsActualLineDto[];
  readonly totals: BudgetVsActualTotalsDto;
  readonly ratesUsed: readonly ResolvedRateDto[];
}

/**
 * Query pública `BudgetVsActualQuery.getForPeriod` (openspec add-budgets § Contratos; consumida por `add-month-closing`
 * para congelar el snapshot de cierre). `null` si el periodo no tiene plan. Corre en la unidad de trabajo en curso del
 * llamador (o abre una); `asOf` fija el "ahora" de la valoración (por defecto el reloj del sistema). Sin efectos.
 */
export interface BudgetVsActualQuery {
  getForPeriod(input: {
    readonly workspaceId: string;
    readonly periodId: string;
    readonly asOf?: string;
  }): Promise<BudgetVsActual | null>;
}

/** Payload de `planning.BudgetCreated.v1` (contracts/events/planning/BudgetCreated.v1.schema.json). */
export interface BudgetCreatedV1 {
  readonly budgetId: string;
  readonly periodId: string;
  readonly periodLabel: string;
  readonly currency: string;
  readonly origin: 'EMPTY' | 'TEMPLATE' | 'CLONE';
  readonly templateId: string | null;
  readonly templateVersionNo: number | null;
  readonly clonedFromBudgetId: string | null;
  readonly lineCount: number;
}

export const BUDGET_CREATED = { eventType: 'planning.BudgetCreated', eventVersion: 1 } as const;

/**
 * Payload de `planning.BudgetThresholdReached.v1` (contracts/events/planning/BudgetThresholdReached.v1.schema.json).
 * Clave de deduplicación de negocio: `(periodId, target.kind, target.id, threshold)`.
 */
export interface BudgetThresholdReachedV1 {
  readonly budgetId: string;
  readonly budgetLineId: string;
  readonly periodId: string;
  readonly periodLabel: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly target: { readonly kind: BudgetTargetKindDto; readonly id: string };
  /** Umbral más alto cruzado ("90"). */
  readonly threshold: string;
  /** Umbrales menores cruzados a la vez ("50", "75"). */
  readonly alsoCrossed: readonly string[];
  readonly reference: BudgetMoneyDto;
  readonly actual: BudgetMoneyDto;
  readonly utilization: string;
  readonly actualComplete: boolean;
  readonly crossedAt: string;
}

export const BUDGET_THRESHOLD_REACHED = { eventType: 'planning.BudgetThresholdReached', eventVersion: 1 } as const;

/** Allow-list de auditoría de `FinancialPeriod` (add-audit-trail, NFR-SEC-015). `range` viaja como JSON canónico. */
export const PLANNING_AUDIT_POLICY = {
  FinancialPeriod: {
    label: 'plain',
    periodStart: 'plain',
    periodEnd: 'plain',
    range: 'plain',
    startDay: 'plain',
    isTransition: 'plain',
    status: 'plain',
    activation: 'plain',
  },
  // add-budgets: el plan y sus líneas se auditan sobre el agregado `Budget` (la línea afectada va en `line`/`target`;
  // los umbrales viajan como texto JSON, docs/31 D19).
  Budget: {
    periodId: 'plain',
    currency: 'plain',
    origin: 'plain',
    zeroBased: 'plain',
    line: 'plain',
    target: 'plain',
    nature: 'plain',
    kind: 'plain',
    planned: 'money',
    min: 'money',
    max: 'money',
    percent: 'plain',
    incomeBasis: 'plain',
    rolloverPolicy: 'plain',
    rolloverCap: 'money',
    rolloverIn: 'money',
    rolloverStatus: 'plain',
    thresholds: 'plain',
    source: 'plain',
    // add-budget-templates: origen (template y versión, plan clonado, líneas omitidas) y propagación.
    templateId: 'plain',
    templateVersionNo: 'plain',
    clonedFromBudgetId: 'plain',
    lineCount: 'plain',
    omittedLines: 'plain',
    propagatedChanges: 'plain',
    propagationConflicts: 'plain',
    threshold: 'plain',
    alsoCrossed: 'plain',
    reference: 'money',
    actual: 'money',
    utilization: 'plain',
  },
  // add-budget-templates: el template y sus versiones se auditan sobre el agregado `BudgetTemplate`; las líneas viajan
  // como texto JSON (docs/31 D19).
  BudgetTemplate: {
    name: 'plain',
    description: 'plain',
    status: 'plain',
    isDefault: 'plain',
    versionNo: 'plain',
    changeNote: 'plain',
    lineCount: 'plain',
    lines: 'plain',
    clonedFromTemplateId: 'plain',
    clonedFromVersionNo: 'plain',
  },
} as const satisfies AuditFieldPoliciesDto;
