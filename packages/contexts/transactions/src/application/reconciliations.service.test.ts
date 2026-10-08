import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ReconciliationsService } from './reconciliations.service.js';
import { inMemoryTransactionsDeps } from './testing/in-memory.js';
import { TransactionsService, type RecordTransactionCommand } from './transactions.service.js';

const WS = 'ws-1';
const USER = 'user-1';
const BANK = 'bank-a';
const CASH = 'caja-bob';
const VISA = 'visa';
const ARCHIVED = 'bank-archived';
const CLOSED_ACCOUNT = 'bank-closed';

function setup() {
  const mem = inMemoryTransactionsDeps({
    accounts: [
      { accountId: BANK, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: CASH, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: VISA, currency: 'BOB', nature: 'LIABILITY', status: 'ACTIVE' },
      { accountId: ARCHIVED, currency: 'BOB', nature: 'ASSET', status: 'ARCHIVED' },
      { accountId: CLOSED_ACCOUNT, currency: 'BOB', nature: 'ASSET', status: 'CLOSED' },
    ],
  });
  // FixedClock 2026-04-05T12:00:00-04:00 (America/La_Paz): hoy es 2026-04-05.
  mem.state.today = '2026-04-05';
  const tx = new TransactionsService(mem.deps);
  const rec = new ReconciliationsService(mem.deps, tx);
  return { ...mem, tx, rec };
}
type Ctx = ReturnType<typeof setup>;

const money = (amount: string) => ({ amount, currency: 'BOB' });
const movement = (
  accountId: string,
  kind: 'EXPENSE' | 'INCOME',
  amount: string,
  transactionDate: string,
  status: 'POSTED' | 'CLEARED' | 'PENDING' = 'CLEARED',
  description?: string,
): RecordTransactionCommand => ({
  workspaceId: WS,
  userId: USER,
  kind,
  status,
  transactionDate,
  accountId,
  amount: money(amount),
  ...(description ? { description } : {}),
});

/** Saldo inicial 1000.00 BOB al 2026-02-28 (asiento de apertura + lectura de LEDGER para la reconciliación). */
async function openAccount(ctx: Ctx, accountId: string, nature: 'ASSET' | 'LIABILITY', amount: string) {
  ctx.state.openings.set(accountId, { amount, currency: 'BOB' });
  await ctx.deps.ledger.postJournalEntry({
    workspaceId: WS,
    entryDate: '2026-02-28',
    entryType: 'OPENING',
    sourceRef: { type: 'Transaction', id: accountId, revision: 1 },
    postings: [
      { target: { kind: 'USER_ACCOUNT', accountId, nature }, amount: money(amount) },
      {
        target: { kind: 'SYSTEM', systemKind: 'OPENING_BALANCE' },
        amount: money(amount.startsWith('-') ? amount.slice(1) : `-${amount}`),
      },
    ],
  });
}

/**
 * Escenario del change: "Bank A" con saldo inicial 1000.00; G1 150.00 cleared (03-05), I1 2500.00 cleared (03-10),
 * G2 45.90 posted (03-20) y G3 200.00 cleared (04-02). Cifras a mano: 1000.00 − 150.00 + 2500.00 = 3350.00 (confirmado)
 * y 3350.00 − 45.90 − 200.00 = 3104.10 (contable).
 */
async function seedBankA(ctx: Ctx) {
  await openAccount(ctx, BANK, 'ASSET', '1000.00');
  const g1 = (
    await ctx.tx.recordTransaction(movement(BANK, 'EXPENSE', '150.00', '2026-03-05', 'CLEARED', 'G1'))
  ).transaction;
  const i1 = (
    await ctx.tx.recordTransaction(movement(BANK, 'INCOME', '2500.00', '2026-03-10', 'CLEARED', 'I1'))
  ).transaction;
  const g2 = (
    await ctx.tx.recordTransaction(movement(BANK, 'EXPENSE', '45.90', '2026-03-20', 'POSTED', 'G2'))
  ).transaction;
  const g3 = (
    await ctx.tx.recordTransaction(movement(BANK, 'EXPENSE', '200.00', '2026-04-02', 'CLEARED', 'G3'))
  ).transaction;
  return { g1, i1, g2, g3 };
}

const start = (ctx: Ctx, over: Partial<Parameters<ReconciliationsService['start']>[0]> = {}) =>
  ctx.rec.start({
    workspaceId: WS,
    userId: USER,
    accountId: BANK,
    statementDate: '2026-03-31',
    statementBalance: '3350.00',
    ...over,
  });

const complete = (ctx: Ctx, id: string, version: number, adjustment?: { reason: string }) =>
  ctx.rec.complete({
    workspaceId: WS,
    userId: USER,
    reconciliationId: id,
    expectedVersion: version,
    ...(adjustment ? { adjustment } : {}),
  });

async function errorOf(p: Promise<unknown>): Promise<DomainError | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  return undefined;
}
const codeOf = async (p: Promise<unknown>) => (await errorOf(p))?.code;
const statusOf = (ctx: Ctx, id: string) => ctx.state.txs.get(id)?.status;
const eventsOf = (ctx: Ctx, type: string) => ctx.state.outbox.filter((e) => e.eventType === type);

