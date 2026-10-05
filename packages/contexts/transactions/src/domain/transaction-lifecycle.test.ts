import { DomainError, Money, type StateTransition } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BOB, bob, expense } from './fixtures.test-support.js';
import { TRANSACTION_LIFECYCLE, type TransactionTransition } from './transaction-lifecycle.js';
import type { TransactionStatus } from './transaction-status.js';
import type { Transaction } from './transaction.js';

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as DomainError).code;
  }
  return undefined;
};

describe('Máquina de estados Transaction (add-lifecycle-timeline)', () => {
  it('[TC-AUDIT-LIFECYCLE-001] la definición declara estados, terminal y las 8 transiciones con origen, destino, guarda y eventos', () => {
    const d = TRANSACTION_LIFECYCLE.definition;
    expect(d.aggregateType).toBe('Transaction');
    expect(d.machineVersion).toBe(1);
    expect(d.states.map((s) => s.code)).toEqual(['PENDING', 'POSTED', 'CLEARED', 'RECONCILED', 'VOIDED']);
    expect(d.states.filter((s) => s.terminal).map((s) => s.code)).toEqual(['VOIDED']);
    expect(d.transitions.map((t) => t.code)).toEqual([
      'RECORD',
      'POST',
      'CLEAR',
      'UNCLEAR',
      'RECONCILE',
      'UNRECONCILE',
      'REVISE',
      'VOID',
    ]);
    for (const t of d.transitions) {
      expect(t.to.length).toBeGreaterThan(0);
      expect(t.guard.length).toBeGreaterThan(0);
      expect(t.events.length).toBeGreaterThan(0);
    }
    expect(TRANSACTION_LIFECYCLE.transitionDefinition('REVISE')?.events).toContain(
      'transactions.TransferRevised.v1',
    );
    // [TC-TRANSACTIONS-CONVERSION-012] docs/31 D48: REVISE de una conversión publica ConversionRevised, no
    // ConversionRecorded (que solo sale en RECORD/POST, su primer asiento).
    expect(TRANSACTION_LIFECYCLE.transitionDefinition('REVISE')?.events).toContain(
      'transactions.ConversionRevised.v1',
    );
    expect(TRANSACTION_LIFECYCLE.transitionDefinition('REVISE')?.events).not.toContain(
      'transactions.ConversionRecorded.v1',
    );
    for (const code of ['RECORD', 'POST'] as const) {
      expect(TRANSACTION_LIFECYCLE.transitionDefinition(code)?.events).toContain(
        'transactions.ConversionRecorded.v1',
      );
    }
  });

  it('[TC-AUDIT-LIFECYCLE-001] reconciliar un gasto pendiente de 80.00 BOB se rechaza y no deja transición', () => {
    const tx = expense({ amount: bob('80.00'), status: 'PENDING' });
    const before = tx.snapshot;
    expect(codeOf(() => tx.changeStatus('RECONCILED'))).toBe('INVALID_STATUS_TRANSITION');
    expect(tx.status).toBe('PENDING');
    expect(tx.snapshot).toBe(before);
    // Sigue siendo la transición de creación: el intento rechazado no registró nada nuevo.
    expect(tx.lastTransition?.transition).toBe('RECORD');
  });

  it('[TC-AUDIT-LIFECYCLE-001] cada comando del agregado deja su transición validada contra la máquina', () => {
    const tx = expense({ amount: bob('80.00'), status: 'PENDING' });
    expect(tx.lastTransition).toEqual({
      transition: 'RECORD',
      from: null,
      to: 'PENDING',
      revisionFrom: null,
      revisionTo: 1,
    });
    tx.post();
    tx.attachEntry('e1');
    expect(tx.lastTransition).toMatchObject({ transition: 'POST', from: 'PENDING', to: 'POSTED' });
    tx.changeStatus('CLEARED');
    expect(tx.lastTransition).toMatchObject({ transition: 'CLEAR', from: 'POSTED', to: 'CLEARED' });
    tx.changeStatus('RECONCILED');
    expect(tx.lastTransition).toMatchObject({ transition: 'RECONCILE', to: 'RECONCILED' });
    expect(codeOf(() => tx.void('x', '2026-10-01T00:00:00Z'))).toBe('TRANSACTION_RECONCILED');
    tx.unreconcile('error de conciliación');
    expect(tx.lastTransition).toMatchObject({ transition: 'UNRECONCILE', from: 'RECONCILED', to: 'CLEARED' });
    tx.changeStatus('POSTED');
    expect(tx.lastTransition).toMatchObject({ transition: 'UNCLEAR', from: 'CLEARED', to: 'POSTED' });
    tx.void('duplicado', '2026-10-01T00:00:00Z');
    expect(tx.lastTransition).toMatchObject({ transition: 'VOID', from: 'POSTED', to: 'VOIDED' });
    expect(codeOf(() => tx.void('otra vez', '2026-10-01T00:00:00Z'))).toBe('INVALID_STATUS_TRANSITION');
  });

  it('[TC-AUDIT-LIFECYCLE-003] corregir 120.00 → 102.00 BOB un gasto posteado es la transición REVISE de la revisión 1 a la 2', () => {
    const tx = expense({ amount: bob('120.00') });
    tx.attachEntry('E1');
    const result = tx.amend({ amount: bob('102.00') });
    expect(result.ledgerImpact).toBe(true);
    expect(result.previousEntryId).toBe('E1');
    expect(tx.lastTransition).toEqual({
      transition: 'REVISE',
      from: 'POSTED',
      to: 'POSTED',
      revisionFrom: 1,
      revisionTo: 2,
    });
    // Un CLEARED corregido vuelve a POSTED por REVISE (no por UNCLEAR).
    const cleared = expense({ amount: bob('80.00'), status: 'CLEARED' });
    cleared.attachEntry('E2');
    cleared.amend({ amount: bob('85.00') });
    expect(cleared.lastTransition).toMatchObject({ transition: 'REVISE', from: 'CLEARED', to: 'POSTED' });
  });

  it('[TC-AUDIT-LIFECYCLE-004] una edición descriptiva o de un PENDING no es transición (será anotación)', () => {
    const tx = expense({ amount: bob('150.00') });
    tx.attachEntry('E1');
    const loaded = rehydrated(tx);
    loaded.amend({ description: 'almuerzo' });
    expect(loaded.lastTransition).toBeNull();
    const pending = rehydrated(expense({ amount: bob('80.00'), status: 'PENDING' }));
    const r = pending.amend({ amount: bob('81.00') });
    expect(r.ledgerImpact).toBe(false);
    expect(pending.lastTransition).toBeNull();
  });

  it('[TC-AUDIT-LIFECYCLE-001] PBT: toda secuencia de comandos deja un recorrido reproducible por la máquina y su estado final es el del agregado', () => {
    type Op = 'post' | 'clear' | 'unclear' | 'reconcile' | 'unreconcile' | 'revise' | 'void' | 'describe';
    const ops = fc.constantFrom<Op>(
      'post',
      'clear',
      'unclear',
      'reconcile',
      'unreconcile',
      'revise',
      'void',
      'describe',
    );
    fc.assert(
      fc.property(
        fc.constantFrom<'PENDING' | 'POSTED' | 'CLEARED'>('PENDING', 'POSTED', 'CLEARED'),
        fc.array(ops, { maxLength: 25 }),
        (initial, sequence) => {
          let tx = expense({ amount: bob('80.00'), status: initial });
          if (tx.needsEntry) tx.attachEntry('E0');
          const path: StateTransition<TransactionStatus, TransactionTransition>[] = [tx.lastTransition!];
          let cents = 8000n;
          for (const op of sequence) {
            tx = rehydrated(tx);
            try {
              if (op === 'post') tx.post();
              else if (op === 'clear') tx.changeStatus('CLEARED');
              else if (op === 'unclear') tx.changeStatus('POSTED');
              else if (op === 'reconcile') tx.changeStatus('RECONCILED');
              else if (op === 'unreconcile') tx.unreconcile('motivo');
              else if (op === 'revise') tx.amend({ amount: Money.ofMinorUnits(++cents, BOB) });
              else if (op === 'void') tx.void('motivo', '2026-10-01T00:00:00Z');
              else tx.amend({ description: `d${cents}` });
            } catch (err) {
              // Un comando rechazado no deja transición ni cambia el estado.
              expect(err).toBeInstanceOf(DomainError);
              expect(tx.lastTransition).toBeNull();
              continue;
            }
            if (tx.needsEntry && tx.snapshot.activeEntryId === null) tx.attachEntry(`E${cents}`);
            if (tx.lastTransition) path.push(tx.lastTransition);
          }
          // Append-only: el recorrido se reproduce desde ∅ y termina en el estado persistido.
          expect(TRANSACTION_LIFECYCLE.replay(path)).toBe(tx.status);
          expect(TRANSACTION_LIFECYCLE.reachableStates().has(tx.status)).toBe(true);
        },
      ),
    );
  });
});

/** Simula cargar el agregado en un comando nuevo (sin transición pendiente). */
function rehydrated(tx: Transaction): Transaction {
  return (tx.constructor as typeof Transaction).rehydrate(tx.snapshot);
}
