import { dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { FlowRow, ForecastRequestV1, ForecastResponseV1, OccurrenceInput } from '../domain/index.js';
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

/** Respuesta de phase8-v1: predice el último valor variable, con motivos y backtesting. */
const phase8Response = (request: ForecastRequestV1): ForecastResponseV1 => ({
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
      backtest: {
        origins: ['2026-09', '2026-10'],
        candidates: [
          { name: 'ETS_DAMPED', cuts: 2, mase: '0.7800', coverage80: '0.8000', bias: '0.1000' },
          { name: 'MEAN_LAST_6', cuts: 2, mase: '0.9000', coverage80: '0.5000', bias: '-0.2000' },
        ],
        selected: 'ETS_DAMPED',
        fallback: false,
        baselineMase: '0.9000',
      },
      outliers: [],
    };
  }),
});

const months = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `2026-${String(from + i).padStart(2, '0')}`);

/** 8 periodos con restaurantes 900, transporte 400 y alquiler 2500 por mes; el alquiler está emparejado con su ocurrencia. */
const seed = (w: TestWorld): void => {
  const rows: FlowRow[] = [];
  for (const m of months(3, 10)) {
    for (const [cat, amount] of [
      ['rest', '900.00'],
      ['transp', '400.00'],
      ['rent', '2500.00'],
    ] as const) {
      for (const day of ['03', '10', '17', '24']) {
        rows.push({
          businessDate: `${m}-${day}`,
          nature: 'EXPENSE',
          categoryId: cat,
          amount: { amount: dec(amount).div(4).toFixed(2), currency: 'BOB' },
        });
      }
    }
    rows.push({
      businessDate: `${m}-05`,
      nature: 'INCOME',
      categoryId: 'salary',
      amount: { amount: '9000.00', currency: 'BOB' },
    });
    w.resolved.push({
      kind: 'EXPENSE',
      managedBy: 'USER',
      transactionDate: `${m}-01`,
      amount: { amount: '2500.00', currency: 'BOB' },
      categoryId: 'rent',
    });
  }
  w.flows = rows;
  w.categories = {
    groups: [{ groupId: 'g1', name: 'Vida diaria' }],
    categories: [
      { categoryId: 'rest', groupId: 'g1', name: 'Restaurantes', uncategorized: false },
      { categoryId: 'transp', groupId: 'g1', name: 'Transporte', uncategorized: false },
      { categoryId: 'rent', groupId: 'g1', name: 'Alquiler', uncategorized: false },
    ],
  };
};

const occ = (over: Partial<OccurrenceInput> & Pick<OccurrenceInput, 'label' | 'date'>): OccurrenceInput => ({
  definitionId: `def-${over.label}`,
  occurrenceId: `00000000-0000-4000-8000-${String(over.label.length).padStart(12, '0')}`,
  projected: false,
  kind: 'EXPENSE',
  amountType: 'FIXED',
  amount: { amount: '100.00', currency: 'BOB' },
  minAmount: null,
  maxAmount: null,
  categoryId: null,
  managedBy: 'USER',
  ...over,
});

const world = (): TestWorld => {
  const w = buildWorld(T0);
  seed(w);
  w.service.steps = Array.from({ length: 4 }, () => phase8Response);
  w.occurrences = [
    occ({
      label: 'Alquiler',
      date: '2026-12-01',
      amount: { amount: '2500.00', currency: 'BOB' },
      categoryId: 'rent',
    }),
    occ({ label: 'Internet', date: '2026-12-10', amount: { amount: '199.00', currency: 'BOB' } }),
    occ({
      label: 'Netflix',
      date: '2026-12-15',
      managedBy: 'SUBSCRIPTION',
      amount: { amount: '49.00', currency: 'BOB' },
    }),
    occ({
      label: 'Sueldo',
      date: '2026-12-05',
      kind: 'INCOME',
      amount: { amount: '8000.00', currency: 'BOB' },
    }),
  ];
  return w;
};

const complete = async (w: TestWorld): Promise<string> => {
  const { runId } = await new RequestForecastRun(w.deps).execute({ workspaceId: WS, userId: 'u-editor' });
  const outcome = await new ExecuteForecastRun(w.deps).runOnce();
  expect(outcome).toEqual({ kind: 'COMPLETED', runId });
  return runId;
};

