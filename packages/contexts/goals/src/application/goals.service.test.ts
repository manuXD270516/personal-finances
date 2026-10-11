import { describe, expect, it } from 'vitest';
import { BANK, CARD, EDITOR, SAVINGS, WS, GoalsWorld, codeOf, errorOf } from './testing/goals-world.js';

const world = (now = '2026-10-01T13:00:00.000Z') => new GoalsWorld(now);

describe('Alta de una meta (TC-GOALS-SAVINGS-001..003)', () => {
  it('[TC-GOALS-SAVINGS-001] crea el fondo de emergencia ACTIVE, versión 1, sin progreso y con auditoría', async () => {
    const w = world();
    const goal = await w.emergencyFund();

    expect(goal.status).toBe('ACTIVE');
    expect(goal.version).toBe(1);
    const view = await w.queries.get(WS, goal.id);
    expect(view).toMatchObject({
      name: 'Fondo de emergencia',
      type: 'EMERGENCY_FUND',
      status: 'ACTIVE',
      version: 1,
      target: { amount: '15000.00', currency: 'BOB' },
      startDate: '2026-10-01',
      targetDate: '2027-03-31',
      linkedAccountIds: [SAVINGS],
      priority: 1,
    });
    expect(view.progress.total).toEqual({ amount: '0.00', currency: 'BOB' });
    expect(view.progress.percent).toBe('0.00');
    expect(view.progress.remaining).toEqual({ amount: '15000.00', currency: 'BOB' });
    expect(w.trail.map((r) => r.entry)).toEqual([
      expect.objectContaining({ action: 'goals.goal.created', aggregateId: goal.id, aggregateVersion: 1 }),
    ]);
    expect(w.trail[0]?.steps).toEqual([
      expect.objectContaining({ kind: 'TRANSITION', transition: 'CREATE', toState: 'ACTIVE' }),
    ]);
  });

  it('[TC-GOALS-SAVINGS-002] rechaza escala, cero, moneda no habilitada, fechas invertidas y nombre repetido sin dejar rastro', async () => {
    const w = world();
    await w.laptop();
    const before = { goals: w.goalStore.size, audit: w.trail.length, events: w.events.length };

    const attempts: [string, Parameters<GoalsWorld['createGoal']>[0]][] = [
      ['AMOUNT_SCALE_EXCEEDED', { name: 'A', target: { amount: '9000.005', currency: 'BOB' } }],
      ['AMOUNT_NOT_POSITIVE', { name: 'B', target: { amount: '0.00', currency: 'BOB' } }],
      ['CURRENCY_NOT_ENABLED', { name: 'C', target: { amount: '500.00', currency: 'EUR' } }],
      ['VALIDATION_FAILED', { name: 'D', startDate: '2026-10-01', targetDate: '2026-09-30' }],
      ['NAME_TAKEN', { name: 'laptop' }],
    ];
    for (const [expected, input] of attempts) {
      expect(await codeOf(() => w.createGoal(input)), expected).toBe(expected);
    }
    expect({ goals: w.goalStore.size, audit: w.trail.length, events: w.events.length }).toEqual(before);
  });

  it('[TC-GOALS-SAVINGS-002] un nombre archivado queda libre y los nombres se comparan sin espacios ni mayúsculas', async () => {
    const w = world();
    const laptop = await w.laptop();
    expect(await codeOf(() => w.createGoal({ name: '  LAPTOP ' }))).toBe('NAME_TAKEN');
    const cancelled = await w.service.cancel({
      workspaceId: WS,
      userId: EDITOR,
      goalId: laptop.id,
      expectedVersion: laptop.version,
    });
    await w.service.archive({
      workspaceId: WS,
      userId: EDITOR,
      goalId: laptop.id,
      expectedVersion: cancelled.version,
    });
    expect(await codeOf(() => w.createGoal({ name: 'Laptop' }))).toBe('ok');
  });

  it('[TC-GOALS-SAVINGS-003] una tarjeta (pasivo) no se vincula ni al crear ni al editar', async () => {
    const w = world();
    expect(await codeOf(() => w.createGoal({ name: 'Con tarjeta', linkedAccountIds: [CARD] }))).toBe(
      'GOAL_ACCOUNT_NOT_ELIGIBLE',
    );
    const fund = await w.emergencyFund();
    const before = w.goalStore.get(fund.id);
    expect(
      await codeOf(() =>
        w.service.update({
          workspaceId: WS,
          userId: EDITOR,
          goalId: fund.id,
          expectedVersion: fund.version,
          linkedAccountIds: [SAVINGS, CARD],
        }),
      ),
    ).toBe('GOAL_ACCOUNT_NOT_ELIGIBLE');
    expect(w.goalStore.get(fund.id)).toEqual(before);
    expect(w.goalStore.size).toBe(1);
  });

  it('[TC-GOALS-SAVINGS-003] cuenta inexistente, cerrada o archivada tampoco se vincula', async () => {
    const w = world();
    w.setAccountStatus(SAVINGS, 'CLOSED');
    expect(await codeOf(() => w.emergencyFund())).toBe('ACCOUNT_CLOSED');
    w.setAccountStatus(SAVINGS, 'ARCHIVED');
    expect(await codeOf(() => w.emergencyFund())).toBe('ACCOUNT_ARCHIVED');
    expect(
      await codeOf(() =>
        w.createGoal({ name: 'X', linkedAccountIds: ['0190a000-0000-7000-8000-00000000dead'] }),
      ),
    ).toBe('REFERENCE_NOT_FOUND');
  });
});

