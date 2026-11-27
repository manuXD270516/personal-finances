import { dec, DomainError, Instant } from '@pf/shared-kernel';
import type { ConversionCostRowDto } from '@pf/transactions/contracts';
import * as fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TREND_TOP_SERIES,
  TrendMatrix,
  type TrendFact,
  type TrendSeries,
} from '../domain/extended-reports.js';
import { FinancialReportsService } from './financial-reports.exports.js';
import { InMemoryFinancialReports, type PortionFact } from './testing/in-memory-reports.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const USER = '0190a000-0000-7000-8000-000000000001';
const BANCO = '0190a000-0000-7000-8000-0000000000b1';
const TARJETA = '0190a000-0000-7000-8000-0000000000b3';
const CREDITO = '0190a000-0000-7000-8000-0000000000b6';
const SUPER = '0190a000-0000-7000-8000-0000000000c1';
const REST = '0190a000-0000-7000-8000-0000000000c3';
const FEES = '0190a000-0000-7000-8000-0000000000c5';
const INTERES = '0190a000-0000-7000-8000-0000000000c7';
const SEGURO = '0190a000-0000-7000-8000-0000000000c8';
const ALOJA = '0190a000-0000-7000-8000-0000000000c6';
const GROUP = '0190a000-0000-7000-8000-0000000000d1';
const VIAJE = '0190a000-0000-7000-8000-0000000000e1';
const TRABAJO = '0190a000-0000-7000-8000-0000000000e2';
const BINANCE = '0190a000-0000-7000-8000-0000000000f1';

let mem: InMemoryFinancialReports;
let q: FinancialReportsService;
const base = { userId: USER, workspaceId: WS };
const bob = (amount: string) => ({ amount, currency: 'BOB' });
const usd = (amount: string) => ({ amount, currency: 'USD' });

let seq = 0;
function portion(
  date: string,
  categoryId: string,
  amount: { amount: string; currency: string },
  over: Partial<PortionFact> = {},
) {
  seq += 1;
  mem.portions.push({
    transactionId: `0190a111-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    splitId: `0190a000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    businessDate: date,
    nature: 'EXPENSE',
    categoryId,
    accountId: BANCO,
    counterpartyId: null,
    description: null,
    amount,
    tagIds: [],
    ...over,
  });
}

function world() {
  mem.clock.set(Instant.parse('2026-11-15T16:00:00Z'));
  mem.addAccount({ accountId: BANCO, name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, null);
  mem.addAccount({ accountId: TARJETA, name: 'Tarjeta Andina', type: 'CREDIT_CARD', currency: 'BOB' }, null);
  mem.addAccount({ accountId: CREDITO, name: 'Crédito auto', type: 'LOAN', currency: 'BOB' }, null);
  const cat = (categoryId: string, name: string, over: object = {}) => ({
    categoryId,
    name,
    kind: 'EXPENSE' as const,
    groupId: GROUP,
    parentId: null,
    systemCode: null,
    archived: false,
    ...over,
  });
  mem.tree = {
    groups: [{ groupId: GROUP, name: 'Gastos', kind: 'EXPENSE', archived: false }],
    categories: [
      cat(SUPER, 'Supermercado'),
      cat(REST, 'Restaurantes'),
      cat(ALOJA, 'Alojamiento'),
      cat(FEES, 'Comisiones bancarias', { systemCode: 'FEES' }),
      cat(INTERES, 'Intereses pagados', { systemCode: 'INTEREST' }),
      cat(SEGURO, 'Seguros', { systemCode: 'INSURANCE' }),
    ],
    tags: [
      { tagId: VIAJE, name: 'Viaje Cusco', archived: false },
      { tagId: TRABAJO, name: 'Trabajo', archived: true },
    ],
  };
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
  world();
  q = new FinancialReportsService(mem.financialDeps());
});

const OCT = { from: '2026-10-01', to: '2026-10-31' };

describe('getExpensesByTag (TC-REPORTING-REPORTS-039)', () => {
  beforeEach(() => {
    portion('2026-10-05', ALOJA, bob('800.00'), { tagIds: [VIAJE, TRABAJO] });
    portion('2026-10-06', REST, bob('200.00'), { tagIds: [VIAJE] });
  });

  it('[TC-REPORTING-REPORTS-039] Viaje Cusco 1000.00 y Trabajo 800.00 con aviso de no aditividad', async () => {
    const { report } = await q.getExpensesByTag({ ...base, ...OCT });
    expect(report.nonAdditive).toBe(true);
    expect(report.tags.map((t) => [t.name, t.amount.consolidated.amount, t.archived])).toEqual([
      ['Viaje Cusco', '1000.00', false],
      ['Trabajo', '800.00', true],
    ]);
    expect(report.meta.reportId).toBe('EXPENSES_BY_TAG');
  });

  it('[TC-REPORTING-REPORTS-039] con coincidencia con todas el gasto informado es 800.00 BOB', async () => {
    const { report } = await q.getExpensesByTag({
      ...base,
      ...OCT,
      tagIds: [VIAJE, TRABAJO],
      tagMatch: 'ALL',
    });
    expect(report.tagMatch).toBe('ALL');
    expect(report.tags.map((t) => t.amount.consolidated.amount)).toEqual(['800.00', '800.00']);
  });

  it('[TC-REPORTING-REPORTS-039] compara con el periodo anterior y rechaza ALL sin etiquetas', async () => {
    portion('2026-09-10', REST, bob('100.00'), { tagIds: [VIAJE] });
    const { report } = await q.getExpensesByTag({ ...base, ...OCT, compare: 'PREVIOUS_PERIOD' });
    const viaje = report.tags.find((t) => t.tagId === VIAJE);
    expect(viaje?.comparison).toMatchObject({ deltaAbs: bob('900.00') });
    expect(await code(() => q.getExpensesByTag({ ...base, ...OCT, tagMatch: 'ALL' }))).toBe(
      'VALIDATION_FAILED',
    );
  });
});

