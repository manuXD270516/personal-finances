import { DomainError } from './domain-error.js';

/** Money mínimo para el spike: unidades menores en bigint (ver SPIKE-03 / ADR-0006 para el diseño real). */
export class Money {
  private constructor(
    readonly minor: bigint,
    readonly currency: string,
  ) {}

  static ofMinor(minor: bigint, currency: string): Money {
    if (!/^[A-Z]{3}$/.test(currency)) throw new DomainError('MONEY_INVALID_CURRENCY', `Moneda inválida: ${currency}`);
    return new Money(minor, currency);
  }

  static zero(currency: string): Money {
    return Money.ofMinor(0n, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  negate(): Money {
    return new Money(-this.minor, this.currency);
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new DomainError('MONEY_CURRENCY_MISMATCH', `${this.currency} != ${other.currency}`);
    }
  }
}
