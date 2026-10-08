import { DomainError } from '../errors/domain-error.js';
import type { Currency } from '../money/currency.js';
import type { Decimal } from '../money/decimal.js';
import { Money } from '../money/money.js';

/**
 * Tasa EXACTA de valoración en su orientación almacenada (1 `base` = `value` `quote`), a precisión completa. Viene de
 * FX (`ValuationRateDto.exact`): para una inversa es la tasa original, nunca una inversa redondeada (INV-032).
 */
export interface ExactRate {
  readonly base: string;
  readonly quote: string;
  readonly value: Decimal;
}

/**
 * Convierte SIN redondear (precisión 40, docs/14 §5): multiplica desde `base`, divide desde `quote`. La cuantización
 * HALF_EVEN ocurre una sola vez, al presentar (`present`).
 */
export function convertExact(amount: Money, target: Currency, rate: ExactRate): Decimal {
  const from = amount.currency.code;
  if (from === target.code) return amount.toDecimal();
  if (rate.base === from && rate.quote === target.code) return amount.amount.times(rate.value);
  if (rate.quote === from && rate.base === target.code) return amount.amount.div(rate.value);
  throw new DomainError(
    'CURRENCY_MISMATCH',
    `rate ${rate.base}/${rate.quote} cannot convert ${from} to ${target.code}`,
  );
}

/** Punto ÚNICO de materialización: HALF_EVEN a la escala de la moneda de reporte (NFR-DATA-002). */
export function present(value: Decimal, target: Currency): Money {
  return Money.roundToScale(value, target, 'HALF_EVEN');
}

/** Σ exacta por moneda (orden por código, determinista). */
export function sumByCurrency(amounts: readonly Money[]): Money[] {
  const totals = new Map<string, Money>();
  for (const m of amounts) {
    const prev = totals.get(m.currency.code);
    totals.set(m.currency.code, prev ? prev.add(m) : m);
  }
  return [...totals.values()].sort((a, b) => (a.currency.code < b.currency.code ? -1 : 1));
}
