import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PROCESS_USER } from './recorder.js';
import { BANK, CASH, EDITOR, SAVINGS, WS, GoalsWorld, codeOf, errorOf } from './testing/goals-world.js';

const world = (now = '2026-10-15T14:00:00.000Z') => new GoalsWorld(now);
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const exceeds = (w: GoalsWorld) => w.eventsOf('goals.EarmarkExceedsBalance');

/** "Banco BOB" con 7000.00 BOB reservados entre "Laptop" (4000.00) y "Fondo de emergencia" (3000.00). */
async function fullyReserved(w: GoalsWorld) {
  w.setBalance(BANK, '7000.00');
  const laptop = await w.laptop();
  const fund = await w.emergencyFund();
  await w.earmark(laptop.id, BANK, '4000.00');
  await w.earmark(fund.id, BANK, '3000.00');
  return { laptop, fund };
}

describe('Sobre-asignación de una cuenta (TC-GOALS-SAVINGS-016..018)', () => {
  it('[TC-GOALS-SAVINGS-016] un gasto que deja la cuenta bajo lo reservado la marca sobre-asignada y publica un solo hecho', async () => {
    const w = world();
    const { laptop, fund } = await fullyReserved(w);
    expect(exceeds(w)).toHaveLength(0);

    w.seedExpense({ account: BANK, amount: '1200.00' });
    const posted = w.journalPostedEvent([BANK]);
    await w.reactions.onJournalEntryPosted(posted);
    await w.reactions.onJournalEntryPosted(posted);

    expect(w.stateStore.get(BANK)).toMatchObject({
      state: 'OVER_ALLOCATED',
      shortfall: '1200.00',
      currency: 'BOB',
      since: '2026-10-15',
    });
    expect(exceeds(w)).toHaveLength(1);
    const [fact] = exceeds(w);
    expect(fact?.aggregateType).toBe('Account');
    expect(fact?.payload).toMatchObject({
      accountId: BANK,
      accountName: 'Banco BOB',
      episodeId: w.stateStore.get(BANK)?.episodeId,
      balance: bob('5800.00'),
      reserved: bob('7000.00'),
      shortfall: bob('1200.00'),
      detectedOn: '2026-10-15',
    });
    expect(fact?.payload['goals']).toEqual(
      [
        { goalId: laptop.id, goalName: 'Laptop', reserved: bob('4000.00') },
        { goalId: fund.id, goalName: 'Fondo de emergencia', reserved: bob('3000.00') },
      ].sort((a, b) => (a.goalId < b.goalId ? -1 : 1)),
    );
    expect(w.auditActions().filter((a) => a === 'goals.reservation.over_allocated')).toHaveLength(1);

    const [view] = await w.queries.reservations(WS, { accountId: BANK });
    expect(view).toMatchObject({
      overAllocated: true,
      shortfall: '1200.00',
      since: '2026-10-15',
      available: '-1200.00',
    });
    const goals = (await w.queries.list(WS)).data;
    expect(goals.map((g) => [g.name, g.overAllocated])).toEqual([
      ['Fondo de emergencia', true],
      ['Laptop', true],
    ]);
    expect((await w.queries.getReservedByAccount({ workspaceId: WS }))[0]).toMatchObject({
      accountId: BANK,
      overAllocated: true,
    });
  });

  it('[TC-GOALS-SAVINGS-017] dentro del episodio solo cambia el faltante; un ingreso lo cierra y la próxima caída abre otro', async () => {
    const w = world();
    await fullyReserved(w);
    const onPosted = () => w.reactions.onJournalEntryPosted(w.journalPostedEvent([BANK]));
    w.seedExpense({ account: BANK, amount: '1200.00' });
    await onPosted();
    const firstEpisode = w.stateStore.get(BANK)?.episodeId;

    w.seedExpense({ account: BANK, amount: '100.00' });
    await onPosted();
    expect(w.stateStore.get(BANK)).toMatchObject({ state: 'OVER_ALLOCATED', shortfall: '1300.00' });
    expect(w.stateStore.get(BANK)?.episodeId).toBe(firstEpisode);
    expect(exceeds(w)).toHaveLength(1);

    w.seedIncome({ account: BANK, amount: '2000.00' });
    await onPosted();
    expect(w.stateStore.get(BANK)).toMatchObject({ state: 'NORMAL', episodeId: null, shortfall: null });
    expect(exceeds(w)).toHaveLength(1);
    expect((await w.queries.list(WS)).data.every((g) => !g.overAllocated)).toBe(true);
    expect(w.auditActions().filter((a) => a === 'goals.reservation.resolved')).toHaveLength(1);

    w.seedExpense({ account: BANK, amount: '800.00' });
    await onPosted();
    expect(w.balanceOf(BANK)).toBe('6900.00');
    expect(w.stateStore.get(BANK)).toMatchObject({ state: 'OVER_ALLOCATED', shortfall: '100.00' });
    expect(exceeds(w)).toHaveLength(2);
    expect(exceeds(w)[1]?.payload['episodeId']).not.toBe(firstEpisode);
    expect(exceeds(w)[1]?.payload['episodeId']).toBe(w.stateStore.get(BANK)?.episodeId);
  });

  it('[TC-GOALS-SAVINGS-018] un gasto pendiente no cambia el saldo contable: ni el hecho ni el job diario sobre-asignan', async () => {
    const w = world();
    await fullyReserved(w);
    w.seedExpense({ account: BANK, amount: '500.00', status: 'PENDING' });

    expect(await w.reactions.runDaily(WS)).toEqual({ reached: 0, accounts: 1 });

    expect(w.balanceOf(BANK)).toBe('7000.00');
    expect(w.stateStore.get(BANK)?.state ?? 'NORMAL').toBe('NORMAL');
    expect(exceeds(w)).toHaveLength(0);
    const [view] = await w.queries.reservations(WS, { accountId: BANK });
    expect(view).toMatchObject({ overAllocated: false, available: '0.00' });
  });

  it('[TC-GOALS-SAVINGS-018] el barrido diario cubre un hecho de ledger perdido y un asiento sin cuentas se ignora', async () => {
    const w = world();
    await fullyReserved(w);
    w.seedExpense({ account: BANK, amount: '1200.00' });
    await w.reactions.onJournalEntryPosted(w.event('ledger.JournalEntryPosted', { postings: [] }));
    await w.reactions.onJournalEntryPosted(w.event('ledger.JournalEntryPosted', { postings: 'x' }));
    expect(exceeds(w)).toHaveLength(0);

    await w.reactions.runDaily(WS);

    expect(exceeds(w)).toHaveLength(1);
    expect(w.stateStore.get(BANK)).toMatchObject({ state: 'OVER_ALLOCATED', shortfall: '1200.00' });
  });

  it('[TC-GOALS-SAVINGS-016] reservar más de lo disponible nunca abre un episodio y cancelar la meta libera la cuenta', async () => {
    const w = world();
    const { laptop } = await fullyReserved(w);
    w.seedExpense({ account: BANK, amount: '1200.00' });
    await w.reactions.onJournalEntryPosted(w.journalPostedEvent([BANK]));
    expect(w.stateStore.get(BANK)?.state).toBe('OVER_ALLOCATED');

    await w.service.cancel({
      workspaceId: WS,
      userId: EDITOR,
      goalId: laptop.id,
      expectedVersion: w.versionOf(laptop.id),
    });

    // Al liberar 4000.00 el reservado (3000.00) vuelve a caber en 5800.00: el episodio se cierra en el mismo comando.
    expect(w.stateStore.get(BANK)).toMatchObject({ state: 'NORMAL', shortfall: null });
  });
});

