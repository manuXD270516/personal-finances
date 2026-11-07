import { currency, dec, Money, type ExactRate } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AccountSpendReport,
  ConversionScatter,
  DebtEvolutionSeries,
  FeeBreakdown,
  GoalProgressSeries,
  RecurringCostTable,
  SubscriptionCostSeries,
  TagReport,
  TrendMatrix,
} from './extended-reports.js';
import { ReportConversionPolicy } from './report-conversion.js';
import type { ReportPeriod } from './report-periods.js';
import { ReportReconciler } from './report-reconciler.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const bob = (v: string) => Money.parse(v, BOB);
const usd = (v: string) => Money.parse(v, USD);
const rates =
  (table: Record<string, string>) =>
  (code: string): ExactRate | null =>
    table[code] ? { base: code, quote: 'BOB', value: dec(table[code]) } : null;
const policy = (table: Record<string, string> = { USD: '10.00' }) =>
  ReportConversionPolicy.transactionDate(BOB, rates(table));
const period = (label: string, from: string, to: string, days: number): ReportPeriod => ({
  label,
  from,
  to,
  days,
  partial: false,
});

describe('TagReport', () => {
  const facts = [
    { date: '2026-10-05', amount: bob('800.00'), tagIds: ['viaje', 'trabajo'] },
    { date: '2026-10-06', amount: bob('200.00'), tagIds: ['viaje'] },
  ];
  const tags = [
    { tagId: 'viaje', name: 'Viaje Cusco', archived: false },
    { tagId: 'trabajo', name: 'Trabajo', archived: false },
  ];

  it('[TC-REPORTING-REPORTS-039] con cualquiera: Viaje Cusco 1000.00 y Trabajo 800.00 BOB con aviso de no aditividad', () => {
    const r = TagReport.build({ facts, tags, requested: [], match: 'ANY', policy: policy() });
    expect(r.nonAdditive).toBe(true);
    expect(r.tags.map((t) => [t.name, t.amount.consolidated.toFixed()])).toEqual([
      ['Viaje Cusco', '1000.00'],
      ['Trabajo', '800.00'],
    ]);
  });

  it('[TC-REPORTING-REPORTS-039] con todas las etiquetas pedidas solo cuenta la porción con ambas: 800.00 BOB', () => {
    const r = TagReport.build({
      facts,
      tags,
      requested: ['viaje', 'trabajo'],
      match: 'ALL',
      policy: policy(),
    });
    expect(r.tags.map((t) => t.amount.consolidated.toFixed())).toEqual(['800.00', '800.00']);
  });

  it('[TC-REPORTING-REPORTS-039] con cualquiera solo suma en las etiquetas pedidas', () => {
    const r = TagReport.build({ facts, tags, requested: ['trabajo'], match: 'ANY', policy: policy() });
    expect(r.tags).toHaveLength(1);
    expect(r.tags[0]?.amount.consolidated.toFixed()).toBe('800.00');
  });
});

describe('AccountSpendReport', () => {
  it('[TC-REPORTING-REPORTS-040] Banco BOB 3300.00 y Tarjeta Andina 500.00 suman el gasto total de 3800.00 BOB', () => {
    const r = AccountSpendReport.build({
      facts: [
        { date: '2026-10-10', accountId: 'banco', categoryId: 'super', amount: bob('3300.00') },
        { date: '2026-10-12', accountId: 'tarjeta', categoryId: 'rest', amount: bob('500.00') },
      ],
      accounts: [
        { accountId: 'banco', name: 'Banco BOB', type: 'BANK', institutionId: null },
        { accountId: 'tarjeta', name: 'Tarjeta Andina', type: 'CREDIT_CARD', institutionId: null },
      ],
      policy: policy(),
    });
    expect(r.accounts.map((a) => [a.name, a.type, a.amount.consolidated.toFixed()])).toEqual([
      ['Banco BOB', 'BANK', '3300.00'],
      ['Tarjeta Andina', 'CREDIT_CARD', '500.00'],
    ]);
    expect(r.total.consolidated.toFixed()).toBe('3800.00');
    expect(r.accounts[0]?.byCategory[0]?.categoryId).toBe('super');
  });
});

