import { describe, expect, it } from 'vitest';
import { CommitmentsQueries } from './commitments.queries.js';
import { DefinitionsService, type CreateDefinitionCommand } from './definitions.service.js';
import { SubscriptionsQueries } from './subscriptions.queries.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { BANK, CATEGORY, USD_BANK, USER, VISA_USD, WS } from './testing/in-memory.js';
import { InMemorySubscriptions, STREAMLY, MUSICBOX } from './testing/in-memory-subscriptions.js';

const bob = (amount: string) => ({ amount, currency: 'BOB' });
const usd = (amount: string) => ({ amount, currency: 'USD' });
const noon = (date: string) => `${date}T16:00:00Z`;

function setup(now = '2026-11-05') {
  const mem = new InMemorySubscriptions();
  mem.setNow(noon(now));
  const deps = mem.subscriptionDeps();
  return {
    mem,
    defs: new DefinitionsService(deps),
    subs: new SubscriptionsService(deps),
    costs: new CommitmentsQueries(deps),
    history: new SubscriptionsQueries(deps),
  };
}
type S = ReturnType<typeof setup>;

const create = (
  s: S,
  name: string,
  amount: CreateDefinitionCommand['template']['amount'],
  over: Partial<CreateDefinitionCommand['template']> = {},
  kind = 'EXPENSE',
) =>
  s.defs.create({
    workspaceId: WS,
    userId: USER,
    name,
    kind,
    template: {
      accountId: BANK,
      amount,
      categoryId: CATEGORY,
      schedule: { cadence: 'MONTHLY', interval: 1, startDate: '2026-10-05' },
      materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
      ...over,
    },
  });

describe('RecurringCostQuery.listCosts (TC-REPORTING-REPORTS-045)', () => {
  it('[TC-REPORTING-REPORTS-045] lista streaming, seguro y gimnasio con su precio y renovaciones por año; sin la pausada', async () => {
    const s = setup();
    await create(s, 'Streaming', { type: 'FIXED', amount: bob('69.00') });
    await create(
      s,
      'Seguro',
      { type: 'FIXED', amount: bob('1200.00') },
      {
        schedule: { cadence: 'ANNUAL', interval: 1, startDate: '2026-10-05' },
      },
    );
    await create(s, 'Gimnasio', { type: 'FIXED', amount: usd('50.00') }, { accountId: USD_BANK });
    const paused = await create(s, 'Pausada', { type: 'FIXED', amount: bob('30.00') });
    await s.defs.pause({
      workspaceId: WS,
      userId: USER,
      definitionId: paused.id,
      expectedVersion: paused.version,
    });
    await create(s, 'Sueldo', { type: 'FIXED', amount: bob('9000.00') }, {}, 'INCOME');

    const rows = await s.costs.listCosts({ workspaceId: WS });
    expect(rows.map((r) => [r.name, r.currency, r.price, r.renewalsPerYear, r.variable])).toEqual([
      ['Gimnasio', 'USD', '50.00', '12', false],
      ['Seguro', 'BOB', '1200.00', '1', false],
      ['Streaming', 'BOB', '69.00', '12', false],
    ]);
  });

  it('[TC-REPORTING-REPORTS-045] un monto variable va sin precio y uno mínimo-máximo usa el máximo', async () => {
    const s = setup();
    await create(s, 'Luz', { type: 'VARIABLE' });
    await create(s, 'Agua', { type: 'MIN_MAX', min: bob('40.00'), max: bob('80.00') });
    const rows = await s.costs.listCosts({ workspaceId: WS });
    expect(rows.map((r) => [r.name, r.price, r.variable])).toEqual([
      ['Agua', '80.00', false],
      ['Luz', null, true],
    ]);
  });

  it('[TC-REPORTING-REPORTS-045] una cadencia con intervalo (cada 3 semanas) divide las renovaciones por año', async () => {
    const s = setup();
    await create(
      s,
      'Revista',
      { type: 'FIXED', amount: bob('10.00') },
      {
        schedule: { cadence: 'WEEKLY', interval: 4, startDate: '2026-10-05' },
      },
    );
    const [row] = await s.costs.listCosts({ workspaceId: WS });
    expect(row?.renewalsPerYear).toBe('13');
  });
});

describe('SubscriptionHistoryQuery.listEvents (TC-REPORTING-REPORTS-046)', () => {
  it('[TC-REPORTING-REPORTS-046] alta, aumento de precio y baja se informan con sus fechas y precios', async () => {
    const s = setup('2026-10-10');
    const music = await s.subs.create({
      workspaceId: WS,
      userId: USER,
      counterpartyId: MUSICBOX,
      name: 'Música',
      planName: null,
      price: usd('25.00'),
      billingCycle: { cadence: 'MONTHLY' },
      firstRenewalOn: '2026-07-01',
      paymentAccountId: VISA_USD,
      materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
    });
    const changed = await s.subs.changePrice({
      workspaceId: WS,
      userId: USER,
      subscriptionId: music.id,
      expectedVersion: music.version,
      price: usd('30.00'),
      effectiveFrom: '2026-09-01',
    });
    await s.subs.cancel({
      workspaceId: WS,
      userId: USER,
      subscriptionId: music.id,
      expectedVersion: changed.version,
    });
    await s.subs.create({
      workspaceId: WS,
      userId: USER,
      counterpartyId: STREAMLY,
      name: 'Streamly',
      planName: null,
      price: usd('10.99'),
      billingCycle: { cadence: 'MONTHLY' },
      firstRenewalOn: '2026-11-15',
      paymentAccountId: VISA_USD,
      materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
    });

    const events = await s.history.listEvents({ workspaceId: WS, from: '2026-07-01', to: '2026-12-31' });
    const music1 = events.filter((e) => e.name === 'Música');
    expect(
      music1.map((e) => [e.kind, e.date, e.previousPrice?.amount ?? null, e.newPrice?.amount ?? null]),
    ).toEqual([
      ['STARTED', '2026-07-01', null, '25.00'],
      ['PRICE_CHANGED', '2026-09-01', '25.00', '30.00'],
      ['CANCELLED', '2026-10-10', '30.00', null],
    ]);
    expect(events.every((e) => e.renewalsPerYear === '12')).toBe(true);
  });

  it('[TC-REPORTING-REPORTS-046] solo devuelve eventos con fecha hasta el cierre pedido', async () => {
    const s = setup('2026-10-10');
    await s.subs.create({
      workspaceId: WS,
      userId: USER,
      counterpartyId: STREAMLY,
      name: 'Streamly',
      planName: null,
      price: usd('10.99'),
      billingCycle: { cadence: 'MONTHLY' },
      firstRenewalOn: '2026-11-15',
      paymentAccountId: VISA_USD,
      materialization: { mode: 'PENDING_APPROVAL', leadDays: 3 },
    });
    expect(await s.history.listEvents({ workspaceId: WS, from: '2026-07-01', to: '2026-10-31' })).toEqual([]);
    expect(
      (await s.history.listEvents({ workspaceId: WS, from: '2026-07-01', to: '2026-11-30' })).length,
    ).toBe(1);
  });
});
