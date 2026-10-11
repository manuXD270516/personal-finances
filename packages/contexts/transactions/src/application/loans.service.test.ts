import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { LoanTransactionsAdapter } from './loan-transactions.port.js';
import { inMemoryTransactionsDeps } from './testing/in-memory.js';
import { TransactionsService } from './transactions.service.js';
import { LOAN_DISBURSEMENT_NAMESPACE, LOAN_PAYMENT_NAMESPACE } from '../contracts/index.js';
import { loanIdOf } from '../domain/index.js';

const WS = 'ws-1';
const USER = 'user-1';
const BANK = 'banco-bob';
const LOAN_ACC = 'prestamo-vehicular';
const USD_BANK = 'banco-usd';
const LOAN_ID = '0192f3c4-0000-7000-8000-0000000000e2';
const PAYMENT_ID = '0192f3c4-0000-7000-8000-0000000000e3';

function setup() {
  const mem = inMemoryTransactionsDeps({
    accounts: [
      { accountId: BANK, currency: 'BOB', nature: 'ASSET', status: 'ACTIVE' },
      { accountId: LOAN_ACC, currency: 'BOB', nature: 'LIABILITY', status: 'ACTIVE' },
      { accountId: USD_BANK, currency: 'USD', nature: 'ASSET', status: 'ACTIVE' },
    ],
  });
  const service = new TransactionsService(mem.deps);
  return { ...mem, service, port: new LoanTransactionsAdapter(service) };
}

const disbursement = (over: Record<string, unknown> = {}) => ({
  workspaceId: WS,
  userId: USER,
  loanId: LOAN_ID,
  businessDate: '2026-10-15',
  loanAccountId: LOAN_ACC,
  destinationAccountId: BANK,
  principal: { amount: '50000.00', currency: 'BOB' },
  description: 'Desembolso Préstamo vehicular',
  ...over,
});

const payment = (over: Record<string, unknown> = {}) => ({
  workspaceId: WS,
  userId: USER,
  paymentId: PAYMENT_ID,
  businessDate: '2026-11-15',
  paymentAccountId: BANK,
  loanAccountId: LOAN_ACC,
  amount: { amount: '2342.02', currency: 'BOB' },
  breakdown: {
    loanId: LOAN_ID,
    principal: '1862.85',
    interest: '479.17',
    fees: '0.00',
    insurance: '0.00',
    taxes: '0.00',
  },
  description: 'Cuota 1 Préstamo vehicular',
  ...over,
});

async function errorOf(p: Promise<unknown>): Promise<DomainError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error('expected a DomainError');
}

describe('LoanTransactionsPort.recordDisbursement', () => {
  it('[TC-DEBT-LOAN-007] sin comisión: destino +50000.00, el préstamo adeuda 50000.00 y el asiento suma 0.00', async () => {
    const { port, service, balanceOf, state } = setup();
    const { transactionId, businessDate } = await port.recordDisbursement(disbursement());
    expect(businessDate).toBe('2026-10-15');
    expect(balanceOf(BANK)).toBe('50000.00');
    expect(balanceOf(LOAN_ACC)).toBe('-50000.00');
    expect(balanceOf('EXPENSE')).toBe('0.00');
    expect(state.entries).toHaveLength(1);
    const tx = await service.getTransaction(WS, transactionId);
    expect(tx).toMatchObject({
      kind: 'LOAN_DISBURSEMENT',
      source: 'DEBT',
      status: 'POSTED',
      externalRef: { namespace: 'debt.loan', id: LOAN_ID },
    });
    expect(tx.splits).toEqual([]);
    expect(loanIdOf(tx)).toBe(LOAN_ID);
    expect(tx.externalRef?.namespace).toBe(LOAN_DISBURSEMENT_NAMESPACE);
  });

  it('[TC-DEBT-LOAN-008] con comisión retenida 500.00: destino 49500.00, gasto 500.00 en Comisiones de préstamo y deuda 50000.00', async () => {
    const { port, service, balanceOf } = setup();
    const { transactionId } = await port.recordDisbursement(disbursement({ retainedFee: '500.00' }));
    expect(balanceOf(BANK)).toBe('49500.00');
    expect(balanceOf('EXPENSE')).toBe('500.00');
    expect(balanceOf(LOAN_ACC)).toBe('-50000.00');
    const tx = await service.getTransaction(WS, transactionId);
    expect(tx.splits.map((s) => [s.categoryId, s.amount.toFixed()])).toEqual([['cat-loan-fees', '500.00']]);
  });

  it('una comisión "0.00" equivale a no tenerla', async () => {
    const { port, balanceOf } = setup();
    await port.recordDisbursement(disbursement({ retainedFee: '0.00' }));
    expect(balanceOf('EXPENSE')).toBe('0.00');
  });

  it('es idempotente por externalRef: repetirlo no crea otra transacción ni otro asiento', async () => {
    const { port, state } = setup();
    const first = await port.recordDisbursement(disbursement());
    const second = await port.recordDisbursement(disbursement());
    expect(second.transactionId).toBe(first.transactionId);
    expect(state.txs.size).toBe(1);
    expect(state.entries).toHaveLength(1);
  });

  it('la misma referencia con otro monto falla en claro sin tocar el ledger', async () => {
    const { port, state } = setup();
    await port.recordDisbursement(disbursement());
    const err = await errorOf(
      port.recordDisbursement(disbursement({ principal: { amount: '60000.00', currency: 'BOB' } })),
    );
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(state.entries).toHaveLength(1);
  });

  it('cuenta destino en otra moneda ⇒ CURRENCY_MISMATCH y nada persistido', async () => {
    const { port, state } = setup();
    const err = await errorOf(port.recordDisbursement(disbursement({ destinationAccountId: USD_BANK })));
    expect(err.code).toBe('CURRENCY_MISMATCH');
    expect(state.txs.size).toBe(0);
    expect(state.entries).toHaveLength(0);
  });
});

