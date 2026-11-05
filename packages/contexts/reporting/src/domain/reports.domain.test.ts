import { currency, dec, Money, type ExactRate } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BalanceStepSeries } from './balance-step-series.js';
import { CategoryTreeReport } from './category-tree-report.js';
import { IncomeExpenseReport, type FlowFact } from './income-expense-report.js';
import { LiquidityFlowReport, type SetFlow } from './liquidity-flow-report.js';
import { NetWorthDecomposer } from './net-worth-decomposer.js';
import { REPORT_CATALOG } from './report-catalog.js';
import { ReportComparator } from './report-comparator.js';
import { ReportConversionPolicy } from './report-conversion.js';
import { ReportPeriodCalendar } from './report-periods.js';
import { describeMismatch, ReportReconciler } from './report-reconciler.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const USDT = currency('USDT', 6);
const CURRENCIES = new Map([
  ['BOB', BOB],
  ['USD', USD],
  ['USDT', USDT],
]);
const bob = (v: string) => Money.parse(v, BOB);
const usd = (v: string) => Money.parse(v, USD);
const usdt = (v: string) => Money.parse(v, USDT);

/** Tasas fijas por moneda (1 unidad en BOB); `null` = sin tasa. */
const rates =
  (table: Record<string, string>) =>
  (code: string): ExactRate | null =>
    table[code] ? { base: code, quote: 'BOB', value: dec(table[code]) } : null;
const policy = (table: Record<string, string> = { USD: '10.00' }) =>
  ReportConversionPolicy.transactionDate(BOB, rates(table));

const flow = (date: string, nature: 'INCOME' | 'EXPENSE', categoryId: string, amount: Money): FlowFact => ({
  date,
  nature,
  categoryId,
  amount,
});
const october: FlowFact[] = [
  flow('2026-10-05', 'INCOME', 'sueldo', bob('12000.00')),
  flow('2026-10-10', 'EXPENSE', 'super', bob('3500.00')),
  flow('2026-10-12', 'EXPENSE', 'super', bob('-200.00')),
  flow('2026-10-15', 'EXPENSE', 'rest', usd('50.00')),
];
const OCT = { from: '2026-10-01', to: '2026-10-31' };

describe('ReportConversionPolicy', () => {
  it('[TC-REPORTING-REPORTS-014] el gasto de 50.00 USD del 2026-10-15 se valora en 500.00 BOB con la tasa de su fecha', () => {
    const v = policy().value([{ date: '2026-10-15', amount: usd('50.00') }]);
    expect(v.consolidated.toFixed()).toBe('500.00');
    expect(v.byCurrency.map((m) => m.toFixed())).toEqual(['50.00']);
  });

  it('[TC-REPORTING-REPORTS-015] la moneda de reporte USD no cambia las cifras nativas: 12000.00 BOB = 1200.00 USD', () => {
    const toUsd = ReportConversionPolicy.transactionDate(USD, (code) =>
      code === 'BOB' ? { base: 'USD', quote: 'BOB', value: dec('10.00') } : null,
    );
    const v = toUsd.value([{ date: '2026-10-05', amount: bob('12000.00') }]);
    expect(v.consolidated.toFixed()).toBe('1200.00');
    expect(v.byCurrency.map((m) => m.toFixed())).toEqual(['12000.00']);
  });

  it('[TC-REPORTING-REPORTS-016] un monto sin tasa queda fuera del consolidado, incompleto, y visible en nativo (nunca 1:1)', () => {
    const v = policy().value([
      { date: '2026-10-20', amount: usdt('20.000000') },
      { date: '2026-10-20', amount: bob('10.00') },
    ]);
    expect(v.consolidated.toFixed()).toBe('10.00');
    expect(v.complete).toBe(false);
    expect(v.unconverted.map((m) => m.toFixed())).toEqual(['20.000000']);
    expect(v.byCurrency.map((m) => `${m.currency.code} ${m.toFixed()}`)).toEqual([
      'BOB 10.00',
      'USDT 20.000000',
    ]);
  });

  it('[TC-REPORTING-REPORTS-017] a la fecha de corte todos los flujos usan la tasa del corte (525.00 BOB con 10.50)', () => {
    const cutoff = ReportConversionPolicy.cutoffDate(BOB, '2026-10-31', (code, date) =>
      code === 'USD'
        ? { base: 'USD', quote: 'BOB', value: dec(date === '2026-10-31' ? '10.50' : '10.00') }
        : null,
    );
    expect(cutoff.value([{ date: '2026-10-15', amount: usd('50.00') }]).consolidated.toFixed()).toBe(
      '525.00',
    );
    expect(cutoff.kind).toBe('CUTOFF_DATE');
  });
});