describe('Anulación y revisión de la transacción de un movimiento (TC-GOALS-SAVINGS-022..023)', () => {
  /** "Fondo de emergencia" con 1500.00 BOB: 1000.00 sembrados y 500.00 por la transferencia vinculada del 2026-10-20. */
  async function fundWithLinkedTransfer(w: GoalsWorld) {
    const fund = await w.emergencyFund();
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '1000.00', accountId: SAVINGS });
    const txId = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '500.00', businessDate: '2026-10-20' });
    const linked = await w.linkTransaction(fund.id, txId);
    return { fund, txId, linked };
  }

  it('[TC-GOALS-SAVINGS-022] anular la transferencia registra un solo REVERSAL aunque el hecho llegue dos veces', async () => {
    const w = world('2026-10-22T14:00:00.000Z');
    const { fund, txId, linked } = await fundWithLinkedTransfer(w);
    expect((await w.queries.get(WS, fund.id)).progress.total).toEqual(bob('1500.00'));
    w.voidTransaction(txId);
    const voided = w.voidedEvent(txId);

    await w.reactions.onTransactionChange(voided);
    await w.reactions.onTransactionChange(voided);

    const reversals = w.movementsOf(fund.id).filter((m) => m.kind === 'REVERSAL');
    expect(reversals).toHaveLength(1);
    expect(reversals[0]).toMatchObject({
      reversesId: linked.id,
      transactionId: txId,
      transactionRevision: 1,
      origin: 'SYSTEM',
      occurredOn: '2026-10-22',
      recordedBy: PROCESS_USER,
    });
    expect(reversals[0]?.amount.toFixed()).toBe('-500.00');
    expect((await w.queries.get(WS, fund.id)).progress.total).toEqual(bob('1000.00'));
    expect(w.movementStore.find((m) => m.id === linked.id)).toBeDefined();
    const page = await w.queries.movements(WS, fund.id);
    expect(page.data.map((m) => m.movement)).toEqual(['REVERSAL', 'CONTRIBUTION', 'CONTRIBUTION']);
    expect(
      recorded(w)
        .filter((e) => e.payload['movement'] === 'REVERSAL')
        .map((e) => [e.payload['reversesId'], e.payload['amount']]),
    ).toEqual([[linked.id, bob('-500.00')]]);
  });

  it('[TC-GOALS-SAVINGS-022] anular una transferencia sin aportes, desconocida o sin id no hace nada', async () => {
    const w = world();
    const unrelated = w.seedTransfer({ from: BANK, to: CASH, amount: '10.00' });
    const before = w.movementStore.length;
    await w.reactions.onTransactionChange(w.voidedEvent(unrelated));
    await w.reactions.onTransactionChange(w.voidedEvent('desconocida'));
    await w.reactions.onTransactionChange(w.event('transactions.TransactionVoided', {}));
    await w.reactions.onTransactionChange(w.event('transactions.TransactionVoided', null));
    expect(w.movementStore).toHaveLength(before);
  });

  it('[TC-GOALS-SAVINGS-022] anular el aporte que alcanzó el objetivo reabre la meta', async () => {
    const w = world();
    const fund = await w.emergencyFund({ target: bob('1500.00') });
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '1000.00', accountId: SAVINGS });
    const txId = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '500.00' });
    await w.linkTransaction(fund.id, txId);
    expect(w.goalState(fund.id).status).toBe('ACHIEVED');

    w.voidTransaction(txId);
    await w.reactions.onTransactionChange(w.voidedEvent(txId));

    expect(w.goalState(fund.id).status).toBe('ACTIVE');
    expect(w.eventsOf('goals.GoalReached')).toHaveLength(1);
  });

  it('[TC-GOALS-SAVINGS-023] revisar el monto a 450.00 invierte el aporte y registra uno nuevo con la revisión 2', async () => {
    const w = world();
    const { fund, txId, linked } = await fundWithLinkedTransfer(w);
    const revised = w.reviseTransfer(txId, { amount: '450.00' });

    await w.reactions.onTransactionChange(revised);
    await w.reactions.onTransactionChange(revised);

    const rows = w.movementsOf(fund.id).filter((m) => m.transactionId === txId);
    expect(rows.map((m) => [m.kind, m.amount.toFixed(), m.transactionRevision])).toEqual([
      ['CONTRIBUTION', '500.00', 1],
      ['REVERSAL', '-500.00', 1],
      ['CONTRIBUTION', '450.00', 2],
    ]);
    expect(rows[1]?.reversesId).toBe(linked.id);
    expect(rows[2]).toMatchObject({ origin: 'USER', accountId: SAVINGS });
    expect((await w.queries.get(WS, fund.id)).progress.total).toEqual(bob('1450.00'));
    // La revisión vigente ya respalda el aporte: no se propone como sugerencia.
    expect((await w.queries.suggestions(WS)).data).toEqual([]);
  });

  it('[TC-GOALS-SAVINGS-023] revisar el destino a una cuenta no vinculada solo invierte el aporte', async () => {
    const w = world();
    const { fund, txId } = await fundWithLinkedTransfer(w);

    await w.reactions.onTransactionChange(w.reviseTransfer(txId, { toAccountId: CASH }));

    expect(
      w
        .movementsOf(fund.id)
        .filter((m) => m.transactionId === txId)
        .map((m) => [m.kind, m.amount.toFixed(), m.transactionRevision]),
    ).toEqual([
      ['CONTRIBUTION', '500.00', 1],
      ['REVERSAL', '-500.00', 1],
    ]);
    expect((await w.queries.get(WS, fund.id)).progress.total).toEqual(bob('1000.00'));
  });

  it('[TC-GOALS-SAVINGS-023] un retiro se invierte solo si la transferencia revisada ya no lo cubre', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '1000.00', accountId: SAVINGS });
    const withdrawal = await w.movements.withdraw({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      fund: 'REAL',
      accountId: SAVINGS,
      amount: bob('400.00'),
      mode: { type: 'TRANSFER', toAccountId: BANK },
    });
    const txId = withdrawal.transactionId as string;

    await w.reactions.onTransactionChange(w.reviseTransfer(txId, { amount: '450.00' }));
    expect(w.movementsOf(fund.id).filter((m) => m.kind === 'REVERSAL')).toHaveLength(0);

    await w.reactions.onTransactionChange(w.reviseTransfer(txId, { amount: '300.00' }));
    expect(w.movementsOf(fund.id).filter((m) => m.kind === 'REVERSAL')).toHaveLength(1);
    expect((await w.queries.get(WS, fund.id)).progress.total).toEqual(bob('1000.00'));
  });

  it('[TC-GOALS-SAVINGS-023] editar el monto de un gasto vinculado como retiro invierte el retiro si ya no lo cubre', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    w.seedMovement({ goalId: fund.id, fund: 'REAL', amount: '1000.00', accountId: SAVINGS });
    const expense = w.seedExpense({ account: SAVINGS, amount: '300.00' });
    await w.movements.withdraw({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      fund: 'REAL',
      accountId: SAVINGS,
      amount: bob('300.00'),
      mode: { type: 'LINK', transactionId: expense },
    });
    const updated = (changedFields: string[]) =>
      w.event('transactions.TransactionUpdated', { transactionId: expense, changedFields });

    await w.reactions.onTransactionChange(updated(['description']));
    expect(w.movementsOf(fund.id).filter((m) => m.kind === 'REVERSAL')).toHaveLength(0);

    w.txStore.set(expense, { ...w.transaction(expense), amount: bob('250.00') });
    await w.reactions.onTransactionChange(updated(['amount']));
    await w.reactions.onTransactionChange(updated(['amount']));

    expect(w.movementsOf(fund.id).filter((m) => m.kind === 'REVERSAL')).toHaveLength(1);
    expect((await w.queries.get(WS, fund.id)).progress.total).toEqual(bob('1000.00'));
  });

  it('[TC-GOALS-SAVINGS-029] anular el aporte tras retirar parte de él deja el fondo REAL negativo (observación de diseño)', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    w.setBalance(BANK, '5000.00');
    const row = await w.contribute(fund.id, '1000.00');
    await w.movements.withdraw({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      fund: 'REAL',
      accountId: SAVINGS,
      amount: bob('400.00'),
      mode: { type: 'TRANSFER', toAccountId: BANK },
    });
    w.voidTransaction(row.transactionId as string);
    await w.reactions.onTransactionChange(w.voidedEvent(row.transactionId as string));

    const [real] = await w.deps.movements.funds(WS, { goalIds: [fund.id] });
    expect(real?.amount).toBe('-400.00');
  });
});

