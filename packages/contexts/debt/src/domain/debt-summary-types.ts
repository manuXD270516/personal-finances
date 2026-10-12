import type { Currency, Money } from '@pf/shared-kernel';

/** Tipos del resumen de deudas (openspec add-debt-summary). Dominio puro: sin I/O ni imports de otros contextos. */
export type DebtKind = 'LOAN' | 'CREDIT_CARD' | 'OTHER_LIABILITY';

export type DebtSummaryStatus = 'NO_LIABILITIES' | 'NO_DEBT' | 'ACTIVE';

/** Cuenta de pasivo no archivada con su saldo PRESENTADO a hoy (positivo = adeudado, negativo = saldo a favor). */
export interface LiabilityAccount {
  readonly accountId: string;
  readonly name: string;
  readonly currency: Currency;
  readonly balance: Money;
  readonly includedInNetWorth: boolean;
}

/** Perfil de Debt que respalda una cuenta de pasivo. */
export interface DebtLink {
  readonly id: string;
  readonly name: string;
  readonly accountId: string;
}

export interface DebtBalance {
  readonly accountId: string;
  readonly name: string;
  readonly outstanding: Money;
  readonly includedInNetWorth: boolean;
}

export interface DebtItem {
  readonly kind: DebtKind;
  /** `loanId`, `cardId` o `accountId` (otros pasivos). */
  readonly id: string;
  readonly name: string;
  readonly balances: readonly DebtBalance[];
}

export interface CreditBalance {
  readonly accountId: string;
  readonly name: string;
  /** Monto a favor (positivo). */
  readonly amount: Money;
}

export interface DebtGrouping {
  readonly status: DebtSummaryStatus;
  readonly debts: readonly DebtItem[];
  readonly creditBalances: readonly CreditBalance[];
  /** Σ de los saldos adeudados por moneda; solo con estado `ACTIVE`. Nunca mezcla monedas. */
  readonly totalsByCurrency: readonly Money[];
}