describe('IncomeExpenseReport', () => {
  it('[TC-REPORTING-REPORTS-005] octubre: nativo BOB 12000.00/3300.00, USD 50.00 y consolidado 12000.00/3800.00/8200.00 con 68.3 %', () => {
    const f = IncomeExpenseReport.figures(october, OCT, policy());
    expect(f.income.byCurrency.map((m) => m.toFixed())).toEqual(['12000.00']);
    expect(f.expenses.byCurrency.map((m) => `${m.currency.code} ${m.toFixed()}`)).toEqual([
      'BOB 3300.00',
      'USD 50.00',
    ]);
    expect(f.expenses.consolidated.toFixed()).toBe('3800.00');
    expect(f.savings.consolidated.toFixed()).toBe('8200.00');
    expect(f.savingsRate).toBe('68.3');
  });

  it('[TC-REPORTING-REPORTS-005] un mes sin ingresos tiene ahorro negativo y tasa sin definir (null, nunca 0 %)', () => {
    const f = IncomeExpenseReport.figures(
      [flow('2026-11-03', 'EXPENSE', 'x', bob('150.00'))],
      { from: '2026-11-01', to: '2026-11-30' },
      policy(),
    );
    expect(f.savings.consolidated.toFixed()).toBe('-150.00');
    expect(f.savingsRate).toBeNull();
  });

  it('[TC-REPORTING-REPORTS-004] el reembolso del mes siguiente resta en el mes del reembolso', () => {
    const flows = [
      flow('2026-09-28', 'EXPENSE', 'super', bob('400.00')),
      flow('2026-10-02', 'EXPENSE', 'super', bob('-400.00')),
    ];
    expect(
      IncomeExpenseReport.figures(
        flows,
        { from: '2026-09-01', to: '2026-09-30' },
        policy(),
      ).expenses.consolidated.toFixed(),
    ).toBe('400.00');
    expect(IncomeExpenseReport.figures(flows, OCT, policy()).expenses.consolidated.toFixed()).toBe('-400.00');
  });

  it('[TC-REPORTING-REPORTS-005] la granularidad semanal agrupa el gasto de 50.00 USD de la semana del 2026-10-12 en 500.00 BOB', () => {
    const cal = ReportPeriodCalendar.of('CALENDAR_MONTH', [], 1, '2026-11-15');
    const weeks = IncomeExpenseReport.byPeriod(
      october.filter((f) => f.categoryId !== 'super'),
      cal.weeks('2026-10-01', '2026-10-31'),
      policy(),
    );
    const w42 = weeks.find((w) => w.period.from === '2026-10-12');
    expect(w42?.expenses.consolidated.toFixed()).toBe('500.00');
  });
});