describe('TrendMatrix', () => {
  const categories = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'].map((id) => ({
    categoryId: id,
    name: id,
    topId: id,
  }));

  it('[TC-REPORTING-REPORTS-041] febrero y marzo normalizados por día informan 100.00 BOB por día', () => {
    const periods = [
      period('2026-02', '2026-02-01', '2026-02-28', 28),
      period('2026-03', '2026-03-01', '2026-03-31', 31),
    ];
    const facts = [
      { date: '2026-02-10', categoryId: 'c1', amount: bob('2800.00') },
      { date: '2026-03-10', categoryId: 'c1', amount: bob('3100.00') },
    ];
    const [series] = TrendMatrix.build({
      facts,
      categories,
      periods,
      policy: policy(),
      perDay: true,
      othersName: 'Otras',
    });
    expect(series?.cells.map((c) => c.amount.consolidated.toFixed())).toEqual(['100.00', '100.00']);
    const [raw] = TrendMatrix.build({
      facts,
      categories,
      periods,
      policy: policy(),
      perDay: false,
      othersName: 'Otras',
    });
    expect(raw?.cells.map((c) => c.amount.consolidated.toFixed())).toEqual(['2800.00', '3100.00']);
  });

  it('[TC-REPORTING-REPORTS-041] con nueve categorías informa 7 series y "Otras categorías" con las 2 restantes', () => {
    const periods = [period('2026-10', '2026-10-01', '2026-10-31', 31)];
    const facts = categories.map((c, i) => ({
      date: '2026-10-05',
      categoryId: c.categoryId,
      amount: bob(`${(9 - i) * 100}.00`),
    }));
    const series = TrendMatrix.build({
      facts,
      categories,
      periods,
      policy: policy(),
      perDay: false,
      othersName: 'Otras categorías',
    });
    expect(series).toHaveLength(8);
    expect(series.slice(0, 7).map((s) => s.categoryId)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
    const others = series[7];
    expect(others?.categoryId).toBeNull();
    expect(others?.name).toBe('Otras categorías');
    expect(others?.total.consolidated.toFixed()).toBe('300.00');
  });

  it('[TC-REPORTING-REPORTS-041] las subcategorías suman en su categoría de primer nivel', () => {
    const periods = [period('2026-10', '2026-10-01', '2026-10-31', 31)];
    const series = TrendMatrix.build({
      facts: [
        { date: '2026-10-05', categoryId: 'hija', amount: bob('40.00') },
        { date: '2026-10-06', categoryId: 'padre', amount: bob('60.00') },
      ],
      categories: [
        { categoryId: 'padre', name: 'Padre', topId: 'padre' },
        { categoryId: 'hija', name: 'Hija', topId: 'padre' },
      ],
      periods,
      policy: policy(),
      perDay: false,
      othersName: 'Otras',
    });
    expect(series).toHaveLength(1);
    expect(series[0]?.total.consolidated.toFixed()).toBe('100.00');
  });
});

describe('FeeBreakdown', () => {
  const OCT = [period('2026-10', '2026-10-01', '2026-10-31', 31)];
  const fee = (
    amount: string,
    transactionKind: string,
    portionRole: 'NOMINAL' | 'FEE',
    categoryId = 'otra',
  ) => ({ date: '2026-10-10', amount: bob(amount), categoryId, transactionKind, portionRole });

  it('[TC-REPORTING-REPORTS-042] cada porción cuenta en un solo tipo y el total de octubre es 422.00 BOB', () => {
    const facts = [
      fee('2.00', 'CONVERSION', 'FEE', 'fx'),
      fee('5.00', 'TRANSFER', 'FEE', 'fees'),
      fee('320.00', 'LOAN_PAYMENT', 'NOMINAL', 'interes'),
      fee('80.00', 'LOAN_PAYMENT', 'NOMINAL', 'cargos'),
      fee('15.00', 'EXPENSE', 'NOMINAL', 'fees'),
      fee('999.00', 'EXPENSE', 'NOMINAL', 'super'),
    ];
    const [month] = FeeBreakdown.build({
      facts,
      feeCategoryIds: new Set(['fees']),
      periods: OCT,
      policy: policy(),
    });
    expect(month?.byType.map((b) => [b.type, b.amount.consolidated.toFixed()])).toEqual([
      ['CONVERSION', '2.00'],
      ['TRANSFER', '5.00'],
      ['LOAN', '400.00'],
      ['FEE_CATEGORY', '15.00'],
    ]);
    expect(month?.total.consolidated.toFixed()).toBe('422.00');
  });

  it('[TC-REPORTING-REPORTS-042] una comisión de transferencia en categoría de comisiones no se cuenta dos veces', () => {
    const [month] = FeeBreakdown.build({
      facts: [fee('5.00', 'TRANSFER', 'FEE', 'fees')],
      feeCategoryIds: new Set(['fees']),
      periods: OCT,
      policy: policy(),
    });
    expect(month?.total.consolidated.toFixed()).toBe('5.00');
    expect(month?.byType.find((b) => b.type === 'FEE_CATEGORY')?.amount.consolidated.toFixed()).toBe('0.00');
  });

  it('[TC-REPORTING-REPORTS-042] el total de 12 meses suma los totales mensuales', () => {
    const months = FeeBreakdown.build({
      facts: [fee('5.00', 'TRANSFER', 'FEE')],
      feeCategoryIds: new Set(),
      periods: OCT,
      policy: policy(),
    });
    expect(FeeBreakdown.last12Months(months, policy()).consolidated.toFixed()).toBe('5.00');
  });
});