describe('Alcanzar el objetivo por tipo de cambio (TC-GOALS-SAVINGS-037)', () => {
  it('[TC-GOALS-SAVINGS-037] el job diario alcanza la meta con trigger RATE_CHANGE y no la reabre cuando la tasa baja', async () => {
    const w = world('2026-10-01T14:00:00.000Z');
    w.setBalance(BANK, '20000.00');
    const trip = await w.createGoal({ name: 'Viaje', target: { amount: '1000.00', currency: 'USD' } });
    w.setRate('USD', 'BOB', '12.50');
    await w.earmark(trip.id, BANK, '11000.00');
    expect(w.goalState(trip.id).status).toBe('ACTIVE');
    expect((await w.queries.get(WS, trip.id)).progress.total).toEqual({ amount: '880.00', currency: 'USD' });

    w.setNow('2026-10-02T14:00:00.000Z');
    w.setRate('USD', 'BOB', '10.00');
    expect(await w.reactions.runDaily(WS)).toMatchObject({ reached: 1 });

    expect(w.goalState(trip.id).status).toBe('ACHIEVED');
    expect(w.eventsOf('goals.GoalReached')).toHaveLength(1);
    expect(w.eventsOf('goals.GoalReached')[0]?.payload).toMatchObject({
      trigger: 'RATE_CHANGE',
      reachedOn: '2026-10-02',
      progress: { amount: '1100.00', currency: 'USD' },
    });
    // Idempotente: el mismo día no vuelve a alcanzar.
    expect(await w.reactions.runDaily(WS)).toMatchObject({ reached: 0 });

    w.setNow('2026-10-03T14:00:00.000Z');
    w.setRate('USD', 'BOB', '14.00');
    expect(await w.reactions.runDaily(WS)).toMatchObject({ reached: 0 });
    expect(w.goalState(trip.id).status).toBe('ACHIEVED');
    expect(w.eventsOf('goals.GoalReached')).toHaveLength(1);
    expect(w.auditActions()).not.toContain('goals.goal.reopened');
  });

  it('[TC-GOALS-SAVINGS-037] sin tasa vigente el job diario no alcanza la meta ni inventa una conversión 1:1', async () => {
    const w = world('2026-10-01T14:00:00.000Z');
    w.setBalance(BANK, '20000.00');
    const trip = await w.createGoal({ name: 'Viaje', target: { amount: '1000.00', currency: 'USD' } });
    await w.earmark(trip.id, BANK, '11000.00');
    expect(await w.reactions.runDaily(WS)).toMatchObject({ reached: 0 });
    expect(w.goalState(trip.id).status).toBe('ACTIVE');
  });
});

