import type { ResolvedRateDto } from '@pf/fx/contracts';
import type { Money } from '@pf/shared-kernel';
import type { MoneyDto } from '../contracts/index.js';
import type {
  ExpectedDate,
  GoalProgress,
  GoalState,
  GoalTracking,
  RequiredContribution,
} from '../domain/index.js';
import type { MovementRow, PlanRecord, SuggestionRecord } from './ports/index.js';

/** Vistas de lectura de GOALS (respuestas de la API y base de las consultas públicas). */

export const moneyDto = (m: Money): MoneyDto => ({ amount: m.toFixed(), currency: m.currency.code });

export interface GoalProgressView {
  readonly byCurrency: readonly MoneyDto[];
  /** Saldo acumulado convertido a la moneda del objetivo (parte convertida). */
  readonly total: MoneyDto;
  readonly percent: string;
  readonly remaining: MoneyDto;
  readonly complete: boolean;
  /** Fondos sin tasa vigente, en su moneda (nunca se convierten a 1:1). */
  readonly unconverted: readonly MoneyDto[];
}

export interface GoalRequiredView {
  readonly monthly: MoneyDto | null;
  readonly periods: number | null;
  readonly overdue: boolean;
}

export interface GoalPaceView {
  readonly amount: MoneyDto | null;
  readonly periods: number;
  readonly source: 'HISTORY' | 'PLAN' | 'SIMULATED' | 'NONE';
  readonly complete: boolean;
}

export interface GoalTrackingView {
  readonly status: 'BEHIND' | 'ON_TRACK' | 'AHEAD' | null;
  readonly lifecycleStatus: GoalState['status'];
  readonly expected: MoneyDto | null;
  readonly deviationPercent: string | null;
}

export interface GoalExpectedDateView {
  /** `null` sin ritmo suficiente (`reason = NO_PACE`). */
  readonly date: string | null;
  readonly reason: 'NO_PACE' | 'BEYOND_HORIZON' | null;
}

export interface GoalPlanView {
  readonly monthlyAmount: MoneyDto;
  readonly fund: 'REAL' | 'EARMARK';
  readonly sourceAccountId: string | null;
  readonly destinationAccountId: string | null;
  readonly dayOfMonth: number | null;
  readonly automation: 'NONE' | 'RECURRING';
  readonly materialization: {
    readonly mode: 'PENDING_APPROVAL' | 'AUTO_CREATE';
    readonly autoCreateStatus: 'PENDING' | 'POSTED' | null;
  } | null;
  readonly definitionId: string | null;
  /** Hay aportes recurrentes materializados esperando su transferencia posteada ("aporte en proceso"). */
  readonly pendingContribution: boolean;
  readonly version: number;
}

export interface LinkedAccountView {
  readonly accountId: string;
  readonly funds: { readonly real: MoneyDto; readonly earmark: MoneyDto };
  readonly overAllocated: boolean;
}

/** Fondos negativos de una cuenta de la meta (faltante a regularizar tras anular un aporte con retiros posteriores). */
export interface NegativeFundsView {
  readonly accountId: string;
  /** Monto negativo (por ejemplo `-400.00`) del fondo real de la cuenta. */
  readonly amount: MoneyDto;
}

export interface GoalView {
  readonly id: string;
  readonly name: string;
  readonly type: GoalState['type'];
  readonly target: MoneyDto;
  readonly startDate: string;
  readonly targetDate: string | null;
  readonly linkedAccountIds: readonly string[];
  readonly priority: number;
  readonly icon: string | null;
  readonly color: string | null;
  readonly notes: string | null;
  readonly tolerancePercent: string;
  readonly pacePeriods: number;
  readonly status: GoalState['status'];
  readonly achievedOn: string | null;
  readonly closedOn: string | null;
  readonly cancelledOn: string | null;
  readonly cancelReason: string | null;
  readonly archivedAt: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly progress: GoalProgressView;
  readonly required: GoalRequiredView;
  readonly pace: GoalPaceView;
  readonly expectedDate: GoalExpectedDateView;
  readonly tracking: GoalTrackingView;
  readonly overAllocated: boolean;
  readonly linkedAccounts: readonly LinkedAccountView[];
  /** Cuentas donde el fondo real de la meta está en negativo; vacío si ninguna (fix-phase-4-gaps). */
  readonly negativeFunds: readonly NegativeFundsView[];
  readonly plan: GoalPlanView | null;
}

export interface GoalsMeta {
  readonly ratesUsed: readonly ResolvedRateDto[];
  readonly rateWindowDays: number;
  readonly asOf: string;
  readonly today: string;
}

export interface GoalDetail extends GoalView {
  readonly meta: GoalsMeta;
}

export interface GoalMovementView {
  readonly id: string;
  readonly goalId: string;
  readonly fund: 'REAL' | 'EARMARK';
  readonly movement: MovementRow['kind'];
  readonly amount: MoneyDto;
  readonly accountId: string;
  readonly occurredOn: string;
  readonly transactionId: string | null;
  readonly transactionRevision: number | null;
  readonly reversesId: string | null;
  readonly reassignmentId: string | null;
  readonly origin: MovementRow['origin'];
  readonly note: string | null;
  readonly recordedAt: string;
  readonly recordedBy: string;
}

