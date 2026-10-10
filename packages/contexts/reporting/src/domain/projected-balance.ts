import { Money, type Currency } from '@pf/shared-kernel';

export interface ProjectedBalanceAccount {
  readonly accountId: string;
  readonly name: string;
  readonly currency: Currency;
  /** Saldo contable presentado (ledger). */
  readonly booked: Money;
}

export interface ProjectedPending {
  readonly kind: string;
  readonly direction: 'IN' | 'OUT';
  readonly accountId: string;
  readonly toAccountId: string | null;
  readonly amount: Money;
}

export interface ProjectedBalanceLine {
  readonly accountId: string;
  readonly name: string;
  readonly currency: string;
  readonly booked: Money;
  readonly pendingIn: Money;
  readonly pendingOut: Money;
  /** `booked + pendingIn - pendingOut` (FR-LEDGER-013). */
  readonly projected: Money;
}

/**
 * DS `ProjectedBalanceCalculator` (design.md decisión 9, FR-LEDGER-013): saldo proyectado de cada cuenta = saldo
 * contable + ingresos pendientes − egresos pendientes. Las transferencias pendientes restan en la cuenta de origen y
 * suman en la de destino (si comparten moneda). NO descuenta ocurrencias recurrentes no materializadas (eso es el saldo
 * esperado del calendario de Phase 7) y NUNCA modifica el saldo contable. Por moneda de la cuenta, sin consolidar.
 */
export const ProjectedBalanceCalculator = {
  compute(
    accounts: readonly ProjectedBalanceAccount[],
    pending: readonly ProjectedPending[],
  ): ProjectedBalanceLine[] {
    return accounts.map((a) => {
      let pendingIn = Money.zero(a.currency);
      let pendingOut = Money.zero(a.currency);
      for (const p of pending) {
        if (p.amount.currency.code !== a.currency.code) continue;
        if (p.kind === 'TRANSFER') {
          if (p.accountId === a.accountId) pendingOut = pendingOut.add(p.amount);
          if (p.toAccountId === a.accountId) pendingIn = pendingIn.add(p.amount);
        } else if (p.accountId === a.accountId) {
          if (p.direction === 'IN') pendingIn = pendingIn.add(p.amount);
          else pendingOut = pendingOut.add(p.amount);
        }
      }
      return {
        accountId: a.accountId,
        name: a.name,
        currency: a.currency.code,
        booked: a.booked,
        pendingIn,
        pendingOut,
        projected: a.booked.add(pendingIn).subtract(pendingOut),
      };
    });
  },
} as const;
