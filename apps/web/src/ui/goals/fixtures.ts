import type {
  AccountReservation,
  Goal,
  GoalContributionSuggestion,
  GoalHomeItem,
  GoalMovement,
  GoalPlan,
  GoalTracking,
  Money,
} from './types';

/** Datos ficticios de Metas (fechas fijas; America/La_Paz). */

export const bob = (amount: string): Money => ({ amount, currency: 'BOB' });
export const usd = (amount: string): Money => ({ amount, currency: 'USD' });

export const IDS = {
  emergency: '0198f0aa-0000-7000-8000-000000000001',
  trip: '0198f0aa-0000-7000-8000-000000000002',
  laptop: '0198f0aa-0000-7000-8000-000000000003',
  savings: '0198f0aa-0000-7000-8000-0000000000a1',
  bank: '0198f0aa-0000-7000-8000-0000000000a2',
  tx: '0198f0aa-0000-7000-8000-0000000000b1',
} as const;

export const tracking = (over: Partial<GoalTracking> = {}): GoalTracking => ({
  status: 'BEHIND',
  lifecycleStatus: 'ACTIVE',
  expected: bob('5000.00'),
  deviationPercent: '-6.00',
  ...over,
});

/** "Fondo de emergencia": 5000.00 de 15000.00 BOB (33,33 %), atrasada, 1666.67 al mes. */
export function goal(over: Partial<Goal> = {}): Goal {
  return {
    id: IDS.emergency,
    name: 'Fondo de emergencia',
    type: 'EMERGENCY_FUND',
    target: bob('15000.00'),
    startDate: '2026-10-01',
    targetDate: '2027-03-31',
    linkedAccountIds: [IDS.savings],
    priority: 1,
    icon: null,
    color: null,
    notes: null,
    tolerancePercent: '5.00',
    pacePeriods: 3,
    status: 'ACTIVE',
    achievedOn: null,
    closedOn: null,
    cancelledOn: null,
    cancelReason: null,
    archivedAt: null,
    version: 4,
    createdAt: '2026-10-01T12:00:00Z',
    updatedAt: '2026-10-05T12:00:00Z',
    progress: {
      byCurrency: [bob('5000.00')],
      total: bob('5000.00'),
      percent: '33.33',
      remaining: bob('10000.00'),
      complete: true,
      unconverted: [],
    },
    required: { monthly: bob('1666.67'), periods: 6, overdue: false },
    pace: { amount: bob('1000.00'), periods: 3, source: 'HISTORY', complete: true },
    expectedDate: { date: '2027-07-31', reason: null },
    tracking: tracking(),
    overAllocated: false,
    linkedAccounts: [
      { accountId: IDS.savings, funds: { real: bob('5000.00'), earmark: bob('0.00') }, overAllocated: false },
    ],
    plan: null,
    ...over,
  };
}

export const plan = (over: Partial<GoalPlan> = {}): GoalPlan => ({
  monthlyAmount: bob('1500.00'),
  fund: 'REAL',
  sourceAccountId: IDS.bank,
  destinationAccountId: IDS.savings,
  dayOfMonth: 5,
  automation: 'RECURRING',
  materialization: { mode: 'PENDING_APPROVAL', autoCreateStatus: null },
  definitionId: '0198f0aa-0000-7000-8000-0000000000d1',
  pendingContribution: false,
  version: 1,
  ...over,
});

export function movement(over: Partial<GoalMovement> = {}): GoalMovement {
  return {
    id: '0198f0aa-0000-7000-8000-0000000000c1',
    goalId: IDS.emergency,
    fund: 'REAL',
    movement: 'CONTRIBUTION',
    amount: bob('1000.00'),
    accountId: IDS.savings,
    occurredOn: '2026-10-05',
    transactionId: IDS.tx,
    transactionRevision: 1,
    reversesId: null,
    reassignmentId: null,
    origin: 'USER',
    note: null,
    recordedAt: '2026-10-05T12:00:00Z',
    recordedBy: '0198f0aa-0000-7000-8000-0000000000e1',
    ...over,
  };
}

export function reservation(over: Partial<AccountReservation> = {}): AccountReservation {
  return {
    accountId: IDS.savings,
    accountName: 'Ahorro BOB',
    currency: 'BOB',
    balance: '1000.00',
    reserved: '1500.00',
    available: '-500.00',
    overAllocated: true,
    shortfall: '500.00',
    since: '2026-10-08',
    accountStatus: 'ACTIVE',
    goals: [
      {
        goalId: IDS.emergency,
        name: 'Fondo de emergencia',
        status: 'ACTIVE',
        earmarked: '1000.00',
        realHeld: '0.00',
      },
      { goalId: IDS.laptop, name: 'Laptop', status: 'ACTIVE', earmarked: '500.00', realHeld: '0.00' },
    ],
    ...over,
  };
}

export function suggestion(over: Partial<GoalContributionSuggestion> = {}): GoalContributionSuggestion {
  return {
    id: '0198f0aa-0000-7000-8000-0000000000f1',
    transactionId: IDS.tx,
    transactionRevision: 1,
    accountId: IDS.savings,
    amount: bob('800.00'),
    businessDate: '2026-10-09',
    goalId: IDS.emergency,
    status: 'PENDING',
    decidedAt: null,
    movementId: null,
    createdAt: '2026-10-09T12:00:00Z',
    ...over,
  };
}

export function homeItem(over: Partial<GoalHomeItem> = {}): GoalHomeItem {
  return {
    goalId: IDS.emergency,
    name: 'Fondo de emergencia',
    priority: 1,
    percent: '33.33',
    progress: bob('5000.00'),
    target: bob('15000.00'),
    tracking: tracking(),
    lifecycleStatus: 'ACTIVE',
    requiredMonthly: bob('1666.67'),
    overdue: false,
    expectedDate: '2027-07-31',
    overAllocated: false,
    complete: true,
    ...over,
  };
}
