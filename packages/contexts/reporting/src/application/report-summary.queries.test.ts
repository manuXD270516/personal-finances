import { Instant } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { ReportSummaryQueries } from './report-summary.queries.js';
import { InMemoryReporting } from './testing/in-memory.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const USER = '0190a000-0000-7000-8000-000000000001';

let mem: InMemoryReporting;
const summary = async (q: Partial<Parameters<ReportSummaryQueries['getReportSummary']>[0]> = {}) =>
  (await new ReportSummaryQueries(mem.deps()).getReportSummary({ userId: USER, workspaceId: WS, ...q }))
    .summary;
const amount = (m: { amount: string; currency: string } | null | undefined) =>
  m ? `${m.amount} ${m.currency}` : null;

/** Escenario canónico (FixedClock 2026-09-30T18:00:00-04:00): Banco 685.00, Caja 120.50, Wallet 50.000000 USDT. */
function canonical() {
  mem.addAccount({ accountId: 'banco', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, '685.00');
  mem.addAccount({ accountId: 'caja', name: 'Caja BOB', type: 'CASH', currency: 'BOB' }, '120.50');
  mem.addAccount(
    { accountId: 'wallet', name: 'Wallet USDT', type: 'CRYPTO_WALLET', currency: 'USDT' },
    '50.000000',
  );
}

beforeEach(() => {
  mem = new InMemoryReporting();
});

describe('GetReportSummary — dinero disponible y saldos (reporting/dashboard)', () => {
  it('[TC-REPORTING-DASHBOARD-001] lista cada cuenta con su saldo nativo y los totales por moneda sin conversión', async () => {
    canonical();
    mem.rates.push({ base: 'USDT', quote: 'BOB', value: '12.02', asOf: '2026-09-30T21:53:07Z' });
    const s = await summary({ month: '2026-09' });
    expect(s.accounts.map((a) => [a.name, amount(a.balance)])).toEqual([
      ['Banco BOB', '685.00 BOB'],
      ['Caja BOB', '120.50 BOB'],
      ['Wallet USDT', '50.000000 USDT'],
    ]);
    expect(s.byCurrency.map((c) => amount(c.liquidBalance))).toEqual(['805.50 BOB', '50.000000 USDT']);
    expect(s.period).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('[TC-REPORTING-DASHBOARD-002] consolida 1406.50 BOB con USDT/BOB 12.02 PARALLEL de paralelo.bo, su vigencia, antigüedad y atribución', async () => {
    canonical();
    mem.addAccount(
      { accountId: 'inv', name: 'Inversión', type: 'INVESTMENT', currency: 'BOB', liquidity: 'SEMI_LIQUID' },
      '5000.00',
    );
    mem.rates.push({ base: 'USDT', quote: 'BOB', value: '12.02', asOf: '2026-09-30T21:53:07Z' });
    const s = await summary();
    expect(amount(s.consolidated.liquidBalance)).toBe('1406.50 BOB');
    expect(s.consolidated.complete).toBe(true);
    expect(s.meta.ratesUsed).toHaveLength(1);
    expect(s.meta.ratesUsed[0]).toMatchObject({
      rate: { base: 'USDT', quote: 'BOB', value: '12.02' },
      rateType: 'PARALLEL',
      provider: 'PARALELO_BO',
      selection: 'PRIMARY',
      asOf: '2026-09-30T21:53:07Z',
      ageSeconds: 413,
      stale: false,
    });
    expect(s.meta.attributions).toEqual([
      expect.objectContaining({
        text: 'Fuente: paralelo.bo',
        url: 'https://paralelo.bo',
        license: 'CC BY 4.0',
      }),
    ]);
    const wallet = s.accounts.find((a) => a.accountId === 'wallet');
    expect(amount(wallet?.convertedBalance)).toBe('601.00 BOB');
    expect(wallet?.rate?.attribution?.text).toBe('Fuente: paralelo.bo');
    expect(s.accounts.find((a) => a.accountId === 'inv')?.liquid).toBe(false);
    // Valoración de stocks a "ahora" (no al cierre del día).
    expect(mem.rateRequests).toEqual([{ base: 'USDT', quote: 'BOB', at: '2026-09-30T22:00:00.000Z' }]);
  });

  it('[TC-REPORTING-DASHBOARD-003] sin tasa BTC el consolidado es 1406.50 incompleto con 0.01000000 BTC sin convertir; con USDT vencida, 805.50', async () => {
    canonical();
    mem.addAccount(
      { accountId: 'btc', name: 'Wallet BTC', type: 'CRYPTO_WALLET', currency: 'BTC' },
      '0.01000000',
    );
    mem.rates.push({ base: 'USDT', quote: 'BOB', value: '12.02', asOf: '2026-09-30T21:53:07Z' });
    let s = await summary();
    expect(amount(s.consolidated.liquidBalance)).toBe('1406.50 BOB');
    expect(s.consolidated.complete).toBe(false);
    expect(s.meta.complete).toBe(false);
    expect(s.consolidated.unconverted.map(amount)).toEqual(['0.01000000 BTC']);
    expect(s.accounts.find((a) => a.accountId === 'btc')?.convertedBalance).toBeNull();

    mem.rates.length = 0;
    mem.rates.push({ base: 'USDT', quote: 'BOB', value: '12.02', asOf: '2026-09-20T12:00:00Z' });
    s = await summary();
    expect(amount(s.consolidated.liquidBalance)).toBe('805.50 BOB');
    expect(s.consolidated.unconverted.map(amount)).toEqual(['0.01000000 BTC', '50.000000 USDT']);
  });

  it('[TC-REPORTING-DASHBOARD-007] con providers caídos usa la última tasa obsoleta (8 h) y, si hay una manual más reciente, la manual', async () => {
    canonical();
    mem.rates.push({
      base: 'USDT',
      quote: 'BOB',
      value: '12.02',
      asOf: '2026-09-30T13:53:07Z',
      selection: 'LAST_KNOWN_STALE',
      stale: true,
    });
    let s = await summary();
    expect(amount(s.consolidated.liquidBalance)).toBe('1406.50 BOB');
    expect(s.consolidated.complete).toBe(true);
    expect(s.meta.ratesUsed[0]).toMatchObject({
      selection: 'LAST_KNOWN_STALE',
      stale: true,
      ageSeconds: 29213,
      provider: 'PARALELO_BO',
    });

    mem.rates.push({
      base: 'USDT',
      quote: 'BOB',
      value: '11.98',
      asOf: '2026-09-30T20:00:00Z',
      // Con la preferencia PARALLEL sembrada, FX solo elige tasas del tipo preferido: la manual debe ser PARALLEL
      // (el TC menciona P2P; ver design.md § Decisiones de implementación, pregunta abierta al owner).
      rateType: 'PARALLEL',
      provider: null,
      sourceLabel: 'Casa de cambio centro',
    });
    s = await summary();
    expect(amount(s.consolidated.liquidBalance)).toBe('1404.50 BOB');
    expect(s.meta.ratesUsed[0]).toMatchObject({
      rateType: 'PARALLEL',
      selection: 'MANUAL',
      source: 'MANUAL',
      sourceLabel: 'Casa de cambio centro',
      attribution: null,
    });
    expect(s.meta.attributions).toEqual([]);
  });
});

describe('GetReportSummary — flujos del mes (reporting/dashboard)', () => {
  beforeEach(() => {
    canonical();
    mem.rates.push({ base: 'USDT', quote: 'BOB', value: '12.02', asOf: '2026-09-30T21:53:07Z' });
    mem.categories.push(
      {
        categoryId: 'sal',
        name: 'Salario',
        kind: 'INCOME',
        parentId: null,
        systemCode: null,
        archived: false,
      },
      {
        categoryId: 'sup',
        name: 'Supermercado',
        kind: 'EXPENSE',
        parentId: null,
        systemCode: null,
        archived: false,
      },
      {
        categoryId: 'res',
        name: 'Restaurantes',
        kind: 'EXPENSE',
        parentId: null,
        systemCode: null,
        archived: false,
      },
      {
        categoryId: 'fee',
        name: 'Fees',
        kind: 'EXPENSE',
        parentId: null,
        systemCode: 'FEES',
        archived: false,
      },
    );
  });

  it('[TC-REPORTING-KPI-004] ingresos 8000.00, gastos 1305.00, ahorro 6695.00 y tasa 83.7 %', async () => {
    mem.flow('2026-09-05', 'INCOME', 'sal', '8000.00');
    mem.flow('2026-09-08', 'EXPENSE', 'sup', '1200.00');
    mem.flow('2026-09-09', 'EXPENSE', 'res', '300.00');
    mem.flow('2026-09-20', 'EXPENSE', 'res', '-200.00');
    mem.flow('2026-09-30', 'EXPENSE', 'fee', '5.00');
    const s = await summary({ month: '2026-09' });
    expect(amount(s.consolidated.income)).toBe('8000.00 BOB');
    expect(amount(s.consolidated.expense)).toBe('1305.00 BOB');
    expect(amount(s.consolidated.net)).toBe('6695.00 BOB');
    expect(s.consolidated.savingsRate).toBe('83.7');
    expect(s.byCurrency.find((c) => c.currency === 'BOB')?.savingsRate).toBe('83.7');
    expect(s.topExpenseCategories.map((c) => `${c.name} ${amount(c.amount)}`)).toEqual([
      'Supermercado 1200.00 BOB',
      'Restaurantes 100.00 BOB',
      'Fees 5.00 BOB',
    ]);
  });

  it('[TC-REPORTING-KPI-004] sin ingresos: ahorro −300.00 y tasa de ahorro null', async () => {
    mem.flow('2026-09-08', 'EXPENSE', 'sup', '300.00');
    const s = await summary({ month: '2026-09' });
    expect(amount(s.consolidated.net)).toBe('-300.00 BOB');
    expect(s.consolidated.savingsRate).toBeNull();
  });

  it('[TC-REPORTING-KPI-003] 20.00 USD el 10-sep con la tasa vigente al cierre de ese día (11.96) + 100.00 BOB = 339.20 BOB', async () => {
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '11.96', asOf: '2026-09-10T20:00:00Z' });
    mem.flow('2026-09-10', 'EXPENSE', 'sup', '20.00', 'USD');
    mem.flow('2026-09-12', 'EXPENSE', 'sup', '100.00');
    let s = await summary({ month: '2026-09', compare: 'NONE' });
    expect(s.byCurrency.map((c) => amount(c.expense))).toEqual(['100.00 BOB', '20.00 USD', '0.000000 USDT']);
    expect(amount(s.consolidated.expense)).toBe('339.20 BOB');
    // El 10-sep cierra a las 2026-09-11T03:59:59.999Z en La Paz.
    expect(mem.rateRequests).toContainEqual({ base: 'USD', quote: 'BOB', at: '2026-09-11T03:59:59.999Z' });
    // Una tasa posterior no cambia septiembre.
    mem.clock.set(Instant.parse('2026-10-02T12:00:00Z'));
    mem.rates.push({ base: 'USD', quote: 'BOB', value: '12.02', asOf: '2026-10-02T08:53:07.532Z' });
    s = await summary({ month: '2026-09', compare: 'NONE' });
    expect(amount(s.consolidated.expense)).toBe('339.20 BOB');
    expect(s.comparison).toBeNull();
  });

  it('[TC-REPORTING-KPI-007] el 15-sep compara gastos 1..15 contra 1..15 de agosto (+105.00, +8.75 %) e ingresos nuevos', async () => {
    mem.clock.set(Instant.parse('2026-09-15T16:00:00Z'));
    mem.flow('2026-08-10', 'EXPENSE', 'sup', '1200.00');
    mem.flow('2026-08-20', 'EXPENSE', 'sup', '999.00'); // fuera de 1..15
    mem.flow('2026-09-05', 'INCOME', 'sal', '8000.00');
    mem.flow('2026-09-10', 'EXPENSE', 'sup', '1305.00');
    const s = await summary();
    expect(s.period).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(s.comparison?.mode).toBe('PREVIOUS_PERIOD_TO_DATE');
    expect(s.comparison?.previousPeriod).toEqual({ from: '2026-08-01', to: '2026-08-15' });
    expect(s.comparison?.expense).toEqual({
      current: { amount: '1305.00', currency: 'BOB' },
      previous: { amount: '1200.00', currency: 'BOB' },
      deltaAbs: { amount: '105.00', currency: 'BOB' },
      deltaPct: '8.75',
      isNew: false,
    });
    expect(s.comparison?.income).toMatchObject({
      deltaAbs: { amount: '8000.00', currency: 'BOB' },
      deltaPct: null,
      isNew: true,
    });
  });

  it('[TC-REPORTING-KPI-006] topCategories fuera de 0..20 se rechaza con VALIDATION_FAILED', async () => {
    await expect(summary({ topCategories: 21 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    const s = await summary({ topCategories: 0 });
    expect(s.topExpenseCategories).toEqual([]);
  });

  it('valida periodo, moneda de reporte y exclusión month/dateFrom', async () => {
    await expect(
      summary({ month: '2026-09', dateFrom: '2026-09-01', dateTo: '2026-09-02' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(summary({ dateFrom: '2026-09-01' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(summary({ reportingCurrency: 'EUR' })).rejects.toMatchObject({
      code: 'CURRENCY_NOT_ENABLED',
    });
    const s = await summary({ dateFrom: '2026-09-01', dateTo: '2026-09-10' });
    expect(s.period).toEqual({ from: '2026-09-01', to: '2026-09-10' });
  });
});

describe('GetReportSummary — patrimonio neto (reporting/net-worth)', () => {
  beforeEach(() => {
    canonical();
    mem.addAccount({ accountId: 'visa', name: 'Visa', type: 'CREDIT_CARD', currency: 'BOB' }, '400.00');
    mem.rates.push({ base: 'USDT', quote: 'BOB', value: '12.02', asOf: '2026-09-30T21:53:07Z' });
  });

  it('[TC-REPORTING-NETWORTH-001] activos 1406.50, pasivos 400.00 y patrimonio 1006.50 BOB con la tasa informada', async () => {
    const s = await summary();
    expect(amount(s.netWorth.assets)).toBe('1406.50 BOB');
    expect(amount(s.netWorth.liabilities)).toBe('400.00 BOB');
    expect(amount(s.netWorth.netWorth)).toBe('1006.50 BOB');
    expect(amount(s.consolidated.netWorth)).toBe('1006.50 BOB');
    expect(s.netWorth.complete).toBe(true);
    expect(s.meta.ratesUsed[0]).toMatchObject({ asOf: '2026-09-30T21:53:07Z', ageSeconds: 413 });
    expect(s.meta.ratesUsed[0]?.attribution?.text).toBe('Fuente: paralelo.bo');
  });

  it('[TC-REPORTING-NETWORTH-002] desglose por moneda y por tipo en el contrato', async () => {
    const s = await summary();
    expect(s.netWorth.byCurrency).toEqual([
      {
        currency: 'BOB',
        assets: { amount: '805.50', currency: 'BOB' },
        liabilities: { amount: '400.00', currency: 'BOB' },
        net: { amount: '405.50', currency: 'BOB' },
        converted: { amount: '405.50', currency: 'BOB' },
      },
      {
        currency: 'USDT',
        assets: { amount: '50.000000', currency: 'USDT' },
        liabilities: { amount: '0.000000', currency: 'USDT' },
        net: { amount: '50.000000', currency: 'USDT' },
        converted: { amount: '601.00', currency: 'BOB' },
      },
    ]);
    expect(s.netWorth.byAccountType.map((t) => `${t.type} ${t.amount.amount}`).sort()).toEqual(
      ['BANK 685.00', 'CASH 120.50', 'CREDIT_CARD -400.00', 'CRYPTO_WALLET 601.00'].sort(),
    );
  });

  it('[TC-REPORTING-NETWORTH-003] Caja oficina excluida del patrimonio aparece en saldos', async () => {
    mem.addAccount(
      { accountId: 'oficina', name: 'Caja oficina', type: 'CASH', currency: 'BOB', includeInNetWorth: false },
      '1000.00',
    );
    const s = await summary();
    expect(amount(s.netWorth.netWorth)).toBe('1006.50 BOB');
    const line = s.accounts.find((a) => a.name === 'Caja oficina');
    expect(amount(line?.balance)).toBe('1000.00 BOB');
    expect(line?.includeInNetWorth).toBe(false);
  });

  it('[TC-REPORTING-NETWORTH-004] sin tasa BTC el patrimonio es 1006.50 incompleto con 0.01000000 BTC no valorado', async () => {
    mem.addAccount(
      { accountId: 'btc', name: 'Wallet BTC', type: 'CRYPTO_WALLET', currency: 'BTC' },
      '0.01000000',
    );
    const s = await summary();
    expect(amount(s.netWorth.netWorth)).toBe('1006.50 BOB');
    expect(s.netWorth.complete).toBe(false);
    expect(s.netWorth.unvalued.map(amount)).toEqual(['0.01000000 BTC']);
    expect(s.consolidated.complete).toBe(false);
  });
});

describe('GetReportSummary — preguntas del Home y frescura', () => {
  it('[TC-REPORTING-DASHBOARD-005] Q4, Q5, Q8 y Q9 no disponibles en Phase 1; con cuentas Q1..Q3, Q6 y Q7 disponibles', async () => {
    canonical();
    const s = await summary();
    const by = Object.fromEntries(s.questions.map((q) => [q.question, q]));
    for (const q of ['Q4', 'Q5', 'Q8', 'Q9']) expect(by[q]?.status).toBe('NOT_AVAILABLE_IN_PHASE');
    for (const q of ['Q1', 'Q2', 'Q3', 'Q6', 'Q7'])
      expect(by[q]).toMatchObject({ status: 'AVAILABLE', actionHint: null });
    expect(by['Q4']?.actionHint).toBe('AVAILABLE_IN_PHASE_3');
  });

  it('[TC-REPORTING-DASHBOARD-005] workspace sin cuentas: Q1 NO_DATA con la acción de crear una cuenta', async () => {
    const s = await summary();
    const q1 = s.questions.find((q) => q.question === 'Q1');
    expect(q1).toEqual({ question: 'Q1', status: 'NO_DATA', actionHint: 'CREATE_ACCOUNT' });
    expect(s.accounts).toEqual([]);
  });

  it('[TC-REPORTING-DASHBOARD-006] declara periodo, moneda de reporte, instante de generación y frescura', async () => {
    canonical();
    const s = await summary({ month: '2026-09' });
    expect(s.meta).toMatchObject({
      generatedAt: '2026-09-30T22:00:00.000Z',
      reportingCurrency: 'BOB',
      timeZone: 'America/La_Paz',
      rateWindowDays: 7,
      dataFreshness: '2026-09-30T21:00:00.000Z',
    });
  });
});
