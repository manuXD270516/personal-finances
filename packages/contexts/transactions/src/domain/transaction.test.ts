import { DomainError, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { BANK_A, bob, CARD, expense, nextId, UNCATEGORIZED, USD } from './fixtures.test-support.js';
import { toJournalEntryDraft } from './posting-translator.js';
import { assertRefundAllowed } from './refund-policy.js';
import { assertTransition, canTransition } from './transaction-status.js';
import { systemFlagsOf, type Transaction } from './transaction.js';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
}

const postings = (tx: Transaction) =>
  toJournalEntryDraft(tx.snapshot).postings.map((p) => [
    p.target.kind === 'USER_ACCOUNT' ? p.target.accountId : p.target.systemKind,
    p.amount.toFixed(),
    p.splitId,
  ]);

describe('TransactionStatus', () => {
  it('[TC-TRANSACTIONS-STATUS-001] transiciones permitidas y rechazadas de la máquina de estados', () => {
    expect(canTransition('PENDING', 'POSTED')).toBe(true);
    expect(canTransition('POSTED', 'CLEARED')).toBe(true);
    expect(canTransition('CLEARED', 'POSTED')).toBe(true);
    expect(canTransition('CLEARED', 'RECONCILED')).toBe(true);
    expect(canTransition('PENDING', 'CLEARED')).toBe(false);
    expect(canTransition('POSTED', 'RECONCILED')).toBe(false);
    expect(canTransition('VOIDED', 'POSTED')).toBe(false);
    expect(codeOf(() => assertTransition('RECONCILED', 'VOIDED'))).toBe('TRANSACTION_RECONCILED');
    expect(codeOf(() => assertTransition('RECONCILED', 'CLEARED'))).toBe('INVALID_STATUS_TRANSITION');
    expect(codeOf(() => assertTransition('RECONCILED', 'CLEARED', { unreconcile: true }))).toBeUndefined();
    expect(codeOf(() => assertTransition('VOIDED', 'VOIDED'))).toBe('INVALID_STATUS_TRANSITION');
  });
});

