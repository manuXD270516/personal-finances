import { LocalDate, Money, currency } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CardMovement } from './card-types.js';
import {
  computeCycleFigures,
  computeStatementStanding,
  diffFigures,
  type CycleFigures,
} from './card-cycle-calculator.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const bob = (v: string) => Money.parse(v, BOB);
const d = (s: string) => LocalDate.parse(s);
const rule = { type: 'PERCENT', percent: '5.00', floor: '50.00' } as const;

const mov = (
  businessDate: string,
  movementClass: CardMovement['movementClass'],
  amount: string,
): CardMovement => ({
  businessDate,
  movementClass,
  amount,
});

/** Ciclo de octubre de Visa Oro BOB (TC-DEBT-CARD-009). */
const octoberMovements: CardMovement[] = [
  mov('2026-10-03', 'PURCHASE', '350.00'),
  mov('2026-10-10', 'PAYMENT', '-1200.00'),
  mov('2026-10-18', 'PURCHASE', '820.50'),
  mov('2026-10-20', 'REFUND', '-50.00'),
];

describe('CardCycleCalculator (add-credit-cards, decisión 3)', () => {
  it('[TC-DEBT-CARD-009] ciclo de octubre: anterior 1200.00, compras 1170.50, reembolsos 50.00, pagos 1200.00, cierre 1120.50', () => {
    const figures = computeCycleFigures({
      currency: BOB,
      previousBalance: bob('1200.00'),
      closingBalance: bob('1120.50'),
      movements: octoberMovements,
      unbilledInstallments: bob('0.00'),
      minimumRule: rule,
    });
    expect(figures.previousBalance.toFixed()).toBe('1200.00');
    expect(figures.purchases.toFixed()).toBe('1170.50');
    expect(figures.refunds.toFixed()).toBe('50.00');
    expect(figures.payments.toFixed()).toBe('1200.00');
    expect(figures.otherNet.toFixed()).toBe('0.00');
    expect(figures.closingBalance.toFixed()).toBe('1120.50');
    expect(figures.consistent).toBe(true);
    expect(figures.billedBalance.toFixed()).toBe('1120.50');
    expect(figures.noInterestPayment.toFixed()).toBe('1120.50');
    expect(figures.minimumDue.toFixed()).toBe('56.02');
  });

  it('[TC-DEBT-CARD-010] una compra pendiente no cuenta: las cifras salen solo de los movimientos recibidos', () => {
    // El adaptador (AccountMovementsQuery) nunca devuelve pendientes; el cálculo no las inventa.
    const figures = computeCycleFigures({
      currency: BOB,
      previousBalance: bob('1200.00'),
      closingBalance: bob('1120.50'),
      movements: octoberMovements,
      unbilledInstallments: bob('0.00'),
      minimumRule: rule,
    });
    expect(figures.closingBalance.toFixed()).toBe('1120.50');
    expect(figures.purchases.toFixed()).toBe('1170.50');
  });

  it('un cálculo que no cuadra marca consistent = false en vez de esconderlo', () => {
    const figures = computeCycleFigures({
      currency: BOB,
      previousBalance: bob('1200.00'),
      closingBalance: bob('1000.00'),
      movements: octoberMovements,
      unbilledInstallments: bob('0.00'),
      minimumRule: rule,
    });
    expect(figures.consistent).toBe(false);
  });

  it('[TC-DEBT-CARD-024] el saldo facturado descuenta el capital de las cuotas no facturadas: 1000.00 ⇒ facturado 333.33, mínimo 50.00', () => {
    const figures = computeCycleFigures({
      currency: BOB,
      previousBalance: bob('0.00'),
      closingBalance: bob('1000.00'),
      movements: [mov('2026-10-05', 'PURCHASE', '1000.00')],
      unbilledInstallments: bob('666.67'),
      minimumRule: rule,
    });
    expect(figures.billedBalance.toFixed()).toBe('333.33');
    expect(figures.minimumDue.toFixed()).toBe('50.00');
    expect(figures.noInterestPayment.toFixed()).toBe('333.33');
    expect(figures.unbilledInstallments.toFixed()).toBe('666.67');
  });

  it('[TC-DEBT-CARD-011] saldo a favor: crédito de 30.00 USD ⇒ mínimo y pago sin intereses en 0.00', () => {
    const figures = computeCycleFigures({
      currency: USD,
      previousBalance: Money.zero(USD),
      closingBalance: Money.parse('-30.00', USD),
      movements: [mov('2026-10-09', 'OTHER', '-30.00')],
      unbilledInstallments: Money.zero(USD),
      minimumRule: { type: 'PERCENT', percent: '5.00', floor: '10.00' },
    });
    expect(figures.billedBalance.toFixed()).toBe('-30.00');
    expect(figures.creditBalance.toFixed()).toBe('30.00');
    expect(figures.minimumDue.toFixed()).toBe('0.00');
    expect(figures.noInterestPayment.toFixed()).toBe('0.00');
  });

  it('[TC-DEBT-CARD-009] PBT: anterior + compras − reembolsos − pagos + otros = cierre con movimientos aleatorios', () => {
    const movementArb = fc.record({
      cls: fc.constantFrom('PURCHASE', 'REFUND', 'PAYMENT', 'OTHER'),
      cents: fc.integer({ min: 1, max: 10_000_000 }),
      sign: fc.boolean(),
    });
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000, max: 20_000_000 }),
        fc.array(movementArb, { maxLength: 40 }),
        (previousCents, items) => {
          const movements = items.map((m) => {
            const signed =
              m.cls === 'PURCHASE' ? m.cents : m.cls === 'OTHER' ? (m.sign ? m.cents : -m.cents) : -m.cents;
            return mov(
              '2026-10-01',
              m.cls as CardMovement['movementClass'],
              Money.ofMinorUnits(BigInt(signed), BOB).toFixed(),
            );
          });
          const total = movements.reduce((acc, m) => acc + BigInt(m.amount.replace('.', '')), 0n);
          const previous = Money.ofMinorUnits(BigInt(previousCents), BOB);
          const closing = previous.add(Money.ofMinorUnits(total, BOB));
          const f = computeCycleFigures({
            currency: BOB,
            previousBalance: previous,
            closingBalance: closing,
            movements,
            unbilledInstallments: Money.zero(BOB),
            minimumRule: rule,
          });
          expect(f.consistent).toBe(true);
          expect(
            f.previousBalance
              .add(f.purchases)
              .subtract(f.refunds)
              .subtract(f.payments)
              .add(f.otherNet)
              .equals(f.closingBalance),
          ).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  }, 60_000);
});