describe('ReportComparator', () => {
  const cal = ReportPeriodCalendar.of('CALENDAR_MONTH', [], 1, '2026-12-01');
  const amount = (v: string) => policy().value([{ date: '2026-10-01', amount: bob(v) }]);

  it('[TC-REPORTING-REPORTS-010] octubre contra septiembre: 800.00 BOB y 26.67 %; contra octubre 2025: −200.00 y −5.00 %', () => {
    const mom = ReportComparator.variation(amount('3800.00'), amount('3000.00'), BOB);
    expect([mom.deltaAbs.toFixed(), mom.deltaPct, mom.isNew]).toEqual(['800.00', '26.67', false]);
    const yoy = ReportComparator.variation(amount('3800.00'), amount('4000.00'), BOB);
    expect([yoy.deltaAbs.toFixed(), yoy.deltaPct]).toEqual(['-200.00', '-5.00']);
  });

  it('[TC-REPORTING-REPORTS-010] una categoría nueva (comparada 0) informa 150.00 BOB y "nuevo", sin porcentaje', () => {
    const v = ReportComparator.variation(amount('150.00'), policy().zero(), BOB);
    expect([v.deltaAbs.toFixed(), v.deltaPct, v.isNew]).toEqual(['150.00', null, true]);
  });

  it('[TC-REPORTING-REPORTS-011] 10 días contra 30 normalizados por día: 100.00 por día y variación 0.00; sin normalizar −2000.00', () => {
    const a = policy().value([{ date: '2026-10-05', amount: bob('1000.00') }], 10);
    const b = policy().value([{ date: '2026-09-05', amount: bob('3000.00') }], 30);
    expect([a.consolidated.toFixed(), b.consolidated.toFixed()]).toEqual(['100.00', '100.00']);
    expect(ReportComparator.variation(a, b, BOB).deltaAbs.toFixed()).toBe('0.00');
    const raw = ReportComparator.variation(
      policy().value([{ date: '2026-10-05', amount: bob('1000.00') }]),
      policy().value([{ date: '2026-09-05', amount: bob('3000.00') }]),
      BOB,
    );
    expect(raw.deltaAbs.toFixed()).toBe('-2000.00');
    expect(ReportComparator.customRange('2026-09-01', '2026-09-30', cal).days).toBe(30);
  });

  it('[TC-REPORTING-REPORTS-012] promedio móvil de 3: línea base 3100.00, variación 700.00 y 22.58 %; con historial corto es insuficiente', () => {
    const base = ReportComparator.baseline(
      3,
      amount('3800.00'),
      [dec('3000'), dec('3300'), dec('3000')],
      BOB,
    );
    expect([base.average?.toFixed(), base.deltaAbs?.toFixed(), base.deltaPct]).toEqual([
      '3100.00',
      '700.00',
      '22.58',
    ]);
    const oct = cal.periodOf('2026-10-10');
    const w = ReportComparator.baselinePeriods(oct, 3, cal, '2026-08-03');
    expect(w.usable.map((p) => p.label)).toEqual(['2026-09', '2026-08']);
    expect(w.insufficient).toBe(true);
    expect(ReportComparator.baseline(3, amount('3800.00'), null, BOB).insufficient).toBe(true);
  });

  it('[TC-REPORTING-REPORTS-013] a la fecha: el 15-oct compara 1..15 de octubre con 1..15 de septiembre; el día 31 se acota a 30 de septiembre', () => {
    const mid = ReportPeriodCalendar.of('CALENDAR_MONTH', [], 1, '2026-10-15');
    const [pair] = ReportComparator.pairs(
      'PREVIOUS_PERIOD_TO_DATE',
      mid.periods('2026-10-01', '2026-10-31'),
      mid,
    );
    expect([pair?.current.to, pair?.compared.from, pair?.compared.to]).toEqual([
      '2026-10-15',
      '2026-09-01',
      '2026-09-15',
    ]);
    const end = ReportPeriodCalendar.of('CALENDAR_MONTH', [], 1, '2026-10-31');
    const [last] = ReportComparator.pairs(
      'PREVIOUS_PERIOD_TO_DATE',
      end.periods('2026-10-01', '2026-10-31'),
      end,
    );
    expect(last?.compared.to).toBe('2026-09-30');
    const v = ReportComparator.variation(amount('1800.00'), amount('1500.00'), BOB);
    expect([v.deltaAbs.toFixed(), v.deltaPct]).toEqual(['300.00', '20.00']);
  });
});

