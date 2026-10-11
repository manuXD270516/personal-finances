import { DomainError, LocalDate, Money, currency, dec } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateSchedule, type AmortizationInput } from './amortization-calculator.js';
import { PAYMENT_COMPONENTS, type ComponentAmounts, type ScheduleInstallment } from './loan-types.js';
import {
  allocatePayment,
  installmentStatus,
  type AllocatableInstallment,
  type PaymentAllocationResult,
} from './payment-allocator.js';

const BOB = currency('BOB', 2);
const d = (s: string) => LocalDate.parse(s);
const ZERO: ComponentAmounts = {
  taxes: '0.00',
  insurance: '0.00',
  fees: '0.00',
  interest: '0.00',
  principal: '0.00',
};

const vehicular = (over: Partial<AmortizationInput> = {}): AmortizationInput => ({
  currency: BOB,
  principal: '50000.00',
  annualRate: '0.115',
  dayCount: 'D30_360',
  frequency: 'MONTHLY',
  installments: 24,
  accrualStart: d('2026-10-15'),
  firstDueDate: d('2026-11-15'),
  ...over,
});

const toAllocatable = (rows: readonly ScheduleInstallment[]): AllocatableInstallment[] =>
  rows.map((c) => ({
    n: c.n,
    expected: {
      taxes: c.taxes,
      insurance: c.insurance,
      fees: c.fees,
      interest: c.interest,
      principal: c.principal,
    },
    paid: ZERO,
  }));

/** Reaplica el resultado sobre las cuotas (lo ya imputado pasa a ser lo imputado tras el pago). */
const applied = (
  installments: readonly AllocatableInstallment[],
  r: PaymentAllocationResult,
): AllocatableInstallment[] =>
  installments.map((i) => {
    const after = r.installments.find((x) => x.n === i.n);
    return after ? { ...i, paid: after.paid } : i;
  });

const sum = (xs: readonly string[]) => xs.reduce((a, x) => a.plus(x), dec('0'));
const positive = (x: ReturnType<typeof dec>) => (x.isNeg() ? dec('0') : x);
const byComponent = (r: PaymentAllocationResult, n: number) =>
  Object.fromEntries(r.allocations.filter((a) => a.installmentNo === n).map((a) => [a.component, a.amount]));

