import { DomainError } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CardChargeTransactionsAdapter } from './card-charge-transactions.port.js';
import { inMemoryTransactionsDeps } from './testing/in-memory.js';
import { TransactionsService } from './transactions.service.js';
import { CARD_CHARGE_NAMESPACE } from '../contracts/index.js';
import { isManaged } from '../domain/index.js';

const WS = 'ws-1';
const USER = 'user-1';
const CARD_ID = '0192f3c4-0000-7000-8000-0000000000c1';
const CHARGE_ID = '0192f3c4-0000-7000-8000-0000000000c2';
const VISA_BOB = 'visa-oro-bob';
const VISA_USD = 'visa-oro-usd';
const BANK = 'banco-bob';

function setup() {
  const mem = inMemoryTransactionsDeps({
    accounts: [
      { accountId: BANK, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: VISA_BOB, currency: 'BOB', nature: 'LIABILITY', status: 'ACTIVE' },
      { accountId: VISA_USD, currency: 'USD', nature: 'LIABILITY', status: 'ACTIVE' },
    ],
  });
  const service = new TransactionsService(mem.deps);
  return { ...mem, service, port: new CardChargeTransactionsAdapter(service) };
}

const amounts = (over: Record<string, string> = {}) => ({
  interest: '4.00',
  fees: '0.00',
  insurance: '0.80',
  taxes: '0.00',
  ...over,
});

const charge = (over: Record<string, unknown> = {}) => ({
  workspaceId: WS,
  userId: USER,
  chargeId: CHARGE_ID,
  cardId: CARD_ID,
  accountId: VISA_BOB,
  businessDate: '2026-10-25',
  currency: 'BOB',
  amounts: amounts(),
  description: 'Intereses y cargos Visa Oro',
  ...over,
});

async function codeOf(p: Promise<unknown>): Promise<DomainError | undefined> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  return undefined;
}

describe('CardChargeTransactionsPort.recordCharge', () => {
  it('[TC-DEBT-CARD-043] interés 4.00 y seguro 0.80: gasto de 4.80 con una porción por componente y la deuda sube 4.80', async () => {
    const { port, service, balanceOf } = setup();
    const before = balanceOf(VISA_BOB);
    const { transactionId } = await port.recordCharge(charge());
    const tx = await service.getTransaction(WS, transactionId);
    expect(tx).toMatchObject({
      kind: 'EXPENSE',
      source: 'DEBT',
      status: 'POSTED',
      debtRole: 'CARD_CHARGE',
      debtCardId: CARD_ID,
      externalRef: { namespace: CARD_CHARGE_NAMESPACE, id: CHARGE_ID },
    });
    expect(tx.amount.toFixed()).toBe('4.80');
    expect(tx.splits.map((s) => [s.categoryId, s.amount.toFixed()])).toEqual([
      ['cat-interest', '4.00'],
      ['cat-insurance', '0.80'],
    ]);
    // El pasivo se presenta con signo contable: la deuda aumenta 4.80.
    expect(Number(before) - Number(balanceOf(VISA_BOB))).toBeCloseTo(4.8, 2);
    expect(balanceOf('EXPENSE')).toBe('4.80');
  });

  it('[TC-DEBT-CARD-044] un cargo en dólares se registra en la cuenta USD con su porción de interés', async () => {
    const { port, service } = setup();
    const { transactionId } = await port.recordCharge(
      charge({
        accountId: VISA_USD,
        currency: 'USD',
        amounts: amounts({ interest: '1.25', insurance: '0.00' }),
      }),
    );
    const tx = await service.getTransaction(WS, transactionId);
    expect(tx.amount.toFixed()).toBe('1.25');
    expect(tx.amount.currency.code).toBe('USD');
    expect(tx.splits.map((s) => [s.categoryId, s.amount.toFixed()])).toEqual([['cat-interest', '1.25']]);
  });

  it('[TC-DEBT-CARD-045] sin componentes positivos ⇒ CARD_CHARGE_INVALID y no se crea nada', async () => {
    const { port, state } = setup();
    const err = await codeOf(
      port.recordCharge(charge({ amounts: amounts({ interest: '0.00', insurance: '0.00' }) })),
    );
    expect(err?.code).toBe('CARD_CHARGE_INVALID');
    expect(state.txs.size).toBe(0);
    expect(state.entries).toHaveLength(0);
  });

  it('[TC-DEBT-CARD-045] un componente negativo ⇒ AMOUNT_NOT_POSITIVE', async () => {
    const { port } = setup();
    const err = await codeOf(port.recordCharge(charge({ amounts: amounts({ fees: '-1.00' }) })));
    expect(err?.code).toBe('AMOUNT_NOT_POSITIVE');
  });

  it('[TC-DEBT-CARD-046] 1.255 USD de interés ⇒ AMOUNT_SCALE_EXCEEDED y no se crea nada', async () => {
    const { port, state } = setup();
    const err = await codeOf(
      port.recordCharge(
        charge({
          accountId: VISA_USD,
          currency: 'USD',
          amounts: amounts({ interest: '1.255', insurance: '0.00' }),
        }),
      ),
    );
    expect(err?.code).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(state.txs.size).toBe(0);
  });

  it('[TC-DEBT-CARD-055] reintentar con el mismo cargo no crea otra transacción ni otro asiento', async () => {
    const { port, state } = setup();
    const first = await port.recordCharge(charge());
    const second = await port.recordCharge(charge());
    expect(second.transactionId).toBe(first.transactionId);
    expect(state.txs.size).toBe(1);
    expect(state.entries).toHaveLength(1);
  });

  it('[TC-TRANSACTIONS-CARDCHARGE-004] las porciones suman el monto y el asiento cuadra para componentes aleatorios', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          interest: fc.integer({ min: 0, max: 1_000_000 }),
          fees: fc.integer({ min: 0, max: 1_000_000 }),
          insurance: fc.integer({ min: 0, max: 1_000_000 }),
          taxes: fc.integer({ min: 0, max: 1_000_000 }),
        }),
        async (cents) => {
          fc.pre(Object.values(cents).some((v) => v > 0));
          const { port, service, state } = setup();
          const text = (v: number) => `${Math.floor(v / 100)}.${String(v % 100).padStart(2, '0')}`;
          const { transactionId } = await port.recordCharge(
            charge({
              amounts: {
                interest: text(cents.interest),
                fees: text(cents.fees),
                insurance: text(cents.insurance),
                taxes: text(cents.taxes),
              },
            }),
          );
          const tx = await service.getTransaction(WS, transactionId);
          const sum = tx.splits.reduce((acc, s) => acc + Math.round(Number(s.amount.toFixed()) * 100), 0);
          expect(sum).toBe(Object.values(cents).reduce((a, b) => a + b, 0));
          expect(Math.round(Number(tx.amount.toFixed()) * 100)).toBe(sum);
          // El asiento cuadra: Σ de los postings = 0.
          const entry = state.entries.at(-1)!;
          const net = entry.postings.reduce((acc, p) => acc + Math.round(Number(String(p.amount)) * 100), 0);
          expect(net).toBe(0);
        },
      ),
      { numRuns: 40 },
    );
  }, 60_000);
});

