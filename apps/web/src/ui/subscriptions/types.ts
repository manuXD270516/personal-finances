/**
 * Tipos del contrato `finance-api.v1.yaml` (tag Commitments, openspec add-subscriptions): suscripciones, historial de
 * precios, propuestas, cargos y resumen de costo. Montos como `DecimalString` (INV-001), nunca `number`.
 */
import type { Money } from '../common/types';
import type { ResolvedRate } from '../dashboard/types';
import type { MaterializationMode, RecurringCadence, RecurringStatus } from '../recurring/types';

export type SubscriptionStatus = 'TRIAL' | 'ACTIVE' | 'PAUSED' | 'CANCELLED';
export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'TRIAL',
  'ACTIVE',
  'PAUSED',
  'CANCELLED',
];

/** Cadencias que ofrece el formulario (la quincenal con dos días y la regla personalizada no se ofrecen aquí). */
export const SUBSCRIPTION_CADENCES: readonly RecurringCadence[] = [
  'DAILY',
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'BIMONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
];

export interface SubscriptionBillingCycle {
  readonly cadence: RecurringCadence;
  readonly interval: number;
  readonly monthDays: readonly number[];
  readonly rrule: string | null;
}

export interface SubscriptionReminder {
  readonly enabled: boolean;
  readonly daysBefore: number;
}

export type PriceOrigin = 'INITIAL' | 'MANUAL' | 'PROPOSAL' | 'CORRECTION';

/** Entrada del historial de precios (append-only). */
export interface SubscriptionPrice {
  readonly id: string;
  readonly effectiveFrom: string;
  readonly price: Money;
  readonly origin: PriceOrigin;
  readonly supersedesId: string | null;
  /** Id de la entrada que la reemplaza (cuando se corrigió). */
  readonly supersededBy: string | null;
  readonly proposalId: string | null;
}

export type ProposalStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED' | 'WITHDRAWN';

export interface SubscriptionPriceProposal {
  readonly id: string;
  readonly chargeId: string;
  readonly effectiveFrom: string;
  readonly previousPrice: Money;
  readonly proposedPrice: Money;
  /** `+20.02` / `-5.00`. */
  readonly changePercent: string;
  readonly status: ProposalStatus;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
}

export interface SubscriptionDefinitionRef {
  readonly id: string;
  readonly status: RecurringStatus;
  readonly materialization: {
    readonly mode: MaterializationMode;
    readonly autoCreateStatus: 'PENDING' | 'POSTED' | null;
    readonly leadDays: number;
  };
  readonly accountId: string;
  readonly accountCurrency: string;
  readonly categoryId: string | null;
  /** `true` cuando la moneda del precio difiere de la de la cuenta (cada cargo se estima con la tasa vigente). */
  readonly indexed: boolean;
}

export interface Subscription {
  readonly id: string;
  readonly definitionId: string;
  readonly counterpartyId: string;
  readonly providerName: string | null;
  readonly name: string;
  readonly planName: string | null;
  readonly status: SubscriptionStatus;
  readonly currentPrice: Money;
  readonly billingCycle: SubscriptionBillingCycle;
  readonly paymentAccountId: string;
  readonly paymentAccountName: string | null;
  readonly accountCurrency: string;
  readonly nextRenewalOn: string | null;
  readonly trialEndsOn: string | null;
  readonly scheduledCancellationOn: string | null;
  readonly cancelledOn: string | null;
  readonly cancellationReason: string | null;
  readonly cancellationUrl: string | null;
  readonly reminder: SubscriptionReminder;
  readonly priceTolerancePercent: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Solo en el detalle. */
  readonly priceHistory?: readonly SubscriptionPrice[];
  readonly pendingProposal?: SubscriptionPriceProposal | null;
  readonly definition?: SubscriptionDefinitionRef;
}

export type ChargeOutcome = 'WITHIN_TOLERANCE' | 'PRICE_CHANGE_DETECTED' | 'NOT_COMPARABLE';

export interface SubscriptionCharge {
  readonly id: string;
  readonly occurrenceId: string;
  readonly occurrenceDate: string;
  readonly transactionId: string;
  readonly charged: Money;
  /** Monto del extracto en la moneda del precio (cargos en otra moneda). */
  readonly priceCurrencyAmount: Money | null;
  readonly expectedPrice: Money;
  /** Cobrado / precio, 4 decimales (solo si la moneda del cargo difiere de la del precio). */
  readonly impliedRate: string | null;
  readonly deviationPercent: string | null;
  readonly outcome: ChargeOutcome;
}

export interface SubscriptionCostAmounts {
  readonly native: Money;
  /** En la moneda base; `null` sin tasa del par (nunca 1:1). */
  readonly base: Money | null;
}

export interface SubscriptionCostItem {
  readonly subscriptionId: string;
  readonly name: string;
  readonly status: SubscriptionStatus;
  readonly monthly: SubscriptionCostAmounts;
  readonly annual: SubscriptionCostAmounts;
  readonly complete: boolean;
}

export interface SubscriptionCostSummary {
  readonly baseCurrency: string;
  readonly items: readonly SubscriptionCostItem[];
  readonly totals: {
    readonly monthly: Money;
    readonly annual: Money;
    readonly complete: boolean;
    readonly unconverted: readonly { readonly monthly: Money; readonly annual: Money }[];
  };
  readonly afterTrial: {
    readonly items: readonly SubscriptionCostItem[];
    readonly monthly: Money;
    readonly annual: Money;
    readonly complete: boolean;
  };
  readonly meta: {
    readonly ratesUsed: readonly ResolvedRate[];
    readonly rateWindowDays: number;
    readonly asOf: string;
  };
}