describe('ExecuteForecastRun con la descomposición (add-expense-forecasts)', () => {
  it('[TC-FORECAST-EXPENSE-002] el servicio recibe la historia VARIABLE: 3800.00 de gasto menos 2500.00 de alquiler resuelto', async () => {
    const w = world();
    await complete(w);
    const request = w.service.requests[0] as ForecastRequestV1;
    expect(request.policy.modelSet).toBe('phase8-v1');
    const requestedValues = request.series.map((s) => s.points.at(-1)?.value);
    expect(requestedValues).toContain('1300.00'); // gasto total variable
    expect(requestedValues).toContain('0.00'); // Alquiler (categoría solo recurrente)
    expect(request.series.every((s) => s.outlierPolicy === 'MAD_3_5')).toBe(true);
    // Sin nombres ni etiquetas de conocidos en la petición (FR-FORECAST-006).
    expect(JSON.stringify(request)).not.toMatch(/Alquiler|Netflix|Internet|Sueldo/);
  });

  it('[TC-FORECAST-EXPENSE-001] el punto de 2026-12 es la suma exacta de conocidos 2748.00 y variable 1300.00', async () => {
    const w = world();
    const runId = await complete(w);
    const latest = await new ForecastQueries(w.deps).getLatest({ workspaceId: WS });
    const total = latest.series.find((s) => s.scope === 'TOTAL_EXPENSE');
    const dic = total?.points.find((p) => p.period === '2026-12');
    expect(dic?.components).toMatchObject({
      knownFuture: { amount: '2748.00' },
      predictedVariable: { amount: '1300.00' },
      predictedVariableInterval80: { lower: { amount: '1170.00' }, upper: { amount: '1430.00' } },
      knownWithoutAmountCount: 0,
    });
    expect(dic?.prediction.amount).toBe('4048.00');
    expect(dic?.interval80).toEqual({
      lower: { amount: '3918.00', currency: 'BOB' },
      upper: { amount: '4178.00', currency: 'BOB' },
    });
    expect(dic?.drivers?.find((d) => d.type === 'KNOWN_RECURRING')).toMatchObject({
      value: { amount: '2748.00' },
      refCount: 3,
    });
    expect(total?.model).toMatchObject({ selectedBy: 'BACKTEST', mase: '0.7800', baselineMase: '0.9000' });
    expect(total?.confidence).toBe('LOW'); // 8 periodos
    expect(w.series.metadata.get(runId)).toMatchObject({ modelSet: 'phase8-v1', conversion: null });
    expect(typeof w.series.metadata.get(runId)?.seed).toBe('number');
  });

  it('[TC-FORECAST-EXPENSE-019] el ingreso total suma el sueldo conocido de 8000.00 y el ingreso variable predicho', async () => {
    const w = world();
    await complete(w);
    const latest = await new ForecastQueries(w.deps).getLatest({ workspaceId: WS });
    const income = latest.series.find((s) => s.scope === 'TOTAL_INCOME');
    const dic = income?.points.find((p) => p.period === '2026-12');
    expect(dic?.components?.knownFuture.amount).toBe('8000.00');
    // Historia variable del ingreso: 9000.00 (los sueldos no están emparejados en este escenario).
    expect(dic?.prediction.amount).toBe('17000.00');
  });

  it('[TC-FORECAST-EXPENSE-001] los conocidos de un periodo se listan con su origen, y una categoría solo ve los suyos', async () => {
    const w = world();
    await complete(w);
    const q = new ForecastQueries(w.deps);
    const all = await q.listKnownItems({ workspaceId: WS, scope: 'TOTAL_EXPENSE', period: '2026-12' });
    expect(all.items.map((i) => i.label)).toEqual(['Alquiler', 'Internet', 'Netflix']);
    expect(all.items[0]).toMatchObject({
      kind: 'EXPENSE',
      amountType: 'FIXED',
      amount: { amount: '2500.00', currency: 'BOB' },
      originalAmount: null,
      sourceRef: { context: 'COMMITMENTS' },
    });
    const rent = await q.listKnownItems({
      workspaceId: WS,
      scope: 'CATEGORY',
      scopeRef: 'rent',
      period: '2026-12',
    });
    expect(rent.items.map((i) => i.label)).toEqual(['Alquiler']);
    expect(
      (await q.listKnownItems({ workspaceId: WS, scope: 'TOTAL_EXPENSE', period: '2027-06' })).items,
    ).toEqual([]);
    await expect(
      q.listKnownItems({ workspaceId: WS, scope: 'NOPE', period: '2026-12' }),
    ).rejects.toMatchObject({
      code: 'INVALID_FILTER',
    });
    await expect(
      q.listKnownItems({ workspaceId: WS, scope: 'TOTAL_EXPENSE', period: 'diciembre' }),
    ).rejects.toMatchObject({ code: 'INVALID_FILTER' });
  });

  it('[TC-FORECAST-EXPENSE-005] un conocido en USD se convierte con la tasa de hoy y la respuesta declara la conversión', async () => {
    const w = world();
    w.occurrences.push(
      occ({ label: 'Spotify', date: '2026-12-20', amount: { amount: '9.99', currency: 'USD' } }),
    );
    const runId = await complete(w);
    const q = new ForecastQueries(w.deps);
    const items = await q.listKnownItems({ workspaceId: WS, scope: 'TOTAL_EXPENSE', period: '2026-12' });
    expect(items.items.find((i) => i.label === 'Spotify')).toMatchObject({
      amount: { amount: '69.53', currency: 'BOB' },
      originalAmount: { amount: '9.99', currency: 'USD' },
    });
    const latest = await q.getLatest({ workspaceId: WS });
    expect(latest.meta.conversion).toMatchObject({ rateDate: '2026-11-05' });
    expect(latest.meta.conversion?.ratesUsed).toHaveLength(1);
    expect(w.series.metadata.get(runId)?.conversion).not.toBeNull();
  });

  it('[TC-FORECAST-EXPENSE-006] una factura VARIABLE no suma al esperado y se cuenta sin monto', async () => {
    const w = world();
    w.occurrences.push(occ({ label: 'Luz', date: '2026-12-12', amountType: 'VARIABLE', amount: null }));
    await complete(w);
    const latest = await new ForecastQueries(w.deps).getLatest({ workspaceId: WS });
    const dic = latest.series
      .find((s) => s.scope === 'TOTAL_EXPENSE')
      ?.points.find((p) => p.period === '2026-12');
    expect(dic?.components?.knownFuture.amount).toBe('2748.00');
    expect(dic?.components?.knownWithoutAmountCount).toBe(1);
  });

  it('[TC-FORECAST-EXPENSE-020] la diferencia entre las categorías y el total solo se informa si supera el 5 %', async () => {
    const w = world();
    await complete(w);
    const latest = await new ForecastQueries(w.deps).getLatest({ workspaceId: WS });
    const dic = latest.series
      .find((s) => s.scope === 'TOTAL_EXPENSE')
      ?.points.find((p) => p.period === '2026-12');
    // Total 4048.00; categorías: alquiler 2500.00 + restaurantes 900.00 + transporte 400.00 = 3800.00.
    expect(dic?.coherenceGap).toEqual({ amount: '248.00', currency: 'BOB' });
    const other = latest.series.find((s) => s.scope === 'TOTAL_INCOME');
    expect(other?.points.every((p) => p.coherenceGap === null)).toBe(true);
    const noGap = buildWorld(T0, { coherenceGapRatio: '0.50' });
    seed(noGap);
    noGap.service.steps = [phase8Response];
    noGap.occurrences = world().occurrences;
    await complete(noGap);
    const calm = await new ForecastQueries(noGap.deps).getLatest({ workspaceId: WS });
    expect(
      calm.series.find((s) => s.scope === 'TOTAL_EXPENSE')?.points.every((p) => p.coherenceGap === null),
    ).toBe(true);
  });

  it('[TC-FORECAST-EXPENSE-021] la semilla de la corrida se deriva de su id y el conjunto de datos no depende de ella', async () => {
    const a = world();
    const b = world();
    await complete(a);
    await complete(b);
    const [reqA, reqB] = [a.service.requests[0], b.service.requests[0]] as [
      ForecastRequestV1,
      ForecastRequestV1,
    ];
    expect(reqA.seed).toBeGreaterThanOrEqual(0);
    expect(reqA.seed).toBeLessThanOrEqual(2_147_483_647);
    // Mismos ids de corrida (mundos idénticos): misma semilla; el snapshot ignora requestId y semilla.
    expect(reqA.seed).toBe(reqB.seed);
    const snapshots = [...a.runs.rows.values()].map((r) => r.snapshot.datasetSnapshotId);
    expect(snapshots[0]).toMatch(/^sha256:/);
  });

  it('[TC-FORECAST-EXPENSE-017] una categoría con pocos periodos conserva sus conocidos aunque no tenga pronóstico', async () => {
    const w = world();
    w.categories = {
      ...w.categories,
      categories: [
        ...w.categories.categories,
        { categoryId: 'viajes', groupId: 'g1', name: 'Viajes', uncategorized: false },
      ],
    };
    w.flows = [
      ...w.flows,
      ...['09', '10'].flatMap((m) =>
        ['03', '10', '17', '24'].map((day) => ({
          businessDate: `2026-${m}-${day}`,
          nature: 'EXPENSE' as const,
          categoryId: 'viajes',
          amount: { amount: '50.00', currency: 'BOB' },
        })),
      ),
    ];
    w.occurrences.push(
      occ({
        label: 'Seguro de viaje',
        date: '2027-01-10',
        amount: { amount: '90.00', currency: 'BOB' },
        categoryId: 'viajes',
      }),
    );
    await complete(w);
    const latest = await new ForecastQueries(w.deps).getLatest({ workspaceId: WS });
    const trips = latest.series.find((s) => s.scopeRef === 'viajes');
    expect(trips?.readiness).toBe('INSUFFICIENT');
    expect(trips?.readinessReasons[0]).toMatchObject({ code: 'TOO_FEW_PERIODS', missingForModel: 4 });
    expect(trips?.points).toEqual([]);
    const items = await new ForecastQueries(w.deps).listKnownItems({
      workspaceId: WS,
      scope: 'CATEGORY',
      scopeRef: 'viajes',
      period: '2027-01',
    });
    expect(items.items.map((i) => i.label)).toEqual(['Seguro de viaje']);
  });
});
