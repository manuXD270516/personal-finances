import { LifecycleMachine, type StateTransition } from '@pf/shared-kernel';

/**
 * Máquina `Subscription` (openspec add-subscriptions, decisión 3; docs/31 D37, docs/35 D138). `CANCELLED` es terminal.
 * La cancelación al fin del ciclo NO es un estado (D139): es el atributo `scheduledCancellationOn` sobre
 * `TRIAL|ACTIVE|PAUSED`; programarla o deshacerla son transiciones sin cambio de estado, y el job la ejecuta con
 * `CANCEL`. No existe `expired` (D140).
 */
export const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'PAUSED', 'CANCELLED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export type SubscriptionTransition =
  | 'CREATE'
  | 'END_TRIAL'
  | 'PAUSE'
  | 'RESUME'
  | 'SCHEDULE_CANCELLATION'
  | 'UNDO_SCHEDULED_CANCELLATION'
  | 'CANCEL';
export type SubscriptionTransitionRecord = StateTransition<SubscriptionStatus, SubscriptionTransition>;

const CANCELLED_EVENT = 'commitments.SubscriptionCancelled.v1';
const OPEN = ['TRIAL', 'ACTIVE', 'PAUSED'] as const;

export const SUBSCRIPTION_LIFECYCLE = LifecycleMachine.define({
  aggregateType: 'Subscription',
  machineVersion: 1,
  states: [
    { code: 'TRIAL', terminal: false },
    { code: 'ACTIVE', terminal: false },
    { code: 'PAUSED', terminal: false },
    { code: 'CANCELLED', terminal: true },
  ],
  transitions: [
    {
      code: 'CREATE',
      from: [],
      to: ['TRIAL', 'ACTIVE'],
      guard: 'datos válidos; en TRIAL si trae fin de trial (primera renovación ≥ fin de trial)',
      events: [],
    },
    {
      code: 'END_TRIAL',
      from: ['TRIAL'],
      to: ['ACTIVE'],
      guard: 'fin de trial ≤ hoy en la zona horaria del workspace; una sola vez',
      events: [],
    },
    {
      code: 'PAUSE',
      from: ['ACTIVE'],
      to: ['PAUSED'],
      guard: 'pausa la definición recurrente (sin cargos esperados pendientes)',
      events: [],
    },
    {
      code: 'RESUME',
      from: ['PAUSED'],
      to: ['ACTIVE'],
      guard: 'reanuda la definición sin generar las fechas transcurridas',
      events: [],
    },
    {
      code: 'SCHEDULE_CANCELLATION',
      from: OPEN,
      to: OPEN,
      guard: 'fecha futura; sin cargos esperados desde esa fecha; el estado no cambia',
      events: [],
    },
    {
      code: 'UNDO_SCHEDULED_CANCELLATION',
      from: OPEN,
      to: OPEN,
      guard: 'debe existir una cancelación programada; reinstaura los cargos esperados',
      events: [],
    },
    {
      code: 'CANCEL',
      from: OPEN,
      to: ['CANCELLED'],
      guard: 'fecha efectiva ≤ hoy; finaliza la definición; transacciones e historial intactos',
      events: [CANCELLED_EVENT],
    },
  ],
});
