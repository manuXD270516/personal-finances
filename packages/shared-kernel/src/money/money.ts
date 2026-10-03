import { DomainError } from '../errors/domain-error.js';
import { currency as makeCurrency, sameCurrency, type Currency } from './currency.js';
import { dec, MoneyDecimal, type Decimal } from './decimal.js';

/** String decimal canónico aceptado en los bordes (API, BD): sin exponente, separadores ni espacios. */
const DECIMAL_STRING = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
/** NUMERIC(38,18): como máximo 20 dígitos enteros. */
export const MAX_INTEGER_DIGITS = 20;
const LIMIT = new MoneyDecimal(10).pow(MAX_INTEGER_DIGITS);

/** Representación JSON de un monto (`components.schemas.Money` del contrato). */
export interface MoneyJson {
  readonly amount: string;
  readonly currency: string;
}

/**
 * Value object `Money` (INV-001: nunca punto flotante; INV-020: nunca redondeo silencioso).
 *
 * Invariantes: `amount` es un decimal exacto con como máximo `currency.scale` decimales significativos y como
 * máximo 20 dígitos enteros; nunca `-0`. Se construye solo desde strings decimales (jamás desde `number`).
 * El álgebra completa (asignación, conversiones) llega con `add-ledger-core`; este change aporta el borde HTTP.
 */
export class Money {
  readonly amount: Decimal;
  readonly currency: Currency;

  private constructor(amount: Decimal, currency: Currency) {
    this.amount = amount.isZero() ? new MoneyDecimal(0) : dec(amount);
    this.currency = currency;
    Object.freeze(this);
  }

  /**
   * Parsea un string decimal en la moneda indicada.
   * - No string, notación exponencial, separadores o espacios → `MONEY_INVALID_AMOUNT`.
   * - Más decimales significativos que `currency.scale` → `AMOUNT_SCALE_EXCEEDED` (sin redondear ni truncar).
   *   Los ceros finales no son significativos: `"685.000"` BOB es exactamente 685.00 (PostgreSQL NUMERIC(38,18)
   *   devuelve `"685.000000000000000000"`).
   * - `|amount| ≥ 10^20` → `AMOUNT_OUT_OF_RANGE`.
   */
  static parse(amount: string, currency: Currency): Money;
  static parse(amount: string, currencyCode: string, scale: number): Money;
  static parse(amount: string, currencyOrCode: Currency | string, scale?: number): Money {
    const cur =
      typeof currencyOrCode === 'string' ? makeCurrency(currencyOrCode, scale ?? Number.NaN) : currencyOrCode;
    if (typeof amount !== 'string' || !DECIMAL_STRING.test(amount)) {
      throw new DomainError('MONEY_INVALID_AMOUNT', `amount must be a decimal string: ${String(amount)}`);
    }
    const value = new MoneyDecimal(amount);
    if (value.decimalPlaces() > cur.scale) {
      throw new DomainError(
        'AMOUNT_SCALE_EXCEEDED',
        `${cur.code} allows ${cur.scale} decimals; got ${value.decimalPlaces()}`,
      );
    }
    if (value.abs().gte(LIMIT)) {
      throw new DomainError('AMOUNT_OUT_OF_RANGE', `|amount| must be < 10^${MAX_INTEGER_DIGITS}`);
    }
    return new Money(value, cur);
  }

  /** Parsea el objeto JSON `{amount, currency}` resolviendo la escala con `scaleOf` (catálogo de monedas). */
  static fromJson(json: MoneyJson, scaleOf: (code: string) => number): Money {
    return Money.parse(json.amount, makeCurrency(json.currency, scaleOf(json.currency)));
  }

  static zero(currency: Currency): Money {
    return new Money(new MoneyDecimal(0), currency);
  }

  /** String con exactamente `currency.scale` decimales: `"1500.00"`, `"100.000000"`. Exacto (sin redondeo). */
  toFixed(): string {
    return this.amount.toFixed(this.currency.scale);
  }

  toString(): string {
    return `${this.toFixed()} ${this.currency.code}`;
  }

  /** Forma del contrato: `{"amount": "<escala canónica>", "currency": "<código>"}`. */
  toJSON(): MoneyJson {
    return { amount: this.toFixed(), currency: this.currency.code };
  }

  equals(other: Money): boolean {
    return sameCurrency(this.currency, other.currency) && this.amount.eq(other.amount);
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isNegative(): boolean {
    return this.amount.isNeg() && !this.amount.isZero();
  }

  isPositive(): boolean {
    return this.amount.isPos() && !this.amount.isZero();
  }
}