describe('ReconciliationsService — iniciar y calcular', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-001] iniciar la reconciliación de marzo: en curso, sin transacciones reconciliadas, con auditoría y START', async () => {
    const ctx = setup();
    const { g1, i1, g2, g3 } = await seedBankA(ctx);
    const view = await start(ctx);
    expect(view.reconciliation).toMatchObject({
      status: 'IN_PROGRESS',
      accountId: BANK,
      statementDate: '2026-03-31',
      version: 1,
    });
    expect(view.reconciliation.statementBalance.toFixed()).toBe('3350.00');
    expect([g1, i1, g2, g3].map((t) => statusOf(ctx, t.id))).toEqual([
      'CLEARED',
      'CLEARED',
      'POSTED',
      'CLEARED',
    ]);
    expect(ctx.state.audit.at(-1)?.action).toBe('transactions.reconciliation.started');
    const steps = ctx.state.lifecycle.filter((l) => l.aggregateId === view.reconciliation.id);
    expect(steps).toMatchObject([
      { kind: 'TRANSITION', transition: 'START', fromState: null, toState: 'IN_PROGRESS' },
    ]);
    // Iniciar no publica evento (decisión 7).
    expect(eventsOf(ctx, 'transactions.ReconciliationCompleted')).toHaveLength(0);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-002] segunda sesión en curso, fecha inválida, escala excedida y cuentas no activas se rechazan sin crear nada', async () => {
    const ctx = setup();
    await seedBankA(ctx);
    const first = await start(ctx);
    expect(await codeOf(start(ctx))).toBe('RECONCILIATION_IN_PROGRESS');
    expect(ctx.state.reconciliations.size).toBe(1);
    await ctx.rec.cancel({
      workspaceId: WS,
      userId: USER,
      reconciliationId: first.reconciliation.id,
      expectedVersion: 1,
    });
    // Fecha futura (hoy 2026-04-05, borde del día).
    expect(await codeOf(start(ctx, { statementDate: '2026-04-06' }))).toBe(
      'RECONCILIATION_STATEMENT_DATE_INVALID',
    );
    expect(await codeOf(start(ctx, { statementDate: '2026-04-05' }))).toBeUndefined();
    const err = await errorOf(start(ctx, { accountId: CASH, statementBalance: '3350.005' }));
    expect(err?.code).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(err?.violations[0]?.pointer).toBe('/statementBalance');
    expect(await codeOf(start(ctx, { accountId: ARCHIVED }))).toBe('ACCOUNT_ARCHIVED');
    expect(await codeOf(start(ctx, { accountId: CLOSED_ACCOUNT }))).toBe('ACCOUNT_CLOSED');
    expect(await codeOf(start(ctx, { accountId: 'inexistente' }))).toBe('REFERENCE_NOT_FOUND');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-002] la fecha del extracto debe ser posterior a la de la última sesión completada', async () => {
    const ctx = setup();
    await seedBankA(ctx);
    const s = await start(ctx);
    await complete(ctx, s.reconciliation.id, 1);
    expect(await codeOf(start(ctx, { statementDate: '2026-03-15', statementBalance: '3350.00' }))).toBe(
      'RECONCILIATION_STATEMENT_DATE_INVALID',
    );
    expect(await codeOf(start(ctx, { statementDate: '2026-03-31' }))).toBe(
      'RECONCILIATION_STATEMENT_DATE_INVALID',
    );
    expect(
      await codeOf(start(ctx, { statementDate: '2026-04-01', statementBalance: '3150.00' })),
    ).toBeUndefined();
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-003] el saldo confirmado (3350.00) y la diferencia (0.00) se calculan en vivo; el saldo contable sigue en 3104.10', async () => {
    const ctx = setup();
    await seedBankA(ctx);
    const s = await start(ctx);
    expect(s.clearedBalance?.toFixed()).toBe('3350.00');
    expect(s.difference?.toFixed()).toBe('0.00');
    expect(ctx.balanceOf(BANK)).toBe('3104.10');
    const diff = await start(ctx, { accountId: CASH, statementBalance: '0.00' });
    expect(diff.difference?.toFixed()).toBe('0.00');
    // Diferencia negativa con un extracto de 3345.00.
    const other = setup();
    await seedBankA(other);
    const view = await start(other, { statementBalance: '3345.00' });
    expect(view.difference?.toFixed()).toBe('-5.00');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-004] en la tarjeta de crédito el saldo confirmado es una deuda positiva de 520.00', async () => {
    const ctx = setup();
    await ctx.tx.recordTransaction(movement(VISA, 'EXPENSE', '400.00', '2026-03-05'));
    await ctx.tx.recordTransaction(movement(VISA, 'EXPENSE', '120.00', '2026-03-12'));
    const view = await start(ctx, { accountId: VISA, statementBalance: '520.00' });
    expect(view.nature).toBe('LIABILITY');
    expect(view.clearedBalance?.toFixed()).toBe('520.00');
    expect(view.difference?.toFixed()).toBe('0.00');
  });
});

describe('ReconciliationsService — confirmar en la sesión', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-005] confirmar G2 baja el saldo confirmado a 3304.10, la diferencia a 0.00 y no toca el ledger', async () => {
    const ctx = setup();
    const { g2 } = await seedBankA(ctx);
    const s = await start(ctx, { statementBalance: '3304.10' });
    expect(s.difference?.toFixed()).toBe('-45.90');
    const entriesBefore = ctx.state.entries.length;
    const after = await ctx.rec.toggleCleared({
      workspaceId: WS,
      userId: USER,
      reconciliationId: s.reconciliation.id,
      expectedVersion: 1,
      items: [{ id: g2.id, version: g2.version }],
      cleared: true,
    });
    expect(statusOf(ctx, g2.id)).toBe('CLEARED');
    expect(after.clearedBalance?.toFixed()).toBe('3304.10');
    expect(after.difference?.toFixed()).toBe('0.00');
    expect(after.reconciliation.version).toBe(2);
    expect(ctx.state.entries).toHaveLength(entriesBefore);
    expect(ctx.balanceOf(BANK)).toBe('3104.10');
    // Evento dedicado con la sesión + anotación en el recorrido de la sesión.
    const cleared = eventsOf(ctx, 'transactions.TransactionCleared').at(-1);
    expect(cleared?.payload).toMatchObject({
      transactionId: g2.id,
      cleared: true,
      reconciliationId: s.reconciliation.id,
      previousStatus: 'POSTED',
    });
    expect(
      ctx.state.lifecycle.filter((l) => l.aggregateId === s.reconciliation.id && l.kind === 'ANNOTATION'),
    ).toMatchObject([{ changedFields: ['TRANSACTION_CLEARED'], detailRefs: { transactionId: g2.id } }]);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-005] otra cuenta o fecha posterior ⇒ VALIDATION_FAILED; pending o reconciled ⇒ INVALID_STATUS_TRANSITION', async () => {
    const ctx = setup();
    await seedBankA(ctx);
    const after = (await ctx.tx.recordTransaction(movement(BANK, 'EXPENSE', '10.00', '2026-04-03', 'POSTED')))
      .transaction;
    const cash = (await ctx.tx.recordTransaction(movement(CASH, 'EXPENSE', '10.00', '2026-03-10', 'POSTED')))
      .transaction;
    const pending = (
      await ctx.tx.recordTransaction(movement(BANK, 'EXPENSE', '10.00', '2026-03-11', 'PENDING'))
    ).transaction;
    const s = await start(ctx);
    const toggle = (t: { id: string; version: number }) =>
      ctx.rec.toggleCleared({
        workspaceId: WS,
        userId: USER,
        reconciliationId: s.reconciliation.id,
        expectedVersion: 1,
        items: [{ id: t.id, version: t.version }],
        cleared: true,
      });
    const late = await errorOf(toggle(after));
    expect(late?.code).toBe('VALIDATION_FAILED');
    expect(late?.violations[0]?.pointer).toBe('/items/0/id');
    expect(statusOf(ctx, after.id)).toBe('POSTED');
    expect(await codeOf(toggle(cash))).toBe('VALIDATION_FAILED');
    expect(await codeOf(toggle(pending))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-005] confirmar en un mes cerrado se rechaza con PERIOD_CLOSED y la sesión no cambia', async () => {
    const ctx = setup();
    const { g2 } = await seedBankA(ctx);
    const s = await start(ctx, { statementBalance: '3304.10' });
    ctx.state.closedMonths.add('2026-03');
    expect(
      await codeOf(
        ctx.rec.toggleCleared({
          workspaceId: WS,
          userId: USER,
          reconciliationId: s.reconciliation.id,
          expectedVersion: 1,
          items: [{ id: g2.id, version: g2.version }],
          cleared: true,
        }),
      ),
    ).toBe('PERIOD_CLOSED');
    expect(statusOf(ctx, g2.id)).toBe('POSTED');
    expect(ctx.state.reconciliations.get(s.reconciliation.id)?.version).toBe(1);
  });
});