describe('Transaction.record', () => {
  it('[TC-TRANSACTIONS-EXPENSE-001] un gasto sin splits lleva un split Uncategorized y su asiento cuadra', () => {
    const tx = expense();
    expect(tx.snapshot.splits).toHaveLength(1);
    expect(tx.snapshot.splits[0]?.categoryId).toBe(UNCATEGORIZED);
    expect(tx.snapshot.legs[0]?.amount.toFixed()).toBe('-150.00');
    expect(postings(tx)).toEqual([
      ['EXPENSE', '150.00', tx.snapshot.splits[0]?.id],
      [BANK_A, '-150.00', null],
    ]);
  });

  it('[TC-TRANSACTIONS-INCOME-001] un ingreso debita la cuenta y acredita INCOME por split', () => {
    const tx = expense({ kind: 'INCOME', amount: bob('3000.00') });
    expect(postings(tx)).toEqual([
      [BANK_A, '3000.00', null],
      ['INCOME', '-3000.00', tx.snapshot.splits[0]?.id],
    ]);
  });

  it('[TC-TRANSACTIONS-CURRENCY-001] el monto debe estar en la moneda de la cuenta', () => {
    expect(codeOf(() => expense({ amount: Money.parse('10.00', USD) }))).toBe('CURRENCY_MISMATCH');
  });

  it('[TC-TRANSACTIONS-AMOUNT-001] monto cero o negativo ⇒ AMOUNT_NOT_POSITIVE con puntero', () => {
    try {
      expense({ amount: bob('0') });
      expect.unreachable();
    } catch (err) {
      expect((err as DomainError).code).toBe('AMOUNT_NOT_POSITIVE');
      expect((err as DomainError).violations[0]?.pointer).toBe('/amount/amount');
    }
    expect(codeOf(() => expense({ amount: bob('-5.00') }))).toBe('AMOUNT_NOT_POSITIVE');
  });

  it('[TC-TRANSACTIONS-AMOUNT-002] más decimales que la escala ⇒ AMOUNT_SCALE_EXCEEDED (sin redondeo)', () => {
    expect(codeOf(() => bob('10.005'))).toBe('AMOUNT_SCALE_EXCEEDED');
  });

  it('[TC-TRANSACTIONS-SPLIT-001] splits exactos ⇒ un posting por split; si suman 149.99 ⇒ SPLITS_DO_NOT_SUM', () => {
    const [g, h, p] = [nextId(), nextId(), nextId()];
    const tx = expense({
      splits: [
        { id: nextId(), amount: bob('100.00'), categoryId: g },
        { id: nextId(), amount: bob('35.50'), categoryId: h },
        { id: nextId(), amount: bob('14.50'), categoryId: p },
      ],
    });
    expect(postings(tx).map((r) => r[1])).toEqual(['100.00', '35.50', '14.50', '-150.00']);
    expect(
      codeOf(() =>
        expense({
          splits: [
            { id: nextId(), amount: bob('100.00'), categoryId: g },
            { id: nextId(), amount: bob('35.50'), categoryId: h },
            { id: nextId(), amount: bob('14.49'), categoryId: p },
          ],
        }),
      ),
    ).toBe('SPLITS_DO_NOT_SUM');
  });

  it('[TC-TRANSACTIONS-SPLIT-002] lista de splits vacía ⇒ VALIDATION_FAILED', () => {
    expect(codeOf(() => expense({ splits: [] }))).toBe('VALIDATION_FAILED');
  });

  it('[TC-TRANSACTIONS-ADJUSTMENT-001] ajuste exige motivo y dirección y va contra EQUITY:ADJUSTMENTS', () => {
    expect(codeOf(() => expense({ kind: 'ADJUSTMENT', direction: 'DECREASE' }))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => expense({ kind: 'ADJUSTMENT', reason: 'arqueo' }))).toBe('VALIDATION_FAILED');
    const tx = expense({
      kind: 'ADJUSTMENT',
      direction: 'DECREASE',
      reason: 'Diferencia de arqueo',
      amount: bob('12.50'),
    });
    expect(tx.snapshot.splits).toEqual([]);
    expect(postings(tx)).toEqual([
      [BANK_A, '-12.50', null],
      ['ADJUSTMENTS', '12.50', null],
    ]);
    // INCREASE en un pasivo = más deuda = crédito a la cuenta.
    const card = expense({
      kind: 'ADJUSTMENT',
      direction: 'INCREASE',
      reason: 'interés',
      accountId: CARD,
      accountNature: 'LIABILITY',
      amount: bob('5.00'),
    });
    expect(postings(card)).toEqual([
      [CARD, '-5.00', null],
      ['ADJUSTMENTS', '5.00', null],
    ]);
  });
});

