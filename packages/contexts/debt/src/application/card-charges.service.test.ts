import { DomainError, dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { CardChargesService } from './card-charges.service.js';
import { CardDailyService } from './card-daily.runner.js';
import { CardsQueries } from './cards.queries.js';
import { CardsService, type RegisterCardCommand } from './cards.service.js';
import { CardWorld } from './testing/card-world.js';

const WS = 'ws-1';
const USER = 'user-1';
const rule = (floor: string) => ({ type: 'PERCENT', percent: '5.00', floor });

const codeOf = async (fn: () => Promise<unknown>): Promise<string> => {
  try {
    await fn();
    return 'ok';
  } catch (err) {
    return err instanceof DomainError ? err.code : `other:${String(err)}`;
  }
};

function setup(now = '2026-09-20T14:00:00.000Z') {
  const world = new CardWorld(now);
  world.addAccount('acct-bob', 'Visa Oro BOB', 'CREDIT_CARD', 'BOB');
  world.addAccount('acct-usd', 'Visa Oro USD', 'CREDIT_CARD', 'USD');
  world.addAccount('bank', 'Banco BOB', 'BANK', 'BOB');
  return {
    world,
    svc: new CardsService(world.deps),
    queries: new CardsQueries(world.deps),
    daily: new CardDailyService(world.deps),
    charges: new CardChargesService(world.deps),
  };
}

const registerVisa = (): RegisterCardCommand => ({
  workspaceId: WS,
  userId: USER,
  name: 'Visa Oro',
  accounts: [
    { accountId: 'acct-bob', creditLimit: { amount: '10000.00' }, minimumRule: rule('50.00') },
    { accountId: 'acct-usd', creditLimit: { amount: '2000.00' }, minimumRule: rule('10.00') },
  ],
  statementDay: 25,
  dueDay: 15,
});

/** Ciclo de octubre de Visa Oro BOB (TC-DEBT-CARD-009): compras 1170.50 y saldo al cierre 1120.50. */
function octoberHistory(world: CardWorld) {
  world.addEntry({ accountId: 'acct-bob', date: '2026-09-01', cls: 'OTHER', amount: '1200.00' });
  world.addEntry({ accountId: 'acct-bob', date: '2026-10-03', cls: 'PURCHASE', amount: '350.00' });
  world.addEntry({ accountId: 'acct-bob', date: '2026-10-10', cls: 'PAYMENT', amount: '-1200.00' });
  world.addEntry({ accountId: 'acct-bob', date: '2026-10-18', cls: 'PURCHASE', amount: '820.50' });
  world.addEntry({ accountId: 'acct-bob', date: '2026-10-20', cls: 'REFUND', amount: '-50.00' });
}

/** Tarjeta registrada con el ciclo de octubre emitido y una compra posterior de 400.00 (deuda 1520.50). */
async function issuedOctober() {
  const ctx = setup();
  octoberHistory(ctx.world);
  const { id } = await ctx.svc.register(registerVisa());
  ctx.world.setNow('2026-10-26T14:00:00.000Z');
  await ctx.daily.runWorkspace(WS);
  ctx.world.addEntry({ accountId: 'acct-bob', date: '2026-10-26', cls: 'PURCHASE', amount: '400.00' });
  ctx.world.setNow('2026-10-28T16:00:00.000Z');
  const statement = ctx.world.statementStore.find((s) => s.closingDate === '2026-10-25')!;
  return { ...ctx, cardId: id, statement };
}

const interestAndInsurance = (cardId: string, over: Record<string, unknown> = {}) => ({
  workspaceId: WS,
  userId: USER,
  cardId,
  accountId: 'acct-bob',
  businessDate: '2026-10-25',
  interest: '4.00',
  insurance: '0.80',
  ...over,
});

const balance = (world: CardWorld, accountId = 'acct-bob'): number =>
  world.entries
    .filter((e) => e.accountId === accountId)
    .concat(world.openings.map((o) => ({ ...o, cls: 'OTHER' as const })))
    .reduce((acc, e) => acc.plus(e.amount), dec('0'))
    .toNumber();

describe('CardChargesService.record (add-card-interest-ledger-portions)', () => {
  it('[TC-DEBT-CARD-043] registra 4.00 de interés y 0.80 de seguro: la deuda sube a 1525.30 y las compras del ciclo a 1175.30', async () => {
    const { world, charges, queries, cardId, statement } = await issuedOctober();
    expect(balance(world)).toBe(1520.5);
    const before = await queries.getStatement(WS, cardId, statement.id);
    expect(before.current.purchases.amount).toBe('1170.50');
    const view = await charges.record(interestAndInsurance(cardId));
    expect(view).toMatchObject({
      accountId: 'acct-bob',
      businessDate: '2026-10-25',
      origin: 'RECORDED',
      status: 'ACTIVE',
      total: { amount: '4.80', currency: 'BOB' },
      interest: { amount: '4.00', currency: 'BOB' },
      insurance: { amount: '0.80', currency: 'BOB' },
      fees: { amount: '0.00', currency: 'BOB' },
    });
    expect(balance(world)).toBe(1525.3);
    const after = await queries.getStatement(WS, cardId, statement.id);
    expect(after.current.purchases.amount).toBe('1175.30');
  });

  it('[TC-DEBT-CARD-044] un cargo de 1.25 USD en la cuenta USD aumenta su deuda en 1.25', async () => {
    const { world, charges, cardId } = await issuedOctober();
    const view = await charges.record({
      workspaceId: WS,
      userId: USER,
      cardId,
      accountId: 'acct-usd',
      businessDate: '2026-10-25',
      interest: '1.25',
    });
    expect(view.total).toEqual({ amount: '1.25', currency: 'USD' });
    expect(balance(world, 'acct-usd')).toBe(1.25);
  });

  it('[TC-DEBT-CARD-045] sin componentes positivos, con fecha futura o de otra cuenta se rechaza sin crear nada', async () => {
    const { world, charges, cardId } = await issuedOctober();
    const entries = world.entries.length;
    expect(
      await codeOf(() =>
        charges.record(interestAndInsurance(cardId, { interest: '0.00', insurance: '0.00' })),
      ),
    ).toBe('CARD_CHARGE_INVALID');
    expect(
      await codeOf(() => charges.record(interestAndInsurance(cardId, { businessDate: '2026-10-30' }))),
    ).toBe('CARD_CHARGE_INVALID');
    expect(await codeOf(() => charges.record(interestAndInsurance(cardId, { accountId: 'bank' })))).toBe(
      'CARD_CHARGE_INVALID',
    );
    expect(await codeOf(() => charges.record(interestAndInsurance(cardId, { fees: '-1.00' })))).toBe(
      'AMOUNT_NOT_POSITIVE',
    );
    expect(world.entries).toHaveLength(entries);
    expect(world.chargeStore.size).toBe(0);
  });

  it('[TC-DEBT-CARD-045] una tarjeta archivada rechaza el cargo', async () => {
    const { svc, charges, cardId, world } = await issuedOctober();
    await svc.archive({
      workspaceId: WS,
      userId: USER,
      cardId,
      expectedVersion: world.cardStore.get(cardId)!.version,
    });
    expect(await codeOf(() => charges.record(interestAndInsurance(cardId)))).toBe('CARD_CHARGE_INVALID');
    expect(world.chargeStore.size).toBe(0);
  });

  it('[TC-DEBT-CARD-046] 1.255 USD de interés ⇒ AMOUNT_SCALE_EXCEEDED', async () => {
    const { charges, cardId } = await issuedOctober();
    expect(
      await codeOf(() =>
        charges.record({
          workspaceId: WS,
          userId: USER,
          cardId,
          accountId: 'acct-usd',
          businessDate: '2026-10-25',
          interest: '1.255',
        }),
      ),
    ).toBe('AMOUNT_SCALE_EXCEEDED');
  });

  it('la fecha por omisión es el cierre del último estado de cuenta emitido; sin ninguno se exige la fecha', async () => {
    const { charges, cardId } = await issuedOctober();
    const view = await charges.record({
      workspaceId: WS,
      userId: USER,
      cardId,
      accountId: 'acct-bob',
      interest: '4.80',
    });
    expect(view.businessDate).toBe('2026-10-25');
    const fresh = setup();
    const { id } = await fresh.svc.register(registerVisa());
    expect(
      await codeOf(() =>
        fresh.charges.record({
          workspaceId: WS,
          userId: USER,
          cardId: id,
          accountId: 'acct-bob',
          interest: '1.00',
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-DEBT-CARD-054] audita el registro con el actor y los componentes en la misma unidad de trabajo', async () => {
    const { world, charges, cardId } = await issuedOctober();
    await charges.record(interestAndInsurance(cardId));
    const entry = world.audit.find((a) => a.action === 'debt.card_charge.recorded');
    expect(entry).toBeDefined();
    const fields = new Map(entry!.changes.map((c) => [c.field, c.after]));
    expect(fields.get('interest')).toEqual({ amount: '4.00', currency: 'BOB' });
    expect(fields.get('insurance')).toEqual({ amount: '0.80', currency: 'BOB' });
    expect(fields.get('origin')).toBe('RECORDED');
  });
});

describe('estado de cuenta con cargos', () => {
  it('[TC-DEBT-CARD-047] lista el cargo del ciclo y la diferencia con el banco queda en 0.00', async () => {
    const { world, svc, charges, queries, cardId, statement } = await issuedOctober();
    await svc.recordReported({
      workspaceId: WS,
      userId: USER,
      cardId,
      statementId: statement.id,
      expectedVersion: statement.version,
      reportedBilledBalance: { amount: '1125.30', currency: 'BOB' },
    });
    const pending = await queries.getStatement(WS, cardId, statement.id);
    expect(pending.reportedDifference?.amount).toBe('4.80');
    expect(pending.charges).toEqual([]);
    await charges.record(interestAndInsurance(cardId));
    const view = await queries.getStatement(WS, cardId, statement.id);
    expect(view.charges).toHaveLength(1);
    expect(view.charges?.[0]?.total.amount).toBe('4.80');
    expect(view.current.billedBalance.amount).toBe('1125.30');
    expect(view.difference?.billedBalance.amount).toBe('4.80');
    expect(view.reportedDifference?.amount).toBe('0.00');
    expect(world.chargeStore.size).toBe(1);
  });

  it('[TC-DEBT-CARD-048] propone registrar la diferencia de 4.80 sin crear asientos; sin diferencia positiva no propone', async () => {
    const { world, svc, queries, cardId, statement } = await issuedOctober();
    expect((await queries.getStatement(WS, cardId, statement.id)).chargeProposal).toBeNull();
    const entries = world.entries.length;
    await svc.recordReported({
      workspaceId: WS,
      userId: USER,
      cardId,
      statementId: statement.id,
      expectedVersion: statement.version,
      reportedBilledBalance: { amount: '1125.30', currency: 'BOB' },
    });
    const view = await queries.getStatement(WS, cardId, statement.id);
    expect(view.chargeProposal).toEqual({
      businessDate: '2026-10-25',
      total: { amount: '4.80', currency: 'BOB' },
    });
    expect(world.entries).toHaveLength(entries);
    expect(world.chargeStore.size).toBe(0);
    const updated = world.statementStore.find((s) => s.id === statement.id)!;
    await svc.recordReported({
      workspaceId: WS,
      userId: USER,
      cardId,
      statementId: statement.id,
      expectedVersion: updated.version,
      reportedBilledBalance: { amount: '1100.00', currency: 'BOB' },
    });
    expect((await queries.getStatement(WS, cardId, statement.id)).chargeProposal).toBeNull();
  });

  it('un cargo de otra fecha no aparece en el ciclo y la lista pagina los cargos', async () => {
    const { charges, queries, cardId, statement } = await issuedOctober();
    await charges.record(interestAndInsurance(cardId));
    await charges.record(
      interestAndInsurance(cardId, { businessDate: '2026-10-27', interest: '1.00', insurance: '0' }),
    );
    const view = await queries.getStatement(WS, cardId, statement.id);
    expect(view.charges?.map((c) => c.businessDate)).toEqual(['2026-10-25']);
    const list = await queries.listCharges(WS, cardId, { status: 'ACTIVE' });
    expect(list.items.map((c) => c.businessDate)).toEqual(['2026-10-27', '2026-10-25']);
    expect(list.nextCursor).toBeNull();
  });
});

describe('CardChargesService.void', () => {
  it('[TC-DEBT-CARD-049] anular revierte la deuda a 1520.50 y las compras del ciclo vuelven a 1170.50; repetirlo es idempotente', async () => {
    const { world, charges, queries, cardId, statement } = await issuedOctober();
    const charge = await charges.record(interestAndInsurance(cardId));
    const voided = await charges.void({
      workspaceId: WS,
      userId: USER,
      cardId,
      chargeId: charge.id,
      expectedVersion: charge.version,
      reason: 'monto equivocado',
    });
    expect(voided).toMatchObject({ status: 'VOIDED', voidReason: 'monto equivocado', version: 2 });
    expect(balance(world)).toBe(1520.5);
    const view = await queries.getStatement(WS, cardId, statement.id);
    expect(view.current.purchases.amount).toBe('1170.50');
    expect(view.charges).toEqual([]);
    const again = await charges.void({
      workspaceId: WS,
      userId: USER,
      cardId,
      chargeId: charge.id,
      expectedVersion: 99,
      reason: 'otra vez',
    });
    expect(again.version).toBe(2);
    expect(world.audit.filter((a) => a.action === 'debt.card_charge.voided')).toHaveLength(1);
  });

  it('[TC-DEBT-CARD-050] anular un cargo de un mes cerrado ⇒ PERIOD_CLOSED y el cargo sigue vigente', async () => {
    const { world, charges, cardId } = await issuedOctober();
    const charge = await charges.record(interestAndInsurance(cardId));
    world.closedMonths.add('2026-10');
    expect(
      await codeOf(() =>
        charges.void({
          workspaceId: WS,
          userId: USER,
          cardId,
          chargeId: charge.id,
          expectedVersion: charge.version,
          reason: 'x',
        }),
      ),
    ).toBe('PERIOD_CLOSED');
    expect(world.chargeStore.get(charge.id)?.snapshot.status).toBe('ACTIVE');
  });

  it('una versión desactualizada ⇒ PRECONDITION_FAILED y un cargo ajeno ⇒ RESOURCE_NOT_FOUND', async () => {
    const { charges, cardId } = await issuedOctober();
    const charge = await charges.record(interestAndInsurance(cardId));
    const base = { workspaceId: WS, userId: USER, cardId, reason: 'x' };
    expect(await codeOf(() => charges.void({ ...base, chargeId: charge.id, expectedVersion: 5 }))).toBe(
      'PRECONDITION_FAILED',
    );
    expect(await codeOf(() => charges.void({ ...base, chargeId: 'no-existe', expectedVersion: 1 }))).toBe(
      'RESOURCE_NOT_FOUND',
    );
    expect(
      await codeOf(() =>
        charges.void({ ...base, cardId: 'otra-tarjeta', chargeId: charge.id, expectedVersion: 1 }),
      ),
    ).toBe('RESOURCE_NOT_FOUND');
  });
});

describe('adopción de un gasto como cargo', () => {
  async function withManualInterest() {
    const ctx = await issuedOctober();
    ctx.world.addEntry({
      accountId: 'acct-bob',
      date: '2026-10-25',
      cls: 'PURCHASE',
      amount: '4.80',
      transactionId: 'tx-interes-visa',
    });
    return ctx;
  }

  it('[TC-DEBT-CARD-051] adoptar un gasto manual lo vuelve cargo sin crear transacciones ni cambiar el saldo', async () => {
    const { world, charges, cardId } = await withManualInterest();
    const entries = world.entries.length;
    const before = balance(world);
    const view = await charges.record({
      workspaceId: WS,
      userId: USER,
      cardId,
      accountId: 'acct-bob',
      adoptTransactionId: 'tx-interes-visa',
      interest: '4.80',
    });
    expect(view).toMatchObject({
      origin: 'ADOPTED',
      transactionId: 'tx-interes-visa',
      businessDate: '2026-10-25',
    });
    expect(world.entries).toHaveLength(entries);
    expect(balance(world)).toBe(before);
    expect(world.audit.some((a) => a.action === 'debt.card_charge.adopted')).toBe(true);
  });

  it('[TC-DEBT-CARD-052] componentes que no suman el gasto ⇒ CARD_CHARGE_INVALID y no se crea el cargo', async () => {
    const { world, charges, cardId } = await withManualInterest();
    expect(
      await codeOf(() =>
        charges.record({
          workspaceId: WS,
          userId: USER,
          cardId,
          accountId: 'acct-bob',
          adoptTransactionId: 'tx-interes-visa',
          interest: '4.00',
          insurance: '1.00',
        }),
      ),
    ).toBe('CARD_CHARGE_INVALID');
    expect(world.chargeStore.size).toBe(0);
  });

  it('adoptar dos veces el mismo gasto o con fecha propia se rechaza; anular un cargo adoptado anula su transacción', async () => {
    const { world, charges, cardId } = await withManualInterest();
    const base = {
      workspaceId: WS,
      userId: USER,
      cardId,
      accountId: 'acct-bob',
      adoptTransactionId: 'tx-interes-visa',
      interest: '4.80',
    };
    expect(await codeOf(() => charges.record({ ...base, businessDate: '2026-10-25' }))).toBe(
      'VALIDATION_FAILED',
    );
    const view = await charges.record(base);
    expect(await codeOf(() => charges.record(base))).toBe('CARD_CHARGE_INVALID');
    await charges.void({
      workspaceId: WS,
      userId: USER,
      cardId,
      chargeId: view.id,
      expectedVersion: view.version,
      reason: 'duplicado',
    });
    expect(world.chargeTxs.get('tx-interes-visa')?.voided).toBe(true);
    expect(balance(world)).toBe(1520.5);
  });
});
