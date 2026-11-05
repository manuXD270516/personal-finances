import { dec } from '@pf/shared-kernel';
import { anchorFieldOf, type BudgetLineState, type HistoryBasisState } from '../domain/index.js';
import type { BudgetMoneyDto } from '../contracts/index.js';

/** Explicación (y base guardada) de una sugerencia: solo códigos, montos y fechas; el texto lo arma la interfaz. */
export interface BudgetHistoryBasisDto {
  readonly method: 'AVERAGE' | 'SAME_PERIOD_LAST_YEAR';
  readonly periodsRequested: number;
  readonly adjustmentPercent: string;
  readonly roundingIncrement: number | null;
  readonly usedCount: number;
  readonly minValid: number;
  readonly outlierRule: 'TUKEY_1_5_IQR' | 'NONE_SMALL_SAMPLE';
  readonly q1: string | null;
  readonly q3: string | null;
  readonly mean: string | null;
  readonly median: string | null;
  readonly suggested: BudgetMoneyDto | null;
  /** Solo en `historyBasis` de una línea. */
  readonly applied?: BudgetMoneyDto | null;
  /** Solo en `historyBasis` de una línea: el monto vigente ya no es el aplicado. */
  readonly modifiedAfterSuggestion?: boolean;
  readonly computedAt: string;
  readonly periods: readonly {
    readonly periodId: string | null;
    readonly label: string;
    readonly start: string;
    readonly end: string;
    readonly closed: boolean;
    readonly actual: BudgetMoneyDto | null;
    readonly status: string;
  }[];
}

/** Base guardada de una línea más `modifiedAfterSuggestion` (monto vigente distinto del aplicado). */
export function historyBasisDto(basis: HistoryBasisState, line: BudgetLineState): BudgetHistoryBasisDto {
  const field = anchorFieldOf(line.kind);
  const current = field === null ? null : line[field];
  const code = basis.suggested.currency;
  return {
    method: basis.method,
    periodsRequested: basis.periodsRequested,
    adjustmentPercent: basis.adjustmentPercent,
    roundingIncrement: basis.roundingIncrement,
    usedCount: basis.usedCount,
    minValid: basis.minValid,
    outlierRule: basis.outlierRule,
    q1: basis.q1,
    q3: basis.q3,
    mean: basis.mean,
    median: basis.median,
    suggested: basis.suggested,
    applied: basis.applied,
    modifiedAfterSuggestion: current === null || !dec(current).eq(dec(basis.applied.amount)),
    computedAt: basis.computedAt,
    periods: basis.periods.map((p) => ({
      periodId: p.periodId,
      label: p.label,
      start: p.start,
      end: p.end,
      closed: p.closed,
      actual: p.actual === null ? null : { amount: p.actual, currency: code },
      status: p.status,
    })),
  };
}

export interface BudgetSuggestionWindowPeriodDto {
  readonly periodId: string | null;
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly closed: boolean;
}

export interface BudgetSuggestionLineDto {
  readonly target: { readonly kind: 'CATEGORY' | 'GROUP' | 'TAG'; readonly id: string };
  readonly targetName: string;
  readonly nature: 'EXPENSE' | 'INCOME';
  readonly kind: string;
  readonly existingLineId: string | null;
  readonly currentAmount: BudgetMoneyDto | null;
  readonly suggestedAmount: BudgetMoneyDto | null;
  readonly difference: BudgetMoneyDto | null;
  readonly status: 'OK' | 'INSUFFICIENT_HISTORY' | 'NOT_APPLICABLE';
  readonly explanation: BudgetHistoryBasisDto | null;
}

export interface BudgetSuggestionPreviewDto {
  readonly periodId: string;
  readonly budgetId: string | null;
  readonly budgetVersion: number | null;
  readonly currency: string;
  readonly method: 'AVERAGE' | 'SAME_PERIOD_LAST_YEAR';
  readonly periods: number;
  readonly adjustmentPercent: string;
  readonly roundingIncrement: number | null;
  readonly token: string;
  readonly window: readonly BudgetSuggestionWindowPeriodDto[];
  readonly lines: readonly BudgetSuggestionLineDto[];
}
