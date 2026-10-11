import { Money, currency, dec } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateProgress, percentOf, presentPercent } from './goal-progress-calculator.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const bob = (v: string) => Money.parse(v, BOB);
const usd = (v: string) => Money.parse(v, USD);
const noRate = () => null;

describe('GoalProgressCalculator (FR-GOALS-003)', () => {
  it('[TC-GOALS-SAVINGS-030] un tercio del objetivo: 33.33 % y restante 10000.00 BOB', () => {
    const p = calculateProgress({ target: bob('15000.00'), sums: [bob('5000.00')], rateFor: noRate });
    expect(p.percent).toBe('33.33');
    expect(p.remaining.toFixed()).toBe('10000.00');
    expect(p.total.toFixed()).toBe('5000.00');
    expect(p.complete).toBe(true);
  });

  it('[TC-GOALS-SAVINGS-030] meta superada: 106.67 % y restante 0.00 (no negativo)', () => {
    const p = calculateProgress({ target: bob('15000.00'), sums: [bob('16000.00')], rateFor: noRate });
    expect(p.percent).toBe('106.67');
    expect(p.remaining.toFixed()).toBe('0.00');
  });

  it('[TC-GOALS-SAVINGS-030] 1000.00 de 15000.00 es 6.67 %; 12500 de 12000 es 104.17 %; 2000 de 9000 es 22.22 %', () => {
    expect(
      calculateProgress({ target: bob('15000.00'), sums: [bob('1000.00')], rateFor: noRate }).percent,
    ).toBe('6.67');
    expect(
      calculateProgress({ target: bob('12000.00'), sums: [bob('12500.00')], rateFor: noRate }).percent,
    ).toBe('104.17');
    expect(
      calculateProgress({ target: bob('9000.00'), sums: [bob('2000.00')], rateFor: noRate }).percent,
    ).toBe('22.22');
  });

  it('[TC-GOALS-SAVINGS-030] HALF_EVEN solo al presentar: 0.125 % → 0.12 y 0.135 % → 0.14', () => {
    expect(presentPercent(dec('0.125'))).toBe('0.12');
    expect(presentPercent(dec('0.135'))).toBe('0.14');
    expect(presentPercent(percentOf(dec('1'), dec('800')))).toBe('0.12');
  });

  it('[TC-GOALS-SAVINGS-036] 300.00 USD + 7500.00 BOB con USD/BOB 12.50 = 900.00 USD (45.00 %)', () => {
    const p = calculateProgress({
      target: usd('2000.00'),
      sums: [usd('300.00'), bob('7500.00')],
      rateFor: (code) => (code === 'BOB' ? { base: 'USD', quote: 'BOB', value: dec('12.50') } : null),
    });
    expect(p.total.toFixed()).toBe('900.00');
    expect(p.percent).toBe('45.00');
    expect(p.convertedCurrencies).toEqual(['BOB']);
    expect(p.complete).toBe(true);
  });

  it('[TC-GOALS-SAVINGS-036] sin tasa: total 300.00 USD, incompleto y 7500.00 BOB sin convertir (nunca 1:1)', () => {
    const p = calculateProgress({
      target: usd('2000.00'),
      sums: [usd('300.00'), bob('7500.00')],
      rateFor: noRate,
    });
    expect(p.total.toFixed()).toBe('300.00');
    expect(p.complete).toBe(false);
    expect(p.unconverted.map((m) => m.toString())).toEqual([bob('7500.00').toString()]);
  });

  it('[TC-GOALS-SAVINGS-036] 300.00 USD + 21000.00 BOB con la tasa 12.00 alcanzan 2050.00 USD', () => {
    const p = calculateProgress({
      target: usd('2000.00'),
      sums: [usd('300.00'), bob('21000.00')],
      rateFor: () => ({ base: 'USD', quote: 'BOB', value: dec('12.00') }),
    });
    expect(p.total.toFixed()).toBe('2050.00');
    expect(p.percentExact.gte(100)).toBe(true);
  });

  it('suma varios montos de la misma moneda y omite las monedas con saldo cero', () => {
    const p = calculateProgress({
      target: bob('1000.00'),
      sums: [bob('100.00'), bob('50.00'), usd('0.00')],
      rateFor: noRate,
    });
    expect(p.total.toFixed()).toBe('150.00');
    expect(p.complete).toBe(true);
    expect(p.byCurrency.map((m) => m.currency.code)).toEqual(['BOB', 'USD']);
  });

  it('[TC-GOALS-SAVINGS-030] PBT: el porcentaje presentado coincide con la división exacta y el restante nunca es negativo', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5_000_000 }),
        fc.integer({ min: -2_000_000, max: 9_000_000 }),
        (targetCents, progressCents) => {
          const target = Money.ofMinorUnits(BigInt(targetCents), BOB);
          const sum = Money.ofMinorUnits(BigInt(progressCents), BOB);
          const p = calculateProgress({ target, sums: [sum], rateFor: noRate });
          expect(p.remaining.isNegative()).toBe(false);
          const exact = dec(String(progressCents)).div(String(targetCents)).times(100);
          expect(p.percent).toBe(presentPercent(exact));
        },
      ),
      { numRuns: 300 },
    );
  }, 30_000);
});
