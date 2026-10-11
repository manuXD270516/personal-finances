import { Money, currency } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyMinimumPayment, normalizeMinimumRule } from './minimum-payment-rule.js';

const BOB = currency('BOB', 2);
const bob = (v: string) => Money.parse(v, BOB);
const percent = { type: 'PERCENT', percent: '5.00', floor: '50.00' } as const;

describe('MinimumPaymentRule (add-credit-cards)', () => {
  it('[TC-DEBT-CARD-005] porcentaje con redondeo HALF_EVEN: 1120.50 × 5.00 % = 56.025 ⇒ 56.02', () => {
    expect(applyMinimumPayment(percent, bob('1120.50')).toFixed()).toBe('56.02');
  });

  it('[TC-DEBT-CARD-005] 1165.50 × 5.00 % = 58.275 ⇒ 58.28 (HALF_EVEN al par)', () => {
    expect(applyMinimumPayment(percent, bob('1165.50')).toFixed()).toBe('58.28');
  });

  it('[TC-DEBT-CARD-005] el piso gana al porcentaje: 333.33 ⇒ 50.00', () => {
    expect(applyMinimumPayment(percent, bob('333.33')).toFixed()).toBe('50.00');
  });

  it('[TC-DEBT-CARD-005] el mínimo nunca supera el saldo facturado: 40.00 ⇒ 40.00', () => {
    expect(applyMinimumPayment(percent, bob('40.00')).toFixed()).toBe('40.00');
  });

  it('[TC-DEBT-CARD-005] monto fijo: 300.00 con facturado 1120.50 y 40.00 con facturado 40.00', () => {
    const fixed = { type: 'FIXED', amount: '300.00' } as const;
    expect(applyMinimumPayment(fixed, bob('1120.50')).toFixed()).toBe('300.00');
    expect(applyMinimumPayment(fixed, bob('40.00')).toFixed()).toBe('40.00');
  });

  it('[TC-DEBT-CARD-005] saldo facturado <= 0 ⇒ mínimo 0 (saldo a favor)', () => {
    expect(applyMinimumPayment(percent, bob('0.00')).toFixed()).toBe('0.00');
    expect(applyMinimumPayment(percent, bob('-30.00')).toFixed()).toBe('0.00');
  });

  it('[TC-DEBT-CARD-005] sin piso el mínimo es solo el porcentaje', () => {
    expect(
      applyMinimumPayment({ type: 'PERCENT', percent: '5.00', floor: null }, bob('333.33')).toFixed(),
    ).toBe('16.67');
  });

  it('[TC-DEBT-CARD-005] PBT: 0 ≤ mínimo ≤ max(facturado, 0)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5_000_000, max: 50_000_000 }),
        fc.integer({ min: 1, max: 10_000 }),
        fc.option(fc.integer({ min: 0, max: 500_000 }), { nil: null }),
        (cents, pctCents, floorCents) => {
          const billed = Money.ofMinorUnits(BigInt(cents), BOB);
          const rule = {
            type: 'PERCENT',
            percent: (pctCents / 100).toFixed(2),
            floor: floorCents === null ? null : Money.ofMinorUnits(BigInt(floorCents), BOB).toFixed(),
          } as const;
          const min = applyMinimumPayment(rule, billed);
          const cap = billed.isPositive() ? billed : Money.zero(BOB);
          expect(min.isNegative()).toBe(false);
          expect(min.compare(cap)).toBeLessThanOrEqual(0);
        },
      ),
      { numRuns: 500 },
    );
  }, 30_000);

  it('normalizeMinimumRule valida porcentaje 0.01..100, piso y monto fijo positivo en la escala de la moneda', () => {
    expect(normalizeMinimumRule(percent, BOB)).toEqual({ type: 'PERCENT', percent: '5.00', floor: '50.00' });
    expect(normalizeMinimumRule({ type: 'PERCENT', percent: '5' }, BOB)).toEqual({
      type: 'PERCENT',
      percent: '5.00',
      floor: null,
    });
    const code = (input: unknown) => {
      try {
        normalizeMinimumRule(input, BOB);
        return 'ok';
      } catch (err) {
        return (err as { code?: string }).code;
      }
    };
    expect(code({ type: 'PERCENT', percent: '0' })).toBe('VALIDATION_FAILED');
    expect(code({ type: 'PERCENT', percent: '100.01' })).toBe('VALIDATION_FAILED');
    expect(code({ type: 'PERCENT', percent: '5.123' })).toBe('VALIDATION_FAILED');
    expect(code({ type: 'PERCENT', percent: '5.00', floor: '10.123' })).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(code({ type: 'FIXED', amount: '0.00' })).toBe('AMOUNT_NOT_POSITIVE');
    expect(code({ type: 'FIXED', amount: '300.001' })).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(code({ type: 'OTHER' })).toBe('VALIDATION_FAILED');
    expect(code(null)).toBe('VALIDATION_FAILED');
  });
  it('normalizeMinimumRule acepta el piso y el monto fijo como Money del contrato y rechaza otra moneda', () => {
    expect(
      normalizeMinimumRule(
        { type: 'PERCENT', percent: '5.00', floor: { amount: '50.00', currency: 'BOB' } },
        BOB,
      ),
    ).toEqual({ type: 'PERCENT', percent: '5.00', floor: '50.00' });
    expect(
      normalizeMinimumRule({ type: 'FIXED', amount: { amount: '300.00', currency: 'BOB' } }, BOB),
    ).toEqual({
      type: 'FIXED',
      amount: '300.00',
    });
    expect(() =>
      normalizeMinimumRule({ type: 'FIXED', amount: { amount: '300.00', currency: 'USD' } }, BOB),
    ).toThrow(/currency of the account/);
  });
});
