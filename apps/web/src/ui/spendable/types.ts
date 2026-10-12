/**
 * Tipos del contrato `getSpendable` (`GET /workspaces/{workspaceId}/reports/spendable`) y del bloque `spendable` de
 * `ReportSummary` (finance-api.v1.yaml, `Spendable` y `SpendableSummary`; add-spendable-amount, Q5). Los montos son
 * `DecimalString` (INV-001): nunca `number`.
 */
import type { Money, RateAttribution, ResolvedRate } from '../common/fx-types';

export interface SpendableCurrencyTerms {
  readonly currency: string;
  readonly liquid: Money;
  readonly reservedForGoals: Money;
  readonly committed: Money;
  readonly plannedGoalContributions: Money;
  /** `null` si el workspace no tiene reserva mínima en esta moneda: el término no se muestra. */
  readonly minimumReserve: Money | null;
  readonly spendable: Money;
}

export interface SpendableBudgetView {
  readonly status: 'AVAILABLE' | 'NO_PLAN';
  readonly action: 'CREATE_BUDGET' | null;
  readonly budgetId: string | null;
  readonly amount: Money | null;
  readonly complete: boolean | null;
}

export interface SpendableSummary {
  readonly period: {
    readonly id: string | null;
    readonly label: string;
    readonly start: string;
    readonly end: string;
  };
  readonly reportingCurrency: string;
  readonly byCurrency: readonly SpendableCurrencyTerms[];
  readonly consolidated: {
    readonly total: Money;
    readonly complete: boolean;
    readonly unconverted: readonly Money[];
  };
  /** Monedas con disponible negativo mientras el consolidado no lo es ("conviene convertir"). */
  readonly shortfalls: readonly Money[];
  readonly status: 'OK' | 'WARNING';
  readonly withoutAmountCount: number;
  readonly cardsWithoutPaymentCount: number;
  readonly budgetView: SpendableBudgetView;
}

export interface SpendableCommittedItem {
  readonly source: 'OCCURRENCE' | 'PENDING';
  readonly id: string;
  readonly definitionId: string | null;
  readonly name: string | null;
  readonly kind: 'EXPENSE' | 'TRANSFER' | 'LOAN_PAYMENT' | 'CARD_PAYMENT';
  readonly date: string;
  readonly accountId: string;
  readonly amount: Money;
  readonly overdueFromPrevious: boolean;
}

export interface SpendableReservedAccount {
  readonly accountId: string;
  readonly name: string;
  readonly balance: Money;
  readonly reserved: Money;
  readonly counted: Money;
}

export interface SpendablePlannedGoal {
  readonly goalId: string;
  readonly goalName: string;
  readonly pending: Money;
}

export interface Spendable extends SpendableSummary {
  readonly committedItems: readonly SpendableCommittedItem[];
  readonly reservedByAccount: readonly SpendableReservedAccount[];
  readonly plannedByGoal: readonly SpendablePlannedGoal[];
  readonly meta: {
    readonly generatedAt: string;
    readonly rateWindowDays: number;
    readonly dataFreshness?: string;
    readonly ratesUsed: readonly ResolvedRate[];
    readonly attributions: readonly RateAttribution[];
  };
}
