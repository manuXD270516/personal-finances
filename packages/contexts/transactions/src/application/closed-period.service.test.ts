import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { inMemoryTransactionsDeps } from './testing/in-memory.js';
import {
  TransactionsService,
  type RecordTransactionCommand,
  type UpdateTransactionCommand,
} from './transactions.service.js';

const WS = 'ws-1';
const USER = 'user-1';
const BANK = 'bank-a';
const BANK_B = 'bank-b';
const CP1 = 'counterparty-1';
const CP2 = 'counterparty-2';
const TAG = 'tag-viaje';

function setup() {
  const mem = inMemoryTransactionsDeps({
    accounts: [
      { accountId: BANK, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: BANK_B, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
    ],
  });
  return { ...mem, service: new TransactionsService(mem.deps) };
}

const expense = (over: Partial<RecordTransactionCommand> = {}): RecordTransactionCommand => ({
  workspaceId: WS,
  userId: USER,
  kind: 'EXPENSE',
  transactionDate: '2026-10-10',
  accountId: BANK,
  amount: { amount: '80.00', currency: 'BOB' },
  description: 'Cena',
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

describe('TransactionsService — pendientes en periodos cerrados (D69)', () => {
  it('[TC-TRANSACTIONS-PENDINGCLOSED-001] registrar PENDING en un mes cerrado ⇒ PERIOD_CLOSED sin crear nada; en uno abierto se acepta', async () => {
    const { service, state } = setup();
    state.closedMonths.add('2026-10');
    const before = { txs: state.txs.size, audit: state.audit.length, outbox: state.outbox.length };
    expect(
      await codeOf(
        service.recordTransaction(
          expense({
            status: 'PENDING',
            transactionDate: '2026-10-29',
            amount: { amount: '60.00', currency: 'BOB' },
          }),
        ),
      ),
    ).toBe('PERIOD_CLOSED');
    expect({ txs: state.txs.size, audit: state.audit.length, outbox: state.outbox.length }).toEqual(before);
    const { transaction } = await service.recordTransaction(
      expense({
        status: 'PENDING',
        transactionDate: '2026-11-02',
        amount: { amount: '60.00', currency: 'BOB' },
      }),
    );
    expect(transaction.status).toBe('PENDING');
    // Transferencias PENDING siguen la misma regla.
    expect(
      await codeOf(
        service.recordTransfer({
          workspaceId: WS,
          userId: USER,
          status: 'PENDING',
          transactionDate: '2026-10-29',
          fromAccountId: BANK,
          toAccountId: BANK_B,
          amount: { amount: '10.00', currency: 'BOB' },
        }),
      ),
    ).toBe('PERIOD_CLOSED');
    // Un gasto POSTED en el mes cerrado lo rechaza el ledger (no se duplica la regla aquí).
    expect(state.txs.size).toBe(1);
  });

  it('[TC-TRANSACTIONS-PENDINGCLOSED-001] mover una PENDING a un mes cerrado ⇒ PERIOD_CLOSED y conserva su fecha; otras ediciones en mes abierto se aceptan', async () => {
    const { service, state } = setup();
    const { transaction } = await service.recordTransaction(
      expense({
        status: 'PENDING',
        transactionDate: '2026-11-02',
        amount: { amount: '60.00', currency: 'BOB' },
      }),
    );
    state.closedMonths.add('2026-10');
    expect(
      await codeOf(
        service.updateTransaction({
          workspaceId: WS,
          userId: USER,
          transactionId: transaction.id,
          expectedVersion: transaction.version,
          transactionDate: '2026-10-30',
        }),
      ),
    ).toBe('PERIOD_CLOSED');
    expect(state.txs.get(transaction.id)?.businessDate).toBe('2026-11-02');
    expect(state.txs.get(transaction.id)?.version).toBe(transaction.version);
    const edited = await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: transaction.id,
      expectedVersion: transaction.version,
      notes: 'ok',
    });
    expect(edited.notes).toBe('ok');
  });
});

describe('TransactionsService — alcance de la edición en periodos cerrados (ADR-0028)', () => {
  async function closedExpense() {
    const ctx = setup();
    const { transaction } = await ctx.service.recordTransaction(
      expense({
        splits: [
          { amount: { amount: '80.00', currency: 'BOB' }, categoryId: 'groceries', counterpartyId: CP1 },
        ],
        counterpartyId: CP1,
      }),
    );
    ctx.state.closedMonths.add('2026-10');
    const update = (over: Partial<UpdateTransactionCommand>) =>
      ctx.service.updateTransaction({
        workspaceId: WS,
        userId: USER,
        transactionId: transaction.id,
        expectedVersion: transaction.version,
        ...over,
      });
    const snapshot = () => ({
      audit: ctx.state.audit.length,
      outbox: ctx.state.outbox.length,
      version: ctx.state.txs.get(transaction.id)?.version,
    });
    return { ...ctx, transaction, update, snapshot };
  }

  it('[TC-PLANNING-LOCK-004] agregar un tag a un gasto de un mes cerrado ⇒ PERIOD_CLOSED sin cambios ni auditoría', async () => {
    const { update, snapshot, state, transaction } = await closedExpense();
    const before = snapshot();
    expect(
      await codeOf(
        update({
          splits: [
            {
              amount: { amount: '80.00', currency: 'BOB' },
              categoryId: 'groceries',
              counterpartyId: CP1,
              tagIds: [TAG],
            },
          ],
        }),
      ),
    ).toBe('PERIOD_CLOSED');
    expect(snapshot()).toEqual(before);
    expect(state.txs.get(transaction.id)?.splits[0]?.tagIds).toEqual([]);
  });

  it('[TC-PLANNING-LOCK-004] cambiar la contraparte (de la transacción o de un split) ⇒ PERIOD_CLOSED', async () => {
    const { update, snapshot, state, transaction } = await closedExpense();
    const before = snapshot();
    expect(await codeOf(update({ counterpartyId: CP2 }))).toBe('PERIOD_CLOSED');
    expect(
      await codeOf(
        update({
          splits: [
            { amount: { amount: '80.00', currency: 'BOB' }, categoryId: 'groceries', counterpartyId: CP2 },
          ],
        }),
      ),
    ).toBe('PERIOD_CLOSED');
    expect(snapshot()).toEqual(before);
    expect(state.txs.get(transaction.id)?.counterpartyId).toBe(CP1);
    expect(state.txs.get(transaction.id)?.splits[0]?.counterpartyId).toBe(CP1);
  });

  it('[TC-PLANNING-LOCK-004] cambiar el estado de confirmación (individual y masivo) o des-reconciliar ⇒ PERIOD_CLOSED', async () => {
    const { update, service, transaction, state } = await closedExpense();
    expect(await codeOf(update({ status: 'CLEARED' }))).toBe('PERIOD_CLOSED');
    expect(
      await codeOf(service.markCleared(WS, [{ id: transaction.id, version: transaction.version }], true)),
    ).toBe('PERIOD_CLOSED');
    expect(state.txs.get(transaction.id)?.status).toBe('POSTED');
  });

  it('[TC-PLANNING-LOCK-004] notas, descripción y medio de pago se aceptan en un mes cerrado', async () => {
    const { update } = await closedExpense();
    const edited = await update({ notes: 'nota nueva', description: 'Cena con amigos', paymentMethod: 'QR' });
    expect([edited.notes, edited.description, edited.paymentMethod]).toEqual([
      'nota nueva',
      'Cena con amigos',
      'QR',
    ]);
  });
});

describe('TransactionsService — anulación corregida (VoidRequest.correctInCurrentPeriod)', () => {
  async function closedPosted() {
    const ctx = setup();
    const { transaction } = await ctx.service.recordTransaction(expense());
    ctx.state.closedMonths.add('2026-10');
    return { ...ctx, transaction };
  }

  it('[TC-PLANNING-LOCK-001] con correctInCurrentPeriod la reversa se fecha en la primera fecha abierta del ledger', async () => {
    const { service, transaction, state, balanceOf } = await closedPosted();
    const voided = await service.voidTransaction(WS, transaction.id, transaction.version, 'corrección', {
      correctInCurrentPeriod: true,
    });
    expect(voided.status).toBe('VOIDED');
    expect(state.entries.find((e) => e.reverses !== null)?.reverseDate).toBe('2026-11-01');
    expect(balanceOf(BANK)).toBe('0.00');
  });

  it('[TC-PLANNING-LOCK-001] sin la bandera y con el periodo cerrado ⇒ PERIOD_CLOSED y la transacción sigue POSTED', async () => {
    const { service, transaction, state } = await closedPosted();
    expect(await codeOf(service.voidTransaction(WS, transaction.id, transaction.version, 'x'))).toBe(
      'PERIOD_CLOSED',
    );
    expect(await codeOf(service.voidTransaction(WS, transaction.id, transaction.version, 'x', {}))).toBe(
      'PERIOD_CLOSED',
    );
    expect(state.txs.get(transaction.id)?.status).toBe('POSTED');
  });

  it('[TC-PLANNING-LOCK-001] con la bandera y el periodo abierto la reversa va en la fecha original', async () => {
    const { service, state } = setup();
    const { transaction } = await service.recordTransaction(expense({ transactionDate: '2026-11-05' }));
    await service.voidTransaction(WS, transaction.id, transaction.version, 'x', {
      correctInCurrentPeriod: true,
    });
    expect(state.entries.find((e) => e.reverses !== null)?.reverseDate).toBe('2026-11-05');
  });
});
