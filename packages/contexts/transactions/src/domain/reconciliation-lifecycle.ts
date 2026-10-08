import { LifecycleMachine, type StateTransition } from '@pf/shared-kernel';

/** Estados de una sesión de reconciliación (openspec add-reconciliation, docs/04 §4). */
export const RECONCILIATION_STATUSES = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const RECONCILIATION_TRANSITIONS = ['START', 'COMPLETE', 'CANCEL'] as const;
export type ReconciliationTransition = (typeof RECONCILIATION_TRANSITIONS)[number];

export type ReconciliationTransitionRecord = StateTransition<ReconciliationStatus, ReconciliationTransition>;

/**
 * Máquina `RECONCILIATION_LIFECYCLE` (docs/31 D37; `machineVersion = 1`): una sesión nace `IN_PROGRESS` (`START`) y
 * termina `COMPLETED` (`COMPLETE`, publica `ReconciliationCompleted`) o `CANCELLED` (`CANCEL`); ambos son terminales
 * (no se reabre una sesión completada: se des-reconcilia transacción por transacción). Iniciar y cancelar no publican
 * evento; quedan en la auditoría y el recorrido.
 */
export const RECONCILIATION_LIFECYCLE = LifecycleMachine.define({
  aggregateType: 'Reconciliation',
  machineVersion: 1,
  states: [
    { code: 'IN_PROGRESS', terminal: false },
    { code: 'COMPLETED', terminal: true },
    { code: 'CANCELLED', terminal: true },
  ],
  transitions: [
    {
      code: 'START',
      from: [],
      to: ['IN_PROGRESS'],
      guard:
        'cuenta activa; una sesión en curso por cuenta; fecha del extracto ≤ hoy y posterior a la última completada',
      events: [],
    },
    {
      code: 'COMPLETE',
      from: ['IN_PROGRESS'],
      to: ['COMPLETED'],
      guard:
        'diferencia 0 o ajuste confirmado con motivo; periodos abiertos (INV-015); versión esperada de la sesión',
      events: ['transactions.ReconciliationCompleted.v1'],
    },
    {
      code: 'CANCEL',
      from: ['IN_PROGRESS'],
      to: ['CANCELLED'],
      guard: 'versión esperada de la sesión; conserva las marcas cleared',
      events: [],
    },
  ],
});
