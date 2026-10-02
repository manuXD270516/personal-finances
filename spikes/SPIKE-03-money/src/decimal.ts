import DecimalJs from 'decimal.js';

/**
 * Isolated decimal.js constructor for money math (ADR-0006, docs/09 §12).
 *
 * - `defaults: true` makes the clone ignore whatever the global `Decimal` was
 *   configured with before this module loaded (`Decimal.clone()` otherwise
 *   copies the current settings of the constructor it is cloned from).
 * - Later `Decimal.set(...)` calls on the global constructor do not touch this
 *   clone: every instance resolves its config through `this.constructor`.
 * - Exponent thresholds are pushed out so `toString()` never emits `1e-7`.
 *
 * Caveat (verified in tests): instances of *any* decimal.js clone pass
 * `instanceof` checks against each other, so an external `Decimal` carries its
 * own constructor config into arithmetic. Money therefore re-wraps every input
 * with `new MoneyDecimal(x)` (exact copy, no rounding) before using it.
 */
export const MoneyDecimal = DecimalJs.clone({
  defaults: true,
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_EVEN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

/** Instance type shared by every decimal.js clone. */
export type Decimal = DecimalJs;

export const MONEY_PRECISION = 40;

/** Re-wrap any decimal-like input into the isolated constructor (exact copy). */
export function dec(value: Decimal | string | bigint): Decimal {
  return new MoneyDecimal(typeof value === 'bigint' ? value.toString() : value);
}