describe('getExpensesByAccount (TC-REPORTING-REPORTS-040)', () => {
  it('[TC-REPORTING-REPORTS-040] Banco BOB 3300.00 y Tarjeta Andina 500.00 suman el gasto de 3800.00 con tipo e institución', async () => {
    portion('2026-10-10', SUPER, bob('3300.00'));
    portion('2026-10-18', REST, bob('500.00'), { accountId: TARJETA });
    const { report } = await q.getExpensesByAccount({ ...base, ...OCT });
    expect(report.accounts.map((a) => [a.name, a.type, a.amount.consolidated.amount])).toEqual([
      ['Banco BOB', 'BANK', '3300.00'],
      ['Tarjeta Andina', 'CREDIT_CARD', '500.00'],
    ]);
    expect(report.accounts[0]?.byCategory).toEqual([
      expect.objectContaining({ categoryId: SUPER, name: 'Supermercado' }),
    ]);
    expect(report.total.consolidated).toEqual(bob('3800.00'));
    const sum = report.accounts.reduce((n, a) => n.plus(a.amount.consolidated.amount), dec('0'));
    expect(sum.toFixed(2)).toBe('3800.00');
    // Los ingresos no son gasto de ninguna cuenta.
    portion('2026-10-05', SUPER, bob('12000.00'), { nature: 'INCOME' });
    expect((await q.getExpensesByAccount({ ...base, ...OCT })).report.total.consolidated).toEqual(
      bob('3800.00'),
    );
  });

  it('[TC-REPORTING-REPORTS-040] el gasto en dólares se consolida con la tasa de su fecha y la suma sigue cuadrando', async () => {
    portion('2026-10-10', SUPER, bob('300.00'));
    portion('2026-10-12', REST, usd('50.00'), { accountId: TARJETA });
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '10.00', asOf: '2026-10-12T20:00:00Z' });
    const { report } = await q.getExpensesByAccount({ ...base, ...OCT });
    expect(report.total.consolidated).toEqual(bob('800.00'));
    expect(report.accounts.map((a) => a.amount.consolidated.amount)).toEqual(['500.00', '300.00']);
    expect(report.meta.conversion.ratesUsed).toHaveLength(1);
  });
});

describe('getTrends (TC-REPORTING-REPORTS-041)', () => {
  it('[TC-REPORTING-REPORTS-041] febrero y marzo normalizados por día informan 100.00 BOB por día', async () => {
    portion('2026-02-10', SUPER, bob('2800.00'));
    portion('2026-03-10', SUPER, bob('3100.00'));
    const { report } = await q.getTrends({
      ...base,
      from: '2026-02-01',
      to: '2026-03-31',
      grouping: 'CALENDAR_MONTH',
      normalize: 'PER_DAY',
    });
    expect(report.normalized).toBe(true);
    expect(report.series[0]?.name).toBe('Supermercado');
    expect(report.series[0]?.cells.map((c) => c.amount.consolidated.amount)).toEqual(['100.00', '100.00']);
  });

  it('[TC-REPORTING-REPORTS-041] con nueve categorías informa 7 series más "Otras categorías"', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `0190a000-0000-7000-8000-00000000cc0${i + 1}`);
    mem.tree = {
      ...mem.tree,
      categories: ids.map((id, i) => ({
        categoryId: id,
        name: `Cat ${i + 1}`,
        kind: 'EXPENSE' as const,
        groupId: GROUP,
        parentId: null,
        systemCode: null,
        archived: false,
      })),
    };
    ids.forEach((id, i) => portion('2026-10-10', id, bob(`${(9 - i) * 100}.00`)));
    const { report } = await q.getTrends({ ...base, ...OCT });
    expect(report.series).toHaveLength(8);
    const others = report.series.at(-1)!;
    expect(others.categoryId).toBeNull();
    expect(others.total.consolidated).toEqual(bob('300.00'));
  });

  it('[TC-REPORTING-REPORTS-041] más de 24 periodos o una comparación se rechazan', async () => {
    expect(
      await code(() =>
        q.getTrends({ ...base, from: '2024-01-01', to: '2026-10-31', grouping: 'CALENDAR_MONTH' }),
      ),
    ).toBe('VALIDATION_FAILED');
    expect(await code(() => q.getTrends({ ...base, ...OCT, compare: 'PREVIOUS_PERIOD' }))).toBe(
      'VALIDATION_FAILED',
    );
  });
});

