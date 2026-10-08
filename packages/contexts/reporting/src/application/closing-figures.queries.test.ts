import { currency, dec, Instant, present } from '@pf/shared-kernel';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { NetWorthAtQueries, PeriodFlowsQueries } from './closing-figures.queries.js';
import { ReportSummaryQueries } from './report-summary.queries.js';
import { InMemoryReporting } from './testing/in-memory.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const NUM_RUNS = Number(process.env['PF_PBT_RUNS'] ?? 100);
const amount = (m: { amount: string; currency: string } | null | undefined) =>
  m ? `${m.amount} ${m.currency}` : null;

let mem: InMemoryReporting;
const flowsQuery = () => new PeriodFlowsQueries(mem.deps());
const netWorthQuery = () => new NetWorthAtQueries(mem.deps());

/** Escenario "Snapshot de octubre de 2026" (el cierre corre el 1 de noviembre, ya pasado el corte). */
function october() {
  mem.clock.set(Instant.parse('2026-11-01T15:00:00Z'));
  mem.addAccount({ accountId: 'banco', name: 'Bank A', type: 'BANK', currency: 'BOB' }, '5200.00');
  mem.addAccount({ accountId: 'usd', name: 'USD Savings', type: 'SAVINGS', currency: 'USD' }, '1500.00');
  mem.addAccount(
    { accountId: 'usdt', name: 'Binance USDT', type: 'CRYPTO_WALLET', currency: 'USDT' },
    '800.000000',
  );
  mem.addAccount({ accountId: 'visa', name: 'Visa BOB', type: 'CREDIT_CARD', currency: 'BOB' }, '350.00');
  mem.rates.push(
    { base: 'USD', quote: 'BOB', value: '12.05', asOf: '2026-10-31T20:00:00Z' },
    { base: 'USDT', quote: 'BOB', value: '12.02', asOf: '2026-10-31T20:00:00Z' },
    // Tasa vigente cuando se registró el gasto en USD (15 de octubre).
    { base: 'USD', quote: 'BOB', value: '12.00', asOf: '2026-10-15T15:00:00Z' },
  );
  mem.flow('2026-10-05', 'INCOME', 'sueldo', '12000.00');
  mem.flow('2026-10-10', 'EXPENSE', 'comida', '8210.50');
  mem.flow('2026-10-15', 'EXPENSE', 'ocio', '20.00', 'USD');
  // Fuera del periodo: no debe contar.
  mem.flow('2026-11-01', 'EXPENSE', 'comida', '99.00');
  mem.flow('2026-09-30', 'INCOME', 'sueldo', '77.00');
}

beforeEach(() => {
  mem = new InMemoryReporting();
});

