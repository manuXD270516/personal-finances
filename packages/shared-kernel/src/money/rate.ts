import { DomainError } from '../errors/domain-error.js';
import { sameCurrency, type Currency } from './currency.js';
import { dec, MoneyDecimal, type Decimal } from './decimal.js';
import { Money } from './money.js';
import { divToScale, mulToScale, roundDecimal, type RoundingMode } from './rounding.js';

const RATE_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
/** Las tasas se persisten como NUMERIC(38,18). */
export const RATE_PERSIST_SCALE = 18;

/**
 * Tasa de cambio: 1 `base` = `value` `quote` (docs/09 §7.1). Promovida desde SPIKE-03 (add-ledger-core, tarea 2.1).
 *
 * `inverse()` se calcula a precisión 40 y conserva el vínculo con la tasa original: una conversión con una inversa
 * derivada usa SIEMPRE la tasa original en su orientación (división) y `inverse().inverse()` devuelve la instancia
 * original, de modo que nunca se encadenan inversas redondeadas (INV-032). El ledger no valora (ARCHITECTURE §4.1):
 * `Rate` lo consumen FX/Transactions/Reporting.
 */
export class Rate {
  readonly base: Currency;
  readonly quote: Currency;
  readonly value: Decimal;
  readonly #origin: Rate | undefined;

  private constructor(base: Currency, quote: Currency, value: Decimal, origin?: Rate) {
    if (sameCurrency(base, quote)) {
      throw new DomainError('INVALID_RATE', 'base and quote must differ');
    }
    if (!value.isFinite() || value.lte(0)) {
      throw new DomainError('INVALID_RATE', 'rate value must be > 0');
    }
    this.base = base;
    this.quote = quote;
    this.value = dec(value);
    this.#origin = origin;
    Object.freeze(this);
  }

  static of(base: Currency, quote: Currency, value: string): Rate {
    if (typeof value !== 'string' || !RATE_PATTERN.test(value)) {
      throw new DomainError('INVALID_RATE', `not a positive canonical decimal string: ${String(value)}`);
    }
    return new Rate(base, quote, new MoneyDecimal(value));
  }

  /** Tasas derivadas de montos (tasa efectiva), a precisión completa. */
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

  /** El mismo par en la orientación pedida (no-op o inversa). */
  oriented(base: Currency): Rate {
    if (sameCurrency(base, this.base)) return this;
    if (sameCurrency(base, this.quote)) return this.inverse();
    throw new DomainError(
      'CURRENCY_MISMATCH',
      `${base.code} is not part of ${this.base.code}/${this.quote.code}`,
    );
  }

  /** Literal NUMERIC(38,18): 18 decimales HALF_EVEN, solo al persistir o mostrar. */
  toPersisted(): string {
    return roundDecimal(this.value, RATE_PERSIST_SCALE, 'HALF_EVEN').toFixed(RATE_PERSIST_SCALE);
  }

  /** Convierte un monto de cualquiera de los lados del par con UNA cuantización a la escala destino (HALF_EVEN). */
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
    throw new DomainError(
      'CURRENCY_MISMATCH',
      `${amount.currency.code} is not part of ${this.base.code}/${this.quote.code}`,
    );
  }
}
