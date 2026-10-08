import { currency, DomainError, Money } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { RECONCILIATION_LIFECYCLE } from './reconciliation-lifecycle.js';
import { Reconciliation } from './reconciliation.js';

const BOB = currency('BOB', 2);
const bob = (v: string) => Money.parse(v, BOB);
const ID = '0192f3c4-0000-7000-8000-000000000a01';
const WS = '0192f3c4-0000-7000-8000-000000000001';
const BANK_A = '0192f3c4-0000-7000-8000-0000000000a1';
const USER = '0192f3c4-0000-7000-8000-0000000000b1';
const TODAY = '2026-04-05';

const start = (over: Partial<Parameters<typeof Reconciliation.start>[0]> = {}) =>
  Reconciliation.start({
    id: ID,
    workspaceId: WS,
    accountId: BANK_A,
    statementDate: '2026-03-31',
    statementBalance: bob('3350.00'),
    today: TODAY,
    lastCompletedStatementDate: null,
    startedBy: USER,
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

describe('Reconciliation (agregado)', () => {
  it('[TC-TRANSACTIONS-RECONCILIATION-001] iniciar deja la sesión IN_PROGRESS con fecha y saldo del extracto y la transición START', () => {
    const r = start();
    expect(r.snapshot).toMatchObject({
      status: 'IN_PROGRESS',
      statementDate: '2026-03-31',
      accountId: BANK_A,
      clearedBalance: null,
      difference: null,
      adjustmentTransactionId: null,
      version: 1,
    });
    expect(r.snapshot.statementBalance.toFixed()).toBe('3350.00');
    expect(r.lastTransition).toEqual({ transition: 'START', from: null, to: 'IN_PROGRESS' });
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-002] la fecha del extracto no puede ser futura ni anterior o igual a la última completada', () => {
    expect(codeOf(() => start({ statementDate: '2026-04-06' }))).toBe(
      'RECONCILIATION_STATEMENT_DATE_INVALID',
    );
    expect(codeOf(() => start({ statementDate: '2026-04-05' }))).toBeUndefined();
    expect(
      codeOf(() => start({ statementDate: '2026-03-15', lastCompletedStatementDate: '2026-03-31' })),
    ).toBe('RECONCILIATION_STATEMENT_DATE_INVALID');
    expect(
      codeOf(() => start({ statementDate: '2026-03-31', lastCompletedStatementDate: '2026-03-31' })),
    ).toBe('RECONCILIATION_STATEMENT_DATE_INVALID');
    expect(
      codeOf(() => start({ statementDate: '2026-04-01', lastCompletedStatementDate: '2026-03-31' })),
    ).toBeUndefined();
    expect(codeOf(() => start({ statementDate: '2026-02-30' }))).toBe('VALIDATION_FAILED');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-006] finalizar congela saldo confirmado y diferencia 0 y deja la transición COMPLETE', () => {
    const r = start();
    r.complete({
      clearedBalance: bob('3350.00'),
      adjustmentTransactionId: null,
      completedBy: USER,
      at: '2026-04-05T16:00:00.000Z',
    });
    expect(r.snapshot).toMatchObject({ status: 'COMPLETED', completedBy: USER, version: 2 });
    expect(r.snapshot.clearedBalance?.toFixed()).toBe('3350.00');
    expect(r.snapshot.difference?.toFixed()).toBe('0.00');
    expect(r.lastTransition).toEqual({ transition: 'COMPLETE', from: 'IN_PROGRESS', to: 'COMPLETED' });
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-008] finalizar con ajuste guarda la transacción de ajuste; el saldo confirmado coincide con el extracto', () => {
    const r = start({ statementBalance: bob('3345.00') });
    r.complete({
      clearedBalance: bob('3345.00'),
      adjustmentTransactionId: '0192f3c4-0000-7000-8000-000000000f01',
      completedBy: USER,
      at: '2026-04-05T16:00:00.000Z',
    });
    expect(r.snapshot.adjustmentTransactionId).toBe('0192f3c4-0000-7000-8000-000000000f01');
    expect(r.snapshot.difference?.toFixed()).toBe('0.00');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-006] solo se finaliza con diferencia 0: un saldo confirmado distinto del extracto se rechaza', () => {
    const r = start();
    expect(
      codeOf(() =>
        r.complete({
          clearedBalance: bob('3345.00'),
          adjustmentTransactionId: null,
          completedBy: USER,
          at: 'x',
        }),
      ),
    ).toBe('RECONCILIATION_DIFFERENCE_NOT_ZERO');
    expect(r.snapshot.status).toBe('IN_PROGRESS');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-009] cancelar deja CANCELLED; una sesión terminal no admite más transiciones', () => {
    const r = start();
    r.cancel({ cancelledBy: USER, at: '2026-04-05T16:00:00.000Z' });
    expect(r.snapshot).toMatchObject({ status: 'CANCELLED', cancelledBy: USER, version: 2 });
    expect(r.lastTransition).toEqual({ transition: 'CANCEL', from: 'IN_PROGRESS', to: 'CANCELLED' });
    const done = r.lastTransition;
    expect(
      codeOf(() =>
        r.complete({
          clearedBalance: bob('3350.00'),
          adjustmentTransactionId: null,
          completedBy: USER,
          at: 'x',
        }),
      ),
    ).toBe('INVALID_STATUS_TRANSITION');
    expect(codeOf(() => r.cancel({ cancelledBy: USER, at: 'x' }))).toBe('INVALID_STATUS_TRANSITION');
    // El intento rechazado no registró nada nuevo.
    expect(r.lastTransition).toBe(done);
    const completed = start();
    completed.complete({
      clearedBalance: bob('3350.00'),
      adjustmentTransactionId: null,
      completedBy: USER,
      at: 'x',
    });
    expect(codeOf(() => completed.cancel({ cancelledBy: USER, at: 'x' }))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-TRANSACTIONS-RECONCILIATION-005] confirmar en la sesión incrementa su versión (bloqueo optimista)', () => {
    const r = start();
    r.touch();
    expect(r.version).toBe(2);
    expect(r.lastTransition).toBeNull();
    r.cancel({ cancelledBy: USER, at: 'x' });
    expect(codeOf(() => r.touch())).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-AUDIT-LIFECYCLE-025] la máquina declara IN_PROGRESS, COMPLETED y CANCELLED (terminales) y START/COMPLETE/CANCEL', () => {
    const d = RECONCILIATION_LIFECYCLE.definition;
    expect(d.aggregateType).toBe('Reconciliation');
    expect(d.machineVersion).toBe(1);
    expect(d.states).toEqual([
      { code: 'IN_PROGRESS', terminal: false },
      { code: 'COMPLETED', terminal: true },
      { code: 'CANCELLED', terminal: true },
    ]);
    expect(d.transitions.map((t) => [t.code, t.from, t.to])).toEqual([
      ['START', [], ['IN_PROGRESS']],
      ['COMPLETE', ['IN_PROGRESS'], ['COMPLETED']],
      ['CANCEL', ['IN_PROGRESS'], ['CANCELLED']],
    ]);
    expect(RECONCILIATION_LIFECYCLE.transitionDefinition('COMPLETE')?.events).toEqual([
      'transactions.ReconciliationCompleted.v1',
    ]);
  });
});