describe('LoanTransactionsPort.recordPayment', () => {
  it('[TC-DEBT-LOAN-012] pago de 2342.02: fuente −2342.02, deuda +1862.85 y gasto 479.17 en Intereses pagados', async () => {
    const { port, service, balanceOf, state } = setup();
    await port.recordDisbursement(disbursement());
    const before = state.entries.length;
    const { transactionId } = await port.recordPayment(payment());
    expect(state.entries.length).toBe(before + 1);
    expect(balanceOf(BANK)).toBe('47657.98');
    expect(balanceOf(LOAN_ACC)).toBe('-48137.15');
    expect(balanceOf('EXPENSE')).toBe('479.17');
    const tx = await service.getTransaction(WS, transactionId);
    expect(tx).toMatchObject({ kind: 'LOAN_PAYMENT', source: 'DEBT' });
    expect(tx.splits.map((s) => [s.categoryId, s.amount.toFixed()])).toEqual([['cat-interest', '479.17']]);
    expect(tx.externalRef).toEqual({ namespace: 'debt.loan-payment', id: PAYMENT_ID });
  });

  it('[TC-DEBT-LOAN-013] con comisión 10.00 y seguro 20.00: cada componente en su categoría de sistema y sin impuestos', async () => {
    const { port, service, balanceOf } = setup();
    const { transactionId } = await port.recordPayment(
      payment({
        amount: { amount: '2372.02', currency: 'BOB' },
        breakdown: {
          loanId: LOAN_ID,
          principal: '1862.85',
          interest: '479.17',
          fees: '10.00',
          insurance: '20.00',
          taxes: '0.00',
        },
      }),
    );
    const tx = await service.getTransaction(WS, transactionId);
    expect(tx.splits.map((s) => [s.categoryId, s.amount.toFixed()])).toEqual([
      ['cat-interest', '479.17'],
      ['cat-loan-fees', '10.00'],
      ['cat-insurance', '20.00'],
    ]);
    expect(balanceOf(LOAN_ACC)).toBe('1862.85');
    expect(balanceOf('EXPENSE')).toBe('509.17');
  });

  it('[TC-DEBT-LOAN-019] el gasto del pago es solo el interés: el patrimonio baja exactamente 479.17 y el principal no es gasto', async () => {
    const { port, balanceOf } = setup();
    await port.recordDisbursement(disbursement());
    const netBefore = Number(balanceOf(BANK)) + Number(balanceOf(LOAN_ACC));
    await port.recordPayment(payment());
    const netAfter = Number(balanceOf(BANK)) + Number(balanceOf(LOAN_ACC));
    expect((netBefore - netAfter).toFixed(2)).toBe('479.17');
    expect(balanceOf('EXPENSE')).toBe('479.17');
    expect(balanceOf('INCOME')).toBe('0.00');
  });

  it('principal 0: no hay pata TARGET y el asiento solo mueve la cuenta de pago y el gasto', async () => {
    const { port, service, balanceOf } = setup();
    const { transactionId } = await port.recordPayment(
      payment({
        amount: { amount: '100.00', currency: 'BOB' },
        breakdown: {
          loanId: LOAN_ID,
          principal: '0.00',
          interest: '100.00',
          fees: '0.00',
          insurance: '0.00',
          taxes: '0.00',
        },
      }),
    );
    const tx = await service.getTransaction(WS, transactionId);
    expect(tx.legs.map((l) => l.role)).toEqual(['SOURCE']);
    expect(balanceOf(BANK)).toBe('-100.00');
    expect(balanceOf('EXPENSE')).toBe('100.00');
    expect(balanceOf(LOAN_ACC)).toBe('0.00');
  });

  it('[TC-DEBT-LOAN-012] un desglose que no suma el monto ⇒ PAYMENT_BREAKDOWN_MISMATCH sin persistir nada', async () => {
    const { port, state } = setup();
    const err = await errorOf(
      port.recordPayment(payment({ amount: { amount: '2342.03', currency: 'BOB' } })),
    );
    expect(err.code).toBe('PAYMENT_BREAKDOWN_MISMATCH');
    expect(err.details).toEqual({ sum: '2342.02', amount: '2342.03' });
    expect(state.txs.size).toBe(0);
    expect(state.entries).toHaveLength(0);
  });

  it('pago desde una cuenta en moneda distinta de la del préstamo ⇒ CURRENCY_MISMATCH (design pregunta abierta 5)', async () => {
    const { port, state } = setup();
    const err = await errorOf(port.recordPayment(payment({ paymentAccountId: USD_BANK })));
    expect(err.code).toBe('CURRENCY_MISMATCH');
    expect(state.txs.size).toBe(0);
    expect(state.entries).toHaveLength(0);
  });

  it('es idempotente por externalRef y falla en claro con otro monto', async () => {
    const { port, state } = setup();
    const first = await port.recordPayment(payment());
    const again = await port.recordPayment(payment());
    expect(again.transactionId).toBe(first.transactionId);
    expect(state.entries).toHaveLength(1);
    const err = await errorOf(
      port.recordPayment(
        payment({
          amount: { amount: '100.00', currency: 'BOB' },
          breakdown: {
            loanId: LOAN_ID,
            principal: '0.00',
            interest: '100.00',
            fees: '0.00',
            insurance: '0.00',
            taxes: '0.00',
          },
        }),
      ),
    );
    expect(err.code).toBe('VALIDATION_FAILED');
  });

  it('[TC-DEBT-LOAN-040] el listado por tipo expone el desglose y el préstamo', async () => {
    const { port, service } = setup();
    await port.recordDisbursement(disbursement());
    await port.recordPayment(payment());
    const found = await service.listTransactions({
      workspaceId: WS,
      kinds: ['LOAN_PAYMENT'],
      accountIds: [BANK],
      dateFrom: '2026-11-01',
      dateTo: '2026-11-30',
      offset: 0,
      limit: 50,
    });
    expect(found).toHaveLength(1);
    const tx = found[0]!;
    expect(tx).toMatchObject({
      kind: 'LOAN_PAYMENT',
      businessDate: '2026-11-15',
      externalRef: { namespace: LOAN_PAYMENT_NAMESPACE },
    });
    expect(tx.amount.toFixed()).toBe('2342.02');
    expect(loanIdOf(tx)).toBe(LOAN_ID);
    expect(tx.loanPaymentBreakdown?.toJson()).toEqual({
      loanId: LOAN_ID,
      principal: '1862.85',
      interest: '479.17',
      fees: '0.00',
      insurance: '0.00',
      taxes: '0.00',
    });
    expect(tx.legs.find((l) => l.role === 'SOURCE')?.accountId).toBe(BANK);
  });
});

