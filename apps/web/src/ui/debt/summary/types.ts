import type { Money, ResolvedRate } from '../../dashboard/types';

/** Tipos del contrato `getDebtSummary` (`GET /workspaces/{workspaceId}/debts/summary`, finance-api.v1.yaml). */
export type DebtSummaryStatus = 'NO_LIABILITIES' | 'NO_DEBT' | 'ACTIVE';
export type DebtKind = 'LOAN' | 'CREDIT_CARD' | 'OTHER_LIABILITY';

export interface DebtSummaryConsolidated {
  readonly amount: Money;
  readonly complete: boolean;
  readonly unconverted: readonly Money[];
}

export interface DebtSummaryDebt {
  readonly kind: DebtKind;
  readonly id: string;
  readonly name: string;
  readonly balances: readonly {
    readonly accountId: string;
    readonly accountName: string;
    readonly outstanding: Money;
    readonly includedInNetWorth: boolean;
  }[];
  readonly estimatedPayoffDate: string | null;
  readonly payoffEstimable: boolean;
}

export interface DebtSummaryDue {
  readonly kind: 'LOAN' | 'CREDIT_CARD';
  readonly id: string;
  readonly name: string;
  readonly accountId: string;
  readonly dueDate: string;
  readonly amount: Money;
  readonly minimum: Money | null;
  readonly estimated: boolean;
  readonly overdueDays: number;
}

export interface DebtSummary {
  readonly status: DebtSummaryStatus;
  readonly asOf: string;
  readonly baseCurrency: string;
  readonly debts: readonly DebtSummaryDebt[];
  readonly totals: { readonly byCurrency: readonly Money[]; readonly consolidated: DebtSummaryConsolidated };
  readonly creditBalances: readonly {
    readonly accountId: string;
    readonly name: string;
    readonly amount: Money;
  }[];
  readonly interestYtd: {
    readonly from: string;
    readonly to: string;
    readonly byCurrency: readonly Money[];
    readonly consolidated: DebtSummaryConsolidated;
    readonly attribution: readonly {
      readonly kind: 'LOAN' | 'CREDIT_CARD' | 'OTHER';
      readonly id: string | null;
      readonly name: string | null;
      readonly byCurrency: readonly Money[];
    }[];
    readonly attributionConsistent: boolean;
  };
  readonly debtFree: {
    readonly date: string | null;
    readonly excluded: readonly { readonly kind: DebtKind; readonly id: string; readonly name: string }[];
  };
  readonly upcomingDues: readonly DebtSummaryDue[];
  readonly meta: { readonly ratesUsed: readonly ResolvedRate[]; readonly rateWindowDays: number };
}
