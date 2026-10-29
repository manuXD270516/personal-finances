import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CardActivityService, type CardActivityEvent } from './card-activity.handler.js';
import { CardsQueries } from './cards.queries.js';
import { CardsService } from './cards.service.js';
import { InstallmentsService } from './installments.service.js';
import { CardWorld } from './testing/card-world.js';

const WS = 'ws-1';
const USER = 'user-1';
const rule = { type: 'PERCENT', percent: '5.00', floor: '50.00' };

/** Dos tarjetas (BOB y USD) con compras que cruzan umbrales y una compra con plan de cuotas. */
async function scenario() {
  const world = new CardWorld('2026-10-20T14:00:00.000Z');
  world.addAccount('acct-bob', 'Visa Oro BOB', 'CREDIT_CARD', 'BOB');
  world.addAccount('acct-usd', 'Visa Oro USD', 'CREDIT_CARD', 'USD');
  world.addEntry({ accountId: 'acct-bob', date: '2026-10-01', cls: 'PURCHASE', amount: '1000.00' });
  world.addEntry({ accountId: 'acct-usd', date: '2026-10-01', cls: 'PURCHASE', amount: '100.00' });
  world.transactions.set('tx-laptop', {
    transactionId: 'tx-laptop',
    kind: 'EXPENSE',
    status: 'POSTED',
    businessDate: '2026-10-05',
    amount: { amount: '600.00', currency: 'BOB' },
    accountId: 'acct-bob',
    toAccountId: null,
    counterpartyId: null,
    source: 'MANUAL',
    externalRef: null,
    revision: 1,
  });
  world.addEntry({
    accountId: 'acct-bob',
    date: '2026-10-05',
    cls: 'PURCHASE',
    amount: '600.00',
    transactionId: 'tx-laptop',
  });
  const svc = new CardsService(world.deps);
  const bob = await svc.register({
    workspaceId: WS,
    userId: USER,
    name: 'Visa BOB',
    accounts: [{ accountId: 'acct-bob', creditLimit: { amount: '5000.00' }, minimumRule: rule }],
    statementDay: 25,
    dueDay: 15,
  });
  await svc.register({
    workspaceId: WS,
    userId: USER,
    name: 'Visa USD',
    accounts: [{ accountId: 'acct-usd', creditLimit: { amount: '1000.00' }, minimumRule: rule }],
    statementDay: 25,
    dueDay: 15,
  });
  await new InstallmentsService(world.deps).create({
    workspaceId: WS,
    userId: USER,
    cardId: bob.id,
    purchaseTransactionId: 'tx-laptop',
    installmentCount: 3,
  });
  return { world, bobId: bob.id, activity: new CardActivityService(world.deps) };
}

const event = (n: number, kind: 'posted-bob' | 'posted-usd' | 'void'): CardActivityEvent =>
  kind === 'void'
    ? {
        workspaceId: WS,
        eventType: 'transactions.TransactionVoided',
        eventId: `e-${String(n)}`,
        payload: { transactionId: 'tx-laptop', legs: [{ accountId: 'acct-bob' }] },
      }
    : {
        workspaceId: WS,
        eventType: 'ledger.JournalEntryPosted',
        eventId: `e-${String(n)}`,
        payload: { postings: [{ accountId: kind === 'posted-bob' ? 'acct-bob' : 'acct-usd' }] },
      };

async function snapshot(
  kinds: readonly ('posted-bob' | 'posted-usd' | 'void')[],
  grouped: boolean,
  extra: number,
) {
  const { world, bobId, activity } = await scenario();
  // Gastos adicionales ya confirmados cuando corre el consumidor (cruzan 30 % y 80 % del límite de BOB y USD).
  if (extra > 0) {
    world.addEntry({
      accountId: 'acct-bob',
      date: '2026-10-20',
      cls: 'PURCHASE',
      amount: `${String(extra)}.00`,
    });
    world.addEntry({
      accountId: 'acct-usd',
      date: '2026-10-20',
      cls: 'PURCHASE',
      amount: (extra / 10).toFixed(2),
    });
  }
  const events = kinds.map((k, i) => event(i, k));
  if (grouped) await activity.onEvents(WS, events);
  else for (const e of events) await activity.onEvent(e);
  const plans = await new CardsQueries(world.deps).listInstallmentPlans(WS, bobId);
  const thresholds = world.outbox
    .filter((e) => e.eventType === 'debt.CreditUtilizationThresholdReached')
    .map((e) => JSON.stringify({ ...(e.payload as object), cardId: undefined }))
    .sort();
  return { plans: plans.map((p) => [p.status, p.cancelReason ?? null]), thresholds };
}

describe('debt.card-activity: entrega agrupada (optimize-consumer-throughput)', () => {
  it('[TC-PLATFORM-THROUGHPUT-007] los mismos eventos entregados de a uno o agrupados dejan los mismos planes de cuotas y los mismos hechos de umbral', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.constantFrom('posted-bob', 'posted-usd', 'void'), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 3000 }),
        async (kinds, extra) => {
          expect(await snapshot(kinds, true, extra)).toEqual(await snapshot(kinds, false, extra));
        },
      ),
      { numRuns: 30 },
    );
  }, 120_000);

  it('[TC-PLATFORM-THROUGHPUT-001] un grupo de eventos de la misma tarjeta la sincroniza una sola vez', async () => {
    const { world, activity } = await scenario();
    world.addEntry({ accountId: 'acct-bob', date: '2026-10-20', cls: 'PURCHASE', amount: '3000.00' });
    await activity.onEvents(
      WS,
      Array.from({ length: 20 }, (_, i) => event(i, 'posted-bob')),
    );
    const reached = world.outbox.filter((e) => e.eventType === 'debt.CreditUtilizationThresholdReached');
    expect(reached.length).toBeGreaterThan(0);
    expect(reached.length).toBeLessThanOrEqual(1);
  });
});
