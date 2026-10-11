/**
 * Tipos del contrato `finance-api.v1.yaml` (tag `Goals`, openspec add-savings-goals): metas de ahorro, movimientos,
 * reservas por cuenta, sugerencias de aporte y simulación. Montos y tasas: `DecimalString` (INV-001), nunca `number`.
 */
import type { Money, ResolvedRate } from '../common/fx-types';

export type { Money, ResolvedRate } from '../common/fx-types';

export type GoalType = 'EMERGENCY_FUND' | 'PURCHASE' | 'TRAVEL' | 'EDUCATION' | 'RETIREMENT' | 'CUSTOM';
export const GOAL_TYPES: readonly GoalType[] = [
  'EMERGENCY_FUND',
  'PURCHASE',
  'TRAVEL',
  'EDUCATION',
  'RETIREMENT',
  'CUSTOM',
];

/** `ACHIEVED` se deriva del progreso (reversible); `CLOSED` y `CANCELLED` son terminales. */
export type GoalStatus = 'ACTIVE' | 'PAUSED' | 'ACHIEVED' | 'CLOSED' | 'CANCELLED';
export const GOAL_STATUSES: readonly GoalStatus[] = ['ACTIVE', 'PAUSED', 'ACHIEVED', 'CLOSED', 'CANCELLED'];

/** `REAL` = dinero movido a la cuenta de la meta; `EARMARK` = monto reservado sin mover dinero. */
export type GoalFund = 'REAL' | 'EARMARK';
export type GoalMovementKind = 'CONTRIBUTION' | 'WITHDRAWAL' | 'REVERSAL' | 'REASSIGN_IN' | 'REASSIGN_OUT';
export type GoalMovementOrigin = 'USER' | 'RECURRING' | 'SUGGESTION' | 'SYSTEM';
export type GoalSuggestionStatus = 'PENDING' | 'CONFIRMED' | 'DISMISSED' | 'EXPIRED';
export type GoalTrackingStatus = 'BEHIND' | 'ON_TRACK' | 'AHEAD';

export interface GoalProgress {
  readonly byCurrency: readonly Money[];
  /** Fondos convertidos a la moneda del objetivo (solo la parte con tasa vigente). */
  readonly total: Money;
  /** Porcentaje con 2 decimales (HALF_EVEN); puede superar 100. */
  readonly percent: string;
  readonly remaining: Money;
  /** `false` si hay fondos sin tasa vigente. */
  readonly complete: boolean;
  readonly unconverted: readonly Money[];
}

export interface GoalRequired {
  readonly monthly: Money | null;
  readonly periods: number | null;
  readonly overdue: boolean;
}

export interface GoalPace {
  readonly amount: Money | null;
  readonly periods: number;
  readonly source: 'HISTORY' | 'PLAN' | 'SIMULATED' | 'NONE';
  readonly complete: boolean;
}

export interface GoalExpectedDate {
  readonly date: string | null;
  readonly reason: 'NO_PACE' | 'BEYOND_HORIZON' | null;
}

export interface GoalTracking {
  /** `null` si no aplica (sin fecha objetivo o la meta no está `ACTIVE`). */
  readonly status: GoalTrackingStatus | null;
  readonly lifecycleStatus: GoalStatus;
  readonly expected: Money | null;
  /** Porcentaje con signo y 2 decimales; `null` si no aplica. */
  readonly deviationPercent: string | null;
}

export interface GoalPlanMaterialization {
  readonly mode: 'PENDING_APPROVAL' | 'AUTO_CREATE';
  readonly autoCreateStatus: 'PENDING' | 'POSTED' | null;
}

export interface GoalPlan {
  readonly monthlyAmount: Money;
  readonly fund: GoalFund;
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string | null;
  readonly dayOfMonth: number | null;
  readonly automation: 'NONE' | 'RECURRING';
  readonly materialization: GoalPlanMaterialization | null;
  readonly definitionId: string | null;
  /** Hay aportes recurrentes materializados esperando su transferencia posteada ("aporte en proceso"). */
  readonly pendingContribution: boolean;
  readonly version: number;
}

export interface GoalLinkedAccount {
  readonly accountId: string;
  readonly funds: { readonly real: Money; readonly earmark: Money };
  readonly overAllocated: boolean;
}

export interface Goal {
  readonly id: string;
  readonly name: string;
  readonly type: GoalType;
  readonly target: Money;
  readonly startDate: string;
  readonly targetDate: string | null;
  readonly linkedAccountIds: readonly string[];
  readonly priority: number;
  readonly icon: string | null;
  readonly color: string | null;
  readonly notes: string | null;
  readonly tolerancePercent: string;
  readonly pacePeriods: number;
  readonly status: GoalStatus;
  readonly achievedOn: string | null;
  readonly closedOn: string | null;
  readonly cancelledOn: string | null;
  readonly cancelReason: string | null;
  readonly archivedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly progress: GoalProgress;
  readonly required: GoalRequired;
  readonly pace: GoalPace;
  readonly expectedDate: GoalExpectedDate;
  readonly tracking: GoalTracking;
  /** Alguna cuenta vinculada tiene más reservado que su saldo. */
  readonly overAllocated: boolean;
  readonly linkedAccounts: readonly GoalLinkedAccount[];
  readonly plan: GoalPlan | null;
}

