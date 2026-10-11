import { describe, expect, it } from 'vitest';
import type { SavingsGoal } from '../domain/index.js';
import type { SetPlanCommand } from './plan.service.js';
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

const world = (now = '2026-10-10T14:00:00.000Z') => new GoalsWorld(now);
const bob = (amount: string) => ({ amount, currency: 'BOB' });

const recurringPlan = (
  w: GoalsWorld,
  goal: SavingsGoal,
  over: Partial<SetPlanCommand> = {},
): SetPlanCommand => ({
  workspaceId: WS,
  userId: EDITOR,
  goalId: goal.id,
  expectedVersion: w.versionOf(goal.id),
  monthlyAmount: bob('1500.00'),
  fund: 'REAL',
  sourceAccountId: BANK,
  destinationAccountId: SAVINGS,
  dayOfMonth: 5,
  automation: 'RECURRING',
  materialization: { mode: 'PENDING_APPROVAL' },
  ...over,
});

const callsOf = (w: GoalsWorld, method: string) => w.recurringCalls.filter((c) => c.method === method);

describe('Plan de aporte mensual (TC-GOALS-SAVINGS-038..039)', () => {
  it('[TC-GOALS-SAVINGS-039] el aporte programado crea una definición TRANSFER administrada por la meta', async () => {
    const w = world();
    const fund = await w.emergencyFund();

    await w.plans.set(recurringPlan(w, fund));

    expect(w.recurringCalls.map((c) => c.method)).toEqual(['createManaged']);
    expect(w.recurringCalls[0]?.input).toMatchObject({
      workspaceId: WS,
      userId: EDITOR,
      managedBy: 'GOAL',
      managedRef: fund.id,
      kind: 'TRANSFER',
      accountId: BANK,
      toAccountId: SAVINGS,
      currency: 'BOB',
      amount: '1500.00',
      monthlyRule: { monthDays: [5], startDate: '2026-11-05', weekendAdjustment: 'NONE' },
      materialization: { mode: 'PENDING_APPROVAL' },
    });
    const plan = w.planStore.get(fund.id);
    expect(plan).toMatchObject({
      monthlyAmount: '1500.00',
      currency: 'BOB',
      automation: 'RECURRING',
      materializationMode: 'PENDING_APPROVAL',
      autoCreateStatus: null,
      version: 1,
    });
    expect(w.definition(plan?.definitionId as string)).toMatchObject({
      status: 'ACTIVE',
      managedRef: fund.id,
    });
    const view = await w.queries.get(WS, fund.id);
    expect(view.plan).toMatchObject({
      monthlyAmount: bob('1500.00'),
      dayOfMonth: 5,
      automation: 'RECURRING',
      materialization: { mode: 'PENDING_APPROVAL', autoCreateStatus: null },
      pendingContribution: false,
    });
    expect(w.auditActions()).toContain('goals.goal.plan_set');
  });

  it('[TC-GOALS-SAVINGS-039] el día de inicio cae en el mes siguiente si ya pasó y AUTO_CREATE conserva el estado de creación', async () => {
    const w = world('2026-10-05T14:00:00.000Z');
    const fund = await w.emergencyFund();
    await w.plans.set(
      recurringPlan(w, fund, {
        dayOfMonth: 5,
        materialization: { mode: 'AUTO_CREATE', autoCreateStatus: 'PENDING' },
      }),
    );
    expect(w.recurringCalls[0]?.input).toMatchObject({
      monthlyRule: { startDate: '2026-10-05' },
      materialization: { mode: 'AUTO_CREATE', autoCreateStatus: 'PENDING' },
    });
    expect(w.planStore.get(fund.id)).toMatchObject({
      materializationMode: 'AUTO_CREATE',
      autoCreateStatus: 'PENDING',
    });
  });

  it('[TC-GOALS-SAVINGS-039] cada ocurrencia aprobada se registra como un único aporte RECURRING aunque el hecho llegue dos veces', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    await w.plans.set(recurringPlan(w, fund));
    const definitionId = w.planStore.get(fund.id)?.definitionId as string;
    const { transactionId, event } = w.materializeOccurrence(definitionId, {
      date: '2026-11-05',
      status: 'POSTED',
    });

    await w.reactions.onOccurrenceMaterialized(event);
    await w.reactions.onOccurrenceMaterialized(event);

    const rows = w.movementsOf(fund.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fund: 'REAL',
      kind: 'CONTRIBUTION',
      origin: 'RECURRING',
      transactionId,
      accountId: SAVINGS,
      occurredOn: '2026-11-05',
      recordedBy: '00000000-0000-0000-0000-000000000000',
    });
    expect(rows[0]?.amount.toFixed()).toBe('1500.00');
    expect(w.materializationStore.get(transactionId)).toMatchObject({ status: 'RECORDED', goalId: fund.id });
    expect((await w.queries.get(WS, fund.id)).progress.total).toEqual(bob('1500.00'));
  });

  it('[TC-GOALS-SAVINGS-039] una ocurrencia PENDING espera y se completa con TransferCompleted; anulada espera libera', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    await w.plans.set(recurringPlan(w, fund));
    const definitionId = w.planStore.get(fund.id)?.definitionId as string;
    const waiting = w.materializeOccurrence(definitionId, { date: '2026-11-05', status: 'PENDING' });

    await w.reactions.onOccurrenceMaterialized(waiting.event);

    expect(w.movementsOf(fund.id)).toHaveLength(0);
    expect(w.materializationStore.get(waiting.transactionId)?.status).toBe('WAITING');
    expect((await w.queries.get(WS, fund.id)).plan?.pendingContribution).toBe(true);

    const completed = w.completeTransfer(waiting.transactionId);
    await w.reactions.onTransferCompleted(completed);
    await w.reactions.onTransferCompleted(completed);

    expect(w.movementsOf(fund.id).map((m) => [m.origin, m.amount.toFixed()])).toEqual([
      ['RECURRING', '1500.00'],
    ]);
    expect(w.materializationStore.get(waiting.transactionId)?.status).toBe('RECORDED');
    expect((await w.queries.get(WS, fund.id)).plan?.pendingContribution).toBe(false);
    // Una transferencia de la programación nunca se sugiere como aporte manual.
    expect(w.suggestionStore).toHaveLength(0);

    const second = w.materializeOccurrence(definitionId, { date: '2026-12-05', status: 'PENDING' });
    await w.reactions.onOccurrenceMaterialized(second.event);
    w.voidTransaction(second.transactionId);
    await w.reactions.onTransactionChange(w.voidedEvent(second.transactionId));
    expect(w.materializationStore.get(second.transactionId)?.status).toBe('RELEASED');
    await w.reactions.onTransferCompleted(w.transferCompletedEvent(second.transactionId));
    expect(w.movementsOf(fund.id)).toHaveLength(1);
    expect((await w.queries.get(WS, fund.id)).plan?.pendingContribution).toBe(false);
  });

  it('[TC-GOALS-SAVINGS-039] ocurrencias de otro administrador, sin plan o anuladas se ignoran', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    await w.plans.set(recurringPlan(w, fund));
    const definitionId = w.planStore.get(fund.id)?.definitionId as string;
    const tx = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '1500.00' });
    const payload = { definitionId, occurrenceId: w.nextId(), transactionId: tx };

    await w.reactions.onOccurrenceMaterialized(
      w.event('commitments.RecurringOccurrenceMaterialized', { ...payload, managedBy: 'DEBT' }),
    );
    await w.reactions.onOccurrenceMaterialized(
      w.event('commitments.RecurringOccurrenceMaterialized', {
        ...payload,
        managedBy: 'GOAL',
        definitionId: 'otra',
      }),
    );
    await w.reactions.onOccurrenceMaterialized(
      w.event('commitments.RecurringOccurrenceMaterialized', { managedBy: 'GOAL' }),
    );
    w.voidTransaction(tx);
    await w.reactions.onOccurrenceMaterialized(
      w.event('commitments.RecurringOccurrenceMaterialized', { ...payload, managedBy: 'GOAL' }),
    );

    expect(w.movementStore).toHaveLength(0);
    expect(w.materializationStore.size).toBe(0);
  });

  it('[TC-GOALS-SAVINGS-039] pausar la meta pausa la definición y reanudarla la reanuda', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    await w.plans.set(recurringPlan(w, fund));
    const definitionId = w.planStore.get(fund.id)?.definitionId as string;
    const act = () => ({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      expectedVersion: w.versionOf(fund.id),
    });

    await w.service.pause(act());
    expect(callsOf(w, 'pauseManaged').map((c) => c.input['definitionId'])).toEqual([definitionId]);
    expect(w.definition(definitionId).status).toBe('PAUSED');

    await w.service.resume(act());
    expect(callsOf(w, 'resumeManaged')).toHaveLength(1);
    expect(w.definition(definitionId).status).toBe('ACTIVE');
  });

  it('[TC-GOALS-SAVINGS-039] cancelar la meta termina la definición y quita la programación del plan', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    await w.plans.set(recurringPlan(w, fund));
    const definitionId = w.planStore.get(fund.id)?.definitionId as string;

    await w.service.cancel({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      expectedVersion: w.versionOf(fund.id),
    });

    expect(callsOf(w, 'end')[0]?.input).toMatchObject({ definitionId, from: '2026-10-10' });
    expect(w.definition(definitionId).status).toBe('ENDED');
    expect(w.planStore.get(fund.id)).toMatchObject({
      automation: 'NONE',
      definitionId: null,
      materializationMode: null,
    });
  });

  it('[TC-GOALS-SAVINGS-039] crear el plan con la meta pausada pausa la definición; revisar el monto la revisa; quitarlo la termina', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    await w.service.pause({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      expectedVersion: fund.version,
    });
    await w.plans.set(recurringPlan(w, fund));
    const definitionId = w.planStore.get(fund.id)?.definitionId as string;
    expect(w.recurringCalls.map((c) => c.method)).toEqual(['createManaged', 'pauseManaged']);

    await w.plans.set(recurringPlan(w, fund, { monthlyAmount: bob('1800.00'), dayOfMonth: 10 }));
    expect(callsOf(w, 'reviseManaged')[0]?.input).toMatchObject({
      definitionId,
      amount: '1800.00',
      monthDays: [10],
      accountId: BANK,
      toAccountId: SAVINGS,
      effectiveFrom: '2026-10-10',
    });
    expect(w.planStore.get(fund.id)).toMatchObject({ monthlyAmount: '1800.00', definitionId, version: 2 });

    await w.plans.remove({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      expectedVersion: w.versionOf(fund.id),
    });
    expect(callsOf(w, 'end')).toHaveLength(1);
    expect(w.planStore.has(fund.id)).toBe(false);
    expect(w.auditActions()).toEqual(
      expect.arrayContaining(['goals.goal.plan_set', 'goals.goal.plan_removed']),
    );
  });

  it('[TC-GOALS-SAVINGS-039] pasar de RECURRING a NONE termina la definición', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    await w.plans.set(recurringPlan(w, fund));
    await w.plans.set(recurringPlan(w, fund, { automation: 'NONE' }));
    expect(callsOf(w, 'end')).toHaveLength(1);
    expect(w.planStore.get(fund.id)).toMatchObject({ automation: 'NONE', definitionId: null });
  });

  it('[TC-GOALS-SAVINGS-039] un fallo después de crear la definición revierte el plan y la definición', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    w.failures.add('audit:goals.goal.plan_set');
    await expect(w.plans.set(recurringPlan(w, fund))).rejects.toThrow('injected failure');
    w.failures.clear();
    expect(w.recurringCalls).toEqual([]);
    expect(w.definitionStore.size).toBe(0);
    expect(w.planStore.size).toBe(0);
    expect(w.versionOf(fund.id)).toBe(1);
  });

  it('[TC-GOALS-SAVINGS-038] un plan en otra moneda que la del objetivo se rechaza con CURRENCY_MISMATCH', async () => {
    const w = world();
    const trip = await w.createGoal({
      name: 'Viaje a Cusco',
      target: { amount: '2000.00', currency: 'USD' },
    });
    const err = await errorOf(() =>
      w.plans.set({
        workspaceId: WS,
        userId: EDITOR,
        goalId: trip.id,
        expectedVersion: trip.version,
        monthlyAmount: bob('1000.00'),
        fund: 'REAL',
        automation: 'NONE',
      }),
    );
    expect(err.code).toBe('CURRENCY_MISMATCH');
    expect(w.planStore.size).toBe(0);
    expect(w.versionOf(trip.id)).toBe(1);
  });

  it('[TC-GOALS-SAVINGS-038] validaciones del plan: cuentas, día, fondo, versión y moneda de las cuentas', async () => {
    const w = world();
    const fund = await w.emergencyFund({ linkedAccountIds: [SAVINGS, USD_CASH] });
    const set = (over: Partial<SetPlanCommand>) => codeOf(() => w.plans.set(recurringPlan(w, fund, over)));

    expect(await set({ sourceAccountId: null })).toBe('VALIDATION_FAILED');
    expect(await set({ destinationAccountId: null })).toBe('VALIDATION_FAILED');
    expect(await set({ dayOfMonth: null })).toBe('VALIDATION_FAILED');
    expect(await set({ dayOfMonth: 32 })).toBe('VALIDATION_FAILED');
    expect(await set({ fund: 'EARMARK' })).toBe('VALIDATION_FAILED');
    expect(await set({ sourceAccountId: SAVINGS })).toBe('VALIDATION_FAILED');
    expect(await set({ destinationAccountId: CASH })).toBe('GOAL_ACCOUNT_NOT_LINKED');
    expect(await set({ sourceAccountId: USD_CASH })).toBe('CURRENCY_MISMATCH');
    expect(await set({ expectedVersion: 9 })).toBe('PRECONDITION_FAILED');
    expect(await set({ monthlyAmount: bob('0.00') })).toBe('AMOUNT_NOT_POSITIVE');
    expect(
      await codeOf(() =>
        w.plans.remove({ workspaceId: WS, userId: EDITOR, goalId: fund.id, expectedVersion: fund.version }),
      ),
    ).toBe('RESOURCE_NOT_FOUND');
    expect(w.recurringCalls).toEqual([]);
    expect(w.planStore.size).toBe(0);
  });

  it('[TC-GOALS-SAVINGS-039] con una programación activa no se puede cambiar la moneda ni desvincular la cuenta destino', async () => {
    const w = world();
    const fund = await w.emergencyFund({ linkedAccountIds: [SAVINGS, USD_CASH] });
    await w.plans.set(recurringPlan(w, fund));
    const edit = () => ({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      expectedVersion: w.versionOf(fund.id),
    });

    expect(
      await codeOf(() => w.service.update({ ...edit(), target: { amount: '100.00', currency: 'USD' } })),
    ).toBe('GOAL_CURRENCY_LOCKED');
    expect(await codeOf(() => w.service.update({ ...edit(), linkedAccountIds: [USD_CASH] }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(w.goalState(fund.id).linkedAccountIds).toEqual([SAVINGS, USD_CASH]);
  });
});