/**
 * Oráculo de TC-REPORTING-REPORTS-055: copia LITERAL de `TrendMatrix.build` de `main` 4cdc7689 (la definición funcional
 * anterior a `fix-trends-report-perf`), solo para este test. El mismo oráculo, con generadores de dominio, vive en
 * `domain/trend-matrix.equivalence.test.ts`.
 */
function oracleTrendBuild(input: Parameters<typeof TrendMatrix.build>[0]): readonly TrendSeries[] {
  const byAmountThenName = <T extends { amount: { exact: ReturnType<typeof dec> }; name: string }>(
    items: T[],
  ) => items.sort((a, b) => b.amount.exact.comparedTo(a.amount.exact) || a.name.localeCompare(b.name, 'es'));
  const top = new Map(input.categories.map((c) => [c.categoryId, c.topId]));
  const names = new Map(input.categories.map((c) => [c.categoryId, c.name]));
  const topOf = (id: string) => top.get(id) ?? id;
  const topIds = [...new Set(input.facts.map((f) => topOf(f.categoryId)))];
  const ranked = byAmountThenName(
    topIds.map((categoryId) => ({
      categoryId,
      name: names.get(categoryId) ?? categoryId,
      amount: input.policy.value(
        input.facts
          .filter((f) => topOf(f.categoryId) === categoryId)
          .map((f) => ({ date: f.date, amount: f.amount })),
      ),
    })),
  );
  const kept = ranked.slice(0, TREND_TOP_SERIES);
  const restIds = new Set(ranked.slice(TREND_TOP_SERIES).map((r) => r.categoryId));
  const cellsOf = (pick: (f: TrendFact) => boolean) =>
    input.periods.map((period) => ({
      period,
      amount: input.policy.value(
        input.facts
          .filter((f) => pick(f) && f.date >= period.from && f.date <= period.to)
          .map((f) => ({ date: f.date, amount: f.amount })),
        input.perDay ? period.days : undefined,
      ),
    }));
  const totalOf = (pick: (f: TrendFact) => boolean) =>
    input.policy.value(
      input.facts.filter(pick).map((f) => ({ date: f.date, amount: f.amount })),
      input.perDay ? input.periods.reduce((n, p) => n + p.days, 0) : undefined,
    );
  const series: TrendSeries[] = kept.map((k) => {
    const pick = (f: TrendFact) => topOf(f.categoryId) === k.categoryId;
    return { categoryId: k.categoryId, name: k.name, cells: cellsOf(pick), total: totalOf(pick) };
  });
  if (restIds.size > 0) {
    const pick = (f: TrendFact) => restIds.has(topOf(f.categoryId));
    series.push({ categoryId: null, name: input.othersName, cells: cellsOf(pick), total: totalOf(pick) });
  }
  return series;
}

