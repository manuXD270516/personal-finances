import { dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { FlowRow, ForecastRequestV1, ForecastResponseV1 } from '../domain/index.js';
import { ExecuteForecastRun } from './execute-forecast-run.js';
import { ForecastQueries } from './forecast-queries.js';
import { RequestForecastRun } from './request-forecast-run.js';
import { buildWorld, type TestWorld } from './testing/in-memory.js';

const WS = 'w1';
const T0 = '2026-11-05T15:00:00.000Z';

const shift = (period: string, months: number): string => {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + months;
  return `${String(Math.floor(i / 12)).padStart(4, '0')}-${String((i % 12) + 1).padStart(2, '0')}`;
};

/** Predice el último valor de cada serie con intervalo del 80 % de ±10 %. */
const response = (request: ForecastRequestV1): ForecastResponseV1 => ({
  schemaVersion: '1',
  requestId: request.requestId,
  serviceVersion: '1.0.0',
  durationMs: 7,
  results: request.series.map((s) => {
    const last = dec(s.points.at(-1)?.value ?? '0');
    const f = (v: ReturnType<typeof dec>) => v.toFixed(s.scale);
    return {
      ref: s.ref,
      status: 'OK' as const,
      error: null,
      model: { name: 'ETS_DAMPED', version: '1', selectedBy: 'BACKTEST' },
      baseline: { method: 'MEAN_LAST_N', n: 6 },
      points: Array.from({ length: s.horizon }, (_, i) => ({
        period: shift(s.points.at(-1)?.period ?? '2026-10', i + 1),
        monthsAhead: i + 1,
        prediction: f(last),
        lower80: f(last.times('0.9')),
        upper80: f(last.times('1.1')),
        lower95: f(last.times('0.8')),
        upper95: f(last.times('1.2')),
        baselineValue: f(last),
        drivers: { historicalAverage: f(last), seasonality: null, trendAndLevel: f(dec('0')) },
      })),
      outliers: [],
    };
  }),
});

const months = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `2026-${String(from + i).padStart(2, '0')}`);

const row = (date: string, amount: string, currency = 'BOB'): FlowRow => ({
  businessDate: date,
  nature: 'EXPENSE',
  categoryId: 'rest',
  amount: { amount, currency },
});

/** 8 periodos (2026-03..2026-10): 3900.00 BOB desde cuentas líquidas con 2748.00 resueltos y 600.00 en la tarjeta; USD solo 2 periodos. */
const world = (): TestWorld => {
  const w = buildWorld(T0);
  w.service.steps = [response];
  w.liquidAccounts = [
    { accountId: 'efectivo', currency: 'BOB', scale: 2 },
    { accountId: 'banco-usd', currency: 'USD', scale: 2 },
  ];
  w.categories = {
    groups: [{ groupId: 'g1', name: 'Vida diaria' }],
    categories: [{ categoryId: 'rest', groupId: 'g1', name: 'Restaurantes', uncategorized: false }],
  };
  const flows: FlowRow[] = [];
  for (const m of months(3, 10)) {
    flows.push(row(`${m}-03`, '3900.00'), row(`${m}-04`, '600.00'));
    w.resolved.push({
      kind: 'EXPENSE',
      managedBy: 'USER',
      transactionDate: `${m}-01`,
      amount: { amount: '2748.00', currency: 'BOB' },
      categoryId: 'rest',
      accountId: 'efectivo',
    });
    w.liquidFlows.push(
      {
        businessDate: `${m}-03`,
        accountId: 'efectivo',
        amount: { amount: '3900.00', currency: 'BOB' },
        loanComponent: false,
      },
      {
        businessDate: `${m}-04`,
        accountId: 'visa-oro',
        amount: { amount: '600.00', currency: 'BOB' },
        loanComponent: false,
      },
    );
  }
  for (const m of months(9, 10)) {
    w.liquidFlows.push({
      businessDate: `${m}-06`,
      accountId: 'banco-usd',
      amount: { amount: '120.00', currency: 'USD' },
      loanComponent: false,
    });
  }
  w.flows = flows;
  return w;
};

const complete = async (w: TestWorld): Promise<string> => {
  const { runId } = await new RequestForecastRun(w.deps).execute({ workspaceId: WS, userId: 'u-editor' });
  const outcome = await new ExecuteForecastRun(w.deps).runOnce();
  expect(outcome).toEqual({ kind: 'COMPLETED', runId });
  return runId;
};