describe('Edición, anulación y estados', () => {
  it('[TC-TRANSACTIONS-EDIT-001] editar monto de un posteado ⇒ revisión 2 con impacto contable; cleared vuelve a posted', () => {
    const tx = expense({ amount: bob('120.00') });
    tx.attachEntry('e1');
    const r = tx.amend({ amount: bob('102.00') });
    expect(r).toMatchObject({ ledgerImpact: true, previousEntryId: 'e1', changedFields: ['amount'] });
    expect(tx.snapshot).toMatchObject({ revision: 2, version: 2, status: 'POSTED', activeEntryId: null });
    expect(tx.snapshot.splits[0]?.amount.toFixed()).toBe('102.00');
    const t4 = expense({ amount: bob('60.00'), status: 'CLEARED' });
    t4.attachEntry('e4');
    expect(t4.amend({ amount: bob('65.00') }).changedFields).toEqual(['amount', 'status']);
    expect(t4.status).toBe('POSTED');
  });

  it('[TC-TRANSACTIONS-EDIT-002] cambiar contraparte/descripción/notas no toca el ledger (INV-033)', () => {
    const tx = expense();
    tx.attachEntry('e1');
    const r = tx.amend({ description: 'Hipermaxi', notes: 'n', counterpartyId: nextId() });
    expect(r.ledgerImpact).toBe(false);
    expect(tx.snapshot).toMatchObject({ revision: 1, version: 2, activeEntryId: 'e1' });
  });

  it('[TC-TRANSACTIONS-SPLIT-004] recategorizar conserva ids de split y no tiene impacto contable', () => {
    const tx = expense();
    tx.attachEntry('e1');
    const split = tx.snapshot.splits[0]!;
    const cat = nextId();
    const r = tx.amend({
      splits: [{ id: nextId(), amount: bob('150.00'), categoryId: cat, tagIds: ['t1'] }],
    });
    expect(r.ledgerImpact).toBe(false);
    expect(r.classificationChanges).toEqual([
      expect.objectContaining({
        splitId: split.id,
        previousCategoryId: UNCATEGORIZED,
        newCategoryId: cat,
        addedTagIds: ['t1'],
      }),
    ]);
    expect(tx.snapshot.splits[0]?.id).toBe(split.id);
  });

  it('[TC-TRANSACTIONS-VOID-001] anular un posteado devuelve el asiento a revertir; anular dos veces falla', () => {
    const tx = expense();
    tx.attachEntry('e1');
    expect(tx.void('duplicado', '2026-10-01T00:00:00Z')).toEqual({
      previousStatus: 'POSTED',
      entryToReverse: 'e1',
    });
    expect(tx.snapshot).toMatchObject({ status: 'VOIDED', activeEntryId: null, voidReason: 'duplicado' });
    expect(codeOf(() => tx.void('otra', 'x'))).toBe('INVALID_STATUS_TRANSITION');
    expect(codeOf(() => expense().void('  ', 'x'))).toBe('VALIDATION_FAILED');
    const pending = expense({ status: 'PENDING' });
    expect(pending.void('no ocurrió', 'x').entryToReverse).toBeNull();
  });

  it('[TC-TRANSACTIONS-RECONCILED-001] cleared → reconciled sin ledger; posted → reconciled inválido (el marcado directo deja el modo sin extracto)', () => {
    const t1 = expense({ status: 'CLEARED' });
    t1.reconcileWithoutStatement('WITHOUT_STATEMENT');
    expect(t1.status).toBe('RECONCILED');
    expect(t1.snapshot.reconciliationMode).toBe('WITHOUT_STATEMENT');
    const t2 = expense();
    expect(codeOf(() => t2.reconcileWithoutStatement('WITHOUT_STATEMENT'))).toBe('INVALID_STATUS_TRANSITION');
    expect(t2.status).toBe('POSTED');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-017] el marcado directo sin modo explícito (o con STATEMENT) ⇒ VALIDATION_FAILED y sigue cleared', () => {
    const tx = expense({ status: 'CLEARED' });
    expect(codeOf(() => tx.reconcileWithoutStatement(undefined))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => tx.reconcileWithoutStatement('STATEMENT'))).toBe('VALIDATION_FAILED');
    expect(tx.status).toBe('CLEARED');
    expect(tx.snapshot.reconciliationMode).toBeNull();
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-014] sin extracto: RECONCILE_WITHOUT_STATEMENT, modo y marca de seguimiento derivada; sin cambiar el ledger', () => {
    const tx = expense({ status: 'CLEARED' });
    tx.attachEntry('e1');
    tx.reconcileWithoutStatement('WITHOUT_STATEMENT');
    expect(tx.lastTransition).toMatchObject({
      transition: 'RECONCILE_WITHOUT_STATEMENT',
      from: 'CLEARED',
      to: 'RECONCILED',
    });
    expect(tx.snapshot).toMatchObject({ reconciliationMode: 'WITHOUT_STATEMENT', activeEntryId: 'e1' });
    expect(systemFlagsOf(tx.snapshot)).toEqual(['RECONCILED_WITHOUT_STATEMENT']);
    expect(systemFlagsOf(expense({ status: 'CLEARED' }).snapshot)).toEqual([]);
  });

  it('[TC-TRANSACTIONS-RECONCILED-001] reconcile (sesión) fija el modo STATEMENT sin marca; exige la sesión y partir de cleared', () => {
    const tx = expense({ status: 'CLEARED' });
    expect(codeOf(() => tx.reconcile(' '))).toBe('VALIDATION_FAILED');
    tx.reconcile('rec-1');
    expect(tx.lastTransition).toMatchObject({ transition: 'RECONCILE', from: 'CLEARED', to: 'RECONCILED' });
    expect(tx.snapshot.reconciliationMode).toBe('STATEMENT');
    expect(systemFlagsOf(tx.snapshot)).toEqual([]);
    expect(codeOf(() => expense().reconcile('rec-1'))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-019] el cotejo posterior pasa WITHOUT_STATEMENT a STATEMENT sin cambiar el estado ni dejar transición', () => {
    const tx = expense({ status: 'CLEARED' });
    tx.reconcileWithoutStatement('WITHOUT_STATEMENT');
    const versionBefore = tx.version;
    expect(tx.verifyAgainstStatement('rec-1')).toBe(true);
    expect(tx.status).toBe('RECONCILED');
    expect(tx.snapshot.reconciliationMode).toBe('STATEMENT');
    expect(tx.lastTransition).toBeNull();
    expect(tx.version).toBe(versionBefore + 1);
    expect(systemFlagsOf(tx.snapshot)).toEqual([]);
    // Ya cotejada, o no conciliada: sin cambios.
    expect(tx.verifyAgainstStatement('rec-2')).toBe(false);
    expect(expense({ status: 'CLEARED' }).verifyAgainstStatement('rec-1')).toBe(false);
  });

  it('[TC-TRANSACTIONS-RECONCILED-002] reconciliada: editar monto o anular ⇒ TRANSACTION_RECONCILED; recategorizar sí', () => {
    const tx = expense({ status: 'CLEARED' });
    tx.attachEntry('e1');
    tx.reconcileWithoutStatement('WITHOUT_STATEMENT');
    expect(codeOf(() => tx.amend({ amount: bob('155.00') }))).toBe('TRANSACTION_RECONCILED');
    expect(codeOf(() => tx.void('x', 'y'))).toBe('TRANSACTION_RECONCILED');
    const r = tx.amend({ splits: [{ id: 'n', amount: bob('150.00'), categoryId: nextId() }] });
    expect(r.ledgerImpact).toBe(false);
    expect(tx.status).toBe('RECONCILED');
  });

  it('[TC-TRANSACTIONS-RECONCILED-003] des-reconciliar exige motivo y deja la transacción cleared', () => {
    const tx = expense({ status: 'CLEARED' });
    tx.reconcileWithoutStatement('WITHOUT_STATEMENT');
    expect(codeOf(() => tx.unreconcile(' '))).toBe('VALIDATION_FAILED');
    expect(tx.status).toBe('RECONCILED');
    tx.unreconcile('corregir monto');
    expect(tx.status).toBe('CLEARED');
    // D74: des-reconciliar limpia el modo y la marca de seguimiento.
    expect(tx.snapshot.reconciliationMode).toBeNull();
    expect(systemFlagsOf(tx.snapshot)).toEqual([]);
    expect(codeOf(() => tx.unreconcile('otra vez'))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-TRANSACTIONS-PENDING-001] un pendiente no tiene asiento hasta postearse', () => {
    const tx = expense({ status: 'PENDING' });
    expect(tx.needsEntry).toBe(false);
    expect(codeOf(() => toJournalEntryDraft(tx.snapshot))).toBe('INVALID_STATUS_TRANSITION');
    tx.post();
    expect(tx.status).toBe('POSTED');
    expect(toJournalEntryDraft(tx.snapshot).postings).toHaveLength(2);
    expect(codeOf(() => tx.post())).toBe('INVALID_STATUS_TRANSITION');
  });
});