describe('getTrends: misma respuesta que la matriz anterior (TC-REPORTING-REPORTS-055)', () => {
  const CATS = Array.from(
    { length: 12 },
    (_, i) => `0190a000-0000-7000-8000-00000000dd${String(i).padStart(2, '0')}`,
  );
  const CHILD = '0190a000-0000-7000-8000-00000000ddf1';
  const money = (cents: number): string => {
    const abs = Math.abs(cents);
    return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  };

  const scenarioArb = fc.record({
    months: fc.constantFrom(6, 12, 24),
    perDay: fc.boolean(),
    portions: fc.array(
      fc.record({
        offsetDays: fc.integer({ min: 0, max: 24 * 31 }),
        category: fc.integer({ min: 0, max: 12 }),
        currency: fc.constantFrom('BOB', 'BOB', 'USD', 'USD', 'EUR'),
        cents: fc.integer({ min: -2_000, max: 90_000 }),
      }),
      { minLength: 0, maxLength: 150, size: 'max' },
    ),
    // Tasas USD/BOB y EUR/BOB: algunas presentes (con su día) y otras ausentes.
    rates: fc.array(
      fc.record({
        offsetDays: fc.integer({ min: 0, max: 24 * 31 }),
        usd: fc.boolean(),
        value: fc.integer({ min: 600, max: 1_300 }),
      }),
      { maxLength: 400, size: 'max' },
    ),
  });

  const dayAt = (offsetDays: number): string =>
    new Date(Date.UTC(2024, 10, 1) + offsetDays * 86_400_000).toISOString().slice(0, 10);

  it('[TC-REPORTING-REPORTS-055] el DTO completo (series, celdas, totales y meta.conversion.ratesUsed en orden) es idéntico al de la matriz anterior', async () => {
    let withOthers = 0;
    let withRates = 0;
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (s) => {
        seq = 0;
        mem = new InMemoryFinancialReports();
        world();
        mem.tree = {
          ...mem.tree,
          categories: [
            ...CATS.map((id, i) => ({
              categoryId: id,
              name: `Cat ${i % 10}`,
              kind: 'EXPENSE' as const,
              groupId: GROUP,
              parentId: null,
              systemCode: null,
              archived: false,
            })),
            {
              categoryId: CHILD,
              name: 'Hija',
              kind: 'EXPENSE' as const,
              groupId: GROUP,
              parentId: CATS[3] as string,
              systemCode: null,
              archived: false,
            },
          ],
        };
        for (const p of s.portions) {
          const id = p.category === 12 ? CHILD : (CATS[p.category] as string);
          portion(dayAt(p.offsetDays), id, { amount: money(p.cents), currency: p.currency });
        }
        for (const r of s.rates) {
          mem.rates.push({
            base: r.usd ? 'USD' : 'EUR',
            quote: 'BOB',
            value: money(r.value),
            asOf: `${dayAt(r.offsetDays)}T16:00:00Z`,
          });
        }
        // Últimos `months` meses calendario de un horizonte de 24 que termina en 2026-10.
        const params = {
          ...base,
          from: new Date(Date.UTC(2024, 10 + (24 - s.months), 1)).toISOString().slice(0, 10),
          to: '2026-10-31',
          grouping: 'CALENDAR_MONTH' as const,
          ...(s.perDay ? { normalize: 'PER_DAY' as const } : {}),
        };
        const actual = await new FinancialReportsService(mem.financialDeps()).getTrends(params);
        const spy = vi.spyOn(TrendMatrix, 'build').mockImplementation(oracleTrendBuild);
        let expected;
        try {
          expected = await new FinancialReportsService(mem.financialDeps()).getTrends(params);
        } finally {
          spy.mockRestore();
        }
        expect(actual.report).toEqual(expected.report);
        if (actual.report.series.some((x) => x.categoryId === null)) withOthers += 1;
        if (actual.report.meta.conversion.ratesUsed.length > 0) withRates += 1;
      }),
      { numRuns: 60, seed: 20_261_125, endOnFailure: false },
    );
    // El generador no es vacuo: hay «Otras categorías» y tasas usadas.
    expect(withOthers).toBeGreaterThan(5);
    expect(withRates).toBeGreaterThan(5);
  }, 300_000);
});

describe('getFees (TC-REPORTING-REPORTS-042)', () => {
  it('[TC-REPORTING-REPORTS-042] octubre: conversión 2.00, transferencia 5.00, préstamos 400.00 y categorías 15.00 = 422.00 BOB', async () => {
    portion('2026-10-03', FEES, bob('2.00'), {
      origin: { transactionKind: 'CONVERSION', portionRole: 'FEE' },
    });
    portion('2026-10-04', FEES, bob('5.00'), { origin: { transactionKind: 'TRANSFER', portionRole: 'FEE' } });
    portion('2026-10-05', SUPER, bob('320.00'), {
      origin: { transactionKind: 'LOAN_PAYMENT', portionRole: 'NOMINAL' },
    });
    portion('2026-10-05', REST, bob('80.00'), {
      origin: { transactionKind: 'LOAN_PAYMENT', portionRole: 'NOMINAL' },
    });
    portion('2026-10-06', FEES, bob('15.00'));
    portion('2026-10-07', SUPER, bob('999.00'));
    const { report } = await q.getFees({ ...base, ...OCT });
    expect(report.months).toHaveLength(1);
    expect(report.months[0]?.byType.map((b) => [b.type, b.amount.consolidated.amount])).toEqual([
      ['CONVERSION', '2.00'],
      ['TRANSFER', '5.00'],
      ['LOAN', '400.00'],
      ['CARD', '0.00'],
      ['FEE_CATEGORY', '15.00'],
    ]);
    expect(report.months[0]?.total.consolidated).toEqual(bob('422.00'));
  });

  it('[TC-REPORTING-REPORTS-058] los cargos de tarjeta de octubre suman 4.80 en tarjetas y entran al total', async () => {
    portion('2026-10-05', SUPER, bob('320.00'), {
      origin: { transactionKind: 'LOAN_PAYMENT', portionRole: 'NOMINAL' },
    });
    portion('2026-10-05', REST, bob('80.00'), {
      origin: { transactionKind: 'LOAN_PAYMENT', portionRole: 'NOMINAL' },
    });
    portion('2026-10-06', FEES, bob('15.00'));
    portion('2026-10-25', INTERES, bob('4.00'), {
      accountId: TARJETA,
      origin: { transactionKind: 'EXPENSE', portionRole: 'NOMINAL', debtRole: 'CARD_CHARGE' },
    });
    portion('2026-10-25', SEGURO, bob('0.80'), {
      accountId: TARJETA,
      origin: { transactionKind: 'EXPENSE', portionRole: 'NOMINAL', debtRole: 'CARD_CHARGE' },
    });
    const { report } = await q.getFees({ ...base, ...OCT });
    const byType = Object.fromEntries(
      (report.months[0]?.byType ?? []).map((b) => [b.type, b.amount.consolidated.amount]),
    );
    expect(byType).toMatchObject({ LOAN: '400.00', CARD: '4.80', FEE_CATEGORY: '15.00' });
    expect(report.months[0]?.total.consolidated).toEqual(bob('419.80'));
  });

  it('[TC-REPORTING-REPORTS-061] un interés de tarjeta cargado a mano sin adoptar no cuenta como tarjetas', async () => {
    portion('2026-10-25', INTERES, bob('4.80'), { accountId: TARJETA });
    const { report } = await q.getFees({ ...base, ...OCT });
    expect(report.months[0]?.byType.find((b) => b.type === 'CARD')?.amount.consolidated.amount).toBe('0.00');
    expect(report.months[0]?.total.consolidated).toEqual(bob('0.00'));
  });

  it('[TC-REPORTING-REPORTS-042] el total de 12 meses cubre los 12 periodos completos anteriores al actual', async () => {
    portion('2026-10-06', FEES, bob('15.00'));
    portion('2025-11-06', FEES, bob('7.00'));
    portion('2025-10-06', FEES, bob('1000.00'));
    const { report } = await q.getFees({ ...base, ...OCT, grouping: 'CALENDAR_MONTH' });
    // Hoy es 2026-11-15: los 12 meses completos son 2025-11 a 2026-10.
    expect(report.last12Months.consolidated).toEqual(bob('22.00'));
  });
});