describe('ReconciliationsService — finalizar', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-006] finalizar con diferencia 0 reconcilia G1 e I1 (modo extracto), deja G2 y G3 y no cambia el ledger', async () => {
    const ctx = setup();
    const { g1, i1, g2, g3 } = await seedBankA(ctx);
    const s = await start(ctx);
    const entriesBefore = ctx.state.entries.length;
    const done = await complete(ctx, s.reconciliation.id, 1);
    expect(done.reconciliation).toMatchObject({ status: 'COMPLETED', version: 2 });
    expect(done.reconciliation.clearedBalance?.toFixed()).toBe('3350.00');
    expect(done.reconciliation.difference?.toFixed()).toBe('0.00');
    expect(statusOf(ctx, g1.id)).toBe('RECONCILED');
    expect(statusOf(ctx, i1.id)).toBe('RECONCILED');
    expect(ctx.state.txs.get(g1.id)?.reconciliationMode).toBe('STATEMENT');
    expect(ctx.state.txs.get(i1.id)?.reconciliationMode).toBe('STATEMENT');
    expect(statusOf(ctx, g2.id)).toBe('POSTED');
    expect(statusOf(ctx, g3.id)).toBe('CLEARED');
    expect(ctx.state.entries).toHaveLength(entriesBefore);
    expect(ctx.balanceOf(BANK)).toBe('3104.10');
    expect(done.items?.map((i) => i.transactionId).sort()).toEqual([g1.id, i1.id].sort());
    // Evento de la sesión y recorrido (START + COMPLETE).
    const completedEvent = eventsOf(ctx, 'transactions.ReconciliationCompleted');
    expect(completedEvent).toHaveLength(1);
    expect(completedEvent[0]?.payload).toMatchObject({
      reconciliationId: s.reconciliation.id,
      statementDate: '2026-03-31',
      statementBalance: { amount: '3350.00', currency: 'BOB' },
      clearedBalance: { amount: '3350.00', currency: 'BOB' },
      transactionCount: 2,
      adjustmentTransactionId: null,
      transition: 'COMPLETE',
    });
    expect((completedEvent[0]?.payload as { transactionIds: string[] }).transactionIds.sort()).toEqual(
      [g1.id, i1.id].sort(),
    );
    expect(
      ctx.state.lifecycle
        .filter((l) => l.aggregateId === s.reconciliation.id)
        .map((l) => (l.kind === 'TRANSITION' ? l.transition : l.kind)),
    ).toEqual(['START', 'COMPLETE']);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-006] si falla la auditoría, la sesión sigue en curso y ninguna transacción cambia de estado (atomicidad)', async () => {
    const ctx = setup();
    const { g1, i1 } = await seedBankA(ctx);
    const s = await start(ctx);
    ctx.faults.audit = new Error('audit down');
    await expect(complete(ctx, s.reconciliation.id, 1)).rejects.toThrow('audit down');
    delete ctx.faults.audit;
    expect(ctx.state.reconciliations.get(s.reconciliation.id)?.status).toBe('IN_PROGRESS');
    expect(statusOf(ctx, g1.id)).toBe('CLEARED');
    expect(statusOf(ctx, i1.id)).toBe('CLEARED');
    expect(eventsOf(ctx, 'transactions.ReconciliationCompleted')).toHaveLength(0);
    expect(ctx.state.reconciliationItems).toHaveLength(0);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-007] diferencia −5.00 sin ajuste ⇒ RECONCILIATION_DIFFERENCE_NOT_ZERO con la diferencia y la sesión sigue en curso', async () => {
    const ctx = setup();
    const { g1 } = await seedBankA(ctx);
    const s = await start(ctx, { statementBalance: '3345.00' });
    const err = await errorOf(complete(ctx, s.reconciliation.id, 1));
    expect(err?.code).toBe('RECONCILIATION_DIFFERENCE_NOT_ZERO');
    expect(err?.details['difference']).toEqual({ amount: '-5.00', currency: 'BOB' });
    expect(ctx.state.reconciliations.get(s.reconciliation.id)?.status).toBe('IN_PROGRESS');
    expect(statusOf(ctx, g1.id)).toBe('CLEARED');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-008] el ajuste de 5.00 BOB cuadra la diferencia con un asiento balanceado contra EQUITY:ADJUSTMENTS', async () => {
    const ctx = setup();
    const { g1, i1 } = await seedBankA(ctx);
    const s = await start(ctx, { statementBalance: '3345.00' });
    const done = await complete(ctx, s.reconciliation.id, 1, { reason: 'comisión bancaria no registrada' });
    const adjustmentId = done.reconciliation.adjustmentTransactionId;
    expect(adjustmentId).not.toBeNull();
    const adjustment = ctx.state.txs.get(adjustmentId as string);
    expect(adjustment).toMatchObject({
      kind: 'ADJUSTMENT',
      direction: 'DECREASE',
      status: 'RECONCILED',
      businessDate: '2026-03-31',
      adjustmentReason: 'comisión bancaria no registrada',
      reconciliationMode: 'STATEMENT',
      reconciliationId: s.reconciliation.id,
      source: 'SYSTEM',
    });
    expect(adjustment?.amount.toFixed()).toBe('5.00');
    // Asiento: acredita 5.00 a Bank A y debita 5.00 al ajuste de patrimonio (INV-004).
    expect(ctx.balanceOf(BANK)).toBe('3099.10');
    expect(ctx.balanceOf('ADJUSTMENTS', 'BOB')).toBe('5.00');
    expect(done.reconciliation.clearedBalance?.toFixed()).toBe('3345.00');
    expect(done.reconciliation.difference?.toFixed()).toBe('0.00');
    expect(statusOf(ctx, g1.id)).toBe('RECONCILED');
    expect(statusOf(ctx, i1.id)).toBe('RECONCILED');
    expect(done.items?.map((i) => i.transactionId)).toContain(adjustmentId);
    // Eventos aditivos del ajuste con la sesión.
    expect(eventsOf(ctx, 'transactions.TransactionCreated').at(-1)?.payload).toMatchObject({
      kind: 'ADJUSTMENT',
      reconciliationId: s.reconciliation.id,
      transition: 'RECORD',
    });
    expect(eventsOf(ctx, 'transactions.TransactionPosted').at(-1)?.payload).toMatchObject({
      reconciliationId: s.reconciliation.id,
    });
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-008] el ajuste de una deuda (tarjeta) aumenta la deuda cuando el extracto es mayor', async () => {
    const ctx = setup();
    await ctx.tx.recordTransaction(movement(VISA, 'EXPENSE', '400.00', '2026-03-05'));
    const s = await start(ctx, { accountId: VISA, statementBalance: '405.00' });
    expect(s.difference?.toFixed()).toBe('5.00');
    const done = await complete(ctx, s.reconciliation.id, 1, { reason: 'interés' });
    expect(ctx.state.txs.get(done.reconciliation.adjustmentTransactionId as string)).toMatchObject({
      direction: 'INCREASE',
    });
    // Pasivo: la deuda presentada pasa de 400.00 a 405.00 (saldo contable −405.00).
    expect(ctx.balanceOf(VISA)).toBe('-405.00');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-008] un ajuste sin motivo ⇒ VALIDATION_FAILED y no se crea ninguna transacción', async () => {
    const ctx = setup();
    await seedBankA(ctx);
    const s = await start(ctx, { statementBalance: '3345.00' });
    const txsBefore = ctx.state.txs.size;
    const err = await errorOf(complete(ctx, s.reconciliation.id, 1, { reason: '  ' }));
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(err?.violations[0]?.pointer).toBe('/adjustment/reason');
    expect(ctx.state.txs.size).toBe(txsBefore);
    expect(ctx.state.reconciliations.get(s.reconciliation.id)?.status).toBe('IN_PROGRESS');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-013] finalizar con una versión obsoleta ⇒ PRECONDITION_FAILED y la sesión sigue en curso', async () => {
    const ctx = setup();
    const { g2 } = await seedBankA(ctx);
    const s = await start(ctx, { statementBalance: '3304.10' });
    await ctx.rec.toggleCleared({
      workspaceId: WS,
      userId: USER,
      reconciliationId: s.reconciliation.id,
      expectedVersion: 1,
      items: [{ id: g2.id, version: g2.version }],
      cleared: true,
    });
    const err = await errorOf(complete(ctx, s.reconciliation.id, 1));
    expect(err?.code).toBe('PRECONDITION_FAILED');
    expect(err?.details['currentVersion']).toBe(2);
    expect(ctx.state.reconciliations.get(s.reconciliation.id)?.status).toBe('IN_PROGRESS');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-013] finalizar evalúa el estado vigente: G1 corregido a 155.00 vuelve a posted y la diferencia es −150.00', async () => {
    const ctx = setup();
    const { g1 } = await seedBankA(ctx);
    const s = await start(ctx);
    await ctx.tx.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: g1.id,
      expectedVersion: g1.version,
      amount: money('155.00'),
    });
    expect(statusOf(ctx, g1.id)).toBe('POSTED');
    const err = await errorOf(complete(ctx, s.reconciliation.id, 1));
    expect(err?.code).toBe('RECONCILIATION_DIFFERENCE_NOT_ZERO');
    // Confirmado 3500.00 (1000.00 + 2500.00), extracto 3350.00 ⇒ −150.00.
    expect(err?.details['difference']).toEqual({ amount: '-150.00', currency: 'BOB' });
  });
});

