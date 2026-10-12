import type { Money } from '@pf/shared-kernel';
import type { DebtKind } from './debt-summary-types.js';

export interface CardAccountPayoffInput {
  readonly accountId: string;
  /** Saldo adeudado (positivo). */
  readonly balance: Money;
  /** Último estado emitido: vencimiento y lo que falta para no generar intereses. */
  readonly lastStatement: { readonly dueDate: string; readonly remainingNoInterest: Money } | null;
  readonly openCycleDueDate: string;
  /** Capital de cuotas aún no facturado y vencimiento del pago que factura la última cuota. */
  readonly unbilledInstallments: Money;
  readonly lastInstallmentDueDate: string | null;
}

export type PayoffDebtInput =
  | {
      readonly kind: 'LOAN';
      readonly id: string;
      readonly name: string;
      readonly lastUnpaidDueDate: string | null;
    }
  | {
      readonly kind: 'CREDIT_CARD';
      readonly id: string;
      readonly name: string;
      readonly accounts: readonly CardAccountPayoffInput[];
    }
  | { readonly kind: 'OTHER_LIABILITY'; readonly id: string; readonly name: string };

export interface DebtPayoffEstimate {
  readonly kind: DebtKind;
  readonly id: string;
  readonly estimatedPayoffDate: string | null;
  readonly payoffEstimable: boolean;
}

export interface DebtFreeEstimate {
  readonly perDebt: readonly DebtPayoffEstimate[];
  /** La mayor de las fechas estimadas; `null` si no hay deudas o ninguna es estimable. */
  readonly date: string | null;
  readonly excluded: readonly { readonly kind: DebtKind; readonly id: string; readonly name: string }[];
}

const maxDate = (dates: readonly string[]): string | null =>
  dates.length === 0 ? null : dates.reduce((a, b) => (a > b ? a : b));

/**
 * Fecha en que termina de pagarse una cuenta de tarjeta, suponiendo que se paga el total facturado y no hay compras
 * nuevas (design decisión 4, pregunta 6): el mayor entre el vencimiento del estado emitido con saldo por pagar, el del
 * ciclo abierto si hay compras del ciclo abierto y el del ciclo que factura la última cuota pendiente.
 */
export function cardAccountPayoffDate(account: CardAccountPayoffInput): string | null {
  const billed =
    account.lastStatement && account.lastStatement.remainingNoInterest.isPositive()
      ? account.lastStatement.remainingNoInterest
      : null;
  const unbilled = account.unbilledInstallments.isPositive() ? account.unbilledInstallments : null;
  let open = account.balance;
  if (billed) open = open.subtract(billed);
  if (unbilled) open = open.subtract(unbilled);
  const dates: string[] = [];
  if (billed && account.lastStatement) dates.push(account.lastStatement.dueDate);
  if (open.isPositive()) dates.push(account.openCycleDueDate);
  if (unbilled && account.lastInstallmentDueDate) dates.push(account.lastInstallmentDueDate);
  return maxDate(dates) ?? (account.balance.isPositive() ? account.openCycleDueDate : null);
}

/**
 * `DebtFreeDateEstimator`: fecha estimada de cada deuda con saldo y fecha global (la mayor), informando las deudas no
 * estimables (otros pasivos sin cronograma) que quedaron fuera.
 */
export const DebtFreeDateEstimator = {
  estimate(debts: readonly PayoffDebtInput[]): DebtFreeEstimate {
    const perDebt: DebtPayoffEstimate[] = [];
    const excluded: { kind: DebtKind; id: string; name: string }[] = [];
    for (const debt of debts) {
      let date: string | null = null;
      if (debt.kind === 'LOAN') date = debt.lastUnpaidDueDate;
      else if (debt.kind === 'CREDIT_CARD') {
        const dates = debt.accounts
          .filter((a) => a.balance.isPositive())
          .map(cardAccountPayoffDate)
          .filter((d): d is string => d !== null);
        date = maxDate(dates);
      }
      perDebt.push({
        kind: debt.kind,
        id: debt.id,
        estimatedPayoffDate: date,
        payoffEstimable: date !== null,
      });
      if (date === null) excluded.push({ kind: debt.kind, id: debt.id, name: debt.name });
    }
    return {
      perDebt,
      date: maxDate(perDebt.map((p) => p.estimatedPayoffDate).filter((d): d is string => d !== null)),
      excluded,
    };
  },
};
