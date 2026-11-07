import type {
  ConversionsReportDto,
  DebtsReportDto,
  ExpensesByAccountReportDto,
  ExpensesByTagReportDto,
  FeesReportDto,
  GoalsReportDto,
  RecurringCostsReportDto,
  ReportAmountDto,
  SubscriptionsReportDto,
  TrendsReportDto,
} from '../contracts/financial-reports.js';

type Cell = string | number | boolean | null;
export type CsvLines = Cell[][];

/** Filas NATIVE (una por moneda) y CONSOLIDATED de una cifra, con el prefijo de columnas de su dimensión. */
function amountRows(
  head: readonly Cell[],
  a: ReportAmountDto,
  policy: string,
  reporting: string,
  extra: readonly Cell[] = [],
): CsvLines {
  return [
    ...a.byCurrency.map((m): Cell[] => [
      ...head,
      'NATIVE',
      m.currency,
      m.amount,
      ...extra,
      policy,
      reporting,
      true,
    ]),
    [
      ...head,
      'CONSOLIDATED',
      a.consolidated.currency,
      a.consolidated.amount,
      ...extra,
      policy,
      reporting,
      a.complete,
    ],
  ];
}

const TAIL = ['row_kind', 'currency', 'amount'] as const;
const END = ['conversion_policy', 'reporting_currency', 'complete'] as const;

export function expensesByTagLines(r: ExpensesByTagReportDto): CsvLines {
  const policy = r.meta.conversion.policy;
  const rep = r.meta.reportingCurrency;
  return [
    ['tag', 'archived', 'tag_match', ...TAIL, ...END],
    ...r.tags.flatMap((t) => amountRows([t.name, t.archived, r.tagMatch], t.amount, policy, rep)),
  ];
}

export function expensesByAccountLines(r: ExpensesByAccountReportDto): CsvLines {
  const policy = r.meta.conversion.policy;
  const rep = r.meta.reportingCurrency;
  return [
    ['account', 'account_type', 'institution_id', 'category', ...TAIL, ...END],
    ...r.accounts.flatMap((a) => [
      ...amountRows([a.name, a.type, a.institutionId, ''], a.amount, policy, rep),
      ...a.byCategory.flatMap((c) =>
        amountRows([a.name, a.type, a.institutionId, c.name], c.amount, policy, rep),
      ),
    ]),
    ...amountRows(['', '', '', ''], r.total, policy, rep),
  ];
}

export function trendsLines(r: TrendsReportDto): CsvLines {
  const policy = r.meta.conversion.policy;
  const rep = r.meta.reportingCurrency;
  return [
    ['category', 'period_label', 'period_from', 'period_to', 'normalized', ...TAIL, ...END],
    ...r.series.flatMap((s) =>
      s.cells.flatMap((c) =>
        amountRows([s.name, c.period.label, c.period.from, c.period.to, r.normalized], c.amount, policy, rep),
      ),
    ),
  ];
}

export function feesLines(r: FeesReportDto): CsvLines {
  const policy = r.meta.conversion.policy;
  const rep = r.meta.reportingCurrency;
  return [
    ['period_label', 'period_from', 'period_to', 'fee_type', ...TAIL, ...END],
    ...r.months.flatMap((m) => {
      const head = [m.period.label, m.period.from, m.period.to];
      return [
        ...m.byType.flatMap((b) => amountRows([...head, b.type], b.amount, policy, rep)),
        ...amountRows([...head, 'TOTAL'], m.total, policy, rep),
      ];
    }),
    ...amountRows(['', '', '', 'LAST_12_MONTHS'], r.last12Months, policy, rep),
  ];
}

export function goalsLines(r: GoalsReportDto): CsvLines {
  return [
    [
      'goal',
      'month',
      'month_end',
      'currency',
      'contributions',
      'withdrawals',
      'accumulated',
      'percent',
      'expected',
      'status',
      'target',
      'complete',
    ],
    ...r.goals.flatMap((g) =>
      g.months.map((m): Cell[] => [
        g.name,
        m.period,
        m.monthEnd,
        g.currency,
        m.contributions.amount,
        m.withdrawals.amount,
        m.accumulated.amount,
        m.percent,
        m.expected?.amount ?? null,
        m.status,
        g.target.amount,
        m.complete,
      ]),
    ),
  ];
}