describe('ReconciliationsService — cancelar', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-009] cancelar conserva el cleared de G2 y permite empezar otra sesión; no se cancela una completada', async () => {
    const ctx = setup();
    const { g2 } = await seedBankA(ctx);
    const s = await start(ctx, { statementBalance: '3304.10' });
    await ctx.rec.toggleCleared({
      workspaceId: WS,
      userId: USER,
      reconciliationId: s.reconciliation.id,
      expectedVersion: 1,
      items: [{ id: g2.id, version: g2.version }],
      cleared: true,
    });
    const cancelled = await ctx.rec.cancel({
      workspaceId: WS,
      userId: USER,
      reconciliationId: s.reconciliation.id,
      expectedVersion: 2,
    });
    expect(cancelled.reconciliation.status).toBe('CANCELLED');
    expect(statusOf(ctx, g2.id)).toBe('CLEARED');
    expect([...ctx.state.txs.values()].some((t) => t.status === 'RECONCILED')).toBe(false);
    expect(await codeOf(start(ctx, { statementBalance: '3304.10' }))).toBeUndefined();
    // Completar una cancelada ⇒ INVALID_STATUS_TRANSITION sin registrar una transición.
    const stepsBefore = ctx.state.lifecycle.filter((l) => l.aggregateId === s.reconciliation.id).length;
    expect(await codeOf(complete(ctx, s.reconciliation.id, 3))).toBe('INVALID_STATUS_TRANSITION');
    expect(ctx.state.lifecycle.filter((l) => l.aggregateId === s.reconciliation.id)).toHaveLength(
      stepsBefore,
    );
    const second = ctx.state.reconciliations.values();
    const completedSession = [...second].find((r) => r.status === 'IN_PROGRESS');
    expect(completedSession).toBeDefined();
    const done = await ctx.rec.complete({
      workspaceId: WS,
      userId: USER,
      reconciliationId: (completedSession as { id: string }).id,
      expectedVersion: 1,
    });
    expect(done.reconciliation.status).toBe('COMPLETED');
    expect(
      await codeOf(
        ctx.rec.cancel({
          workspaceId: WS,
          userId: USER,
          reconciliationId: done.reconciliation.id,
          expectedVersion: 2,
        }),
      ),
    ).toBe('INVALID_STATUS_TRANSITION');
  });
});

