import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { currency } from './currency.js';
import { MoneyDecimal } from './decimal.js';
import { Money } from './money.js';
import { Rate } from './rate.js';

// Promovidos desde spikes/SPIKE-03-money/test (add-ledger-core, tareas 2.1–2.3). Diferencias con el spike:
// errores `DomainError` (no `MoneyError`), escala excedida = `AMOUNT_SCALE_EXCEEDED` (unificado) y `toString()`
// incluye el código de moneda (`toFixed()` es la forma canónica sin código).
const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const JPY = currency('JPY', 0);
const USDT = currency('USDT', 6);
const BTC = currency('BTC', 8);
const ETH = currency('ETH', 18);

const fx = (m: Money): string => m.toFixed();

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof DomainError) return e.code;
    throw e;
  }
  return undefined;
}

describe('Money — ejemplos del ledger (TC-LEDGER-MONEY-*)', () => {
  it('[TC-LEDGER-MONEY-001] Money no se crea desde number; strings decimales válidos son exactos', () => {
    expect(fx(Money.of('0.1', BOB))).toBe('0.10');
    expect(Money.of('0.1', BOB).amount.toFixed()).toBe('0.1');
    expect(fx(Money.of('685.00', BOB))).toBe('685.00');
    expect(fx(Money.of('-100.000000', USDT))).toBe('-100.000000');

    // compile-time: un number no compila (lo verifica `pnpm typecheck`)
    // @ts-expect-error number no es un monto válido
    expect(codeOf(() => Money.of(0.1, BOB))).toBe('MONEY_INVALID_AMOUNT');
    // @ts-expect-error NaN es un number
    expect(codeOf(() => Money.of(Number.NaN, BOB))).toBe('MONEY_INVALID_AMOUNT');

    for (const bad of [
      '1e3',
      ' 1.00',
      '1,00',
      'Infinity',
      '',
      '+1',
      '.5',
      '1.',
      '01.00',
      '1.00 ',
      'NaN',
      '0x10',
    ]) {
      expect(
        codeOf(() => Money.of(bad, BOB)),
        bad,
      ).toBe('MONEY_INVALID_AMOUNT');
    }
  });

  it('[TC-LEDGER-MONEY-002] 0.1 + 0.2 = 0.3 exacto; ida y vuelta string/NUMERIC; API serializa a escala', () => {
    expect(Money.of('0.1', BOB).add(Money.of('0.2', BOB)).equals(Money.of('0.3', BOB))).toBe(true);
    expect(0.1 + 0.2).not.toBe(0.3); // el problema de punto flotante que se evita

    const cases: [string, typeof ETH][] = [
      ['12345678901234567890.123456789012345678', ETH],
      ['-0.000000000000000001', ETH],
      ['685.00', BOB],
      ['0.00000001', BTC],
    ];
    for (const [s, c] of cases) {
      const m = Money.parse(s, c);
      expect(fx(m)).toBe(s);
      expect(fx(Money.parse(m.toNumeric(), c))).toBe(s);
    }
    expect(fx(Money.parse('685.000000000000000000', BOB))).toBe('685.00');
    expect(JSON.stringify(Money.of('685', BOB))).toBe('{"amount":"685.00","currency":"BOB"}');
  });

  it('[TC-LEDGER-MONEY-003] roundToScale usa HALF_EVEN', () => {
    const table: [string, typeof BOB, string][] = [
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
      expect(fx(Money.roundToScale(value, c)), `${value} ${c.code}`).toBe(expected);
    }
  });

  it('[TC-LEDGER-MONEY-003] ejemplos de redondeo de docs/09 §12 con una sola cuantización', () => {
    expect(fx(Money.roundToScale('1.2345665', USDT))).toBe('1.234566');
    expect(Money.of('123.456789', USDT).toDecimal().times('6.97').toFixed()).toBe('860.49381933');
    expect(fx(Rate.of(USDT, BOB, '6.97').convert(Money.of('123.456789', USDT)))).toBe('860.49');
    const interest = Money.of('50000.00', BOB).toDecimal().times('0.115').div(12);
    expect(interest.toFixed(6)).toBe('479.166667');
    expect(fx(Money.roundToScale(interest, BOB))).toBe('479.17');
    expect(fx(Money.roundToScale(Money.of('1', BOB).toDecimal().div('6.96'), ETH))).toBe(
      '0.143678160919540230',
    );
  });

  it('[TC-LEDGER-MONEY-003] doble redondeo: la cuantización racional exacta acierta donde precisión 40 falla (H3)', () => {
    const amount = Money.of('10000000000000000001', BOB);
    const rate = '0.0050000000000000000000000000000000000000001';
    const naive = amount.toDecimal().times(rate).toDecimalPlaces(2, MoneyDecimal.ROUND_HALF_EVEN);
    expect(naive.toFixed(2)).toBe('50000000000000000.00');
    expect(fx(amount.multiply(rate, 'HALF_EVEN'))).toBe('50000000000000000.01');
  });

  it('[TC-LEDGER-MONEY-005] mayor residuo determinista con desempate por índice', () => {
    const cases: [Money, (number | string)[], string[]][] = [
      [Money.of('100.00', BOB), [1, 1, 1], ['33.34', '33.33', '33.33']],
      [Money.of('10.01', BOB), [50, 30, 20], ['5.01', '3.00', '2.00']],
      [Money.of('-100.00', BOB), [1, 1, 1], ['-33.34', '-33.33', '-33.33']],
      [Money.of('0.000001', USDT), [1, 1], ['0.000001', '0.000000']],
      [Money.of('99.99', BOB), ['50', '30', '20'], ['49.99', '30.00', '20.00']],
      [Money.of('100.00', BOB), ['33.3333', '33.3333', '33.3334'], ['33.33', '33.33', '33.34']],
      [Money.of('7', JPY), [1, 0, 1], ['4', '0', '3']],
    ];
    for (const [total, weights, expected] of cases) {
      const parts = total.allocate(weights);
      expect(parts.map(fx)).toEqual(expected);
      expect(Money.sum(parts, total.currency).equals(total)).toBe(true);
    }
    expect(Money.of('100.00', BOB).allocate(3).map(fx)).toEqual(['33.34', '33.33', '33.33']);
    expect(codeOf(() => Money.of('1.00', BOB).allocate([]))).toBe('INVALID_ALLOCATION');
    expect(codeOf(() => Money.of('1.00', BOB).allocate([0, 0]))).toBe('INVALID_ALLOCATION');
    expect(codeOf(() => Money.of('1.00', BOB).allocate([0.5, 0.5]))).toBe('INVALID_ALLOCATION');
    expect(codeOf(() => Money.of('1.00', BOB).allocate(['-1', '2']))).toBe('INVALID_ALLOCATION');
    expect(codeOf(() => Money.of('1.00', BOB).allocate(['x']))).toBe('INVALID_ALLOCATION');
    expect(codeOf(() => Money.of('1.00', BOB).allocate(0))).toBe('INVALID_ALLOCATION');
  });

  it('[TC-LEDGER-MONEY-007] aritmética/comparación entre monedas distintas → CURRENCY_MISMATCH', () => {
    const a = Money.of('10.00', BOB);
    const b = Money.of('10.00', USD);
    expect(codeOf(() => a.add(b))).toBe('CURRENCY_MISMATCH');
    expect(codeOf(() => a.subtract(b))).toBe('CURRENCY_MISMATCH');
    expect(codeOf(() => a.compare(b))).toBe('CURRENCY_MISMATCH');
    expect(codeOf(() => Money.sum([a, b], BOB))).toBe('CURRENCY_MISMATCH');
    expect(a.equals(b)).toBe(false);
    expect(fx(a.add(Money.of('1.00', BOB)))).toBe('11.00');
    expect(a.compare(Money.of('9.99', BOB))).toBe(1);
  });

  it('[TC-LEDGER-SCALE-001] más decimales que la escala → AMOUNT_SCALE_EXCEEDED (sin redondeo silencioso)', () => {
    expect(codeOf(() => Money.of('10.125', BOB))).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(codeOf(() => Money.of('1.1234567', USDT))).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(codeOf(() => Money.of('1.5', JPY))).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(fx(Money.of('0.00000001', BTC))).toBe('0.00000001');
    expect(fx(Money.of('10.10', BOB))).toBe('10.10');
    expect(codeOf(() => Money.of('100000000000000000000', BOB))).toBe('AMOUNT_OUT_OF_RANGE');
  });

  it('multiply/percentage/divide exigen modo de redondeo y cuantizan una sola vez', () => {
    const m = Money.of('10.00', BOB);
    expect(fx(m.multiply('0.1235', 'HALF_EVEN'))).toBe('1.24');
    expect(fx(m.multiply('0.1245', 'HALF_EVEN'))).toBe('1.24');
    expect(fx(m.multiply('0.1245', 'HALF_UP'))).toBe('1.25');
    expect(fx(m.multiply('0.1249', 'DOWN'))).toBe('1.24');
    expect(fx(m.multiply('0.1241', 'UP'))).toBe('1.25');
    expect(fx(m.negate().multiply('0.1241', 'FLOOR'))).toBe('-1.25');
    expect(fx(m.multiply('0.1241', 'CEIL'))).toBe('1.25');
    expect(fx(m.percentage('1.5', 'HALF_EVEN'))).toBe('0.15');
    expect(fx(m.divide('3', 'HALF_EVEN'))).toBe('3.33');
    expect(codeOf(() => m.divide('0', 'HALF_EVEN'))).toBe('MONEY_INVALID_AMOUNT');
    expect(codeOf(() => m.multiply('1e2', 'HALF_EVEN'))).toBe('MONEY_INVALID_AMOUNT');
  });

  it('valores límite: ETH escala 18, JPY escala 0, 20 dígitos enteros y -0', () => {
    const big = Money.of('12345678901234567890.123456789012345678', ETH);
    expect(big.toMinorUnits()).toBe(12345678901234567890123456789012345678n);
    expect(Money.sum(big.allocate(7), ETH).equals(big)).toBe(true);
    expect(Money.of('1', ETH).allocate(3).map(fx)).toEqual([
      '0.333333333333333334',
      '0.333333333333333333',
      '0.333333333333333333',
    ]);
    expect(fx(Money.of('1.0', JPY))).toBe('1');
    expect(fx(Money.of('125', JPY).percentage('10', 'HALF_EVEN'))).toBe('12');
    const max = Money.of('99999999999999999999.99', BOB);
    expect(max.toNumeric()).toBe('99999999999999999999.990000000000000000');
    expect(codeOf(() => max.add(Money.of('0.01', BOB)))).toBe('AMOUNT_OUT_OF_RANGE');
    expect(codeOf(() => Money.roundToScale('99999999999999999999.995', BOB))).toBe('AMOUNT_OUT_OF_RANGE');
    expect(fx(Money.of('9007199254740993', JPY))).toBe('9007199254740993');
    for (const s of ['-0', '-0.00']) expect(Money.of(s, BOB).isNegative()).toBe(false);
    expect(Money.roundToScale('-0.004', BOB).isNegative()).toBe(false);
    expect(fx(Money.zero(BOB).negate())).toBe('0.00');
    expect(Money.of('-0.01', BOB).allocate([1, 1]).map(fx)).toEqual(['-0.01', '0.00']);
    expect(Money.ofMinorUnits(-0n, BOB).isNegative()).toBe(false);
    expect(fx(Money.of('-3.10', BOB).abs())).toBe('3.10');
  });
});

