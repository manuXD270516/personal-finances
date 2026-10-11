/** Vocabulario del dominio de metas (openspec add-savings-goals, decisiones 2 y 15). */
export const GOAL_TYPES = [
  'EMERGENCY_FUND',
  'PURCHASE',
  'TRAVEL',
  'EDUCATION',
  'RETIREMENT',
  'CUSTOM',
] as const;
export type GoalType = (typeof GOAL_TYPES)[number];

/** `REAL` respalda una transferencia posteada; `EARMARK` es una reserva sin ledger. */
export const GOAL_FUNDS = ['REAL', 'EARMARK'] as const;
export type GoalFund = (typeof GOAL_FUNDS)[number];

export const MOVEMENT_KINDS = [
  'CONTRIBUTION',
  'WITHDRAWAL',
  'REVERSAL',
  'REASSIGN_IN',
  'REASSIGN_OUT',
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const MOVEMENT_ORIGINS = ['USER', 'RECURRING', 'SUGGESTION', 'SYSTEM'] as const;
export type MovementOrigin = (typeof MOVEMENT_ORIGINS)[number];

export const TRACKING_STATUSES = ['BEHIND', 'ON_TRACK', 'AHEAD'] as const;
export type TrackingStatus = (typeof TRACKING_STATUSES)[number];

export const DEFAULT_TOLERANCE_PERCENT = '5.00';
export const MAX_TOLERANCE_PERCENT = '50.00';
export const DEFAULT_PACE_PERIODS = 3;
export const MIN_PRIORITY = 1;
export const MAX_PRIORITY = 5;
export const DEFAULT_PRIORITY = 3;

/** Hitos de progreso que NOTIFY deriva de los hechos de movimiento (decisión 16). */
export const MILESTONES = [25, 50, 75] as const;