describe('ReconciliationsService — estado por cuenta (getCoverage)', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-010] Bank A reconciliada al 2026-03-31 con G2 aún posted: 1 sin reconciliar y no reconciliada al corte', async () => {
    const ctx = setup();
    await seedBankA(ctx);
    const s = await start(ctx);
    await complete(ctx, s.reconciliation.id, 1);
    const [status] = await ctx.rec.getCoverage({
      workspaceId: WS,
      accountIds: [BANK],
      through: '2026-03-31',
    });
    expect(status).toMatchObject({
      accountId: BANK,
      lastCompleted: {
        reconciliationId: s.reconciliation.id,
        statementDate: '2026-03-31',
        statementBalance: { amount: '3350.00', currency: 'BOB' },
        difference: { amount: '0.00', currency: 'BOB' },
      },
      inProgressReconciliationId: null,
      unreconciledPostedCountThrough: 1,
      unreconciledClearedCountThrough: 0,
      reconciledWithoutStatementCount: 0,
      reconciledThrough: false,
      reconciliationBasis: null,
    });
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-010] una cuenta nunca reconciliada informa sin reconciliación previa y los pendientes hasta el corte', async () => {
    const ctx = setup();
    await ctx.tx.recordTransaction(movement(CASH, 'EXPENSE', '80.00', '2026-03-12', 'POSTED'));
    const [status] = await ctx.rec.getCoverage({
      workspaceId: WS,
      accountIds: [CASH],
      through: '2026-03-31',
    });
    expect(status).toMatchObject({
      lastCompleted: null,
      inProgressReconciliationId: null,
      unreconciledPostedCountThrough: 1,
      reconciledThrough: false,
      reconciliationBasis: null,
    });
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-010] cuando se cierra la reconciliación de todas las pendientes, la cuenta queda reconciliada con base extracto', async () => {
    const ctx = setup();
    const { g2, g3 } = await seedBankA(ctx);
    // Confirmar G2 y G3 (la del 2026-04-02) y reconciliar hasta el 2026-04-04.
    await ctx.tx.markCleared(WS, [{ id: g2.id, version: g2.version }], true);
    const s = await start(ctx, { statementDate: '2026-04-04', statementBalance: '3104.10' });
    await complete(ctx, s.reconciliation.id, 1);
    expect(statusOf(ctx, g3.id)).toBe('RECONCILED');
    const [status] = await ctx.rec.getCoverage({
      workspaceId: WS,
      accountIds: [BANK],
      through: '2026-04-04',
    });
    expect(status).toMatchObject({ reconciledThrough: true, reconciliationBasis: 'STATEMENT' });
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-020] Caja BOB conciliada sin extracto cuenta como conciliada con base "sin extracto"', async () => {
    const ctx = setup();
    await openAccount(ctx, CASH, 'ASSET', '500.00');
    const g = (
      await ctx.tx.recordTransaction(movement(CASH, 'EXPENSE', '80.00', '2026-03-12', 'CLEARED', 'Caja'))
    ).transaction;
    await ctx.tx.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: g.id,
      expectedVersion: g.version,
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
    });
    const [status] = await ctx.rec.getCoverage({
      workspaceId: WS,
      accountIds: [CASH],
      from: '2026-03-01',
      through: '2026-03-31',
    });
    expect(status).toMatchObject({
      lastCompleted: null,
      unreconciledPostedCountThrough: 0,
      unreconciledClearedCountThrough: 0,
      reconciledWithoutStatementCount: 1,
      reconciledThrough: true,
      reconciliationBasis: 'WITHOUT_STATEMENT',
    });
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-020] extracto completado con una conciliada sin extracto posterior: reconciliada con base "sin extracto"', async () => {
    const ctx = setup();
    await seedBankA(ctx);
    const s = await start(ctx);
    await complete(ctx, s.reconciliation.id, 1);
    // G2 (03-20, 45.90) se confirma y se concilia sin extracto DESPUÉS de la sesión.
    const posted = [...ctx.state.txs.values()].find((t) => t.description === 'G2');
    expect(posted).toBeDefined();
    const g2 = posted as { id: string; version: number };
    await ctx.tx.markCleared(WS, [{ id: g2.id, version: g2.version }], true);
    const cleared = ctx.state.txs.get(g2.id);
    await ctx.tx.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: g2.id,
      expectedVersion: cleared?.version ?? 0,
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
    });
    const [status] = await ctx.rec.getCoverage({
      workspaceId: WS,
      accountIds: [BANK],
      from: '2026-03-01',
      through: '2026-03-31',
    });
    expect(status).toMatchObject({
      unreconciledPostedCountThrough: 0,
      unreconciledClearedCountThrough: 0,
      reconciledWithoutStatementCount: 1,
      reconciledThrough: true,
      reconciliationBasis: 'WITHOUT_STATEMENT',
    });
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-015] una transacción des-reconciliada después de completar deja de contarse como reconciliada', async () => {
    const ctx = setup();
    const { g1, i1 } = await seedBankA(ctx);
    const s = await start(ctx);
    await complete(ctx, s.reconciliation.id, 1);
    const reconciled = ctx.state.txs.get(g1.id);
    const un = await ctx.tx.unreconcileTransaction(
      WS,
      g1.id,
      reconciled?.version ?? 0,
      'duplicado en extracto',
    );
    expect(un.status).toBe('CLEARED');
    expect(un.reconciliationMode).toBeNull();
    // La sesión conserva su resultado y registra la des-reconciliación posterior.
    const session = ctx.state.reconciliations.get(s.reconciliation.id);
    expect(session).toMatchObject({ status: 'COMPLETED' });
    expect(session?.clearedBalance?.toFixed()).toBe('3350.00');
    expect(ctx.state.reconciliationItems.find((i) => i.transactionId === g1.id)).toMatchObject({
      unreconciledAt: expect.any(String),
      unreconcileReason: 'duplicado en extracto',
    });
    expect(ctx.state.reconciliationItems.find((i) => i.transactionId === i1.id)?.unreconciledAt).toBeNull();
    const annotation = ctx.state.lifecycle.filter(
      (l) => l.aggregateId === s.reconciliation.id && l.kind === 'ANNOTATION',
    );
    expect(annotation).toMatchObject([
      { changedFields: ['TRANSACTION_UNRECONCILED'], detailRefs: { transactionId: g1.id } },
    ]);
    const [status] = await ctx.rec.getCoverage({
      workspaceId: WS,
      accountIds: [BANK],
      through: '2026-03-31',
    });
    expect(status?.unreconciledClearedCountThrough).toBe(1);
    expect(status?.reconciledThrough).toBe(false);
  });
});

