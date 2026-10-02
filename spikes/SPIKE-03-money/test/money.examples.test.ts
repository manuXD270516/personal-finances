import { describe, expect, it } from 'vitest';
import { Money, MoneyError, type MoneyErrorCode } from '../src/index.js';
import { BOB, BTC, ETH, JPY, USD, USDT } from './arbitraries.js';

function codeOf(fn: () => unknown): MoneyErrorCode | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof MoneyError) return e.code;
    throw e;
  }
  return undefined;
}

describe('Money — ejemplos (TC-LEDGER-MONEY-*)', () => {
  it('[TC-LEDGER-MONEY-001] Money no se crea desde number; strings decimales válidos son exactos', () => {
    expect(Money.of('0.1', BOB).toString()).toBe('0.10');
    expect(Money.of('0.1', BOB).amount.toFixed()).toBe('0.1');
    expect(Money.of('685.00', BOB).toString()).toBe('685.00');
    expect(Money.of('-100.000000', USDT).toString()).toBe('-100.000000');

    // compile-time: a number does not type-check (verified by `pnpm typecheck`)
    // @ts-expect-error number is not a valid money amount
    expect(codeOf(() => Money.of(0.1, BOB))).toBe('MONEY_INVALID_AMOUNT');
    // @ts-expect-error NaN is a number
    expect(codeOf(() => Money.of(Number.NaN, BOB))).toBe('MONEY_INVALID_AMOUNT');

    for (const bad of ['1e3', ' 1.00', '1,00', 'Infinity', '', '+1', '.5', '1.', '01.00', '1.00 ', 'NaN', '0x10']) {
      expect(codeOf(() => Money.of(bad, BOB)), bad).toBe('MONEY_INVALID_AMOUNT');
    }
  });

  it('[TC-LEDGER-MONEY-002] 0.1 + 0.2 = 0.3 exacto; round-trip string/NUMERIC; API serializa a escala', () => {
    expect(Money.of('0.1', BOB).add(Money.of('0.2', BOB)).equals(Money.of('0.3', BOB))).toBe(true);
    expect(0.1 + 0.2).not.toBe(0.3); // the float problem we avoid

    const cases: Array<[string, typeof ETH]> = [
      ['12345678901234567890.123456789012345678', ETH],
      ['-0.000000000000000001', ETH],
      ['685.00', BOB],
      ['0.00000001', BTC],
    ];
    for (const [s, c] of cases) {
      const m = Money.parse(s, c);
      expect(m.toString()).toBe(s);
      // DB side simulated: NUMERIC(38,18) text form -> parse -> same value (PG part = SPIKE-02)
      expect(Money.parse(m.toNumeric(), c).toString()).toBe(s);
    }
    expect(Money.parse('685.000000000000000000', BOB).toString()).toBe('685.00');

    expect(JSON.stringify(Money.of('685', BOB))).toBe('{"amount":"685.00","currency":"BOB"}');
  });

  it('[TC-LEDGER-MONEY-003] roundToScale usa HALF_EVEN', () => {
    const table: Array<[string, typeof BOB, string]> = [
      ['2.345', BOB, '2.34'],
      ['2.355', BOB, '2.36'],
      ['2.3451', BOB, '2.35'],
      ['2.344999', BOB, '2.34'],
      ['-2.345', BOB, '-2.34'],
      ['0.005', BOB, '0.00'],
      ['0.015', BOB, '0.02'],
      ['1.0000005', USDT, '1.000000'],
      ['1.0000015', USDT, '1.000002'],
      ['2.5', JPY, '2'],
      ['3.5', JPY, '4'],
    ];
    for (const [value, c, expected] of table) {
      expect(Money.roundToScale(value, c).toString(), `${value} ${c.code}`).toBe(expected);
    }
  });

  it('[TC-LEDGER-MONEY-003] ejemplos de redondeo de docs/09 §12', () => {
    expect(Money.roundToScale('1.2345665', USDT).toString()).toBe('1.234566');
    // conversión 123.456789 USDT × 6.97 = 860.49381933 -> 860.49 BOB (una sola cuantización)
    expect(Money.of('123.456789', USDT).toDecimal().times('6.97').toFixed()).toBe('860.49381933');
    expect(Money.of('123.456789', USDT).multiply('6.97', 'HALF_EVEN').toString()).toBe('860.493819'); // stays USDT
    // interés mensual 50,000.00 × 11.5 % / 12 = 479.1666… -> 479.17
    const interest = Money.of('50000.00', BOB).toDecimal().times('0.115').div(12); // precision 40, unrounded
    expect(interest.toFixed(6)).toBe('479.166667');
    expect(Money.roundToScale(interest, BOB).toString()).toBe('479.17');
    // inversa 1/6.96 -> 0.143678160919540230 (18 decimales)
    expect(Money.roundToScale(Money.of('1', BOB).toDecimal().div('6.96'), ETH).toString()).toBe(
      '0.143678160919540230',
    );
  });

  it('[TC-LEDGER-MONEY-005] largest remainder determinista con desempate por índice', () => {
    const cases: Array<[Money, Array<number | string>, string[]]> = [
      [Money.of('100.00', BOB), [1, 1, 1], ['33.34', '33.33', '33.33']],
      [Money.of('10.01', BOB), [50, 30, 20], ['5.01', '3.00', '2.00']],
      [Money.of('-100.00', BOB), [1, 1, 1], ['-33.34', '-33.33', '-33.33']],
      [Money.of('0.000001', USDT), [1, 1], ['0.000001', '0.000000']],
      // docs/09 §12: 99.99 BOB en 50/30/20 % -> 49.99, 30.00, 20.00
      [Money.of('99.99', BOB), ['50', '30', '20'], ['49.99', '30.00', '20.00']],
      // decimal percentage weights
      [Money.of('100.00', BOB), ['33.3333', '33.3333', '33.3334'], ['33.33', '33.33', '33.34']],
      [Money.of('7', JPY), [1, 0, 1], ['4', '0', '3']],
    ];
    for (const [total, weights, expected] of cases) {
      const parts = total.allocate(weights);
      expect(parts.map(String)).toEqual(expected);
      expect(Money.sum(parts, total.currency).equals(total)).toBe(true);
    }
    expect(Money.of('100.00', BOB).allocate(3).map(String)).toEqual(['33.34', '33.33', '33.33']);
    expect(codeOf(() => Money.of('1.00', BOB).allocate([]))).toBe('INVALID_ALLOCATION');
    expect(codeOf(() => Money.of('1.00', BOB).allocate([0, 0]))).toBe('INVALID_ALLOCATION');
    expect(codeOf(() => Money.of('1.00', BOB).allocate([0.5, 0.5]))).toBe('INVALID_ALLOCATION');
    expect(codeOf(() => Money.of('1.00', BOB).allocate(['-1', '2']))).toBe('INVALID_ALLOCATION');
    expect(codeOf(() => Money.of('1.00', BOB).allocate(0))).toBe('INVALID_ALLOCATION');
  });

  it('[TC-LEDGER-MONEY-007] aritmética/comparación entre monedas distintas -> CURRENCY_MISMATCH', () => {
    const a = Money.of('10.00', BOB);
    const b = Money.of('10.00', USD);
    expect(codeOf(() => a.add(b))).toBe('CURRENCY_MISMATCH');
    expect(codeOf(() => a.subtract(b))).toBe('CURRENCY_MISMATCH');
    expect(codeOf(() => a.compare(b))).toBe('CURRENCY_MISMATCH');
    expect(a.equals(b)).toBe(false);
    expect(a.add(Money.of('1.00', BOB)).toString()).toBe('11.00');
  });

  it('[TC-LEDGER-SCALE-001] más decimales que la escala -> MONEY_SCALE_EXCEEDED (sin redondeo silencioso)', () => {
    expect(codeOf(() => Money.of('10.125', BOB))).toBe('MONEY_SCALE_EXCEEDED');
    expect(codeOf(() => Money.of('1.1234567', USDT))).toBe('MONEY_SCALE_EXCEEDED');
    expect(Money.of('0.00000001', BTC).toString()).toBe('0.00000001');
    expect(Money.of('10.10', BOB).toString()).toBe('10.10');
    expect(codeOf(() => Money.of('1.5', JPY))).toBe('MONEY_SCALE_EXCEEDED');
  });

  it('multiply/percentage/divide exigen modo de redondeo y cuantizan una sola vez', () => {
    const m = Money.of('10.00', BOB);
    expect(m.multiply('0.1235', 'HALF_EVEN').toString()).toBe('1.24'); // 1.235 -> 1.24 (4 even)
    expect(m.multiply('0.1245', 'HALF_EVEN').toString()).toBe('1.24'); // 1.245 -> 1.24
    expect(m.multiply('0.1245', 'HALF_UP').toString()).toBe('1.25');
    expect(m.multiply('0.1249', 'DOWN').toString()).toBe('1.24');
    expect(m.negate().multiply('0.1241', 'FLOOR').toString()).toBe('-1.25');
    expect(m.percentage('1.5', 'HALF_EVEN').toString()).toBe('0.15');
    expect(m.divide('3', 'HALF_EVEN').toString()).toBe('3.33');
    expect(codeOf(() => m.divide('0', 'HALF_EVEN'))).toBe('MONEY_INVALID_AMOUNT');
  });
});
