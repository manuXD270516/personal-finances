import { describe, expect, it } from 'vitest';
import { ReportSummaryQueries } from './report-summary.queries.js';
import { goldenScenario } from './testing/golden.js';
import { InMemoryReporting } from './testing/in-memory.js';

const bob = (amount: string) => ({ amount, currency: 'BOB' });

/**
 * Golden test del resumen (tarea 7.1): TODAS las cifras se calcularon a mano a partir de los TC de reporting. La Minimal
 * Seed (docs/29) aún no tiene datos financieros (solo identidades); este escenario es el oráculo de regresión de la
 * clasificación de flujos y de la valoración (Financial Regression Suite: TC-REPORTING-KPI-001..003).
 */
describe('Golden: resumen de septiembre 2026 del escenario canónico', () => {
  it('[TC-REPORTING-KPI-001] [TC-REPORTING-KPI-002] [TC-REPORTING-KPI-003] cifras a mano del Home', async () => {
    const mem = new InMemoryReporting();
    goldenScenario(mem);
    const { summary: s } = await new ReportSummaryQueries(mem.deps()).getReportSummary({
      userId: 'u',
      workspaceId: 'w',
      month: '2026-09',
      topCategories: 3,
    });
    expect(s.period).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(s.consolidated).toEqual({
      currency: 'BOB',
      income: bob('8000.00'),
      // 1200.00 + 300.00 − 200.00 + 5.00 + 20.00 USD × 11.96 (239.20) = 1544.20
      expense: bob('1544.20'),
      net: bob('6455.80'),
      // 805.50 + 50.000000 × 12.02; el BTC sin tasa queda fuera
      liquidBalance: bob('1406.50'),
      assets: bob('1406.50'),
      liabilities: bob('400.00'),
      netWorth: bob('1006.50'),
      // 6455.80 / 8000.00 = 80.6975 % → 80.7
      savingsRate: '80.7',
      complete: false,
      unconverted: [{ amount: '0.01000000', currency: 'BTC' }],
    });
    expect(
      s.byCurrency.map((c) => [c.currency, c.income.amount, c.expense.amount, c.liquidBalance.amount]),
    ).toEqual([
      ['BOB', '8000.00', '1305.00', '805.50'],
      ['BTC', '0.00000000', '0.00000000', '0.01000000'],
      ['USD', '0.00', '20.00', '0.00'],
      ['USDT', '0.000000', '0.000000', '50.000000'],
    ]);
    expect(s.topExpenseCategories.map((c) => [c.name, c.amount.amount, c.complete])).toEqual([
      ['Supermercado', '1200.00', true],
      ['Viajes', '239.20', true],
      ['Restaurantes', '100.00', true],
    ]);
    // A la fecha (30-sep): 1..30 de septiembre contra 1..30 de agosto.
    expect(s.comparison).toEqual({
      mode: 'PREVIOUS_PERIOD_TO_DATE',
      previousPeriod: { from: '2026-08-01', to: '2026-08-30' },
      income: {
        current: bob('8000.00'),
        previous: bob('0.00'),
        deltaAbs: bob('8000.00'),
        deltaPct: null,
        isNew: true,
      },
      // (1544.20 − 1200.00) / 1200.00 = 28.6833 % → 28.68
      expense: {
        current: bob('1544.20'),
        previous: bob('1200.00'),
        deltaAbs: bob('344.20'),
        deltaPct: '28.68',
        isNew: false,
      },
      // (6455.80 − (−1200.00)) / 1200.00 = 637.9833 % → 637.98
      savings: {
        current: bob('6455.80'),
        previous: bob('-1200.00'),
        deltaAbs: bob('7655.80'),
        deltaPct: '637.98',
        isNew: false,
      },
    });
    expect(s.netWorth).toMatchObject({
      netWorth: bob('1006.50'),
      complete: false,
      unvalued: [{ amount: '0.01000000', currency: 'BTC' }],
    });
    expect(s.meta.ratesUsed.map((r) => [r.rate.base, r.rate.value, r.ageSeconds])).toEqual([
      ['USDT', '12.02', 413],
      // Cierre del 10-sep en La Paz (2026-09-11T03:59:59.999Z) − 2026-09-10T20:00:00Z = 28 799 s
      ['USD', '11.96', 28799],
    ]);
    expect(s.meta).toMatchObject({ complete: false, approx: false, reportingCurrency: 'BOB' });
  });
});