const goalMonth = (monthEnd: string, accumulated: string) => ({
  monthEnd,
  contributions: bob('0.00'),
  withdrawals: bob('0.00'),
  accumulated: bob(accumulated),
  expected: bob('400.00'),
  status: 'AHEAD' as const,
  complete: true,
});

describe('getGoals (TC-REPORTING-REPORTS-043)', () => {
  it('[TC-REPORTING-REPORTS-043] acumulados de 500.00, 1000.00, 1000.00 y 1800.00 con el seguimiento que informa GOALS', async () => {
    mem.fakes.goals = [
      {
        goalId: 'g-viaje',
        name: 'Viaje',
        currency: 'BOB',
        target: bob('5000.00'),
        startDate: '2026-07-01',
        targetDate: '2027-06-30',
        months: [
          goalMonth('2026-07-31', '500.00'),
          goalMonth('2026-08-31', '1000.00'),
          goalMonth('2026-09-30', '1000.00'),
          goalMonth('2026-10-31', '1800.00'),
        ],
      },
    ];
    const { report } = await q.getGoals({ ...base, from: '2026-07-01', to: '2026-10-31' });
    expect(report.goals[0]?.months.map((m) => m.accumulated.amount)).toEqual([
      '500.00',
      '1000.00',
      '1000.00',
      '1800.00',
    ]);
    expect(report.goals[0]?.months[3]).toMatchObject({
      percent: '36.00',
      expected: bob('400.00'),
      status: 'AHEAD',
    });
    expect(report.meta.reportId).toBe('SAVINGS_GOALS');
    expect(
      await code(() =>
        q.getGoals({ ...base, from: '2026-07-01', to: '2026-10-31', grouping: 'FINANCIAL_PERIOD' }),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-REPORTING-REPORTS-043] un mes sin tasa en GOALS deja el reporte incompleto', async () => {
    mem.fakes.goals = [
      {
        goalId: 'g',
        name: 'Viaje',
        currency: 'BOB',
        target: bob('5000.00'),
        startDate: '2026-07-01',
        targetDate: null,
        months: [{ ...goalMonth('2026-07-31', '500.00'), complete: false }],
      },
    ];
    const { report } = await q.getGoals({ ...base, from: '2026-07-01', to: '2026-07-31' });
    expect(report.meta.complete).toBe(false);
  });
});

describe('getDebts (TC-REPORTING-REPORTS-044)', () => {
  it('[TC-REPORTING-REPORTS-044] Crédito auto: pendiente 18900.00 y 17790.00 (saldo contable) con interés pagado 320.00 y 310.00', async () => {
    mem.fakes.loans = [{ loanId: 'loan-auto', name: 'Crédito auto', accountId: CREDITO, currency: 'BOB' }];
    // El ledger del pasivo: 20000.00 al 2026-08-31 menos principal 1100.00 y 1110.00 (saldos contables negativos).
    mem.entry('d0', '2026-08-31', [
      { account: CREDITO, currency: 'BOB', amount: '-20000.00' },
      { account: 'SYSTEM:OPENING_BALANCE', currency: 'BOB', amount: '20000.00' },
    ]);
    mem.entry('d1', '2026-09-15', [
      { account: CREDITO, currency: 'BOB', amount: '1100.00' },
      { account: 'SYSTEM:EXPENSE', currency: 'BOB', amount: '320.00' },
      { account: BANCO, currency: 'BOB', amount: '-1420.00' },
    ]);
    mem.entry('d2', '2026-10-15', [
      { account: CREDITO, currency: 'BOB', amount: '1110.00' },
      { account: 'SYSTEM:EXPENSE', currency: 'BOB', amount: '310.00' },
      { account: BANCO, currency: 'BOB', amount: '-1420.00' },
    ]);
    mem.fakes.debtPayments = [
      {
        loanId: 'loan-auto',
        month: '2026-09',
        currency: 'BOB',
        principal: '1100.00',
        interest: '320.00',
        charges: '0.00',
        payments: [{ date: '2026-09-15', principal: '1100.00', interest: '320.00', charges: '0.00' }],
      },
      {
        loanId: 'loan-auto',
        month: '2026-10',
        currency: 'BOB',
        principal: '1110.00',
        interest: '310.00',
        charges: '0.00',
        payments: [{ date: '2026-10-15', principal: '1110.00', interest: '310.00', charges: '0.00' }],
      },
    ];
    const { report } = await q.getDebts({ ...base, from: '2026-09-01', to: '2026-10-31' });
    const debt = report.debts[0]!;
    expect(debt).toMatchObject({ debtId: 'loan-auto', kind: 'LOAN', name: 'Crédito auto' });
    expect(debt.months.map((m) => m.outstanding.amount)).toEqual(['18900.00', '17790.00']);
    expect(debt.months.map((m) => m.interestPaid?.amount)).toEqual(['320.00', '310.00']);
    expect(report.consolidated.map((c) => c.outstanding.consolidated.amount)).toEqual([
      '18900.00',
      '17790.00',
    ]);
    expect(report.consolidated.map((c) => c.interestPaid.consolidated.amount)).toEqual(['320.00', '310.00']);
  });

  it('[TC-REPORTING-REPORTS-044] una tarjeta informa solo el saldo pendiente y debtKind filtra el tipo', async () => {
    mem.fakes.cards = [
      { cardId: 'c1', cardName: 'Tarjeta Andina', cardAccountId: 'ca1', accountId: TARJETA, currency: 'BOB' },
    ];
    mem.fakes.loans = [{ loanId: 'loan-auto', name: 'Crédito auto', accountId: CREDITO, currency: 'BOB' }];
    mem.entry('t1', '2026-10-10', [
      { account: TARJETA, currency: 'BOB', amount: '-500.00' },
      { account: 'SYSTEM:EXPENSE', currency: 'BOB', amount: '500.00' },
    ]);
    const all = await q.getDebts({ ...base, from: '2026-10-01', to: '2026-10-31' });
    expect(all.report.debts.map((d) => d.kind)).toEqual(['LOAN', 'CARD']);
    const cards = await q.getDebts({ ...base, from: '2026-10-01', to: '2026-10-31', debtKind: 'CARD' });
    expect(cards.report.debts).toHaveLength(1);
    expect(cards.report.debts[0]?.months[0]).toMatchObject({
      outstanding: bob('500.00'),
      principalPaid: null,
      interestPaid: null,
      interestCharged: bob('0.00'),
      chargesCharged: bob('0.00'),
    });
    expect(
      await code(() => q.getDebts({ ...base, from: '2026-10-01', to: '2026-10-31', debtKind: 'X' as never })),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-REPORTING-REPORTS-060] Visa Oro con un cargo de 4.00 de interés y 0.80 de seguro en octubre: lo cargado por mes', async () => {
    mem.fakes.cards = [
      { cardId: 'c1', cardName: 'Visa Oro', cardAccountId: 'ca1', accountId: TARJETA, currency: 'BOB' },
    ];
    mem.fakes.loans = [{ loanId: 'loan-auto', name: 'Crédito auto', accountId: CREDITO, currency: 'BOB' }];
    const origin = {
      transactionKind: 'EXPENSE',
      portionRole: 'NOMINAL' as const,
      debtRole: 'CARD_CHARGE' as const,
    };
    portion('2026-10-25', INTERES, bob('4.00'), { accountId: TARJETA, origin });
    portion('2026-10-25', SEGURO, bob('0.80'), { accountId: TARJETA, origin });
    // Un interés manual sin adoptar y el gasto de otra cuenta no cuentan.
    portion('2026-10-26', INTERES, bob('9.99'), { accountId: TARJETA });
    portion('2026-10-26', SUPER, bob('50.00'), { accountId: BANCO });
    const { report } = await q.getDebts({ ...base, from: '2026-09-01', to: '2026-10-31' });
    const card = report.debts.find((d) => d.kind === 'CARD')!;
    expect(card.months.map((m) => [m.interestCharged?.amount, m.chargesCharged?.amount])).toEqual([
      ['0.00', '0.00'],
      ['4.00', '0.80'],
    ]);
    expect(card.months.map((m) => m.principalPaid)).toEqual([null, null]);
    expect(report.consolidated.map((c) => c.interestCharged.consolidated.amount)).toEqual(['0.00', '4.00']);
    const loan = report.debts.find((d) => d.kind === 'LOAN')!;
    expect(loan.months.map((m) => [m.interestCharged, m.chargesCharged])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('[TC-REPORTING-REPORTS-063] los cargos del reporte de deudas suman lo mismo que el tipo tarjetas de comisiones, por moneda', async () => {
    mem.addAccount(
      { accountId: 'visa-usd', name: 'Visa Oro USD', type: 'CREDIT_CARD', currency: 'USD' },
      null,
    );
    mem.fakes.cards = [
      { cardId: 'c1', cardName: 'Visa Oro', cardAccountId: 'ca1', accountId: TARJETA, currency: 'BOB' },
      { cardId: 'c1', cardName: 'Visa Oro', cardAccountId: 'ca2', accountId: 'visa-usd', currency: 'USD' },
    ];
    const origin = {
      transactionKind: 'EXPENSE',
      portionRole: 'NOMINAL' as const,
      debtRole: 'CARD_CHARGE' as const,
    };
    portion('2026-10-25', INTERES, bob('4.00'), { accountId: TARJETA, origin });
    portion('2026-10-25', SEGURO, bob('0.80'), { accountId: TARJETA, origin });
    portion('2026-10-25', INTERES, usd('1.25'), { accountId: 'visa-usd', origin });
    const debts = (await q.getDebts({ ...base, ...OCT })).report;
    const fees = (await q.getFees({ ...base, ...OCT })).report;
    const sumOf = (currency: string) =>
      debts.debts
        .filter((d) => d.kind === 'CARD' && d.currency === currency)
        .flatMap((d) => d.months)
        .reduce(
          (a, m) => a.plus(m.interestCharged?.amount ?? '0').plus(m.chargesCharged?.amount ?? '0'),
          dec('0'),
        );
    const cardType = fees.months[0]?.byType.find((b) => b.type === 'CARD')?.amount.byCurrency ?? [];
    expect(sumOf('BOB').toFixed(2)).toBe('4.80');
    expect(sumOf('USD').toFixed(2)).toBe('1.25');
    expect(cardType.map((m) => [m.currency, m.amount]).sort()).toEqual([
      ['BOB', '4.80'],
      ['USD', '1.25'],
    ]);
  });
});

describe('getRecurringCosts (TC-REPORTING-REPORTS-045)', () => {
  const cost = (
    name: string,
    price: string | null,
    renewals: string,
    currency = 'BOB',
    variable = false,
  ) => ({
    definitionId: `def-${name}`,
    name,
    categoryId: null,
    cadence: 'MONTHLY',
    interval: 1,
    currency,
    renewalsPerYear: renewals,
    price,
    variable,
  });

  it('[TC-REPORTING-REPORTS-045] streaming, seguro y gimnasio: 669.00 BOB al mes y 8028.00 BOB al año', async () => {
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '10.00', asOf: '2026-11-14T20:00:00Z' });
    mem.fakes.recurringCosts = [
      cost('Streaming', '69.00', '12'),
      cost('Seguro', '1200.00', '1'),
      cost('Gimnasio', '50.00', '12', 'USD'),
      cost('Luz', null, '12', 'BOB', true),
    ];
    const { report } = await q.getRecurringCosts({ ...base });
    expect(report.totals.monthly.consolidated).toEqual(bob('669.00'));
    expect(report.totals.annual.consolidated).toEqual(bob('8028.00'));
    expect(report.variableCount).toBe(1);
    expect(report.items.map((i) => i.name)).toEqual(['Gimnasio', 'Seguro', 'Streaming', 'Luz']);
    expect(report.meta.from).toBe('2026-11-15');
    expect(report.meta.conversion.ratesUsed).toHaveLength(1);
  });

  it('[TC-REPORTING-REPORTS-045] sin tasa USD el total queda incompleto y se informa lo no convertido', async () => {
    mem.fakes.recurringCosts = [cost('Streaming', '69.00', '12'), cost('Gimnasio', '50.00', '12', 'USD')];
    const { report } = await q.getRecurringCosts({ ...base });
    expect(report.meta.complete).toBe(false);
    expect(report.totals.monthly.consolidated).toEqual(bob('69.00'));
    expect(report.meta.unconverted.length).toBeGreaterThan(0);
  });
});

describe('getSubscriptions (TC-REPORTING-REPORTS-046)', () => {
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

  it('[TC-REPORTING-REPORTS-046] costo mensual al cierre de 94.00, 99.00, 149.00 y 80.00 BOB con sus eventos', async () => {
    mem.fakes.subscriptionEvents = [
      ev('m', 'Música', '2026-01-10', 'STARTED', null, '25.00'),
      ev('v', 'Video', '2026-02-10', 'STARTED', null, '69.00'),
      ev('m', 'Música', '2026-08-01', 'PRICE_CHANGED', '25.00', '30.00'),
      ev('n', 'Nueva', '2026-09-10', 'STARTED', null, '50.00'),
      ev('v', 'Video', '2026-10-05', 'CANCELLED', '69.00', null),
    ];
    const { report } = await q.getSubscriptions({ ...base, from: '2026-07-01', to: '2026-10-31' });
    expect(report.months.map((m) => m.monthlyCost.consolidated.amount)).toEqual([
      '94.00',
      '99.00',
      '149.00',
      '80.00',
    ]);
    expect(report.months[1]?.events).toEqual([
      expect.objectContaining({ kind: 'PRICE_CHANGED', previousPrice: bob('25.00'), newPrice: bob('30.00') }),
    ]);
    expect(report.months.map((m) => m.active)).toEqual([2, 2, 3, 2]);
  });

  it('[TC-REPORTING-REPORTS-046] una suscripción en dólares se valora con la tasa de cada cierre', async () => {
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '10.00', asOf: '2026-07-31T20:00:00Z' });
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '12.00', asOf: '2026-08-31T20:00:00Z' });
    mem.fakes.subscriptionEvents = [
      { ...ev('u', 'Cloud', '2026-07-01', 'STARTED', null, null), newPrice: usd('10.00') },
    ];
    const { report } = await q.getSubscriptions({ ...base, from: '2026-07-01', to: '2026-08-31' });
    expect(report.months.map((m) => m.monthlyCost.consolidated.amount)).toEqual(['100.00', '120.00']);
    expect(report.months[0]?.monthlyCost.byCurrency).toEqual([usd('10.00')]);
  });
});

