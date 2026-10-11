import { dec } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BANK,
  CASH,
  EDITOR,
  SAVINGS,
  USD_CASH,
  WS,
  GoalsWorld,
  codeOf,
  errorOf,
} from './testing/goals-world.js';

const world = (now = '2026-10-15T14:00:00.000Z') => new GoalsWorld(now);

const bob = (amount: string) => ({ amount, currency: 'BOB' });

const recorded = (w: GoalsWorld) => w.eventsOf('goals.SavingsContributionRecorded');

/** Cantidad de centavos → texto decimal con dos decimales (sin aritmética de coma flotante). */
const centsText = (cents: number): string =>
  `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;

describe('Aporte real (TC-GOALS-SAVINGS-009..011)', () => {
  it('[TC-GOALS-SAVINGS-009] crea la transferencia POSTED con origen meta y el movimiento en la misma transacción', async () => {
    const w = world();
    w.setBalance(BANK, '8000.00');
    w.setBalance(SAVINGS, '0.00');
    const fund = await w.emergencyFund();

    const row = await w.contribute(fund.id, '1000.00');

    const tx = w.transaction(row.transactionId as string);
    expect(tx).toMatchObject({
      kind: 'TRANSFER',
      status: 'POSTED',
      source: 'GOAL',
      accountId: BANK,
      toAccountId: SAVINGS,
      amount: bob('1000.00'),
      businessDate: '2026-10-15',
      revision: 1,
      externalRef: { namespace: 'goals.movement', id: row.id },
    });
    expect(row).toMatchObject({
      fund: 'REAL',
      kind: 'CONTRIBUTION',
      accountId: SAVINGS,
      transactionId: tx.transactionId,
      transactionRevision: 1,
      origin: 'USER',
      recordedBy: EDITOR,
    });
    expect(row.amount.toFixed()).toBe('1000.00');
    expect([w.balanceOf(BANK), w.balanceOf(SAVINGS)]).toEqual(['7000.00', '1000.00']);

    const view = await w.queries.get(WS, fund.id);
    expect(view.progress.total).toEqual(bob('1000.00'));
    expect(view.progress.percent).toBe('6.67');

    expect(w.events.map((e) => e.eventType)).toEqual([
      'transactions.TransferCompleted',
      'goals.SavingsContributionRecorded',
    ]);
    expect(recorded(w)[0]?.payload).toMatchObject({
      goalId: fund.id,
      movementId: row.id,
      movement: 'CONTRIBUTION',
      fund: 'REAL',
      amount: bob('1000.00'),
      transactionId: tx.transactionId,
      progressBefore: bob('0.00'),
      progressAfter: bob('1000.00'),
      percentBefore: '0.00',
      percentAfter: '6.67',
      origin: 'USER',
    });
    expect(w.auditActions()).toContain('goals.movement.recorded');
  });

  it('[TC-GOALS-SAVINGS-009] un fallo inyectado tras el posteo revierte transferencia, saldos, movimiento, hechos y auditoría', async () => {
    const w = world();
    w.setBalance(BANK, '8000.00');
    const fund = await w.emergencyFund();
    const snapshot = {
      txs: w.txStore.size,
      movements: w.movementStore.length,
      events: w.events.length,
      trail: w.trail.length,
      version: w.versionOf(fund.id),
    };

    w.failures.add('outbox:goals.SavingsContributionRecorded');
    await expect(w.contribute(fund.id, '1000.00')).rejects.toThrow('injected failure');
    w.failures.clear();

    expect(w.transferAttempts).toBe(1);
    expect({
      txs: w.txStore.size,
      movements: w.movementStore.length,
      events: w.events.length,
      trail: w.trail.length,
      version: w.versionOf(fund.id),
    }).toEqual(snapshot);
    expect([w.balanceOf(BANK), w.balanceOf(SAVINGS)]).toEqual(['8000.00', '0.00']);

    // Con la falla retirada, el mismo comando funciona y deja un solo aporte.
    await w.contribute(fund.id, '1000.00');
    expect(w.movementsOf(fund.id)).toHaveLength(1);
  });

  it('[TC-GOALS-SAVINGS-009] los errores de Transactions (misma cuenta, monedas distintas, cuenta cerrada) se propagan sin rastro', async () => {
    const w = world();
    const fund = await w.emergencyFund({ linkedAccountIds: [SAVINGS, USD_CASH] });
    const attempt = (over: Parameters<GoalsWorld['contribute']>[2], amount = '10.00') =>
      codeOf(() => w.contribute(fund.id, amount, over));
    expect(await attempt({ from: SAVINGS })).toBe('TRANSFER_SAME_ACCOUNT');
    expect(await attempt({ to: USD_CASH })).toBe('TRANSFER_CURRENCY_MISMATCH');
    w.setAccountStatus(BANK, 'CLOSED');
    expect(await attempt({})).toBe('ACCOUNT_CLOSED');
    expect(w.movementStore).toHaveLength(0);
    expect(w.txStore.size).toBe(0);
    expect(w.trail.filter((r) => r.entry.action === 'goals.movement.recorded')).toHaveLength(0);
  });

  it('[TC-GOALS-SAVINGS-010] el destino no vinculado se rechaza sin crear la transferencia', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    expect(await codeOf(() => w.contribute(fund.id, '500.00', { to: CASH }))).toBe('GOAL_ACCOUNT_NOT_LINKED');
    expect(w.transferAttempts).toBe(0);
    expect(w.txStore.size).toBe(0);
    expect(w.movementStore).toHaveLength(0);
    expect(
      await codeOf(() =>
        w.movements.contribute({
          workspaceId: WS,
          userId: EDITOR,
          goalId: fund.id,
          fund: 'REAL',
          amount: bob('500.00'),
          sourceAccountId: BANK,
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-GOALS-SAVINGS-011] una fecha en un periodo cerrado se rechaza con PERIOD_CLOSED y no deja aporte huérfano', async () => {
    const w = world();
    w.setBalance(BANK, '8000.00');
    const fund = await w.emergencyFund();
    w.closedPeriods.add('2026-09');
    const before = { trail: w.trail.length, events: w.events.length, version: w.versionOf(fund.id) };

    expect(await codeOf(() => w.contribute(fund.id, '500.00', { businessDate: '2026-09-20' }))).toBe(
      'PERIOD_CLOSED',
    );

    expect(w.transferAttempts).toBe(1);
    expect(w.txStore.size).toBe(0);
    expect(w.movementStore).toHaveLength(0);
    expect({ trail: w.trail.length, events: w.events.length, version: w.versionOf(fund.id) }).toEqual(before);
    expect(w.balanceOf(BANK)).toBe('8000.00');
  });

  it('[TC-GOALS-SAVINGS-011] montos no positivos o con exceso de escala se rechazan antes de transferir', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    expect(await codeOf(() => w.contribute(fund.id, '0.00'))).toBe('AMOUNT_NOT_POSITIVE');
    expect(await codeOf(() => w.contribute(fund.id, '10.005'))).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(await codeOf(() => w.contribute(fund.id, '10.00', { businessDate: '20261015' }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(w.transferAttempts).toBe(0);
  });
});

describe('Reservas y su límite (TC-GOALS-SAVINGS-012..015)', () => {
  it('[TC-GOALS-SAVINGS-012] la reserva no crea transacción ni asiento y no cambia el saldo contable', async () => {
    const w = world();
    w.setBalance(BANK, '7000.00');
    const laptop = await w.laptop();

    const row = await w.earmark(laptop.id, BANK, '2000.00');

    expect(row).toMatchObject({
      fund: 'EARMARK',
      kind: 'CONTRIBUTION',
      accountId: BANK,
      transactionId: null,
      transactionRevision: null,
    });
    expect(row.amount.toFixed()).toBe('2000.00');
    expect(w.txStore.size).toBe(0);
    expect(w.transferAttempts).toBe(0);
    expect(w.balanceOf(BANK)).toBe('7000.00');
    const view = await w.queries.get(WS, laptop.id);
    expect(view.progress.total).toEqual(bob('2000.00'));
    expect(view.progress.percent).toBe('22.22');
  });

  it('[TC-GOALS-SAVINGS-012] reservar en una cuenta de otra moneda, de pasivo o cerrada se rechaza', async () => {
    const w = world();
    w.setBalance(BANK, '7000.00');
    const laptop = await w.laptop();
    expect(
      await codeOf(() =>
        w.movements.contribute({
          workspaceId: WS,
          userId: EDITOR,
          goalId: laptop.id,
          fund: 'EARMARK',
          amount: bob('10.00'),
          sourceAccountId: USD_CASH,
        }),
      ),
    ).toBe('CURRENCY_MISMATCH');
    expect(await codeOf(() => w.earmark(laptop.id, '0190a000-0000-7000-8000-0000000acc05', '10.00'))).toBe(
      'GOAL_ACCOUNT_NOT_ELIGIBLE',
    );
    w.setAccountStatus(BANK, 'CLOSED');
    expect(await codeOf(() => w.earmark(laptop.id, BANK, '10.00'))).toBe('ACCOUNT_CLOSED');
    expect(w.movementStore).toHaveLength(0);
  });

  it('[TC-GOALS-SAVINGS-014] una reserva mayor que el disponible falla con EARMARK_EXCEEDS_BALANCE y su detalle', async () => {
    const w = world();
    w.setBalance(BANK, '7000.00');
    const laptop = await w.laptop();
    const fund = await w.emergencyFund();
    await w.earmark(laptop.id, BANK, '2000.00');
    await w.earmark(fund.id, BANK, '1500.00');

    const err = await errorOf(() => w.earmark(laptop.id, BANK, '3600.00'));

    expect(err.code).toBe('EARMARK_EXCEEDS_BALANCE');
    expect(err.details).toEqual({
      balance: bob('7000.00'),
      reserved: bob('3500.00'),
      available: bob('3500.00'),
    });
    expect(w.movementsOf(laptop.id)).toHaveLength(1);
  });

  it('[TC-GOALS-SAVINGS-015] reservar exactamente el disponible se acepta y sobre una cuenta llena de aportes reales se rechaza', async () => {
    const w = world();
    const laptop = await w.laptop();
    const fund = await w.emergencyFund();
    w.setBalance(BANK, '10000.00');
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '1000.00', accountId: SAVINGS });
    await w.earmark(fund.id, BANK, '1500.00');
    await w.earmark(laptop.id, BANK, '2000.00');
    w.setBalance(BANK, '7000.00');
    w.setBalance(SAVINGS, '1000.00');

    await w.earmark(laptop.id, BANK, '3500.00');
    const [bank] = await w.queries.reservations(WS, { accountId: BANK });
    expect(bank).toMatchObject({ reserved: '7000.00', available: '0.00' });

    const err = await errorOf(() => w.earmark(laptop.id, SAVINGS, '1.00'));
    expect(err.code).toBe('EARMARK_EXCEEDS_BALANCE');
    expect(err.details).toMatchObject({
      balance: bob('1000.00'),
      reserved: bob('1000.00'),
      available: bob('0.00'),
    });
  });

  it('[TC-GOALS-SAVINGS-015] PBT: tras cada comando aceptado de reservas, liberaciones y reasignaciones reservado ≤ saldo', async () => {
    const command = fc.oneof(
      fc.record({
        t: fc.constant('reserve' as const),
        goal: fc.integer({ min: 0, max: 2 }),
        cents: fc.integer({ min: 1, max: 400_000 }),
      }),
      fc.record({
        t: fc.constant('release' as const),
        goal: fc.integer({ min: 0, max: 2 }),
        cents: fc.integer({ min: 1, max: 400_000 }),
      }),
      fc.record({
        t: fc.constant('reassign' as const),
        goal: fc.integer({ min: 0, max: 2 }),
        to: fc.integer({ min: 0, max: 2 }),
        cents: fc.integer({ min: 1, max: 400_000 }),
      }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(command, { minLength: 1, maxLength: 25 }), async (commands) => {
        const w = world();
        w.setBalance(BANK, '7000.00');
        const goals = [
          await w.createGoal({ name: 'Meta A', target: { amount: '90000.00', currency: 'BOB' } }),
          await w.createGoal({ name: 'Meta B', target: { amount: '90000.00', currency: 'BOB' } }),
          await w.createGoal({ name: 'Meta C', target: { amount: '90000.00', currency: 'BOB' } }),
        ];
        let accepted = 0;
        for (const c of commands) {
          const goal = goals[c.goal]?.id as string;
          let code: string;
          if (c.t === 'reserve') code = await codeOf(() => w.earmark(goal, BANK, centsText(c.cents)));
          else if (c.t === 'release') code = await codeOf(() => w.release(goal, BANK, centsText(c.cents)));
          else {
            code = await codeOf(() =>
              w.movements.reassign({
                workspaceId: WS,
                userId: EDITOR,
                goalId: goal,
                targetGoalId: goals[c.to]?.id as string,
                fund: 'EARMARK',
                accountId: BANK,
                amount: bob(centsText(c.cents)),
              }),
            );
          }
          if (code === 'ok') accepted += 1;
          else
            expect(['EARMARK_EXCEEDS_BALANCE', 'GOAL_INSUFFICIENT_FUNDS', 'VALIDATION_FAILED']).toContain(
              code,
            );
          const [reservation] = await w.queries.getReservedByAccount({ workspaceId: WS, accountIds: [BANK] });
          const reserved = reservation?.reserved ?? '0.00';
          expect(dec(reserved).lte(dec(w.balanceOf(BANK)))).toBe(true);
          for (const row of await w.deps.movements.funds(WS, {})) {
            expect(dec(row.amount).gte(0)).toBe(true);
          }
        }
        expect(accepted).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 40 },
    );
  }, 90_000);
});

describe('Reservado por cuenta (TC-GOALS-SAVINGS-013)', () => {
  it('[TC-GOALS-SAVINGS-013] suma reservas y aportes reales de metas vigentes; el disponible es saldo menos reservado', async () => {
    const w = world();
    const laptop = await w.laptop();
    const fund = await w.emergencyFund();
    const old = await w.createGoal({ name: 'Viaje cancelado', linkedAccountIds: [SAVINGS] });
    w.setBalance(BANK, '10000.00');
    await w.earmark(laptop.id, BANK, '2000.00');
    await w.earmark(fund.id, BANK, '1500.00');
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '1000.00', accountId: SAVINGS });
    w.seedMovement({ goalId: old.id, fund: 'REAL', amount: '300.00', accountId: SAVINGS });
    await w.service.cancel({
      workspaceId: WS,
      userId: EDITOR,
      goalId: old.id,
      expectedVersion: w.versionOf(old.id),
    });
    w.setBalance(BANK, '7000.00');
    w.setBalance(SAVINGS, '1000.00');

    const views = await w.queries.reservations(WS);

    expect(views.map((v) => v.accountName)).toEqual(['Banco BOB', 'Ahorro BOB']);
    expect(views[0]).toMatchObject({
      accountId: BANK,
      balance: '7000.00',
      reserved: '3500.00',
      available: '3500.00',
      overAllocated: false,
    });
    expect(views[0]?.goals).toEqual(
      [
        {
          goalId: fund.id,
          name: 'Fondo de emergencia',
          status: 'ACTIVE',
          earmarked: '1500.00',
          realHeld: '0.00',
        },
        { goalId: laptop.id, name: 'Laptop', status: 'ACTIVE', earmarked: '2000.00', realHeld: '0.00' },
      ].sort((a, b) => (a.goalId < b.goalId ? -1 : 1)),
    );
    expect(views[1]).toMatchObject({ balance: '1000.00', reserved: '1000.00', available: '0.00' });

    const pub = await w.queries.getReservedByAccount({ workspaceId: WS });
    expect(pub).toEqual([
      {
        accountId: BANK,
        currency: 'BOB',
        reserved: '3500.00',
        earmarked: '3500.00',
        realHeld: '0.00',
        overAllocated: false,
      },
      {
        accountId: SAVINGS,
        currency: 'BOB',
        reserved: '1000.00',
        earmarked: '0.00',
        realHeld: '1000.00',
        overAllocated: false,
      },
    ]);
    expect(await w.queries.getReservedByAccount({ workspaceId: WS, accountIds: [CASH] })).toEqual([]);
  });
});

describe('Vincular una transferencia como aporte (TC-GOALS-SAVINGS-019..021)', () => {
  it('[TC-GOALS-SAVINGS-019] una transferencia posteada a una cuenta vinculada se registra como aporte por su monto', async () => {
    const w = world('2026-10-21T14:00:00.000Z');
    const fund = await w.emergencyFund();
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '1000.00', accountId: SAVINGS });
    const txId = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '500.00', businessDate: '2026-10-20' });

    const row = await w.linkTransaction(fund.id, txId);

    expect(row).toMatchObject({
      fund: 'REAL',
      kind: 'CONTRIBUTION',
      accountId: SAVINGS,
      transactionId: txId,
      transactionRevision: 1,
      occurredOn: '2026-10-20',
      origin: 'USER',
    });
    expect(row.amount.toFixed()).toBe('500.00');
    expect((await w.queries.get(WS, fund.id)).progress.total).toEqual(bob('1500.00'));
    expect(await w.queries.transactionLinks(WS, [txId])).toEqual([
      {
        transactionId: txId,
        links: [
          expect.objectContaining({
            goalId: fund.id,
            goalName: 'Fondo de emergencia',
            movementId: row.id,
            movement: 'CONTRIBUTION',
            amount: bob('500.00'),
            active: true,
          }),
        ],
      },
    ]);
    // Vincular no crea otra transferencia.
    expect(w.transferAttempts).toBe(0);
  });

  it('[TC-GOALS-SAVINGS-020] gasto, transferencia pendiente o hacia cuenta no vinculada se rechazan con sus motivos', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    const expense = w.seedExpense({ account: BANK, amount: '300.00' });
    const pending = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '500.00', status: 'PENDING' });
    const toCash = w.seedTransfer({ from: BANK, to: CASH, amount: '200.00' });
    const reasons = async (id: string) =>
      (await errorOf(() => w.linkTransaction(fund.id, id))).details['reasons'];

    expect(await reasons(expense)).toEqual(['KIND']);
    expect(await reasons(pending)).toEqual(['STATUS']);
    expect(await reasons(toCash)).toEqual(['ACCOUNT']);
    expect(await codeOf(() => w.linkTransaction(fund.id, expense))).toBe('GOAL_TRANSACTION_NOT_ELIGIBLE');
    expect(await codeOf(() => w.linkTransaction(fund.id, 'inexistente'))).toBe('REFERENCE_NOT_FOUND');
    expect(w.movementStore).toHaveLength(0);
  });

  it('[TC-GOALS-SAVINGS-021] una transferencia que ya es aporte no se vincula a otra meta ni, en paralelo, a las dos', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    const laptop = await w.laptop({ linkedAccountIds: [SAVINGS] });
    const first = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '500.00' });
    await w.linkTransaction(fund.id, first);
    expect(await codeOf(() => w.linkTransaction(laptop.id, first))).toBe('GOAL_TRANSACTION_ALREADY_LINKED');
    expect(await codeOf(() => w.linkTransaction(fund.id, first))).toBe('GOAL_TRANSACTION_ALREADY_LINKED');

    const second = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '700.00' });
    const results = await Promise.allSettled([
      w.linkTransaction(fund.id, second),
      w.linkTransaction(laptop.id, second),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({
      code: 'GOAL_TRANSACTION_ALREADY_LINKED',
    });
    expect(w.movementStore.filter((m) => m.transactionId === second)).toHaveLength(1);
  });

  it('[TC-GOALS-SAVINGS-021] una meta terminal no acepta vínculos (GOAL_CLOSED)', async () => {
    const w = world();
    const laptop = await w.laptop({ linkedAccountIds: [SAVINGS] });
    await w.service.cancel({
      workspaceId: WS,
      userId: EDITOR,
      goalId: laptop.id,
      expectedVersion: laptop.version,
    });
    const tx = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '500.00' });
    expect(await codeOf(() => w.linkTransaction(laptop.id, tx))).toBe('GOAL_CLOSED');
  });
});

describe('Retiros y reasignaciones (TC-GOALS-SAVINGS-024..028)', () => {
  it('[TC-GOALS-SAVINGS-024] retirar fondos reales crea la transferencia desde la cuenta vinculada y un retiro negativo con motivo', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '1000.00', accountId: SAVINGS });
    const txsBefore = w.txStore.size;

    const row = await w.movements.withdraw({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      fund: 'REAL',
      accountId: SAVINGS,
      amount: bob('400.00'),
      mode: { type: 'TRANSFER', toAccountId: BANK },
      reason: 'Gasto médico',
    });

    const tx = w.transaction(row.transactionId as string);
    expect(w.txStore.size).toBe(txsBefore + 1);
    expect(tx).toMatchObject({
      kind: 'TRANSFER',
      status: 'POSTED',
      source: 'GOAL',
      accountId: SAVINGS,
      toAccountId: BANK,
      amount: bob('400.00'),
    });
    expect(row).toMatchObject({
      fund: 'REAL',
      kind: 'WITHDRAWAL',
      accountId: SAVINGS,
      note: 'Gasto médico',
      transactionRevision: 1,
      recordedBy: EDITOR,
    });
    expect(row.amount.toFixed()).toBe('-400.00');
    expect((await w.queries.get(WS, fund.id)).progress.total).toEqual(bob('600.00'));
    expect(w.trail.filter((r) => r.entry.action === 'goals.movement.recorded').at(-1)?.entry.changes).toEqual(
      expect.arrayContaining([
        { field: 'movementKind', before: null, after: 'WITHDRAWAL' },
        { field: 'note', before: null, after: 'Gasto médico' },
      ]),
    );
  });

  it('[TC-GOALS-SAVINGS-024] el retiro a una moneda distinta o un fallo posterior no dejan transferencia ni movimiento', async () => {
    const w = world();
    const fund = await w.emergencyFund({ linkedAccountIds: [SAVINGS, USD_CASH] });
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '1000.00', accountId: SAVINGS });
    const base = {
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      fund: 'REAL' as const,
      accountId: SAVINGS,
    };
    const txs = w.txStore.size;
    expect(
      await codeOf(() =>
        w.movements.withdraw({
          ...base,
          amount: bob('100.00'),
          mode: { type: 'TRANSFER', toAccountId: USD_CASH },
        }),
      ),
    ).toBe('TRANSFER_CURRENCY_MISMATCH');
    w.failures.add('outbox:goals.SavingsContributionRecorded');
    await expect(
      w.movements.withdraw({ ...base, amount: bob('100.00'), mode: { type: 'TRANSFER', toAccountId: BANK } }),
    ).rejects.toThrow('injected failure');
    w.failures.clear();
    expect(w.txStore.size).toBe(txs);
    expect(w.sumOf(fund.id)).toBe('1000.00');
    expect(w.balanceOf(SAVINGS)).toBe('1000.00');
  });

  it('[TC-GOALS-SAVINGS-025] un retiro mayor que los fondos de la meta se rechaza aunque el saldo de la cuenta alcance', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '1000.00', accountId: SAVINGS });
    w.setBalance(SAVINGS, '1500.00');
    const txs = w.txStore.size;

    const err = await errorOf(() =>
      w.movements.withdraw({
        workspaceId: WS,
        userId: EDITOR,
        goalId: fund.id,
        fund: 'REAL',
        accountId: SAVINGS,
        amount: bob('1200.00'),
        mode: { type: 'TRANSFER', toAccountId: BANK },
      }),
    );

    expect(err.code).toBe('GOAL_INSUFFICIENT_FUNDS');
    expect(err.details).toEqual({ fund: 'REAL', held: bob('1000.00'), requested: bob('1200.00') });
    expect(w.transferAttempts).toBe(0);
    expect(w.txStore.size).toBe(txs);
    expect(w.sumOf(fund.id)).toBe('1000.00');
  });

  it('[TC-GOALS-SAVINGS-026] un gasto existente se vincula como retiro parcial y una reserva se libera sin transacción', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    const laptop = await w.laptop();
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '1000.00', accountId: SAVINGS });
    w.setBalance(BANK, '5000.00');
    await w.earmark(laptop.id, BANK, '2000.00');
    const expense = w.seedExpense({
      account: SAVINGS,
      amount: '300.00',
      description: 'Reparación auto',
    });
    const [beforeRelease] = await w.queries.reservations(WS, { accountId: BANK });
    expect(beforeRelease).toMatchObject({ available: '3000.00' });
    const txs = w.txStore.size;

    const link = await w.movements.withdraw({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      fund: 'REAL',
      accountId: SAVINGS,
      amount: bob('300.00'),
      mode: { type: 'LINK', transactionId: expense },
    });
    expect(link).toMatchObject({ kind: 'WITHDRAWAL', transactionId: expense, transactionRevision: 1 });
    expect(link.amount.toFixed()).toBe('-300.00');
    expect(w.txStore.size).toBe(txs);
    expect((await w.queries.get(WS, fund.id)).progress.total).toEqual(bob('700.00'));

    const release = await w.release(laptop.id, BANK, '500.00');
    expect(release).toMatchObject({ fund: 'EARMARK', kind: 'WITHDRAWAL', transactionId: null });
    expect(release.amount.toFixed()).toBe('-500.00');
    expect((await w.queries.get(WS, laptop.id)).progress.total).toEqual(bob('1500.00'));
    const [afterRelease] = await w.queries.reservations(WS, { accountId: BANK });
    expect(afterRelease).toMatchObject({ reserved: '1500.00', available: '3500.00' });
  });

  it('[TC-GOALS-SAVINGS-026] vincular más que el gasto, otro tipo o una reserva con LINK se rechaza', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '1000.00', accountId: SAVINGS });
    const expense = w.seedExpense({ account: SAVINGS, amount: '300.00' });
    const income = w.seedIncome({ account: SAVINGS, amount: '50.00' });
    const base = {
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      fund: 'REAL' as const,
      accountId: SAVINGS,
    };
    const withdraw = (amount: string, transactionId: string) =>
      errorOf(() =>
        w.movements.withdraw({ ...base, amount: bob(amount), mode: { type: 'LINK', transactionId } }),
      );
    expect((await withdraw('350.00', expense)).details['reasons']).toEqual(['AMOUNT']);
    expect((await withdraw('10.00', income)).details['reasons']).toEqual(['KIND']);
    await w.movements.withdraw({
      ...base,
      amount: bob('200.00'),
      mode: { type: 'LINK', transactionId: expense },
    });
    // El saldo del gasto vinculado se agota: 200 + 150 > 300.
    expect((await withdraw('150.00', expense)).details['reasons']).toEqual(['AMOUNT']);
    expect(
      await codeOf(() =>
        w.movements.withdraw({
          ...base,
          fund: 'EARMARK',
          amount: bob('10.00'),
          mode: { type: 'LINK', transactionId: expense },
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-GOALS-SAVINGS-027] reasignar una reserva registra dos movimientos ligados y no cambia lo reservado', async () => {
    const w = world();
    w.setBalance(BANK, '7000.00');
    const laptop = await w.laptop();
    const fund = await w.emergencyFund();
    await w.earmark(laptop.id, BANK, '1500.00');
    const eventsBefore = recorded(w).length;
    const auditBefore = w.auditActions().filter((a) => a === 'goals.movement.recorded').length;

    const result = await w.movements.reassign({
      workspaceId: WS,
      userId: EDITOR,
      goalId: laptop.id,
      targetGoalId: fund.id,
      fund: 'EARMARK',
      accountId: BANK,
      amount: bob('1000.00'),
      reason: 'Prioridad',
    });

    expect(result.source).toMatchObject({ goalId: laptop.id, kind: 'REASSIGN_OUT' });
    expect(result.source.amount.toFixed()).toBe('-1000.00');
    expect(result.target).toMatchObject({ goalId: fund.id, kind: 'REASSIGN_IN' });
    expect(result.target.amount.toFixed()).toBe('1000.00');
    expect(result.source.reassignmentId).toBe(result.reassignmentId);
    expect(result.target.reassignmentId).toBe(result.reassignmentId);
    expect(w.sumOf(laptop.id)).toBe('500.00');
    expect(w.sumOf(fund.id)).toBe('1000.00');
    const [bank] = await w.queries.reservations(WS, { accountId: BANK });
    expect(bank).toMatchObject({ reserved: '1500.00', available: '5500.00' });
    expect(
      recorded(w)
        .slice(eventsBefore)
        .map((e) => [e.payload['goalId'], e.payload['movement']]),
    ).toEqual([
      [laptop.id, 'REASSIGN_OUT'],
      [fund.id, 'REASSIGN_IN'],
    ]);
    expect(w.auditActions().filter((a) => a === 'goals.movement.recorded').length - auditBefore).toBe(2);
    // Las metas se bloquearon en orden de id (sin interbloqueos).
    expect(w.lockLog.at(-1)).toEqual([laptop.id, fund.id].sort());
  });

  it('[TC-GOALS-SAVINGS-027] reasignar a la misma meta, a una terminal o más de lo que tiene se rechaza', async () => {
    const w = world();
    w.setBalance(BANK, '7000.00');
    const laptop = await w.laptop();
    const fund = await w.emergencyFund();
    const done = await w.createGoal({ name: 'Terminada' });
    await w.service.cancel({
      workspaceId: WS,
      userId: EDITOR,
      goalId: done.id,
      expectedVersion: done.version,
    });
    await w.earmark(laptop.id, BANK, '500.00');
    const reassign = (goalId: string, targetGoalId: string, amount: string) =>
      codeOf(() =>
        w.movements.reassign({
          workspaceId: WS,
          userId: EDITOR,
          goalId,
          targetGoalId,
          fund: 'EARMARK',
          accountId: BANK,
          amount: bob(amount),
        }),
      );
    expect(await reassign(laptop.id, laptop.id, '10.00')).toBe('VALIDATION_FAILED');
    expect(await reassign(laptop.id, done.id, '10.00')).toBe('GOAL_CLOSED');
    expect(await reassign(laptop.id, fund.id, '600.00')).toBe('GOAL_INSUFFICIENT_FUNDS');
    expect(await reassign(laptop.id, '0190a000-0000-7000-8000-00000000dead', '10.00')).toBe(
      'REFERENCE_NOT_FOUND',
    );
    expect(w.sumOf(laptop.id)).toBe('500.00');
  });

  it('[TC-GOALS-SAVINGS-028] reasignar fondos reales a una meta sin la cuenta vinculada se rechaza y ninguna meta cambia', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    const laptop = await w.laptop();
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '1000.00', accountId: SAVINGS });
    const versions = [w.versionOf(fund.id), w.versionOf(laptop.id)];
    const movements = w.movementStore.length;

    expect(
      await codeOf(() =>
        w.movements.reassign({
          workspaceId: WS,
          userId: EDITOR,
          goalId: fund.id,
          targetGoalId: laptop.id,
          fund: 'REAL',
          accountId: SAVINGS,
          amount: bob('300.00'),
        }),
      ),
    ).toBe('GOAL_ACCOUNT_NOT_LINKED');

    expect(w.movementStore).toHaveLength(movements);
    expect([w.versionOf(fund.id), w.versionOf(laptop.id)]).toEqual(versions);
  });
});

describe('Estado derivado de los movimientos (TC-GOALS-SAVINGS-029, -037)', () => {
  it('[TC-GOALS-SAVINGS-029] +1000, +500, inverso −500 y retiro −400 dejan 600.00 y el historial intacto', async () => {
    const w = world();
    w.setBalance(BANK, '8000.00');
    const fund = await w.emergencyFund();
    await w.contribute(fund.id, '1000.00');
    const second = await w.contribute(fund.id, '500.00');
    w.voidTransaction(second.transactionId as string);
    await w.reactions.onTransactionChange(w.voidedEvent(second.transactionId as string));
    await w.movements.withdraw({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      fund: 'REAL',
      accountId: SAVINGS,
      amount: bob('400.00'),
      mode: { type: 'TRANSFER', toAccountId: BANK },
    });

    expect((await w.queries.get(WS, fund.id)).progress.total).toEqual(bob('600.00'));
    expect(w.movementsOf(fund.id).map((m) => `${m.kind}:${m.amount.toFixed()}`)).toEqual([
      'CONTRIBUTION:1000.00',
      'CONTRIBUTION:500.00',
      'REVERSAL:-500.00',
      'WITHDRAWAL:-400.00',
    ]);
    // El repositorio solo inserta: no hay operaciones de edición ni borrado (append-only).
    expect(Object.keys(w.deps.movements).filter((k) => /update|delete|remove|save|set/i.test(k))).toEqual([]);
    const page = await w.queries.movements(WS, fund.id);
    expect(page.data.map((m) => m.movement)).toEqual([
      'WITHDRAWAL',
      'REVERSAL',
      'CONTRIBUTION',
      'CONTRIBUTION',
    ]);
  });

  it('[TC-GOALS-SAVINGS-029] PBT: el progreso es Σ(+) − Σ(−) y ningún (meta, cuenta, fondo) queda negativo', async () => {
    const goalIx = fc.integer({ min: 0, max: 1 });
    const cents = fc.integer({ min: 1, max: 300_000 });
    const command = fc.oneof(
      fc.record({ t: fc.constant('contribute' as const), goal: goalIx, cents }),
      fc.record({ t: fc.constant('earmark' as const), goal: goalIx, cents }),
      fc.record({ t: fc.constant('release' as const), goal: goalIx, cents }),
      fc.record({ t: fc.constant('withdraw' as const), goal: goalIx, cents }),
      fc.record({
        t: fc.constant('reassign' as const),
        goal: goalIx,
        cents,
        fund: fc.constantFrom('REAL' as const, 'EARMARK' as const),
      }),
    );
    await fc.assert(
      fc.asyncProperty(fc.array(command, { minLength: 1, maxLength: 20 }), async (commands) => {
        const w = world();
        w.setBalance(BANK, '1000000.00');
        const goals = [
          await w.createGoal({ name: 'Meta A', linkedAccountIds: [SAVINGS], target: bob('900000.00') }),
          await w.createGoal({ name: 'Meta B', linkedAccountIds: [SAVINGS], target: bob('900000.00') }),
        ];
        for (const c of commands) {
          const goal = goals[c.goal]?.id as string;
          const other = goals[1 - c.goal]?.id as string;
          const amount = centsText(c.cents);
          if (c.t === 'contribute') await codeOf(() => w.contribute(goal, amount));
          else if (c.t === 'earmark') await codeOf(() => w.earmark(goal, BANK, amount));
          else if (c.t === 'release') await codeOf(() => w.release(goal, BANK, amount));
          else if (c.t === 'withdraw') {
            await codeOf(() =>
              w.movements.withdraw({
                workspaceId: WS,
                userId: EDITOR,
                goalId: goal,
                fund: 'REAL',
                accountId: SAVINGS,
                amount: bob(amount),
                mode: { type: 'TRANSFER', toAccountId: BANK },
              }),
            );
          } else {
            await codeOf(() =>
              w.movements.reassign({
                workspaceId: WS,
                userId: EDITOR,
                goalId: goal,
                targetGoalId: other,
                fund: c.fund,
                accountId: c.fund === 'REAL' ? SAVINGS : BANK,
                amount: bob(amount),
              }),
            );
          }
          for (const g of goals) {
            const positives = w
              .movementsOf(g.id)
              .filter((m) => m.amount.isPositive())
              .reduce((acc, m) => acc.plus(m.amount.toFixed()), dec('0'));
            const negatives = w
              .movementsOf(g.id)
              .filter((m) => m.amount.isNegative())
              .reduce((acc, m) => acc.plus(m.amount.toFixed()), dec('0'));
            const view = await w.queries.get(WS, g.id);
            expect(view.progress.total.amount).toBe(positives.plus(negatives).toFixed(2));
          }
          for (const row of await w.deps.movements.funds(WS, {})) {
            expect(row.amount.startsWith('-')).toBe(false);
          }
        }
      }),
      { numRuns: 30 },
    );
  }, 90_000);

  it('[TC-GOALS-SAVINGS-037] alcanzar publica GoalReached una vez por alcance; un retiro que la deja por debajo la reabre', async () => {
    const w = world('2026-10-20T14:00:00.000Z');
    w.setBalance(BANK, '20000.00');
    const laptop = await w.laptop();
    await w.earmark(laptop.id, BANK, '8500.00');
    const reached = () => w.eventsOf('goals.GoalReached');
    expect(reached()).toHaveLength(0);

    await w.earmark(laptop.id, BANK, '500.00');
    expect(w.goalState(laptop.id).status).toBe('ACHIEVED');
    expect(reached()).toHaveLength(1);
    expect(reached()[0]?.payload).toMatchObject({
      goalId: laptop.id,
      reachedOn: '2026-10-20',
      trigger: 'MOVEMENT',
      target: bob('9000.00'),
      progress: bob('9000.00'),
    });

    await w.earmark(laptop.id, BANK, '100.00');
    expect(w.goalState(laptop.id).status).toBe('ACHIEVED');
    expect(reached()).toHaveLength(1);

    await w.release(laptop.id, BANK, '600.00');
    expect(w.goalState(laptop.id).status).toBe('ACTIVE');
    expect(w.goalState(laptop.id).achievedOn).toBeNull();
    expect((await w.queries.get(WS, laptop.id)).progress.total).toEqual(bob('8500.00'));

    await w.earmark(laptop.id, BANK, '500.00');
    expect(w.goalState(laptop.id).status).toBe('ACHIEVED');
    expect(reached()).toHaveLength(2);
    expect(w.auditActions().filter((a) => a === 'goals.goal.reopened')).toHaveLength(1);
  });
});

describe('Vínculos de transacciones (TC-GOALS-SAVINGS-049)', () => {
  it('[TC-GOALS-SAVINGS-049] el aporte tiene origen GOAL, la consulta indica su meta y tras anular conserva el inverso', async () => {
    const w = world();
    w.setBalance(BANK, '8000.00');
    const fund = await w.emergencyFund();
    const row = await w.contribute(fund.id, '1000.00');
    const txId = row.transactionId as string;
    expect(w.transaction(txId)).toMatchObject({ source: 'GOAL', kind: 'TRANSFER' });
    const income = w.seedIncome({ account: BANK, amount: '10.00' });
    expect(await w.queries.transactionLinks(WS, [txId, income])).toEqual([
      {
        transactionId: txId,
        links: [
          {
            goalId: fund.id,
            goalName: 'Fondo de emergencia',
            movementId: row.id,
            movement: 'CONTRIBUTION',
            fund: 'REAL',
            amount: bob('1000.00'),
            reversesId: null,
            active: true,
          },
        ],
      },
      { transactionId: income, links: [] },
    ]);

    w.voidTransaction(txId);
    await w.reactions.onTransactionChange(w.voidedEvent(txId));

    const [after] = await w.queries.transactionLinks(WS, [txId]);
    expect(after?.links.map((l) => [l.movement, l.goalName, l.amount.amount, l.active])).toEqual([
      ['CONTRIBUTION', 'Fondo de emergencia', '1000.00', false],
      ['REVERSAL', 'Fondo de emergencia', '-1000.00', false],
    ]);
    expect(after?.links[1]?.reversesId).toBe(row.id);
    expect(
      await codeOf(() =>
        w.queries.transactionLinks(
          WS,
          Array.from({ length: 101 }, (_, i) => `t-${i}`),
        ),
      ),
    ).toBe('VALIDATION_FAILED');
  });
});
