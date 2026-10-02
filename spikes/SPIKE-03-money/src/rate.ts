import { sameCurrency, type Currency } from './currency.js';
import { dec, MoneyDecimal, type Decimal } from './decimal.js';
import { MoneyError } from './errors.js';
import { Money } from './money.js';
import { divToScale, mulToScale, roundDecimal, type RoundingMode } from './rounding.js';

const RATE_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
export const RATE_PERSIST_SCALE = 18;

/**
 * Exchange rate: 1 `base` = `value` `quote` (docs/09 §7.1).
 *
 * `inverse()` is computed at precision 40 and keeps a link to the original
 * rate. Conversions through a derived inverse always use the ORIGINAL rate in
 * its own orientation (division), and `inverse().inverse()` returns the
 * original instance, so rounded inverses are never chained (INV-032).
 */
export class Rate {
  readonly base: Currency;
  readonly quote: Currency;
  readonly value: Decimal;
  /** Set only on rates produced by `inverse()`. */
  readonly #origin: Rate | undefined;

  private constructor(base: Currency, quote: Currency, value: Decimal, origin?: Rate) {
    if (sameCurrency(base, quote) || base.code === quote.code) {
      throw new MoneyError('INVALID_RATE', 'base and quote must differ');
    }
    if (!value.isFinite() || value.lte(0)) {
      throw new MoneyError('INVALID_RATE', 'rate value must be > 0');
    }
    this.base = base;
    this.quote = quote;
    this.value = dec(value);
    this.#origin = origin;
    Object.freeze(this);
  }

  static of(base: Currency, quote: Currency, value: string): Rate {
    if (typeof value !== 'string' || !RATE_PATTERN.test(value)) {
      throw new MoneyError('INVALID_RATE', `not a positive canonical decimal string: ${String(value)}`);
    }
    return new Rate(base, quote, new MoneyDecimal(value));
  }

  /** Internal factory for rates derived from amounts (effective rates). Full precision. */
  static derived(base: Currency, quote: Currency, value: Decimal): Rate {
    return new Rate(base, quote, value);
  }

  get isDerivedInverse(): boolean {
    return this.#origin !== undefined;
  }

  inverse(): Rate {
    if (this.#origin) return this.#origin;
    return new Rate(this.quote, this.base, new MoneyDecimal(1).div(this.value), this);
  }

  /** Same pair in the requested orientation (no-op or inverse). */
  oriented(base: Currency): Rate {
    if (sameCurrency(base, this.base)) return this;
    if (sameCurrency(base, this.quote)) return this.inverse();
    throw new MoneyError('CURRENCY_MISMATCH', `${base.code} is not part of ${this.base.code}/${this.quote.code}`);
  }

  /** NUMERIC(38,18) literal: 18 decimals HALF_EVEN, only when persisting/displaying. */
  toPersisted(): string {
    return roundDecimal(this.value, RATE_PERSIST_SCALE, 'HALF_EVEN').toFixed(RATE_PERSIST_SCALE);
  }

  /**
   * Convert an amount in either side of the pair; one single quantization to
   * the target currency scale (HALF_EVEN by default, docs/09 §7.1).
   */
  convert(amount: Money, mode: RoundingMode = 'HALF_EVEN'): Money {
    const original = this.#origin ?? this;
    if (sameCurrency(amount.currency, original.base)) {
      const target = original.quote;
      return Money.ofMinorUnits(mulToScale(amount.amount, original.value, target.scale, mode), target);
    }
    if (sameCurrency(amount.currency, original.quote)) {
      const target = original.base;
      return Money.ofMinorUnits(divToScale(amount.amount, original.value, target.scale, mode), target);
    }
    throw new MoneyError(
      'CURRENCY_MISMATCH',
      `${amount.currency.code} is not part of ${this.base.code}/${this.quote.code}`,
    );
  }
}