describe('Edición y estados de una meta (TC-GOALS-SAVINGS-004..008)', () => {
  it('[TC-GOALS-SAVINGS-004] bajar el objetivo la deja ACHIEVED (104.17 %, TARGET_CHANGE) y subirlo reabre la ACHIEVED (90.00 %)', async () => {
    const w = world('2026-10-12T14:00:00.000Z');
    w.setBalance(BANK, '30000.00');
    const fund = await w.emergencyFund();
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '12500.00', accountId: SAVINGS });
    const laptop = await w.laptop();
    await w.earmark(laptop.id, BANK, '9000.00');
    expect(w.goalState(laptop.id).status).toBe('ACHIEVED');
    const reachedBefore = w.eventsOf('goals.GoalReached').length;

    await w.service.update({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      expectedVersion: w.versionOf(fund.id),
      target: { amount: '12000.00' },
    });
    const achieved = await w.queries.get(WS, fund.id);
    expect(achieved.status).toBe('ACHIEVED');
    expect(achieved.progress.percent).toBe('104.17');
    const reached = w.eventsOf('goals.GoalReached');
    expect(reached).toHaveLength(reachedBefore + 1);
    expect(reached.at(-1)?.payload).toMatchObject({
      goalId: fund.id,
      trigger: 'TARGET_CHANGE',
      target: { amount: '12000.00', currency: 'BOB' },
      progress: { amount: '12500.00', currency: 'BOB' },
      reachedOn: '2026-10-12',
    });

    await w.service.update({
      workspaceId: WS,
      userId: EDITOR,
      goalId: laptop.id,
      expectedVersion: w.versionOf(laptop.id),
      target: { amount: '10000.00' },
    });
    const reopened = await w.queries.get(WS, laptop.id);
    expect(reopened.status).toBe('ACTIVE');
    expect(reopened.progress.percent).toBe('90.00');
    expect(w.auditActions()).toEqual(
      expect.arrayContaining(['goals.goal.updated', 'goals.goal.reached', 'goals.goal.reopened']),
    );
    const reopenedEntry = w.trail.find((r) => r.entry.action === 'goals.goal.reopened');
    expect(reopenedEntry?.steps).toEqual([
      expect.objectContaining({
        kind: 'TRANSITION',
        transition: 'REOPEN',
        fromState: 'ACHIEVED',
        toState: 'ACTIVE',
      }),
    ]);
  });

  it('[TC-GOALS-SAVINGS-004] editar con una versión vieja se rechaza con PRECONDITION_FAILED y sin cambios', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    const err = await errorOf(() =>
      w.service.update({
        workspaceId: WS,
        userId: EDITOR,
        goalId: fund.id,
        expectedVersion: 7,
        name: 'Otro',
      }),
    );
    expect(err.code).toBe('PRECONDITION_FAILED');
    expect(err.details).toEqual({ currentVersion: 1 });
    expect(w.goalState(fund.id).name).toBe('Fondo de emergencia');
  });

  it('[TC-GOALS-SAVINGS-005] no desvincula una cuenta con fondos reales ni cambia la moneda con movimientos', async () => {
    const w = world('2026-10-12T14:00:00.000Z');
    const fund = await w.emergencyFund();
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '1000.00', accountId: SAVINGS });
    const before = w.goalState(fund.id);
    const edit = { workspaceId: WS, userId: EDITOR, goalId: fund.id, expectedVersion: before.version };

    expect(await codeOf(() => w.service.update({ ...edit, linkedAccountIds: [] }))).toBe(
      'GOAL_ACCOUNT_HAS_FUNDS',
    );
    expect(
      await codeOf(() => w.service.update({ ...edit, target: { amount: '15000.00', currency: 'USD' } })),
    ).toBe('GOAL_CURRENCY_LOCKED');
    expect(w.goalState(fund.id)).toEqual(before);
    expect(w.goalState(fund.id).linkedAccountIds).toEqual([SAVINGS]);
  });

  it('[TC-GOALS-SAVINGS-005] sin fondos reales sí se puede desvincular y cambiar la moneda del objetivo', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    const updated = await w.service.update({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      expectedVersion: fund.version,
      linkedAccountIds: [],
      target: { amount: '3000.00', currency: 'USD' },
    });
    expect(updated.snapshot).toMatchObject({
      linkedAccountIds: [],
      currency: 'USD',
      targetAmount: '3000.00',
      version: 2,
    });
  });

  it('[TC-GOALS-SAVINGS-006] pausar y reanudar son transiciones auditadas y la meta pausada acepta la reserva', async () => {
    const w = world('2026-10-12T14:00:00.000Z');
    w.setBalance(BANK, '7000.00');
    const fund = await w.emergencyFund();
    const paused = await w.service.pause({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      expectedVersion: fund.version,
    });
    expect(paused.status).toBe('PAUSED');

    const movement = await w.earmark(fund.id, BANK, '100.00');
    expect(movement).toMatchObject({ fund: 'EARMARK', kind: 'CONTRIBUTION' });
    expect(w.goalState(fund.id).status).toBe('PAUSED');

    const resumed = await w.service.resume({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      expectedVersion: w.versionOf(fund.id),
    });
    expect(resumed.status).toBe('ACTIVE');

    const transitions = w.trail
      .filter((r) => r.entry.action === 'goals.goal.paused' || r.entry.action === 'goals.goal.resumed')
      .map((r) => [r.entry.action, r.entry.aggregateVersion, r.steps[0]]);
    expect(transitions).toEqual([
      [
        'goals.goal.paused',
        2,
        expect.objectContaining({ transition: 'PAUSE', fromState: 'ACTIVE', toState: 'PAUSED' }),
      ],
      [
        'goals.goal.resumed',
        4,
        expect.objectContaining({ transition: 'RESUME', fromState: 'PAUSED', toState: 'ACTIVE' }),
      ],
    ]);
    // Reanudar una meta que no está pausada es una transición inválida.
    expect(
      await codeOf(() =>
        w.service.resume({
          workspaceId: WS,
          userId: EDITOR,
          goalId: fund.id,
          expectedVersion: w.versionOf(fund.id),
        }),
      ),
    ).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-GOALS-SAVINGS-007] cancelar libera la reserva con un EARMARK/WITHDRAWAL de sistema y sube el disponible', async () => {
    const w = world('2026-10-12T14:00:00.000Z');
    w.setBalance(BANK, '7000.00');
    const laptop = await w.laptop();
    await w.earmark(laptop.id, BANK, '2000.00');
    const [before] = await w.queries.reservations(WS, { accountId: BANK });
    expect(before).toMatchObject({ balance: '7000.00', reserved: '2000.00', available: '5000.00' });

    const cancelled = await w.service.cancel({
      workspaceId: WS,
      userId: EDITOR,
      goalId: laptop.id,
      expectedVersion: w.versionOf(laptop.id),
      reason: 'Compra postergada',
    });
    expect(cancelled).toMatchObject({ status: 'CANCELLED' });
    expect(cancelled.snapshot).toMatchObject({
      cancelReason: 'Compra postergada',
      cancelledOn: '2026-10-12',
    });

    const release = w.movementsOf(laptop.id).at(-1);
    expect(release).toMatchObject({
      fund: 'EARMARK',
      kind: 'WITHDRAWAL',
      accountId: BANK,
      origin: 'SYSTEM',
      note: 'CANCEL',
      transactionId: null,
    });
    expect(release?.amount.toFixed()).toBe('-2000.00');
    const [after] = await w.queries.reservations(WS, { accountId: BANK });
    expect(after).toMatchObject({ balance: '7000.00', reserved: '0.00', available: '7000.00' });
    expect(w.sumOf(laptop.id)).toBe('0.00');
    expect(w.auditActions()).toContain('goals.goal.cancelled');
  });

  it('[TC-GOALS-SAVINGS-007] cerrar una meta ACHIEVED libera lo reservado y termina el aporte programado', async () => {
    const w = world('2026-10-12T14:00:00.000Z');
    w.setBalance(BANK, '20000.00');
    const laptop = await w.laptop();
    await w.earmark(laptop.id, BANK, '9000.00');
    expect(w.goalState(laptop.id).status).toBe('ACHIEVED');
    const closed = await w.service.close({
      workspaceId: WS,
      userId: EDITOR,
      goalId: laptop.id,
      expectedVersion: w.versionOf(laptop.id),
    });
    expect(closed.snapshot).toMatchObject({ status: 'CLOSED', closedOn: '2026-10-12' });
    expect(w.movementsOf(laptop.id).at(-1)).toMatchObject({
      kind: 'WITHDRAWAL',
      note: 'CLOSE',
      origin: 'SYSTEM',
    });
    expect(w.sumOf(laptop.id)).toBe('0.00');
  });

  it('[TC-GOALS-SAVINGS-008] una meta cancelada rechaza el aporte; cerrar o archivar una activa es INVALID_STATUS_TRANSITION', async () => {
    const w = world('2026-10-12T14:00:00.000Z');
    w.setBalance(BANK, '7000.00');
    const laptop = await w.laptop();
    const cancelled = await w.service.cancel({
      workspaceId: WS,
      userId: EDITOR,
      goalId: laptop.id,
      expectedVersion: laptop.version,
    });
    const fund = await w.emergencyFund();
    const attemptsBefore = w.transferAttempts;
    const movementsBefore = w.movementStore.length;

    expect(await codeOf(() => w.earmark(laptop.id, BANK, '100.00'))).toBe('GOAL_CLOSED');
    expect(
      await codeOf(() =>
        w.movements.contribute({
          workspaceId: WS,
          userId: EDITOR,
          goalId: laptop.id,
          fund: 'REAL',
          amount: { amount: '100.00', currency: 'BOB' },
          sourceAccountId: BANK,
          destinationAccountId: SAVINGS,
        }),
      ),
    ).toBe('GOAL_CLOSED');
    expect(w.transferAttempts).toBe(attemptsBefore);
    expect(w.movementStore).toHaveLength(movementsBefore);

    const act = { workspaceId: WS, userId: EDITOR, goalId: fund.id, expectedVersion: fund.version };
    expect(await codeOf(() => w.service.close(act))).toBe('INVALID_STATUS_TRANSITION');
    expect(await codeOf(() => w.service.archive(act))).toBe('INVALID_STATUS_TRANSITION');

    await w.service.archive({
      workspaceId: WS,
      userId: EDITOR,
      goalId: laptop.id,
      expectedVersion: cancelled.version,
    });
    expect((await w.queries.list(WS)).data.map((g) => g.name)).toEqual(['Fondo de emergencia']);
    expect((await w.queries.list(WS, { statuses: ['CANCELLED'], includeArchived: true })).data).toHaveLength(
      1,
    );
    // La meta activa seguía intacta.
    expect(w.goalState(fund.id).status).toBe('ACTIVE');
  });
});
