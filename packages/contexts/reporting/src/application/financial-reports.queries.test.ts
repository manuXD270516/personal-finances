import { DomainError, Instant } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { FinancialReportsQueries } from './financial-reports.queries.js';
import { InMemoryFinancialReports, type PortionFact } from './testing/in-memory-reports.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const USER = '0190a000-0000-7000-8000-000000000001';
const BANCO = '0190a000-0000-7000-8000-0000000000b1';
const EFECTIVO = '0190a000-0000-7000-8000-0000000000b2';
const TARJETA = '0190a000-0000-7000-8000-0000000000b3';
const PLAZO = '0190a000-0000-7000-8000-0000000000b4';
const USDACC = '0190a000-0000-7000-8000-0000000000b5';
const SUPER = '0190a000-0000-7000-8000-0000000000c1';
const MAYORISTA = '0190a000-0000-7000-8000-0000000000c2';
const REST = '0190a000-0000-7000-8000-0000000000c3';
const SUELDO = '0190a000-0000-7000-8000-0000000000c4';
const GROUP = '0190a000-0000-7000-8000-0000000000d1';

let mem: InMemoryFinancialReports;
let q: FinancialReportsQueries;
const base = { userId: USER, workspaceId: WS };
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const usd = (amount: string) => ({ amount, currency: 'USD' });

