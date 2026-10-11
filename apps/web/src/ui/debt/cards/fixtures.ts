import type { CardAccount, CardFigures, CardStatement, CardUtilization, CreditCard } from './types';

/** Fixtures de tarjetas para los tests de lógica y de componentes (Visa Oro en BOB, límite 15.000,00 BOB). */
export const bob = (amount: string) => ({ amount, currency: 'BOB' });
export const usd = (amount: string) => ({ amount, currency: 'USD' });
export const opts = {
  locale: 'es-BO',
  scales: { BOB: 2, USD: 2 },
  accounts: [
    { id: 'acc-bob', currency: 'BOB' },
    { id: 'acc-usd', currency: 'USD' },
  ],
};

export const figures = (over: Partial<CardFigures> = {}): CardFigures => ({
  previousBalance: bob('0.00'),
  purchases: bob('1200.00'),
  refunds: bob('0.00'),
  payments: bob('0.00'),
  otherNet: bob('0.00'),
  closingBalance: bob('1200.00'),
  unbilledInstallments: bob('0.00'),
  billedBalance: bob('1200.00'),
  minimumDue: bob('60.00'),
  noInterestPayment: bob('1200.00'),
  creditBalance: bob('0.00'),
  ...over,
});

export const statement = (over: Partial<CardStatement> = {}): CardStatement => ({
  id: 'st-1',
  cardAccountId: 'ca-bob',
  accountId: 'acc-bob',
  currency: 'BOB',
  cycleStart: '2026-09-26',
  closingDate: '2026-10-25',
  dueDate: '2026-11-15',
  status: 'ISSUED',
  issuedAt: '2026-10-26T04:00:00Z',
  issued: figures(),
  current: figures(),
  difference: figures({
    purchases: bob('0.00'),
    closingBalance: bob('0.00'),
    billedBalance: bob('0.00'),
    minimumDue: bob('0.00'),
    noInterestPayment: bob('0.00'),
  }),
  reported: null,
  reportedDifference: null,
  noInterestPayment: bob('1200.00'),
  minimumDue: bob('60.00'),
  remainingNoInterest: bob('1200.00'),
  remainingMinimum: bob('60.00'),
  consistent: true,
  version: 2,
  ...over,
});

export const cardAccount = (over: Partial<CardAccount> = {}): CardAccount => ({
  id: 'ca-bob',
  accountId: 'acc-bob',
  currency: 'BOB',
  creditLimit: bob('15000.00'),
  minimumRule: { type: 'PERCENT', percent: '5.00', floor: bob('50.00') },
  balance: bob('4580.00'),
  pendingPurchases: bob('0.00'),
  creditUsed: bob('4580.00'),
  utilization: null,
  openCycle: statement({
    id: null,
    status: 'OPEN',
    issuedAt: null,
    issued: null,
    difference: null,
    version: null,
  }),
  lastStatement: statement(),
  nextDueDate: '2026-11-15',
  paymentPlan: null,
  ...over,
});

export const card = (over: Partial<CreditCard> = {}): CreditCard => ({
  id: 'card-1',
  name: 'Visa Oro',
  status: 'ACTIVE',
  statementDay: 25,
  dueDay: 15,
  dueWeekendAdjustment: 'NONE',
  annualRate: null,
  limitMode: 'SEPARATE',
  sharedLimit: null,
  utilizationThresholds: ['30.00', '80.00'],
  reminderDays: 3,
  accounts: [cardAccount()],
  utilization: [],
  version: 4,
  createdAt: '2026-10-01T10:00:00Z',
  updatedAt: '2026-10-01T10:00:00Z',
  ...over,
});

export const util = (over: Partial<CardUtilization> = {}): CardUtilization => ({
  scope: 'ACCOUNT',
  accountId: 'acc-bob',
  limit: bob('15000.00'),
  used: bob('4580.00'),
  available: bob('10420.00'),
  utilization: '30.53',
  overdrawn: false,
  missingRates: [],
  ...over,
});