describe('Reembolsos', () => {
  const original = () => expense({ amount: bob('200.00') }).snapshot;

  it('[TC-TRANSACTIONS-REFUND-001] reembolso parcial vinculado acredita EXPENSE y debita la cuenta', () => {
    expect(
      assertRefundAllowed({
        original: original(),
        alreadyRefunded: bob('0'),
        amount: bob('50.00'),
        confirmExcess: false,
      }),
    ).toEqual({ exceeds: false });
    const tx = expense({ kind: 'REFUND', amount: bob('50.00'), refundOfTransactionId: original().id });
    expect(postings(tx).map((r) => r[1])).toEqual(['50.00', '-50.00']);
  });

  it('[TC-TRANSACTIONS-REFUND-002] exceder el original exige confirmación explícita', () => {
    const args = { original: original(), alreadyRefunded: bob('150.00'), amount: bob('60.00') };
    expect(codeOf(() => assertRefundAllowed({ ...args, confirmExcess: false }))).toBe(
      'REFUND_EXCEEDS_ORIGINAL',
    );
    expect(assertRefundAllowed({ ...args, confirmExcess: true })).toEqual({ exceeds: true });
    const income = expense({ kind: 'INCOME' }).snapshot;
    expect(codeOf(() => assertRefundAllowed({ ...args, original: income, confirmExcess: false }))).toBe(
      'REFERENCE_NOT_FOUND',
    );
    expect(codeOf(() => expense({ refundOfTransactionId: 'x' }))).toBe('VALIDATION_FAILED');
  });
});