let seq = 0;
function portion(
  date: string,
  nature: 'INCOME' | 'EXPENSE',
  categoryId: string,
  amount: { amount: string; currency: string },
  over: Partial<PortionFact> = {},
) {
  seq += 1;
  const id = `0190a000-0000-7000-8000-${String(seq).padStart(12, '0')}`;
  mem.portions.push({
    transactionId: `0190a111-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    splitId: id,
    businessDate: date,
    nature,
    categoryId,
    accountId: BANCO,
    counterpartyId: null,
    description: null,
    amount,
    tagIds: [],
    ...over,
  });
}

/** Octubre de 2026 de los scenarios: sueldo, supermercado, reembolso, gasto en USD, tarjeta, plazo fijo y efectivo. */
function october() {
  mem.clock.set(Instant.parse('2026-11-15T16:00:00Z'));
  mem.addAccount({ accountId: BANCO, name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, null);
  mem.addAccount({ accountId: EFECTIVO, name: 'Efectivo', type: 'CASH', currency: 'BOB' }, null);
  mem.addAccount({ accountId: TARJETA, name: 'Tarjeta Andina', type: 'CREDIT_CARD', currency: 'BOB' }, null);
  mem.addAccount({ accountId: PLAZO, name: 'Plazo fijo', type: 'INVESTMENT', currency: 'BOB' }, null);
  mem.addAccount(
    { accountId: USDACC, name: 'Cuenta USD', type: 'BANK', currency: 'USD', liquidity: 'ILLIQUID' },
    null,
  );
  mem.tree = {
    groups: [{ groupId: GROUP, name: 'Alimentación', kind: 'EXPENSE', archived: false }],
    categories: [
      {
        categoryId: SUPER,
        name: 'Supermercado',
        kind: 'EXPENSE',
        groupId: GROUP,
        parentId: null,
        systemCode: null,
        archived: false,
      },
      {
        categoryId: MAYORISTA,
        name: 'Mayorista',
        kind: 'EXPENSE',
        groupId: GROUP,
        parentId: SUPER,
        systemCode: null,
        archived: false,
      },
      {
        categoryId: REST,
        name: 'Restaurantes',
        kind: 'EXPENSE',
        groupId: GROUP,
        parentId: null,
        systemCode: null,
        archived: false,
      },
      {
        categoryId: SUELDO,
        name: 'Sueldo',
        kind: 'INCOME',
        groupId: GROUP,
        parentId: null,
        systemCode: null,
        archived: false,
      },
    ],
    tags: [],
  };
  const sys = (k: string) => `SYSTEM:${k}`;
  mem.firstEntryDate = '2026-09-01';
  mem.entry('e0', '2026-09-01', [
    { account: BANCO, currency: 'BOB', amount: '10000.00' },
    { account: sys('OPENING_BALANCE'), currency: 'BOB', amount: '-10000.00' },
  ]);
  mem.entry('e1', '2026-10-05', [
    { account: BANCO, currency: 'BOB', amount: '12000.00' },
    { account: sys('INCOME'), currency: 'BOB', amount: '-12000.00' },
  ]);
  mem.entry('e2', '2026-10-10', [
    { account: BANCO, currency: 'BOB', amount: '-3500.00' },
    { account: sys('EXPENSE'), currency: 'BOB', amount: '3500.00' },
  ]);
  mem.entry('e3', '2026-10-12', [
    { account: BANCO, currency: 'BOB', amount: '200.00' },
    { account: sys('EXPENSE'), currency: 'BOB', amount: '-200.00' },
  ]);
  mem.entry('e4', '2026-10-15', [
    { account: USDACC, currency: 'USD', amount: '-50.00' },
    { account: sys('EXPENSE'), currency: 'USD', amount: '50.00' },
  ]);
  mem.entry('e5', '2026-10-20', [
    { account: BANCO, currency: 'BOB', amount: '-500.00' },
    { account: TARJETA, currency: 'BOB', amount: '500.00' },
  ]);
  mem.entry('e6', '2026-10-21', [
    { account: BANCO, currency: 'BOB', amount: '-1000.00' },
    { account: PLAZO, currency: 'BOB', amount: '1000.00' },
  ]);
  mem.entry('e7', '2026-10-22', [
    { account: BANCO, currency: 'BOB', amount: '-200.00' },
    { account: EFECTIVO, currency: 'BOB', amount: '200.00' },
  ]);
  portion('2026-10-05', 'INCOME', SUELDO, bob('12000.00'));
  portion('2026-10-10', 'EXPENSE', SUPER, bob('3500.00'));
  portion('2026-10-12', 'EXPENSE', SUPER, bob('-200.00'));
  portion('2026-10-15', 'EXPENSE', REST, usd('50.00'), { accountId: USDACC });
  mem.rates.push({ base: 'USD', quote: 'BOB', value: '10.00', asOf: '2026-10-15T20:00:00Z' });
}

const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : 'other';
  }
  return null;
};

beforeEach(() => {
  seq = 0;
  mem = new InMemoryFinancialReports();
  q = new FinancialReportsQueries(mem.financialDeps());
});

describe('GetIncomeExpensesReport', () => {
  it('[TC-REPORTING-REPORTS-005] octubre: nativo BOB 12000.00/3300.00 y USD 50.00; consolidado 12000.00/3800.00/8200.00 y 68.3 %', async () => {
    october();
    const { report } = await q.getIncomeExpenses({ ...base, from: '2026-10-01', to: '2026-10-31' });
    const row = report.rows[0]!;
    expect(row.income.byCurrency).toEqual([bob('12000.00')]);
    expect(row.expenses.byCurrency).toEqual([bob('3300.00'), usd('50.00')]);
    expect([row.income.consolidated, row.expenses.consolidated, row.savings.consolidated]).toEqual([
      bob('12000.00'),
      bob('3800.00'),
      bob('8200.00'),
    ]);
    expect(row.savingsRate).toBe('68.3');
    expect(report.meta).toMatchObject({ complete: true, reportingCurrency: 'BOB' });
    expect(report.meta.conversion).toMatchObject({ policy: 'TRANSACTION_DATE', rateWindowDays: 7 });
    expect(report.meta.conversion.ratesUsed.map((r) => r.rate.value)).toEqual(['10.00']);
  });

  it('[TC-REPORTING-REPORTS-002] el filtro por cuenta limita el gasto a la cuenta pedida (500.00 BOB de "Tarjeta Andina")', async () => {
    october();
    portion('2026-10-18', 'EXPENSE', REST, bob('500.00'), { accountId: TARJETA });
    const { report } = await q.getIncomeExpenses({
      ...base,
      from: '2026-10-01',
      to: '2026-10-31',
      accountIds: [TARJETA],
    });
    expect(report.rows[0]?.expenses.consolidated).toEqual(bob('500.00'));
    expect(report.meta.filters.accountIds).toEqual([TARJETA]);
  });

  it('[TC-REPORTING-REPORTS-002] el filtro por categoría incluye sus subcategorías', async () => {
    october();
    portion('2026-10-20', 'EXPENSE', MAYORISTA, bob('1000.00'));
    const { report } = await q.getIncomeExpenses({
      ...base,
      from: '2026-10-01',
      to: '2026-10-31',
      categoryIds: [SUPER],
    });
    expect(report.rows[0]?.expenses.consolidated).toEqual(bob('4300.00'));
  });

  it('[TC-REPORTING-REPORTS-002] un id de otro workspace o inexistente no coincide con nada y un id malformado se rechaza', async () => {
    october();
    const { report } = await q.getIncomeExpenses({
      ...base,
      from: '2026-10-01',
      to: '2026-10-31',
      accountIds: ['0190a000-0000-7000-8000-0000000000ff'],
    });
    expect(report.rows[0]?.expenses.consolidated).toEqual(bob('0.00'));
    expect(
      await code(() =>
        q.getIncomeExpenses({ ...base, from: '2026-10-01', to: '2026-10-31', accountIds: ['x'] }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-REPORTING-REPORTS-003] un rango de 25 periodos se rechaza con VALIDATION_FAILED', async () => {
    october();
    expect(await code(() => q.getIncomeExpenses({ ...base, from: '2024-10-01', to: '2026-10-31' }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('[TC-REPORTING-REPORTS-003] el mes financiero del día 25 y el mes calendario asignan distinto el gasto del 2026-10-27', async () => {
    october();
    mem.fiscalMonthStartDay = 25;
    q = new FinancialReportsQueries(mem.financialDeps());
    portion('2026-10-27', 'EXPENSE', REST, bob('120.00'));
    const fin = await q.getIncomeExpenses({ ...base, from: '2026-10-25', to: '2026-11-24' });
    expect(fin.report.rows[0]?.period).toMatchObject({ from: '2026-10-25', to: '2026-11-24' });
    expect(fin.report.rows[0]?.expenses.byCurrency).toEqual([bob('120.00')]);
    const cal = await q.getIncomeExpenses({
      ...base,
      from: '2026-10-01',
      to: '2026-10-31',
      grouping: 'CALENDAR_MONTH',
    });
    expect(cal.report.rows[0]?.expenses.byCurrency[0]).toEqual(bob('3420.00'));
  });

  it('[TC-REPORTING-REPORTS-005] un mes sin ingresos informa ahorro −150.00 BOB y tasa de ahorro sin definir', async () => {
    october();
    portion('2026-11-03', 'EXPENSE', REST, bob('150.00'));
    const { report } = await q.getIncomeExpenses({ ...base, from: '2026-11-01', to: '2026-11-30' });
    expect(report.rows[0]?.savings.consolidated).toEqual(bob('-150.00'));
    expect(report.rows[0]?.savingsRate).toBeNull();
    expect(report.rows[0]?.period.partial).toBe(true);
  });

  it('[TC-REPORTING-REPORTS-005] la granularidad semanal informa 500.00 BOB en la semana del 2026-10-12', async () => {
    october();
    const { report } = await q.getIncomeExpenses({
      ...base,
      from: '2026-10-12',
      to: '2026-10-18',
      granularity: 'WEEK',
      accountIds: [USDACC],
    });
    expect(report.rows[0]?.period).toMatchObject({ label: '2026-W42', from: '2026-10-12', to: '2026-10-18' });
    expect(report.rows[0]?.expenses.consolidated).toEqual(bob('500.00'));
  });

  it('[TC-REPORTING-REPORTS-010] octubre contra septiembre: variación del gasto 800.00 BOB y 26.67 %; contra el año anterior −200.00 y −5.00 %', async () => {
    october();
    portion('2026-09-10', 'EXPENSE', REST, bob('3000.00'));
    portion('2025-10-10', 'EXPENSE', REST, bob('4000.00'));
    const mom = await q.getIncomeExpenses({
      ...base,
      from: '2026-10-01',
      to: '2026-10-31',
      compare: 'PREVIOUS_PERIOD',
    });
    expect(mom.report.rows[0]?.comparison?.expenses).toMatchObject({
      deltaAbs: bob('800.00'),
      deltaPct: '26.67',
      isNew: false,
    });
    expect(mom.report.meta.comparison).toMatchObject({
      mode: 'PREVIOUS_PERIOD',
      from: '2026-09-01',
      to: '2026-09-30',
    });
    const yoy = await q.getIncomeExpenses({
      ...base,
      from: '2026-10-01',
      to: '2026-10-31',
      compare: 'PREVIOUS_YEAR',
    });
    expect(yoy.report.rows[0]?.comparison?.expenses).toMatchObject({
      deltaAbs: bob('-200.00'),
      deltaPct: '-5.00',
    });
  });

  it('[TC-REPORTING-REPORTS-011] 10 días contra un mes normalizados por día: 100.00 por día y variación 0.00; sin normalizar −2000.00 y días 10 y 30', async () => {
    october();
    mem.portions.length = 0;
    portion('2026-10-05', 'EXPENSE', REST, bob('1000.00'));
    portion('2026-09-05', 'EXPENSE', REST, bob('3000.00'));
    const custom = {
      ...base,
      from: '2026-10-01',
      to: '2026-10-10',
      compare: 'CUSTOM' as const,
      compareFrom: '2026-09-01',
      compareTo: '2026-09-30',
    };
    const norm = await q.getIncomeExpenses({ ...custom, normalize: 'PER_DAY' });
    expect(norm.report.totals.expenses.consolidated).toEqual(bob('100.00'));
    expect(norm.report.totals.comparison?.expenses.compared.consolidated).toEqual(bob('100.00'));
    expect(norm.report.totals.comparison?.expenses.deltaAbs).toEqual(bob('0.00'));
    const raw = await q.getIncomeExpenses(custom);
    expect(raw.report.totals.comparison?.expenses.deltaAbs).toEqual(bob('-2000.00'));
    expect(raw.report.meta.comparison).toMatchObject({ days: 30, currentDays: 10, normalized: false });
  });

  it('[TC-REPORTING-REPORTS-012] promedio móvil de 3: línea base 3100.00 BOB y variación 700.00 y 22.58 %; con historial corto es insuficiente', async () => {
    october();
    mem.portions.length = 0;
    for (const [d, v] of [
      ['2026-07-10', '3000.00'],
      ['2026-08-10', '3300.00'],
      ['2026-09-10', '3000.00'],
      ['2026-10-10', '3800.00'],
    ] as const) {
      portion(d, 'EXPENSE', REST, bob(v));
    }
    mem.firstEntryDate = '2026-06-01';
    const ok = await q.getIncomeExpenses({ ...base, from: '2026-10-01', to: '2026-10-31', rolling: 3 });
    expect(ok.report.rows[0]?.baseline?.expenses).toMatchObject({
      average: bob('3100.00'),
      deltaAbs: bob('700.00'),
      deltaPct: '22.58',
      insufficient: false,
    });
    mem.firstEntryDate = '2026-08-03';
    const short = await q.getIncomeExpenses({ ...base, from: '2026-10-01', to: '2026-10-31', rolling: 3 });
    expect(short.report.rows[0]?.baseline?.expenses).toMatchObject({ insufficient: true, average: null });
  });

  it('[TC-REPORTING-REPORTS-013] a la fecha: el 15 de octubre compara 1800.00 con 1500.00 de septiembre, 300.00 BOB y 20.00 %', async () => {
    october();
    mem.clock.set(Instant.parse('2026-10-15T16:00:00Z'));
    mem.portions.length = 0;
    portion('2026-10-10', 'EXPENSE', REST, bob('1800.00'));
    portion('2026-10-20', 'EXPENSE', REST, bob('999.00'));
    portion('2026-09-12', 'EXPENSE', REST, bob('1500.00'));
    portion('2026-09-20', 'EXPENSE', REST, bob('999.00'));
    const { report } = await q.getIncomeExpenses({
      ...base,
      from: '2026-10-01',
      to: '2026-10-31',
      compare: 'PREVIOUS_PERIOD_TO_DATE',
    });
    expect(report.rows[0]?.comparison?.expenses).toMatchObject({
      deltaAbs: bob('300.00'),
      deltaPct: '20.00',
    });
    expect(report.meta.comparison).toMatchObject({ from: '2026-09-01', to: '2026-09-15' });
  });

  it('[TC-REPORTING-REPORTS-015] en dólares: el ingreso consolidado es 1200.00 USD y el nativo sigue siendo 12000.00 BOB; EUR no habilitada se rechaza', async () => {
    october();
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '10.00', asOf: '2026-10-05T20:00:00Z' });
    const { report } = await q.getIncomeExpenses({
      ...base,
      from: '2026-10-01',
      to: '2026-10-31',
      reportingCurrency: 'USD',
    });
    expect(report.rows[0]?.income.consolidated).toEqual(usd('1200.00'));
    expect(report.rows[0]?.income.byCurrency).toEqual([bob('12000.00')]);
    expect(
      await code(() =>
        q.getIncomeExpenses({ ...base, from: '2026-10-01', to: '2026-10-31', reportingCurrency: 'EUR' }),
      ),
    ).toBe('CURRENCY_NOT_ENABLED');
  });

  it('[TC-REPORTING-REPORTS-016] un gasto de 20.000000 USDT sin tasa queda fuera del consolidado, incompleto, y visible en nativo', async () => {
    october();
    portion('2026-10-20', 'EXPENSE', REST, { amount: '20.000000', currency: 'USDT' });
    const { report } = await q.getIncomeExpenses({ ...base, from: '2026-10-01', to: '2026-10-31' });
    expect(report.rows[0]?.expenses.consolidated).toEqual(bob('3800.00'));
    expect(report.rows[0]?.expenses.complete).toBe(false);
    expect(report.rows[0]?.expenses.unconverted).toEqual([{ amount: '20.000000', currency: 'USDT' }]);
    expect(report.rows[0]?.expenses.byCurrency).toContainEqual({ amount: '20.000000', currency: 'USDT' });
    expect(report.meta).toMatchObject({
      complete: false,
      unconverted: [{ amount: '20.000000', currency: 'USDT' }],
    });
  });

  it('[TC-REPORTING-REPORTS-017] a la fecha de corte el gasto de 50.00 USD se valora en 525.00 BOB y se declara la política', async () => {
    october();
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '10.50', asOf: '2026-10-31T20:00:00Z' });
    const { report } = await q.getIncomeExpenses({
      ...base,
      from: '2026-10-01',
      to: '2026-10-31',
      conversion: 'CUTOFF',
    });
    expect(report.rows[0]?.expenses.consolidated).toEqual(bob('3825.00'));
    expect(report.meta.conversion).toMatchObject({ policy: 'CUTOFF_DATE', cutoffDate: '2026-10-31' });
    expect(report.rows[0]?.expenses.byCurrency).toEqual([bob('3300.00'), usd('50.00')]);
  });

  it('[TC-REPORTING-REPORTS-032] mide la duración por reporte con la etiqueta del reporte', async () => {
    october();
    await q.getIncomeExpenses({ ...base, from: '2026-10-01', to: '2026-10-31' });
    expect(mem.durations).toEqual([
      expect.objectContaining({ name: 'reporting_report_duration_seconds', report: 'INCOME_EXPENSES' }),
    ]);
  });

  it('[TC-REPORTING-REPORTS-024] la lectura inmediata tras registrar incluye el gasto nuevo (lectura de la fuente de verdad)', async () => {
    october();
    const before = await q.getIncomeExpenses({
      ...base,
      from: '2026-10-01',
      to: '2026-10-31',
      categoryIds: [SUPER],
    });
    portion('2026-10-20', 'EXPENSE', SUPER, bob('80.00'));
    const after = await q.getIncomeExpenses({
      ...base,
      from: '2026-10-01',
      to: '2026-10-31',
      categoryIds: [SUPER],
    });
    expect(before.report.rows[0]?.expenses.consolidated).toEqual(bob('3300.00'));
    expect(after.report.rows[0]?.expenses.consolidated).toEqual(bob('3380.00'));
  });
});

describe('GetExpensesByCategoryReport', () => {
  it('[TC-REPORTING-REPORTS-006] el grupo Alimentación suma 3800.00 con Supermercado 3300.00 y Restaurantes 500.00 (50.00 USD a 10.00)', async () => {
    october();
    const { report } = await q.getExpensesByCategory({ ...base, from: '2026-10-01', to: '2026-10-31' });
    const g = report.groups[0]!;
    expect(g.amount.consolidated).toEqual(bob('3800.00'));
    expect(g.categories.map((c) => [c.name, c.amount.consolidated.amount])).toEqual([
      ['Supermercado', '3300.00'],
      ['Restaurantes', '500.00'],
    ]);
    expect(report.total.consolidated).toEqual(bob('3800.00'));
  });

  it('[TC-REPORTING-REPORTS-006] top 1 informa Supermercado y "Otras categorías" 500.00 BOB', async () => {
    october();
    const { report } = await q.getExpensesByCategory({
      ...base,
      from: '2026-10-01',
      to: '2026-10-31',
      topN: 1,
    });
    expect(report.groups[0]?.categories.map((c) => c.name)).toEqual(['Supermercado']);
    expect(report.others?.consolidated).toEqual(bob('500.00'));
  });

  it('[TC-REPORTING-REPORTS-010] la comparación marca una categoría nueva ("Mascotas": 150.00 BOB, nuevo)', async () => {
    october();
    portion('2026-10-20', 'EXPENSE', REST, bob('150.00'));
    const { report } = await q.getExpensesByCategory({
      ...base,
      from: '2026-10-01',
      to: '2026-10-31',
      compare: 'PREVIOUS_PERIOD',
    });
    const rest = report.groups[0]?.categories.find((c) => c.name === 'Restaurantes');
    expect(rest?.comparison).toMatchObject({ isNew: true, deltaPct: null });
  });

  it('[TC-REPORTING-REPORTS-006] un neto negativo conserva su signo y queda marcado', async () => {
    october();
    mem.portions.length = 0;
    portion('2026-10-03', 'EXPENSE', REST, bob('100.00'));
    portion('2026-10-20', 'EXPENSE', REST, bob('-300.00'));
    const { report } = await q.getExpensesByCategory({ ...base, from: '2026-10-01', to: '2026-10-31' });
    expect(report.groups[0]?.categories[0]).toMatchObject({
      amount: { consolidated: bob('-200.00') },
      negativeNet: true,
    });
  });
});

describe('GetBudgetVsActualReport', () => {
  const budgeted = {
    budgetId: 'b-09',
    currency: 'BOB',
    lines: [
      {
        budgetLineId: 'l1',
        target: { kind: 'CATEGORY', id: SUPER },
        nature: 'EXPENSE',
        kind: 'MAXIMUM',
        reference: bob('3000.00'),
        actual: bob('3200.00'),
        actualComplete: true,
        status: 'OVER',
      },
    ],
    totals: {
      planned: bob('3000.00'),
      actual: bob('3200.00'),
      remaining: bob('0.00'),
      availableToSpend: bob('0.00'),
      complete: true,
      unconverted: [],
    },
    ratesUsed: [],
  };

  it('[TC-REPORTING-REPORTS-007] septiembre con presupuesto (3000.00 / 3200.00 excedido) y octubre sin presupuesto; llamadas secuenciales a PLANNING', async () => {
    october();
    mem.addPeriod('2026-09', '2026-09-01', '2026-09-30');
    mem.addPeriod('2026-10', '2026-10-01', '2026-10-31');
    mem.budgetByPeriod.set('period-2026-09', budgeted);
    const { report } = await q.getBudgetVsActual({ ...base, from: '2026-09-01', to: '2026-10-31' });
    expect(report.periods.map((p) => [p.period.label, p.status])).toEqual([
      ['2026-09', 'BUDGETED'],
      ['2026-10', 'NO_BUDGET'],
    ]);
    expect(report.periods[0]?.lines[0]).toMatchObject({
      target: { name: 'Supermercado' },
      reference: bob('3000.00'),
      actual: bob('3200.00'),
      status: 'OVER',
    });
    expect(report.periods[1]).toMatchObject({ lines: [], totals: null });
    expect(mem.budgetCalls).toEqual(['period-2026-09', 'period-2026-10']);
  });

  it('[TC-REPORTING-REPORTS-007] agrupar por mes calendario se rechaza con VALIDATION_FAILED', async () => {
    october();
    expect(
      await code(() =>
        q.getBudgetVsActual({ ...base, from: '2026-09-01', to: '2026-10-31', grouping: 'CALENDAR_MONTH' }),
      ),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('GetCashFlowReport', () => {
  it('[TC-REPORTING-REPORTS-008] octubre: inicial 10000.00, operativo 8700.00, deuda −500.00, ahorro e inversión −1000.00, cambio 0.00 y final 17200.00; la transferencia interna no es flujo', async () => {
    october();
    const { report } = await q.getCashFlow({ ...base, from: '2026-10-01', to: '2026-10-31' });
    const bobBlock = report.periods[0]?.byCurrency.find((b) => b.currency === 'BOB');
    expect(bobBlock).toMatchObject({
      opening: bob('10000.00'),
      operating: bob('8700.00'),
      debt: bob('-500.00'),
      savingsInvestments: bob('-1000.00'),
      currencyExchange: bob('0.00'),
      adjustments: bob('0.00'),
      closing: bob('17200.00'),
    });
    expect(report.periods[0]?.consolidated).toMatchObject({
      closing: bob('17200.00'),
      revaluation: bob('0.00'),
      complete: true,
    });
  });

  it('[TC-REPORTING-REPORTS-008] la cuota de préstamo aporta −1100.00 a deuda y −400.00 a operativo', async () => {
    october();
    mem.entries.length = 0;
    mem.entry('loan', '2026-10-10', [
      { account: BANCO, currency: 'BOB', amount: '-1500.00' },
      { account: TARJETA, currency: 'BOB', amount: '1100.00' },
      { account: 'SYSTEM:EXPENSE', currency: 'BOB', amount: '400.00' },
    ]);
    const { report } = await q.getCashFlow({ ...base, from: '2026-10-01', to: '2026-10-31' });
    expect(report.periods[0]?.byCurrency[0]).toMatchObject({
      debt: bob('-1100.00'),
      operating: bob('-400.00'),
    });
  });

  it('[TC-REPORTING-REPORTS-008] conversión entre líquidas: cambio de moneda 1190.00 BOB y −100.000000 USDT; consolidado −10.00 BOB', async () => {
    october();
    const WALLET = '0190a000-0000-7000-8000-0000000000b6';
    mem.addAccount(
      {
        accountId: WALLET,
        name: 'Wallet USDT',
        type: 'CRYPTO_WALLET',
        currency: 'USDT',
        liquidity: 'LIQUID',
      },
      null,
    );
    mem.entries.length = 0;
    mem.entry('open', '2026-09-01', [
      { account: WALLET, currency: 'USDT', amount: '100.000000' },
      { account: 'SYSTEM:OPENING_BALANCE', currency: 'USDT', amount: '-100.000000' },
    ]);
    mem.entry('fx', '2026-10-10', [
      { account: WALLET, currency: 'USDT', amount: '-100.000000' },
      { account: 'SYSTEM:FX_TRADING', currency: 'USDT', amount: '100.000000' },
      { account: 'SYSTEM:FX_TRADING', currency: 'BOB', amount: '-1190.00' },
      { account: BANCO, currency: 'BOB', amount: '1190.00' },
    ]);
    mem.rates.push(
      { base: 'USDT', quote: 'BOB', value: '12.00', asOf: '2026-10-09T20:00:00Z' },
      { base: 'USDT', quote: 'BOB', value: '12.00', asOf: '2026-09-29T20:00:00Z' },
      { base: 'USDT', quote: 'BOB', value: '12.00', asOf: '2026-10-30T20:00:00Z' },
    );
    const { report } = await q.getCashFlow({ ...base, from: '2026-10-01', to: '2026-10-31' });
    const p = report.periods[0]!;
    expect(p.byCurrency.map((b) => [b.currency, b.currencyExchange.amount])).toEqual([
      ['BOB', '1190.00'],
      ['USDT', '-100.000000'],
    ]);
    expect(p.consolidated.currencyExchange).toEqual(bob('-10.00'));
  });
});

describe('GetAccountBalanceHistoryReport', () => {
  it('[TC-REPORTING-REPORTS-009] octubre de Banco BOB: 10000.00 hasta el día 4, 22000.00, 18500.00 y 18700.00 al cierre con la marca de conciliación del día 10', async () => {
    october();
    mem.entries.length = 0;
    mem.entry('o', '2026-09-01', [
      { account: BANCO, currency: 'BOB', amount: '10000.00' },
      { account: 'SYSTEM:OPENING_BALANCE', currency: 'BOB', amount: '-10000.00' },
    ]);
    mem.entry('a', '2026-10-05', [
      { account: BANCO, currency: 'BOB', amount: '12000.00' },
      { account: 'SYSTEM:INCOME', currency: 'BOB', amount: '-12000.00' },
    ]);
    mem.entry('b', '2026-10-10', [
      { account: BANCO, currency: 'BOB', amount: '-3500.00' },
      { account: 'SYSTEM:EXPENSE', currency: 'BOB', amount: '3500.00' },
    ]);
    mem.entry('c', '2026-10-12', [
      { account: BANCO, currency: 'BOB', amount: '200.00' },
      { account: 'SYSTEM:EXPENSE', currency: 'BOB', amount: '-200.00' },
    ]);
    mem.reconciledDates.set(BANCO, ['2026-10-10']);
    const { report } = await q.getAccountBalanceHistory({
      ...base,
      accountId: BANCO,
      from: '2026-10-01',
      to: '2026-10-31',
    });
    const at = (d: string) => report.days.find((x) => x.date === d)!;
    expect(report.opening).toEqual(bob('10000.00'));
    expect([
      at('2026-10-04').balance,
      at('2026-10-09').balance,
      at('2026-10-11').balance,
      report.closing,
    ]).toEqual([bob('10000.00'), bob('22000.00'), bob('18500.00'), bob('18700.00')]);
    expect(at('2026-10-10')).toMatchObject({ reconciled: true, hasMovements: true });
    expect(at('2026-10-11').hasMovements).toBe(false);
    expect(report.days).toHaveLength(31);
  });

  it('[TC-REPORTING-REPORTS-025] una cuenta inexistente o de otro workspace es 404 y más de 731 días es VALIDATION_FAILED', async () => {
    october();
    expect(
      await code(() =>
        q.getAccountBalanceHistory({
          ...base,
          accountId: '0190a000-0000-7000-8000-0000000000fe',
          from: '2026-10-01',
          to: '2026-10-31',
        }),
      ),
    ).toBe('RESOURCE_NOT_FOUND');
    expect(
      await code(() =>
        q.getAccountBalanceHistory({ ...base, accountId: BANCO, from: '2024-01-01', to: '2026-10-31' }),
      ),
    ).toBe('VALIDATION_FAILED');
  });
});

describe('GetNetWorthReport', () => {
  it('[TC-REPORTING-REPORTS-033] octubre: ahorro 8200.00 BOB, revalorización cambiaria 50.00 (USD) y de activos 500.00 (USDT); patrimonio 23000.00 a 31750.00', async () => {
    october();
    const WALLET = '0190a000-0000-7000-8000-0000000000b6';
    mem.addAccount({ accountId: WALLET, name: 'Wallet USDT', type: 'CRYPTO_WALLET', currency: 'USDT' }, null);
    mem.entries.length = 0;
    mem.portions.length = 0;
    mem.entry('o1', '2026-09-01', [
      { account: BANCO, currency: 'BOB', amount: '10000.00' },
      { account: 'SYSTEM:OPENING_BALANCE', currency: 'BOB', amount: '-10000.00' },
    ]);
    mem.entry('o2', '2026-09-01', [
      { account: USDACC, currency: 'USD', amount: '100.00' },
      { account: 'SYSTEM:OPENING_BALANCE', currency: 'USD', amount: '-100.00' },
    ]);
    mem.entry('o3', '2026-09-01', [
      { account: WALLET, currency: 'USDT', amount: '1000.000000' },
      { account: 'SYSTEM:OPENING_BALANCE', currency: 'USDT', amount: '-1000.000000' },
    ]);
    mem.entry('s1', '2026-10-05', [
      { account: BANCO, currency: 'BOB', amount: '12000.00' },
      { account: 'SYSTEM:INCOME', currency: 'BOB', amount: '-12000.00' },
    ]);
    mem.entry('s2', '2026-10-10', [
      { account: BANCO, currency: 'BOB', amount: '-3800.00' },
      { account: 'SYSTEM:EXPENSE', currency: 'BOB', amount: '3800.00' },
    ]);
    mem.rates.length = 0;
    mem.rates.push(
      { base: 'USD', quote: 'BOB', value: '10.00', asOf: '2026-09-30T20:00:00Z' },
      { base: 'USDT', quote: 'BOB', value: '12.00', asOf: '2026-09-30T20:00:00Z' },
      { base: 'USD', quote: 'BOB', value: '10.50', asOf: '2026-10-31T20:00:00Z' },
      { base: 'USDT', quote: 'BOB', value: '12.50', asOf: '2026-10-31T20:00:00Z' },
    );
    const { report } = await q.getNetWorth({ ...base, from: '2026-10-01', to: '2026-10-31' });
    const d = report.decomposition[0]!;
    expect([d.opening, d.closing, d.savings, d.fxRevaluation, d.assetRevaluation]).toEqual([
      bob('23000.00'),
      bob('31750.00'),
      bob('8200.00'),
      bob('50.00'),
      bob('500.00'),
    ]);
    expect(d.revaluationByCurrency.map((r) => [r.currency, r.kind])).toEqual([
      ['USD', 'FX'],
      ['USDT', 'ASSET'],
    ]);
    expect(report.points[0]?.netWorth.consolidated).toEqual(bob('31750.00'));
  });

  it('[TC-REPORTING-REPORTS-034] sin tasa de BTC la descomposición es incompleta, informa 0.01000000 BTC sin valorar y no revaloriza BTC', async () => {
    october();
    const BTC_ACC = '0190a000-0000-7000-8000-0000000000b7';
    mem.addAccount({ accountId: BTC_ACC, name: 'Wallet BTC', type: 'CRYPTO_WALLET', currency: 'BTC' }, null);
    mem.entries.length = 0;
    mem.entry('b', '2026-09-01', [
      { account: BTC_ACC, currency: 'BTC', amount: '0.01000000' },
      { account: 'SYSTEM:OPENING_BALANCE', currency: 'BTC', amount: '-0.01000000' },
    ]);
    const { report } = await q.getNetWorth({ ...base, from: '2026-10-01', to: '2026-10-31' });
    expect(report.decomposition[0]).toMatchObject({
      complete: false,
      unvalued: [{ amount: '0.01000000', currency: 'BTC' }],
      revaluationByCurrency: [],
    });
    expect(report.meta.complete).toBe(false);
  });

  it('[TC-REPORTING-REPORTS-036] la serie diaria informa 23000.00 el 2026-10-04 y 35000.00 el 2026-10-05', async () => {
    october();
    mem.entries.length = 0;
    mem.entry('o', '2026-09-01', [
      { account: BANCO, currency: 'BOB', amount: '23000.00' },
      { account: 'SYSTEM:OPENING_BALANCE', currency: 'BOB', amount: '-23000.00' },
    ]);
    mem.entry('s', '2026-10-05', [
      { account: BANCO, currency: 'BOB', amount: '12000.00' },
      { account: 'SYSTEM:INCOME', currency: 'BOB', amount: '-12000.00' },
    ]);
    const { report } = await q.getNetWorth({
      ...base,
      from: '2026-10-01',
      to: '2026-10-31',
      granularity: 'DAY',
    });
    const at = (d: string) => report.points.find((p) => p.date === d)?.netWorth.consolidated;
    expect([at('2026-10-04'), at('2026-10-05')]).toEqual([bob('23000.00'), bob('35000.00')]);
    expect(report.points).toHaveLength(31);
  });
});

describe('Catálogo', () => {
  it('[TC-REPORTING-REPORTS-001] lista 16 reportes con 6 disponibles', () => {
    const { reports } = q.getCatalog();
    expect(reports).toHaveLength(16);
    expect(reports.filter((r) => r.status === 'AVAILABLE')).toHaveLength(6);
  });
});
