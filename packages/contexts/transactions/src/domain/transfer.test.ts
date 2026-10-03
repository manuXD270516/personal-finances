import { DomainError, Money } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BANK_A, BOB, CARD, USD, WS, bob, nextId } from './fixtures.test-support.js';
import { toJournalEntryDraft } from './posting-translator.js';
import { Transaction, type RecordTransferInput, type TransferAccount } from './transaction.js';

const BANK_B = '0192f3c4-0000-7000-8000-0000000000b2';
const USD_SAVINGS = '0192f3c4-0000-7000-8000-0000000000d1';
const FEES = '0192f3c4-0000-7000-8000-0000000000fe';
const A: TransferAccount = { accountId: BANK_A, nature: 'ASSET', currency: 'BOB' };
const B: TransferAccount = { accountId: BANK_B, nature: 'ASSET', currency: 'BOB' };
const CC: TransferAccount = { accountId: CARD, nature: 'LIABILITY', currency: 'BOB' };
const USD_ACC: TransferAccount = { accountId: USD_SAVINGS, nature: 'ASSET', currency: 'USD' };

const transfer = (over: Partial<RecordTransferInput> = {}): Transaction =>
  Transaction.recordTransfer({
    id: nextId(),
    workspaceId: WS,
    businessDate: '2026-03-15',
    from: A,
    to: B,
    amount: bob('300.00'),
    ...over,
  });

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
};

/** ΔPatrimonio = Σ postings sobre cuentas del usuario (signo contable: activo +, pasivo −). */
const netWorthDelta = (tx: Transaction): Money =>
  Money.sum(
    toJournalEntryDraft(tx.snapshot)
      .postings.filter((p) => p.target.kind === 'USER_ACCOUNT')
      .map((p) => p.amount),
    BOB,
  );

describe('Transaction.recordTransfer', () => {
  it('[TC-TRANSACTIONS-TRANSFER-002] una transferencia es un único asiento balanceado que preserva el patrimonio y no toca INCOME/EXPENSE', () => {
    const tx = transfer();
    const s = tx.snapshot;
    expect(s.kind).toBe('TRANSFER');
    expect(s.legs.map((l) => [l.role, l.accountId, l.amount.toFixed()])).toEqual([
      ['SOURCE', BANK_A, '-300.00'],
      ['TARGET', BANK_B, '300.00'],
    ]);
    expect(s.splits).toEqual([]);
    const draft = toJournalEntryDraft(s);
    expect(draft.postings.every((p) => p.target.kind === 'USER_ACCOUNT')).toBe(true);
    expect(
      Money.sum(
        draft.postings.map((p) => p.amount),
        BOB,
      ).isZero(),
    ).toBe(true);
    expect(netWorthDelta(tx).isZero()).toBe(true);
  });

  it('[TC-TRANSACTIONS-TRANSFER-003] origen y destino iguales se rechazan con TRANSFER_SAME_ACCOUNT', () => {
    expect(codeOf(() => transfer({ to: A }))).toBe('TRANSFER_SAME_ACCOUNT');
  });

  it('[TC-TRANSACTIONS-TRANSFER-001] cuentas de distinta moneda se rechazan con TRANSFER_CURRENCY_MISMATCH', () => {
    expect(codeOf(() => transfer({ to: USD_ACC }))).toBe('TRANSFER_CURRENCY_MISMATCH');
    expect(codeOf(() => transfer({ amount: Money.parse('100.00', USD) }))).toBe('TRANSFER_CURRENCY_MISMATCH');
  });

  it('rechaza montos y comisiones no positivos', () => {
    expect(codeOf(() => transfer({ amount: bob('0.00') }))).toBe('AMOUNT_NOT_POSITIVE');
    expect(
      codeOf(() => transfer({ fee: { amount: bob('0.00'), categoryId: FEES, splitId: nextId() } })),
    ).toBe('AMOUNT_NOT_POSITIVE');
  });

  it('[TC-TRANSACTIONS-TRANSFER-004] la comisión sale del origen como gasto en Fees y el patrimonio baja exactamente su monto', () => {
    const tx = transfer({
      amount: bob('1000.00'),
      fee: { amount: bob('10.00'), categoryId: FEES, splitId: nextId() },
    });
    const s = tx.snapshot;
    expect(s.legs.map((l) => l.amount.toFixed())).toEqual(['-1010.00', '1000.00']);
    expect(s.splits.map((x) => [x.categoryId, x.amount.toFixed()])).toEqual([[FEES, '10.00']]);
    const draft = toJournalEntryDraft(s);
    const expense = draft.postings.filter((p) => p.target.kind === 'SYSTEM');
    expect(expense.map((p) => [p.target, p.amount.toFixed()])).toEqual([
      [{ kind: 'SYSTEM', systemKind: 'EXPENSE' }, '10.00'],
    ]);
    expect(
      Money.sum(
        draft.postings.map((p) => p.amount),
        BOB,
      ).isZero(),
    ).toBe(true);
    expect(netWorthDelta(tx).toFixed()).toBe('-10.00');
  });

  it('[TC-TRANSACTIONS-CARDPAYMENT-001] el pago de tarjeta es ASSET → LIABILITY sin postings de gasto', () => {
    const tx = transfer({ to: CC, amount: bob('350.00'), businessDate: '2026-03-25' });
    const draft = toJournalEntryDraft(tx.snapshot);
    expect(draft.postings.map((p) => [p.target, p.amount.toFixed()])).toEqual([
      [{ kind: 'USER_ACCOUNT', accountId: BANK_A, nature: 'ASSET' }, '-350.00'],
      [{ kind: 'USER_ACCOUNT', accountId: CARD, nature: 'LIABILITY' }, '350.00'],
    ]);
    expect(netWorthDelta(tx).isZero()).toBe(true);
  });

  it('[TC-TRANSACTIONS-TRANSFER-007] pago de tarjeta con QR conserva el medio de pago sin alterar el asiento', () => {
    const tx = transfer({ to: CC, amount: bob('350.00'), paymentMethod: 'QR' });
    expect(tx.snapshot.paymentMethod).toBe('QR');
    expect(toJournalEntryDraft(tx.snapshot).postings.some((p) => p.target.kind === 'SYSTEM')).toBe(false);
  });

  it('[TC-TRANSACTIONS-TRANSFER-008] transferencia por QR entre cuentas propias preserva el patrimonio', () => {
    const tx = transfer({ amount: bob('200.00'), paymentMethod: 'QR' });
    expect(tx.snapshot.paymentMethod).toBe('QR');
    expect(tx.snapshot.legs.map((l) => l.amount.toFixed())).toEqual(['-200.00', '200.00']);
    expect(netWorthDelta(tx).isZero()).toBe(true);
  });

  it('pending no tiene asiento (INV-023)', () => {
    const tx = transfer({ status: 'PENDING' });
    expect(tx.needsEntry).toBe(false);
    expect(codeOf(() => toJournalEntryDraft(tx.snapshot))).toBe('INVALID_STATUS_TRANSITION');
  });
});

