import { describe, expect, it } from 'vitest';
import {
  cardClosing,
  cardDue,
  closingsBetween,
  kantutaFigures,
  kantutaPlan,
  minimumPayment,
  statementFigures,
} from './cards.js';

const ANCHOR = '2026-09-30';
const fixed = (minor: bigint) => `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;

describe('tarjetas del dataset Demo v2 (TC-IDENTITY-DEMO-016)', () => {
  it('[TC-IDENTITY-DEMO-016] fechas de "Tarjeta Kantuta Demo" respecto de la ancla 2026-09-30', () => {
    const plan = kantutaPlan(ANCHOR);
    expect(plan).toMatchObject({ k1: '2026-08-18', k2: '2026-09-18', statementDay: 18, dueDay: 8 });
    expect(plan.openedOn).toBe('2026-06-19');
    expect(plan.flows.map((f) => f.date)).toEqual([
      '2026-07-25',
      '2026-08-05',
      '2026-08-10',
      '2026-08-25',
      '2026-09-01',
    ]);
    expect(plan.installments.date).toBe('2026-07-25');
  });

  it('[TC-IDENTITY-DEMO-016] con la ancla 2026-10-05 los cierres son el día 23 y el vencimiento el 13', () => {
    const plan = kantutaPlan('2026-10-05');
    expect(plan).toMatchObject({ statementDay: 23, dueDay: 13, k1: '2026-08-23', k2: '2026-09-23' });
  });

  it('[TC-IDENTITY-DEMO-016] calendario del ciclo: cierre el 18, vencimiento el 8 del mes siguiente', () => {
    expect(cardClosing(18, 2026, 8)).toBe('2026-08-18');
    expect(cardDue('2026-08-18', 8)).toBe('2026-09-08');
    expect(cardDue('2026-12-18', 8)).toBe('2027-01-08');
    expect(cardClosing(31, 2026, 2)).toBe('2026-02-28');
    expect(closingsBetween(25, '2025-01-01', '2025-03-31')).toEqual([
      '2025-01-25',
      '2025-02-25',
      '2025-03-25',
    ]);
  });

  it('[TC-IDENTITY-DEMO-016] pago mínimo: 56.025 ⇒ 56.02 (HALF_EVEN), 78.525 ⇒ 78.52 y piso de 10.00 USD', () => {
    const bob = { percent: '5.00', floor: 5_000n, scale: 2 };
    expect(fixed(minimumPayment(112_050n, bob))).toBe('56.02');
    expect(fixed(minimumPayment(157_050n, bob))).toBe('78.52');
    expect(fixed(minimumPayment(20_000n, { percent: '5.00', floor: 1_000n, scale: 2 }))).toBe('10.00');
    expect(minimumPayment(0n, bob)).toBe(0n);
    expect(minimumPayment(3_000n, bob)).toBe(3_000n);
  });

  it('[TC-IDENTITY-DEMO-016] estados de cuenta: BOB 2026-08-18 parcial, USD 2026-08-18 vencido y BOB 2026-09-18 emitido', () => {
    const f = kantutaFigures(ANCHOR);
    expect(fixed(f.bobK1.closingBalance)).toBe('5120.50');
    expect(fixed(f.bobK1.billed)).toBe('1120.50');
    expect(fixed(f.bobK1.minimum)).toBe('56.02');
    expect(f.bobK1).toMatchObject({ status: 'PARTIALLY_PAID' });
    expect(fixed(f.bobK1.pending)).toBe('620.50');
    expect(fixed(f.usdK1.billed)).toBe('200.00');
    expect(fixed(f.usdK1.minimum)).toBe('10.00');
    expect(f.usdK1.status).toBe('OVERDUE');
    expect(fixed(f.usdK1.pending)).toBe('10.00');
    expect(fixed(f.bobK2.previousBalance)).toBe('5120.50');
    expect(fixed(f.bobK2.purchases)).toBe('150.00');
    expect(fixed(-f.bobK2.payments)).toBe('500.00');
    expect(fixed(f.bobK2.closingBalance)).toBe('4770.50');
    expect(fixed(f.bobK2.billed)).toBe('1570.50');
    expect(fixed(f.bobK2.minimum)).toBe('78.52');
    expect(f.bobK2.status).toBe('ISSUED');
    expect(f.bobK2.due).toBe('2026-10-08');
    expect(f.usdK2.status).toBe('ISSUED');
    expect(f.futureCharges.map((c) => c.due)).toEqual([
      '2026-11-08',
      '2026-12-08',
      '2027-01-08',
      '2027-02-08',
    ]);
    expect(f.futureCharges.every((c) => fixed(c.amount) === '800.00')).toBe(true);
    expect(f.installment * 6n).toBe(480_000n);
  });

  it('[TC-IDENTITY-DEMO-020] con la ancla 2026-10-05 el USD anterior al último sigue vencido y el último emitido', () => {
    const f = kantutaFigures('2026-10-05');
    expect(f.usdK1.status).toBe('OVERDUE');
    expect(f.usdK2.status).toBe('ISSUED');
    expect(f.bobK1.status).toBe('PARTIALLY_PAID');
  });

  it('un movimiento ejecutado después del cierre no cambia el estado ya emitido', () => {
    const movements = [
      { date: '2025-12-10', execDate: '2025-12-10', delta: 10_000n, kind: 'purchase' as const },
      { date: '2025-12-10', execDate: '2025-12-28', delta: 1_500n, kind: 'purchase' as const },
    ];
    const issued = statementFigures({
      movements,
      closing: '2025-12-25',
      previousClosing: '2025-11-25',
      dueDay: 15,
      asOf: '2025-12-26',
      unbilledInstallments: 0n,
      rule: { percent: '5.00', floor: 5_000n, scale: 2 },
    });
    expect(issued.billed).toBe(10_000n);
    const live = statementFigures({
      movements,
      closing: '2025-12-25',
      previousClosing: '2025-11-25',
      dueDay: 15,
      asOf: '2026-01-02',
      unbilledInstallments: 0n,
      rule: { percent: '5.00', floor: 5_000n, scale: 2 },
    });
    expect(live.billed).toBe(11_500n);
  });
});
