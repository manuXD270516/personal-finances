import { DomainError } from '../errors/domain-error.js';
import { assertSameCurrency, currency as makeCurrency, sameCurrency, type Currency } from './currency.js';
import { dec, MoneyDecimal, type Decimal } from './decimal.js';
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

/** Peso de reparto: string decimal, bigint o entero seguro no negativo (nunca un monto). */
export type Weight = string | bigint | number;

/**
 * Value object `Money` (ADR-0006; INV-001: nunca punto flotante; INV-002: aritmética exacta; INV-003: escala por
 * moneda; INV-020: nunca redondeo silencioso).
 *
 * Invariantes: `amount` es un decimal exacto del clon aislado `MoneyDecimal`, con como máximo `currency.scale`
 * decimales significativos y 20 dígitos enteros (NUMERIC(38,18)); nunca `-0`. Se construye solo desde strings
 * decimales (jamás desde `number`) o desde unidades menores `bigint`. Las operaciones que pueden producir más
 * decimales (`multiply`, `divide`, `percentage`, `roundToScale`) exigen un modo de redondeo y cuantizan una sola vez
 * con aritmética racional exacta (hallazgo H3 de SPIKE-03). Promovido desde `spikes/SPIKE-03-money` en add-ledger-core.
 */
export class Money {
  readonly amount: Decimal;
  readonly currency: Currency;

  private constructor(amount: Decimal, currency: Currency) {
    this.amount = amount.isZero() ? new MoneyDecimal(0) : dec(amount);
    this.currency = currency;
    if (this.amount.abs().gte(LIMIT)) {
      throw new DomainError('AMOUNT_OUT_OF_RANGE', `|amount| must be < 10^${MAX_INTEGER_DIGITS}`);
    }
    Object.freeze(this);
  }

  // ---------- construcción ----------

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
    const value = parseDecimal(amount);
    if (value.decimalPlaces() > cur.scale) {
      throw new DomainError(
        'AMOUNT_SCALE_EXCEEDED',
        `${cur.code} allows ${cur.scale} decimals; got ${value.decimalPlaces()}`,
      );
    }
    return new Money(value, cur);
  }

  /** Alias de `parse` (nombre del prototipo de SPIKE-03). */
  static of(amount: string, currency: Currency): Money {
    return Money.parse(amount, currency);
  }

  /** Parsea el objeto JSON `{amount, currency}` resolviendo la escala con `scaleOf` (catálogo de monedas). */
  static fromJson(json: MoneyJson, scaleOf: (code: string) => number): Money {
    return Money.parse(json.amount, makeCurrency(json.currency, scaleOf(json.currency)));
  }

  static zero(currency: Currency): Money {
    return new Money(new MoneyDecimal(0), currency);
  }

  /** Desde unidades menores exactas: `ofMinorUnits(12345n, BOB)` = 123.45 BOB. */
  static ofMinorUnits(units: bigint, currency: Currency): Money {
    return new Money(dec(scaledToString(units, currency.scale)), currency);
  }

  /** Punto de materialización: redondea un valor sin redondear a la escala de la moneda (HALF_EVEN por defecto). */
  static roundToScale(value: Decimal | string, currency: Currency, mode: RoundingMode = 'HALF_EVEN'): Money {
    const v = typeof value === 'string' ? parseDecimal(value) : dec(value);
    return new Money(roundDecimal(v, currency.scale, mode), currency);
  }

  /** Σ exacta; todos los sumandos deben estar en `currency` (`CURRENCY_MISMATCH` si no). */
  static sum(items: readonly Money[], currency: Currency): Money {
    return items.reduce((acc, m) => acc.add(m), Money.zero(currency));
  }

  // ---------- aritmética en la misma moneda (exacta) ----------

  add(other: Money): Money {
    assertSameCurrency(this.currency, other.currency);
    return new Money(this.amount.plus(other.amount), this.currency);
  }

  subtract(other: Money): Money {
    assertSameCurrency(this.currency, other.currency);
    return new Money(this.amount.minus(other.amount), this.currency);
  }

  /** Negación exacta (reversas, INV-008). */
  negate(): Money {
    return new Money(this.amount.neg(), this.currency);
  }

  abs(): Money {
    return new Money(this.amount.abs(), this.currency);
  }

  // ---------- escalado con redondeo explícito (una sola cuantización) ----------

  multiply(factor: Decimal | string, mode: RoundingMode): Money {
    const units = mulToScale(this.amount, factorOf(factor), this.currency.scale, mode);
    return Money.ofMinorUnits(units, this.currency);
  }

  divide(divisor: Decimal | string, mode: RoundingMode): Money {
    const d = factorOf(divisor);
    if (d.isZero()) throw new DomainError('MONEY_INVALID_AMOUNT', 'division by zero');
    return Money.ofMinorUnits(divToScale(this.amount, d, this.currency.scale, mode), this.currency);
  }

  /** amount × pct / 100 (p. ej. una comisión de 1.5 %). */
  percentage(pct: Decimal | string, mode: RoundingMode): Money {
    const units = mulDivToScale(this.amount, factorOf(pct), new MoneyDecimal(100), this.currency.scale, mode);
    return Money.ofMinorUnits(units, this.currency);
  }

  // ---------- reparto ----------

  /**
   * Reparto por mayor residuo (docs/09 §12 regla 3, hallazgo H5): cada parte se trunca hacia cero a la escala y las
   * unidades menores restantes van una a una a las partes con mayor resto; empate → menor índice. Simétrico en signo
   * (`allocate(-x) = -allocate(x)`), Σ partes = total exacto (INV-021). Aritmética bigint exacta.
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

  // ---------- comparación ----------

  compare(other: Money): -1 | 0 | 1 {
    assertSameCurrency(this.currency, other.currency);
    return this.amount.comparedTo(other.amount) as -1 | 0 | 1;
  }

  /** Nunca lanza: monedas distintas simplemente no son iguales (TC-LEDGER-MONEY-007). */
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

  // ---------- serialización ----------

  /** String con exactamente `currency.scale` decimales: `"1500.00"`, `"100.000000"`. Exacto (sin redondeo). */
  toFixed(): string {
    return this.amount.toFixed(this.currency.scale);
  }

  toString(): string {
    return `${this.toFixed()} ${this.currency.code}`;
  }

  /** Literal NUMERIC(38,18) para el adaptador de BD. */
  toNumeric(): string {
    return this.amount.toFixed(18);
  }

  /** Forma del contrato: `{"amount": "<escala canónica>", "currency": "<código>"}`. */
  toJSON(): MoneyJson {
    return { amount: this.toFixed(), currency: this.currency.code };
  }

  toMinorUnits(): bigint {
    const s = toScaled(this.amount);
    return s.units * pow10(this.currency.scale - s.scale);
  }

  /** Copia del monto para aritmética intermedia sin redondear (precisión 40). */
  toDecimal(): Decimal {
    return dec(this.amount);
  }
}

