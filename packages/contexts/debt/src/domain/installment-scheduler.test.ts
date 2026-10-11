import { Money, currency } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { scheduleInstallments } from './installment-scheduler.js';

const BOB = currency('BOB', 2);
const USDT = currency('USDT', 6);
const bob = (v: string) => Money.parse(v, BOB);

const principals = (rows: ReturnType<typeof scheduleInstallments>) => rows.map((r) => r.principal.toFixed());
const totals = (rows: ReturnType<typeof scheduleInstallments>) => rows.map((r) => r.total.toFixed());

describe('InstallmentScheduler (add-credit-cards, decisión 13)', () => {
  it('[TC-DEBT-CARD-022] 1000.00 BOB en 3 cuotas sin interés: 333.33, 333.33 y 333.34 (residuo en la última)', () => {
    const rows = scheduleInstallments({ principal: bob('1000.00'), count: 3, annualRatePercent: '0' });
    expect(principals(rows)).toEqual(['333.33', '333.33', '333.34']);
    expect(rows.map((r) => r.interest.toFixed())).toEqual(['0.00', '0.00', '0.00']);
    expect(totals(rows)).toEqual(['333.33', '333.33', '333.34']);
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3]);
  });

  it('[TC-DEBT-CARD-023] 1200.00 BOB en 3 cuotas al 24.00 % anual (francés a tasa mensual 2 %)', () => {
    const rows = scheduleInstallments({ principal: bob('1200.00'), count: 3, annualRatePercent: '24.00' });
    expect(totals(rows)).toEqual(['416.11', '416.11', '416.10']);
    expect(principals(rows)).toEqual(['392.11', '399.95', '407.94']);
    expect(rows.map((r) => r.interest.toFixed())).toEqual(['24.00', '16.16', '8.16']);
    expect(
      Money.sum(
        rows.map((r) => r.principal),
        BOB,
      ).toFixed(),
    ).toBe('1200.00');
    expect(
      Money.sum(
        rows.map((r) => r.interest),
        BOB,
      ).toFixed(),
    ).toBe('48.32');
  });

  it('el capital de una cuota con tasa 0.00 equivale a sin interés', () => {
    const a = scheduleInstallments({ principal: bob('100.00'), count: 7, annualRatePercent: '0.00' });
    const b = scheduleInstallments({ principal: bob('100.00'), count: 7, annualRatePercent: '0' });
    expect(totals(a)).toEqual(totals(b));
  });

  it('rechaza cuotas fuera de 2..60, capital no positivo y tasa negativa', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
        return 'ok';
      } catch (err) {
        return (err as { code?: string }).code;
      }
    };
    expect(
      code(() => scheduleInstallments({ principal: bob('100.00'), count: 1, annualRatePercent: '0' })),
    ).toBe('INSTALLMENT_PLAN_INVALID');
    expect(
      code(() => scheduleInstallments({ principal: bob('100.00'), count: 61, annualRatePercent: '0' })),
    ).toBe('INSTALLMENT_PLAN_INVALID');
    expect(
      code(() => scheduleInstallments({ principal: bob('0.00'), count: 3, annualRatePercent: '0' })),
    ).toBe('INSTALLMENT_PLAN_INVALID');
    expect(
      code(() => scheduleInstallments({ principal: bob('10.00'), count: 3, annualRatePercent: '-1' })),
    ).toBe('INSTALLMENT_PLAN_INVALID');
  });

  it('[TC-DEBT-CARD-022] PBT (INV-017/INV-020): Σ capital = compra exacta, cuotas ≥ 0 y determinista, con y sin interés', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 200, max: 500_000_000 }),
        fc.integer({ min: 2, max: 60 }),
        fc.constantFrom('0', '0.01', '9.99', '24.00', '36.50', '99.99', '250.00'),
        fc.constantFrom(BOB, USDT),
        (units, count, rate, cur) => {
          const principal = Money.ofMinorUnits(BigInt(units), cur);
          const rows = scheduleInstallments({ principal, count, annualRatePercent: rate });
          expect(rows).toHaveLength(count);
          expect(
            Money.sum(
              rows.map((r) => r.principal),
              cur,
            ).equals(principal),
          ).toBe(true);
          for (const r of rows) {
            expect(r.principal.isNegative()).toBe(false);
            expect(r.interest.isNegative()).toBe(false);
            expect(r.total.equals(r.principal.add(r.interest))).toBe(true);
          }
          const again = scheduleInstallments({ principal, count, annualRatePercent: rate });
          expect(totals(again)).toEqual(totals(rows));
        },
      ),
      { numRuns: 400 },
    );
  }, 60_000);
});
