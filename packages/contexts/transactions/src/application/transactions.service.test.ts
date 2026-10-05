import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { inMemoryTransactionsDeps } from './testing/in-memory.js';
import { TransactionsService, type RecordTransactionCommand } from './transactions.service.js';

const WS = 'ws-1';
const USER = 'user-1';
const BANK = 'bank-a';
const ARCHIVED = 'bank-archived';

function setup() {
  const mem = inMemoryTransactionsDeps({
    accounts: [
      { accountId: BANK, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: ARCHIVED, currency: 'BOB', nature: 'ASSET', status: 'ARCHIVED' },
    ],
  });
  return { ...mem, service: new TransactionsService(mem.deps) };
}

const expense = (over: Partial<RecordTransactionCommand> = {}): RecordTransactionCommand => ({
  workspaceId: WS,
  userId: USER,
  kind: 'EXPENSE',
  transactionDate: '2026-09-30',
  accountId: BANK,
  amount: { amount: '150.00', currency: 'BOB' },
  description: 'Hipermaxi',
  ...over,
});

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
}

describe('TransactionsService — registro y posteo', () => {
  it('[TC-TRANSACTIONS-POSTING-001] el asiento se escribe en la misma unidad de trabajo; una falla inyectada revierte todo', async () => {
    const { service, state, faults, balanceOf } = setup();
    const { transaction } = await service.recordTransaction(expense());
    expect(transaction.activeEntryId).not.toBeNull();
    expect(balanceOf(BANK)).toBe('-150.00');
    expect(state.outbox.map((e) => e.eventType)).toEqual([
      'transactions.TransactionCreated',
      'transactions.TransactionPosted',
    ]);
    faults.audit = new Error('audit down');
    await expect(service.recordTransaction(expense())).rejects.toThrow('audit down');
    expect(state.txs.size).toBe(1);
    expect(state.entries).toHaveLength(1);
    expect(state.outbox).toHaveLength(2);
    expect(balanceOf(BANK)).toBe('-150.00');
  });

  it('[TC-TRANSACTIONS-PENDING-001] pendiente sin asiento; postTransaction crea el asiento y publica TransactionPosted', async () => {
    const { service, state, balanceOf } = setup();
    const { transaction } = await service.recordTransaction(expense({ status: 'PENDING' }));
    expect(transaction.activeEntryId).toBeNull();
    expect(state.entries).toHaveLength(0);
    const posted = await service.postTransaction(WS, transaction.id, transaction.version);
    expect(posted.status).toBe('POSTED');
    expect(balanceOf(BANK)).toBe('-150.00');
    expect(state.outbox.at(-1)?.payload).toMatchObject({ previousStatus: 'PENDING', revision: 1 });
    expect(await codeOf(service.postTransaction(WS, transaction.id, posted.version))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
  });

  it('[TC-TRANSACTIONS-ARCHIVED-001] no se registra ni se anula sobre una cuenta archivada (INV-026)', async () => {
    const { service, state } = setup();
    expect(await codeOf(service.recordTransaction(expense({ accountId: ARCHIVED })))).toBe(
      'ACCOUNT_ARCHIVED',
    );
    const { transaction } = await service.recordTransaction(expense());
    state.accounts.set(BANK, { accountId: BANK, currency: 'BOB', nature: 'ASSET', status: 'ARCHIVED' });
    expect(await codeOf(service.voidTransaction(WS, transaction.id, transaction.version, 'x'))).toBe(
      'ACCOUNT_ARCHIVED',
    );
  });

  it('[TC-TRANSACTIONS-SPLIT-005] split con categoría archivada ⇒ CATEGORY_ARCHIVED y nada se persiste', async () => {
    const { service, state } = setup();
    const err = await service
      .recordTransaction(
        expense({ splits: [{ amount: { amount: '150.00', currency: 'BOB' }, categoryId: 'archived' }] }),
      )
      .catch((e: DomainError) => e);
    expect((err as DomainError).code).toBe('CATEGORY_ARCHIVED');
    expect((err as DomainError).violations[0]?.pointer).toBe('/splits/0/categoryId');
    expect(state.txs.size).toBe(0);
  });

  it('[TC-TRANSACTIONS-REFUND-001] el reembolso sin splits acredita la categoría del gasto original', async () => {
    const { service } = setup();
    const { transaction: original } = await service.recordTransaction(
      expense({
        amount: { amount: '200.00', currency: 'BOB' },
        splits: [{ amount: { amount: '200.00', currency: 'BOB' }, categoryId: 'groceries' }],
      }),
    );
    const { transaction: refund } = await service.recordTransaction(
      expense({
        kind: 'REFUND',
        amount: { amount: '50.00', currency: 'BOB' },
        refundOfTransactionId: original.id,
      }),
    );
    expect(refund.splits[0]?.categoryId).toBe('groceries');
    expect(
      await codeOf(
        service.recordTransaction(
          expense({
            kind: 'REFUND',
            amount: { amount: '160.00', currency: 'BOB' },
            refundOfTransactionId: original.id,
          }),
        ),
      ),
    ).toBe('REFUND_EXCEEDS_ORIGINAL');
  });

  it('[TC-TRANSACTIONS-DUPLICATE-001] advertencia POSSIBLE_DUPLICATE no bloqueante en la respuesta de creación', async () => {
    const { service } = setup();
    const { transaction: first } = await service.recordTransaction(expense());
    const second = await service.recordTransaction(
      expense({ transactionDate: '2026-10-01', description: 'HIPERMAXI' }),
    );
    expect(second.warnings).toEqual([
      expect.objectContaining({ code: 'POSSIBLE_DUPLICATE', transactionIds: [first.id] }),
    ]);
    const candidates = await service.checkDuplicates({
      workspaceId: WS,
      accountId: BANK,
      amount: { amount: '150.00', currency: 'BOB' },
      transactionDate: '2026-10-02',
      description: 'hipermaxi',
    });
    expect(candidates).toHaveLength(2);
  });
});

describe('TransactionsService — edición, anulación y reconciliación', () => {
  it('[TC-TRANSACTIONS-EDIT-001] editar el monto revierte E1 y postea E2 con revisión 2 y supersedesJournalEntryId', async () => {
    const { service, state, balanceOf } = setup();
    const { transaction: t1 } = await service.recordTransaction(
      expense({ amount: { amount: '120.00', currency: 'BOB' } }),
    );
    const e1 = t1.activeEntryId;
    const updated = await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: t1.id,
      expectedVersion: 1,
      amount: { amount: '102.00', currency: 'BOB' },
    });
    expect(updated).toMatchObject({ revision: 2, version: 2, status: 'POSTED' });
    expect(state.entries.map((e) => e.reverses)).toEqual([null, e1, null]);
    expect(balanceOf(BANK)).toBe('-102.00');
    const posted = state.outbox.filter((e) => e.eventType === 'transactions.TransactionPosted').at(-1);
    expect(posted?.payload).toMatchObject({ revision: 2, supersedesJournalEntryId: e1 });
    expect(state.audit.at(-1)?.changes).toContainEqual({
      field: 'amount',
      before: expect.objectContaining({}),
      after: expect.objectContaining({}),
    });
  });

  it('[TC-TRANSACTIONS-EDIT-002] edición descriptiva: sin asientos nuevos ni TransactionPosted', async () => {
    const { service, state } = setup();
    const { transaction } = await service.recordTransaction(expense());
    await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: transaction.id,
      expectedVersion: 1,
      description: 'Ketal',
      notes: 'nota',
      paymentMethod: 'QR',
    });
    expect(state.entries).toHaveLength(1);
    expect(state.outbox.at(-1)).toMatchObject({
      eventType: 'transactions.TransactionUpdated',
      payload: { ledgerImpact: false, changedFields: ['description', 'notes'], paymentMethod: 'QR' },
    });
  });

  it('[TC-TRANSACTIONS-CONCURRENCY-001] versión desfasada ⇒ PRECONDITION_FAILED sin cambios', async () => {
    const { service } = setup();
    const { transaction } = await service.recordTransaction(expense());
    await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: transaction.id,
      expectedVersion: 1,
      description: 'a',
    });
    expect(
      await codeOf(
        service.updateTransaction({
          workspaceId: WS,
          userId: USER,
          transactionId: transaction.id,
          expectedVersion: 1,
          description: 'b',
        }),
      ),
    ).toBe('PRECONDITION_FAILED');
  });

  it('[TC-TRANSACTIONS-VOID-001] anular genera reversa y TransactionVoided; el saldo vuelve a cero', async () => {
    const { service, state, balanceOf } = setup();
    const { transaction } = await service.recordTransaction(expense());
    const voided = await service.voidTransaction(WS, transaction.id, 1, 'cargo duplicado');
    expect(voided.status).toBe('VOIDED');
    expect(balanceOf(BANK)).toBe('0.00');
    expect(state.outbox.at(-1)).toMatchObject({ eventType: 'transactions.TransactionVoided' });
    expect(state.audit.at(-1)).toMatchObject({
      action: 'transactions.transaction.voided',
      reason: 'cargo duplicado',
    });
  });

  it('[TC-TRANSACTIONS-CLEARED-001] marcar cleared individual no toca el ledger', async () => {
    const { service, state } = setup();
    const { transaction } = await service.recordTransaction(expense());
    const cleared = await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: transaction.id,
      expectedVersion: 1,
      status: 'CLEARED',
    });
    expect(cleared.status).toBe('CLEARED');
    expect(state.entries).toHaveLength(1);
    expect(state.audit.at(-1)?.action).toBe('transactions.transaction.cleared');
    expect(
      await codeOf(
        service.updateTransaction({
          workspaceId: WS,
          userId: USER,
          transactionId: transaction.id,
          expectedVersion: 2,
          status: 'RECONCILED',
          amount: { amount: '1.00', currency: 'BOB' },
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-TRANSACTIONS-CLEARED-002] lote all-or-nothing: un ítem desfasado ⇒ 412 por ítem y nada cambia', async () => {
    const { service, state } = setup();
    const a = (await service.recordTransaction(expense())).transaction;
    const b = (await service.recordTransaction(expense({ description: 'otro' }))).transaction;
    const err = await service
      .markCleared(
        WS,
        [
          { id: a.id, version: 1 },
          { id: b.id, version: 9 },
        ],
        true,
      )
      .catch((e: DomainError) => e);
    expect((err as DomainError).code).toBe('PRECONDITION_FAILED');
    expect((err as DomainError).violations.map((v) => v.pointer)).toEqual(['/items/1/version']);
    expect(state.txs.get(a.id)?.status).toBe('POSTED');
    const ok = await service.markCleared(
      WS,
      [
        { id: a.id, version: 1 },
        { id: b.id, version: 1 },
      ],
      true,
    );
    expect(ok.data.map((t) => t.status)).toEqual(['CLEARED', 'CLEARED']);
    const bulk = state.audit
      .slice(-2)
      .map((x) => x.changes?.find((c) => c.field === 'bulkOperationId')?.after);
    expect(bulk).toEqual([ok.bulkOperationId, ok.bulkOperationId]);
  });

  it('[TC-TRANSACTIONS-RECONCILED-003] des-reconciliar y luego editar el monto: reversa + nuevo asiento, queda posted', async () => {
    const { service, balanceOf } = setup();
    const { transaction } = await service.recordTransaction(expense({ status: 'CLEARED' }));
    const rec = await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: transaction.id,
      expectedVersion: 1,
      status: 'RECONCILED',
    });
    expect(await codeOf(service.voidTransaction(WS, transaction.id, rec.version, 'x'))).toBe(
      'TRANSACTION_RECONCILED',
    );
    const un = await service.unreconcileTransaction(WS, transaction.id, rec.version, 'error en el extracto');
    expect(un.status).toBe('CLEARED');
    const edited = await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: transaction.id,
      expectedVersion: un.version,
      amount: { amount: '155.00', currency: 'BOB' },
    });
    expect(edited).toMatchObject({ status: 'POSTED', revision: 2 });
    expect(balanceOf(BANK)).toBe('-155.00');
  });

  it('[TC-TRANSACTIONS-HISTORY-001] el historial incluye creación y cambios de la transacción', async () => {
    const { service } = setup();
    const { transaction } = await service.recordTransaction(expense());
    await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: transaction.id,
      expectedVersion: 1,
      description: 'x',
    });
    const history = await service.transactionHistory({
      userId: USER,
      workspaceId: WS,
      transactionId: transaction.id,
      limit: 50,
    });
    expect(history.map((h) => h.action)).toEqual([
      'transactions.transaction.created',
      'transactions.transaction.updated',
    ]);
    expect(
      await codeOf(
        service.transactionHistory({ userId: USER, workspaceId: WS, transactionId: 'nope', limit: 5 }),
      ),
    ).toBe('RESOURCE_NOT_FOUND');
  });

  it('[TC-TRANSACTIONS-LIST-001] el filtro por categoría incluye subcategorías', async () => {
    const { service } = setup();
    await service.recordTransaction(
      expense({ splits: [{ amount: { amount: '150.00', currency: 'BOB' }, categoryId: 'food-child' }] }),
    );
    await service.recordTransaction(
      expense({ splits: [{ amount: { amount: '150.00', currency: 'BOB' }, categoryId: 'other' }] }),
    );
    const found = await service.listTransactions({
      workspaceId: WS,
      categoryIds: ['food'],
      offset: 0,
      limit: 10,
    });
    expect(found).toHaveLength(1);
  });
});