/** Vista previa de anular una transacción (`PreviewTransactionVoidImpact`): sin efectos. */
export interface VoidImpactView {
  readonly transactionId: string;
  readonly goals: readonly {
    readonly goalId: string;
    readonly goalName: string;
    readonly accountId: string;
    readonly accountName: string;
    readonly fund: 'REAL' | 'EARMARK';
    readonly currency: string;
    readonly currentFunds: MoneyDto;
    readonly fundsAfterVoid: MoneyDto;
    readonly negative: boolean;
  }[];
}

export interface GoalSimulationView {
  readonly requiredMonthly: MoneyDto | null;
  readonly periods: number | null;
  readonly overdue: boolean;
  readonly expectedDate: GoalExpectedDateView;
  readonly tracking: GoalTrackingView;
  readonly progress: GoalProgressView;
  readonly pace: GoalPaceView;
}

export interface AccountReservationView {
  readonly accountId: string;
  readonly accountName: string;
  readonly currency: string;
  readonly balance: string;
  readonly reserved: string;
  readonly available: string;
  readonly overAllocated: boolean;
  readonly shortfall: string | null;
  readonly since: string | null;
  readonly accountStatus: 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
  readonly goals: readonly {
    readonly goalId: string;
    readonly name: string;
    readonly status: GoalState['status'];
    readonly earmarked: string;
    readonly realHeld: string;
  }[];
}

export interface SuggestionView {
  readonly id: string;
  readonly transactionId: string;
  readonly transactionRevision: number;
  readonly accountId: string;
  readonly amount: MoneyDto;
  readonly businessDate: string;
  readonly goalId: string | null;
  readonly status: SuggestionRecord['status'];
  readonly decidedAt: string | null;
  readonly movementId: string | null;
  readonly createdAt: string;
}

export interface GoalTransactionLinkView {
  readonly transactionId: string;
  readonly links: readonly {
    readonly goalId: string;
    readonly goalName: string;
    readonly movementId: string;
    readonly movement: MovementRow['kind'];
    readonly fund: 'REAL' | 'EARMARK';
    readonly amount: MoneyDto;
    readonly reversesId: string | null;
    readonly active: boolean;
  }[];
}

// ───────────────────────────────────────────── conversiones

export function progressView(p: GoalProgress): GoalProgressView {
  return {
    byCurrency: p.byCurrency.map(moneyDto),
    total: moneyDto(p.total),
    percent: p.percent,
    remaining: moneyDto(p.remaining),
    complete: p.complete,
    unconverted: p.unconverted.map(moneyDto),
  };
}

export const requiredView = (r: RequiredContribution): GoalRequiredView => ({
  monthly: r.monthly ? moneyDto(r.monthly) : null,
  periods: r.periods,
  overdue: r.overdue,
});

export const paceView = (e: ExpectedDate): GoalPaceView => ({
  amount: e.pace ? moneyDto(e.pace) : null,
  periods: e.periods,
  source: e.source,
  complete: e.complete,
});

export const expectedDateView = (e: ExpectedDate): GoalExpectedDateView => ({
  date: e.date ? e.date.toString() : null,
  reason: e.reason,
});

export const trackingView = (t: GoalTracking): GoalTrackingView => ({
  status: t.status,
  lifecycleStatus: t.lifecycleStatus,
  expected: t.expected ? moneyDto(t.expected) : null,
  deviationPercent: t.deviationPercent,
});

export function planView(plan: PlanRecord, pendingContribution: boolean): GoalPlanView {
  return {
    monthlyAmount: { amount: plan.monthlyAmount, currency: plan.currency },
    fund: plan.fund,
    sourceAccountId: plan.sourceAccountId,
    destinationAccountId: plan.destinationAccountId,
    dayOfMonth: plan.dayOfMonth,
    automation: plan.automation,
    materialization: plan.materializationMode
      ? { mode: plan.materializationMode, autoCreateStatus: plan.autoCreateStatus }
      : null,
    definitionId: plan.definitionId,
    pendingContribution,
    version: plan.version,
  };
}

export function movementView(m: MovementRow): GoalMovementView {
  return {
    id: m.id,
    goalId: m.goalId,
    fund: m.fund,
    movement: m.kind,
    amount: moneyDto(m.amount),
    accountId: m.accountId,
    occurredOn: m.occurredOn,
    transactionId: m.transactionId,
    transactionRevision: m.transactionRevision,
    reversesId: m.reversesId,
    reassignmentId: m.reassignmentId,
    origin: m.origin,
    note: m.note,
    recordedAt: m.recordedAt,
    recordedBy: m.recordedBy,
  };
}

export function suggestionView(s: SuggestionRecord): SuggestionView {
  return {
    id: s.id,
    transactionId: s.transactionId,
    transactionRevision: s.transactionRevision,
    accountId: s.accountId,
    amount: moneyDto(s.amount),
    businessDate: s.businessDate,
    goalId: s.goalId,
    status: s.status,
    decidedAt: s.decidedAt,
    movementId: s.movementId,
    createdAt: s.createdAt,
  };
}
