import { dec, DomainError, Instant } from '@pf/shared-kernel';
import type { ConversionCostRowDto } from '@pf/transactions/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
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
      ['FEE_CATEGORY', '15.00'],
    ]);
    expect(report.months[0]?.total.consolidated).toEqual(bob('422.00'));
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
    });
    expect(
      await code(() => q.getDebts({ ...base, from: '2026-10-01', to: '2026-10-31', debtKind: 'X' as never })),
    ).toBe('VALIDATION_FAILED');
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
