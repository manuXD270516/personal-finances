import { DomainError, LocalDate, Money, MoneyDecimal, type Currency } from '@pf/shared-kernel';
import type { ChargeSpec } from './loan-types.js';

/**
 * Primitivas aritméticas del cronograma (openspec add-loans decisión 3 y add-loan-amortization-advanced decisión 1):
 * unidades menores `bigint`, tasas escaladas a 10^18 y un único redondeo HALF_EVEN. Las comparten el calculador, el
 * motor de filas, el recalculador y el simulador.
 */

export const RATE_SCALE = 18;
export const RATE_UNIT = 10n ** BigInt(RATE_SCALE);

export const validation = (message: string, details?: Record<string, unknown>) =>
  new DomainError('VALIDATION_FAILED', message, details ? { details } : {});

/** Cociente entero de a/b (b > 0, a ≥ 0) con redondeo HALF_EVEN. */
export function divHalfEven(a: bigint, b: bigint): bigint {
  const q = a / b;
  const r = a % b;
  const twice = 2n * r;
  return twice > b || (twice === b && q % 2n === 1n) ? q + 1n : q;
}

/** Tasa decimal (0..max) → entero escalado a 10^18. */
export function rateUnits(value: string, label: string, max: string): bigint {
  let d;
  try {
    d = new MoneyDecimal(value);
  } catch {
    throw validation(`${label} must be a decimal string`, { field: label });
  }
  if (!d.isFinite() || d.isNeg() || d.gt(max) || d.decimalPlaces() > RATE_SCALE) {
    throw validation(`${label} must be between 0 and ${max} with at most ${RATE_SCALE} decimals`, {
      field: label,
    });
  }
  return BigInt(d.times(RATE_UNIT.toString()).toFixed(0));
}

/** Días 30/360 europeo (días 31 → 30) entre dos fechas. */
export function days360European(from: LocalDate, to: LocalDate): number {
  return (
    360 * (to.year - from.year) +
    30 * (to.month - from.month) +
    (Math.min(to.day, 30) - Math.min(from.day, 30))
  );
}

/** Suma `months` meses conservando el día; día inexistente ⇒ último día del mes (mismo criterio que el motor). */
export function addMonthsClamped(date: LocalDate, months: number): LocalDate {
  const index = date.year * 12 + (date.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return LocalDate.of(year, month, Math.min(date.day, LocalDate.daysInMonth(year, month)));
}

export interface ChargeCalc {
  readonly fixed: bigint | null;
  readonly rate: bigint | null;
}

export function chargeCalc(spec: ChargeSpec | undefined, currency: Currency, label: string): ChargeCalc {
  if (!spec) return { fixed: 0n, rate: null };
  if (spec.mode === 'FIXED') {
    const money = Money.parse(spec.value, currency);
    if (money.isNegative()) throw validation(`${label} must not be negative`, { field: label });
    return { fixed: money.toMinorUnits(), rate: null };
  }
  if (spec.mode === 'RATE_ON_BALANCE') {
    return { fixed: null, rate: rateUnits(spec.value, label, '1') };
  }
  throw validation(`${label} has an unknown mode`, { field: label });
}

/** Unidades menores → texto decimal a la escala de la moneda. */
export function fmt(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const intPart = digits.slice(0, digits.length - scale);
  const frac = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
  return `${negative ? '-' : ''}${intPart}${frac}`;
}

/** Texto decimal a la escala de la moneda → unidades menores. */
export function unitsOf(value: string, currency: Currency): bigint {
  return Money.parse(value, currency).toMinorUnits();
}
