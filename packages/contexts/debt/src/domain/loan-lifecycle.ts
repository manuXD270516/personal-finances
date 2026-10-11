import { LifecycleMachine, type StateTransition } from '@pf/shared-kernel';

/**
 * Máquina `Loan` (openspec add-loans, decisión 2 y 15; docs/31 D37, docs/04 §4.6 sin `delinquent` ni `refinanced`,
 * que quedan fuera de Phase 4 — D159). `PAID_OFF` no es terminal: anular el pago que saldó el préstamo lo reactiva.
 * Los pagos y sus anulaciones son ANOTACIONES del recorrido (no cambian de estado salvo el saldado y la reactivación).
 */
export const LOAN_STATUSES = ['DRAFT', 'ACTIVE', 'PAID_OFF', 'CANCELLED'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export type LoanTransition =
  'REGISTER' | 'DISBURSE' | 'REGISTER_EXISTING' | 'PAY_OFF' | 'REACTIVATE' | 'CANCEL';
export type LoanTransitionRecord = StateTransition<LoanStatus, LoanTransition>;

const DISBURSED_EVENT = 'debt.LoanDisbursed.v1';
const SCHEDULE_EVENT = 'debt.LoanScheduleGenerated.v1';
const PAID_OFF_EVENT = 'debt.LoanPaidOff.v1';

export const LOAN_LIFECYCLE = LifecycleMachine.define({
  aggregateType: 'Loan',
  machineVersion: 1,
  states: [
    { code: 'DRAFT', terminal: false },
    { code: 'ACTIVE', terminal: false },
    { code: 'PAID_OFF', terminal: false },
    { code: 'CANCELLED', terminal: true },
  ],
  transitions: [
    {
      code: 'REGISTER',
      from: [],
      to: ['DRAFT'],
      guard: 'condiciones válidas; cuentas activas en la moneda del préstamo; sin asientos',
      events: [],
    },
    {
      code: 'DISBURSE',
      from: ['DRAFT'],
      to: ['ACTIVE'],
      guard:
        'fecha fuera de periodos cerrados; crea el desembolso, fija el cronograma v1 y el compromiso de cuotas',
      events: [DISBURSED_EVENT, SCHEDULE_EVENT],
    },
    {
      code: 'REGISTER_EXISTING',
      from: [],
      to: ['ACTIVE'],
      guard: 'saldo pendiente igual al saldo de la cuenta del préstamo; cronograma v1 sobre el pendiente',
      events: [SCHEDULE_EVENT],
    },
    {
      code: 'PAY_OFF',
      from: ['ACTIVE'],
      to: ['PAID_OFF'],
      guard: 'el principal pendiente llega a cero; termina el compromiso de cuotas',
      events: [PAID_OFF_EVENT],
    },
    {
      code: 'REACTIVATE',
      from: ['PAID_OFF'],
      to: ['ACTIVE'],
      guard: 'se anuló el pago que saldó el préstamo; reinstaura el compromiso de cuotas',
      events: [],
    },
    {
      code: 'CANCEL',
      from: ['DRAFT', 'ACTIVE'],
      to: ['CANCELLED'],
      guard: 'sin pagos vigentes; un préstamo activo anula su desembolso y termina su compromiso',
      events: [],
    },
  ],
});