describe('transacciones de préstamo desde la API de transacciones', () => {
  it('crearlas con RecordTransaction ⇒ VALIDATION_FAILED', async () => {
    const { service, state } = setup();
    for (const kind of ['LOAN_PAYMENT', 'LOAN_DISBURSEMENT'] as const) {
      const err = await errorOf(
        service.recordTransaction({
          workspaceId: WS,
          userId: USER,
          kind,
          transactionDate: '2026-11-15',
          accountId: BANK,
          amount: { amount: '10.00', currency: 'BOB' },
        }),
      );
      expect(err.code).toBe('VALIDATION_FAILED');
    }
    expect(state.txs.size).toBe(0);
  });

  it('[TC-DEBT-LOAN-041] anular desde transacciones ⇒ TRANSACTION_MANAGED_EXTERNALLY y la transacción sigue vigente', async () => {
    const { port, service, state, balanceOf } = setup();
    const { transactionId } = await port.recordPayment(payment());
    const tx = await service.getTransaction(WS, transactionId);
    const err = await errorOf(service.voidTransaction(WS, transactionId, tx.version, 'error de carga'));
    expect(err.code).toBe('TRANSACTION_MANAGED_EXTERNALLY');
    expect(err.details).toEqual({ managedBy: 'DEBT', loanId: LOAN_ID });
    expect((await service.getTransaction(WS, transactionId)).status).toBe('POSTED');
    expect(state.entries).toHaveLength(1);
    expect(balanceOf(BANK)).toBe('-2342.02');
  });

  it('[TC-DEBT-LOAN-041] editar monto, fecha, cuenta o splits ⇒ TRANSACTION_MANAGED_EXTERNALLY sin tocar el asiento', async () => {
    const { port, service, state } = setup();
    const { transactionId } = await port.recordPayment(payment());
    const tx = await service.getTransaction(WS, transactionId);
    const base = { workspaceId: WS, userId: USER, transactionId, expectedVersion: tx.version };
    for (const change of [
      { amount: { amount: '2000.00', currency: 'BOB' } },
      { transactionDate: '2026-11-16' },
      { accountId: USD_BANK },
      { splits: [{ amount: { amount: '479.17', currency: 'BOB' }, categoryId: 'otra' }] },
    ]) {
      const err = await errorOf(service.updateTransaction({ ...base, ...change }));
      expect(err.code, JSON.stringify(change)).toBe('TRANSACTION_MANAGED_EXTERNALLY');
    }
    expect(state.entries).toHaveLength(1);
    expect((await service.getTransaction(WS, transactionId)).version).toBe(tx.version);
  });

  it('[TC-DEBT-LOAN-042] la nota se registra y el asiento del pago no cambia', async () => {
    const { port, service, state, balanceOf } = setup();
    const { transactionId } = await port.recordPayment(payment());
    const tx = await service.getTransaction(WS, transactionId);
    const updated = await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId,
      expectedVersion: tx.version,
      notes: 'pagado en ventanilla',
    });
    expect(updated.notes).toBe('pagado en ventanilla');
    expect(updated.revision).toBe(tx.revision);
    expect(updated.activeEntryId).toBe(tx.activeEntryId);
    expect(state.entries).toHaveLength(1);
    expect(balanceOf(BANK)).toBe('-2342.02');
  });

  it('la conciliación aplica normal: POSTED → CLEARED sin tocar el ledger', async () => {
    const { port, service, state } = setup();
    const { transactionId } = await port.recordPayment(payment());
    const tx = await service.getTransaction(WS, transactionId);
    const updated = await service.updateTransaction({
      workspaceId: WS,
      userId: USER,
      transactionId,
      expectedVersion: tx.version,
      status: 'CLEARED',
    });
    expect(updated.status).toBe('CLEARED');
    expect(state.entries).toHaveLength(1);
  });
});

