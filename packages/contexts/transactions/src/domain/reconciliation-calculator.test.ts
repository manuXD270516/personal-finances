import { currency, Money } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ReconciliationCalculator, type ConfirmedLeg } from './reconciliation-calculator.js';

const BOB = currency('BOB', 2);
const bob = (v: string) => Money.parse(v, BOB);

const leg = (status: ConfirmedLeg['status'], businessDate: string, amount: string): ConfirmedLeg => ({
  status,
  businessDate,
  amount: bob(amount),
});

/** Escenario del change: Bank A con saldo inicial 1000.00 (cifras a mano: 1000.00 − 150.00 + 2500.00 = 3350.00). */
const BANK_A_LEGS: ConfirmedLeg[] = [
  leg('CLEARED', '2026-03-05', '-150.00'),
  leg('CLEARED', '2026-03-10', '2500.00'),
  leg('POSTED', '2026-03-20', '-45.90'),
  leg('CLEARED', '2026-04-02', '-200.00'),
];

describe('ReconciliationCalculator', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-003] saldo confirmado = saldo inicial + cleared/reconciled hasta el extracto; la diferencia es 0.00', () => {
    const r = ReconciliationCalculator.compute({
      nature: 'ASSET',
      opening: bob('1000.00'),
      legs: BANK_A_LEGS,
      statementDate: '2026-03-31',
      statementBalance: bob('3350.00'),
    });
    expect(r.clearedBalance.toFixed()).toBe('3350.00');
    expect(r.difference.toFixed()).toBe('0.00');
    expect(r.includedCount).toBe(2);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-003] el saldo contable (3104.10) no es el confirmado: pending, posted y void no suman', () => {
    const all = ReconciliationCalculator.compute({
      nature: 'ASSET',
      opening: bob('1000.00'),
      legs: [...BANK_A_LEGS, leg('PENDING', '2026-03-01', '-9.99'), leg('VOIDED', '2026-03-02', '-7.77')],
      statementDate: '2026-04-30',
      statementBalance: bob('3150.00'),
    });
    // 1000 − 150 + 2500 − 200 = 3150 (la del 2026-03-20 sigue posted).
    expect(all.clearedBalance.toFixed()).toBe('3150.00');
    expect(all.difference.toFixed()).toBe('0.00');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-003] una diferencia negativa (extracto 3345.00) es −5.00; la reconciliada previa también cuenta', () => {
    const r = ReconciliationCalculator.compute({
      nature: 'ASSET',
      opening: bob('1000.00'),
      legs: [leg('RECONCILED', '2026-03-05', '-150.00'), leg('CLEARED', '2026-03-10', '2500.00')],
      statementDate: '2026-03-31',
      statementBalance: bob('3345.00'),
    });
    expect(r.difference.toFixed()).toBe('-5.00');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-004] en una tarjeta de crédito el saldo se expresa como deuda positiva', () => {
    const r = ReconciliationCalculator.compute({
      nature: 'LIABILITY',
      opening: bob('0.00'),
      legs: [leg('CLEARED', '2026-03-05', '-400.00'), leg('CLEARED', '2026-03-12', '-120.00')],
      statementDate: '2026-03-31',
      statementBalance: bob('520.00'),
    });
    expect(r.clearedBalance.toFixed()).toBe('520.00');
    expect(r.difference.toFixed()).toBe('0.00');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-004] el saldo inicial de un pasivo se incluye una sola vez (signo contable crédito −)', () => {
    const r = ReconciliationCalculator.compute({
      nature: 'LIABILITY',
      opening: bob('-300.00'),
      legs: [leg('CLEARED', '2026-03-05', '-200.00'), leg('CLEARED', '2026-03-20', '50.00')],
      statementDate: '2026-03-31',
      statementBalance: bob('450.00'),
    });
    expect(r.clearedBalance.toFixed()).toBe('450.00');
    expect(r.difference.toFixed()).toBe('0.00');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-003] las fechas posteriores al extracto quedan fuera aunque estén cleared (borde: el mismo día entra)', () => {
    const legs = [leg('CLEARED', '2026-03-31', '-10.00'), leg('CLEARED', '2026-04-01', '-20.00')];
    const r = ReconciliationCalculator.compute({
      nature: 'ASSET',
      opening: bob('100.00'),
      legs,
      statementDate: '2026-03-31',
      statementBalance: bob('90.00'),
    });
    expect(r.clearedBalance.toFixed()).toBe('90.00');
    expect(r.includedCount).toBe(1);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-008] el ajuste anula la diferencia: dirección y monto por signo (activo y pasivo)', () => {
    expect(ReconciliationCalculator.adjustmentFor(bob('-5.00'))).toEqual({
      direction: 'DECREASE',
      amount: bob('5.00'),
    });
    expect(ReconciliationCalculator.adjustmentFor(bob('12.34'))).toEqual({
      direction: 'INCREASE',
      amount: bob('12.34'),
    });
    expect(ReconciliationCalculator.adjustmentFor(bob('0.00'))).toBeNull();
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-003] fromTotals produce lo mismo que compute (consulta agregada en BD)', () => {
    const total = Money.sum(
      BANK_A_LEGS.filter((l) => l.status === 'CLEARED' && l.businessDate <= '2026-03-31').map(
        (l) => l.amount,
      ),
      BOB,
    );
    const r = ReconciliationCalculator.fromTotals({
      nature: 'ASSET',
      opening: bob('1000.00'),
      confirmedLegsTotal: total,
      statementBalance: bob('3350.00'),
    });
    expect(r.clearedBalance.toFixed()).toBe('3350.00');
    expect(r.difference.toFixed()).toBe('0.00');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-003] PBT: diferencia = extracto − (saldo inicial + Σ incluidas) para conjuntos aleatorios', () => {
    const cents = fc.integer({ min: -2_000_000, max: 2_000_000 });
    const money = (c: number) => Money.parse((c / 100).toFixed(2), BOB);
    const day = fc.integer({ min: 1, max: 28 }).map((d) => `2026-03-${String(d).padStart(2, '0')}`);
    const status = fc.constantFrom('PENDING', 'POSTED', 'CLEARED', 'RECONCILED', 'VOIDED' as const);
    const legArb = fc.record({ status, businessDate: day, amount: cents.filter((c) => c !== 0).map(money) });
    fc.assert(
      fc.property(
        fc.array(legArb, { maxLength: 40 }),
        cents,
        cents,
        day,
        fc.constantFrom('ASSET', 'LIABILITY' as const),
        (legs, openingCents, statementCents, statementDate, nature) => {
          const r = ReconciliationCalculator.compute({
            nature,
            opening: money(openingCents),
            legs,
            statementDate,
            statementBalance: money(statementCents),
          });
          const included = legs.filter(
            (l) => (l.status === 'CLEARED' || l.status === 'RECONCILED') && l.businessDate <= statementDate,
          );
          const accounting = money(openingCents).add(
            Money.sum(
              included.map((l) => l.amount),
              BOB,
            ),
          );
          const presented = nature === 'ASSET' ? accounting : accounting.negate();
          expect(r.clearedBalance.equals(presented)).toBe(true);
          expect(r.difference.equals(money(statementCents).subtract(presented))).toBe(true);
          expect(r.includedCount).toBe(included.length);
        },
      ),
    );
  });
});
