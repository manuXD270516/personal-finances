/** Riesgo de exceder un presupuesto (contrato `BudgetRisk` / `BudgetLineRisk`, add-budget-overrun-risk). */
interface Money {
  readonly amount: string;
  readonly currency: string;
}

export type BudgetRiskLevel =
  'EXCEEDED' | 'LIKELY' | 'POSSIBLE' | 'UNLIKELY' | 'NOT_AVAILABLE' | (string & {});
export type BudgetRiskBasis = 'RUN_RATE' | 'FORECAST';

export interface BudgetLineRisk {
  readonly budgetLineId: string;
  readonly target: { readonly kind: 'CATEGORY' | 'GROUP'; readonly id: string };
  readonly targetName: string;
  readonly reference: Money;
  readonly actual: Money;
  readonly variableActual: Money;
  readonly knownPending: Money;
  readonly projected: Money | null;
  readonly projectedHigh: Money | null;
  readonly projectionComplete: boolean;
  readonly level: BudgetRiskLevel;
  readonly reason: 'LINE_TYPE' | 'NO_REFERENCE' | 'TOO_EARLY' | (string & {}) | null;
  readonly estimatedDate: string | null;
  readonly basis: BudgetRiskBasis | null;
}

export interface BudgetRisk {
  readonly status: 'AVAILABLE' | 'NO_PLAN' | 'NOT_CURRENT_PERIOD' | 'DISABLED' | (string & {});
  readonly periodId: string;
  readonly budgetId: string | null;
  readonly asOf: string;
  readonly currency: string;
  readonly elapsedDays: number;
  readonly remainingDays: number;
  readonly forecastRunId: string | null;
  readonly lines: readonly BudgetLineRisk[];
}

/** Bloque `budgetRisk` del resumen del Home (Q5). */
export interface BudgetRiskHome {
  readonly periodId: string;
  readonly periodLabel: string;
  readonly lines: readonly BudgetLineRisk[];
  readonly moreCount: number;
}
