import { currency, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { groupMovements, toMovementLines, type MovementLegRow } from './account-movements.js';

const BOB = currency('BOB', 2);
const m = (v: string) => Money.parse(v, BOB);
const CARD = 'card-account';

const leg = (over: Partial<MovementLegRow> & Pick<MovementLegRow, 'kind' | 'legAmount'>): MovementLegRow => ({
  accountId: CARD,
  businessDate: '2026-10-03',
  transactionId: `tx-${Math.random()}`,
  nature: 'LIABILITY',
  splitAmount: null,
  categoryId: null,
  ...over,
});

describe('clasificación de movimientos de una cuenta de pasivo', () => {
  it('[TC-DEBT-CARD-009] compras, reembolso y pago cuadran con la variación del saldo presentado', () => {
    const rows: MovementLegRow[] = [
      leg({ kind: 'EXPENSE', legAmount: m('-350.00'), splitAmount: m('350.00') }),
      leg({ kind: 'EXPENSE', legAmount: m('-820.50'), splitAmount: m('820.50'), businessDate: '2026-10-18' }),
      leg({ kind: 'REFUND', legAmount: m('50.00'), splitAmount: m('50.00'), businessDate: '2026-10-20' }),
      leg({ kind: 'TRANSFER', legAmount: m('1200.00'), businessDate: '2026-10-10' }),
    ];
    const lines = toMovementLines(rows, () => null);
    const byClass = (c: string) =>
      lines.filter((l) => l.movementClass === c).reduce((a, l) => a.add(l.amount), m('0.00'));
    expect(byClass('PURCHASE').toFixed()).toBe('1170.50');
    expect(byClass('REFUND').toFixed()).toBe('-50.00');
    expect(byClass('PAYMENT').toFixed()).toBe('-1200.00');
    const total = lines.reduce((a, l) => a.add(l.amount), m('0.00'));
    // 1200.00 anterior + (−79.50) = 1120.50 al cierre
    expect(m('1200.00').add(total).toFixed()).toBe('1120.50');
  });

  it('[TC-DEBT-CARD-016] la pata destino de una conversión hacia la tarjeta es PAYMENT y la que sale es PURCHASE', () => {
    const usd = currency('USD', 2);
    const entra = leg({ kind: 'CONVERSION', legAmount: Money.parse('100.00', usd) });
    const sale = leg({ kind: 'CONVERSION', legAmount: Money.parse('-100.00', usd) });
    const [a, b] = toMovementLines([entra, sale], () => null);
    expect([a?.movementClass, a?.amount.toFixed()]).toEqual(['PAYMENT', '-100.00']);
    expect([b?.movementClass, b?.amount.toFixed()]).toEqual(['PURCHASE', '100.00']);
  });

  it('ajustes, ingresos y préstamos son OTHER con su signo', () => {
    const lines = toMovementLines(
      [
        leg({ kind: 'ADJUSTMENT', legAmount: m('-30.00') }),
        leg({ kind: 'INCOME', legAmount: m('10.00') }),
        leg({ kind: 'LOAN_PAYMENT', legAmount: m('-5.00') }),
      ],
      () => null,
    );
    expect(lines.map((l) => [l.movementClass, l.amount.toFixed()])).toEqual([
      ['OTHER', '30.00'],
      ['OTHER', '-10.00'],
      ['OTHER', '5.00'],
    ]);
  });

  it('agrupa por día y categoría de sistema; por transacción una fila por clase', () => {
    const rows: MovementLegRow[] = [
      leg({
        kind: 'EXPENSE',
        transactionId: 't1',
        legAmount: m('-100.00'),
        splitAmount: m('60.00'),
        categoryId: 'c-int',
      }),
      leg({
        kind: 'EXPENSE',
        transactionId: 't1',
        legAmount: m('-100.00'),
        splitAmount: m('40.00'),
        categoryId: 'c-other',
      }),
      leg({
        kind: 'EXPENSE',
        transactionId: 't2',
        legAmount: m('-10.00'),
        splitAmount: m('10.00'),
        categoryId: 'c-int',
      }),
    ];
    const lines = toMovementLines(rows, (c) => (c === 'c-int' ? 'INTEREST' : null));
    const day = groupMovements(lines, 'DAY');
    expect(day.map((g) => [g.systemCategoryCode, g.amount.toFixed(), g.transactionId])).toEqual([
      [null, '40.00', null],
      ['INTEREST', '70.00', null],
    ]);
    const tx = groupMovements(lines, 'TRANSACTION');
    expect(tx.map((g) => [g.transactionId, g.systemCategoryCode, g.amount.toFixed()])).toEqual([
      ['t1', null, '100.00'],
      ['t2', 'INTEREST', '10.00'],
    ]);
  });
});
