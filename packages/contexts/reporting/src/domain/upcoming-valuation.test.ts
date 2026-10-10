import { currency, dec, Money, type ExactRate } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { UpcomingValuation } from './upcoming-valuation.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const bob = (v: string) => Money.parse(v, BOB);
const usd = (v: string) => Money.parse(v, USD);
const TODAY = '2026-10-20';
const at =
  (value: string) =>
  (code: string): ExactRate | null =>
    code === 'USD' ? { base: 'USD', quote: 'BOB', value: dec(value) } : null;
const noRate = (): ExactRate | null => null;

describe('UpcomingValuation (FlowValuation con fecha = hoy)', () => {
  it('[TC-REPORTING-UPCOMING-009] 199.00 BOB + 5.99 USD a 12.00 consolidan en 270.88 BOB', () => {
    const v = UpcomingValuation.value([bob('199.00'), usd('5.99')], TODAY, BOB, at('12.00'));
    expect(v.byCurrency.map((m) => m.toString())).toEqual(['199.00 BOB', '5.99 USD']);
    expect(v.consolidated.amount.toFixed()).toBe('270.88');
    expect(v.consolidated.complete).toBe(true);
    expect(v.consolidated.unconverted).toEqual([]);
  });

  it('[TC-REPORTING-UPCOMING-010] sin tasa vigente el USD queda sin convertir y el consolidado es 199.00 incompleto', () => {
    const v = UpcomingValuation.value([bob('199.00'), usd('5.99')], TODAY, BOB, noRate);
    expect(v.consolidated.amount.toFixed()).toBe('199.00');
    expect(v.consolidated.complete).toBe(false);
    expect(v.consolidated.unconverted.map((m) => m.toString())).toEqual(['5.99 USD']);
  });

  it('[TC-REPORTING-UPCOMING-010] nunca convierte 1:1 sin tasa', () => {
    const v = UpcomingValuation.value([usd('10.00')], TODAY, BOB, noRate);
    expect(v.consolidated.amount.toFixed()).toBe('0.00');
    expect(UpcomingValuation.convert(usd('10.00'), TODAY, BOB, noRate)).toBeNull();
  });

  it('[TC-REPORTING-UPCOMING-011] 3.33 + 3.33 USD a 12.005 = 79.95 BOB y no 79.96 (redondeo solo al presentar)', () => {
    const v = UpcomingValuation.value([usd('3.33'), usd('3.33')], TODAY, BOB, at('12.005'));
    expect(v.consolidated.amount.toFixed()).toBe('79.95');
    const perItem = UpcomingValuation.convert(usd('3.33'), TODAY, BOB, at('12.005'));
    expect(perItem?.toFixed()).toBe('39.98');
    expect(perItem!.add(perItem!).toFixed()).toBe('79.96');
  });

  it('un monto en la moneda de reporte se muestra tal cual', () => {
    expect(UpcomingValuation.convert(bob('199.00'), TODAY, BOB, noRate)?.toFixed()).toBe('199.00');
  });
});
