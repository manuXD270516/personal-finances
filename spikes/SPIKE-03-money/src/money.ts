import { assertSameCurrency, sameCurrency, type Currency } from './currency.js';
import { dec, MoneyDecimal, type Decimal } from './decimal.js';
import { MoneyError } from './errors.js';
import {
  divToScale,
  mulDivToScale,
  mulToScale,
  pow10,
  roundDecimal,
  scaledToString,
  toScaled,
  type RoundingMode,
} from './rounding.js';

/** Canonical decimal string accepted at boundaries (API, DB, user input). */
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** NUMERIC(38,18): at most 20 integer digits. */
export const MAX_INTEGER_DIGITS = 20;
const LIMIT = new MoneyDecimal(10).pow(MAX_INTEGER_DIGITS);

/** Allocation weight: decimal string, bigint or a safe non-negative integer. */
export type Weight = string | bigint | number;

export interface MoneyJson {
  readonly amount: string;
  readonly currency: string;
}

/**
 * Immutable Money value object.
 *
 * Invariant (INV-001/002/003): `amount` is an exact decimal.js value of the
 * isolated MoneyDecimal clone, has at most `currency.scale` decimals, is never
 * negative zero and has at most 20 integer digits (NUMERIC(38,18)).
 * Unrounded intermediate math uses `Decimal` directly; Money is always a
 * materialized amount.
 */
export class Money {
  readonly amount: Decimal;
  readonly currency: Currency;

  private constructor(amount: Decimal, currency: Currency) {
    // normalizes -0 to 0 and detaches from foreign Decimal constructors
    this.amount = amount.isZero() ? new MoneyDecimal(0) : dec(amount);
    this.currency = currency;
    if (this.amount.abs().gte(LIMIT)) {
      throw new MoneyError('AMOUNT_OUT_OF_RANGE', `|amount| must be < 10^${MAX_INTEGER_DIGITS}`);
    }
    Object.freeze(this);
  }

  // ---------- construction ----------

  /**
   * Parse a canonical decimal string. Rejects numbers, exponents, separators,
   * whitespace, NaN/Infinity (MONEY_INVALID_AMOUNT) and more significant
   * decimals than the currency scale (MONEY_SCALE_EXCEEDED). Trailing zeros
   * beyond the scale are accepted, because PostgreSQL NUMERIC(38,18) returns
   * "685.000000000000000000" for a BOB amount.
   */
  static of(amount: string, currency: Currency): Money {
    if (typeof amount !== 'string' || !DECIMAL_PATTERN.test(amount)) {
      throw new MoneyError('MONEY_INVALID_AMOUNT', `not a canonical decimal string: ${String(amount)}`);
    }
    const value = new MoneyDecimal(amount);
    if (value.decimalPlaces() > currency.scale) {
      throw new MoneyError(
        'MONEY_SCALE_EXCEEDED',
        `${amount} has more than ${currency.scale} decimals for ${currency.code}`,
      );
    }
    return new Money(value, currency);
  }

  /** Alias of `of`, reads better at adapter boundaries. */
  static parse(amount: string, currency: Currency): Money {
    return Money.of(amount, currency);
  }

  static zero(currency: Currency): Money {
    return new Money(new MoneyDecimal(0), currency);
  }

  static ofMinorUnits(units: bigint, currency: Currency): Money {
    return new Money(dec(scaledToString(units, currency.scale)), currency);
  }

  /**
   * Materialization point: round an unrounded value to the currency scale.
   * HALF_EVEN by default (docs/09 §12 rule 2).
   */
  static roundToScale(value: Decimal | string, currency: Currency, mode: RoundingMode = 'HALF_EVEN'): Money {
    const v = typeof value === 'string' ? Money.parseUnbounded(value) : dec(value);
    return new Money(roundDecimal(v, currency.scale, mode), currency);
  }

  static sum(items: readonly Money[], currency: Currency): Money {
    return items.reduce((acc, m) => acc.add(m), Money.zero(currency));
  }

  private static parseUnbounded(value: string): Decimal {
    if (!DECIMAL_PATTERN.test(value)) {
      throw new MoneyError('MONEY_INVALID_AMOUNT', `not a canonical decimal string: ${value}`);
    }
    return new MoneyDecimal(value);
  }

  private static factor(value: Decimal | string): Decimal {
    return typeof value === 'string' ? Money.parseUnbounded(value) : dec(value);
  }

  // ---------- same-currency arithmetic (exact) ----------