describe('ReconciliationsService — periodos cerrados (INV-015, docs/33 D65)', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-012] finalizar una sesión al 2026-04-30 que incluiría un gasto cleared de un mes cerrado ⇒ PERIOD_CLOSED por transacción y nada se reconcilia', async () => {
    const ctx = setup();
    await openAccount(ctx, BANK, 'ASSET', '1000.00');
    const march = (await ctx.tx.recordTransaction(movement(BANK, 'EXPENSE', '80.00', '2026-03-28')))
      .transaction;
    ctx.state.closedMonths.add('2026-03');
    const s = await start(ctx, { statementDate: '2026-04-04', statementBalance: '920.00' });
    const err = await errorOf(complete(ctx, s.reconciliation.id, 1));
    expect(err?.code).toBe('PERIOD_CLOSED');
    expect(err?.violations.map((v) => v.pointer)).toEqual([`/transactions/${march.id}`]);
    expect(ctx.state.reconciliations.get(s.reconciliation.id)?.status).toBe('IN_PROGRESS');
    expect(statusOf(ctx, march.id)).toBe('CLEARED');
    expect(ctx.state.reconciliationItems).toHaveLength(0);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-012] el ajuste fechado en un mes cerrado ⇒ PERIOD_CLOSED y no se crea el ajuste ni se reconcilia nada', async () => {
    const ctx = setup();
    const { g1 } = await seedBankA(ctx);
    const s = await start(ctx, { statementBalance: '3345.00' });
    ctx.state.closedMonths.add('2026-03');
    // Con marzo cerrado, G1 (03-05) también está en periodo cerrado: se rechaza igualmente por la sesión completa.
    expect(await codeOf(complete(ctx, s.reconciliation.id, 1, { reason: 'comisión' }))).toBe('PERIOD_CLOSED');
    expect(statusOf(ctx, g1.id)).toBe('CLEARED');
    expect([...ctx.state.txs.values()].some((t) => t.kind === 'ADJUSTMENT')).toBe(false);
    // Solo el ajuste en un mes cerrado: sin transacciones cleared en el rango.
    const solo = setup();
    await openAccount(solo, BANK, 'ASSET', '1000.00');
    const s2 = await start(solo, { statementDate: '2026-03-31', statementBalance: '995.00' });
    solo.state.closedMonths.add('2026-03');
    const err = await errorOf(complete(solo, s2.reconciliation.id, 1, { reason: 'comisión' }));
    expect(err?.code).toBe('PERIOD_CLOSED');
    expect(err?.violations.map((v) => v.pointer)).toEqual(['/adjustment']);
    expect([...solo.state.txs.values()]).toHaveLength(0);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-021] conciliar sin extracto una transacción de un mes cerrado ⇒ PERIOD_CLOSED y sigue cleared, sin marca', async () => {
    const ctx = setup();
    await openAccount(ctx, CASH, 'ASSET', '500.00');
    const g = (await ctx.tx.recordTransaction(movement(CASH, 'EXPENSE', '80.00', '2026-03-12'))).transaction;
    ctx.state.closedMonths.add('2026-03');
    expect(
      await codeOf(
        ctx.tx.updateTransaction({
          workspaceId: WS,
          userId: USER,
          transactionId: g.id,
          expectedVersion: g.version,
          status: 'RECONCILED',
          reconciliationMode: 'WITHOUT_STATEMENT',
        }),
      ),
    ).toBe('PERIOD_CLOSED');
    expect(ctx.state.txs.get(g.id)).toMatchObject({ status: 'CLEARED', reconciliationMode: null });
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-015] confirmar, desconfirmar y des-reconciliar en un mes cerrado ⇒ PERIOD_CLOSED', async () => {
    const ctx = setup();
    await openAccount(ctx, CASH, 'ASSET', '500.00');
    const posted = (
      await ctx.tx.recordTransaction(movement(CASH, 'EXPENSE', '10.00', '2026-03-05', 'POSTED'))
    ).transaction;
    const reconciled = (
      await ctx.tx.recordTransaction(movement(CASH, 'EXPENSE', '20.00', '2026-03-05', 'CLEARED'))
    ).transaction;
    const r = await ctx.tx.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: reconciled.id,
      expectedVersion: reconciled.version,
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
    });
    ctx.state.closedMonths.add('2026-03');
    expect(await codeOf(ctx.tx.markCleared(WS, [{ id: posted.id, version: posted.version }], true))).toBe(
      'PERIOD_CLOSED',
    );
    expect(
      await codeOf(
        ctx.tx.updateTransaction({
          workspaceId: WS,
          userId: USER,
          transactionId: posted.id,
          expectedVersion: posted.version,
          status: 'CLEARED',
        }),
      ),
    ).toBe('PERIOD_CLOSED');
    expect(await codeOf(ctx.tx.unreconcileTransaction(WS, reconciled.id, r.version, 'x'))).toBe(
      'PERIOD_CLOSED',
    );
    expect(statusOf(ctx, posted.id)).toBe('POSTED');
    expect(statusOf(ctx, reconciled.id)).toBe('RECONCILED');
  });
});

