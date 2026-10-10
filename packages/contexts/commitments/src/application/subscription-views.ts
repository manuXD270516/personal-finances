import type { PriceChangeProposal, PriceEntry, Subscription, SubscriptionCharge } from '../domain/index.js';
import { presentImpliedRate } from '../domain/index.js';
import type { MoneyDto } from '../contracts/index.js';
import type { ManagedDefinitionInfo } from './ports/subscriptions.js';

const moneyDto = (m: { toFixed(): string; currency: { code: string } }): MoneyDto => ({
  amount: m.toFixed(),
  currency: m.currency.code,
});

export interface SubscriptionPriceDto {
  readonly id: string;
  readonly effectiveFrom: string;
  readonly price: MoneyDto;
  readonly origin: string;
  readonly supersedesId: string | null;
  /** Id de la entrada que reemplaza a esta (si fue corregida). */
  readonly supersededBy: string | null;
  readonly proposalId: string | null;
}

export interface PriceProposalDto {
  readonly id: string;
  readonly chargeId: string;
  readonly effectiveFrom: string;
  readonly previousPrice: MoneyDto;
  readonly proposedPrice: MoneyDto;
  readonly changePercent: string;
  readonly status: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
}

/** `Subscription` del contrato HTTP. */
export interface SubscriptionDto {
  readonly id: string;
  readonly definitionId: string;
  readonly counterpartyId: string;
  readonly providerName: string | null;
  readonly name: string;
  readonly planName: string | null;
  readonly status: string;
  readonly currentPrice: MoneyDto;
  readonly billingCycle: {
    readonly cadence: string;
    readonly interval: number;
    readonly monthDays: readonly number[];
    readonly rrule: string | null;
  };
  readonly paymentAccountId: string;
  readonly paymentAccountName: string | null;
  readonly accountCurrency: string;
  readonly nextRenewalOn: string | null;
  readonly trialEndsOn: string | null;
  readonly scheduledCancellationOn: string | null;
  readonly cancelledOn: string | null;
  readonly cancellationReason: string | null;
  readonly cancellationUrl: string | null;
  readonly reminder: { readonly enabled: boolean; readonly daysBefore: number };
  readonly priceTolerancePercent: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly priceHistory?: readonly SubscriptionPriceDto[];
  readonly pendingProposal?: PriceProposalDto | null;
  readonly definition?: {
    readonly id: string;
    readonly status: string;
    readonly materialization: {
      readonly mode: string;
      readonly autoCreateStatus: string | null;
      readonly leadDays: number;
    };
    readonly accountId: string;
    readonly accountCurrency: string;
    readonly categoryId: string | null;
    readonly indexed: boolean;
  };
}

/** Precio vigente hoy; antes de la primera vigencia, la primera entrada que cuenta. */
export function currentPriceOf(sub: Subscription, today: string): PriceEntry {
  const entry = sub.history.at(today) ?? sub.history.active[0];
  if (!entry) throw new Error(`subscription ${sub.id} has no price`);
  return entry;
}

export const priceDto = (entry: PriceEntry, supersededBy: string | null): SubscriptionPriceDto => ({
  id: entry.id,
  effectiveFrom: entry.effectiveFrom,
  price: moneyDto(entry.price),
  origin: entry.origin,
  supersedesId: entry.supersedesId,
  supersededBy,
  proposalId: entry.proposalId,
});

export const proposalDto = (p: PriceChangeProposal): PriceProposalDto => ({
  id: p.id,
  chargeId: p.chargeId,
  effectiveFrom: p.effectiveFrom,
  previousPrice: moneyDto(p.previousPrice),
  proposedPrice: moneyDto(p.proposedPrice),
  changePercent: p.changePercent,
  status: p.status,
  decidedAt: p.decidedAt,
  decidedBy: p.decidedBy,
});

export function subscriptionDto(
  sub: Subscription,
  input: {
    readonly today: string;
    readonly providerName: string | null;
    readonly paymentAccountId: string;
    readonly paymentAccountName: string | null;
    readonly accountCurrency: string;
    readonly cadence: string;
    readonly interval: number;
    readonly monthDays: readonly number[];
    readonly rrule: string | null;
    readonly detail?: {
      readonly pending: PriceChangeProposal | null;
      readonly definition: ManagedDefinitionInfo;
    };
  },
): SubscriptionDto {
  const s = sub.snapshot;
  const history = sub.history;
  return {
    id: s.id,
    definitionId: s.definitionId,
    counterpartyId: s.counterpartyId,
    providerName: input.providerName,
    name: s.name,
    planName: s.planName,
    status: s.status,
    currentPrice: moneyDto(currentPriceOf(sub, input.today).price),
    billingCycle: {
      cadence: input.cadence,
      interval: input.interval,
      monthDays: input.monthDays,
      rrule: input.rrule,
    },
    paymentAccountId: input.paymentAccountId,
    paymentAccountName: input.paymentAccountName,
    accountCurrency: input.accountCurrency,
    nextRenewalOn: s.nextRenewalOn,
    trialEndsOn: s.trialEndsOn,
    scheduledCancellationOn: s.scheduledCancellationOn,
    cancelledOn: s.cancelledOn,
    cancellationReason: s.cancellationReason,
    cancellationUrl: s.cancellationUrl,
    reminder: s.reminder,
    priceTolerancePercent: s.tolerancePercent,
    version: s.version,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    ...(input.detail
      ? {
          priceHistory: history.entries.map((e) =>
            priceDto(e, history.entries.find((o) => o.supersedesId === e.id)?.id ?? null),
          ),
          pendingProposal: input.detail.pending ? proposalDto(input.detail.pending) : null,
          definition: {
            id: input.detail.definition.definitionId,
            status: input.detail.definition.status,
            materialization: input.detail.definition.materialization,
            accountId: input.detail.definition.accountId,
            accountCurrency: input.detail.definition.accountCurrency,
            categoryId: input.detail.definition.categoryId,
            indexed: input.detail.definition.indexed,
          },
        }
      : {}),
  };
}

/** `SubscriptionCharge` del contrato HTTP. */
export interface SubscriptionChargeDto {
  readonly id: string;
  readonly occurrenceId: string;
  readonly occurrenceDate: string;
  readonly transactionId: string;
  readonly charged: MoneyDto;
  readonly priceCurrencyAmount: MoneyDto | null;
  readonly expectedPrice: MoneyDto;
  /** Tasa implícita (cobrado / precio) a 4 decimales; solo cargos en otra moneda que el precio. */
  readonly impliedRate: string | null;
  readonly deviationPercent: string | null;
  readonly outcome: string;
}

export const chargeDto = (c: SubscriptionCharge): SubscriptionChargeDto => ({
  id: c.id,
  occurrenceId: c.occurrenceId,
  occurrenceDate: c.occurrenceDate,
  transactionId: c.transactionId,
  charged: moneyDto(c.charged),
  priceCurrencyAmount: c.priceCurrencyAmount ? moneyDto(c.priceCurrencyAmount) : null,
  expectedPrice: moneyDto(c.expectedPrice),
  impliedRate: c.impliedRate === null ? null : presentImpliedRate(c.impliedRate),
  deviationPercent: c.deviationPercent,
  outcome: c.outcome,
});