  add(other: Money): Money {
    assertSameCurrency(this.currency, other.currency);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  subtract(other: Money): Money {
    assertSameCurrency(this.currency, other.currency);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  negate(): Money {
    return new Money(this.amount.neg(), this.currency);
  }

  abs(): Money {
    return new Money(this.amount.abs(), this.currency);
  }

  // ---------- scaling with explicit rounding (single quantization) ----------

  /** amount × factor, rounded once to the currency scale with `mode`. */
  multiply(factor: Decimal | string, mode: RoundingMode): Money {
    const units = mulToScale(this.amount, Money.factor(factor), this.currency.scale, mode);
    return Money.ofMinorUnits(units, this.currency);
  }

  /** amount / divisor, rounded once to the currency scale with `mode`. */
  divide(divisor: Decimal | string, mode: RoundingMode): Money {
    const d = Money.factor(divisor);
    if (d.isZero()) throw new MoneyError('MONEY_INVALID_AMOUNT', 'division by zero');
    return Money.ofMinorUnits(divToScale(this.amount, d, this.currency.scale, mode), this.currency);
  }

  /** amount × pct / 100 (e.g. a 1.5 % fee), rounded once with `mode`. */
  percentage(pct: Decimal | string, mode: RoundingMode): Money {
    const units = mulDivToScale(this.amount, Money.factor(pct), new MoneyDecimal(100), this.currency.scale, mode);
    return Money.ofMinorUnits(units, this.currency);
  }

  // ---------- allocation ----------

  /**
   * Largest-remainder allocation (docs/09 §12 rule 3): each part is truncated
   * (toward zero) to the scale, the remaining minor units go one by one to
   * the parts with the largest fractional remainder, ties -> lowest index.
   * Sign-symmetric: allocate(-x) = -allocate(x). Exact bigint math.
   */
  allocate(weightsOrCount: readonly Weight[] | number): Money[] {
    const weights = normalizeWeights(weightsOrCount);
    const total = this.toMinorUnits();
    const negative = total < 0n;
    const units = negative ? -total : total;
    const sumW = weights.reduce((a, w) => a + w, 0n);

    const floors = weights.map((w) => (units * w) / sumW);
    const remainders = weights.map((w) => (units * w) % sumW);
    let residue = units - floors.reduce((a, f) => a + f, 0n);

    const order = weights
      .map((_, i) => i)
      .sort((i, j) => {
        const ri = remainders[i]!;
        const rj = remainders[j]!;
        return ri === rj ? i - j : ri > rj ? -1 : 1;
      });
    for (const i of order) {
      if (residue === 0n) break;
      floors[i] = floors[i]! + 1n;
      residue -= 1n;
    }
    return floors.map((u) => Money.ofMinorUnits(negative ? -u : u, this.currency));
  }

  // ---------- comparison ----------

  compare(other: Money): -1 | 0 | 1 {
    assertSameCurrency(this.currency, other.currency);
    return this.amount.comparedTo(other.amount) as -1 | 0 | 1;
  }

  /** Never throws: different currencies are simply not equal (TC-LEDGER-MONEY-007). */
  equals(other: Money): boolean {
    return sameCurrency(this.currency, other.currency) && this.amount.eq(other.amount);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNeg();
  }

  isPositive(): boolean {
    return this.amount.isPos() && !this.amount.isZero();
  }

  // ---------- serialization ----------

  /** Canonical API string: exactly `currency.scale` decimals ("685.00"). */
  toString(): string {
    return this.amount.toFixed(this.currency.scale);
  }

  /** NUMERIC(38,18) literal for the DB adapter. */
  toNumeric(): string {
    return this.amount.toFixed(18);
  }

  toJSON(): MoneyJson {
    return { amount: this.toString(), currency: this.currency.code };
  }

  toMinorUnits(): bigint {
    const s = toScaled(this.amount);
    return s.units * pow10(this.currency.scale - s.scale);
  }

  /** Copy of the amount for unrounded intermediate math. */
  toDecimal(): Decimal {
    return dec(this.amount);
  }
}

function normalizeWeights(input: readonly Weight[] | number): bigint[] {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input) || input < 1) {
      throw new MoneyError('INVALID_ALLOCATION', `part count must be a positive integer, got ${input}`);
    }
    return Array.from({ length: input }, () => 1n);
  }
  if (input.length === 0) throw new MoneyError('INVALID_ALLOCATION', 'no weights');
  const decimals = input.map((w) => {
    if (typeof w === 'number' && (!Number.isSafeInteger(w) || w < 0)) {
      throw new MoneyError('INVALID_ALLOCATION', `numeric weights must be safe non-negative integers: ${w}`);
    }
    if (typeof w === 'string' && !DECIMAL_PATTERN.test(w)) {
      throw new MoneyError('INVALID_ALLOCATION', `invalid weight "${w}"`);
    }
    const d = dec(typeof w === 'number' ? String(w) : w);
    if (d.isNeg() && !d.isZero()) throw new MoneyError('INVALID_ALLOCATION', 'negative weight');
    return toScaled(d);
  });
  const maxScale = Math.max(...decimals.map((d) => d.scale));
  const ints = decimals.map((d) => d.units * pow10(maxScale - d.scale));
  if (ints.every((w) => w === 0n)) throw new MoneyError('INVALID_ALLOCATION', 'weights sum to zero');
  return ints;
}
