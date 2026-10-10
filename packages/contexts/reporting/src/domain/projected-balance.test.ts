import { currency, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ProjectedBalanceCalculator, type ProjectedPending } from './projected-balance.js';

const BOB = currency('BOB', 2);
const USDT = currency('USDT', 6);
const bob = (v: string) => Money.parse(v, BOB);

const banco = { accountId: 'banco', name: 'Banco BOB', currency: BOB, booked: bob('4000.00') };
const wallet = {
  accountId: 'wallet',
  name: 'Wallet USDT',
  currency: USDT,
  booked: Money.parse('50.000000', USDT),
};
const cena: ProjectedPending = {
  kind: 'EXPENSE',
  direction: 'OUT',
  accountId: 'banco',
  toAccountId: null,
  amount: bob('300.00'),
};
const reembolso: ProjectedPending = {
  kind: 'INCOME',
  direction: 'IN',
  accountId: 'banco',
  toAccountId: null,
  amount: bob('150.00'),
};

describe('ProjectedBalanceCalculator (FR-LEDGER-013)', () => {
  it('[TC-REPORTING-UPCOMING-016] Banco: 4000.00 + 150.00 - 300.00 = 3850.00 y el contable no cambia', () => {
    const [line] = ProjectedBalanceCalculator.compute([banco], [cena, reembolso]);
    expect(line?.pendingIn.toFixed()).toBe('150.00');
    expect(line?.pendingOut.toFixed()).toBe('300.00');
    expect(line?.projected.toFixed()).toBe('3850.00');
    expect(line?.booked.toFixed()).toBe('4000.00');
  });

  it('[TC-REPORTING-UPCOMING-016] una ocurrencia no materializada no descuenta (nunca llega a este cálculo)', () => {
    // "Internet" 199.00 programada no es una transacción pendiente: solo se calcula con pendientes.
    const [line] = ProjectedBalanceCalculator.compute([banco], [cena, reembolso]);
    expect(line?.projected.toFixed()).toBe('3850.00');
  });

  it('[TC-REPORTING-UPCOMING-016] una cuenta sin pendientes proyecta su saldo contable (50.000000 USDT)', () => {
    const [, w] = ProjectedBalanceCalculator.compute([banco, wallet], [cena, reembolso]);
    expect(w?.projected.toFixed()).toBe('50.000000');
    expect(w?.currency).toBe('USDT');
  });

  it('una transferencia pendiente resta en el origen y suma en el destino de la misma moneda', () => {
    const ahorro = { accountId: 'ahorro', name: 'Ahorro', currency: BOB, booked: bob('1000.00') };
    const transfer: ProjectedPending = {
      kind: 'TRANSFER',
      direction: 'OUT',
      accountId: 'banco',
      toAccountId: 'ahorro',
      amount: bob('500.00'),
    };
    const [b, a] = ProjectedBalanceCalculator.compute([banco, ahorro], [transfer]);
    expect(b?.projected.toFixed()).toBe('3500.00');
    expect(a?.projected.toFixed()).toBe('1500.00');
  });

  it('un pendiente en otra moneda que la de la cuenta no se mezcla', () => {
    const usdt: ProjectedPending = { ...cena, amount: Money.parse('1.000000', USDT) };
    const [line] = ProjectedBalanceCalculator.compute([banco], [usdt]);
    expect(line?.projected.toFixed()).toBe('4000.00');
  });
});
