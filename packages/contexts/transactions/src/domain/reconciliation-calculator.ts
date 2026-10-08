import { Money } from '@pf/shared-kernel';
import type { AccountNature, AdjustmentDirection } from './transaction.js';
import type { TransactionStatus } from './transaction-status.js';

/**
 * Efecto de una transacción en la cuenta conciliada (un leg vigente de la cuenta): estado de la transacción, fecha de
 * negocio y monto con signo contable (débito +, crédito −, docs/09 §3).
 */
export interface ConfirmedLeg {
  readonly status: TransactionStatus;
  readonly businessDate: string;
  readonly amount: Money;
}

export interface ReconciliationBalances {
  /** Saldo confirmado PRESENTADO (activo: saldo; pasivo: deuda positiva, igual que la UI). */
  readonly clearedBalance: Money;
  /** Saldo del extracto − saldo confirmado (presentados). */
  readonly difference: Money;
  readonly includedCount: number;
}

/**
 * `ReconciliationCalculator` (openspec add-reconciliation, design decisiones 1 y 4): servicio de dominio puro.
 *
 *   saldo confirmado = saldo inicial + Σ legs de la cuenta de transacciones `CLEARED | RECONCILED` con
 *                      fecha de negocio ≤ fecha del extracto
 *   diferencia       = saldo del extracto − saldo confirmado
 *
 * Se calcula en la moneda de la cuenta y, en pasivos, se presenta como deuda positiva (`−saldo contable`). `PENDING`,
 * `POSTED` y `VOIDED` y lo posterior al extracto nunca suman. El saldo inicial se suma UNA sola vez (es el asiento de
 * apertura de la cuenta; no tiene fila en `txn`).
 */
export const ReconciliationCalculator = {
  /** ¿El leg suma al saldo confirmado de un extracto a `statementDate`? */
  includes(leg: Pick<ConfirmedLeg, 'status' | 'businessDate'>, statementDate: string): boolean {
    return (leg.status === 'CLEARED' || leg.status === 'RECONCILED') && leg.businessDate <= statementDate;
  },

  compute(input: {
    readonly nature: AccountNature;
    /** Saldo inicial con signo contable (lo entrega LEDGER). */
    readonly opening: Money;
    readonly legs: readonly ConfirmedLeg[];
    readonly statementDate: string;
    readonly statementBalance: Money;
  }): ReconciliationBalances {
    const included = input.legs.filter((l) => ReconciliationCalculator.includes(l, input.statementDate));
    return {
      ...ReconciliationCalculator.fromTotals({
        nature: input.nature,
        opening: input.opening,
        confirmedLegsTotal: Money.sum(
          included.map((l) => l.amount),
          input.opening.currency,
        ),
        statementBalance: input.statementBalance,
      }),
      includedCount: included.length,
    };
  },

  /** Igual que `compute` a partir de la suma de los legs ya filtrados (consulta agregada en BD). */
  fromTotals(input: {
    readonly nature: AccountNature;
    readonly opening: Money;
    readonly confirmedLegsTotal: Money;
    readonly statementBalance: Money;
  }): Omit<ReconciliationBalances, 'includedCount'> {
    const accounting = input.opening.add(input.confirmedLegsTotal);
    const clearedBalance = input.nature === 'ASSET' ? accounting : accounting.negate();
    return {
      clearedBalance,
      difference: input.statementBalance.subtract(clearedBalance),
    };
  },

  /**
   * Ajuste que anula la diferencia (FR-TRANSACTIONS-030/017): `INCREASE` si el extracto supera lo confirmado,
   * `DECREASE` si es menor, por el valor absoluto. `INCREASE` aumenta el saldo PRESENTADO tanto en activos como en
   * pasivos (la deuda mayor). `null` si no hay diferencia.
   */
  adjustmentFor(
    difference: Money,
  ): { readonly direction: AdjustmentDirection; readonly amount: Money } | null {
    if (difference.isZero()) return null;
    return { direction: difference.isPositive() ? 'INCREASE' : 'DECREASE', amount: difference.abs() };
  },
} as const;