describe('transacción administrada por la tarjeta', () => {
  it('[TC-TRANSACTIONS-CARDCHARGE-002] cambiar el monto desde transacciones ⇒ TRANSACTION_MANAGED_EXTERNALLY con la tarjeta', async () => {
    const { port, service } = setup();
    const { transactionId } = await port.recordCharge(charge());
    const tx = await service.getTransaction(WS, transactionId);
    expect(isManaged(tx)).toBe(true);
    const err = await codeOf(
      service.updateTransaction({
        workspaceId: WS,
        userId: USER,
        transactionId,
        expectedVersion: tx.version,
        amount: { amount: '5.00', currency: 'BOB' },
      }),
    );
    expect(err?.code).toBe('TRANSACTION_MANAGED_EXTERNALLY');
    expect(err?.details).toEqual({ managedBy: 'CREDIT_CARD', cardId: CARD_ID });
    expect((await service.getTransaction(WS, transactionId)).amount.toFixed()).toBe('4.80');
  });

  it('[TC-TRANSACTIONS-CARDCHARGE-002] anularlo desde transacciones también se rechaza', async () => {
    const { port, service } = setup();
    const { transactionId } = await port.recordCharge(charge());
    const tx = await service.getTransaction(WS, transactionId);
    const err = await codeOf(service.voidTransaction(WS, transactionId, tx.version, 'error'));
    expect(err?.code).toBe('TRANSACTION_MANAGED_EXTERNALLY');
  });

  it('[TC-TRANSACTIONS-CARDCHARGE-003] agregar una nota no toca el ledger', async () => {
    const { port, service, state } = setup();
    const { transactionId } = await port.recordCharge(charge());
    const tx = await service.getTransaction(WS, transactionId);
    const entries = state.entries.length;
    const updated = await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId,
      expectedVersion: tx.version,
      notes: 'interés por pago parcial de septiembre',
    });
    expect(updated.notes).toBe('interés por pago parcial de septiembre');
    expect(state.entries).toHaveLength(entries);
  });
});

describe('CardChargeTransactionsPort.voidCharge', () => {
  it('[TC-DEBT-CARD-049] anular revierte el asiento y la deuda vuelve a su valor; repetirlo es idempotente', async () => {
    const { port, service, balanceOf, state } = setup();
    const before = balanceOf(VISA_BOB);
    const { transactionId } = await port.recordCharge(charge());
    await port.voidCharge({ workspaceId: WS, userId: USER, transactionId, reason: 'monto equivocado' });
    expect(balanceOf(VISA_BOB)).toBe(before);
    expect(balanceOf('EXPENSE')).toBe('0.00');
    expect((await service.getTransaction(WS, transactionId)).status).toBe('VOIDED');
    const entries = state.entries.length;
    await port.voidCharge({ workspaceId: WS, userId: USER, transactionId, reason: 'otra vez' });
    expect(state.entries).toHaveLength(entries);
  });
});

