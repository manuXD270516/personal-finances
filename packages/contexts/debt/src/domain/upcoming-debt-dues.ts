import { LocalDate, type Money } from '@pf/shared-kernel';
import type { DebtKind } from './debt-summary-types.js';

export interface CardAccountDueInput {
  readonly accountId: string;
  /** Saldo adeudado (positivo); sin saldo no se lista. */
  readonly balance: Money;
  readonly lastStatement: {
    readonly dueDate: string;
    readonly remainingNoInterest: Money;
    readonly remainingMinimum: Money;
  } | null;
  readonly openCycle: { readonly dueDate: string; readonly estimatedNoInterest: Money };
}

export type DueDebtInput =
  | {
      readonly kind: 'LOAN';
      readonly id: string;
      readonly name: string;
      readonly accountId: string;
      readonly next: {
        readonly dueDate: string;
        readonly outstanding: Money;
        readonly overdueDays: number;
      } | null;
    }
  | {
      readonly kind: 'CREDIT_CARD';
      readonly id: string;
      readonly name: string;
      readonly accounts: readonly CardAccountDueInput[];
    };

export interface UpcomingDebtDue {
  readonly kind: Exclude<DebtKind, 'OTHER_LIABILITY'>;
  readonly id: string;
  readonly name: string;
  readonly accountId: string;
  readonly dueDate: string;
  readonly amount: Money;
  readonly minimum: Money | null;
  readonly estimated: boolean;
  readonly overdueDays: number;
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `UpcomingDebtDues` (design decisión 5): el próximo vencimiento de cada deuda con saldo (préstamo: primera cuota no
 * pagada; tarjeta, por cuenta: estado emitido con saldo por pagar o, si no hay, el ciclo abierto estimado). Orden:
 * atrasados primero (más días primero), luego fecha, moneda y nombre. Las deudas sin vencimiento conocido no se listan.
 */
export const UpcomingDebtDues = {
  list(debts: readonly DueDebtInput[], today: LocalDate): UpcomingDebtDue[] {
    const overdue = (dueDate: string): number =>
      Math.max(0, today.toEpochDay() - LocalDate.parse(dueDate).toEpochDay());
    const out: UpcomingDebtDue[] = [];
    for (const debt of debts) {
      if (debt.kind === 'LOAN') {
        if (!debt.next) continue;
        out.push({
          kind: 'LOAN',
          id: debt.id,
          name: debt.name,
          accountId: debt.accountId,
          dueDate: debt.next.dueDate,
          amount: debt.next.outstanding,
          minimum: null,
          estimated: false,
          overdueDays: debt.next.overdueDays,
        });
        continue;
      }
      for (const account of debt.accounts) {
        if (!account.balance.isPositive()) continue;
        const statement = account.lastStatement;
        if (statement && statement.remainingNoInterest.isPositive()) {
          out.push({
            kind: 'CREDIT_CARD',
            id: debt.id,
            name: debt.name,
            accountId: account.accountId,
            dueDate: statement.dueDate,
            amount: statement.remainingNoInterest,
            minimum: statement.remainingMinimum,
            estimated: false,
            overdueDays: overdue(statement.dueDate),
          });
        } else if (account.openCycle.estimatedNoInterest.isPositive()) {
          out.push({
            kind: 'CREDIT_CARD',
            id: debt.id,
            name: debt.name,
            accountId: account.accountId,
            dueDate: account.openCycle.dueDate,
            amount: account.openCycle.estimatedNoInterest,
            minimum: null,
            estimated: true,
            overdueDays: 0,
          });
        }
      }
    }
    return out.sort(
      (a, b) =>
        b.overdueDays - a.overdueDays ||
        byText(a.dueDate, b.dueDate) ||
        byText(a.amount.currency.code, b.amount.currency.code) ||
        byText(a.name, b.name) ||
        byText(a.accountId, b.accountId),
    );
  },
};
