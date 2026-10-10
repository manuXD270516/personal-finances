import { type Currency, type ExactRate, type Money } from '@pf/shared-kernel';
import { UpcomingValuation, type ValuedTotal } from './upcoming-valuation.js';

export interface PeriodRange {
  readonly id: string;
  readonly label: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface CommittedValued {
  /** Compromisos + pendientes del periodo. */
  readonly total: ValuedTotal;
  readonly fromCommitments: ValuedTotal;
  readonly fromPending: ValuedTotal;
  readonly withoutAmountCount: number;
  /** Vencidas de periodos anteriores: se informan aparte y NO suman al total (D146). */
  readonly overdueFromPreviousPeriods: { readonly count: number } & ValuedTotal;
}

/**
 * DS `CommittedPeriod` (design.md decisión 8): ubica el periodo financiero que contiene hoy (respeta el día de inicio
 * del mes financiero, que ya viene resuelto en los periodos) y valora el comprometido que informa COMMITMENTS con la
 * misma valoración que la lista (`UpcomingValuation`).
 */
export const CommittedPeriod = {
  /** Periodo `[inicio, fin]` que contiene la fecha local `today`; `null` si ninguno la cubre. */
  locate<P extends PeriodRange>(periods: readonly P[], today: string): P | null {
    return periods.find((p) => p.periodStart <= today && today <= p.periodEnd) ?? null;
  },

  value(input: {
    readonly fromCommitments: readonly Money[];
    readonly fromPending: readonly Money[];
    readonly withoutAmountCount: number;
    readonly overdueBefore: { readonly count: number; readonly amounts: readonly Money[] };
    readonly today: string;
    readonly target: Currency;
    readonly rateFor: (currency: string, date: string) => ExactRate | null;
  }): CommittedValued {
    const { today, target, rateFor } = input;
    const value = (lines: readonly Money[]) => UpcomingValuation.value(lines, today, target, rateFor);
    return {
      // Una sola consolidación del total: Σ exacta por moneda antes de convertir (no la suma de dos redondeos).
      total: value([...input.fromCommitments, ...input.fromPending]),
      fromCommitments: value(input.fromCommitments),
      fromPending: value(input.fromPending),
      withoutAmountCount: input.withoutAmountCount,
      overdueFromPreviousPeriods: { count: input.overdueBefore.count, ...value(input.overdueBefore.amounts) },
    };
  },
} as const;
