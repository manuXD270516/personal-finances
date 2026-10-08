import { dec, type Decimal } from '@pf/shared-kernel';
import type { RolloverPolicy } from './budget-types.js';

/**
 * DS `RolloverCalculator` (FR-PLANNING-020, design decisión 10), puro. El remanente del periodo N-1 de una línea con
 * política de rollover pasa al planificado de N:
 *   - `CARRY_POSITIVE`: solo el remanente positivo; `CARRY_ALL`: también el exceso (negativo);
 *   - acotado a +-`cap` si se definió;
 *   - el planificado efectivo nunca baja de 0.00.
 */
export const RolloverCalculator = {
  /** Remanente que sale del periodo N-1: `reference - actual` filtrado por política y tope. */
  carryOut(input: {
    readonly policy: RolloverPolicy;
    readonly cap: Decimal | null;
    readonly reference: Decimal;
    readonly actual: Decimal;
  }): Decimal {
    if (input.policy === 'NONE') return dec('0');
    const remainder = input.reference.minus(input.actual);
    let carried = input.policy === 'CARRY_POSITIVE' ? (remainder.lt(0) ? dec('0') : remainder) : remainder;
    if (input.cap !== null) {
      const cap = input.cap.abs();
      if (carried.gt(cap)) carried = cap;
      if (carried.lt(cap.negated())) carried = cap.negated();
    }
    return carried;
  },

  /** Planificado efectivo: `max(0, planificado + rollover recibido)`. */
  effectivePlanned(planned: Decimal, rolloverIn: Decimal | null): Decimal {
    const total = rolloverIn === null ? planned : planned.plus(rolloverIn);
    return total.lt(0) ? dec('0') : total;
  },
} as const;