describe('Cifras de cierre — flujos del periodo (add-month-closing)', () => {
  it('[TC-PLANNING-SNAPSHOT-001] octubre: ingresos 12000.00, gastos 8450.50 BOB (8210.50 + 20 USD a 12.00), ahorro 3549.50 y tasa de ahorro 29.6', async () => {
    october();
    const f = await flowsQuery().getFlows({ workspaceId: WS, dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    expect(f.period).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(f.reportingCurrency).toBe('BOB');
    expect(amount(f.consolidated.income)).toBe('12000.00 BOB');
    expect(amount(f.consolidated.expense)).toBe('8450.50 BOB');
    expect(amount(f.consolidated.net)).toBe('3549.50 BOB');
    expect(f.consolidated.savingsRate).toBe('29.6');
    expect(f.consolidated.complete).toBe(true);
    expect(f.consolidated.unconverted).toEqual([]);
    expect(f.byCurrency.map((c) => [c.currency, amount(c.income), amount(c.expense), amount(c.net)])).toEqual(
      [
        ['BOB', '12000.00 BOB', '8210.50 BOB', '3789.50 BOB'],
        ['USD', '0.00 USD', '20.00 USD', '-20.00 USD'],
      ],
    );
    // Solo la tasa del flujo (12.00 del 15/10): no se mezclan las de saldos.
    expect(f.ratesUsed.map((r) => r.rate.value)).toEqual(['12.00']);
  });

  it('[TC-PLANNING-SNAPSHOT-001] coincide con las cifras de GET /reports/summary del mismo periodo', async () => {
    october();
    const f = await flowsQuery().getFlows({ workspaceId: WS, dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    const { summary: s } = await new ReportSummaryQueries(mem.deps()).getReportSummary({
      userId: null,
      workspaceId: WS,
      dateFrom: '2026-10-01',
      dateTo: '2026-10-31',
    });
    expect(f.consolidated.income).toEqual(s.consolidated.income);
    expect(f.consolidated.expense).toEqual(s.consolidated.expense);
    expect(f.consolidated.net).toEqual(s.consolidated.net);
    expect(f.consolidated.savingsRate).toBe(s.consolidated.savingsRate);
  });

  it('[TC-PLANNING-SNAPSHOT-001] un gasto en USD sin tasa queda sin convertir (incompleto), nunca 1:1', async () => {
    october();
    mem.rates.length = 0;
    const f = await flowsQuery().getFlows({ workspaceId: WS, dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    expect(f.consolidated.complete).toBe(false);
    expect(f.consolidated.unconverted.map(amount)).toEqual(['20.00 USD']);
    expect(amount(f.consolidated.expense)).toBe('8210.50 BOB');
    expect(f.ratesUsed).toEqual([]);
  });

  it('[TC-PLANNING-SNAPSHOT-001] sin ingresos la tasa de ahorro es null', async () => {
    october();
    mem.flows.splice(0, mem.flows.length);
    mem.flow('2026-10-10', 'EXPENSE', 'comida', '10.00');
    const f = await flowsQuery().getFlows({ workspaceId: WS, dateFrom: '2026-10-01', dateTo: '2026-10-31' });
    expect(f.consolidated.savingsRate).toBeNull();
  });
});

describe('Cifras de cierre — patrimonio a una fecha de corte (add-month-closing)', () => {
  it('[TC-PLANNING-SNAPSHOT-001] patrimonio al 2026-10-31 = 32541.00 BOB completo, valorado al cierre de ese día', async () => {
    october();
    const n = await netWorthQuery().getNetWorth({ workspaceId: WS, asOf: '2026-10-31' });
    expect(n.asOf).toBe('2026-10-31');
    expect(n.reportingCurrency).toBe('BOB');
    expect(amount(n.netWorth.netWorth)).toBe('32541.00 BOB');
    expect(amount(n.netWorth.assets)).toBe('32891.00 BOB');
    expect(amount(n.netWorth.liabilities)).toBe('350.00 BOB');
    expect(n.netWorth.complete).toBe(true);
    expect(n.netWorth.unvalued).toEqual([]);
    expect(n.accounts.map((a) => [a.name, amount(a.balance), amount(a.convertedBalance)])).toEqual([
      ['Bank A', '5200.00 BOB', '5200.00 BOB'],
      ['USD Savings', '1500.00 USD', '18075.00 BOB'],
      ['Binance USDT', '800.000000 USDT', '9616.00 BOB'],
      ['Visa BOB', '350.00 BOB', '350.00 BOB'],
    ]);
    expect(n.ratesUsed.map((r) => r.rate.value).sort()).toEqual(['12.02', '12.05']);
    // Las tasas de stocks se piden al cierre del 31/10 en La Paz (23:59:59.999 = 03:59:59.999Z del 1/11).
    expect(mem.rateRequests).toEqual([
      { base: 'USD', quote: 'BOB', at: '2026-11-01T03:59:59.999Z' },
      { base: 'USDT', quote: 'BOB', at: '2026-11-01T03:59:59.999Z' },
    ]);
  });

  it('[TC-PLANNING-SNAPSHOT-001] sin tasa USDT el patrimonio es incompleto y lista 800.000000 USDT sin valorar', async () => {
    october();
    const i = mem.rates.findIndex((r) => r.base === 'USDT');
    mem.rates.splice(i, 1);
    const n = await netWorthQuery().getNetWorth({ workspaceId: WS, asOf: '2026-10-31' });
    expect(n.netWorth.complete).toBe(false);
    expect(n.netWorth.unvalued.map(amount)).toEqual(['800.000000 USDT']);
    expect(amount(n.netWorth.netWorth)).toBe('22925.00 BOB');
    expect(n.accounts.find((a) => a.accountId === 'usdt')?.convertedBalance).toBeNull();
  });

  it('[TC-PLANNING-SNAPSHOT-001] con corte en el futuro las tasas se piden como máximo a "ahora"', async () => {
    october();
    mem.clock.set(Instant.parse('2026-10-20T12:00:00Z'));
    await netWorthQuery().getNetWorth({ workspaceId: WS, asOf: '2026-10-31' });
    expect(mem.rateRequests.every((r) => r.at === '2026-10-20T12:00:00.000Z')).toBe(true);
  });
});

describe('Cifras de cierre — propiedades', () => {
  it('[TC-PLANNING-SNAPSHOT-001] ∀ tasas y saldos aleatorios: Σ saldos valorizados por cuenta = patrimonio (INV-031)', async () => {
    const BOB = currency('BOB', 2);
    const cents = fc.integer({ min: 0, max: 10_000_000 }).map((n) => (n / 100).toFixed(2));
    const rate = fc.integer({ min: 100, max: 2500 }).map((n) => (n / 100).toFixed(2));
    await fc.assert(
      fc.asyncProperty(cents, cents, cents, cents, rate, rate, async (bank, usd, usdt, debt, rUsd, rUsdt) => {
        mem = new InMemoryReporting();
        mem.clock.set(Instant.parse('2026-11-01T15:00:00Z'));
        mem.addAccount({ accountId: 'banco', name: 'A', type: 'BANK', currency: 'BOB' }, bank);
        mem.addAccount({ accountId: 'usd', name: 'B', type: 'SAVINGS', currency: 'USD' }, usd);
        mem.addAccount(
          { accountId: 'usdt', name: 'C', type: 'CRYPTO_WALLET', currency: 'USDT' },
          usdt + '0000',
        );
        mem.addAccount({ accountId: 'visa', name: 'D', type: 'CREDIT_CARD', currency: 'BOB' }, debt);
        mem.rates.push(
          { base: 'USD', quote: 'BOB', value: rUsd, asOf: '2026-10-31T20:00:00Z' },
          { base: 'USDT', quote: 'BOB', value: rUsdt, asOf: '2026-10-31T20:00:00Z' },
        );
        const n = await netWorthQuery().getNetWorth({ workspaceId: WS, asOf: '2026-10-31' });
        const rates: Record<string, string> = { BOB: '1', USD: rUsd, USDT: rUsdt };
        // Σ exacta (sin redondeo intermedio) con signo por naturaleza; HALF_EVEN una sola vez.
        const exact = n.accounts.reduce((acc, a) => {
          const value = dec(a.balance.amount).times(rates[a.balance.currency] as string);
          return a.nature === 'ASSET' ? acc.plus(value) : acc.minus(value);
        }, dec('0'));
        expect(n.netWorth.complete).toBe(true);
        expect(n.netWorth.netWorth.amount).toBe(present(exact, BOB).toJSON().amount);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