describe('getConversions (TC-REPORTING-REPORTS-047)', () => {
  function sale(
    id: string,
    qty: string,
    rate: string,
    over: Partial<ConversionCostRowDto> & { fee?: string } = {},
  ): ConversionCostRowDto {
    const target = dec(qty).times(rate).toFixed(2);
    const { fee, ...rest } = over;
    return {
      transactionId: id,
      revision: 1,
      businessDate: '2026-10-05',
      executedAt: '2026-10-05T14:00:00Z',
      voided: false,
      sourceAccountId: 'a-usdt',
      targetAccountId: 'a-bob',
      counterparty: { counterpartyId: BINANCE, name: 'Binance P2P' },
      sourceAmount: { amount: qty, currency: 'USDT' },
      convertedSourceAmount: { amount: qty, currency: 'USDT' },
      grossTargetAmount: { amount: target, currency: 'BOB' },
      targetAmount: { amount: target, currency: 'BOB' },
      quotedRate: { base: 'USDT', quote: 'BOB', value: rate },
      effectiveRate: { base: 'USDT', quote: 'BOB', value: rate },
      referenceRate: {
        rate: { base: 'USDT', quote: 'BOB', value: '12.00' },
        fxRateId: 'fx-1',
        source: 'MANUAL',
        rateType: 'P2P',
        asOf: '2026-10-05T13:00:00Z',
      },
      spread: {
        percentage: '0',
        amount: { amount: dec('12').minus(rate).times(qty).toFixed(2), currency: 'BOB' },
      },
      fees: fee
        ? [{ type: 'PLATFORM', amount: { amount: fee, currency: 'BOB' }, paidFromAccountId: null }]
        : [],
      ...rest,
    };
  }

  it('[TC-REPORTING-REPORTS-047] lista 11.90 frente a 12.00 y 11.94 frente a 12.00 y el costo de octubre de 30.00 BOB', async () => {
    mem.addAccount(
      { accountId: 'a-usdt', name: 'Wallet USDT', type: 'CRYPTO_WALLET', currency: 'USDT' },
      null,
    );
    mem.addAccount({ accountId: 'a-bob', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, null);
    mem.conversionRows.push(
      sale('0190a000-0000-7000-8000-000000000a01', '100.000000', '11.90'),
      sale('0190a000-0000-7000-8000-000000000a02', '300.000000', '11.94', { fee: '2.00' }),
      sale('0190a000-0000-7000-8000-000000000a03', '10.000000', '11.80', {
        referenceRate: null,
        spread: null,
      }),
    );
    const { report } = await q.getConversions({ ...base, ...OCT });
    expect(report.points.map((p) => [p.effectiveRate, p.referenceRate])).toEqual([
      ['11.90', '12.00'],
      ['11.94', '12.00'],
      ['11.80', null],
    ]);
    expect(report.months).toHaveLength(1);
    expect(report.months[0]?.cost).toEqual(bob('30.00'));
    expect(report.costTotal).toEqual(bob('30.00'));
    expect(report.months[0]?.conversions).toBe(2);
    expect(report.months[0]?.excluded).toBe(1);
  });
});

describe('puertos de los reportes ampliados', () => {
  it('[TC-REPORTING-REPORTS-053] cada reporte pide sus puertos una sola vez y sin paralelismo', async () => {
    mem.fakes.recurringCosts = [];
    await q.getRecurringCosts({ ...base });
    await q.getSubscriptions({ ...base, from: '2026-07-01', to: '2026-10-31' });
    expect(mem.extendedCalls).toEqual(['recurring', 'subscriptions']);
    expect(mem.durations.map((d) => d.report)).toEqual(['RECURRING_COSTS', 'SUBSCRIPTION_EVOLUTION']);
  });

  it('[TC-REPORTING-REPORTS-053] sin los puertos configurados los reportes ampliados responden SERVICE_UNAVAILABLE', async () => {
    const deps = mem.financialDeps();
    const { extended: _x, ...without } = deps;
    const bare = new FinancialReportsService(without);
    expect(await code(() => bare.getGoals({ ...base, from: '2026-07-01', to: '2026-07-31' }))).toBe(
      'SERVICE_UNAVAILABLE',
    );
  });
});