function parseDecimal(value: unknown): Decimal {
  if (typeof value !== 'string' || !DECIMAL_STRING.test(value)) {
    throw new DomainError('MONEY_INVALID_AMOUNT', `amount must be a decimal string: ${String(value)}`);
  }
  return new MoneyDecimal(value);
}

const factorOf = (value: Decimal | string): Decimal =>
  typeof value === 'string' ? parseDecimal(value) : dec(value);

function normalizeWeights(input: readonly Weight[] | number): bigint[] {
  if (typeof input === 'number') {
    if (!Number.isSafeInteger(input) || input < 1) {
      throw new DomainError('INVALID_ALLOCATION', `part count must be a positive integer, got ${input}`);
    }
    return Array.from({ length: input }, () => 1n);
  }
  if (input.length === 0) throw new DomainError('INVALID_ALLOCATION', 'no weights');
  const decimals = input.map((w) => {
    if (typeof w === 'number' && (!Number.isSafeInteger(w) || w < 0)) {
      throw new DomainError('INVALID_ALLOCATION', `numeric weights must be safe non-negative integers: ${w}`);
    }
    if (typeof w === 'string' && !DECIMAL_STRING.test(w)) {
      throw new DomainError('INVALID_ALLOCATION', `invalid weight "${w}"`);
    }
    const d = dec(typeof w === 'string' ? w : String(w));
    if (d.isNeg() && !d.isZero()) throw new DomainError('INVALID_ALLOCATION', 'negative weight');
    return toScaled(d);
  });
  const maxScale = Math.max(...decimals.map((d) => d.scale));
  const ints = decimals.map((d) => d.units * pow10(maxScale - d.scale));
  if (ints.every((w) => w === 0n)) throw new DomainError('INVALID_ALLOCATION', 'weights sum to zero');
  return ints;
}
