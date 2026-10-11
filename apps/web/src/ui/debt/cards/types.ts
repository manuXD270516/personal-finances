/**
 * Tipos del contrato `finance-api.v1.yaml` (tag Debt, openspec add-credit-cards). Montos como `Money`
 * (`{amount, currency}` con el monto en string decimal, INV-001) y porcentajes como string (`"5.00"`): nunca `number`.
 */
import type { Money } from '../../common/types';

export type CardStatus = 'ACTIVE' | 'ARCHIVED';
export type CardLimitMode = 'SEPARATE' | 'SHARED';
export type WeekendAdjustment = 'NONE' | 'PREVIOUS' | 'NEXT';
export const WEEKEND_ADJUSTMENTS: readonly WeekendAdjustment[] = ['NONE', 'PREVIOUS', 'NEXT'];

export type CardStatementStatus = 'OPEN' | 'ISSUED' | 'PAID' | 'PARTIALLY_PAID' | 'OVERDUE';
export type CardPaymentPolicy = 'NO_INTEREST' | 'MINIMUM';
export const PAYMENT_POLICIES: readonly CardPaymentPolicy[] = ['NO_INTEREST', 'MINIMUM'];
export type CardMaterializationMode = 'AUTO_CREATE' | 'PENDING_APPROVAL' | 'NOTIFY_ONLY';
export const CARD_MATERIALIZATION_MODES: readonly CardMaterializationMode[] = [
  'PENDING_APPROVAL',
  'AUTO_CREATE',
  'NOTIFY_ONLY',
];

export type CardMinimumRule =
  | { readonly type: 'PERCENT'; readonly percent: string; readonly floor: Money | null }
  | { readonly type: 'FIXED'; readonly amount: Money };

export type CardMinimumRuleInput =
  | { readonly type: 'PERCENT'; readonly percent: string; readonly floor?: Money }
  | { readonly type: 'FIXED'; readonly amount: Money };

export interface CardPaymentPlan {
  readonly sourceAccountId: string;
  readonly policy: CardPaymentPolicy;
  readonly materialization: {
    readonly mode: CardMaterializationMode;
    readonly autoCreateStatus: 'PENDING' | 'POSTED' | null;
    readonly leadDays: number | null;
  };
  readonly definitionId: string;
  readonly enabledAt: string;
}

export interface CardPaymentPlanInput {
  readonly sourceAccountId: string;
  readonly policy?: CardPaymentPolicy;
  readonly materialization?: {
    readonly mode?: CardMaterializationMode;
    readonly autoCreateStatus?: 'PENDING' | 'POSTED';
    readonly leadDays?: number;
  };
}

export interface CardFigures {
  readonly previousBalance: Money;
  readonly purchases: Money;
  readonly refunds: Money;
  readonly payments: Money;
  readonly otherNet: Money;
  readonly closingBalance: Money;
  readonly unbilledInstallments: Money;
  readonly billedBalance: Money;
  readonly minimumDue: Money;
  readonly noInterestPayment: Money;
  readonly creditBalance: Money;
}

export interface CardStatement {
  /** `null` cuando el ciclo se calcula al leer y nunca se emitió. */
  readonly id: string | null;
  readonly cardAccountId: string;
  readonly accountId: string;
  readonly currency: string;
  readonly cycleStart: string;
  readonly closingDate: string;
  readonly dueDate: string;
  readonly status: CardStatementStatus;
  readonly issuedAt: string | null;
  readonly issued: CardFigures | null;
  readonly current: CardFigures;
  readonly difference: CardFigures | null;
  readonly reported: {
    readonly billedBalance: Money | null;
    readonly minimumDue: Money | null;
  } | null;
  readonly reportedDifference: Money | null;
  readonly noInterestPayment: Money;
  readonly minimumDue: Money;
  readonly remainingNoInterest: Money;
  readonly remainingMinimum: Money;
  readonly consistent: boolean;
  readonly version: number | null;
}

export interface CardUtilization {
  readonly scope: 'SHARED' | 'ACCOUNT';
  readonly accountId: string | null;
  readonly limit: Money;
  readonly used: Money | null;
  readonly available: Money | null;
  /** Porcentaje con dos decimales (`"30.53"`); `null` si no puede calcularse. */
  readonly utilization: string | null;
  readonly overdrawn: boolean;
  readonly missingRates: readonly string[];
}

export interface CardAccount {
  readonly id: string;
  readonly accountId: string;
  readonly currency: string;
  readonly creditLimit: Money | null;
  readonly minimumRule: CardMinimumRule;
  readonly balance: Money;
  readonly pendingPurchases: Money;
  readonly creditUsed: Money;
  readonly utilization: CardUtilization | null;
  readonly openCycle: CardStatement;
  readonly lastStatement: CardStatement | null;
  readonly nextDueDate: string;
  readonly paymentPlan: CardPaymentPlan | null;
}

export interface CardPaymentPlanConflict {
  readonly accountId: string;
  readonly conflictingDefinitions: readonly { readonly definitionId: string; readonly name: string }[];
}

export interface CreditCard {
  readonly id: string;
  readonly name: string;
  readonly status: CardStatus;
  readonly statementDay: number;
  readonly dueDay: number;
  readonly dueWeekendAdjustment: WeekendAdjustment;
  readonly annualRate: string | null;
  readonly limitMode: CardLimitMode;
  readonly sharedLimit: Money | null;
  readonly utilizationThresholds: readonly string[];
  readonly reminderDays: number;
  readonly accounts: readonly CardAccount[];
  readonly utilization: readonly CardUtilization[];
  /** Solo en el alta: planes pedidos y no activados por una transferencia recurrente del usuario. */
  readonly paymentPlanConflicts?: readonly CardPaymentPlanConflict[];
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CardInstallment {
  readonly n: number;
  readonly billingClosingDate: string;
  readonly dueDate: string;
  readonly principal: Money;
  readonly interest: Money;
  readonly total: Money;
}

export type InstallmentPlanStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface CardInstallmentPlan {
  readonly id: string;
  readonly cardAccountId: string;
  readonly purchaseTransactionId: string;
  readonly purchaseDate: string;
  readonly principal: Money;
  readonly installmentCount: number;
  readonly annualRate: string;
  readonly startCycle: 'PURCHASE' | 'NEXT';
  readonly status: InstallmentPlanStatus;
  readonly cancelReason: 'PURCHASE_VOIDED' | 'PURCHASE_REVISED' | 'USER' | null;
  readonly installments: readonly CardInstallment[];
  readonly version: number;
}

export interface CardFutureCharge {
  readonly dueDate: string;
  readonly closingDate: string;
  readonly accountId: string;
  readonly currency: string;
  readonly installments: readonly {
    readonly planId: string;
    readonly purchaseTransactionId: string;
    readonly n: number;
    readonly of: number;
    readonly principal: Money;
    readonly interest: Money;
    readonly total: Money;
  }[];
  readonly total: Money;
}