describe('LoanTransactionsPort.voidManaged', () => {
  it('revierte el asiento del pago por el camino interno y deja las cuentas como antes', async () => {
    const { port, service, balanceOf, state } = setup();
    await port.recordDisbursement(disbursement());
    const { transactionId } = await port.recordPayment(payment());
    await port.voidManaged({
      workspaceId: WS,
      userId: USER,
      transactionId,
      reason: 'pago anulado en el préstamo',
    });
    const tx = await service.getTransaction(WS, transactionId);
    expect(tx.status).toBe('VOIDED');
    expect(balanceOf(BANK)).toBe('50000.00');
    expect(balanceOf(LOAN_ACC)).toBe('-50000.00');
    expect(balanceOf('EXPENSE')).toBe('0.00');
    expect(state.entries.some((e) => e.reverses !== null)).toBe(true);
  });

  it('es idempotente si ya está anulada y rechaza transacciones que no son administradas', async () => {
    const { port, service } = setup();
    const { transactionId } = await port.recordPayment(payment());
    await port.voidManaged({ workspaceId: WS, userId: USER, transactionId, reason: 'x' });
    await expect(
      port.voidManaged({ workspaceId: WS, userId: USER, transactionId, reason: 'x' }),
    ).resolves.toBeUndefined();
    const { transaction } = await service.recordTransaction({
      workspaceId: WS,
      userId: USER,
      kind: 'EXPENSE',
      transactionDate: '2026-11-16',
      accountId: BANK,
      amount: { amount: '10.00', currency: 'BOB' },
    });
    const err = await errorOf(
      port.voidManaged({ workspaceId: WS, userId: USER, transactionId: transaction.id, reason: 'x' }),
    );
    expect(err.code).toBe('VALIDATION_FAILED');
  });

  it('tras anular, el mismo pago puede registrarse de nuevo con otra referencia sin chocar con la anterior', async () => {
    const { port } = setup();
    const first = await port.recordPayment(payment());
    await port.voidManaged({
      workspaceId: WS,
      userId: USER,
      transactionId: first.transactionId,
      reason: 'x',
    });
    const second = await port.recordPayment(payment({ paymentId: '0192f3c4-0000-7000-8000-0000000000e9' }));
    expect(second.transactionId).not.toBe(first.transactionId);
  });
});