describe('ReconciliationsService — conciliación sin extracto (docs/33 D74, D111)', () => {
  const cashExpense = async (ctx: Ctx, amount = '80.00', date = '2026-03-12') => {
    await openAccount(ctx, CASH, 'ASSET', '500.00');
    return (await ctx.tx.recordTransaction(movement(CASH, 'EXPENSE', amount, date, 'CLEARED', 'efectivo')))
      .transaction;
  };

  it('[TC-TRANSACTIONS-RECONCILIATION-016] conciliar sin extracto: modo, marca, mismo asiento, saldo 420.00, auditoría con modo y transición propia', async () => {
    const ctx = setup();
    const g = await cashExpense(ctx);
    expect(ctx.balanceOf(CASH)).toBe('420.00');
    const entriesBefore = ctx.state.entries.length;
    const r = await ctx.tx.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: g.id,
      expectedVersion: g.version,
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
    });
    expect(r).toMatchObject({
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
      activeEntryId: g.activeEntryId,
    });
    expect(ctx.state.entries).toHaveLength(entriesBefore);
    expect(ctx.balanceOf(CASH)).toBe('420.00');
    const audit = ctx.state.audit.at(-1);
    expect(audit?.action).toBe('transactions.transaction.reconciled_without_statement');
    expect(audit?.changes).toEqual(
      expect.arrayContaining([
        { field: 'status', before: 'CLEARED', after: 'RECONCILED' },
        { field: 'reconciliationMode', before: null, after: 'WITHOUT_STATEMENT' },
      ]),
    );
    expect(ctx.state.outbox.at(-1)?.payload).toMatchObject({
      changedFields: ['status', 'reconciliationMode'],
      transition: 'RECONCILE_WITHOUT_STATEMENT',
    });
    expect(ctx.state.lifecycle.filter((l) => l.aggregateId === g.id).at(-1)).toMatchObject({
      kind: 'TRANSITION',
      transition: 'RECONCILE_WITHOUT_STATEMENT',
      fromState: 'CLEARED',
      toState: 'RECONCILED',
    });
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-017] sin modo explícito ⇒ VALIDATION_FAILED y sigue cleared; sobre un posted ⇒ INVALID_STATUS_TRANSITION', async () => {
    const ctx = setup();
    const g = await cashExpense(ctx);
    const patch = (over: Record<string, unknown>) =>
      ctx.tx.updateTransaction({
        workspaceId: WS,
        userId: USER,
        transactionId: g.id,
        expectedVersion: g.version,
        ...over,
      });
    const missing = await errorOf(patch({ status: 'RECONCILED' }));
    expect(missing?.code).toBe('VALIDATION_FAILED');
    expect(missing?.violations[0]?.pointer).toBe('/reconciliationMode');
    expect(await codeOf(patch({ status: 'RECONCILED', reconciliationMode: 'STATEMENT' }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(await codeOf(patch({ reconciliationMode: 'WITHOUT_STATEMENT' }))).toBe('VALIDATION_FAILED');
    expect(statusOf(ctx, g.id)).toBe('CLEARED');
    const posted = (
      await ctx.tx.recordTransaction(movement(CASH, 'EXPENSE', '45.90', '2026-03-20', 'POSTED'))
    ).transaction;
    expect(
      await codeOf(
        ctx.tx.updateTransaction({
          workspaceId: WS,
          userId: USER,
          transactionId: posted.id,
          expectedVersion: posted.version,
          status: 'RECONCILED',
          reconciliationMode: 'WITHOUT_STATEMENT',
        }),
      ),
    ).toBe('INVALID_STATUS_TRANSITION');
    expect(statusOf(ctx, posted.id)).toBe('POSTED');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-018] la marca filtra el listado: solo la de Caja BOB, no la reconciliada en sesión de Bank A', async () => {
    const ctx = setup();
    const { g1 } = await seedBankA(ctx);
    const caja = await cashExpense(ctx);
    await ctx.tx.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: caja.id,
      expectedVersion: caja.version,
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
    });
    const s = await start(ctx);
    await complete(ctx, s.reconciliation.id, 1);
    expect(statusOf(ctx, g1.id)).toBe('RECONCILED');
    const flagged = await ctx.tx.listTransactions({
      workspaceId: WS,
      sort: '-transactionDate',
      offset: 0,
      limit: 50,
      systemFlags: ['RECONCILED_WITHOUT_STATEMENT'],
    });
    expect(flagged.map((t) => t.id)).toEqual([caja.id]);
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-019] una sesión posterior coteja G2 (conciliada sin extracto): pasa a modo extracto sin marca, sin ledger y con anotación de cotejo', async () => {
    const ctx = setup();
    const { g2 } = await seedBankA(ctx);
    // G2 se confirma y se concilia sin extracto antes de la sesión.
    await ctx.tx.markCleared(WS, [{ id: g2.id, version: g2.version }], true);
    const cleared = ctx.state.txs.get(g2.id);
    const without = await ctx.tx.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: g2.id,
      expectedVersion: cleared?.version ?? 0,
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
    });
    expect(without.reconciliationMode).toBe('WITHOUT_STATEMENT');
    const s = await start(ctx, { statementBalance: '3304.10' });
    expect(s.difference?.toFixed()).toBe('0.00');
    const entriesBefore = ctx.state.entries.length;
    const done = await complete(ctx, s.reconciliation.id, 1);
    expect(ctx.state.txs.get(g2.id)).toMatchObject({ status: 'RECONCILED', reconciliationMode: 'STATEMENT' });
    expect(ctx.state.entries).toHaveLength(entriesBefore);
    expect(ctx.balanceOf(BANK)).toBe('3104.10');
    expect(done.items?.find((i) => i.transactionId === g2.id)?.verifiedWithoutStatement).toBe(true);
    const timeline = ctx.state.lifecycle.filter((l) => l.aggregateId === g2.id);
    // [TC-AUDIT-LIFECYCLE-027] RECORD, CLEAR y RECONCILE_WITHOUT_STATEMENT; el cotejo es una anotación (sin transición).
    expect(
      timeline.map((l) =>
        l.kind === 'TRANSITION' ? l.transition : `ANNOTATION:${l.changedFields.join(',')}`,
      ),
    ).toEqual(['RECORD', 'CLEAR', 'RECONCILE_WITHOUT_STATEMENT', 'ANNOTATION:RECONCILIATION_VERIFIED']);
    expect(timeline.at(-1)).toMatchObject({ detailRefs: { reconciliationId: s.reconciliation.id } });
    expect(ctx.state.outbox.filter((e) => e.aggregateId === g2.id).at(-1)?.payload).toMatchObject({
      changedFields: ['reconciliationMode'],
    });
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-022] el cotejo omite la conciliada sin extracto de un mes cerrado sin impedir la sesión', async () => {
    const ctx = setup();
    await openAccount(ctx, BANK, 'ASSET', '1000.00');
    const g = (await ctx.tx.recordTransaction(movement(BANK, 'EXPENSE', '30.00', '2026-03-28'))).transaction;
    await ctx.tx.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: g.id,
      expectedVersion: g.version,
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
    });
    ctx.state.closedMonths.add('2026-03');
    const s = await start(ctx, { statementDate: '2026-04-04', statementBalance: '970.00' });
    const done = await complete(ctx, s.reconciliation.id, 1);
    expect(done.reconciliation.status).toBe('COMPLETED');
    expect(ctx.state.txs.get(g.id)).toMatchObject({
      status: 'RECONCILED',
      reconciliationMode: 'WITHOUT_STATEMENT',
    });
    expect(done.items).toHaveLength(0);
  });
});

