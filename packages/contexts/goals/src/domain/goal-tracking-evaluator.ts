import { Money, dec, type Decimal, type LocalDate } from '@pf/shared-kernel';
import type { GoalStatus } from './goal-lifecycle.js';
import { presentPercent } from './goal-progress-calculator.js';
import type { TrackingStatus } from './goal-types.js';

export interface GoalTracking {
  /** `null` si no aplica (la meta no está `ACTIVE` o no tiene fecha objetivo): se informa el estado de ciclo de vida. */
  readonly status: TrackingStatus | null;
  readonly lifecycleStatus: GoalStatus;
  /** Esperado lineal a hoy, a la escala del objetivo; `null` si no aplica. */
  readonly expected: Money | null;
  /** Desvío relativo en porcentaje con 2 decimales (signo incluido); `null` si no aplica o el esperado es 0. */
  readonly deviationPercent: string | null;
}

export interface GoalTrackingInput {
  readonly lifecycleStatus: GoalStatus;
  readonly target: Money;
  /** Saldo acumulado (parte convertida) sin redondear. */
  readonly progress: Decimal;
  readonly startDate: LocalDate;
  readonly targetDate: LocalDate | null;
  readonly today: LocalDate;
  /** Tolerancia en porcentaje (`"5.00"`), inclusiva. */
  readonly tolerancePercent: string;
}

const NOT_APPLICABLE = (lifecycleStatus: GoalStatus): GoalTracking => ({
  status: null,
  lifecycleStatus,
  expected: null,
  deviationPercent: null,
});

/**
 * `GoalTrackingEvaluator` (openspec add-savings-goals, decisión 14; FR-GOALS-003): compara el saldo con el esperado
 * lineal (`objetivo × días transcurridos ÷ días entre inicio y fecha objetivo`). `ON_TRACK` si el desvío relativo está
 * dentro de la tolerancia (extremos incluidos), `BEHIND` por debajo y `AHEAD` por encima. Una fecha objetivo vencida
 * sin alcanzar es `BEHIND`. Solo las metas `ACTIVE` con fecha objetivo informan estado de avance.
 */
export function evaluateTracking(input: GoalTrackingInput): GoalTracking {
  const { lifecycleStatus, targetDate } = input;
  if (lifecycleStatus !== 'ACTIVE' || targetDate === null) return NOT_APPLICABLE(lifecycleStatus);
  const total = targetDate.toEpochDay() - input.startDate.toEpochDay();
  const elapsedRaw = input.today.toEpochDay() - input.startDate.toEpochDay();
  const elapsed = Math.max(0, Math.min(elapsedRaw, total));
  const target = input.target.toDecimal();
  const expectedExact = target.times(elapsed).div(total);
  const expected = Money.roundToScale(expectedExact, input.target.currency);
  const overdue = input.today.compare(targetDate) > 0 && input.progress.lt(target);
  if (expectedExact.isZero()) {
    return { status: 'ON_TRACK', lifecycleStatus, expected, deviationPercent: null };
  }
  const deviation = input.progress.minus(expectedExact).div(expectedExact).times(100);
  const tolerance = dec(input.tolerancePercent);
  let status: TrackingStatus;
  if (overdue) status = 'BEHIND';
  else if (deviation.abs().lte(tolerance)) status = 'ON_TRACK';
  else status = deviation.lt(0) ? 'BEHIND' : 'AHEAD';
  return { status, lifecycleStatus, expected, deviationPercent: presentPercent(deviation) };
}
