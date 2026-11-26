import { describe, expect, it } from 'vitest';
import { resetAfterSave, type FormState } from './form-state';
import { newSplitRow } from './splits';

const filled: FormState = {
  kind: 'INCOME',
  accountId: 'acc-1',
  amount: '45.00',
  transactionDate: '2026-11-25',
  postingDate: '2026-11-26',
  description: 'Almuerzo',
  notes: 'nota',
  paymentMethod: 'QR',
  counterpartyId: 'cp-1',
  status: 'PENDING',
  refundOfTransactionId: 'tx-9',
  confirmRefundExceedsOriginal: true,
  direction: 'INCREASE',
  reason: 'motivo',
  splits: [newSplitRow({ categoryId: 'cat-1', amount: '45.00', customFields: { ref: 'x' } })],
};

describe('estado del formulario tras registrar y seguir (add-quick-capture)', () => {
  it('[TC-TRANSACTIONS-QUICK-003] conserva tipo, cuenta, fecha y estado', () => {
    const next = resetAfterSave(filled);
    expect(next.kind).toBe('INCOME');
    expect(next.accountId).toBe('acc-1');
    expect(next.transactionDate).toBe('2026-11-25');
    expect(next.status).toBe('PENDING');
  });

  it('[TC-TRANSACTIONS-QUICK-003] vacía monto, descripción, contraparte, splits, notas, medio de pago y campos personalizados', () => {
    const next = resetAfterSave(filled);
    expect(next.amount).toBe('');
    expect(next.description).toBe('');
    expect(next.counterpartyId).toBe('');
    expect(next.notes).toBe('');
    expect(next.paymentMethod).toBe('');
    expect(next.postingDate).toBe('');
    expect(next.splits).toHaveLength(1);
    expect(next.splits[0]).toMatchObject({ categoryId: '', amount: '', customFields: {} });
    expect(next.splits[0]!.key).not.toBe(filled.splits[0]!.key);
  });
});
