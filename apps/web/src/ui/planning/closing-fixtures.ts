import type {
  CloseChecklist,
  CloseChecklistItem,
  CloseReport,
  CloseSnapshot,
  CloseSnapshotDiff,
  CloseSnapshotSummary,
  ClosingPolicy,
} from './closing-logic';

/** Fixtures de los tests de componentes del cierre de mes (octubre de 2026, BOB, escala 2). */
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const uuid = (n: number) => `0190c000-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const IDS = {
  period: uuid(1),
  previousPeriod: uuid(2),
  caja: uuid(10),
  banco: uuid(11),
  usd: uuid(12),
  tx1: uuid(20),
  tx2: uuid(21),
  snap1: uuid(30),
  snap2: uuid(31),
} as const;

export function item(
  over: Partial<CloseChecklistItem> & Pick<CloseChecklistItem, 'kind'>,
): CloseChecklistItem {
  return {
    severity: 'WARNING',
    availability: 'AVAILABLE',
    count: 0,
    amounts: [],
    details: [],
    truncated: false,
    ...over,
  };
}

export const PENDING_BLOCKING = item({
  kind: 'PENDING_TRANSACTIONS',
  severity: 'BLOCKING',
  count: 2,
  amounts: [bob('150.00'), { amount: '20.00', currency: 'USD' }],
  details: [
    {
      refType: 'TRANSACTION',
      refId: IDS.tx1,
      label: 'Almuerzo pendiente',
      date: '2026-10-28',
      amount: bob('90.00'),
    },
    {
      refType: 'TRANSACTION',
      refId: IDS.tx2,
      label: 'Taxi pendiente',
      date: '2026-10-30',
      amount: bob('60.00'),
    },
  ],
});

export const UNRECONCILED_BLOCKING = item({
  kind: 'UNRECONCILED_ACCOUNTS',
  severity: 'BLOCKING',
  count: 1,
  details: [{ refType: 'ACCOUNT', refId: IDS.caja, label: 'Caja BOB', date: null, amount: null }],
});

export const UNCATEGORIZED_WARNING = item({
  kind: 'UNCATEGORIZED',
  severity: 'WARNING',
  count: 3,
  amounts: [bob('300.00')],
  details: [
    {
      refType: 'TRANSACTION',
      refId: IDS.tx1,
      label: 'Compra sin categoría',
      date: '2026-10-12',
      amount: bob('300.00'),
    },
  ],
  truncated: true,
});

export const WITHOUT_STATEMENT_INFO = item({
  kind: 'RECONCILED_WITHOUT_STATEMENT',
  severity: 'INFO',
  count: 1,
  amounts: [bob('80.00')],
  details: [
    {
      refType: 'TRANSACTION',
      refId: IDS.tx2,
      label: 'Gasto de Caja BOB',
      date: '2026-10-15',
      amount: bob('80.00'),
    },
  ],
});

export const RECURRING_NA = item({
  kind: 'UNRESOLVED_RECURRING',
  severity: 'WARNING',
  availability: 'NOT_AVAILABLE',
});

export const CLEAN_DUPLICATES = item({ kind: 'UNRESOLVED_DUPLICATES', severity: 'WARNING' });

export function checklist(
  items: readonly CloseChecklistItem[],
  over: Partial<CloseChecklist> = {},
): CloseChecklist {
  const blocking = items.some(
    (i) => i.availability === 'AVAILABLE' && i.severity === 'BLOCKING' && i.count > 0,
  );
  const warnings = items.some(
    (i) => i.availability === 'AVAILABLE' && i.severity === 'WARNING' && i.count > 0,
  );
  return {
    periodId: IDS.period,
    label: '2026-10',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    evaluatedAt: '2026-11-03T16:00:00.000Z',
    canClose: !blocking,
    requiresAcknowledgement: !blocking && warnings,
    items,
    ...over,
  };
}

export const POLICY: ClosingPolicy = {
  severities: {
    PENDING_TRANSACTIONS: 'BLOCKING',
    UNRECONCILED_ACCOUNTS: 'BLOCKING',
    UNRESOLVED_DUPLICATES: 'WARNING',
    UNCATEGORIZED: 'WARNING',
    UNRESOLVED_RECURRING: 'WARNING',
  },
  version: 1,
  updatedAt: null,
  updatedBy: null,
};

export const SUMMARY_1: CloseSnapshotSummary = {
  snapshotId: IDS.snap1,
  closeNo: 1,
  closedAt: '2026-11-03T16:30:00.000Z',
  closedBy: uuid(90),
  previousSnapshotId: null,
  isCurrent: false,
};
export const SUMMARY_2: CloseSnapshotSummary = {
  snapshotId: IDS.snap2,
  closeNo: 2,
  closedAt: '2026-11-04T12:00:00.000Z',
  closedBy: uuid(90),
  previousSnapshotId: IDS.snap1,
  isCurrent: true,
};

export function snapshot(over: Partial<CloseSnapshot> = {}): CloseSnapshot {
  return {
    ...SUMMARY_2,
    periodId: IDS.period,
    label: '2026-10',
    periodStart: '2026-10-01',
    periodEnd: '2026-10-31',
    baseCurrency: 'BOB',
    balances: [
      {
        accountId: IDS.banco,
        accountName: 'Banco BOB',
        ledgerAccountId: uuid(40),
        currency: 'BOB',
        balance: bob('4880.00'),
        presented: bob('4880.00'),
        reconciliation: {
          reconciliationId: uuid(50),
          statementDate: '2026-10-31',
          statementBalance: bob('4880.00'),
        },
        reconciliationBasis: 'STATEMENT',
        reconciledWithoutStatementTransactionIds: [],
      },
      {
        accountId: IDS.caja,
        accountName: 'Caja BOB',
        ledgerAccountId: uuid(41),
        currency: 'BOB',
        balance: bob('420.00'),
        presented: bob('420.00'),
        reconciliation: null,
        reconciliationBasis: 'WITHOUT_STATEMENT',
        reconciledWithoutStatementTransactionIds: [IDS.tx2],
      },
      {
        accountId: IDS.usd,
        accountName: 'Ahorro USD',
        ledgerAccountId: uuid(42),
        currency: 'USD',
        balance: { amount: '100.00', currency: 'USD' },
        presented: { amount: '100.00', currency: 'USD' },
        reconciliation: null,
        reconciliationBasis: null,
        reconciledWithoutStatementTransactionIds: [],
      },
    ],
    reconciledWithoutStatement: [
      { transactionId: IDS.tx2, accountId: IDS.caja, businessDate: '2026-10-15', amount: bob('80.00') },
    ],
    flows: {
      byCurrency: [
        { currency: 'BOB', income: bob('6500.00'), expense: bob('1620.00'), savings: bob('4880.00') },
      ],
      consolidated: {
        currency: 'BOB',
        income: bob('6500.00'),
        expense: bob('1620.00'),
        savings: bob('4880.00'),
        savingsRate: '75.1',
        complete: true,
        unconverted: [],
      },
    },
    netWorth: {
      amount: bob('5300.00'),
      assets: bob('5300.00'),
      liabilities: bob('0.00'),
      complete: true,
      unconverted: [],
      rates: [],
    },
    budgetVsActual: null,
    goalContributions: null,
    checklist: [WITHOUT_STATEMENT_INFO],
    acknowledgedWarnings: { items: ['UNCATEGORIZED'], by: uuid(90), at: '2026-11-04T12:00:00.000Z' },
    ...over,
  };
}

export function report(over: Partial<CloseReport> = {}): CloseReport {
  return {
    snapshot: snapshot(),
    versions: [SUMMARY_1, SUMMARY_2],
    comparison: {
      previousPeriodId: IDS.previousPeriod,
      previousLabel: '2026-09',
      previousCloseNo: 1,
      deltas: [
        { kpi: 'INCOME', absolute: bob('500.00'), percentage: '8.3' },
        { kpi: 'EXPENSE', absolute: bob('-120.00'), percentage: '-6.9' },
        { kpi: 'SAVINGS', absolute: bob('620.00'), percentage: '14.5' },
        { kpi: 'SAVINGS_RATE', absolute: '4.2', percentage: null },
        { kpi: 'NET_WORTH', absolute: bob('620.00'), percentage: null },
      ],
    },
    comparisonUnavailableReason: null,
    ...over,
  };
}

export const DIFF: CloseSnapshotDiff = {
  from: 1,
  to: 2,
  balances: [{ accountId: IDS.caja, currency: 'BOB', delta: bob('-15.00') }],
  flows: {
    byCurrency: [{ currency: 'BOB', income: bob('0.00'), expense: bob('15.00'), savings: bob('-15.00') }],
    consolidated: { income: bob('0.00'), expense: bob('15.00'), savings: bob('-15.00') },
  },
  netWorth: { delta: bob('-15.00') },
};
