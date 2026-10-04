import { LifecycleMachine, type StateTransition } from '@pf/shared-kernel';

/** Estados de una cuenta (docs/31 D4): solo ACTIVE acepta movimientos (INV-026). */
export const ACCOUNT_STATUSES = ['ACTIVE', 'CLOSED', 'ARCHIVED'] as const;
export type AccountLifecycleStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_TRANSITIONS = ['OPEN', 'CLOSE', 'ARCHIVE', 'REACTIVATE'] as const;
export type AccountTransition = (typeof ACCOUNT_TRANSITIONS)[number];
export type AccountTransitionRecord = StateTransition<AccountLifecycleStatus, AccountTransition>;

/**
 * Máquina `Account` (openspec add-lifecycle-timeline, decisión 3; FR-ACCOUNTS-007). Única fuente de las transiciones
 * de estado de una cuenta: el agregado valida contra ella. Los cambios de metadatos son anotaciones (AccountUpdated).
 */
export const ACCOUNT_LIFECYCLE = LifecycleMachine.define({
  aggregateType: 'Account',
  machineVersion: 1,
  states: [
    { code: 'ACTIVE', terminal: false },
    { code: 'CLOSED', terminal: false },
    { code: 'ARCHIVED', terminal: false },
  ],
  transitions: [
    {
      code: 'OPEN',
      from: [],
      to: ['ACTIVE'],
      guard: 'moneda habilitada; asiento de saldo inicial si ≠ 0',
      events: ['accounts.AccountOpened.v1'],
    },
    {
      code: 'CLOSE',
      from: ['ACTIVE'],
      to: ['CLOSED'],
      guard: 'saldo 0 (ACCOUNT_BALANCE_NOT_ZERO); closedOn ≥ openedOn',
      events: ['accounts.AccountClosed.v1'],
    },
    {
      code: 'ARCHIVE',
      from: ['ACTIVE', 'CLOSED'],
      to: ['ARCHIVED'],
      guard: '—',
      events: ['accounts.AccountArchived.v1'],
    },
    {
      code: 'REACTIVATE',
      from: ['ARCHIVED', 'CLOSED'],
      to: ['ACTIVE'],
      guard: 'nombre libre entre las cuentas activas',
      events: ['accounts.AccountReactivated.v1'],
    },
  ],
});
