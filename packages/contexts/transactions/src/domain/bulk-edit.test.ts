import { DomainError, Money } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyBulkToSplits,
  bulkApplicability,
  parseBulkEditChanges,
  type BulkEditChanges,
} from './bulk-edit.js';
import { BANK_A, BOB, bob, expense, nextId, WS } from './fixtures.test-support.js';
import { toJournalEntryDraft } from './posting-translator.js';
import { Transaction } from './transaction.js';

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
};

const HOGAR = 'cat-hogar';
const SUPER = 'cat-super';

const oneSplit = (amount = '45.90') =>
  expense({ amount: bob(amount), splits: [{ id: nextId(), amount: bob(amount), categoryId: SUPER }] });
const twoSplits = () =>
  expense({
    amount: bob('300.00'),
    splits: [
      { id: nextId(), amount: bob('200.00'), categoryId: SUPER },
      { id: nextId(), amount: bob('100.00'), categoryId: SUPER },
    ],
  });

/** Aplica los cambios con `bulkEdit` (splits resueltos con las funciones puras del dominio). */
function applyBulk(tx: Transaction, changes: BulkEditChanges) {
  const s = tx.snapshot;
  const touchesSplits =
    changes.categoryId !== undefined ||
    (changes.addTagIds?.length ?? 0) > 0 ||
    (changes.removeTagIds?.length ?? 0) > 0;
  return tx.bulkEdit(
    {
      ...(changes.counterpartyId !== undefined ? { counterpartyId: changes.counterpartyId } : {}),
      ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
      ...(touchesSplits ? { splits: applyBulkToSplits(s.splits, changes) } : {}),
    },
    changes.cleared,
  );
}

describe('parseBulkEditChanges — la edición masiva no acepta cambios financieros', () => {
  it('[TC-TRANSACTIONS-BULK-004] monto, cuenta, fecha, moneda, splits, estado y systemFlags ⇒ VALIDATION_FAILED', () => {
    for (const bad of [
      { amount: '100.00' },
      { accountId: 'x' },
      { businessDate: '2026-03-01' },
      { transactionDate: '2026-03-01' },
      { currency: 'USD' },
      { splits: [] },
      { status: 'VOIDED' },
      { systemFlags: ['RECONCILED_WITHOUT_STATEMENT'] },
      { categoryId: 'a', amount: '1.00' },
    ]) {
      expect(codeOf(() => parseBulkEditChanges(bad))).toBe('VALIDATION_FAILED');
    }
    expect(codeOf(() => parseBulkEditChanges({}))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => parseBulkEditChanges(null))).toBe('VALIDATION_FAILED');
    expect(parseBulkEditChanges({ categoryId: HOGAR, addTagIds: ['t1', 't1'] })).toEqual({
      categoryId: HOGAR,
      addTagIds: ['t1'],
    });
  });

  it('un tag no puede agregarse y quitarse a la vez; los custom fields exigen fieldId o key', () => {
    expect(codeOf(() => parseBulkEditChanges({ addTagIds: ['t'], removeTagIds: ['t'] }))).toBe(
      'VALIDATION_FAILED',
    );
    expect(codeOf(() => parseBulkEditChanges({ customFields: [{ value: 'x' }] }))).toBe('VALIDATION_FAILED');
    expect(
      codeOf(() => parseBulkEditChanges({ customFields: [{ fieldId: 'a', key: 'b', value: 'x' }] })),
    ).toBe('VALIDATION_FAILED');
    expect(parseBulkEditChanges({ customFields: [{ key: 'centro_costo', value: null }] })).toEqual({
      customFields: [{ key: 'centro_costo', value: null }],
    });
  });
});

