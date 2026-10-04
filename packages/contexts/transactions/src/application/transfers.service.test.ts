import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { inMemoryTransactionsDeps } from './testing/in-memory.js';
import { TransactionsService, type RecordTransferCommand } from './transactions.service.js';

const WS = 'ws-1';
const USER = 'user-1';
const A = 'bank-a';
const B = 'bank-b';
const CARD = 'credit-card';
const USD = 'usd-savings';
const ARCHIVED = 'bank-archived';

function setup() {
  const mem = inMemoryTransactionsDeps({
    accounts: [
      { accountId: A, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: B, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: CARD, currency: 'BOB', nature: 'LIABILITY', status: 'ACTIVE' },
      { accountId: USD, currency: 'USD', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: ARCHIVED, currency: 'BOB', nature: 'ASSET', status: 'ARCHIVED' },
    ],
  });
  return { ...mem, service: new TransactionsService(mem.deps) };
}

const cmd = (over: Partial<RecordTransferCommand> = {}): RecordTransferCommand => ({
  workspaceId: WS,
  userId: USER,
  transactionDate: '2026-03-15',
  fromAccountId: A,
  toAccountId: B,
  amount: { amount: '300.00', currency: 'BOB' },
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

/** Patrimonio = Σ saldos contables de las cuentas del usuario (activo +, pasivo −). */
const netWorth = (balanceOf: (k: string) => string) =>
  [A, B, CARD].reduce((acc, k) => acc + Number(balanceOf(k)), 0).toFixed(2);

describe('RecordTransfer', () => {
  it('[TC-LEDGER-TRANSFER-001] ejemplo canónico: A 1000.00 → B 300.00 BOB deja A 700.00, B 300.00 y patrimonio igual', async () => {
    const { service, state, balanceOf } = setup();
    await service.recordTransaction({
      workspaceId: WS,
      userId: USER,
      kind: 'INCOME',
      transactionDate: '2026-03-01',
      accountId: A,
      amount: { amount: '1000.00', currency: 'BOB' },
    });
    const before = netWorth(balanceOf);
    const tx = await service.recordTransfer(cmd());
    expect(tx.kind).toBe('TRANSFER');
    expect(balanceOf(A)).toBe('700.00');
    expect(balanceOf(B)).toBe('300.00');
    expect(netWorth(balanceOf)).toBe(before);
    expect(balanceOf('EXPENSE')).toBe('0.00');
    const entry = state.entries.at(-1);
    expect(entry?.postings.map((p) => p.key)).toEqual([A, B]);
  });

  it('[TC-TRANSACTIONS-TRANSFER-002] la transferencia no cuenta como ingreso ni gasto', async () => {
    const { service, balanceOf } = setup();
    await service.recordTransfer(cmd());
    expect(balanceOf('INCOME')).toBe('0.00');
    expect(balanceOf('EXPENSE')).toBe('0.00');
    expect(netWorth(balanceOf)).toBe('0.00');
  });

  it('[TC-TRANSACTIONS-TRANSFER-003] misma cuenta ⇒ TRANSFER_SAME_ACCOUNT sin persistir nada', async () => {
    const { service, state } = setup();
    expect(await codeOf(service.recordTransfer(cmd({ toAccountId: A })))).toBe('TRANSFER_SAME_ACCOUNT');
    expect(state.txs.size).toBe(0);
    expect(state.entries).toHaveLength(0);
  });

  it('[TC-TRANSACTIONS-TRANSFER-001] BOB → USD ⇒ TRANSFER_CURRENCY_MISMATCH sin persistir nada', async () => {
    const { service, state } = setup();
    expect(
      await codeOf(
        service.recordTransfer(cmd({ toAccountId: USD, amount: { amount: '100.00', currency: 'BOB' } })),
      ),
    ).toBe('TRANSFER_CURRENCY_MISMATCH');
    expect(state.txs.size).toBe(0);
    expect(state.outbox).toHaveLength(0);
  });

  it('[TC-TRANSACTIONS-TRANSFER-004] comisión: A −1010.00, B +1000.00, gasto en Fees 10.00 y patrimonio −10.00', async () => {
    const { service, balanceOf } = setup();
    const tx = await service.recordTransfer(
      cmd({
        amount: { amount: '1000.00', currency: 'BOB' },
        fee: { amount: { amount: '10.00', currency: 'BOB' } },
      }),
    );
    expect(tx.splits.map((s) => [s.categoryId, s.amount.toFixed()])).toEqual([['cat-fees', '10.00']]);
    expect(balanceOf(A)).toBe('-1010.00');
    expect(balanceOf(B)).toBe('1000.00');
    expect(balanceOf('EXPENSE')).toBe('10.00');
    expect(netWorth(balanceOf)).toBe('-10.00');
  });

  it('[TC-TRANSACTIONS-TRANSFER-005] destino archivado ⇒ ACCOUNT_ARCHIVED sin persistir nada', async () => {
    const { service, state, balanceOf } = setup();
    expect(await codeOf(service.recordTransfer(cmd({ toAccountId: ARCHIVED })))).toBe('ACCOUNT_ARCHIVED');
    expect(state.txs.size).toBe(0);
    expect(balanceOf(A)).toBe('0.00');
  });

  it('[TC-TRANSACTIONS-CARDPAYMENT-001] pago de tarjeta con QR: reduce deuda y activo, no es gasto', async () => {
    const { service, balanceOf, state } = setup();
    await service.recordTransaction({
      workspaceId: WS,
      userId: USER,
      kind: 'EXPENSE',
      transactionDate: '2026-03-10',
      accountId: CARD,
      amount: { amount: '350.00', currency: 'BOB' },
    });
    expect(balanceOf(CARD)).toBe('-350.00');
    const before = netWorth(balanceOf);
    const tx = await service.recordTransfer(
      cmd({ toAccountId: CARD, amount: { amount: '350.00', currency: 'BOB' }, paymentMethod: 'QR' }),
    );
    expect(tx.paymentMethod).toBe('QR');
    expect(balanceOf(CARD)).toBe('0.00');
    expect(balanceOf(A)).toBe('-350.00');
    expect(balanceOf('EXPENSE')).toBe('350.00');
    expect(netWorth(balanceOf)).toBe(before);
    expect(state.outbox.at(-1)?.eventType).toBe('transactions.TransferCompleted');
  });

  it('[TC-TRANSACTIONS-TRANSFER-006] pending sin asiento ni TransferCompleted; al postear se publica exactamente uno', async () => {
    const { service, state, balanceOf } = setup();
    const tx = await service.recordTransfer(cmd({ status: 'PENDING' }));
    expect(state.entries).toHaveLength(0);
    expect(state.outbox.map((e) => e.eventType)).toEqual(['transactions.TransactionCreated']);
    await service.postTransaction(WS, tx.id, tx.version);
    const completed = state.outbox.filter((e) => e.eventType === 'transactions.TransferCompleted');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.payload).toMatchObject({
      transactionId: tx.id,
      fromAccountId: A,
      toAccountId: B,
      amount: { amount: '300.00', currency: 'BOB' },
      fee: null,
      matchedTransactionIds: [],
    });
    expect(balanceOf(B)).toBe('300.00');
  });

  it('auditoría en la misma unidad de trabajo: si falla, nada se persiste', async () => {
    const { service, state, faults } = setup();
    faults.audit = new Error('audit down');
    await expect(service.recordTransfer(cmd())).rejects.toThrow('audit down');
    expect(state.txs.size).toBe(0);
    expect(state.entries).toHaveLength(0);
    expect(state.outbox).toHaveLength(0);
  });

  it('[TC-TRANSACTIONS-TRANSFER-009] corregir 300.00 → 250.00 BOB publica un único TransferCompleted y un único TransferRevised con los tres asientos', async () => {
    const { service, state, balanceOf } = setup();
    await service.recordTransaction({
      workspaceId: WS,
      userId: USER,
      kind: 'INCOME',
      transactionDate: '2026-03-01',
      accountId: A,
      amount: { amount: '1000.00', currency: 'BOB' },
    });
    const tx = await service.recordTransfer(cmd());
    const firstEntry = tx.activeEntryId;
    const revised = await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: tx.id,
      expectedVersion: tx.version,
      amount: { amount: '250.00', currency: 'BOB' },
    });
    expect(balanceOf(A)).toBe('750.00');
    expect(balanceOf(B)).toBe('250.00');
    expect(netWorth(balanceOf)).toBe('1000.00');
    const completed = state.outbox.filter((e) => e.eventType === 'transactions.TransferCompleted');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.payload['amount']).toEqual({ amount: '300.00', currency: 'BOB' });
    const revisedEvents = state.outbox.filter((e) => e.eventType === 'transactions.TransferRevised');
    expect(revisedEvents).toHaveLength(1);
    const p = revisedEvents[0]?.payload ?? {};
    const reversal = state.entries.find((e) => e.reverses === firstEntry)?.id;
    expect(p).toEqual({
      transactionId: tx.id,
      revisionFrom: 1,
      revisionTo: 2,
      businessDate: '2026-03-15',
      fromAccountId: A,
      toAccountId: B,
      amount: { amount: '250.00', currency: 'BOB' },
      fee: null,
      reversedJournalEntryId: firstEntry,
      reversalJournalEntryId: reversal,
      journalEntryId: revised.activeEntryId,
    });
    // TransactionPosted de la revisión enlaza el asiento reemplazado y nombra la transición.
    const posted = state.outbox.filter((e) => e.eventType === 'transactions.TransactionPosted').at(-1);
    expect(posted?.payload).toMatchObject({ supersedesJournalEntryId: firstEntry, transition: 'REVISE' });
  });

  it('[TC-TRANSACTIONS-TRANSFER-009] la edición descriptiva de una transferencia no publica TransferRevised ni TransferCompleted', async () => {
    const { service, state } = setup();
    const tx = await service.recordTransfer(cmd());
    await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: tx.id,
      expectedVersion: tx.version,
      description: 'ahorro mensual',
    });
    expect(state.outbox.filter((e) => e.eventType === 'transactions.TransferCompleted')).toHaveLength(1);
    expect(state.outbox.filter((e) => e.eventType === 'transactions.TransferRevised')).toHaveLength(0);
  });

  it('[TC-AUDIT-LIFECYCLE-007] el recorrido de la transferencia corregida muestra RECORD (300.00, completada) y REVISE (250.00, revisada)', async () => {
    const { service } = setup();
    const tx = await service.recordTransfer(cmd());
    await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId: tx.id,
      expectedVersion: tx.version,
      amount: { amount: '250.00', currency: 'BOB' },
    });
    const view = await service.transactionLifecycle({ userId: USER, workspaceId: WS, transactionId: tx.id });
    const transitions = view.lifecycle.items.filter((i) => i.kind === 'TRANSITION');
    expect(
      transitions.map((t) => [t.transition, t.fromState, t.toState, t.revisionFrom, t.revisionTo]),
    ).toEqual([
      ['RECORD', null, 'POSTED', null, 1],
      ['REVISE', 'POSTED', 'POSTED', 1, 2],
    ]);
    expect(transitions[0]?.events).toContain('transactions.TransferCompleted.v1');
    expect(transitions[1]?.events).toContain('transactions.TransferRevised.v1');
    expect(transitions[1]?.events).not.toContain('transactions.TransferCompleted.v1');
    expect(
      view.revisions.map((r) => [r.revision, r.amount.toFixed(), r.legs.map((l) => [l.role, l.accountId])]),
    ).toEqual([
      [
        1,
        '300.00',
        [
          ['SOURCE', A],
          ['TARGET', B],
        ],
      ],
      [
        2,
        '250.00',
        [
          ['SOURCE', A],
          ['TARGET', B],
        ],
      ],
    ]);
  });

  it('amend del destino a otra moneda ⇒ TRANSFER_CURRENCY_MISMATCH', async () => {
    const { service } = setup();
    const tx = await service.recordTransfer(cmd());
    expect(
      await codeOf(
        service.updateTransaction({
          workspaceId: WS,
          userId: USER,
          transactionId: tx.id,
          expectedVersion: tx.version,
          toAccountId: USD,
        }),
      ),
    ).toBe('TRANSFER_CURRENCY_MISMATCH');
  });
});