export interface GoalMeta {
  readonly ratesUsed: readonly ResolvedRate[];
  readonly rateWindowDays: number;
  readonly asOf: string;
  /** Hoy en la zona del workspace. */
  readonly today: string;
}

export interface GoalDetail extends Goal {
  readonly meta: GoalMeta;
}

export interface GoalList {
  readonly data: readonly Goal[];
  readonly meta: GoalMeta;
}

export interface GoalMovement {
  readonly id: string;
  readonly goalId: string;
  readonly fund: GoalFund;
  readonly movement: GoalMovementKind;
  /** Con signo y en la moneda de la cuenta. */
  readonly amount: Money;
  readonly accountId: string;
  readonly occurredOn: string;
  readonly transactionId: string | null;
  readonly transactionRevision: number | null;
  readonly reversesId: string | null;
  readonly reassignmentId: string | null;
  readonly origin: GoalMovementOrigin;
  readonly note: string | null;
  readonly recordedAt: string;
  readonly recordedBy: string;
}

export interface GoalMovementPage {
  readonly data: readonly GoalMovement[];
  readonly page: { readonly limit: number; readonly hasMore: boolean; readonly nextCursor: string | null };
}

export interface GoalReassignmentResult {
  readonly reassignmentId: string;
  readonly source: GoalMovement;
  readonly target: GoalMovement;
}

export interface GoalSimulation {
  readonly requiredMonthly: Money | null;
  readonly periods: number | null;
  readonly overdue: boolean;
  readonly expectedDate: GoalExpectedDate;
  readonly tracking: GoalTracking;
  readonly progress: GoalProgress;
  readonly pace: GoalPace;
}

export interface AccountReservationGoal {
  readonly goalId: string;
  readonly name: string;
  readonly status: GoalStatus;
  readonly earmarked: string;
  readonly realHeld: string;
}

export interface AccountReservation {
  readonly accountId: string;
  readonly accountName: string;
  readonly currency: string;
  readonly balance: string;
  readonly reserved: string;
  /** `balance − reserved`; negativo si la cuenta está sobre-asignada. */
  readonly available: string;
  readonly overAllocated: boolean;
  readonly shortfall: string | null;
  /** Inicio del episodio de sobre-asignación vigente. */
  readonly since: string | null;
  readonly accountStatus: 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
  readonly goals: readonly AccountReservationGoal[];
}

export interface AccountReservationList {
  readonly data: readonly AccountReservation[];
}

export interface GoalContributionSuggestion {
  readonly id: string;
  readonly transactionId: string;
  readonly transactionRevision: number;
  readonly accountId: string;
  readonly amount: Money;
  readonly businessDate: string;
  readonly goalId: string | null;
  readonly status: GoalSuggestionStatus;
  readonly decidedAt: string | null;
  readonly movementId: string | null;
  readonly createdAt: string;
}

export interface GoalSuggestionList {
  readonly data: readonly GoalContributionSuggestion[];
  readonly pendingCount: number;
}

export interface GoalTransactionLinkItem {
  readonly goalId: string;
  readonly goalName: string;
  readonly movementId: string;
  readonly movement: GoalMovementKind;
  readonly fund: GoalFund;
  readonly amount: Money;
  readonly reversesId: string | null;
  /** `false` una vez que un inverso cancela el movimiento. */
  readonly active: boolean;
}

export interface GoalTransactionLink {
  readonly transactionId: string;
  readonly links: readonly GoalTransactionLinkItem[];
}

/** Bloque Q9 del resumen del Home (`ReportSummary.goals`). */
export interface GoalHomeItem {
  readonly goalId: string;
  readonly name: string;
  readonly priority: number;
  readonly percent: string;
  readonly progress: Money;
  readonly target: Money;
  readonly tracking: GoalTracking;
  readonly lifecycleStatus: GoalStatus;
  readonly requiredMonthly: Money | null;
  readonly overdue: boolean;
  readonly expectedDate: string | null;
  readonly overAllocated: boolean;
  readonly complete: boolean;
}

export interface GoalsHomeBlock {
  readonly status: 'AVAILABLE' | 'NO_DATA';
  readonly action: 'CREATE_GOAL' | null;
  readonly items: readonly GoalHomeItem[];
  readonly moreCount: number;
  readonly complete: boolean;
  readonly ratesUsed: readonly ResolvedRate[];
}

/** Aportes netos a metas (aportes − retiros, sin reasignaciones) en moneda nativa y consolidados. */
export interface GoalContributionsNet {
  readonly native: readonly Money[];
  readonly base: Money | null;
  readonly complete: boolean;
}

/** Sección de solo lectura del plan (`Budget.goalContributions`). */
export interface BudgetGoalContributions {
  readonly items: readonly {
    readonly goalId: string;
    readonly name: string;
    readonly planned: Money;
    readonly contributed: Money;
    readonly pending: Money;
    readonly exceededBy: Money;
  }[];
  readonly pendingTotal: GoalContributionsNet;
}