describe('bulkApplicability — aplicabilidad de los cambios masivos', () => {
  it('[TC-TRANSACTIONS-BULK-005] la categoría solo aplica a un único split nominal; los tags, a todos los splits', () => {
    const one = oneSplit().snapshot;
    const two = twoSplits().snapshot;
    expect(bulkApplicability(one, { categoryId: HOGAR })).toEqual([]);
    expect(bulkApplicability(two, { categoryId: HOGAR }).map((r) => r.code)).toEqual([
      'BULK_EDIT_NOT_APPLICABLE',
    ]);
    expect(bulkApplicability(two, { addTagIds: ['viaje'] })).toEqual([]);
    // Notas y contraparte son de la cabecera: aplican a cualquier transacción.
    expect(bulkApplicability(two, { notes: 'x', counterpartyId: 'cp' })).toEqual([]);
  });

  it('[TC-TRANSACTIONS-BULK-005] una transferencia o conversión no admite categoría; un ajuste sin splits no admite tags ni custom fields', () => {
    const transfer = Transaction.recordTransfer({
      id: nextId(),
      workspaceId: WS,
      businessDate: '2026-09-30',
      from: { accountId: BANK_A, nature: 'ASSET', currency: 'BOB' },
      to: { accountId: nextId(), nature: 'ASSET', currency: 'BOB' },
      amount: bob('100.00'),
      fee: null,
    }).snapshot;
    expect(bulkApplicability(transfer, { categoryId: HOGAR }).map((r) => r.code)).toEqual([
      'BULK_EDIT_NOT_APPLICABLE',
    ]);
    expect(bulkApplicability(transfer, { addTagIds: ['viaje'] }).map((r) => r.code)).toEqual([
      'BULK_EDIT_NOT_APPLICABLE',
    ]);
    const adjustment = expense({ kind: 'ADJUSTMENT', direction: 'INCREASE', reason: 'ajuste' }).snapshot;
    expect(bulkApplicability(adjustment, { addTagIds: ['t'] }).map((r) => r.code)).toEqual([
      'BULK_EDIT_NOT_APPLICABLE',
    ]);
    expect(
      bulkApplicability(adjustment, { customFields: [{ key: 'k', value: 'v' }] }).map((r) => r.code),
    ).toEqual(['BULK_EDIT_NOT_APPLICABLE']);
    expect(bulkApplicability(adjustment, { notes: 'n' })).toEqual([]);
  });
});