describe('Rate (docs/09 §7.1, INV-032)', () => {
  it('convierte en ambos sentidos con una sola cuantización y la inversa no se encadena', () => {
    const r = Rate.of(USD, BOB, '6.96');
    expect(fx(r.convert(Money.of('100.00', USD)))).toBe('696.00');
    expect(fx(r.convert(Money.of('696.00', BOB)))).toBe('100.00');
    expect(r.inverse().inverse()).toBe(r);
    expect(r.inverse().isDerivedInverse).toBe(true);
    expect(fx(r.inverse().convert(Money.of('1.00', BOB)))).toBe('0.14');
    expect(r.oriented(BOB).base.code).toBe('BOB');
    expect(r.oriented(USD)).toBe(r);
    expect(r.toPersisted()).toBe('6.960000000000000000');
    expect(codeOf(() => r.convert(Money.of('1', JPY)))).toBe('CURRENCY_MISMATCH');
    expect(codeOf(() => r.oriented(JPY))).toBe('CURRENCY_MISMATCH');
    expect(codeOf(() => Rate.of(USD, USD, '1'))).toBe('INVALID_RATE');
    expect(codeOf(() => Rate.of(USD, BOB, '0'))).toBe('INVALID_RATE');
    expect(codeOf(() => Rate.of(USD, BOB, '-1'))).toBe('INVALID_RATE');
    expect(fx(Rate.derived(USD, BOB, new MoneyDecimal('6.97')).convert(Money.of('1.00', USD)))).toBe('6.97');
  });
});
