import { describe, expect, it } from 'vitest';
import { ConversionsService, type RecordConversionCommand } from './conversions.service.js';
import { inMemoryTransactionsDeps } from './testing/in-memory.js';
import { TransactionsService, type RecordTransactionCommand } from './transactions.service.js';

// Recorrido de transacciones (openspec add-lifecycle-timeline): cada comando que cambia el estado escribe su
// transición con la auditoría y el outbox en la misma unidad de trabajo; las ediciones descriptivas son anotaciones.
const WS = 'ws-1';
const USER = 'user-1';
const BANK = 'bank-a';
const WALLET_USDT = 'wallet-usdt';
const BANK_BOB = 'bank-bob';

function setup() {
  const mem = inMemoryTransactionsDeps({
    accounts: [
      { accountId: BANK, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: WALLET_USDT, currency: 'USDT', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: BANK_BOB, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
    ],
  });
  return {
    ...mem,
    service: new TransactionsService(mem.deps),
    conversions: new ConversionsService(mem.deps),
  };
}

const expense = (over: Partial<RecordTransactionCommand> = {}): RecordTransactionCommand => ({
  workspaceId: WS,
  userId: USER,
  kind: 'EXPENSE',
  transactionDate: '2026-03-10',
  accountId: BANK,
  amount: { amount: '80.00', currency: 'BOB' },
  ...over,
});

async function opening(service: TransactionsService) {
  await service.recordTransaction({
    workspaceId: WS,
    userId: USER,
    kind: 'INCOME',
    transactionDate: '2026-03-01',
    accountId: BANK,
    amount: { amount: '1000.00', currency: 'BOB' },
  });
}

const lifecycleOf = (service: TransactionsService, transactionId: string) =>
  service.transactionLifecycle({ userId: USER, workspaceId: WS, transactionId });

describe('Recorrido de transacciones (add-lifecycle-timeline)', () => {
  it('[TC-AUDIT-LIFECYCLE-002] postear un gasto pendiente de 75.00 BOB escribe asiento, auditoría, evento y la transición POST que los referencia', async () => {
    const { service, state, balanceOf } = setup();
    await opening(service);
    const { transaction } = await service.recordTransaction(
      expense({ amount: { amount: '75.00', currency: 'BOB' }, status: 'PENDING' }),
    );
    const posted = await service.postTransaction(WS, transaction.id, transaction.version);
    const post = state.lifecycle.filter((l) => l.aggregateId === transaction.id).at(-1);
    expect(post).toMatchObject({
      kind: 'TRANSITION',
      transition: 'POST',
      fromState: 'PENDING',
      toState: 'POSTED',
      action: 'transactions.transaction.posted',
      journalEntries: { posted: posted.activeEntryId },
    });
    expect(post?.events?.map((e) => e.eventType)).toEqual(['transactions.TransactionPosted.v1']);
    const postedEvent = state.outbox.at(-1);
    expect(postedEvent?.payload).toMatchObject({ transition: 'POST', journalEntryId: posted.activeEntryId });
    expect(state.audit.at(-1)?.action).toBe('transactions.transaction.posted');
    expect(balanceOf(BANK)).toBe('925.00');
  });

  it('[TC-AUDIT-LIFECYCLE-002] si la transición no puede escribirse, el gasto sigue PENDING, sin asiento ni evento y el saldo en 1000.00 BOB', async () => {
    const { service, state, faults, balanceOf } = setup();
    await opening(service);
    const { transaction } = await service.recordTransaction(
      expense({ amount: { amount: '75.00', currency: 'BOB' }, status: 'PENDING' }),
    );
    const before = { entries: state.entries.length, outbox: state.outbox.length, audit: state.audit.length };
    faults.lifecycle = new Error('lifecycle store unavailable');
    await expect(service.postTransaction(WS, transaction.id, transaction.version)).rejects.toThrow(
      'lifecycle store unavailable',
    );
    expect(state.txs.get(transaction.id)?.status).toBe('PENDING');
    expect(state.entries).toHaveLength(before.entries);
    expect(state.outbox).toHaveLength(before.outbox);
    expect(state.audit).toHaveLength(before.audit);
    expect(state.lifecycle.filter((l) => l.aggregateId === transaction.id)).toHaveLength(1);
    expect(balanceOf(BANK)).toBe('1000.00');
  });

  it('[TC-AUDIT-LIFECYCLE-001] reconciliar un gasto pendiente de 80.00 BOB se rechaza y no registra transición', async () => {
    const { service, state } = setup();
    const { transaction } = await service.recordTransaction(expense({ status: 'PENDING' }));
    await expect(
      service.updateTransaction({
        workspaceId: WS,
        userId: USER,
        transactionId: transaction.id,
        expectedVersion: transaction.version,
        status: 'RECONCILED',
        reconciliationMode: 'WITHOUT_STATEMENT',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    expect(state.lifecycle.filter((l) => l.aggregateId === transaction.id)).toHaveLength(1);
    expect(state.txs.get(transaction.id)?.status).toBe('PENDING');
  });

  it('[TC-AUDIT-LIFECYCLE-003] corregir 120.00 → 102.00 BOB registra REVISE 1 → 2 con el asiento original, su reversa y el nuevo; saldo 898.00 BOB', async () => {
    const { service, state, balanceOf } = setup();
    await opening(service);
    const { transaction } = await service.recordTransaction(
      expense({ amount: { amount: '120.00', currency: 'BOB' } }),
    );
    const e1 = transaction.activeEntryId;
    const amended = await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: transaction.id,
      expectedVersion: transaction.version,
      amount: { amount: '102.00', currency: 'BOB' },
    });
    const reversal = state.entries.find((e) => e.reverses === e1)?.id;
    const revise = state.lifecycle.filter((l) => l.aggregateId === transaction.id).at(-1);
    expect(revise).toMatchObject({
      kind: 'TRANSITION',
      transition: 'REVISE',
      fromState: 'POSTED',
      toState: 'POSTED',
      revisionFrom: 1,
      revisionTo: 2,
      journalEntries: { reversed: e1, reversal, posted: amended.activeEntryId },
    });
    expect(revise?.events?.map((e) => e.eventType)).toEqual([
      'transactions.TransactionUpdated.v1',
      'transactions.TransactionPosted.v1',
    ]);
    expect(balanceOf(BANK)).toBe('898.00');
  });

  it('[TC-AUDIT-LIFECYCLE-004] recategorizar un gasto posteado de 150.00 BOB agrega una anotación sin transiciones ni asientos nuevos', async () => {
    const { service, state } = setup();
    const { transaction } = await service.recordTransaction(
      expense({
        amount: { amount: '150.00', currency: 'BOB' },
        splits: [{ amount: { amount: '150.00', currency: 'BOB' }, categoryId: 'food' }],
      }),
    );
    const entries = state.entries.length;
    await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: transaction.id,
      expectedVersion: transaction.version,
      splits: [{ amount: { amount: '150.00', currency: 'BOB' }, categoryId: 'restaurants' }],
    });
    const own = state.lifecycle.filter((l) => l.aggregateId === transaction.id);
    expect(own.map((l) => l.kind)).toEqual(['TRANSITION', 'ANNOTATION']);
    expect(own[1]).toMatchObject({ kind: 'ANNOTATION', changedFields: ['splits'] });
    expect(own[1]?.events?.map((e) => e.eventType)).toContain('transactions.TransactionCategorized.v1');
    expect(state.entries).toHaveLength(entries);
  });

  it('[TC-AUDIT-LIFECYCLE-005] registrar pendiente, postear, cleared, corregir a 85.00 y anular ("duplicado") deja 5 transiciones y saldo 1000.00 BOB', async () => {
    const { service, balanceOf } = setup();
    await opening(service);
    const { transaction } = await service.recordTransaction(expense({ status: 'PENDING' }));
    let tx = await service.postTransaction(WS, transaction.id, transaction.version);
    tx = (await service.markCleared(WS, [{ id: tx.id, version: tx.version }], true)).data[0]!;
    tx = await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: tx.id,
      expectedVersion: tx.version,
      amount: { amount: '85.00', currency: 'BOB' },
    });
    tx = await service.voidTransaction(WS, tx.id, tx.version, 'duplicado');
    const view = await lifecycleOf(service, tx.id);
    const steps = view.lifecycle.items.map((i) =>
      i.kind === 'TRANSITION' ? [i.transition, i.fromState, i.toState, i.reason] : [i.kind],
    );
    expect(steps).toEqual([
      ['RECORD', null, 'PENDING', null],
      ['POST', 'PENDING', 'POSTED', null],
      ['CLEAR', 'POSTED', 'CLEARED', null],
      ['REVISE', 'CLEARED', 'POSTED', null],
      ['VOID', 'POSTED', 'VOIDED', 'duplicado'],
    ]);
    expect(view.lifecycle.currentState).toBe('VOIDED');
    expect(view.lifecycle.path).toEqual(['PENDING', 'POSTED', 'CLEARED', 'POSTED', 'VOIDED']);
    expect(view.revisions.map((r) => [r.revision, r.amount.toFixed()])).toEqual([
      [1, '80.00'],
      [2, '85.00'],
    ]);
    expect(balanceOf(BANK)).toBe('1000.00');
  });

  it('[TC-AUDIT-LIFECYCLE-006] el recorrido de una transacción inexistente (u otro workspace) responde RESOURCE_NOT_FOUND', async () => {
    const { service } = setup();
    await expect(lifecycleOf(service, 'missing')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('[TC-AUDIT-LIFECYCLE-008] la conversión 100.000000 USDT → 685.00 BOB corregida a 686.00 enlaza cada revisión con su detalle (6.85 y 6.86) y sus asientos', async () => {
    const { service, conversions, state } = setup();
    await service.recordTransaction({
      workspaceId: WS,
      userId: USER,
      kind: 'INCOME',
      transactionDate: '2026-09-01',
      accountId: WALLET_USDT,
      amount: { amount: '100.000000', currency: 'USDT' },
    });
    const cmd: RecordConversionCommand = {
      workspaceId: WS,
      userId: USER,
      transactionDate: '2026-09-30',
      sourceAccountId: WALLET_USDT,
      targetAccountId: BANK_BOB,
      sourceAmount: { amount: '100.000000', currency: 'USDT' },
      targetAmount: { amount: '685.00', currency: 'BOB' },
      fees: [{ type: 'PROVIDER', amount: { amount: '5.00', currency: 'BOB' } }],
      executedAt: '2026-09-30T18:42:00Z',
    };
    const { transaction: original } = await conversions.recordConversion(cmd);
    const e1 = original.activeEntryId;
    const { transaction: amended } = await conversions.amendConversion({
      ...cmd,
      targetAmount: { amount: '686.00', currency: 'BOB' },
      transactionId: original.id,
      expectedVersion: original.version,
    });
    const view = await lifecycleOf(service, original.id);
    const [record, revise] = view.lifecycle.items;
    expect(record).toMatchObject({
      transition: 'RECORD',
      revisionTo: 1,
      detailRefs: { conversionRevision: 1 },
      journalEntries: { posted: e1 },
    });
    expect(revise).toMatchObject({
      transition: 'REVISE',
      revisionFrom: 1,
      revisionTo: 2,
      detailRefs: { conversionRevision: 2 },
      journalEntries: {
        reversed: e1,
        reversal: state.entries.find((e) => e.reverses === e1)?.id,
        posted: amended.activeEntryId,
      },
    });
    expect(
      view.revisions.map((r) => [
        r.revision,
        r.conversion?.targetAmount.toFixed(),
        r.conversion?.effectiveRate.value.toFixed(),
      ]),
    ).toEqual([
      [1, '685.00', '6.85'],
      [2, '686.00', '6.86'],
    ]);
  });
});
