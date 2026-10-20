import { describe, expect, it } from 'vitest';
import { type DomainError } from '../errors/domain-error.js';
import { currency } from '../money/currency.js';
import { dec } from '../money/decimal.js';
import { Money } from '../money/money.js';
import { convertExact, present, sumByCurrency, type ExactRate } from './exact-rate.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const EUR = currency('EUR', 2);
const USD_BOB: ExactRate = { base: 'USD', quote: 'BOB', value: dec('12.05') };

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as DomainError).code;
  }
  return undefined;
};

describe('exact-rate: conversión exacta y presentación HALF_EVEN (docs/14 §5)', () => {
  it('misma moneda: devuelve el monto sin tocarlo, aunque la tasa sea de otro par', () => {
    expect(convertExact(Money.parse('20.00', USD), USD, USD_BOB).toFixed()).toBe('20');
  });

  it('desde la moneda base multiplica por la tasa almacenada', () => {
    expect(convertExact(Money.parse('20.00', USD), BOB, USD_BOB).toFixed()).toBe('241');
  });

  it('desde la moneda cotizada divide por la tasa original (nunca una inversa redondeada, INV-032)', () => {
    const exact = convertExact(Money.parse('100.00', BOB), USD, USD_BOB);
    // 100 / 12.05 = 8.2987551867219917012448132780082987551867... a precisión 40, sin cuantizar a la escala de USD.
    expect(exact.toFixed().startsWith('8.298755186721991701244813278008298755')).toBe(true);
    expect(exact.decimalPlaces()).toBeGreaterThan(2);
    expect(present(exact, USD).toString()).toBe('8.30 USD');
  });

  it('un par que no contiene la moneda de origen y la de destino se rechaza con CURRENCY_MISMATCH', () => {
    expect(codeOf(() => convertExact(Money.parse('5.00', EUR), BOB, USD_BOB))).toBe('CURRENCY_MISMATCH');
    expect(codeOf(() => convertExact(Money.parse('5.00', USD), EUR, USD_BOB))).toBe('CURRENCY_MISMATCH');
  });

  it('present cuantiza a la escala de la moneda con HALF_EVEN (banker rounding)', () => {
    expect(present(dec('2.345'), BOB).toString()).toBe('2.34 BOB');
    expect(present(dec('2.355'), BOB).toString()).toBe('2.36 BOB');
    expect(present(dec('-2.345'), BOB).toString()).toBe('-2.34 BOB');
    expect(present(dec('0.005'), BOB).toString()).toBe('0.00 BOB');
    expect(present(dec('0.015'), BOB).toString()).toBe('0.02 BOB');
  });

  it('sumByCurrency suma por moneda y ordena por código', () => {
    const totals = sumByCurrency([
      Money.parse('10.00', USD),
      Money.parse('1.00', BOB),
      Money.parse('2.50', USD),
      Money.parse('3.00', EUR),
      Money.parse('4.00', BOB),
    ]);
    expect(totals.map(String)).toEqual(['5.00 BOB', '3.00 EUR', '12.50 USD']);
    expect(sumByCurrency([])).toEqual([]);
  });
});
