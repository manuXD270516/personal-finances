/**
 * API pública de `@pf/goals` (openspec add-savings-goals § Contratos; ADR-0003). Hoja: no importa capas internas.
 * Montos como `{amount: "<decimal>", currency: "<código>"}` (nunca `number`, ADR-0006).
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';
import type { ResolvedRateDto } from '@pf/fx/contracts';

export const GOALS_CONTEXT = 'goals' as const;

/** Eventos publicados por el outbox (contracts/events/goals/*.v1.schema.json). */
export const GOALS_EVENTS = {
  savingsContributionRecorded: { eventType: 'goals.SavingsContributionRecorded', eventVersion: 1 },
  goalReached: { eventType: 'goals.GoalReached', eventVersion: 1 },
  earmarkExceedsBalance: { eventType: 'goals.EarmarkExceedsBalance', eventVersion: 1 },
} as const;

/** Consumidores del worker (colas propias, lotes de improve-event-throughput). */
export const GOALS_CONSUMERS = {
  /** `TransactionVoided`, `TransferRevised`, `TransactionUpdated` ⇒ movimientos inversos (decisión 8). */
  transactionChanges: 'goals.transaction-changes',
  /** `JournalEntryPosted` ⇒ sobre-asignación por episodio (decisión 6). */
  balanceWatch: 'goals.balance-watch',
  /** `RecurringOccurrenceMaterialized` con `managedBy = GOAL` ⇒ aporte real recurrente (decisión 18). */
  recurringContributions: 'goals.recurring-contributions',
  /** `TransferCompleted` ⇒ sugerencias de aporte y espera de aportes recurrentes (decisiones 18 y 19). */
  contributionSuggestions: 'goals.contribution-suggestions',
} as const;

/** Job periódico: reevaluación diaria de metas multi-moneda y barrido de sobre-asignación (decisiones 6 y 15). */
export const GOALS_DAILY_JOB = 'goals.daily-evaluation' as const;

export interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
}

export type GoalTypeDto = 'EMERGENCY_FUND' | 'PURCHASE' | 'TRAVEL' | 'EDUCATION' | 'RETIREMENT' | 'CUSTOM';
export type GoalStatusDto = 'ACTIVE' | 'PAUSED' | 'ACHIEVED' | 'CLOSED' | 'CANCELLED';
export type GoalFundDto = 'REAL' | 'EARMARK';
export type GoalMovementKindDto = 'CONTRIBUTION' | 'WITHDRAWAL' | 'REVERSAL' | 'REASSIGN_IN' | 'REASSIGN_OUT';
export type GoalMovementOriginDto = 'USER' | 'RECURRING' | 'SUGGESTION' | 'SYSTEM';
export type GoalTrackingStatusDto = 'BEHIND' | 'ON_TRACK' | 'AHEAD';
export type GoalReachedTriggerDto = 'MOVEMENT' | 'TARGET_CHANGE' | 'RATE_CHANGE';

// ───────────────────────────────────────────── eventos (payloads)

/** `goals.SavingsContributionRecorded.v1`: un hecho por movimiento (también inversos y reasignaciones). */
export interface SavingsContributionRecordedV1 {
  readonly goalId: string;
  readonly goalName: string;
  readonly goalStatus: GoalStatusDto;
  readonly movementId: string;
  readonly fund: GoalFundDto;
  readonly movement: GoalMovementKindDto;
  /** Firmado, en la moneda de la cuenta. */
  readonly amount: MoneyDto;
  readonly accountId: string;
  readonly occurredOn: string;
  readonly transactionId: string | null;
  readonly reversesId: string | null;
  readonly reassignmentId: string | null;
  readonly origin: GoalMovementOriginDto;
  readonly target: MoneyDto;
  readonly progressBefore: MoneyDto;
  readonly progressAfter: MoneyDto;
  /** Porcentaje con 2 decimales (HALF_EVEN), puede superar 100. */
  readonly percentBefore: string;
  readonly percentAfter: string;
  /** `false` si algún fondo quedó sin convertir por falta de tasa (nunca hay hitos con progreso incompleto). */
  readonly progressComplete: boolean;
}

/** `goals.GoalReached.v1`: una vez por cada vez que la meta alcanza su objetivo. */
export interface GoalReachedV1 {
  readonly goalId: string;
  readonly goalName: string;
  readonly target: MoneyDto;
  readonly progress: MoneyDto;
  readonly reachedOn: string;
  readonly trigger: GoalReachedTriggerDto;
}

/** `goals.EarmarkExceedsBalance.v1`: una vez por episodio de sobre-asignación de una cuenta. */
export interface EarmarkExceedsBalanceV1 {
  readonly accountId: string;
  readonly accountName: string;
  readonly episodeId: string;
  readonly balance: MoneyDto;
  readonly reserved: MoneyDto;
  readonly shortfall: MoneyDto;
  readonly detectedOn: string;
  readonly goals: readonly {
    readonly goalId: string;
    readonly goalName: string;
    readonly reserved: MoneyDto;
  }[];
}

// ───────────────────────────────────────────── consultas públicas

/** Reservado de una cuenta por metas `ACTIVE`, `PAUSED` o `ACHIEVED` (base de Q5, `add-spendable-amount`). */
export interface AccountReservationDto {
  readonly accountId: string;
  readonly currency: string;
  /** Reservas vigentes + aportes reales netos que siguen en la cuenta. */
  readonly reserved: string;
  readonly earmarked: string;
  readonly realHeld: string;
  readonly overAllocated: boolean;
}

