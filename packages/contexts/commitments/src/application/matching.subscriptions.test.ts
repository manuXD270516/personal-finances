import { describe, expect, it } from 'vitest';
import { MatchingService } from './matching.service.js';
import { OccurrencesService } from './occurrences.service.js';
import { SubscriptionChargesService } from './subscription-charges.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { USER, VISA_USD, WS } from './testing/in-memory.js';
import { InMemorySubscriptions, STREAMLY } from './testing/in-memory-subscriptions.js';

const usd = (amount: string) => ({ amount, currency: 'USD' });
const noon = (date: string) => `${date}T16:00:00Z`;

interface Fact {
  occurrenceId: string;
  definitionId: string;
  occurrenceDate: string;
  managedBy: string;
  transactionId: string;
  amount: { amount: string; currency: string };
}

function setup() {
  const mem = new InMemorySubscriptions();
  mem.setNow(noon('2026-11-14'));
  mem.rateTable.set('USD/BOB', '9.80');
  const deps = mem.subscriptionDeps();
  const subs = new SubscriptionsService(deps);
  const charges = new SubscriptionChargesService(deps);
  const occs = new OccurrencesService(deps);
  const matching = new MatchingService(deps, occs);
  let delivered = 0;
  /** Entrega al consumidor `commitments.subscription-charges` los hechos de vinculación (como el worker). */
  const deliver = async () => {
    while (delivered < mem.events.length) {
      const event = mem.events[delivered]!;
      delivered += 1;
      if (event.eventType !== 'commitments.RecurringOccurrenceMaterialized') continue;
      const p = event.payload as unknown as Fact;
      await charges.onOccurrenceMaterialized({
        workspaceId: WS,
        occurrenceId: p.occurrenceId,
        definitionId: p.definitionId,
        occurrenceDate: p.occurrenceDate,
        managedBy: p.managedBy,
        transactionId: p.transactionId,
        amount: p.amount,
      });
    }
  };
  return { mem, subs, occs, matching, deliver };
}

async function streamly(s: ReturnType<typeof setup>) {
  return s.subs.create({
    workspaceId: WS,
    userId: USER,
    counterpartyId: STREAMLY,
    name: 'Streamly',
    planName: 'Premium',
    price: usd('10.99'),
    billingCycle: { cadence: 'MONTHLY' },
    firstRenewalOn: '2026-11-15',
    paymentAccountId: VISA_USD,
    materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
  });
}

describe('Confirmar una sugerencia y la detección de cambio de precio de suscripciones', () => {
  it('[TC-COMMITMENTS-MATCH-006] confirmar el cargo sugerido dispara la misma detección que el vínculo manual', async () => {
    // Camino A: sugerencia confirmada.
    const a = setup();
    const subA = await streamly(a);
    const occA = a.mem.forDefinition(subA.definitionId)[0]!;
    const txA = a.mem.addTransaction({
      kind: 'EXPENSE',
      accountId: VISA_USD,
      amount: usd('11.20'),
      businessDate: '2026-11-15',
    });
    await a.matching.onTransactionChanged({ workspaceId: WS, transactionId: txA, eventId: null });
    const suggestion = a.mem.suggestionFor(occA.id, txA)!;
    expect(suggestion).toMatchObject({ status: 'PROPOSED', amountDelta: '0.21' });
    await a.matching.confirm({ workspaceId: WS, userId: USER, suggestionId: suggestion.id });
    await a.deliver();
    expect(a.mem.eventsOf('commitments.RecurringOccurrenceMaterialized')[0]?.payload).toMatchObject({
      managedBy: 'SUBSCRIPTION',
      mode: 'MATCHED',
      matchedBy: 'SUGGESTION',
      amount: usd('11.20'),
    });
    const chargeA = a.mem.chargesOf(subA.id)[0];
    expect(chargeA).toMatchObject({ outcome: 'PRICE_CHANGE_DETECTED', transactionId: txA });
    const proposalA = a.mem.proposalsOf(subA.id)[0];
    expect(proposalA).toMatchObject({ status: 'PENDING', effectiveFrom: '2026-11-15' });
    expect(a.mem.eventsOf('commitments.SubscriptionPriceChanged')).toHaveLength(1);

    // Camino B: el mismo cargo vinculado a mano produce la misma detección.
    const b = setup();
    const subB = await streamly(b);
    const occB = b.mem.forDefinition(subB.definitionId)[0]!;
    const txB = b.mem.addTransaction({
      kind: 'EXPENSE',
      accountId: VISA_USD,
      amount: usd('11.20'),
      businessDate: '2026-11-15',
    });
    await b.occs.link({ workspaceId: WS, userId: USER, occurrenceId: occB.id, transactionId: txB });
    await b.deliver();
    expect(b.mem.chargesOf(subB.id)[0]).toMatchObject({
      outcome: chargeA?.outcome,
      deviationPercent: chargeA?.deviationPercent,
    });
    expect(b.mem.proposalsOf(subB.id)[0]).toMatchObject({
      status: proposalA?.status,
      changePercent: proposalA?.changePercent,
    });
  });
});
