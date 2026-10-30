import { describe, expect, it } from 'vitest';
import { assertRevertAllowed, planRevert, type RevertCandidate } from './revert-plan.js';
import {
  EMPTY_PROPOSAL,
  applyEditPatch,
  assertValidConversion,
  assertValidTransfer,
  effectiveRow,
  isEmptyPatch,
  type ClassificationProposal,
} from './row-edits.js';

const RULE = { type: 'RULE', ruleId: 'r1', ruleVersion: 3 } as const;
const proposal: ClassificationProposal = {
  ...EMPTY_PROPOSAL,
  category: { value: 'cat-transporte', origin: RULE },
  counterparty: { value: 'cp-uber', origin: { type: 'ALIAS' } },
};

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as { code: string }).code;
  }
  return 'OK';
};

describe('RowEdits (2.5)', () => {
  it('[TC-IMPORTS-PIPELINE-041] lo editado queda con origen manual sobre la propuesta de la regla', () => {
    const edits = applyEditPatch({}, { description: 'Seguro del auto', categoryId: 'cat-seguros' });
    const row = effectiveRow(proposal, edits, 'DEB AUT 0412');
    expect(row.description).toEqual({ value: 'Seguro del auto', origin: { type: 'MANUAL' } });
    expect(row.category).toEqual({ value: 'cat-seguros', origin: { type: 'MANUAL' } });
    // Lo no editado conserva la propuesta con su origen.
    expect(row.counterparty).toEqual({ value: 'cp-uber', origin: { type: 'ALIAS' } });
  });

  it('[TC-IMPORTS-PIPELINE-039] reevaluar cambia la propuesta pero conserva lo que el usuario editó', () => {
    const edits = applyEditPatch({}, { categoryId: 'cat-hogar' });
    const reevaluated: ClassificationProposal = {
      ...proposal,
      category: { value: 'cat-otra', origin: { type: 'RULE', ruleId: 'r1', ruleVersion: 4 } },
    };
    expect(effectiveRow(reevaluated, edits, null).category).toEqual({
      value: 'cat-hogar',
      origin: { type: 'MANUAL' },
    });
    // La fila sin edición toma la propuesta nueva.
    expect(effectiveRow(reevaluated, {}, null).category?.origin).toEqual({
      type: 'RULE',
      ruleId: 'r1',
      ruleVersion: 4,
    });
  });

  it('sin propuesta ni edición la descripción efectiva es la del archivo', () => {
    expect(effectiveRow(EMPTY_PROPOSAL, {}, 'COMPRA')).toMatchObject({
      description: { value: 'COMPRA', origin: { type: 'SYSTEM_DEFAULT' } },
      category: null,
    });
  });

  it('una categoría vaciada a propósito (null) es una edición manual, no una ausencia', () => {
    const row = effectiveRow(proposal, applyEditPatch({}, { categoryId: null }), null);
    expect(row.category).toEqual({ value: null, origin: { type: 'MANUAL' } });
  });

  it('marcar transferencia descarta la conversión y volver a gasto descarta ambas', () => {
    const conv = applyEditPatch(
      {},
      { conversion: { counterAccountId: 'usd', counterAmount: { amount: '100.00', currency: 'USD' } } },
    );
    expect(conv.kind).toBe('CONVERSION');
    const transfer = applyEditPatch(conv, { transfer: { counterAccountId: 'visa' } });
    expect(transfer).toMatchObject({ kind: 'TRANSFER', transfer: { counterAccountId: 'visa' } });
    expect(transfer.conversion).toBeUndefined();
    const back = applyEditPatch(transfer, { kind: 'EXPENSE' });
    expect(back.transfer).toBeUndefined();
    expect(back.kind).toBe('EXPENSE');
    // `null` quita el vínculo con la ocurrencia.
    const linked = applyEditPatch({}, { occurrenceLink: { occurrenceId: 'o1' } });
    expect(applyEditPatch(linked, { occurrenceLink: null }).occurrenceLink).toBeUndefined();
  });

  it('un parche vacío se detecta', () => {
    expect(isEmptyPatch({})).toBe(true);
    expect(isEmptyPatch({ note: null })).toBe(false);
  });
});