export interface GoalReservationsQuery {
  /** Sin `accountIds`, todas las cuentas con fondos de metas. Montos a la escala de la moneda de la cuenta. */
  getReservedByAccount(input: {
    readonly workspaceId: string;
    readonly accountIds?: readonly string[];
  }): Promise<readonly AccountReservationDto[]>;
}

/** Aporte planificado de una meta en un rango (moneda del objetivo). */
export interface GoalPlanPeriodDto {
  readonly goalId: string;
  readonly goalName: string;
  readonly currency: string;
  readonly planned: string;
  /** Aportado neto en el rango (sin reasignaciones), valorado con `FlowValuation` a la moneda del objetivo. */
  readonly contributed: string;
  /** `max(0, planned − contributed)`. */
  readonly pending: string;
  readonly exceededBy: string;
  readonly automation: 'NONE' | 'RECURRING';
  readonly definitionId: string | null;
  /** `false` si algún movimiento en otra moneda quedó sin tasa (queda fuera de `contributed`). */
  readonly complete: boolean;
}

export interface GoalPlansQuery {
  /** Solo metas `ACTIVE` con plan (las pausadas, alcanzadas, cerradas o canceladas no tienen pendiente). */
  getForPeriod(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<readonly GoalPlanPeriodDto[]>;
}

export interface GoalTrackingDto {
  /** `null` si no aplica (sin fecha objetivo o meta que no está `ACTIVE`). */
  readonly status: GoalTrackingStatusDto | null;
  /** Estado de ciclo de vida de la meta (informado cuando no hay estado de avance). */
  readonly lifecycleStatus: GoalStatusDto;
  readonly expected: MoneyDto | null;
  /** Porcentaje con 2 decimales (signo incluido), `null` si no aplica. */
  readonly deviationPercent: string | null;
}

export interface GoalHomeItemDto {
  readonly goalId: string;
  readonly name: string;
  readonly priority: number;
  readonly percent: string;
  readonly progress: MoneyDto;
  readonly target: MoneyDto;
  readonly tracking: GoalTrackingDto;
  readonly lifecycleStatus: GoalStatusDto;
  readonly requiredMonthly: MoneyDto | null;
  readonly overdue: boolean;
  readonly expectedDate: string | null;
  readonly overAllocated: boolean;
  /** `false` si el progreso tiene fondos sin convertir. */
  readonly complete: boolean;
}

export interface GoalHomeSummaryDto {
  /** Hasta `limit` metas por prioridad, fecha objetivo (sin fecha al final) y nombre. */
  readonly items: readonly GoalHomeItemDto[];
  readonly moreCount: number;
  /** Cantidad de metas `ACTIVE`, `PAUSED` o `ACHIEVED` no archivadas. */
  readonly goalCount: number;
  readonly ratesUsed: readonly ResolvedRateDto[];
}

export interface GoalSummaryQuery {
  listForHome(input: { readonly workspaceId: string; readonly limit: number }): Promise<GoalHomeSummaryDto>;
}

/** Flujo neto de metas por día de negocio y moneda (sin reasignaciones; aportes y reservas positivos). */
export interface GoalFlowDto {
  readonly date: string;
  readonly amount: MoneyDto;
}

export interface GoalFlowsQuery {
  netForRange(input: {
    readonly workspaceId: string;
    readonly from: string;
    readonly to: string;
  }): Promise<readonly GoalFlowDto[]>;
}

export const GOAL_RESERVATIONS_QUERY = Symbol.for('pf.goals.GoalReservationsQuery');
export const GOAL_PLANS_QUERY = Symbol.for('pf.goals.GoalPlansQuery');
export const GOAL_SUMMARY_QUERY = Symbol.for('pf.goals.GoalSummaryQuery');
export const GOAL_FLOWS_QUERY = Symbol.for('pf.goals.GoalFlowsQuery');

/**
 * Allow-list de auditoría de GOALS (add-audit-trail, NFR-SEC-015): montos exactos (`money`); los valores compuestos
 * (cuentas vinculadas) viajan como texto JSON. Notas y motivos son texto libre truncado por el escritor de auditoría.
 */
export const GOALS_AUDIT_POLICY = {
  SavingsGoal: {
    name: 'plain',
    type: 'plain',
    target: 'money',
    startDate: 'plain',
    targetDate: 'plain',
    priority: 'plain',
    icon: 'plain',
    color: 'plain',
    notes: 'plain',
    tolerancePercent: 'plain',
    pacePeriods: 'plain',
    status: 'plain',
    linkedAccountIds: 'plain',
    achievedOn: 'plain',
    closedOn: 'plain',
    cancelledOn: 'plain',
    reason: 'plain',
    archivedAt: 'plain',
    movementKind: 'plain',
    fund: 'plain',
    accountId: 'plain',
    amount: 'money',
    occurredOn: 'plain',
    transactionId: 'plain',
    reversesId: 'plain',
    reassignmentId: 'plain',
    origin: 'plain',
    note: 'plain',
    planMonthly: 'money',
    planFund: 'plain',
    planSourceAccountId: 'plain',
    planDestinationAccountId: 'plain',
    planDayOfMonth: 'plain',
    planAutomation: 'plain',
    planMaterialization: 'plain',
    planDefinitionId: 'plain',
  },
  AccountReservation: {
    state: 'plain',
    episodeId: 'plain',
    shortfall: 'money',
  },
  ContributionSuggestion: {
    transactionId: 'plain',
    goalId: 'plain',
    status: 'plain',
    amount: 'money',
  },
} as const satisfies AuditFieldPoliciesDto;

export * from './portability.js';