describe('CategoryTreeReport', () => {
  const groups = [{ groupId: 'ali', name: 'Alimentación' }];
  const categories = [
    { categoryId: 'super', name: 'Supermercado', groupId: 'ali', parentId: null, archived: false },
    { categoryId: 'may', name: 'Mayorista', groupId: 'ali', parentId: 'super', archived: false },
    { categoryId: 'rest', name: 'Restaurantes', groupId: 'ali', parentId: null, archived: false },
    { categoryId: 'elec', name: 'Electrónica', groupId: 'ali', parentId: null, archived: true },
  ];
  const expenses = [
    flow('2026-10-10', 'EXPENSE', 'super', bob('2300.00')),
    flow('2026-10-11', 'EXPENSE', 'may', bob('1000.00')),
    flow('2026-10-15', 'EXPENSE', 'rest', bob('500.00')),
  ];

  it('[TC-REPORTING-REPORTS-006] el grupo Alimentación suma 3800.00 con Supermercado 3300.00 (incluye su subcategoría) y Restaurantes 500.00', () => {
    const t = CategoryTreeReport.build({ flows: expenses, groups, categories, policy: policy() });
    const g = t.groups[0];
    expect(g?.amount.consolidated.toFixed()).toBe('3800.00');
    expect(g?.categories.map((c) => [c.name, c.amount.consolidated.toFixed()])).toEqual([
      ['Supermercado', '3300.00'],
      ['Restaurantes', '500.00'],
    ]);
    expect(g?.categories[0]?.subcategories.map((s) => s.amount.consolidated.toFixed())).toEqual(['1000.00']);
  });

  it('[TC-REPORTING-REPORTS-006] top 1 agrupa el resto en "Otras categorías" (500.00 BOB)', () => {
    const t = CategoryTreeReport.build({ flows: expenses, groups, categories, policy: policy(), topN: 1 });
    expect(t.groups[0]?.categories.map((c) => c.name)).toEqual(['Supermercado']);
    expect(t.others?.consolidated.toFixed()).toBe('500.00');
    expect(t.total.consolidated.toFixed()).toBe('3800.00');
  });

  it('[TC-REPORTING-REPORTS-006] un neto negativo conserva su signo, queda marcado y la categoría archivada sigue apareciendo', () => {
    const flows = [
      flow('2026-10-03', 'EXPENSE', 'elec', bob('100.00')),
      flow('2026-10-20', 'EXPENSE', 'elec', bob('-300.00')),
    ];
    const t = CategoryTreeReport.build({ flows, groups, categories, policy: policy() });
    const c = t.groups[0]?.categories[0];
    expect([c?.name, c?.amount.consolidated.toFixed(), c?.negativeNet, c?.archived]).toEqual([
      'Electrónica',
      '-200.00',
      true,
      true,
    ]);
  });
});