describe('Amend/void de transferencias', () => {
  it('cambiar el monto recalcula SOURCE/TARGET conservando la comisión y pide reversa + nuevo asiento', () => {
    const tx = transfer({ fee: { amount: bob('10.00'), categoryId: FEES, splitId: nextId() } });
    tx.attachEntry(nextId());
    const result = tx.amend({ amount: bob('500.00') });
    expect(result.ledgerImpact).toBe(true);
    expect(tx.snapshot.legs.map((l) => [l.role, l.amount.toFixed()])).toEqual([
      ['SOURCE', '-510.00'],
      ['TARGET', '500.00'],
    ]);
    expect(tx.snapshot.splits.map((x) => x.amount.toFixed())).toEqual(['10.00']);
    expect(tx.revision).toBe(2);
  });

  it('cambiar una cuenta a otra moneda produce TRANSFER_CURRENCY_MISMATCH', () => {
    const tx = transfer();
    expect(codeOf(() => tx.amend({ toAccount: USD_ACC }))).toBe('TRANSFER_CURRENCY_MISMATCH');
    expect(codeOf(() => tx.amend({ account: USD_ACC }))).toBe('TRANSFER_CURRENCY_MISMATCH');
    expect(codeOf(() => tx.amend({ toAccount: A }))).toBe('TRANSFER_SAME_ACCOUNT');
  });

  it('cambiar el destino a otra cuenta de la misma moneda rehace los legs', () => {
    const tx = transfer();
    tx.attachEntry(nextId());
    const result = tx.amend({ toAccount: CC });
    expect(result.changedFields).toContain('toAccountId');
    expect(tx.snapshot.legs.map((l) => [l.role, l.accountId])).toEqual([
      ['SOURCE', BANK_A],
      ['TARGET', CARD],
    ]);
  });

  it('void devuelve el asiento a revertir', () => {
    const tx = transfer();
    const entry = nextId();
    tx.attachEntry(entry);
    expect(tx.void('error', '2026-03-16T00:00:00Z').entryToReverse).toBe(entry);
  });
});

describe('Propiedades de transferencias', () => {
  const units = fc.bigInt({ min: 1n, max: 10_000_000_000n });

  it('[TC-TRANSACTIONS-TRANSFER-002] INV-009: ∀ (monto, comisión) el asiento cuadra y ΔPatrimonio = −comisión', () => {
    fc.assert(
      fc.property(units, fc.option(units, { nil: null }), fc.boolean(), (amountU, feeU, toCard) => {
        const amount = Money.ofMinorUnits(amountU, BOB);
        const fee = feeU === null ? null : Money.ofMinorUnits(feeU, BOB);
        const tx = transfer({
          amount,
          to: toCard ? CC : B,
          fee: fee ? { amount: fee, categoryId: FEES, splitId: nextId() } : null,
        });
        const draft = toJournalEntryDraft(tx.snapshot);
        expect(
          Money.sum(
            draft.postings.map((p) => p.amount),
            BOB,
          ).isZero(),
        ).toBe(true);
        expect(netWorthDelta(tx).equals(fee ? fee.negate() : Money.parse('0', BOB))).toBe(true);
        const expense = draft.postings.filter((p) => p.target.kind === 'SYSTEM');
        expect(expense.map((p) => p.amount.toFixed())).toEqual(fee ? [fee.toFixed()] : []);
      }),
    );
  });
});
