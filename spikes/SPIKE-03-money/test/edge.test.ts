import { describe, expect, it } from 'vitest';
import { Money, MoneyDecimal } from '../src/index.js';
import { BOB, ETH, JPY } from './arbitraries.js';

describe('Valores límite', () => {
  it('ETH escala 18: wei, montos grandes y reparto exacto', () => {
    const wei = Money.of('0.000000000000000001', ETH);
    expect(wei.toMinorUnits()).toBe(1n);
    expect(wei.toString()).toBe('0.000000000000000001');
    const big = Money.of('12345678901234567890.123456789012345678', ETH);
    expect(big.toMinorUnits()).toBe(12345678901234567890123456789012345678n); // > 2^63 (BIGINT ≈ 9.22 ETH)
    expect(big.toMinorUnits() > 2n ** 63n - 1n).toBe(true);
    const parts = big.allocate(7);
    expect(Money.sum(parts, ETH).equals(big)).toBe(true);
    expect(Money.of('1', ETH).allocate(3).map(String)).toEqual([
      '0.333333333333333334',
      '0.333333333333333333',
      '0.333333333333333333',
    ]);
  });

  it('JPY escala 0', () => {
    expect(Money.of('1000', JPY).toString()).toBe('1000');
    expect(Money.of('1.0', JPY).toString()).toBe('1');
    expect(Money.of('100', JPY).allocate(3).map(String)).toEqual(['34', '33', '33']);
    expect(Money.of('1000', JPY).percentage('8', 'HALF_EVEN').toString()).toBe('80');
    expect(Money.of('125', JPY).percentage('10', 'HALF_EVEN').toString()).toBe('12'); // 12.5 -> 12
  });

  it('20 dígitos enteros (límite NUMERIC(38,18)) y AMOUNT_OUT_OF_RANGE', () => {
    const max = Money.of('99999999999999999999.99', BOB);
    expect(max.toString()).toBe('99999999999999999999.99');
    expect(max.toNumeric()).toBe('99999999999999999999.990000000000000000');
    expect(() => Money.of('100000000000000000000', BOB)).toThrow(/AMOUNT_OUT_OF_RANGE/);
    expect(() => max.add(Money.of('0.01', BOB))).toThrow(/AMOUNT_OUT_OF_RANGE/);
    expect(() => Money.roundToScale('99999999999999999999.995', BOB)).toThrow(/AMOUNT_OUT_OF_RANGE/);
    // number would silently lose this
    expect(Money.of('9007199254740993', JPY).toString()).toBe('9007199254740993');
    expect(String(9007199254740993)).toBe('9007199254740992');
  });

  it('cero negativo se normaliza a 0', () => {
    for (const s of ['-0', '-0.00', '-0.0']) {
      const m = Money.of(s, BOB);
      expect(m.toString()).toBe('0.00');
      expect(m.isNegative()).toBe(false);
      expect(m.equals(Money.zero(BOB))).toBe(true);
      expect(JSON.stringify(m)).toBe('{"amount":"0.00","currency":"BOB"}');
    }
    expect(Money.roundToScale('-0.004', BOB).isNegative()).toBe(false);
    expect(Money.roundToScale('-0.004', BOB).toString()).toBe('0.00');
    expect(Money.zero(BOB).negate().toString()).toBe('0.00');
    expect(Money.of('-0.01', BOB).multiply('0.1', 'HALF_EVEN').toString()).toBe('0.00');
    expect(Money.of('-0.01', BOB).allocate([1, 1]).map(String)).toEqual(['-0.01', '0.00']);
    expect(Money.ofMinorUnits(-0n, BOB).isNegative()).toBe(false);
  });

  it('doble redondeo: precisión 40 + cuantización puede fallar; la cuantización racional exacta no', () => {
    // amount 20 digits × rate with >40 significant digits (e.g. an unrounded inverse at precision 40+)
    const amount = Money.of('10000000000000000001', BOB);
    const rate = '0.0050000000000000000000000000000000000000001';
    // exact product = 50000000000000000.005 + 1.0000000000000000001e-24 -> just above the tie -> .01
    const naive = amount.toDecimal().times(rate).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_EVEN);
    expect(naive.toFixed(2)).toBe('50000000000000000.00'); // precision-40 product collapsed to an exact tie
    expect(amount.multiply(rate, 'HALF_EVEN').toString()).toBe('50000000000000000.01');
  });

  it('interés compuesto a 360 periodos: precisión 40 = precisión 100 tras redondear (nota ADR-0006)', () => {
    const Wide = MoneyDecimal.clone({ defaults: true, precision: 100, rounding: MoneyDecimal.ROUND_HALF_EVEN });
    const payment = (D: typeof MoneyDecimal, principal: string, annualPct: string, n: number) => {
      const i = new D(annualPct).div(100).div(12);
      return new D(principal).times(i).div(new D(1).minus(i.plus(1).pow(-n)));
    };
    for (const [p, r] of [['1000000.00', '11.5'], ['99999999999999.99', '7.25'], ['1000.00', '12']] as const) {
      const p40 = payment(MoneyDecimal, p, r, 360);
      const p100 = payment(Wide, p, r, 360);
      expect(Money.roundToScale(p40, BOB).toString()).toBe(Money.roundToScale(new MoneyDecimal(p100.toFixed(60)), BOB).toString());
      expect(p40.minus(p100.toFixed(60)).abs().lt('1e-20')).toBe(true);
    }
    // docs/09 §12: 1,000.00 BOB, 3 cuotas, 1 % mensual -> 340.02; schedule con última cuota que absorbe residuo
    const pay = Money.roundToScale(payment(MoneyDecimal, '1000.00', '12', 3), BOB);
    expect(pay.toString()).toBe('340.02');
    let balance = Money.of('1000.00', BOB);
    const rows: string[] = [];
    for (let k = 1; k <= 3; k++) {
      const interest = balance.multiply('0.01', 'HALF_EVEN');
      const principal = k === 3 ? balance : pay.subtract(interest);
      balance = balance.subtract(principal);
      rows.push(`${interest} ${principal} ${principal.add(interest)} ${balance}`);
    }
    expect(rows).toEqual(['10.00 330.02 340.02 669.98', '6.70 333.32 340.02 336.66', '3.37 336.66 340.03 0.00']);
  });
});