describe('Sugerencias de aporte (TC-GOALS-SAVINGS-040)', () => {
  const confirm = (w: GoalsWorld, suggestionId: string, goalId?: string) =>
    w.movements.confirmSuggestion({
      workspaceId: WS,
      userId: EDITOR,
      suggestionId,
      ...(goalId ? { goalId } : {}),
    });
  const dismiss = (w: GoalsWorld, suggestionId: string) =>
    w.movements.dismissSuggestion({ workspaceId: WS, userId: EDITOR, suggestionId });

  it('[TC-GOALS-SAVINGS-040] una transferencia manual se sugiere y solo se registra al confirmarla', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    const tx = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '700.00' });

    await w.reactions.onTransferCompleted(w.transferCompletedEvent(tx));

    const { data, pendingCount } = await w.queries.suggestions(WS);
    expect(pendingCount).toBe(1);
    expect(data).toEqual([
      expect.objectContaining({
        transactionId: tx,
        transactionRevision: 1,
        accountId: SAVINGS,
        amount: bob('700.00'),
        goalId: fund.id,
        status: 'PENDING',
        movementId: null,
      }),
    ]);
    expect(w.movementStore).toHaveLength(0);

    const row = await confirm(w, data[0]?.id as string);

    expect(row).toMatchObject({
      fund: 'REAL',
      kind: 'CONTRIBUTION',
      origin: 'SUGGESTION',
      transactionId: tx,
    });
    expect(row.amount.toFixed()).toBe('700.00');
    const [decided] = (await w.queries.suggestions(WS, 'CONFIRMED')).data;
    expect(decided).toMatchObject({ status: 'CONFIRMED', movementId: row.id });
    expect((await w.queries.suggestions(WS)).pendingCount).toBe(0);
    expect(w.auditActions()).toContain('goals.suggestion.confirmed');
    expect(await codeOf(() => confirm(w, data[0]?.id as string))).toBe('GOAL_SUGGESTION_NOT_PENDING');
  });

  it('[TC-GOALS-SAVINGS-040] una sugerencia descartada no se vuelve a proponer aunque el hecho se reenvíe', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    const tx = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '300.00' });
    const completed = w.transferCompletedEvent(tx);
    await w.reactions.onTransferCompleted(completed);
    const [pending] = (await w.queries.suggestions(WS)).data;

    const dismissed = await dismiss(w, pending?.id as string);
    expect(dismissed).toMatchObject({ status: 'DISMISSED', decidedBy: EDITOR });
    await w.reactions.onTransferCompleted(completed);

    expect(w.movementsOf(fund.id)).toHaveLength(0);
    expect((await w.queries.suggestions(WS)).data).toEqual([]);
    expect((await w.queries.suggestions(WS, 'DISMISSED')).data).toHaveLength(1);
    expect(w.suggestionStore).toHaveLength(1);
    expect(await codeOf(() => dismiss(w, pending?.id as string))).toBe('GOAL_SUGGESTION_NOT_PENDING');
    expect(await codeOf(() => dismiss(w, 'desconocida'))).toBe('RESOURCE_NOT_FOUND');
    expect(w.auditActions()).toContain('goals.suggestion.dismissed');
  });

  it('[TC-GOALS-SAVINGS-040] una transferencia con origen GOAL, a una cuenta sin metas o de otro tipo no genera sugerencia', async () => {
    const w = world();
    w.setBalance(BANK, '5000.00');
    const fund = await w.emergencyFund();
    const own = await w.contribute(fund.id, '100.00');
    const toCash = w.seedTransfer({ from: BANK, to: CASH, amount: '50.00' });
    const expense = w.seedExpense({ account: SAVINGS, amount: '20.00' });
    const pending = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '60.00', status: 'PENDING' });
    for (const id of [own.transactionId as string, toCash, expense, pending, 'desconocida']) {
      await w.reactions.onTransferCompleted(w.transferCompletedEvent(id));
    }
    await w.reactions.onTransferCompleted(w.event('transactions.TransferCompleted', {}));
    expect(w.suggestionStore).toHaveLength(0);
  });

  it('[TC-GOALS-SAVINGS-040] con la cuenta vinculada a dos metas la sugerencia no trae meta y confirmar exige elegirla', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    const laptop = await w.laptop({ linkedAccountIds: [SAVINGS] });
    const tx = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '250.00' });
    await w.reactions.onTransferCompleted(w.transferCompletedEvent(tx));
    const [suggestion] = (await w.queries.suggestions(WS)).data;
    expect(suggestion?.goalId).toBeNull();

    expect(await codeOf(() => confirm(w, suggestion?.id as string))).toBe('VALIDATION_FAILED');
    expect(w.movementStore).toHaveLength(0);
    const row = await confirm(w, suggestion?.id as string, laptop.id);

    expect(row.goalId).toBe(laptop.id);
    expect(w.movementsOf(fund.id)).toHaveLength(0);
  });

  it('[TC-GOALS-SAVINGS-040] anular o revisar la transferencia expira la sugerencia y la revisión propone una nueva', async () => {
    const w = world();
    await w.emergencyFund();
    const voidedTx = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '100.00' });
    const revisedTx = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '200.00' });
    await w.reactions.onTransferCompleted(w.transferCompletedEvent(voidedTx));
    await w.reactions.onTransferCompleted(w.transferCompletedEvent(revisedTx));
    const original = w.suggestionStore.find((s) => s.transactionId === voidedTx)?.id as string;
    const old = w.suggestionStore.find((s) => s.transactionId === revisedTx)?.id as string;

    w.voidTransaction(voidedTx);
    await w.reactions.onTransactionChange(w.voidedEvent(voidedTx));
    await w.reactions.onTransactionChange(w.reviseTransfer(revisedTx, { amount: '220.00' }));

    expect(w.suggestionStore.find((s) => s.id === original)?.status).toBe('EXPIRED');
    expect(w.suggestionStore.find((s) => s.id === old)?.status).toBe('EXPIRED');
    const pending = (await w.queries.suggestions(WS)).data;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      transactionId: revisedTx,
      transactionRevision: 2,
      amount: bob('220.00'),
    });
    expect(await codeOf(() => confirm(w, original))).toBe('GOAL_SUGGESTION_NOT_PENDING');
  });

  it('[TC-GOALS-SAVINGS-040] confirmar tras revisar la transferencia sin que se haya procesado el hecho falla por revisión', async () => {
    const w = world();
    await w.emergencyFund();
    const tx = w.seedTransfer({ from: BANK, to: SAVINGS, amount: '200.00' });
    await w.reactions.onTransferCompleted(w.transferCompletedEvent(tx));
    const [suggestion] = (await w.queries.suggestions(WS)).data;
    w.reviseTransfer(tx, { amount: '210.00' });

    const err = await errorOf(() => confirm(w, suggestion?.id as string));

    expect(err.code).toBe('GOAL_SUGGESTION_NOT_PENDING');
    expect(w.movementStore).toHaveLength(0);
  });

  it('[TC-GOALS-SAVINGS-040] una meta pausada recibe sugerencias y una cancelada no', async () => {
    const w = world();
    const fund = await w.emergencyFund();
    await w.service.pause({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      expectedVersion: fund.version,
    });
    await w.reactions.onTransferCompleted(
      w.transferCompletedEvent(w.seedTransfer({ from: BANK, to: SAVINGS, amount: '10.00' })),
    );
    expect(w.suggestionStore).toHaveLength(1);
    await w.service.cancel({
      workspaceId: WS,
      userId: EDITOR,
      goalId: fund.id,
      expectedVersion: w.versionOf(fund.id),
    });
    await w.reactions.onTransferCompleted(
      w.transferCompletedEvent(w.seedTransfer({ from: BANK, to: SAVINGS, amount: '20.00' })),
    );
    expect(w.suggestionStore).toHaveLength(1);
  });
});

const recorded = (w: GoalsWorld) => w.eventsOf('goals.SavingsContributionRecorded');

describe('Vigilancia de saldos agrupada (optimize-consumer-throughput)', () => {
  it('[TC-PLATFORM-THROUGHPUT-007] los mismos asientos entregados de a uno o agrupados, en cualquier orden, dejan el mismo estado de sobre-asignación y los mismos hechos', async () => {
    const accounts = [BANK, CASH, SAVINGS] as const;
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.subarray([...accounts], { minLength: 1 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 3000 }),
        async (entries, spent) => {
          const run = async (grouped: boolean) => {
            const w = world();
            await fullyReserved(w);
            w.seedExpense({ account: BANK, amount: `${String(spent)}.00` });
            const events = entries.map((ids) => w.journalPostedEvent(ids));
            if (grouped) await w.reactions.onJournalEntriesPosted(WS, [...events].reverse());
            else for (const e of events) await w.reactions.onJournalEntryPosted(e);
            return {
              states: [...w.stateStore.entries()].map(([k, v]) => [k, v.state, v.shortfall]),
              facts: exceeds(w).length,
            };
          };
          expect(await run(true)).toEqual(await run(false));
        },
      ),
      { numRuns: 30 },
    );
  }, 60_000);
});
