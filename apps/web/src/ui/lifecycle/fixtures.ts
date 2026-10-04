/** Fixtures del recorrido (TC-AUDIT-LIFECYCLE-013): máquinas v1 tal como las sirve la API y el gasto corregido y anulado. */
import type { LifecycleMachine, LifecycleTransition, TransactionLifecycle } from './types';

export const U_ME = '0190a000-0000-7000-8000-0000000000b1';
export const U_EDITOR = '0190a000-0000-7000-8000-0000000000b2';
export const TX = '0190a000-0000-7000-8000-0000000000e1';
export const ACCOUNT = '0190a000-0000-7000-8000-0000000000c1';
export const E1 = '0190a000-0000-7000-8000-00000000e001';
export const E2 = '0190a000-0000-7000-8000-00000000e002';
export const E3 = '0190a000-0000-7000-8000-00000000e003';
export const E4 = '0190a000-0000-7000-8000-00000000e004';
export const bob = (amount: string) => ({ amount, currency: 'BOB' });
export const NO_JE = { reversed: null, reversal: null, posted: null };

/** Máquina `Transaction` v1 tal como la sirve `GET …/lifecycle-machines/Transaction`. */
export const TX_MACHINE: LifecycleMachine = {
  aggregateType: 'Transaction',
  machineVersion: 1,
  states: [
    { code: 'PENDING', terminal: false },
    { code: 'POSTED', terminal: false },
    { code: 'CLEARED', terminal: false },
    { code: 'RECONCILED', terminal: false },
    { code: 'VOIDED', terminal: true },
  ],
  transitions: [
    { code: 'RECORD', from: [], to: ['PENDING', 'POSTED', 'CLEARED'], guard: '', events: [] },
    { code: 'POST', from: ['PENDING'], to: ['POSTED'], guard: '', events: [] },
    { code: 'CLEAR', from: ['POSTED'], to: ['CLEARED'], guard: '', events: [] },
    { code: 'UNCLEAR', from: ['CLEARED'], to: ['POSTED'], guard: '', events: [] },
    { code: 'RECONCILE', from: ['CLEARED'], to: ['RECONCILED'], guard: '', events: [] },
    { code: 'UNRECONCILE', from: ['RECONCILED'], to: ['CLEARED'], guard: '', events: [] },
    { code: 'REVISE', from: ['POSTED', 'CLEARED'], to: ['POSTED'], guard: '', events: [] },
    { code: 'VOID', from: ['PENDING', 'POSTED', 'CLEARED'], to: ['VOIDED'], guard: '', events: [] },
  ],
};

export const ACCOUNT_MACHINE: LifecycleMachine = {
  aggregateType: 'Account',
  machineVersion: 1,
  states: [
    { code: 'ACTIVE', terminal: false },
    { code: 'CLOSED', terminal: false },
    { code: 'ARCHIVED', terminal: false },
  ],
  transitions: [
    { code: 'OPEN', from: [], to: ['ACTIVE'], guard: '', events: [] },
    { code: 'CLOSE', from: ['ACTIVE'], to: ['CLOSED'], guard: '', events: [] },
    { code: 'ARCHIVE', from: ['ACTIVE', 'CLOSED'], to: ['ARCHIVED'], guard: '', events: [] },
    { code: 'REACTIVATE', from: ['ARCHIVED', 'CLOSED'], to: ['ACTIVE'], guard: '', events: [] },
  ],
};

export const step = (
  over: Partial<LifecycleTransition> & Pick<LifecycleTransition, 'sequence'>,
): LifecycleTransition => ({
  kind: 'TRANSITION',
  transition: 'RECORD',
  fromState: null,
  toState: 'PENDING',
  machineVersion: 1,
  occurredAt: '2026-03-12T14:00:00.000Z',
  actor: { type: 'USER', id: U_ME, displayName: null },
  origin: 'ui',
  reason: null,
  revisionFrom: null,
  revisionTo: null,
  aggregateVersion: over.sequence,
  journalEntries: NO_JE,
  detailRefs: {},
  events: [],
  auditLogId: null,
  derived: false,
  ...over,
});

/** TC-AUDIT-LIFECYCLE-013: gasto de 80.00 BOB pendiente → posteado → corregido a 85.00 BOB → anulado ("duplicado"). */
export const EXPENSE: TransactionLifecycle = {
  aggregateType: 'Transaction',
  aggregateId: TX,
  currentState: 'VOIDED',
  path: ['PENDING', 'POSTED', 'POSTED', 'VOIDED'],
  historyComplete: true,
  machine: TX_MACHINE,
  items: [
    step({ sequence: 1, revisionTo: 1, events: ['transactions.TransactionCreated.v1'] }),
    step({
      sequence: 2,
      transition: 'POST',
      fromState: 'PENDING',
      toState: 'POSTED',
      occurredAt: '2026-03-12T14:05:00.000Z',
      revisionFrom: 1,
      revisionTo: 1,
      journalEntries: { reversed: null, reversal: null, posted: E1 },
    }),
    step({
      sequence: 3,
      transition: 'REVISE',
      fromState: 'POSTED',
      toState: 'POSTED',
      occurredAt: '2026-03-12T18:00:00.000Z',
      actor: { type: 'USER', id: U_EDITOR, displayName: null },
      revisionFrom: 1,
      revisionTo: 2,
      journalEntries: { reversed: E1, reversal: E2, posted: E3 },
      events: ['transactions.TransactionPosted.v1', 'transactions.TransactionUpdated.v1'],
    }),
    step({
      sequence: 4,
      transition: 'VOID',
      fromState: 'POSTED',
      toState: 'VOIDED',
      // 22:30 del 12 en La Paz (02:30 UTC del 13): la fecha mostrada sigue la zona del workspace.
      occurredAt: '2026-03-13T02:30:00.000Z',
      reason: 'duplicado',
      revisionFrom: 2,
      revisionTo: 2,
      journalEntries: { reversed: E3, reversal: E4, posted: null },
    }),
  ],
  revisions: [
    { revision: 1, amount: bob('80.00'), fee: null, legs: [], conversion: null },
    {
      revision: 2,
      amount: bob('85.00'),
      fee: null,
      legs: [{ accountId: ACCOUNT, role: 'MAIN', amount: bob('-85.00') }],
      conversion: null,
    },
  ],
};