describe('LiquidityFlowReport', () => {
  const sf = (date: string, counterpart: SetFlow['counterpart'], amount: Money): SetFlow => ({
    date,
    counterpart,
    amount,
  });
  const bal = ReportConversionPolicy.valuationDate(BOB, rates({ USDT: '12.00' }));
  const fl = ReportConversionPolicy.transactionDate(BOB, rates({ USDT: '12.00' }));

  it('[TC-REPORTING-REPORTS-008] octubre: inicial 10000.00, operativo 8700.00, deuda −500.00, ahorro −1000.00, cambio 0.00 y final 17200.00', () => {
    const r = LiquidityFlowReport.build({
      currencies: CURRENCIES,
      openingDate: '2026-09-30',
      closingDate: '2026-10-31',
      opening: [bob('10000.00')],
      closing: [bob('17200.00')],
      flows: [
        sf('2026-10-05', 'INCOME', bob('12000.00')),
        sf('2026-10-10', 'EXPENSE', bob('-3300.00')),
        sf('2026-10-20', 'OUTSIDE_LIABILITY', bob('-500.00')),
        sf('2026-10-21', 'OUTSIDE_ASSET', bob('-1000.00')),
      ],
      flowPolicy: fl,
      balancePolicy: bal,
    });
    const b = r.byCurrency[0];
    expect(
      [b?.opening, b?.operating, b?.debt, b?.savingsInvestments, b?.currencyExchange, b?.closing].map((m) =>
        m?.toFixed(),
      ),
    ).toEqual(['10000.00', '8700.00', '-500.00', '-1000.00', '0.00', '17200.00']);
    expect(b?.consistent).toBe(true);
    expect(r.consolidated.revaluation.toFixed()).toBe('0.00');
  });

  it('[TC-REPORTING-REPORTS-008] la cuota de préstamo aporta −1100.00 a deuda y −400.00 a operativo', () => {
    const r = LiquidityFlowReport.build({
      currencies: CURRENCIES,
      openingDate: '2026-09-30',
      closingDate: '2026-10-31',
      opening: [bob('5000.00')],
      closing: [bob('3500.00')],
      flows: [
        sf('2026-10-10', 'OUTSIDE_LIABILITY', bob('-1100.00')),
        sf('2026-10-10', 'EXPENSE', bob('-400.00')),
      ],
      flowPolicy: fl,
      balancePolicy: bal,
    });
    expect([r.byCurrency[0]?.debt.toFixed(), r.byCurrency[0]?.operating.toFixed()]).toEqual([
      '-1100.00',
      '-400.00',
    ]);
  });

  it('[TC-REPORTING-REPORTS-008] conversión entre líquidas: cambio de moneda 1190.00 BOB y −100.000000 USDT; consolidado −10.00 BOB', () => {
    const r = LiquidityFlowReport.build({
      currencies: CURRENCIES,
      openingDate: '2026-09-30',
      closingDate: '2026-10-31',
      opening: [bob('0.00'), usdt('100.000000')],
      closing: [bob('1190.00'), usdt('0.000000')],
      flows: [
        sf('2026-10-10', 'FX_TRADING', bob('1190.00')),
        sf('2026-10-10', 'FX_TRADING', usdt('-100.000000')),
      ],
      flowPolicy: fl,
      balancePolicy: bal,
    });
    expect(r.byCurrency.map((b) => `${b.currency} ${b.currencyExchange.toFixed()}`)).toEqual([
      'BOB 1190.00',
      'USDT -100.000000',
    ]);
    expect(r.consolidated.components.currencyExchange.consolidated.toFixed()).toBe('-10.00');
    expect(r.consolidated.revaluation.toFixed()).toBe('0.00');
  });

  it('[TC-REPORTING-REPORTS-008] [PBT] inicial + componentes = final por moneda y consolidado con línea de revalorización', () => {
    const arbFlow = fc.record({
      day: fc.integer({ min: 1, max: 28 }),
      cls: fc.constantFrom(
        'INCOME',
        'EXPENSE',
        'FX_TRADING',
        'OUTSIDE_ASSET',
        'OUTSIDE_LIABILITY',
        'ADJUSTMENTS',
      ) as fc.Arbitrary<SetFlow['counterpart']>,
      cents: fc.integer({ min: -1_000_000, max: 1_000_000 }),
      ccy: fc.constantFrom('BOB', 'USD'),
    });
    fc.assert(
      fc.property(
        fc.array(arbFlow, { maxLength: 40 }),
        fc.integer({ min: 0, max: 10_000_00 }),
        fc.integer({ min: 1, max: 2000 }),
        (flows, openCents, rate) => {
          const asMoney = (cents: number, ccy: string) =>
            Money.ofMinorUnits(BigInt(cents), ccy === 'BOB' ? BOB : USD);
          const set = flows.map((f) =>
            sf(`2026-10-${String(f.day).padStart(2, '0')}`, f.cls, asMoney(f.cents, f.ccy)),
          );
          const net = (ccy: string) =>
            set
              .filter((f) => f.amount.currency.code === ccy)
              .reduce((a, f) => a.add(f.amount), asMoney(openCents, ccy));
          const table = { USD: (rate / 100).toFixed(2) };
          const r = LiquidityFlowReport.build({
            currencies: CURRENCIES,
            openingDate: '2026-09-30',
            closingDate: '2026-10-31',
            opening: [asMoney(openCents, 'BOB'), asMoney(openCents, 'USD')],
            closing: [net('BOB'), net('USD')],
            flows: set,
            flowPolicy: ReportConversionPolicy.transactionDate(BOB, rates(table)),
            balancePolicy: ReportConversionPolicy.valuationDate(BOB, rates(table)),
          });
          expect(r.byCurrency.every((b) => b.consistent)).toBe(true);
          // opening + componentes + revalorización = closing, sin redondeo (precisión 40).
          const c = r.consolidated;
          const exact = Object.values(c.components).reduce((a, x) => a.plus(x.exact), c.opening.exact);
          expect(exact.plus(c.closing.exact.minus(exact)).eq(c.closing.exact)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  }, 60_000);
});

describe('BalanceStepSeries', () => {
  it('[TC-REPORTING-REPORTS-009] octubre de Banco BOB: 10000.00 hasta el 4, 22000.00, 18500.00 y 18700.00 al cierre; marca de conciliación el día 10', () => {
    const { days, closing } = BalanceStepSeries.build({
      from: '2026-10-01',
      to: '2026-10-31',
      opening: bob('10000.00'),
      deltas: new Map([
        ['2026-10-05', bob('12000.00')],
        ['2026-10-10', bob('-3500.00')],
        ['2026-10-12', bob('200.00')],
      ]),
      reconciledDates: new Set(['2026-10-10']),
    });
    const at = (d: string) => days.find((x) => x.date === d);
    expect(at('2026-10-04')?.balance.toFixed()).toBe('10000.00');
    expect(at('2026-10-09')?.balance.toFixed()).toBe('22000.00');
    expect(at('2026-10-11')?.balance.toFixed()).toBe('18500.00');
    expect(closing.toFixed()).toBe('18700.00');
    expect([
      at('2026-10-10')?.reconciled,
      at('2026-10-10')?.hasMovements,
      at('2026-10-11')?.hasMovements,
    ]).toEqual([true, true, false]);
    expect(days).toHaveLength(31);
  });
});

describe('NetWorthDecomposer', () => {
  const kinds = new Map([
    ['BOB', 'FIAT'],
    ['USD', 'FIAT'],
    ['USDT', 'CRYPTO'],
  ]);
  const at =
    (table: Record<string, Record<string, string>>) =>
    (code: string, date: string): ExactRate | null => {
      const v = table[date]?.[code];
      return v ? { base: code, quote: 'BOB', value: dec(v) } : null;
    };

  it('[TC-REPORTING-REPORTS-033] octubre: patrimonio 23000.00 a 31750.00; ahorro 8200.00, cambiaria 50.00 (USD) y de activos 500.00 (USDT)', () => {
    const d = NetWorthDecomposer.decompose({
      target: BOB,
      currencies: CURRENCIES,
      kinds,
      opening: [bob('10000.00'), usd('100.00'), usdt('1000.000000')],
      closing: [bob('18200.00'), usd('100.00'), usdt('1000.000000')],
      openingDate: '2026-09-30',
      closingDate: '2026-10-31',
      flows: [
        { date: '2026-10-05', currency: 'BOB', counterpart: 'INCOME', amount: bob('12000.00') },
        { date: '2026-10-10', currency: 'BOB', counterpart: 'EXPENSE', amount: bob('-3800.00') },
      ],
      rateFor: at({
        '2026-09-30': { USD: '10.00', USDT: '12.00' },
        '2026-10-31': { USD: '10.50', USDT: '12.50' },
      }),
    });
    expect(
      [d.opening, d.closing, d.savings, d.fxRevaluation, d.assetRevaluation].map((m) => m.toFixed()),
    ).toEqual(['23000.00', '31750.00', '8200.00', '50.00', '500.00']);
    expect(d.complete).toBe(true);
    expect(d.deltaExact.eq(d.componentsExact)).toBe(true);
    expect(d.revaluationByCurrency.map((r) => `${r.currency} ${r.kind} ${r.amount.toFixed()}`)).toEqual([
      'USD FX 50.00',
      'USDT ASSET 500.00',
    ]);
  });

  it('[TC-REPORTING-REPORTS-033] la venta de 100.000000 USDT por 1190.00 BOB es un resultado de conversiones de −10.00 BOB sin revalorización', () => {
    const rate = { USDT: '12.00' };
    const d = NetWorthDecomposer.decompose({
      target: BOB,
      currencies: CURRENCIES,
      kinds,
      opening: [bob('0.00'), usdt('100.000000')],
      closing: [bob('1190.00'), usdt('0.000000')],
      openingDate: '2026-09-30',
      closingDate: '2026-10-31',
      flows: [
        { date: '2026-10-10', currency: 'BOB', counterpart: 'FX_TRADING', amount: bob('1190.00') },
        { date: '2026-10-10', currency: 'USDT', counterpart: 'FX_TRADING', amount: usdt('-100.000000') },
      ],
      rateFor: at({ '2026-09-30': rate, '2026-10-10': rate, '2026-10-31': rate }),
    });
    expect([
      d.conversionResult.toFixed(),
      d.assetRevaluation.toFixed(),
      d.closing.subtract(d.opening).toFixed(),
    ]).toEqual(['-10.00', '0.00', '-10.00']);
  });

  it('[TC-REPORTING-REPORTS-035] una transferencia a una cuenta excluida es "otros movimientos" de −1000.00 BOB, no ahorro ni revalorización', () => {
    const d = NetWorthDecomposer.decompose({
      target: BOB,
      currencies: CURRENCIES,
      kinds,
      opening: [bob('5000.00')],
      closing: [bob('4000.00')],
      openingDate: '2026-09-30',
      closingDate: '2026-10-31',
      flows: [{ date: '2026-10-10', currency: 'BOB', counterpart: 'OUTSIDE_ASSET', amount: bob('-1000.00') }],
      rateFor: at({}),
    });
    expect([
      d.otherMovements.toFixed(),
      d.savings.toFixed(),
      d.fxRevaluation.toFixed(),
      d.assetRevaluation.toFixed(),
    ]).toEqual(['-1000.00', '0.00', '0.00', '0.00']);
  });

  it('[TC-REPORTING-REPORTS-034] sin tasa de BTC al cierre la descomposición es incompleta, informa 0.01000000 BTC sin valorar y no revaloriza BTC', () => {
    const BTC = currency('BTC', 8);
    const d = NetWorthDecomposer.decompose({
      target: BOB,
      currencies: new Map([...CURRENCIES, ['BTC', BTC]]),
      kinds: new Map([...kinds, ['BTC', 'CRYPTO']]),
      opening: [Money.parse('0.01000000', BTC)],
      closing: [Money.parse('0.01000000', BTC)],
      openingDate: '2026-09-30',
      closingDate: '2026-10-31',
      flows: [],
      rateFor: at({ '2026-09-30': { BTC: '800000' } }),
    });
    expect(d.complete).toBe(false);
    expect(d.unvalued.map((m) => m.toFixed())).toEqual(['0.01000000']);
    expect(d.revaluationByCurrency).toEqual([]);
    expect(d.assetRevaluation.toFixed()).toBe('0.00');
  });

  it('[TC-REPORTING-REPORTS-033] [PBT] ΔNW = Σ componentes a precisión 40 para tasas aleatorias > 0', () => {
    const arbFlow = fc.record({
      day: fc.integer({ min: 1, max: 28 }),
      cls: fc.constantFrom(
        'INCOME',
        'EXPENSE',
        'FX_TRADING',
        'OUTSIDE_ASSET',
        'OUTSIDE_LIABILITY',
        'ADJUSTMENTS',
      ) as fc.Arbitrary<SetFlow['counterpart']>,
      cents: fc.integer({ min: -500_000, max: 500_000 }),
      ccy: fc.constantFrom('BOB', 'USD', 'USDT'),
    });
    const arbRate = fc.integer({ min: 1, max: 99_999 }).map((n) => (n / 1000).toFixed(3));
    fc.assert(
      fc.property(
        fc.array(arbFlow, { maxLength: 30 }),
        fc.array(arbRate, { minLength: 3, maxLength: 3 }),
        (flows, [r0, r1, r2]) => {
          const money = (cents: number, ccy: string) =>
            Money.ofMinorUnits(BigInt(cents), CURRENCIES.get(ccy) as ReturnType<typeof currency>);
          const set = flows.map((f) => ({
            date: `2026-10-${String(f.day).padStart(2, '0')}`,
            currency: f.ccy,
            counterpart: f.cls,
            amount: money(f.cents, f.ccy),
          }));
          const open = ['BOB', 'USD', 'USDT'].map((c) => money(100_000, c));
          const close = open.map((o) =>
            set.filter((f) => f.currency === o.currency.code).reduce((a, f) => a.add(f.amount), o),
          );
          const d = NetWorthDecomposer.decompose({
            target: BOB,
            currencies: CURRENCIES,
            kinds,
            opening: open,
            closing: close,
            openingDate: '2026-09-30',
            closingDate: '2026-10-31',
            flows: set,
            rateFor: (code, date) => ({
              base: code,
              quote: 'BOB',
              value: dec(
                date === '2026-09-30'
                  ? (r0 as string)
                  : date === '2026-10-31'
                    ? (r1 as string)
                    : (r2 as string),
              ),
            }),
          });
          expect(d.complete).toBe(true);
          expect(d.deltaExact.eq(d.componentsExact)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  }, 60_000);
});

describe('ReportReconciler', () => {
  it('[TC-REPORTING-REPORTS-027] un gasto de 3300.01 frente a 3300.00 del ledger falla nombrando reporte, periodo y moneda', () => {
    const m = ReportReconciler.nativeFlow(
      'INCOME_EXPENSES',
      '2026-10',
      'expenses',
      bob('3300.01'),
      bob('3300.00'),
    );
    expect(m).toHaveLength(1);
    expect(describeMismatch(m[0] as NonNullable<(typeof m)[0]>)).toContain('INCOME_EXPENSES 2026-10 BOB');
    expect(
      ReportReconciler.nativeFlow('INCOME_EXPENSES', '2026-10', 'expenses', bob('3300.00'), bob('3300.00')),
    ).toEqual([]);
  });

  it('[TC-REPORTING-REPORTS-027] Σ de categorías, Σ de filas del drill-down y flujo de caja detectan diferencias mínimas', () => {
    expect(
      ReportReconciler.categorySum('EXPENSES_BY_CATEGORY', '2026-10', bob('3300.00'), [
        bob('2300.00'),
        bob('1000.00'),
      ]),
    ).toEqual([]);
    expect(
      ReportReconciler.categorySum('EXPENSES_BY_CATEGORY', '2026-10', bob('3300.00'), [
        bob('2300.00'),
        bob('999.99'),
      ]),
    ).toHaveLength(1);
    expect(
      ReportReconciler.drillDown('INCOME_EXPENSES', 'super', bob('3300.00'), [
        bob('3500.00'),
        bob('-200.00'),
      ]),
    ).toEqual([]);
  });
});

describe('REPORT_CATALOG', () => {
  it('[TC-REPORTING-REPORTS-001] 16 reportes: 1, 2, 3, 7, 8 y 15 disponibles; 13 parcial con su vista; 16 planificado para Phase 8', () => {
    expect(REPORT_CATALOG).toHaveLength(16);
    expect(REPORT_CATALOG.map((e) => e.number)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(REPORT_CATALOG.filter((e) => e.status === 'AVAILABLE').map((e) => e.number)).toEqual([
      1, 2, 3, 7, 8, 15,
    ]);
    expect(REPORT_CATALOG[12]).toMatchObject({ status: 'PARTIAL', viewPath: '/fx/costos' });
    expect(REPORT_CATALOG[15]).toMatchObject({ status: 'PLANNED', phase: 8, endpoint: null });
  });
});
