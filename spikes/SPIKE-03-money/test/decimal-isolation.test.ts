import Decimal from 'decimal.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dec, Money, MoneyDecimal } from '../src/index.js';
import { BOB, ETH } from './arbitraries.js';

const GLOBAL_DEFAULTS = { precision: Decimal.precision, rounding: Decimal.rounding, toExpNeg: Decimal.toExpNeg };

afterEach(() => {
  Decimal.set(GLOBAL_DEFAULTS);
});

describe('Aislamiento del clon de decimal.js', () => {
  it('MoneyDecimal usa precisión 40 y ROUND_HALF_EVEN', () => {
    expect(MoneyDecimal.precision).toBe(40);
    expect(MoneyDecimal.rounding).toBe(Decimal.ROUND_HALF_EVEN);
    expect(new MoneyDecimal(1).div(3).toFixed()).toBe('0.' + '3'.repeat(40));
  });

  it('un Decimal.set() global posterior no afecta a Money', () => {
    Decimal.set({ precision: 5, rounding: Decimal.ROUND_UP, toExpNeg: -1 });
    expect(new Decimal(1).div(3).toFixed()).toBe('0.33334'); // global is now broken on purpose
    expect(MoneyDecimal.precision).toBe(40);
    expect(Money.of('100.00', BOB).allocate(3).map(String)).toEqual(['33.34', '33.33', '33.33']);
    expect(Money.roundToScale('2.345', BOB).toString()).toBe('2.34'); // still HALF_EVEN
    expect(Money.of('12345678901234567890.123456789012345678', ETH).add(Money.of('0.000000000000000001', ETH)).toString())
      .toBe('12345678901234567890.123456789012345679');
    expect(dec('0.0000001').toString()).toBe('0.0000001'); // no exponent notation
  });

  it('un Decimal.set() global ANTERIOR a cargar el módulo tampoco lo afecta (defaults: true)', async () => {
    Decimal.set({ precision: 5, rounding: Decimal.ROUND_DOWN });
    vi.resetModules();
    const fresh = await import('../src/decimal.js');
    expect(fresh.MoneyDecimal.precision).toBe(40);
    expect(fresh.MoneyDecimal.rounding).toBe(Decimal.ROUND_HALF_EVEN);
    // contra-ejemplo: un clone() sin defaults hereda la config global vigente
    expect(Decimal.clone().precision).toBe(5);
  });

  it('riesgo: instancias de otro clon pasan instanceof y llevan su config; Money las re-envuelve', () => {
    Decimal.set({ precision: 5 });
    const foreign = new Decimal('1.23456789');
    expect(foreign instanceof MoneyDecimal).toBe(true); // instanceof cannot tell clones apart
    expect(foreign.plus('0.000000001').toString()).toBe('1.2346'); // foreign config leaks
    const m = Money.roundToScale(foreign, ETH);
    expect(m.toString()).toBe('1.234567890000000000');
    expect(m.amount.constructor).toBe(MoneyDecimal);
    expect(m.toDecimal().plus('0.000000001').toFixed()).toBe('1.234567891');
  });
});
