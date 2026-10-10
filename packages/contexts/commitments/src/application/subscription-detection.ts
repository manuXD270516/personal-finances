import type { LifecycleEventRefDto } from '@pf/audit/contracts';
import { DomainError, type Money } from '@pf/shared-kernel';
import { COMMITMENTS_EVENTS, type MoneyDto, type SubscriptionPriceChangedV1 } from '../contracts/index.js';
import {
  decideProposal,
  type PriceChangeProposal,
  type Subscription,
  type SubscriptionCharge,
} from '../domain/index.js';
import { subscriptionEntry, publishSubscriptionEvent, subscriptionSteps } from './subscription-recorder.js';
import type { SubscriptionsDeps } from './ports/subscriptions.js';

const moneyDto = (m: Money): MoneyDto => ({ amount: m.toFixed(), currency: m.currency.code });

/**
 * Resultado de la detección sobre un cargo ya evaluado: crea (o revive) la propuesta, pasa la pendiente anterior a
 * `SUPERSEDED` y publica `SubscriptionPriceChanged.v1` con `origin = DETECTED` en la misma transacción. Con un cargo
 * dentro de la tolerancia, no comparable, o ya propuesto, no hace nada (idempotencia de negocio, decisión 8).
 * El llamador tiene la suscripción bloqueada (`FOR UPDATE`); aquí se versiona y se guarda.
 */
export async function proposePriceChange(
  deps: SubscriptionsDeps,
  sub: Subscription,
  input: {
    readonly charge: SubscriptionCharge;
    /** Monto comparado, en la moneda del precio (el del cargo o el indicado por el EDITOR). */
    readonly observed: Money;
    readonly changePercentage: string;
    readonly at: string;
    readonly by: string | null;
  },
): Promise<PriceChangeProposal | null> {
  const { charge, observed } = input;
  const existing = await deps.proposals.listForSubscription(sub.workspaceId, sub.id);
  const action = decideProposal({ existing, effectiveFrom: charge.occurrenceDate, proposedPrice: observed });
  if (action.action === 'NONE') return null;

  if (action.supersedePendingId !== null) {
    const pending = existing.find((p) => p.id === action.supersedePendingId);
    if (pending) await deps.proposals.update(sub.workspaceId, { ...pending, status: 'SUPERSEDED' });
  }
  let proposal: PriceChangeProposal = {
    id: action.action === 'REVIVE' ? action.proposalId : deps.ids.next(),
    subscriptionId: sub.id,
    chargeId: charge.id,
    effectiveFrom: charge.occurrenceDate,
    previousPrice: charge.expectedPrice,
    proposedPrice: observed,
    changePercent: input.changePercentage,
    status: 'PENDING',
    decidedAt: null,
    decidedBy: null,
    eventId: null,
  };
  if (action.action === 'INSERT') await deps.proposals.insert(proposal);
  else await deps.proposals.update(sub.workspaceId, proposal);

  sub.touch(['priceProposal'], input.at, input.by);
  if (!(await deps.subscriptions.save(sub))) {
    throw new DomainError('CONCURRENCY_CONFLICT', `subscription ${sub.id} changed concurrently`);
  }
  const names = await deps.counterpartyNames.namesOf({
    workspaceId: sub.workspaceId,
    counterpartyIds: [sub.snapshot.counterpartyId],
  });
  const payload: SubscriptionPriceChangedV1 = {
    workspaceId: sub.workspaceId,
    subscriptionId: sub.id,
    definitionId: sub.snapshot.definitionId,
    counterpartyId: sub.snapshot.counterpartyId,
    providerName: names.get(sub.snapshot.counterpartyId) ?? sub.snapshot.name,
    previousPrice: moneyDto(charge.expectedPrice),
    newPrice: moneyDto(observed),
    effectiveFrom: charge.occurrenceDate,
    changePercentage: input.changePercentage,
    origin: 'DETECTED',
    proposalId: proposal.id,
    chargeId: charge.id,
    transactionId: charge.transactionId,
  };
  const event: LifecycleEventRefDto = await publishSubscriptionEvent(
    deps,
    sub,
    COMMITMENTS_EVENTS.subscriptionPriceChanged,
    payload,
  );
  proposal = { ...proposal, eventId: event.eventId };
  await deps.proposals.update(sub.workspaceId, proposal);
  await deps.lifecycle.record(
    subscriptionEntry(sub, 'price_change_detected', [
      { field: 'proposalId', before: null, after: proposal.id },
      { field: 'chargeId', before: null, after: charge.id },
      { field: 'previousPrice', before: null, after: moneyDto(charge.expectedPrice) },
      { field: 'price', before: null, after: moneyDto(observed) },
      { field: 'effectiveFrom', before: null, after: charge.occurrenceDate },
    ]),
    subscriptionSteps(sub, [event], { changedFields: ['priceProposal'] }),
  );
  return proposal;
}