describe('CardChargeTransactionsPort.adoptCharge', () => {
  async function manualInterest(
    ctx: ReturnType<typeof setup>,
    over: Record<string, unknown> = {},
  ): Promise<string> {
    const { transaction } = await ctx.service.recordTransaction({
      workspaceId: WS,
      userId: USER,
      kind: 'EXPENSE',
      transactionDate: '2026-10-25',
      accountId: VISA_BOB,
      amount: { amount: '4.80', currency: 'BOB' },
      description: 'Interés Visa',
      splits: [{ amount: { amount: '4.80', currency: 'BOB' }, categoryId: 'cat-interest' }],
      ...over,
    });
    return transaction.id;
  }
  const adopt = (transactionId: string, over: Record<string, unknown> = {}) => ({
    workspaceId: WS,
    userId: USER,
    cardId: CARD_ID,
    cardAccountIds: [VISA_BOB, VISA_USD],
    transactionId,
    amounts: amounts({ interest: '4.80', insurance: '0.00' }),
    ...over,
  });

  it('[TC-DEBT-CARD-051] adoptar un gasto manual lo marca como cargo sin crear transacciones ni cambiar el saldo', async () => {
    const ctx = setup();
    const id = await manualInterest(ctx);
    const balance = ctx.balanceOf(VISA_BOB);
    const txs = ctx.state.txs.size;
    await ctx.port.adoptCharge(adopt(id));
    const tx = await ctx.service.getTransaction(WS, id);
    expect(tx).toMatchObject({ debtRole: 'CARD_CHARGE', debtCardId: CARD_ID, source: 'MANUAL' });
    expect(tx.amount.toFixed()).toBe('4.80');
    expect(tx.splits.map((s) => [s.categoryId, s.amount.toFixed()])).toEqual([['cat-interest', '4.80']]);
    expect(ctx.balanceOf(VISA_BOB)).toBe(balance);
    expect(ctx.state.txs.size).toBe(txs);
  });

  it('adoptar un gasto sin categoría de interés reparte en componentes y deja el mismo neto contable', async () => {
    const ctx = setup();
    const id = await manualInterest(ctx, { splits: undefined });
    const balance = ctx.balanceOf(VISA_BOB);
    await ctx.port.adoptCharge(adopt(id, { amounts: amounts({ interest: '4.00', insurance: '0.80' }) }));
    const tx = await ctx.service.getTransaction(WS, id);
    expect(tx.splits.map((s) => [s.categoryId, s.amount.toFixed()])).toEqual([
      ['cat-interest', '4.00'],
      ['cat-insurance', '0.80'],
    ]);
    expect(ctx.balanceOf(VISA_BOB)).toBe(balance);
    expect(ctx.balanceOf('EXPENSE')).toBe('4.80');
    // Tras adoptar, la transacción queda administrada.
    expect(isManaged(tx)).toBe(true);
  });

  it('[TC-DEBT-CARD-052] componentes que no suman el gasto ⇒ CARD_CHARGE_INVALID y la transacción no cambia', async () => {
    const ctx = setup();
    const id = await manualInterest(ctx);
    const err = await codeOf(
      ctx.port.adoptCharge(adopt(id, { amounts: amounts({ interest: '4.00', insurance: '1.00' }) })),
    );
    expect(err?.code).toBe('CARD_CHARGE_INVALID');
    expect((await ctx.service.getTransaction(WS, id)).debtRole ?? null).toBeNull();
  });

  it('un gasto de otra cuenta, ya adoptado o registrado por DEBT se rechaza', async () => {
    const ctx = setup();
    const other = await manualInterest(ctx, { accountId: BANK });
    expect((await codeOf(ctx.port.adoptCharge(adopt(other))))?.code).toBe('CARD_CHARGE_INVALID');
    const id = await manualInterest(ctx);
    await ctx.port.adoptCharge(adopt(id));
    expect((await codeOf(ctx.port.adoptCharge(adopt(id))))?.code).toBe('CARD_CHARGE_INVALID');
    const { transactionId } = await ctx.port.recordCharge(charge());
    expect((await codeOf(ctx.port.adoptCharge(adopt(transactionId))))?.code).toBe('CARD_CHARGE_INVALID');
  });

  it('un cargo adoptado se anula con voidCharge (reversa del asiento)', async () => {
    const ctx = setup();
    const id = await manualInterest(ctx);
    await ctx.port.adoptCharge(adopt(id));
    await ctx.port.voidCharge({ workspaceId: WS, userId: USER, transactionId: id, reason: 'duplicado' });
    expect(ctx.balanceOf('EXPENSE')).toBe('0.00');
    expect((await ctx.service.getTransaction(WS, id)).status).toBe('VOIDED');
  });
});
