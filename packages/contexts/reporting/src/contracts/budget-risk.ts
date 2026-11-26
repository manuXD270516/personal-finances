/**
 * Contratos del riesgo de exceder un presupuesto (openspec add-budget-overrun-risk, Phase 9, change 74; FR-REPORTING-020).
 * Montos como `{amount: "<decimal>", currency}` (nunca `number`, ADR-0006). Aditivo: no cambia ninguna cifra del plan.
 */
interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
}

export type BudgetRiskStatusDto = 'AVAILABLE' | 'NO_PLAN' | 'NOT_CURRENT_PERIOD' | 'DISABLED';
export type BudgetRiskLevelDto = 'EXCEEDED' | 'LIKELY' | 'POSSIBLE' | 'UNLIKELY' | 'NOT_AVAILABLE';
export type BudgetRiskReasonDto = 'LINE_TYPE' | 'NO_REFERENCE' | 'TOO_EARLY';
export type BudgetRiskBasisDto = 'RUN_RATE' | 'FORECAST';

/** Riesgo de una línea de gasto de categoría o de grupo; las de etiqueta y de ingreso no figuran. */
export interface BudgetLineRiskDto {
  readonly budgetLineId: string;
  readonly target: { readonly kind: 'CATEGORY' | 'GROUP'; readonly id: string };
  /** Nombre de la categoría o del grupo (para el listado del Home). */
  readonly targetName: string;
  readonly reference: MoneyDto;
  readonly actual: MoneyDto;
  readonly variableActual: MoneyDto;
  readonly knownPending: MoneyDto;
  readonly projected: MoneyDto | null;
  readonly projectedHigh: MoneyDto | null;
  /** `false` si algún pago conocido o resuelto quedó fuera por no tener tasa. */
  readonly projectionComplete: boolean;
  readonly level: BudgetRiskLevelDto;
  readonly reason: BudgetRiskReasonDto | null;
  readonly estimatedDate: string | null;
  readonly basis: BudgetRiskBasisDto | null;
}

/** `GET /workspaces/{workspaceId}/periods/{periodId}/budget-risk` (`getBudgetRisk`). */
export interface BudgetRiskDto {
  readonly status: BudgetRiskStatusDto;
  readonly periodId: string;
  /** Plan del periodo (`null` sin plan); lo usa el enlace del aviso. */
  readonly budgetId: string | null;
  /** Fecha de hoy en la zona del workspace. */
  readonly asOf: string;
  /** Moneda del plan (vacía sin plan). */
  readonly currency: string;
  readonly elapsedDays: number;
  readonly remainingDays: number;
  readonly forecastRunId: string | null;
  readonly lines: readonly BudgetLineRiskDto[];
}

/** `ReportSummary.budgetRisk` (Q5): hasta 3 líneas `LIKELY` por fecha estimada; `null` sin plan o sin líneas en riesgo. */
export interface BudgetRiskHomeDto {
  readonly periodId: string;
  readonly periodLabel: string;
  readonly lines: readonly BudgetLineRiskDto[];
  readonly moreCount: number;
}

export const BUDGET_RISK_HOME_LIMIT = 3;