describe('PaymentAllocator — imputación de pagos (D155)', () => {
  const sinCargos = () => toAllocatable(calculateSchedule(vehicular()).installments);
  const conCargos = () =>
    toAllocatable(
      calculateSchedule(
        vehicular({
          charges: {
            fees: { mode: 'FIXED', value: '10.00' },
            insurance: { mode: 'RATE_ON_BALANCE', value: '0.0004' },
          },
        }),
      ).installments,
    );

  it('[TC-DEBT-LOAN-012] pago exacto de la cuota 1: principal 1862.85 e interés 479.17, cuota PAID', () => {
    const r = allocatePayment({
      currency: BOB,
      amount: '2342.02',
      installments: sinCargos(),
      outstandingPrincipal: '50000.00',
    });
    expect(r.components).toEqual({ ...ZERO, interest: '479.17', principal: '1862.85' });
    expect(r.affectedInstallments).toEqual([1]);
    expect(r.installments).toHaveLength(1);
    expect(r.installments[0]).toMatchObject({ n: 1, status: 'PAID', differenceTotal: '0.00' });
    expect(r.principalAfter).toBe('48137.15');
    // los componentes en cero no generan porciones
    expect(r.allocations.map((a) => a.component)).toEqual(['interest', 'principal']);
  });

  it('[TC-DEBT-LOAN-013] cargos: comisión 10.00 y seguro 20.00, sin porción de impuestos', () => {
    const r = allocatePayment({
      currency: BOB,
      amount: '2372.02',
      installments: conCargos(),
      outstandingPrincipal: '50000.00',
    });
    expect(r.components).toEqual({
      taxes: '0.00',
      insurance: '20.00',
      fees: '10.00',
      interest: '479.17',
      principal: '1862.85',
    });
    expect(r.allocations.some((a) => a.component === 'taxes')).toBe(false);
    expect(r.installments[0]!.status).toBe('PAID');
  });

  it('[TC-DEBT-LOAN-014] un pago de 4684.04 cubre las cuotas 1 y 2', () => {
    const r = allocatePayment({
      currency: BOB,
      amount: '4684.04',
      installments: sinCargos(),
      outstandingPrincipal: '50000.00',
    });
    expect(r.affectedInstallments).toEqual([1, 2]);
    expect(r.installments.map((i) => i.status)).toEqual(['PAID', 'PAID']);
    expect(r.components.principal).toBe('3743.56');
    expect(r.components.interest).toBe('940.48');
  });

  it('[TC-DEBT-LOAN-015] pago parcial de 2000.00: seguro 20.00, comisión 10.00, interés 479.17, principal 1490.83', () => {
    const r = allocatePayment({
      currency: BOB,
      amount: '2000.00',
      installments: conCargos(),
      outstandingPrincipal: '50000.00',
    });
    expect(byComponent(r, 1)).toEqual({
      insurance: '20.00',
      fees: '10.00',
      interest: '479.17',
      principal: '1490.83',
    });
    // el orden de las porciones es impuestos → seguro → comisiones → interés → principal
    expect(r.allocations.map((a) => a.component)).toEqual(['insurance', 'fees', 'interest', 'principal']);
    expect(r.installments[0]).toMatchObject({ n: 1, status: 'PARTIALLY_PAID', differenceTotal: '-372.02' });
    expect(r.installments[0]!.differences.principal).toBe('-372.02');
  });

  it('completar una cuota parcial (scenario "Completar una cuota parcial"): queda PAID con 1862.85 de principal en dos pagos', () => {
    const cuotas = conCargos();
    const first = allocatePayment({
      currency: BOB,
      amount: '2000.00',
      installments: cuotas,
      outstandingPrincipal: '50000.00',
    });
    const second = allocatePayment({
      currency: BOB,
      amount: '372.02',
      installments: applied(cuotas, first),
      outstandingPrincipal: first.principalAfter,
    });
    expect(second.affectedInstallments).toEqual([1]);
    expect(second.components).toEqual({ ...ZERO, principal: '372.02' });
    expect(second.installments[0]).toMatchObject({ n: 1, status: 'PAID', differenceTotal: '0.00' });
    expect(second.installments[0]!.paid.principal).toBe('1862.85');
  });

  it('[TC-DEBT-LOAN-016] pago mayor que la deuda: LOAN_OVERPAYMENT', () => {
    const rows = calculateSchedule(
      vehicular({ principal: '1000.00', annualRate: '0.12', installments: 3 }),
    ).installments;
    const solo3 = toAllocatable(rows).map((i) => (i.n === 3 ? i : { ...i, paid: i.expected }));
    let error: unknown;
    try {
      allocatePayment({
        currency: BOB,
        amount: '500.00',
        installments: solo3,
        outstandingPrincipal: '336.66',
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('LOAN_OVERPAYMENT');
    expect((error as DomainError).details).toMatchObject({ amount: '500.00', pending: '340.03' });
  });

  it('[TC-DEBT-LOAN-017] desglose con interés moratorio: cuota PAID y diferencia de interés +17.98', () => {
    const r = allocatePayment({
      currency: BOB,
      amount: '2360.00',
      installments: sinCargos(),
      installmentNo: 1,
      breakdown: { principal: '1862.85', interest: '497.15' },
      outstandingPrincipal: '50000.00',
    });
    expect(r.installments[0]).toMatchObject({ n: 1, status: 'PAID' });
    expect(r.installments[0]!.differences.interest).toBe('17.98');
    expect(r.installments[0]!.differenceTotal).toBe('17.98');
    expect(r.components.interest).toBe('497.15');
  });

  it('[TC-DEBT-LOAN-018] desglose que no suma el pago: PAYMENT_BREAKDOWN_MISMATCH (2392.02 frente a 2400.00)', () => {
    let error: unknown;
    try {
      allocatePayment({
        currency: BOB,
        amount: '2400.00',
        installments: sinCargos(),
        installmentNo: 1,
        breakdown: { principal: '1862.85', interest: '479.17', fees: '50.00' },
        outstandingPrincipal: '50000.00',
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('PAYMENT_BREAKDOWN_MISMATCH');
    expect((error as DomainError).details).toEqual({ sum: '2392.02', amount: '2400.00' });
  });

  it('el desglose exige cuota y no admite principal mayor al pendiente del préstamo', () => {
    const base = { currency: BOB, installments: sinCargos(), outstandingPrincipal: '1000.00' };
    expect(() => allocatePayment({ ...base, amount: '100.00', breakdown: { principal: '100.00' } })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    expect(() =>
      allocatePayment({ ...base, amount: '1500.00', installmentNo: 1, breakdown: { principal: '1500.00' } }),
    ).toThrow(expect.objectContaining({ code: 'LOAN_OVERPAYMENT' }));
    expect(() =>
      allocatePayment({ ...base, amount: '100.00', installmentNo: 99, breakdown: { principal: '100.00' } }),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
    expect(() => allocatePayment({ ...base, amount: '0.00' })).toThrow(DomainError);
  });

  it('con installmentNo y sin desglose imputa solo dentro de esa cuota', () => {
    const r = allocatePayment({
      currency: BOB,
      amount: '1000.00',
      installments: sinCargos(),
      installmentNo: 2,
      outstandingPrincipal: '50000.00',
    });
    expect(r.affectedInstallments).toEqual([2]);
    expect(() =>
      allocatePayment({
        currency: BOB,
        amount: '3000.00',
        installments: sinCargos(),
        installmentNo: 2,
        outstandingPrincipal: '50000.00',
      }),
    ).toThrow(expect.objectContaining({ code: 'LOAN_OVERPAYMENT' }));
  });

  it('installmentStatus: UNPAID, PARTIALLY_PAID y PAID según el principal imputado', () => {
    const e = { ...ZERO, interest: '10.00', principal: '100.00' };
    expect(installmentStatus(e, ZERO)).toBe('UNPAID');
    expect(installmentStatus(e, { ...ZERO, interest: '10.00' })).toBe('PARTIALLY_PAID');
    expect(installmentStatus(e, { ...ZERO, principal: '100.00' })).toBe('PAID');
  });
});

// ---------- PBT ----------

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const NUM_RUNS = env?.NIGHTLY ? 20_000 : 500;

describe('PaymentAllocator — propiedades', () => {
  it('[TC-DEBT-LOAN-012] Σ imputado = monto y ninguna cuota supera lo esperado sin desglose explícito', () => {
    fc.assert(
      fc.property(
        fc.record({
          units: fc.bigInt({ min: 10_000n, max: 100_000_000n }),
          bp: fc.integer({ min: 0, max: 3000 }),
          n: fc.integer({ min: 1, max: 48 }),
          feeUnits: fc.bigInt({ min: 0n, max: 2_000n }),
          payments: fc.array(fc.double({ min: 0.01, max: 1, noNaN: true }), { minLength: 1, maxLength: 6 }),
        }),
        ({ units, bp, n, feeUnits, payments }) => {
          const schedule = calculateSchedule({
            ...vehicular(),
            principal: Money.ofMinorUnits(units, BOB).toFixed(),
            annualRate: dec(String(bp)).div('10000').toFixed(),
            installments: n,
            charges: { fees: { mode: 'FIXED', value: Money.ofMinorUnits(feeUnits, BOB).toFixed() } },
          });
          let cuotas = toAllocatable(schedule.installments);
          let outstanding = dec(schedule.installments[0]!.openingBalance);
          for (const share of payments) {
            const pending = cuotas.reduce(
              (acc, c) =>
                installmentStatus(c.expected, c.paid) === 'PAID'
                  ? acc
                  : acc.plus(
                      PAYMENT_COMPONENTS.reduce(
                        (s, k) => s.plus(positive(dec(c.expected[k]).minus(c.paid[k]))),
                        dec('0'),
                      ),
                    ),
              dec('0'),
            );
            if (pending.isZero()) break;
            // monto entre 0.01 y el pendiente total, a la escala de la moneda
            const amount = pending.times(share).toDecimalPlaces(2, 6);
            const amt = amount.lt('0.01') ? dec('0.01') : amount;
            if (amt.gt(pending)) continue;
            const r = allocatePayment({
              currency: BOB,
              amount: amt.toFixed(2),
              installments: cuotas,
              outstandingPrincipal: outstanding.toFixed(2),
            });
            expect(sum(r.allocations.map((a) => a.amount)).eq(amt)).toBe(true);
            expect(sum(PAYMENT_COMPONENTS.map((k) => r.components[k])).eq(amt)).toBe(true);
            for (const after of r.installments) {
              for (const k of PAYMENT_COMPONENTS) {
                const before = cuotas.find((c) => c.n === after.n)!;
                expect(dec(after.paid[k]).lte(before.expected[k])).toBe(true);
              }
            }
            outstanding = dec(r.principalAfter);
            cuotas = applied(cuotas, r);
          }
          return true;
        },
      ),
      { numRuns: NUM_RUNS },
    );
  }, 120_000);
});
