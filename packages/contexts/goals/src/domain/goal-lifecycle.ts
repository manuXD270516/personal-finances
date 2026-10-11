import { LifecycleMachine, type StateTransition } from '@pf/shared-kernel';

/**
 * Máquina `SavingsGoal` (openspec add-savings-goals, decisión 15; docs/31 D37, docs/04 §4.5; `CLOSED` por la decisión
 * D179). Los movimientos NO cambian de estado (son anotaciones del recorrido); `ARCHIVE` tampoco: es una anotación
 * que solo admiten las metas terminales. `CLOSED` y `CANCELLED` son terminales.
 */
export const GOAL_STATUSES = ['ACTIVE', 'PAUSED', 'ACHIEVED', 'CLOSED', 'CANCELLED'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export type GoalTransition = 'CREATE' | 'PAUSE' | 'RESUME' | 'REACH' | 'REOPEN' | 'CLOSE' | 'CANCEL';
export type GoalTransitionRecord = StateTransition<GoalStatus, GoalTransition>;

const REACHED_EVENT = 'goals.GoalReached.v1';

export const GOAL_LIFECYCLE = LifecycleMachine.define({
  aggregateType: 'SavingsGoal',
  machineVersion: 1,
  states: [
    { code: 'ACTIVE', terminal: false },
    { code: 'PAUSED', terminal: false },
    { code: 'ACHIEVED', terminal: false },
    { code: 'CLOSED', terminal: true },
    { code: 'CANCELLED', terminal: true },
  ],
  transitions: [
    {
      code: 'CREATE',
      from: [],
      to: ['ACTIVE'],
      guard:
        'nombre único entre las no archivadas, objetivo positivo, fechas coherentes y cuentas vinculadas activas de naturaleza activo',
      events: [],
    },
    {
      code: 'PAUSE',
      from: ['ACTIVE'],
      to: ['PAUSED'],
      guard: 'pausa el aporte programado; la meta sigue aceptando movimientos',
      events: [],
    },
    {
      code: 'RESUME',
      from: ['PAUSED'],
      to: ['ACTIVE'],
      guard: 'reanuda el aporte programado',
      events: [],
    },
    {
      code: 'REACH',
      from: ['ACTIVE', 'PAUSED'],
      to: ['ACHIEVED'],
      guard:
        'sistema: el saldo acumulado (parte convertida) alcanza el objetivo tras un movimiento, un cambio de objetivo o la reevaluación diaria',
      events: [REACHED_EVENT],
    },
    {
      code: 'REOPEN',
      from: ['ACHIEVED'],
      to: ['ACTIVE'],
      guard:
        'sistema: un movimiento o un cambio de objetivo deja el saldo por debajo del objetivo; una baja del tipo de cambio no reabre',
      events: [],
    },
    {
      code: 'CLOSE',
      from: ['ACHIEVED'],
      to: ['CLOSED'],
      guard: 'libera las reservas vigentes con movimientos explícitos y termina el aporte programado',
      events: [],
    },
    {
      code: 'CANCEL',
      from: ['ACTIVE', 'PAUSED', 'ACHIEVED'],
      to: ['CANCELLED'],
      guard:
        'libera las reservas vigentes con movimientos explícitos y termina el aporte programado; motivo opcional',
      events: [],
    },
  ],
});

/** Estados que ya no aceptan movimientos (`GOAL_CLOSED`). */
export const isTerminalGoalStatus = (status: GoalStatus): boolean => GOAL_LIFECYCLE.isTerminal(status);

/** Estados cuyos fondos cuentan como reservados por cuenta (decisión 5). */
export const RESERVING_STATUSES: readonly GoalStatus[] = ['ACTIVE', 'PAUSED', 'ACHIEVED'];
