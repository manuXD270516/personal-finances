import { LocalDate, Money, currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { computeCycleFigures, computeStatementStanding } from './card-cycle-calculator.js';
import {
  expectationForFuture,
  expectationForIssued,
  expectationForOpen,
  sameExpectation,
} from './payment-plan-expectation.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const bob = (v: string) => Money.parse(v, BOB);
const rule = { type: 'PERCENT', percent: '5.00', floor: '50.00' } as const;
const d = (s: string) => LocalDate.parse(s);

const standingOf = (closing: string, paymentsAfterClose = '0.00') =>
  computeStatementStanding({
    figures: computeCycleFigures({
      currency: BOB,
      previousBalance: bob('0.00'),
      closingBalance: bob(closing),
      movements: [{ businessDate: '2026-10-05', movementClass: 'PURCHASE', amount: closing }],
      unbilledInstallments: bob('0.00'),
      minimumRule: rule,
    }),
    reported: null,
    minimumRule: rule,
    paymentsAfterClose: bob(paymentsAfterClose),
    today: d('2026-10-26'),
    dueDate: d('2026-11-15'),
  });

describe('PaymentPlanExpectation (add-credit-cards, decisión 7)', () => {
  it('[TC-DEBT-CARD-017] antes del cierre: ESTIMATED con el saldo adeudado de hoy (1120.50 BOB)', () => {
    const e = expectationForOpen({
      policy: 'NO_INTEREST',
      minimumRule: rule,
      presentedBalance: bob('1120.50'),
      dueIssuedRemaining: bob('0.00'),
      unbilledAfter: bob('0.00'),
    });
    expect(e).toEqual({ type: 'ESTIMATED', amount: bob('1120.50') });
  });

  it('el ciclo abierto descuenta lo que falta del emitido no vencido y las cuotas de ciclos posteriores', () => {
    const e = expectationForOpen({
      policy: 'NO_INTEREST',
      minimumRule: rule,
      presentedBalance: bob('2000.00'),
      dueIssuedRemaining: bob('1120.50'),
      unbilledAfter: bob('333.33'),
    });
    expect(e).toEqual({ type: 'ESTIMATED', amount: bob('546.17') });
  });

  it('el ciclo abierto sin saldo que pagar queda sin monto (NONE)', () => {
    expect(
      expectationForOpen({
        policy: 'NO_INTEREST',
        minimumRule: rule,
        presentedBalance: bob('1000.00'),
        dueIssuedRemaining: bob('1000.00'),
        unbilledAfter: bob('0.00'),
      }),
    ).toEqual({ type: 'NONE' });
  });

  it('[TC-DEBT-CARD-017] con MINIMUM el ciclo abierto aplica la regla del mínimo a la estimación', () => {
    const e = expectationForOpen({
      policy: 'MINIMUM',
      minimumRule: rule,
      presentedBalance: bob('1120.50'),
      dueIssuedRemaining: bob('0.00'),
      unbilledAfter: bob('0.00'),
    });
    expect(e).toEqual({ type: 'ESTIMATED', amount: bob('56.02') });
  });

  it('[TC-DEBT-CARD-017] estado emitido: FIXED 1120.50 BOB (NO_INTEREST) o 56.02 BOB (MINIMUM)', () => {
    const standing = standingOf('1120.50');
    expect(expectationForIssued({ policy: 'NO_INTEREST', standing })).toEqual({
      type: 'FIXED',
      amount: bob('1120.50'),
    });
    expect(expectationForIssued({ policy: 'MINIMUM', standing })).toEqual({
      type: 'FIXED',
      amount: bob('56.02'),
    });
  });

  it('[TC-DEBT-CARD-017] lo que ya se pagó fuera del plan baja el monto fijo y, si queda en 0, la omite (STATEMENT_PAID)', () => {
    expect(
      expectationForIssued({ policy: 'NO_INTEREST', standing: standingOf('1120.50', '500.00') }),
    ).toEqual({
      type: 'FIXED',
      amount: bob('620.50'),
    });
    expect(
      expectationForIssued({ policy: 'NO_INTEREST', standing: standingOf('1120.50', '1120.50') }),
    ).toEqual({
      type: 'SKIP',
      reason: 'STATEMENT_PAID',
    });
    // Con MINIMUM y el mínimo ya cubierto no queda nada que pagar por el plan.
    expect(expectationForIssued({ policy: 'MINIMUM', standing: standingOf('1120.50', '500.00') })).toEqual({
      type: 'SKIP',
      reason: 'STATEMENT_PAID',
    });
  });

  it('[TC-DEBT-CARD-017] estado de cuenta sin saldo facturado (0.00 USD) se omite con NOTHING_BILLED', () => {
    const usdStanding = computeStatementStanding({
      figures: computeCycleFigures({
        currency: USD,
        previousBalance: Money.zero(USD),
        closingBalance: Money.zero(USD),
        movements: [],
        unbilledInstallments: Money.zero(USD),
        minimumRule: { type: 'PERCENT', percent: '5.00', floor: '10.00' },
      }),
      reported: null,
      minimumRule: { type: 'PERCENT', percent: '5.00', floor: '10.00' },
      paymentsAfterClose: Money.zero(USD),
      today: d('2026-10-26'),
      dueDate: d('2026-11-15'),
    });
    expect(expectationForIssued({ policy: 'NO_INTEREST', standing: usdStanding })).toEqual({
      type: 'SKIP',
      reason: 'NOTHING_BILLED',
    });
  });

  it('[TC-DEBT-CARD-033] ciclos posteriores: ESTIMATED con la suma de las cuotas, o NONE sin cuotas', () => {
    expect(
      expectationForFuture({ policy: 'NO_INTEREST', minimumRule: rule, installmentsTotal: bob('333.33') }),
    ).toEqual({ type: 'ESTIMATED', amount: bob('333.33') });
    expect(
      expectationForFuture({ policy: 'NO_INTEREST', minimumRule: rule, installmentsTotal: bob('0.00') }),
    ).toEqual({ type: 'NONE' });
  });

  it('sameExpectation evita escrituras redundantes', () => {
    const wanted = { type: 'FIXED', amount: bob('1120.50') } as const;
    expect(sameExpectation(wanted, { type: 'FIXED', amount: '1120.50' }, 2)).toBe(true);
    expect(sameExpectation(wanted, { type: 'ESTIMATED', amount: '1120.50' }, 2)).toBe(false);
    expect(sameExpectation(wanted, { type: 'FIXED', amount: '1120.40' }, 2)).toBe(false);
    expect(sameExpectation({ type: 'NONE' }, { type: 'VARIABLE', amount: null }, 2)).toBe(true);
    expect(sameExpectation({ type: 'NONE' }, { type: 'ESTIMATED', amount: '1.00' }, 2)).toBe(false);
  });
});