describe('TransactionsService — periodo cerrado (INV-015, docs/31 D49)', () => {
  it('[TC-CLASSIFICATION-RECATEGORIZE-002] recategorizar en un mes cerrado ⇒ PERIOD_CLOSED sin cambios; en un mes abierto se acepta', async () => {
    const { service, state } = setup();
    const { transaction } = await service.recordTransaction(
      expense({
        transactionDate: '2026-02-10',
        splits: [{ amount: { amount: '150.00', currency: 'BOB' }, categoryId: 'groceries' }],
      }),
    );
    state.closedMonths.add('2026-02');
    const before = { outbox: state.outbox.length, audit: state.audit.length, entries: state.entries.length };
    expect(
      await codeOf(
        service.updateTransaction({
          workspaceId: WS,
          userId: USER,
          transactionId: transaction.id,
          expectedVersion: transaction.version,
          splits: [{ amount: { amount: '150.00', currency: 'BOB' }, categoryId: 'home' }],
        }),
      ),
    ).toBe('PERIOD_CLOSED');
    expect(state.txs.get(transaction.id)?.splits.map((s) => s.categoryId)).toEqual(['groceries']);
    expect(state.txs.get(transaction.id)?.version).toBe(transaction.version);
    expect({ outbox: state.outbox.length, audit: state.audit.length, entries: state.entries.length }).toEqual(
      before,
    );
    // En un mes abierto la recategorización se acepta.
    state.closedMonths.delete('2026-02');
    const reclassified = await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: transaction.id,
      expectedVersion: transaction.version,
      splits: [{ amount: { amount: '150.00', currency: 'BOB' }, categoryId: 'home' }],
    });
    expect(reclassified.splits.map((s) => s.categoryId)).toEqual(['home']);
  });
});
