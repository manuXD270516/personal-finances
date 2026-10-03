// Promovido desde spikes/SPIKE-03-money/src/rounding.ts (add-ledger-core, tarea 2.3; hallazgo H3): cuantización
// racional exacta con bigint, una sola vez, sin límite de precisión intermedio (sin doble redondeo).
import { dec, type Decimal } from './decimal.js';

/**
 * Rounding modes allowed at materialization points. HALF_EVEN is canonical
 * (docs/09 §12); the others exist for explicit business rules (e.g. a provider
 * that truncates fees) and must be named at the call site.
 */
export type RoundingMode = 'HALF_EVEN' | 'HALF_UP' | 'DOWN' | 'UP' | 'FLOOR' | 'CEIL';

/** A decimal as an exact scaled integer: value = units / 10^scale. */
export interface Scaled {
  readonly units: bigint;
  readonly scale: number;
}

export const pow10 = (n: number): bigint => 10n ** BigInt(n);

/** Exact conversion Decimal -> scaled bigint (no rounding, never exponent notation). */
export function toScaled(value: Decimal): Scaled {
  const s = value.toFixed(); // full digits, plain notation
  const negative = s.startsWith('-');
  const body = negative ? s.slice(1) : s;
  const dot = body.indexOf('.');
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? '' : body.slice(dot + 1);
  const units = BigInt(intPart + fracPart);
  return { units: negative ? -units : units, scale: fracPart.length };
}

/** Scaled bigint -> Decimal string with exactly `scale` decimals. */
export function scaledToString(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const intPart = digits.slice(0, digits.length - scale);
  const frac = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${negative && units !== 0n ? '-' : ''}${intPart}${frac}`;
}

/**
 * Exact integer rounding of the rational num/den according to `mode`.
 * This is the single quantization primitive: no intermediate precision limit,
 * hence no double rounding.
 */
export function roundQuotient(num: bigint, den: bigint, mode: RoundingMode): bigint {
  if (den === 0n) throw new RangeError('division by zero');
  const negative = num < 0n !== den < 0n;
  const n = num < 0n ? -num : num;
  const d = den < 0n ? -den : den;
  const q = n / d;
  const r = n % d;
  let increment = false;
  if (r !== 0n) {
    const twice = 2n * r;
    switch (mode) {
      case 'DOWN':
        break;
      case 'UP':
        increment = true;
        break;
      case 'HALF_UP':
        increment = twice >= d;
        break;
      case 'HALF_EVEN':
        increment = twice > d || (twice === d && q % 2n === 1n);
        break;
      case 'FLOOR':
        increment = negative;
        break;
      case 'CEIL':
        increment = !negative;
        break;
    }
  }
  const magnitude = increment ? q + 1n : q;
  return negative ? -magnitude : magnitude;
}

/** round(a × b) to `scale` decimals, exact. Returns the scaled units. */
export function mulToScale(a: Decimal, b: Decimal, scale: number, mode: RoundingMode): bigint {
  const x = toScaled(a);
  const y = toScaled(b);
  return roundQuotient(x.units * y.units * pow10(scale), pow10(x.scale + y.scale), mode);
}

/** round(a / b) to `scale` decimals, exact. Returns the scaled units. */
export function divToScale(a: Decimal, b: Decimal, scale: number, mode: RoundingMode): bigint {
  const x = toScaled(a);
  const y = toScaled(b);
  if (y.units === 0n) throw new RangeError('division by zero');
  return roundQuotient(x.units * pow10(y.scale + scale), y.units * pow10(x.scale), mode);
}

/** Round a Decimal to `scale` decimals (exact, via bigint). */
export function roundDecimal(value: Decimal, scale: number, mode: RoundingMode): Decimal {
  const x = toScaled(value);
  if (x.scale <= scale) return dec(value);
  return dec(scaledToString(roundQuotient(x.units, pow10(x.scale - scale), mode), scale));
}

/** round(a × b / c) to `scale` decimals, exact. Returns the scaled units. */
export function mulDivToScale(a: Decimal, b: Decimal, c: Decimal, scale: number, mode: RoundingMode): bigint {
  const x = toScaled(a);
  const y = toScaled(b);
  const z = toScaled(c);
  if (z.units === 0n) throw new RangeError('division by zero');
  return roundQuotient(x.units * y.units * pow10(z.scale + scale), z.units * pow10(x.scale + y.scale), mode);
}
