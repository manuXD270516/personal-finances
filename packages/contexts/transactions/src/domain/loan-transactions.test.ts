import { DomainError, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { bulkApplicability } from './bulk-edit.js';
import { LoanPaymentBreakdown } from './loan-payment-breakdown.js';
import { toJournalEntryDraft } from './posting-translator.js';
import { BANK_A, BOB, USD, WS, bob, nextId } from './fixtures.test-support.js';
import {
  Transaction,
  assertManagedEditAllowed,
  isManagedKind,
  loanIdOf,
  type TransferAccount,
} from './transaction.js';

const LOAN_ACC = '0192f3c4-0000-7000-8000-0000000000e1';
const LOAN_ID = '0192f3c4-0000-7000-8000-0000000000e2';
const PAYMENT_ID = '0192f3c4-0000-7000-8000-0000000000e3';
const BANK: TransferAccount = { accountId: BANK_A, nature: 'ASSET', currency: 'BOB' };
const LOAN: TransferAccount = { accountId: LOAN_ACC, nature: 'LIABILITY', currency: 'BOB' };
const CATEGORIES = {
  interest: 'cat-interest',
  fees: 'cat-loan-fees',
  insurance: 'cat-insurance',
  taxes: 'cat-taxes',
};

const breakdown = (
  over: Partial<Record<'principal' | 'interest' | 'fees' | 'insurance' | 'taxes', string>> = {},
) =>
  LoanPaymentBreakdown.create({
    loanId: LOAN_ID,
    principal: bob(over.principal ?? '1862.85'),
    interest: bob(over.interest ?? '479.17'),
    fees: bob(over.fees ?? '0.00'),
    insurance: bob(over.insurance ?? '0.00'),
    taxes: bob(over.taxes ?? '0.00'),
  });

const payment = (b = breakdown(), amount = b.total()) =>
  Transaction.recordLoanPayment({
    id: nextId(),
    workspaceId: WS,
    businessDate: '2026-11-15',
    paymentAccount: BANK,
    loanAccount: LOAN,
    amount,
    breakdown: b,
    categoryIds: CATEGORIES,
    newSplitId: nextId,
    description: 'Cuota 1',
    externalRef: { namespace: 'debt.loan-payment', id: PAYMENT_ID },
  });

const disbursement = (fee?: string) =>
  Transaction.recordLoanDisbursement({
    id: nextId(),
    workspaceId: WS,
    businessDate: '2026-10-15',
    loanAccount: LOAN,
    destinationAccount: BANK,
    principal: bob('50000.00'),
    ...(fee ? { retainedFee: { amount: bob(fee), categoryId: CATEGORIES.fees, splitId: nextId() } } : {}),
    description: 'Desembolso',
    externalRef: { namespace: 'debt.loan', id: LOAN_ID },
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

const sumPostings = (tx: Transaction): Money =>
  Money.sum(
    toJournalEntryDraft(tx.snapshot).postings.map((p) => p.amount),
    BOB,
  );

describe('LoanPaymentBreakdown', () => {
  it('[TC-DEBT-LOAN-012] Σ componentes = monto pagado: 1862.85 + 479.17 = 2342.02', () => {
    const b = breakdown();
    expect(b.total().toFixed()).toBe('2342.02');
    expect(b.expenseTotal().toFixed()).toBe('479.17');
    expect(() => b.assertMatches(bob('2342.02'))).not.toThrow();
  });

  it('[TC-DEBT-LOAN-012] un desglose que no suma el monto ⇒ PAYMENT_BREAKDOWN_MISMATCH con la suma y el monto', () => {
    const b = breakdown();
    try {
      b.assertMatches(bob('2342.03'));
      expect.unreachable();
    } catch (err) {
      expect((err as DomainError).code).toBe('PAYMENT_BREAKDOWN_MISMATCH');
      expect((err as DomainError).details).toEqual({ sum: '2342.02', amount: '2342.03' });
    }
  });

  it('un componente negativo o en otra moneda se rechaza', () => {
    expect(codeOf(() => breakdown({ interest: '-1.00' }))).toBe('VALIDATION_FAILED');
    expect(
      codeOf(() =>
        LoanPaymentBreakdown.create({
          loanId: LOAN_ID,
          principal: bob('1.00'),
          interest: Money.parse('1.00', USD),
          fees: bob('0.00'),
          insurance: bob('0.00'),
          taxes: bob('0.00'),
        }),
      ),
    ).toBe('CURRENCY_MISMATCH');
  });

  it('ida y vuelta por JSON conserva los componentes', () => {
    const b = breakdown({ fees: '10.00', insurance: '20.00' });
    const back = LoanPaymentBreakdown.fromJson(b.toJson(), BOB);
    expect(back.toJson()).toEqual(b.toJson());
    expect(back.total().toFixed()).toBe('2372.02');
  });
});

describe('Transaction.recordLoanPayment', () => {
  it('[TC-DEBT-LOAN-012] asiento: fuente −2342.02, pasivo +1862.85 y gasto 479.17 en Intereses; suma 0.00', () => {
    const tx = payment();
    const s = tx.snapshot;
    expect(s.kind).toBe('LOAN_PAYMENT');
    expect(s.source).toBe('DEBT');
    expect(s.legs.map((l) => [l.role, l.accountId, l.amount.toFixed()])).toEqual([
      ['SOURCE', BANK_A, '-2342.02'],
      ['TARGET', LOAN_ACC, '1862.85'],
    ]);
    expect(s.splits.map((x) => [x.categoryId, x.amount.toFixed()])).toEqual([['cat-interest', '479.17']]);
    const draft = toJournalEntryDraft(s);
    expect(draft.postings.map((p) => [p.target.kind, p.amount.toFixed()])).toEqual([
      ['USER_ACCOUNT', '-2342.02'],
      ['USER_ACCOUNT', '1862.85'],
      ['SYSTEM', '479.17'],
    ]);
    expect(sumPostings(tx).isZero()).toBe(true);
  });

  it('[TC-DEBT-LOAN-013] con cargos: un split por componente no nulo (interés, comisión, seguro) y ninguno de impuestos', () => {
    const tx = payment(breakdown({ fees: '10.00', insurance: '20.00' }));
    expect(tx.snapshot.amount.toFixed()).toBe('2372.02');
    expect(tx.snapshot.splits.map((x) => [x.categoryId, x.amount.toFixed()])).toEqual([
      ['cat-interest', '479.17'],
      ['cat-loan-fees', '10.00'],
      ['cat-insurance', '20.00'],
    ]);
    expect(sumPostings(tx).isZero()).toBe(true);
  });

  it('[TC-DEBT-LOAN-019] el principal no es gasto: Σ splits = monto − principal', () => {
    const tx = payment();
    const s = tx.snapshot;
    const splitsTotal = Money.sum(
      s.splits.map((x) => x.amount),
      BOB,
    );
    expect(splitsTotal.equals(s.amount.subtract(s.loanPaymentBreakdown!.principal))).toBe(true);
    // ΔPatrimonio = Σ legs sobre cuentas del usuario = −gasto.
    expect(
      Money.sum(
        s.legs.map((l) => l.amount),
        BOB,
      ).toFixed(),
    ).toBe('-479.17');
  });

  it('principal 0 (solo cargos): se omite la pata TARGET y el asiento sigue cuadrando', () => {
    const tx = payment(breakdown({ principal: '0.00', interest: '100.00' }));
    expect(tx.snapshot.legs.map((l) => l.role)).toEqual(['SOURCE']);
    expect(sumPostings(tx).isZero()).toBe(true);
  });

  it('todo principal (sin gasto): sin splits y sin patrimonio afectado', () => {
    const tx = payment(breakdown({ interest: '0.00' }));
    expect(tx.snapshot.splits).toEqual([]);
    expect(sumPostings(tx).isZero()).toBe(true);
  });

  it('[TC-DEBT-LOAN-012] monto distinto de la suma del desglose ⇒ PAYMENT_BREAKDOWN_MISMATCH', () => {
    expect(codeOf(() => payment(breakdown(), bob('2342.03')))).toBe('PAYMENT_BREAKDOWN_MISMATCH');
  });

  it('cuentas en otra moneda que el monto ⇒ CURRENCY_MISMATCH; misma cuenta ⇒ VALIDATION_FAILED', () => {
    const usdBank: TransferAccount = { accountId: BANK_A, nature: 'ASSET', currency: 'USD' };
    expect(
      codeOf(() =>
        Transaction.recordLoanPayment({
          id: nextId(),
          workspaceId: WS,
          businessDate: '2026-11-15',
          paymentAccount: usdBank,
          loanAccount: LOAN,
          amount: bob('2342.02'),
          breakdown: breakdown(),
          categoryIds: CATEGORIES,
          newSplitId: nextId,
          externalRef: { namespace: 'debt.loan-payment', id: PAYMENT_ID },
        }),
      ),
    ).toBe('CURRENCY_MISMATCH');
    expect(
      codeOf(() =>
        Transaction.recordLoanPayment({
          id: nextId(),
          workspaceId: WS,
          businessDate: '2026-11-15',
          paymentAccount: LOAN,
          loanAccount: LOAN,
          amount: bob('2342.02'),
          breakdown: breakdown(),
          categoryIds: CATEGORIES,
          newSplitId: nextId,
          externalRef: { namespace: 'debt.loan-payment', id: PAYMENT_ID },
        }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('el préstamo administrado se deriva del desglose', () => {
    expect(loanIdOf(payment().snapshot)).toBe(LOAN_ID);
    expect(isManagedKind('LOAN_PAYMENT')).toBe(true);
    expect(isManagedKind('EXPENSE')).toBe(false);
  });
});

describe('Transaction.recordLoanDisbursement', () => {
  it('[TC-DEBT-LOAN-007] sin comisión: destino +50000.00, pasivo −50000.00, sin gasto; suma 0.00', () => {
    const tx = disbursement();
    const s = tx.snapshot;
    expect(s.kind).toBe('LOAN_DISBURSEMENT');
    expect(s.legs.map((l) => [l.role, l.accountId, l.amount.toFixed()])).toEqual([
      ['SOURCE', LOAN_ACC, '-50000.00'],
      ['TARGET', BANK_A, '50000.00'],
    ]);
    expect(s.splits).toEqual([]);
    expect(sumPostings(tx).isZero()).toBe(true);
    expect(loanIdOf(s)).toBe(LOAN_ID);
  });

  it('[TC-DEBT-LOAN-008] con comisión retenida 500.00: destino 49500.00, gasto 500.00 y pasivo −50000.00; suma 0.00', () => {
    const tx = disbursement('500.00');
    const s = tx.snapshot;
    expect(s.legs.map((l) => [l.role, l.amount.toFixed()])).toEqual([
      ['SOURCE', '-50000.00'],
      ['TARGET', '49500.00'],
    ]);
    expect(s.splits.map((x) => [x.categoryId, x.amount.toFixed()])).toEqual([['cat-loan-fees', '500.00']]);
    const draft = toJournalEntryDraft(s);
    expect(draft.postings.map((p) => p.amount.toFixed()).sort()).toEqual(['-50000.00', '49500.00', '500.00']);
    expect(sumPostings(tx).isZero()).toBe(true);
  });

  it('una comisión igual o mayor que el principal ⇒ VALIDATION_FAILED', () => {
    expect(codeOf(() => disbursement('50000.00'))).toBe('VALIDATION_FAILED');
  });
});

describe('transacciones administradas', () => {
  it('[TC-DEBT-LOAN-041] editar monto, fecha, cuenta o splits ⇒ TRANSACTION_MANAGED_EXTERNALLY con el préstamo', () => {
    const tx = payment();
    for (const changes of [
      { amount: bob('2000.00') },
      { businessDate: '2026-11-16' },
      { account: { accountId: LOAN_ACC, nature: 'ASSET' as const, currency: 'BOB' } },
    ]) {
      try {
        tx.amend(changes);
        expect.unreachable();
      } catch (err) {
        expect((err as DomainError).code).toBe('TRANSACTION_MANAGED_EXTERNALLY');
        expect((err as DomainError).details).toEqual({ managedBy: 'DEBT', loanId: LOAN_ID });
      }
    }
    expect(tx.snapshot.version).toBe(1);
  });

  it('[TC-DEBT-LOAN-042] notas, descripción y tags se editan in situ sin impacto en el ledger', () => {
    const tx = payment();
    const split = tx.snapshot.splits[0]!;
    const result = tx.amend({
      notes: 'pagado en ventanilla',
      description: 'Cuota 1 (ventanilla)',
      splits: [{ id: split.id, amount: split.amount, categoryId: split.categoryId, tagIds: ['tag-1'] }],
    });
    expect(result.ledgerImpact).toBe(false);
    expect(tx.snapshot.notes).toBe('pagado en ventanilla');
    expect(tx.snapshot.splits[0]?.tagIds).toEqual(['tag-1']);
    expect(tx.snapshot.revision).toBe(1);
  });

  it('cambiar la categoría de un split de gasto es edición financiera de una administrada', () => {
    const tx = payment();
    const split = tx.snapshot.splits[0]!;
    expect(
      codeOf(() => tx.amend({ splits: [{ id: split.id, amount: split.amount, categoryId: 'otra' }] })),
    ).toBe('TRANSACTION_MANAGED_EXTERNALLY');
  });

  it('una transacción común no se ve afectada por la guarda', () => {
    expect(() =>
      assertManagedEditAllowed(
        { ...payment().snapshot, kind: 'EXPENSE' },
        { amount: { amount: '1.00', currency: 'BOB' } },
      ),
    ).not.toThrow();
  });

  it('la edición masiva no cambia la categoría de un pago de préstamo pero sí admite tags', () => {
    const s = payment().snapshot;
    expect(bulkApplicability(s, { categoryId: 'x' }).map((n) => n.code)).toEqual([
      'BULK_EDIT_NOT_APPLICABLE',
    ]);
    expect(bulkApplicability(s, { addTagIds: ['t'] })).toEqual([]);
    expect(bulkApplicability(s, { notes: 'n' })).toEqual([]);
  });
});