describe('Estado de cuenta: lo que falta y estado (decisión 4)', () => {
  const figures: CycleFigures = computeCycleFigures({
    currency: BOB,
    previousBalance: bob('1200.00'),
    closingBalance: bob('1120.50'),
    movements: octoberMovements,
    unbilledInstallments: bob('0.00'),
    minimumRule: rule,
  });
  const standing = (
    paymentsAfterClose: string,
    today: string,
    reported?: { billedBalance: string | null; minimumDue: string | null },
  ) =>
    computeStatementStanding({
      figures,
      reported: reported ?? null,
      minimumRule: rule,
      paymentsAfterClose: bob(paymentsAfterClose),
      today: d(today),
      dueDate: d('2026-11-15'),
    });

  it('[TC-DEBT-CARD-011] pago parcial de 500.00: faltan 620.50 sin intereses y 0.00 del mínimo', () => {
    const s = standing('500.00', '2026-11-02');
    expect(s.noInterestPayment.toFixed()).toBe('1120.50');
    expect(s.minimumDue.toFixed()).toBe('56.02');
    expect(s.remainingNoInterest.toFixed()).toBe('620.50');
    expect(s.remainingMinimum.toFixed()).toBe('0.00');
  });

  it('[TC-DEBT-CARD-012] pagado completo antes del vencimiento ⇒ PAID', () => {
    expect(standing('1120.50', '2026-11-10').status).toBe('PAID');
    expect(standing('2000.00', '2026-11-10').remainingNoInterest.toFixed()).toBe('0.00');
  });

  it('[TC-DEBT-CARD-012] antes del vencimiento con faltante ⇒ ISSUED, también el mismo día del vencimiento', () => {
    expect(standing('0.00', '2026-11-02').status).toBe('ISSUED');
    expect(standing('500.00', '2026-11-15').status).toBe('ISSUED');
  });

  it('[TC-DEBT-CARD-012] vencido con el mínimo cubierto ⇒ PARTIALLY_PAID con 620.50 pendientes', () => {
    const s = standing('500.00', '2026-11-16');
    expect(s.status).toBe('PARTIALLY_PAID');
    expect(s.remainingNoInterest.toFixed()).toBe('620.50');
  });

  it('[TC-DEBT-CARD-012] vencido sin cubrir el mínimo ⇒ OVERDUE con 26.02 pendientes del mínimo', () => {
    const s = standing('30.00', '2026-11-16');
    expect(s.status).toBe('OVERDUE');
    expect(s.remainingMinimum.toFixed()).toBe('26.02');
  });

  it('[TC-DEBT-CARD-014] los montos del banco prevalecen: sin intereses 1125.30, mínimo 56.30 y diferencia 4.80', () => {
    const s = standing('0.00', '2026-11-02', { billedBalance: '1125.30', minimumDue: '56.30' });
    expect(s.noInterestPayment.toFixed()).toBe('1125.30');
    expect(s.minimumDue.toFixed()).toBe('56.30');
    expect(s.remainingNoInterest.toFixed()).toBe('1125.30');
    expect(s.reportedDifference?.toFixed()).toBe('4.80');
  });

  it('[TC-DEBT-CARD-014] si el banco solo informa el facturado, el mínimo sale de la regla sobre ese monto', () => {
    const s = standing('0.00', '2026-11-02', { billedBalance: '1125.30', minimumDue: null });
    expect(s.minimumDue.toFixed()).toBe('56.26');
  });

  it('[TC-DEBT-CARD-011] saldo facturado <= 0 ⇒ nada que pagar ⇒ PAID', () => {
    const credit = computeCycleFigures({
      currency: BOB,
      previousBalance: bob('0.00'),
      closingBalance: bob('-30.00'),
      movements: [mov('2026-10-09', 'OTHER', '-30.00')],
      unbilledInstallments: bob('0.00'),
      minimumRule: rule,
    });
    const s = computeStatementStanding({
      figures: credit,
      reported: null,
      minimumRule: rule,
      paymentsAfterClose: bob('0.00'),
      today: d('2026-11-02'),
      dueDate: d('2026-11-15'),
    });
    expect(s.status).toBe('PAID');
    expect(s.remainingNoInterest.toFixed()).toBe('0.00');
  });
});

describe('Recalculado vs emitido (decisión 5)', () => {
  it('[TC-DEBT-CARD-013] una compra retroactiva de 45.00 sube el facturado a 1165.50, el mínimo a 58.28 y la diferencia es 45.00', () => {
    const issued = computeCycleFigures({
      currency: BOB,
      previousBalance: bob('1200.00'),
      closingBalance: bob('1120.50'),
      movements: octoberMovements,
      unbilledInstallments: bob('0.00'),
      minimumRule: rule,
    });
    const current = computeCycleFigures({
      currency: BOB,
      previousBalance: bob('1200.00'),
      closingBalance: bob('1165.50'),
      movements: [...octoberMovements, mov('2026-10-24', 'PURCHASE', '45.00')],
      unbilledInstallments: bob('0.00'),
      minimumRule: rule,
    });
    expect(current.billedBalance.toFixed()).toBe('1165.50');
    expect(current.minimumDue.toFixed()).toBe('58.28');
    const diff = diffFigures(issued, current);
    expect(diff.billedBalance.toFixed()).toBe('45.00');
    expect(diff.purchases.toFixed()).toBe('45.00');
    expect(diff.minimumDue.toFixed()).toBe('2.26');
  });
});