describe('Transaction.bulkEdit', () => {
  it('[TC-TRANSACTIONS-BULK-001] recategoriza y etiqueta en UNA versión nueva sin tocar el ledger', () => {
    const tx = oneSplit('45.90');
    const before = tx.snapshot;
    const draftBefore = toJournalEntryDraft(before).postings.map((p) => p.amount.toFixed());
    const r = applyBulk(tx, { categoryId: HOGAR, addTagIds: ['familia'] });
    const after = tx.snapshot;
    expect(after.version).toBe(before.version + 1);
    expect(after.splits[0]).toMatchObject({ categoryId: HOGAR, tagIds: ['familia'] });
    expect(r.classificationChanges).toHaveLength(1);
    expect(r.ledgerImpact).toBe(false);
    expect(after.revision).toBe(before.revision);
    expect(after.activeEntryId).toBe(before.activeEntryId);
    expect(after.legs).toEqual(before.legs);
    expect(toJournalEntryDraft(after).postings.map((p) => p.amount.toFixed())).toEqual(draftBefore);
  });

  it('[TC-TRANSACTIONS-BULK-006] cleared + tag en la misma operación usa una sola versión y registra CLEAR', () => {
    const tx = oneSplit();
    const r = applyBulk(tx, { cleared: true, addTagIds: ['revisado'] });
    expect(r.statusChanged).toBe(true);
    expect(tx.snapshot).toMatchObject({ status: 'CLEARED', version: 2 });
    expect(tx.lastTransition?.transition).toBe('CLEAR');
    const back = applyBulk(tx, { cleared: false });
    expect(back.statusPrevious).toBe('CLEARED');
    expect(tx.snapshot).toMatchObject({ status: 'POSTED', version: 3 });
  });

  it('[TC-TRANSACTIONS-BULK-006] reconciliada ⇒ TRANSACTION_RECONCILED; pendiente o ya en el estado pedido ⇒ INVALID_STATUS_TRANSITION', () => {
    const rec = expense({ status: 'CLEARED' });
    rec.reconcileWithoutStatement('WITHOUT_STATEMENT');
    expect(codeOf(() => applyBulk(rec, { cleared: false }))).toBe('TRANSACTION_RECONCILED');
    expect(codeOf(() => applyBulk(expense({ status: 'PENDING' }), { cleared: true }))).toBe(
      'INVALID_STATUS_TRANSITION',
    );
    expect(codeOf(() => applyBulk(expense(), { cleared: false }))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('un cambio que no cambia nada deja la transacción intacta (sin versión nueva)', () => {
    const tx = oneSplit();
    const r = applyBulk(tx, { categoryId: SUPER, notes: null });
    expect(r.changedFields).toEqual([]);
    expect(tx.snapshot.version).toBe(1);
  });

  it('[TC-TRANSACTIONS-BULK-001] una transacción anulada no se edita', () => {
    const tx = oneSplit();
    tx.void('x', '2026-10-01T00:00:00Z');
    expect(codeOf(() => applyBulk(tx, { notes: 'n' }))).toBe('INVALID_STATUS_TRANSITION');
  });
});

describe('Propiedades de la edición masiva', () => {
  const changesArb = fc.record(
    {
      categoryId: fc.constantFrom(HOGAR, 'cat-ocio', SUPER),
      addTagIds: fc.uniqueArray(fc.constantFrom('t1', 't2', 't3'), { maxLength: 3 }),
      removeTagIds: fc.uniqueArray(fc.constantFrom('t4', 't5'), { maxLength: 2 }),
      notes: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
      counterpartyId: fc.option(fc.constantFrom('cp1', 'cp2'), { nil: null }),
    },
    { requiredKeys: [] },
  );

  it('[TC-TRANSACTIONS-BULK-004] aplicar en lote = aplicar cada cambio por separado (mismo estado final) y el ledger no cambia', () => {
    fc.assert(
      fc.property(
        changesArb,
        fc.uniqueArray(fc.constantFrom('t1', 't4', 't5', 't9'), { maxLength: 4 }),
        fc.integer({ min: 100, max: 100_000 }),
        (changes, existingTags, minor) => {
          fc.pre(
            !changes.addTagIds?.some((t) =>
              (changes.removeTagIds as readonly string[] | undefined)?.includes(t),
            ),
          );
          const amount = Money.ofMinorUnits(BigInt(minor), BOB);
          const make = () =>
            expense({
              id: 'tx-1',
              defaultSplitId: 'split-0',
              amount,
              splits: [{ id: 'split-1', amount, categoryId: SUPER, tagIds: [...existingTags].sort() }],
            });
          const bulk = make();
          const stepwise = make();
          const initial = bulk.snapshot;
          // Lote: una sola llamada.
          applyBulk(bulk, changes);
          // Uno a uno: una edición individual por cada tipo de cambio, con las mismas reglas.
          for (const piece of [
            changes.categoryId !== undefined ? { categoryId: changes.categoryId } : null,
            changes.addTagIds ? { addTagIds: changes.addTagIds } : null,
            changes.removeTagIds ? { removeTagIds: changes.removeTagIds } : null,
            changes.notes !== undefined ? { notes: changes.notes } : null,
            changes.counterpartyId !== undefined ? { counterpartyId: changes.counterpartyId } : null,
          ]) {
            if (piece) applyBulk(stepwise, piece);
          }
          const a = bulk.snapshot;
          const b = stepwise.snapshot;
          expect({ ...a, version: 0 }).toEqual({ ...b, version: 0 });
          // INV-033: ni montos, ni legs, ni fecha, ni revisión, ni asiento cambian.
          expect(a.amount.equals(initial.amount)).toBe(true);
          expect(a.legs).toEqual(initial.legs);
          expect(a.businessDate).toBe(initial.businessDate);
          expect(a.revision).toBe(initial.revision);
          expect(a.activeEntryId).toBe(initial.activeEntryId);
          expect(a.splits.map((s) => s.amount.toFixed())).toEqual(
            initial.splits.map((s) => s.amount.toFixed()),
          );
        },
      ),
    );
  });
});