describe('GoalProgressSeries', () => {
  it('[TC-REPORTING-REPORTS-043] el acumulado de la meta Viaje y su porcentaje se informan por mes', () => {
    const month = (monthEnd: string, acc: string) => ({
      monthEnd,
      contributions: bob('0.00'),
      withdrawals: bob('0.00'),
      accumulated: bob(acc),
      expected: null,
      status: null,
      complete: true,
    });
    const [goal] = GoalProgressSeries.build([
      {
        goalId: 'g1',
        name: 'Viaje',
        currency: 'BOB',
        target: bob('5000.00'),
        startDate: '2026-07-01',
        targetDate: '2027-06-30',
        months: [
          month('2026-07-31', '500.00'),
          month('2026-08-31', '1000.00'),
          month('2026-09-30', '1000.00'),
          month('2026-10-31', '1800.00'),
        ],
      },
    ]);
    expect(goal?.months.map((m) => m.accumulated.toFixed())).toEqual([
      '500.00',
      '1000.00',
      '1000.00',
      '1800.00',
    ]);
    expect(goal?.months.map((m) => m.percent)).toEqual(['10.00', '20.00', '20.00', '36.00']);
  });
});

describe('DebtEvolutionSeries', () => {
  const sep = period('2026-09', '2026-09-01', '2026-09-30', 30);
  const oct = period('2026-10', '2026-10-01', '2026-10-31', 31);
  const debt = {
    debtId: 'auto',
    kind: 'LOAN' as const,
    name: 'Crédito auto',
    currency: 'BOB',
    months: [
      {
        period: sep,
        outstanding: bob('18900.00'),
        payments: [
          { date: '2026-09-15', principal: bob('1100.00'), interest: bob('320.00'), charges: bob('0.00') },
        ],
      },
      {
        period: oct,
        outstanding: bob('17790.00'),
        payments: [
          { date: '2026-10-15', principal: bob('1110.00'), interest: bob('310.00'), charges: bob('0.00') },
        ],
      },
    ],
  };

  it('[TC-REPORTING-REPORTS-044] Crédito auto informa pendiente 18900.00 y 17790.00 con interés pagado 320.00 y 310.00', () => {
    const [s] = DebtEvolutionSeries.series([debt]);
    expect(s?.months.map((m) => m.outstanding.toFixed())).toEqual(['18900.00', '17790.00']);
    expect(s?.months.map((m) => m.interestPaid?.toFixed())).toEqual(['320.00', '310.00']);
    expect(s?.months.map((m) => m.principalPaid?.toFixed())).toEqual(['1100.00', '1110.00']);
  });

  it('[TC-REPORTING-REPORTS-044] consolida saldos con la tasa del cierre y lo pagado con la de su fecha', () => {
    const usdDebt = {
      debtId: 'usd',
      kind: 'LOAN' as const,
      name: 'Préstamo USD',
      currency: 'USD',
      months: [
        {
          period: sep,
          outstanding: usd('100.00'),
          payments: [
            { date: '2026-09-15', principal: usd('10.00'), interest: usd('1.00'), charges: usd('0.00') },
          ],
        },
      ],
    };
    const [m] = DebtEvolutionSeries.consolidate(
      [usdDebt],
      [sep],
      ReportConversionPolicy.valuationDate(BOB, rates({ USD: '10.00' })),
      ReportConversionPolicy.transactionDate(BOB, rates({ USD: '10.00' })),
    );
    expect(m?.outstanding.consolidated.toFixed()).toBe('1000.00');
    expect(m?.interestPaid.consolidated.toFixed()).toBe('10.00');
  });

  it('[TC-REPORTING-REPORTS-044] una tarjeta no informa pagos desglosados', () => {
    const [s] = DebtEvolutionSeries.series([
      {
        debtId: 'tc',
        kind: 'CARD',
        name: 'Tarjeta',
        currency: 'BOB',
        months: [{ period: sep, outstanding: bob('500.00'), payments: null }],
      },
    ]);
    expect(s?.months[0]).toMatchObject({ principalPaid: null, interestPaid: null });
  });
});

