/**
 * API pública de `@pf/planning` (consumida por otros contextos y por `apps/api`; openspec add-financial-periods
 * § Contratos). Hoja: no importa capas internas. `PeriodQuery` es el ÚNICO nombre del catálogo de periodos (los
 * borradores de pf-p2b lo llamaban `PeriodCatalog`).
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';

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
} as const;

export const PERIOD_QUERY = Symbol.for('pf.planning.PeriodQuery');
export const PLANNING_EDIT_GUARD = Symbol.for('pf.planning.PlanningEditGuard');

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
} as const satisfies AuditFieldPoliciesDto;
