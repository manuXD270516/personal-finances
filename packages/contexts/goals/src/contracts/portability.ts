import type { PortabilitySection } from '@pf/shared-kernel';

/**
 * Secciones de exportación/importación del workspace que pertenecen a GOALS (openspec add-savings-goals decisión 25 y
 * tarea 4.5; orden 772–778, después de COMMITMENTS 750–765 e IMPORTS 770–771 y antes de DEBT 780–796 y NOTIFICATIONS 800):
 * la meta, sus cuentas vinculadas, los movimientos (append-only; `reverses_id` apunta a otro movimiento), el plan, el
 * estado de sobre-asignación por cuenta, los aportes recurrentes en espera y las sugerencias. Los ids de cuentas,
 * transacciones, la definición recurrente y la ocurrencia se remapean al importar (columnas `uuid`) junto con
 * `goal_id`; `reassignment_id` y `episode_id` solo agrupan filas y conservan su valor.
 */
export const GOALS_PORTABILITY_SECTIONS: readonly PortabilitySection[] = [
  {
    name: 'savings-goals',
    context: 'goals',
    table: 'goals.savings_goal',
    order: 772,
    orderBy: ['id'],
    money: { target_amount: 't.currency' },
  },
  {
    name: 'goal-linked-accounts',
    context: 'goals',
    table: 'goals.goal_linked_account',
    order: 773,
    orderBy: ['goal_id', 'account_id'],
    idColumns: [],
  },
  {
    name: 'goal-movements',
    context: 'goals',
    table: 'goals.goal_movement',
    order: 774,
    orderBy: ['goal_id', 'recorded_at', 'id'],
    selfRefs: ['reverses_id'],
    money: { amount: 't.currency' },
  },
  {
    name: 'goal-plans',
    context: 'goals',
    table: 'goals.goal_plan',
    order: 775,
    orderBy: ['goal_id'],
    idColumns: [],
    money: { monthly_amount: 't.currency' },
  },
  {
    name: 'goal-account-reservation-states',
    context: 'goals',
    table: 'goals.account_reservation_state',
    order: 776,
    orderBy: ['account_id'],
    idColumns: [],
    money: { shortfall: 't.currency' },
  },
  {
    name: 'goal-recurring-materializations',
    context: 'goals',
    table: 'goals.recurring_materialization',
    order: 777,
    orderBy: ['transaction_id'],
    idColumns: [],
  },
  {
    name: 'goal-contribution-suggestions',
    context: 'goals',
    table: 'goals.contribution_suggestion',
    order: 778,
    orderBy: ['transaction_id', 'transaction_revision'],
    money: { amount: 't.currency' },
  },
];