describe('RecurringCostTable', () => {
  const item = (
    name: string,
    price: string | null,
    renewals: string | null,
    cur = BOB,
    variable = false,
  ) => ({
    definitionId: name,
    name,
    categoryId: null,
    cadence: 'MONTHLY',
    interval: 1,
    currency: cur,
    renewalsPerYear: renewals,
    price,
    variable,
  });

  it('[TC-REPORTING-REPORTS-045] streaming, seguro y gimnasio suman 669.00 BOB al mes y 8028.00 BOB al año', () => {
    const r = RecurringCostTable.build({
      items: [
        item('Streaming', '69.00', '12'),
        item('Seguro', '1200.00', '1'),
        item('Gimnasio', '50.00', '12', USD),
        item('Variable', null, '12', BOB, true),
      ],
      asOf: '2026-11-05',
      policy: policy(),
    });
    expect(r.totals.monthly.consolidated.toFixed()).toBe('669.00');
    expect(r.totals.annual.consolidated.toFixed()).toBe('8028.00');
    expect(r.variableCount).toBe(1);
    expect(r.items.map((i) => i.name)).toEqual(['Gimnasio', 'Seguro', 'Streaming', 'Variable']);
    expect(r.items[0]?.monthlyReporting?.toFixed()).toBe('500.00');
    expect(r.items.at(-1)?.monthly).toBeNull();
  });

  it('[TC-REPORTING-REPORTS-045] sin tasa USD el total queda incompleto y el gimnasio sin convertir', () => {
    const r = RecurringCostTable.build({
      items: [item('Streaming', '69.00', '12'), item('Gimnasio', '50.00', '12', USD)],
      asOf: '2026-11-05',
      policy: policy({}),
    });
    expect(r.totals.monthly.complete).toBe(false);
    expect(r.totals.monthly.consolidated.toFixed()).toBe('69.00');
    expect(r.totals.monthly.unconverted.map((m) => m.toFixed())).toEqual(['50.00']);
  });
});

describe('SubscriptionCostSeries', () => {
  const periods = [
    period('2026-07', '2026-07-01', '2026-07-31', 31),
    period('2026-08', '2026-08-01', '2026-08-31', 31),
    period('2026-09', '2026-09-01', '2026-09-30', 30),
    period('2026-10', '2026-10-01', '2026-10-31', 31),
  ];
  const ev = (
    subscriptionId: string,
    name: string,
    date: string,
    kind: 'STARTED' | 'CANCELLED' | 'PRICE_CHANGED',
    previous: string | null,
    next: string | null,
  ) => ({
    subscriptionId,
    name,
    date,
    kind,
    previousPrice: previous ? bob(previous) : null,
    newPrice: next ? bob(next) : null,
    renewalsPerYear: '12',
  });

  it('[TC-REPORTING-REPORTS-046] el costo mensual al cierre es 94.00, 99.00, 149.00 y 80.00 BOB con sus eventos', () => {
    const series = SubscriptionCostSeries.build({
      events: [
        ev('musica', 'Música', '2026-01-10', 'STARTED', null, '25.00'),
        ev('video', 'Video', '2026-02-10', 'STARTED', null, '69.00'),
        ev('musica', 'Música', '2026-08-01', 'PRICE_CHANGED', '25.00', '30.00'),
        ev('nueva', 'Nueva', '2026-09-10', 'STARTED', null, '50.00'),
        ev('video', 'Video', '2026-10-05', 'CANCELLED', '69.00', null),
      ],
      periods,
      policy: policy(),
    });
    expect(series.map((s) => s.monthlyCost.consolidated.toFixed())).toEqual([
      '94.00',
      '99.00',
      '149.00',
      '80.00',
    ]);
    expect(series.map((s) => s.events.map((e) => e.kind))).toEqual([
      [],
      ['PRICE_CHANGED'],
      ['STARTED'],
      ['CANCELLED'],
    ]);
    expect(series[1]?.events[0]).toMatchObject({ previousPrice: bob('25.00'), newPrice: bob('30.00') });
  });

  it('[TC-REPORTING-REPORTS-046] una suscripción anual de 120.00 BOB cuesta 10.00 BOB al mes', () => {
    const [m] = SubscriptionCostSeries.build({
      events: [{ ...ev('a', 'Anual', '2026-01-01', 'STARTED', null, '120.00'), renewalsPerYear: '1' }],
      periods: periods.slice(0, 1),
      policy: policy(),
    });
    expect(m?.monthlyCost.consolidated.toFixed()).toBe('10.00');
  });
});

