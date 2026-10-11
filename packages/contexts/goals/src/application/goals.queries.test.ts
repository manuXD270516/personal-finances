import { dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { BANK, EDITOR, SAVINGS, USD_CASH, WS, GoalsWorld, codeOf } from './testing/goals-world.js';

const bob = (amount: string) => ({ amount, currency: 'BOB' });
const usd = (amount: string) => ({ amount, currency: 'USD' });

describe('Simulación (TC-GOALS-SAVINGS-035)', () => {
  /** Fondo de emergencia con 5000.00 BOB y ritmo de 1200.00 BOB (historia 1200 / 900 / 1500 de jul-sep). */
  async function withPace() {
    const w = new GoalsWorld('2026-10-10T16:00:00.000Z');
    const fund = await w.emergencyFund({ startDate: '2026-07-01' });
    const seed = (amount: string, occurredOn: string) =>
      w.seedMovement({ goalId: fund.id, fund: 'REAL', amount, accountId: SAVINGS, occurredOn });
    seed('1200.00', '2026-07-15');
    seed('900.00', '2026-08-15');
    seed('1500.00', '2026-09-15');
    seed('1400.00', '2026-10-05');
    return { w, fund, seed };
  }

  it('[TC-GOALS-SAVINGS-035] devuelve requerido y fecha esperada con otros valores sin persistir ni auditar', async () => {
    const { w, fund, seed } = await withPace();
    const base = await w.queries.get(WS, fund.id);
    expect(base.progress.total).toEqual(bob('5000.00'));
    expect(base.pace).toMatchObject({
      amount: bob('1200.00'),
      periods: 3,
      source: 'HISTORY',
      complete: true,
    });
    expect(base.expectedDate).toEqual({ date: '2027-06-30', reason: null });
    const before = {
      state: w.goalState(fund.id),
      trail: w.trail.length,
      events: w.events.length,
      movements: w.movementStore.length,
    };

    const monthly = await w.queries.simulate(WS, fund.id, { monthlyContribution: bob('2000.00') });
    expect(monthly.expectedDate).toEqual({ date: '2027-02-28', reason: null });
    expect(monthly.requiredMonthly).toEqual(bob('1666.67'));
    expect(monthly.pace).toMatchObject({ amount: bob('2000.00'), source: 'SIMULATED' });

    const later = await w.queries.simulate(WS, fund.id, { targetDate: '2027-06-30' });
    expect(later.requiredMonthly).toEqual(bob('1111.11'));
    expect(later.periods).toBe(9);

    seed('3000.00', '2026-10-06');
    const bigger = await w.queries.simulate(WS, fund.id, { targetAmount: bob('12000.00') });
    expect(bigger.progress.total).toEqual(bob('8000.00'));
    expect(bigger.requiredMonthly).toEqual(bob('666.67'));
    expect(bigger.expectedDate).toEqual({ date: '2027-01-31', reason: null });

    expect({
      state: w.goalState(fund.id),
      trail: w.trail.length,
      events: w.events.length,
      movements: w.movementStore.length,
    }).toEqual({ ...before, movements: before.movements + 1 });
  });

  it('[TC-GOALS-SAVINGS-035] una simulación en otra moneda o con fecha anterior al inicio se rechaza', async () => {
    const { w, fund } = await withPace();
    expect(await codeOf(() => w.queries.simulate(WS, fund.id, { monthlyContribution: usd('100.00') }))).toBe(
      'CURRENCY_MISMATCH',
    );
    expect(await codeOf(() => w.queries.simulate(WS, fund.id, { targetDate: '2026-07-01' }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(await codeOf(() => w.queries.simulate(WS, fund.id, { targetAmount: bob('0.00') }))).toBe(
      'AMOUNT_NOT_POSITIVE',
    );
    expect(await codeOf(() => w.queries.simulate(WS, 'desconocida', {}))).toBe('RESOURCE_NOT_FOUND');
  });
});

describe('Meta en otra moneda (TC-GOALS-SAVINGS-036)', () => {
  /** "Viaje a Cusco" de 2000.00 USD con 300.00 USD reales en "Caja USD" y 7500.00 BOB reservados en "Banco BOB". */
  async function cusco() {
    const w = new GoalsWorld('2026-10-15T14:00:00.000Z');
    const trip = await w.createGoal({
      name: 'Viaje a Cusco',
      target: usd('2000.00'),
      startDate: '2026-09-01',
      linkedAccountIds: [USD_CASH],
    });
    w.setBalance(BANK, '20000.00');
    w.seedMovement({
      goalId: trip.id,
      fund: 'REAL',
      amount: '300.00',
      accountId: USD_CASH,
      occurredOn: '2026-10-02',
    });
    await w.earmark(trip.id, BANK, '1250.00', { businessDate: '2026-09-10' });
    await w.earmark(trip.id, BANK, '6250.00', { businessDate: '2026-10-03' });
    const parallel = {
      rateType: 'PARALLEL' as const,
      sourceLabel: 'paralelo.bo',
      attributionText: 'Fuente: paralelo.bo',
    };
    w.setRate('USD', 'BOB', '12.50', { ...parallel, asOf: '2026-09-10T12:00:00.000Z' });
    w.setRate('USD', 'BOB', '12.50', { ...parallel, asOf: '2026-10-15T12:00:00.000Z' });
    return { w, trip };
  }

  it('[TC-GOALS-SAVINGS-036] convierte con la tasa vigente informada: 900.00 USD (45.00 %), con fuente y fecha', async () => {
    const { w, trip } = await cusco();
    const view = await w.queries.get(WS, trip.id);

    expect(view.progress.total).toEqual(usd('900.00'));
    expect(view.progress.percent).toBe('45.00');
    expect(view.progress.complete).toBe(true);
    expect(view.progress.unconverted).toEqual([]);
    expect(view.progress.byCurrency).toEqual([bob('7500.00'), usd('300.00')]);
    expect(view.meta.rateWindowDays).toBe(7);
    expect(view.meta.ratesUsed.length).toBeGreaterThan(0);
    for (const rate of view.meta.ratesUsed) {
      expect(rate.attribution?.text).toBe('Fuente: paralelo.bo');
      expect(rate.rateType).toBe('PARALLEL');
      expect(rate.components).toEqual([{ base: 'USD', quote: 'BOB', value: '12.50' }]);
    }
    expect(view.meta.ratesUsed.map((r) => r.asOf).sort()).toEqual([
      '2026-09-10T12:00:00.000Z',
      '2026-10-15T12:00:00.000Z',
    ]);
  });

  it('[TC-GOALS-SAVINGS-036] sin tasa dentro de la ventana el total queda en 300.00 USD, incompleto y nunca a 1:1', async () => {
    const { w, trip } = await cusco();
    w.clearRates();
    // Una tasa más vieja que la ventana de vigencia (7 días) tampoco cuenta.
    w.setRate('USD', 'BOB', '12.50', { asOf: '2026-10-01T12:00:00.000Z' });

    const view = await w.queries.get(WS, trip.id);

    expect(view.progress.total).toEqual(usd('300.00'));
    expect(view.progress.percent).toBe('15.00');
    expect(view.progress.complete).toBe(false);
    expect(view.progress.unconverted).toEqual([bob('7500.00')]);
    expect(view.meta.ratesUsed).toEqual([]);
    const home = await w.queries.listForHome({ workspaceId: WS, limit: 3 });
    expect(home.items[0]).toMatchObject({ progress: usd('300.00'), complete: false });
  });

  it('[TC-GOALS-SAVINGS-036] el ritmo valora cada reserva con la tasa de su fecha: 100.00 USD en 2026-09', async () => {
    const { w, trip } = await cusco();

    const view = await w.queries.get(WS, trip.id);

    expect(view.pace).toMatchObject({ amount: usd('100.00'), periods: 1, source: 'HISTORY', complete: true });
    // La reserva de septiembre se valora a la tasa de ese día, no a la de hoy.
    w.clearRates();
    w.setRate('USD', 'BOB', '12.50', { asOf: '2026-10-15T12:00:00.000Z' });
    w.setRate('USD', 'BOB', '10.00', { asOf: '2026-09-10T12:00:00.000Z' });
    const other = await w.queries.get(WS, trip.id);
    expect(other.pace.amount).toEqual(usd('125.00'));
    expect(other.progress.total).toEqual(usd('900.00'));

    // Sin tasa para esa fecha el ritmo queda incompleto.
    w.clearRates();
    w.setRate('USD', 'BOB', '12.50', { asOf: '2026-10-15T12:00:00.000Z' });
    const incomplete = await w.queries.get(WS, trip.id);
    expect(incomplete.pace.complete).toBe(false);
  });
});

describe('Aporte planificado del periodo (TC-GOALS-SAVINGS-038, -050)', () => {
  const plan = (w: GoalsWorld, goalId: string, amount: string, currency = 'BOB') =>
    w.plans.set({
      workspaceId: WS,
      userId: EDITOR,
      goalId,
      expectedVersion: w.versionOf(goalId),
      monthlyAmount: { amount, currency },
      fund: 'REAL',
      automation: 'NONE',
    });
  const october = { workspaceId: WS, from: '2026-10-01', to: '2026-10-31' };

  it('[TC-GOALS-SAVINGS-038] el pendiente es planificado menos aportado y nunca negativo (exceso informado aparte)', async () => {
    const w = new GoalsWorld('2026-10-15T14:00:00.000Z');
    w.setBalance(BANK, '20000.00');
    const fund = await w.emergencyFund();
    await plan(w, fund.id, '1500.00');
    await w.contribute(fund.id, '1000.00', { businessDate: '2026-10-05' });

    const [first] = await w.queries.getForPeriod(october);
    expect(first).toEqual({
      goalId: fund.id,
      goalName: 'Fondo de emergencia',
      currency: 'BOB',
      planned: '1500.00',
      contributed: '1000.00',
      pending: '500.00',
      exceededBy: '0.00',
      automation: 'NONE',
      definitionId: null,
      complete: true,
    });

    await w.contribute(fund.id, '800.00', { businessDate: '2026-10-12' });
    const [second] = await w.queries.getForPeriod(october);
    expect(second).toMatchObject({ contributed: '1800.00', pending: '0.00', exceededBy: '300.00' });
    // Fuera del rango no hay aportes: queda todo pendiente.
    const [nextMonth] = await w.queries.getForPeriod({
      workspaceId: WS,
      from: '2026-11-01',
      to: '2026-11-30',
    });
    expect(nextMonth).toMatchObject({ contributed: '0.00', pending: '1500.00' });
  });

  it('[TC-GOALS-SAVINGS-050] solo cuentan metas ACTIVE con plan; pausar una la quita del total y las reasignaciones no son aporte', async () => {
    const w = new GoalsWorld('2026-10-15T14:00:00.000Z');
    w.setBalance(BANK, '20000.00');
    const fund = await w.emergencyFund();
    const laptop = await w.laptop();
    const other = await w.createGoal({ name: 'Sin plan' });
    await plan(w, fund.id, '1500.00');
    await plan(w, laptop.id, '800.00');
    await w.contribute(fund.id, '1000.00', { businessDate: '2026-10-05' });
    await w.earmark(other.id, BANK, '400.00');

    const totals = async () => {
      const rows = await w.queries.getForPeriod(october);
      return {
        pending: rows.map((r) => r.pending),
        total: rows.reduce((acc, r) => acc.plus(r.pending), dec('0')).toFixed(2),
      };
    };
    expect(await totals()).toEqual({ pending: ['500.00', '800.00'], total: '1300.00' });

    // Una reasignación hacia la meta planificada no es un aporte del periodo.
    await w.movements.reassign({
      workspaceId: WS,
      userId: EDITOR,
      goalId: other.id,
      targetGoalId: laptop.id,
      fund: 'EARMARK',
      accountId: BANK,
      amount: bob('400.00'),
    });
    expect((await totals()).total).toBe('1300.00');

    await w.service.pause({
      workspaceId: WS,
      userId: EDITOR,
      goalId: laptop.id,
      expectedVersion: w.versionOf(laptop.id),
    });
    expect(await totals()).toEqual({ pending: ['500.00'], total: '500.00' });
  });

  it('[TC-GOALS-SAVINGS-038] una meta en USD valora los aportes en BOB con la tasa de su fecha y marca incompleto si falta', async () => {
    const w = new GoalsWorld('2026-10-15T14:00:00.000Z');
    w.setBalance(BANK, '20000.00');
    const trip = await w.createGoal({ name: 'Viaje a Cusco', target: usd('2000.00') });
    await plan(w, trip.id, '300.00', 'USD');
    await w.earmark(trip.id, BANK, '1250.00', { businessDate: '2026-10-05' });
    w.setRate('USD', 'BOB', '12.50', { asOf: '2026-10-05T12:00:00.000Z' });

    const [valued] = await w.queries.getForPeriod(october);
    expect(valued).toMatchObject({
      currency: 'USD',
      contributed: '100.00',
      pending: '200.00',
      complete: true,
    });

    w.clearRates();
    const [missing] = await w.queries.getForPeriod(october);
    expect(missing).toMatchObject({ contributed: '0.00', pending: '300.00', complete: false });
  });
});

describe('Home y flujos (TC-GOALS-SAVINGS-046, -048)', () => {
  it('[TC-GOALS-SAVINGS-046] muestra hasta 3 metas por prioridad, fecha objetivo y nombre, con moreCount y sobre-asignación', async () => {
    const w = new GoalsWorld('2027-01-15T14:00:00.000Z');
    const fund = await w.emergencyFund();
    const trip = await w.createGoal({
      name: 'Viaje a Cusco',
      target: usd('2000.00'),
      startDate: '2026-10-01',
      targetDate: '2027-06-30',
      linkedAccountIds: [USD_CASH],
      priority: 2,
    });
    const laptop = await w.laptop({ priority: 2 });
    await w.createGoal({ name: 'Auto', target: bob('3000.00'), priority: 3 });
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '5000.00', accountId: SAVINGS });
    w.seedMovement({ goalId: trip.id, fund: 'REAL', amount: '900.00', accountId: USD_CASH });
    w.setBalance(BANK, '7000.00');
    await w.earmark(laptop.id, BANK, '2000.00');
    w.setBalance(BANK, '1500.00');
    await w.reactions.onJournalEntryPosted(w.journalPostedEvent([BANK]));

    const home = await w.queries.listForHome({ workspaceId: WS, limit: 3 });

    expect(home.items.map((i) => i.name)).toEqual(['Fondo de emergencia', 'Viaje a Cusco', 'Laptop']);
    expect([home.moreCount, home.goalCount]).toEqual([1, 4]);
    expect(home.items[0]).toMatchObject({
      goalId: fund.id,
      priority: 1,
      percent: '33.33',
      progress: bob('5000.00'),
      target: bob('15000.00'),
      lifecycleStatus: 'ACTIVE',
      tracking: { status: 'BEHIND' },
      requiredMonthly: bob('3333.33'),
      overdue: false,
      overAllocated: false,
      complete: true,
    });
    expect(home.items[1]).toMatchObject({ percent: '45.00', progress: usd('900.00'), overAllocated: false });
    expect(home.items[2]).toMatchObject({ percent: '22.22', overAllocated: true, requiredMonthly: null });
    expect(home.ratesUsed).toEqual([]);

    expect(await w.queries.listForHome({ workspaceId: WS, limit: 0 })).toMatchObject({
      items: [],
      moreCount: 4,
      goalCount: 4,
    });
  });

  it('[TC-GOALS-SAVINGS-046] sin metas vivas el resumen es vacío y las canceladas o archivadas no cuentan', async () => {
    const w = new GoalsWorld();
    expect(await w.queries.listForHome({ workspaceId: WS, limit: 3 })).toEqual({
      items: [],
      moreCount: 0,
      goalCount: 0,
      ratesUsed: [],
    });
    const done = await w.laptop();
    await w.service.cancel({
      workspaceId: WS,
      userId: EDITOR,
      goalId: done.id,
      expectedVersion: done.version,
    });
    expect((await w.queries.listForHome({ workspaceId: WS, limit: 3 })).goalCount).toBe(0);
  });

  it('[TC-GOALS-SAVINGS-046] a igual prioridad y fecha el orden es por nombre y las metas sin fecha van al final', async () => {
    const w = new GoalsWorld('2026-10-15T14:00:00.000Z');
    await w.createGoal({ name: 'Zeta', priority: 2 });
    await w.createGoal({ name: 'Beta', priority: 2 });
    await w.createGoal({ name: 'Alfa', priority: 2, targetDate: '2027-12-31' });
    await w.createGoal({ name: 'Cima', priority: 1 });
    const names = (await w.queries.list(WS)).data.map((g) => g.name);
    expect(names).toEqual(['Cima', 'Alfa', 'Beta', 'Zeta']);
    expect((await w.queries.list(WS, { type: 'PURCHASE' })).data).toEqual([]);
    expect((await w.queries.list(WS, { type: 'CUSTOM' })).data).toHaveLength(4);
  });

  it('[TC-GOALS-SAVINGS-048] el neto de aportes del mes es 1000 + 2000 − 500 = 2500.00 y excluye las reasignaciones', async () => {
    const w = new GoalsWorld('2026-10-15T14:00:00.000Z');
    w.setBalance(BANK, '20000.00');
    const fund = await w.emergencyFund();
    const laptop = await w.laptop();
    await w.contribute(fund.id, '1000.00', { businessDate: '2026-10-05' });
    await w.earmark(laptop.id, BANK, '2000.00', { businessDate: '2026-10-10' });
    await w.release(laptop.id, BANK, '500.00');
    await w.movements.reassign({
      workspaceId: WS,
      userId: EDITOR,
      goalId: laptop.id,
      targetGoalId: fund.id,
      fund: 'EARMARK',
      accountId: BANK,
      amount: bob('1000.00'),
    });

    const flows = await w.queries.netForRange({ workspaceId: WS, from: '2026-10-01', to: '2026-10-31' });

    expect(flows).toEqual([
      { date: '2026-10-05', amount: bob('1000.00') },
      { date: '2026-10-10', amount: bob('2000.00') },
      { date: '2026-10-15', amount: bob('-500.00') },
    ]);
    expect(await w.queries.netForRange({ workspaceId: WS, from: '2026-11-01', to: '2026-11-30' })).toEqual(
      [],
    );
    expect(await codeOf(() => w.queries.netForRange({ workspaceId: WS, from: 'x', to: '2026-11-30' }))).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('Lecturas de una meta', () => {
  it('lista los movimientos de más reciente a más antiguo con cursor y límite', async () => {
    const w = new GoalsWorld('2026-10-15T14:00:00.000Z');
    const fund = await w.emergencyFund();
    for (const day of ['01', '02', '03', '04', '05']) {
      w.seedMovement({
        goalId: fund.id,
        fund: 'REAL',
        amount: '10.00',
        accountId: SAVINGS,
        occurredOn: `2026-10-${day}`,
      });
    }
    const first = await w.queries.movements(WS, fund.id, { limit: 2 });
    expect(first.data.map((m) => m.occurredOn)).toEqual(['2026-10-05', '2026-10-04']);
    expect(first.page).toMatchObject({ limit: 2, hasMore: true });
    expect(first.page.nextCursor).not.toBeNull();
    const second = await w.queries.movements(WS, fund.id, {
      limit: 2,
      cursor: first.page.nextCursor as string,
    });
    expect(second.data.map((m) => m.occurredOn)).toEqual(['2026-10-03', '2026-10-02']);
    const last = await w.queries.movements(WS, fund.id, {
      limit: 2,
      cursor: second.page.nextCursor as string,
    });
    expect(last.data.map((m) => m.occurredOn)).toEqual(['2026-10-01']);
    expect(last.page).toEqual({ limit: 2, hasMore: false, nextCursor: null });
    const ranged = await w.queries.movements(WS, fund.id, { from: '2026-10-02', to: '2026-10-03' });
    expect(ranged.data).toHaveLength(2);
    expect(await codeOf(() => w.queries.movements(WS, fund.id, { cursor: 'no-es-un-cursor' }))).toBe(
      'INVALID_CURSOR',
    );
    expect(await codeOf(() => w.queries.movements(WS, 'desconocida'))).toBe('RESOURCE_NOT_FOUND');
    expect(await codeOf(() => w.queries.get(WS, 'desconocida'))).toBe('RESOURCE_NOT_FOUND');
  });
});