export function debtsLines(r: DebtsReportDto): CsvLines {
  const policy = r.meta.conversion.policy;
  const rep = r.meta.reportingCurrency;
  return [
    [
      'debt',
      'kind',
      'period_label',
      'period_from',
      'period_to',
      'row_kind',
      'currency',
      'outstanding',
      'principal_paid',
      'interest_paid',
      'charges_paid',
      'conversion_policy',
      'reporting_currency',
      'complete',
    ],
    ...r.debts.flatMap((d) =>
      d.months.map((m): Cell[] => [
        d.name,
        d.kind,
        m.period.label,
        m.period.from,
        m.period.to,
        'NATIVE',
        d.currency,
        m.outstanding.amount,
        m.principalPaid?.amount ?? null,
        m.interestPaid?.amount ?? null,
        m.chargesPaid?.amount ?? null,
        policy,
        rep,
        true,
      ]),
    ),
    ...r.consolidated.map((c): Cell[] => [
      '',
      '',
      c.period.label,
      c.period.from,
      c.period.to,
      'CONSOLIDATED',
      c.outstanding.consolidated.currency,
      c.outstanding.consolidated.amount,
      c.principalPaid.consolidated.amount,
      c.interestPaid.consolidated.amount,
      null,
      policy,
      rep,
      c.outstanding.complete && c.principalPaid.complete && c.interestPaid.complete,
    ]),
  ];
}

export function recurringCostsLines(r: RecurringCostsReportDto): CsvLines {
  const policy = r.meta.conversion.policy;
  const rep = r.meta.reportingCurrency;
  return [
    [
      'commitment',
      'cadence',
      'interval',
      'variable',
      'currency',
      'monthly',
      'annual',
      'monthly_reporting',
      'conversion_policy',
      'reporting_currency',
    ],
    ...r.items.map((i): Cell[] => [
      i.name,
      i.cadence,
      i.interval,
      i.variable,
      i.monthly?.currency ?? null,
      i.monthly?.amount ?? null,
      i.annual?.amount ?? null,
      i.monthlyReporting?.amount ?? null,
      policy,
      rep,
    ]),
    [
      'TOTAL',
      '',
      null,
      false,
      r.totals.monthly.consolidated.currency,
      r.totals.monthly.consolidated.amount,
      r.totals.annual.consolidated.amount,
      r.totals.monthly.consolidated.amount,
      policy,
      rep,
    ],
  ];
}

export function subscriptionsLines(r: SubscriptionsReportDto): CsvLines {
  const policy = r.meta.conversion.policy;
  const rep = r.meta.reportingCurrency;
  return [
    ['period_label', 'period_from', 'period_to', 'active', ...TAIL, ...END],
    ...r.months.flatMap((m) =>
      amountRows([m.period.label, m.period.from, m.period.to, m.active], m.monthlyCost, policy, rep),
    ),
  ];
}

export function conversionsLines(r: ConversionsReportDto): CsvLines {
  return [
    [
      'row_kind',
      'date',
      'period_label',
      'transaction_id',
      'pair',
      'effective_rate',
      'reference_rate',
      'cost',
      'currency',
      'conversions',
      'excluded',
      'complete',
    ],
    ...r.points.map((p): Cell[] => [
      'POINT',
      p.date,
      '',
      p.transactionId,
      p.pair,
      p.effectiveRate,
      p.referenceRate,
      null,
      null,
      null,
      null,
      true,
    ]),
    ...r.months.map((m): Cell[] => [
      'MONTH',
      m.period.from,
      m.period.label,
      null,
      null,
      null,
      null,
      m.cost.amount,
      m.cost.currency,
      m.conversions,
      m.excluded,
      m.costComplete,
    ]),
  ];
}