describe('Serie del gasto variable líquido en ExecuteForecastRun (add-predicted-cash-flow-band)', () => {
  it('[TC-FORECAST-CASHFLOW-001] el servicio recibe 1152.00 BOB (3900.00 − 2748.00) y la tarjeta no cuenta [TC-FORECAST-CASHFLOW-002]', async () => {
    const w = world();
    await complete(w);
    const request = w.service.requests[0] as ForecastRequestV1;
    const bob = request.series.filter((s) => s.currency === 'BOB' && s.horizon === 4);
    expect(bob).toHaveLength(1);
    expect(bob[0]?.points.at(-1)).toMatchObject({ period: '2026-10', value: '1152.00' });
    expect(bob[0]?.points).toHaveLength(8);
  });

  it('[TC-FORECAST-CASHFLOW-001] la serie cubre el periodo en curso y los 3 siguientes con intervalo del 80 % y sin conocidos', async () => {
    const w = world();
    await complete(w);
    const latest = await new ForecastQueries(w.deps).getLatest({
      workspaceId: WS,
      scopes: ['LIQUID_VARIABLE_OUTFLOW'],
      horizon: 6,
    });
    const bob = latest.series.find((s) => s.currency === 'BOB');
    expect(bob?.scope).toBe('LIQUID_VARIABLE_OUTFLOW');
    expect(bob?.points.map((p) => p.period)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    expect(bob?.points[0]).toMatchObject({
      prediction: { amount: '1152.00', currency: 'BOB' },
      interval80: { lower: { amount: '1036.80' }, upper: { amount: '1267.20' } },
      components: { knownFuture: { amount: '0.00' } },
    });
  });

  it('[TC-FORECAST-CASHFLOW-003] la serie en dólares queda en dólares y con 2 periodos de historia no se publica', async () => {
    const w = world();
    await complete(w);
    const latest = await new ForecastQueries(w.deps).getLatest({
      workspaceId: WS,
      scopes: ['LIQUID_VARIABLE_OUTFLOW'],
    });
    const usd = latest.series.find((s) => s.currency === 'USD');
    expect(usd).toMatchObject({ readiness: 'INSUFFICIENT', historyPeriods: 2, points: [] });
    expect(latest.series.map((s) => s.currency).sort()).toEqual(['BOB', 'USD']);
  });

  it('[TC-FORECAST-CASHFLOW-003] con suficiente historia la serie en dólares se pronostica sin convertirla a BOB', async () => {
    const w = world();
    for (const m of months(3, 8)) {
      w.liquidFlows.push({
        businessDate: `${m}-06`,
        accountId: 'banco-usd',
        amount: { amount: '120.00', currency: 'USD' },
        loanComponent: false,
      });
    }
    await complete(w);
    const request = w.service.requests[0] as ForecastRequestV1;
    const usd = request.series.find((s) => s.currency === 'USD');
    expect(usd?.points.at(-1)).toMatchObject({ period: '2026-10', value: '120.00' });
    const latest = await new ForecastQueries(w.deps).getLatest({
      workspaceId: WS,
      scopes: ['LIQUID_VARIABLE_OUTFLOW'],
    });
    expect(latest.series.find((s) => s.currency === 'USD')?.points[0]?.prediction).toEqual({
      amount: '120.00',
      currency: 'USD',
    });
  });

  it('[TC-FORECAST-CASHFLOW-001] sin pedir el scope, el pronóstico vigente no cambia: no trae la serie líquida ni la cuenta', async () => {
    const w = world();
    const runId = await complete(w);
    const queries = new ForecastQueries(w.deps);
    const latest = await queries.getLatest({ workspaceId: WS });
    expect(latest.series.some((s) => s.scope === 'LIQUID_VARIABLE_OUTFLOW')).toBe(false);
    const run = await queries.getRun({ workspaceId: WS, runId });
    // Los contadores de la corrida solo cuentan las series de siempre (el USD con 2 periodos no suma).
    expect(latest.run?.seriesCount.insufficient).toBe(
      run.series.filter((s) => s.scope !== 'LIQUID_VARIABLE_OUTFLOW' && s.readiness === 'INSUFFICIENT')
        .length,
    );
    expect(run.series.filter((s) => s.scope === 'LIQUID_VARIABLE_OUTFLOW')).toHaveLength(2);
  });

  it('[TC-FORECAST-CASHFLOW-001] sin cuentas líquidas la corrida no genera la serie', async () => {
    const w = world();
    w.liquidAccounts = [];
    await complete(w);
    const latest = await new ForecastQueries(w.deps).getLatest({
      workspaceId: WS,
      scopes: ['LIQUID_VARIABLE_OUTFLOW'],
    });
    expect(latest.series).toEqual([]);
  });

  it('[TC-REPORTING-PREDICTED-001] el gasto variable líquido ya hecho en el periodo sale de la misma regla (1050.00)', async () => {
    const w = world();
    w.liquidFlows = [
      {
        businessDate: '2026-11-02',
        accountId: 'efectivo',
        amount: { amount: '1800.00', currency: 'BOB' },
        loanComponent: false,
      },
      {
        businessDate: '2026-11-03',
        accountId: 'visa-oro',
        amount: { amount: '600.00', currency: 'BOB' },
        loanComponent: false,
      },
    ];
    w.resolved = [
      {
        kind: 'EXPENSE',
        managedBy: 'USER',
        transactionDate: '2026-11-01',
        amount: { amount: '750.00', currency: 'BOB' },
        categoryId: 'rest',
        accountId: 'efectivo',
      },
    ];
    const spent = await new ForecastQueries(w.deps).spentBetween({
      workspaceId: WS,
      from: '2026-11-01',
      to: '2026-11-05',
    });
    expect(spent).toEqual([{ currency: 'BOB', amount: '1050.00' }]);
  });
});