describe('Recorrido de la sesión y de sus transacciones (add-lifecycle-timeline)', () => {
  it('[TC-AUDIT-LIFECYCLE-025] recorrido de una sesión finalizada con ajuste: START y COMPLETE en orden, confirmación como anotación y ajuste enlazado', async () => {
    const ctx = setup();
    const { g2 } = await seedBankA(ctx);
    const s = await start(ctx, { statementBalance: '3345.00' });
    await ctx.rec.toggleCleared({
      workspaceId: WS,
      userId: USER,
      reconciliationId: s.reconciliation.id,
      expectedVersion: 1,
      items: [{ id: g2.id, version: g2.version }],
      cleared: true,
    });
    // Con G2 confirmado el confirmado es 3304.10 ⇒ diferencia +40.90; el ajuste la anula.
    const done = await complete(ctx, s.reconciliation.id, 2, { reason: 'comisión' });
    const view = await ctx.rec.lifecycle({
      userId: USER,
      workspaceId: WS,
      reconciliationId: s.reconciliation.id,
    });
    expect(view.lifecycle.machine.aggregateType).toBe('Reconciliation');
    expect(view.lifecycle.machine.states.map((x) => [x.code, x.terminal])).toEqual([
      ['IN_PROGRESS', false],
      ['COMPLETED', true],
      ['CANCELLED', true],
    ]);
    expect(view.lifecycle.path).toEqual(['IN_PROGRESS', 'COMPLETED']);
    const items = view.lifecycle.items;
    expect(items.map((i) => (i.kind === 'TRANSITION' ? i.transition : 'ANNOTATION'))).toEqual([
      'START',
      'ANNOTATION',
      'COMPLETE',
    ]);
    expect(items[1]).toMatchObject({
      changedFields: ['TRANSACTION_CLEARED'],
      detailRefs: { transactionId: g2.id },
    });
    expect(items[2]).toMatchObject({
      transition: 'COMPLETE',
      events: ['transactions.ReconciliationCompleted.v1'],
      detailRefs: { adjustmentTransactionId: done.reconciliation.adjustmentTransactionId },
    });
    expect(view.reconciliation.statementBalance.toFixed()).toBe('3345.00');
    expect(view.reconciliation.difference?.toFixed()).toBe('0.00');
  });

  it('[TC-AUDIT-LIFECYCLE-026] la transición RECONCILE de G1 enlaza la sesión (fecha y saldo del extracto); el ajuste muestra RECORD y RECONCILE de la sesión', async () => {
    const ctx = setup();
    await openAccount(ctx, BANK, 'ASSET', '1000.00');
    // G1 se registra posteado, se confirma y se reconcilia al finalizar la sesión (3345.00 ⇒ ajuste de −5.00).
    const g1 = (
      await ctx.tx.recordTransaction(movement(BANK, 'EXPENSE', '150.00', '2026-03-05', 'POSTED', 'G1'))
    ).transaction;
    await ctx.tx.markCleared(WS, [{ id: g1.id, version: g1.version }], true);
    const s = await start(ctx, { statementBalance: '845.00' });
    const done = await complete(ctx, s.reconciliation.id, 1, { reason: 'comisión' });
    const view = await ctx.tx.transactionLifecycle({ userId: USER, workspaceId: WS, transactionId: g1.id });
    expect(view.lifecycle.items.map((i) => (i.kind === 'TRANSITION' ? i.transition : 'ANNOTATION'))).toEqual([
      'RECORD',
      'CLEAR',
      'RECONCILE',
    ]);
    const reconcile = view.lifecycle.items.at(-1);
    expect(reconcile).toMatchObject({ detailRefs: { reconciliationId: s.reconciliation.id } });
    expect(view.reconciliations).toHaveLength(1);
    expect(view.reconciliations[0]).toMatchObject({
      reconciliationId: s.reconciliation.id,
      statementDate: '2026-03-31',
    });
    expect(view.reconciliations[0]?.statementBalance.toFixed()).toBe('845.00');
    const adjustment = await ctx.tx.transactionLifecycle({
      userId: USER,
      workspaceId: WS,
      transactionId: done.reconciliation.adjustmentTransactionId as string,
    });
    expect(
      adjustment.lifecycle.items.map((i) => (i.kind === 'TRANSITION' ? i.transition : 'ANNOTATION')),
    ).toEqual(['RECORD', 'RECONCILE']);
    expect(adjustment.lifecycle.items.map((i) => (i.kind === 'TRANSITION' ? i.detailRefs : {}))).toEqual([
      { reconciliationId: s.reconciliation.id },
      { reconciliationId: s.reconciliation.id },
    ]);
  });
});