describe('Filas transferencia y conversión (2.6)', () => {
  const counter = { accountId: 'visa', currency: 'BOB', scale: 2, status: 'ACTIVE' };

  it('[TC-IMPORTS-PIPELINE-044] una transferencia a otra cuenta activa de la misma moneda es válida', () => {
    expect(codeOf(() => assertValidTransfer({ accountId: 'bob', accountCurrency: 'BOB', counter }))).toBe(
      'OK',
    );
  });

  it('[TC-IMPORTS-PIPELINE-045] hacia una cuenta de otra moneda se rechaza con TRANSFER_CURRENCY_MISMATCH', () => {
    const usd = { ...counter, accountId: 'usd', currency: 'USD' };
    expect(
      codeOf(() => assertValidTransfer({ accountId: 'bob', accountCurrency: 'BOB', counter: usd })),
    ).toBe('TRANSFER_CURRENCY_MISMATCH');
  });

  it('la misma cuenta y una cuenta no activa se rechazan', () => {
    expect(codeOf(() => assertValidTransfer({ accountId: 'visa', accountCurrency: 'BOB', counter }))).toBe(
      'TRANSFER_SAME_ACCOUNT',
    );
    expect(
      codeOf(() =>
        assertValidTransfer({
          accountId: 'bob',
          accountCurrency: 'BOB',
          counter: { ...counter, status: 'CLOSED' },
        }),
      ),
    ).toBe('ACCOUNT_CLOSED');
  });

  it('[TC-IMPORTS-PIPELINE-046] la conversión de 696.00 BOB por 100.00 USD tiene tasa efectiva USD/BOB 6.96', () => {
    const rate = assertValidConversion({
      accountId: 'bob',
      accountCurrency: 'BOB',
      accountScale: 2,
      amount: '696.00',
      counter: { accountId: 'usd', currency: 'USD', scale: 2, status: 'ACTIVE' },
      counterAmount: { amount: '100.00', currency: 'USD' },
    });
    expect(rate).toEqual({ pair: 'USD/BOB', rate: '6.96' });
  });

  it('la tasa efectiva no depende del sentido: 100.00 USD recibidos y 696.00 BOB entregados', () => {
    const rate = assertValidConversion({
      accountId: 'usd',
      accountCurrency: 'USD',
      accountScale: 2,
      amount: '100.00',
      counter: { accountId: 'bob', currency: 'BOB', scale: 2, status: 'ACTIVE' },
      counterAmount: { amount: '696.00', currency: 'BOB' },
    });
    expect(rate).toEqual({ pair: 'USD/BOB', rate: '6.96' });
  });

  it('la conversión rechaza misma moneda, monto fuera de escala y monto cero', () => {
    const base = {
      accountId: 'bob',
      accountCurrency: 'BOB',
      accountScale: 2,
      amount: '696.00',
      counter: { accountId: 'usd', currency: 'USD', scale: 2, status: 'ACTIVE' },
      counterAmount: { amount: '100.00', currency: 'USD' },
    };
    expect(
      codeOf(() => assertValidConversion({ ...base, counter: { ...base.counter, currency: 'BOB' } })),
    ).toBe('VALIDATION_FAILED');
    expect(
      codeOf(() => assertValidConversion({ ...base, counterAmount: { amount: '100.005', currency: 'USD' } })),
    ).not.toBe('OK');
    expect(
      codeOf(() => assertValidConversion({ ...base, counterAmount: { amount: '0.00', currency: 'USD' } })),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('RevertPlan (2.7)', () => {
  const cand = (n: number, patch: Partial<RevertCandidate> = {}): RevertCandidate => ({
    rowId: `row-${n}`,
    lineNumber: n,
    transactionId: `tx-${n}`,
    status: 'POSTED',
    inClosedPeriod: false,
    editedAfterImport: false,
    ...patch,
  });

  it('[TC-IMPORTS-PIPELINE-059] sin bloqueadas se anulan las no anuladas y se saltan las ya anuladas', () => {
    const plan = planRevert([cand(3), cand(1), cand(2, { status: 'VOIDED' })]);
    expect(plan.toVoid.map((c) => c.lineNumber)).toEqual([1, 3]);
    expect(plan.alreadyVoided.map((c) => c.lineNumber)).toEqual([2]);
    expect(plan.blocked).toEqual([]);
    expect(codeOf(() => assertRevertAllowed(plan, false))).toBe('OK');
  });

  it('[TC-IMPORTS-PIPELINE-060] una reconciliada o en periodo cerrado bloquea el deshacer completo', () => {
    const plan = planRevert([cand(1), cand(2, { status: 'RECONCILED' }), cand(3, { inClosedPeriod: true })]);
    expect(plan.blocked).toEqual([
      { rowId: 'row-2', lineNumber: 2, transactionId: 'tx-2', reason: 'RECONCILED' },
      { rowId: 'row-3', lineNumber: 3, transactionId: 'tx-3', reason: 'PERIOD_CLOSED' },
    ]);
    expect(codeOf(() => assertRevertAllowed(plan, false))).toBe('IMPORT_REVERT_BLOCKED');
  });

  it('[TC-IMPORTS-PIPELINE-061] con deshacer parcial explícito se anulan las demás', () => {
    const plan = planRevert([cand(1), cand(2), cand(3, { status: 'RECONCILED' })]);
    expect(codeOf(() => assertRevertAllowed(plan, true))).toBe('OK');
    expect(plan.toVoid).toHaveLength(2);
    expect(plan.blocked).toHaveLength(1);
  });

  it('cuenta las editadas después del import (se anulan igual)', () => {
    const plan = planRevert([cand(1, { editedAfterImport: true }), cand(2)]);
    expect(plan.editedAfterImport).toBe(1);
    expect(plan.toVoid).toHaveLength(2);
  });
});