describe('ConversionScatter', () => {
  it('[TC-REPORTING-REPORTS-047] lista 11.90 frente a 12.00 y 11.94 frente a 12.00; sin referencia queda sin punto', () => {
    const base = { base: 'USDT', quote: 'BOB' };
    const points = ConversionScatter.points([
      {
        transactionId: 'b',
        date: '2026-10-12',
        ...base,
        effectiveRate: '11.94',
        reference: { ...base, value: '12.00' },
      },
      {
        transactionId: 'a',
        date: '2026-10-05',
        ...base,
        effectiveRate: '11.90',
        reference: { ...base, value: '12.00' },
      },
      { transactionId: 'c', date: '2026-10-20', ...base, effectiveRate: '11.80', reference: null },
    ]);
    expect(points.map((p) => [p.effectiveRate, p.referenceRate])).toEqual([
      ['11.90', '12.00'],
      ['11.94', '12.00'],
      ['11.80', null],
    ]);
  });

  it('[TC-REPORTING-REPORTS-047] una referencia almacenada al revés se orienta al par de visualización', () => {
    const [p] = ConversionScatter.points([
      {
        transactionId: 'a',
        date: '2026-10-05',
        base: 'USDT',
        quote: 'BOB',
        effectiveRate: '11.90',
        reference: { base: 'BOB', quote: 'USDT', value: '0.08333333' },
      },
    ]);
    expect(p?.referenceRate).toBe('12.00000048');
  });
});

describe('ReportReconciler (reportes ampliados)', () => {
  it('[TC-REPORTING-REPORTS-052] Σ cuentas = gasto, Σ tipos ≤ gasto, pendiente = saldo y meta = Σ movimientos', () => {
    expect(ReportReconciler.accountSum('2026-10', bob('3800.00'), [bob('3300.00'), bob('500.00')])).toEqual(
      [],
    );
    expect(
      ReportReconciler.accountSum('2026-10', bob('3800.00'), [bob('3300.00'), bob('499.99')]),
    ).toHaveLength(1);
    expect(ReportReconciler.feeTypesWithinExpenses('2026-10', bob('3800.00'), [bob('422.00')])).toEqual([]);
    expect(ReportReconciler.feeTypesWithinExpenses('2026-10', bob('100.00'), [bob('422.00')])).toHaveLength(
      1,
    );
    expect(ReportReconciler.debtOutstanding('2026-10', bob('17790.00'), bob('17790.00'))).toEqual([]);
    expect(ReportReconciler.debtOutstanding('2026-10', bob('17790.00'), bob('17790.01'))).toHaveLength(1);
    expect(
      ReportReconciler.goalAccumulated('2026-10', bob('1800.00'), [bob('500.00'), bob('1300.00')]),
    ).toEqual([]);
    expect(ReportReconciler.goalAccumulated('2026-10', bob('1800.00'), [bob('500.00')])).toHaveLength(1);
  });

  it('[TC-REPORTING-REPORTS-052] PBT: la suma de las cuentas siempre es el gasto total del rango', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            account: fc.constantFrom('a', 'b', 'c'),
            category: fc.constantFrom('x', 'y'),
            cents: fc.integer({ min: 1, max: 1_000_000 }),
          }),
          { minLength: 1, maxLength: 40 },
        ),
        (rows) => {
          const facts = rows.map((r) => ({
            date: '2026-10-10',
            accountId: r.account,
            categoryId: r.category,
            amount: bob((r.cents / 100).toFixed(2)),
          }));
          const rep = AccountSpendReport.build({ facts, accounts: [], policy: policy() });
          const total = rep.total.byCurrency[0] as Money;
          const sums = rep.accounts.map((a) => a.amount.byCurrency[0] as Money);
          return ReportReconciler.accountSum('2026-10', total, sums).length === 0;
        },
      ),
      { numRuns: 100 },
    );
  }, 30_000);
});

describe('ReportReconciler.feeTypesWithinExpenses (gasto neto negativo)', () => {
  it('[TC-REPORTING-REPORTS-052] con reembolsos mayores al gasto la comparación no aplica y no da falsos positivos', () => {
    expect(ReportReconciler.feeTypesWithinExpenses('2026-10', bob('-0.01'), [bob('0.00')])).toEqual([]);
    expect(ReportReconciler.feeTypesWithinExpenses('2026-10', bob('-5.00'), [bob('5.00')])).toEqual([]);
  });
});
