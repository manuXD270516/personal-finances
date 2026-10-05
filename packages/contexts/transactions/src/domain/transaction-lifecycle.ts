import { LifecycleMachine, type StateTransition } from '@pf/shared-kernel';

/** Estados de una transacción (docs/04 §4.1, FR-TRANSACTIONS-006, INV-023). */
export const TRANSACTION_STATUSES = ['PENDING', 'POSTED', 'CLEARED', 'RECONCILED', 'VOIDED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

/** Transiciones de la máquina `Transaction` (openspec add-lifecycle-timeline, decisión 2; docs/31 D37). */
export const TRANSACTION_TRANSITIONS = [
  'RECORD',
  'POST',
  'CLEAR',
  'UNCLEAR',
  'RECONCILE',
  'UNRECONCILE',
  'REVISE',
  'VOID',
] as const;
export type TransactionTransition = (typeof TRANSACTION_TRANSITIONS)[number];

/** Paso del flujo de una transacción (origen, destino y revisión). */
export interface TransactionTransitionRecord extends StateTransition<
  TransactionStatus,
  TransactionTransition
> {
  readonly revisionFrom: number | null;
  readonly revisionTo: number | null;
}

/**
 * Máquina `Transaction` (todos los kinds, incluidos `TRANSFER` y `CONVERSION`; `machineVersion = 1`). Es la ÚNICA
 * fuente de las transiciones permitidas: `transaction-status.ts` (`canTransition`/`assertTransition`) y el agregado
 * derivan de ella. Las reglas vigentes (FR-TRANSACTIONS-006, D16) no cambian: se declaran.
 */
export const TRANSACTION_LIFECYCLE = LifecycleMachine.define({
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
    {
      code: 'RECORD',
      from: [],
      to: ['PENDING', 'POSTED', 'CLEARED'],
      guard: 'datos válidos, cuentas activas (INV-026), idempotencia',
      events: [
        'transactions.TransactionCreated.v1',
        'transactions.TransactionPosted.v1',
        'transactions.TransferCompleted.v1',
        'transactions.ConversionRecorded.v1',
      ],
    },
    {
      code: 'POST',
      from: ['PENDING'],
      to: ['POSTED'],
      guard: 'cuentas activas (INV-026)',
      events: [
        'transactions.TransactionPosted.v1',
        'transactions.TransferCompleted.v1',
        'transactions.ConversionRecorded.v1',
      ],
    },
    {
      code: 'CLEAR',
      from: ['POSTED'],
      to: ['CLEARED'],
      guard: '—',
      events: ['transactions.TransactionUpdated.v1'],
    },
    {
      code: 'UNCLEAR',
      from: ['CLEARED'],
      to: ['POSTED'],
      guard: '—',
      events: ['transactions.TransactionUpdated.v1'],
    },
    {
      code: 'RECONCILE',
      from: ['CLEARED'],
      to: ['RECONCILED'],
      guard: '—',
      events: ['transactions.TransactionUpdated.v1'],
    },
    {
      code: 'UNRECONCILE',
      from: ['RECONCILED'],
      to: ['CLEARED'],
      guard: 'motivo obligatorio',
      events: ['transactions.TransactionUpdated.v1'],
    },
    {
      code: 'REVISE',
      from: ['POSTED', 'CLEARED'],
      to: ['POSTED'],
      guard:
        'cambian campos financieros; versión esperada; cuentas activas; misma moneda en TRANSFER (TRANSFER_CURRENCY_MISMATCH)',
      events: [
        'transactions.TransactionPosted.v1',
        'transactions.TransactionUpdated.v1',
        'transactions.TransferRevised.v1',
        'transactions.ConversionRevised.v1',
      ],
    },
    {
      code: 'VOID',
      from: ['PENDING', 'POSTED', 'CLEARED'],
      to: ['VOIDED'],
      guard: 'motivo; no RECONCILED (D16); cuentas activas para la reversa',
      events: ['transactions.TransactionVoided.v1'],
    },
  ],
});
