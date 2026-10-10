/**
 * Tipos de los contratos `getUpcomingPayments` y `getSurprisePayments` (finance-api.v1.yaml, capability
 * `reporting/cash-flow-calendar`). Los montos son `DecimalString` (INV-001): nunca `number`.
 */
import type { Money, RateAttribution, ResolvedRate } from '../dashboard/types';

export type UpcomingItemKind = 'OCCURRENCE' | 'PENDING_TRANSACTION';
export type UpcomingItemStatus = 'SCHEDULED' | 'DUE' | 'OVERDUE' | 'PENDING_APPROVAL' | 'PENDING';
export type UpcomingAmountType = 'FIXED' | 'ESTIMATED' | 'MIN_MAX' | 'VARIABLE' | 'ACTUAL';

export interface UpcomingPaymentItem {
  readonly kind: UpcomingItemKind;
  readonly occurrenceId?: string;
  readonly definitionId?: string;
  readonly transactionId?: string;
  readonly name: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly date: string;
  readonly status: UpcomingItemStatus;
  readonly daysOverdue?: number;
  readonly amountType: UpcomingAmountType;
  readonly amount: Money | null;
  readonly range?: { readonly min: Money; readonly max: Money };
  readonly estimated: boolean;
  readonly withoutAmount: boolean;
  readonly converted: Money | null;
}

export interface ValuedTotal {
  readonly byCurrency: readonly Money[];
  readonly consolidated: {
    readonly amount: Money;
    readonly complete: boolean;
    readonly unconverted: readonly Money[];
  };
}

export interface CommittedBlock {
  readonly periodId: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly total: ValuedTotal;
  readonly fromCommitments: ValuedTotal;
  readonly fromPending: ValuedTotal;
  readonly withoutAmountCount: number;
  readonly overdueFromPreviousPeriods: ValuedTotal & { readonly count: number };
}

export interface ProjectedBalance {
  readonly accountId: string;
  readonly accountName: string;
  readonly currency: string;
  readonly booked: Money;
  readonly pendingIn: Money;
  readonly pendingOut: Money;
  readonly projected: Money;
}

export interface UpcomingPayments {
  readonly window: { readonly from: string; readonly to: string; readonly days: number };
  readonly items: readonly UpcomingPaymentItem[];
  readonly totals: ValuedTotal & { readonly withoutAmountCount: number };
  readonly committed: CommittedBlock | null;
  readonly projectedBalances: readonly ProjectedBalance[];
  readonly hasCommitments: boolean;
  readonly meta: {
    readonly generatedAt: string;
    readonly reportingCurrency: string;
    readonly timeZone: string;
    readonly rateWindowDays: number;
    readonly dataFreshness?: string;
    readonly approx: boolean;
    readonly rates: readonly ResolvedRate[];
    readonly attributions: readonly RateAttribution[];
  };
}

export interface SurprisePaymentItem {
  readonly transactionId: string;
  readonly date: string;
  readonly name: string;
  readonly amount: Money;
  readonly occurrenceId: string;
  readonly definitionId: string;
  readonly generatedOn: string;
}

export interface SurprisePayments {
  readonly periodId: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  readonly partial: boolean;
  readonly count: number;
  readonly items: readonly SurprisePaymentItem[];
  readonly note: 'UNLINKED_PAYMENTS_NOT_DETECTED';
}
