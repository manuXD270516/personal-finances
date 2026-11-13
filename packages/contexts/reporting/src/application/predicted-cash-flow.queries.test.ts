import type { ForecastPointDto, ForecastSeriesDto, LatestForecastDto } from '@pf/forecasting/contracts';
import { Instant } from '@pf/shared-kernel';
import { beforeEach, describe, expect, it } from 'vitest';
import { CashFlowCalendarQueries } from './cash-flow-calendar.queries.js';
import type { CashFlowOccurrenceRow } from './ports/index.js';
import { ReportSummaryQueries } from './report-summary.queries.js';
import { InMemoryReporting } from './testing/in-memory.js';

const WS = '0190a000-0000-7000-8000-0000000000a1';
const USER = '0190a000-0000-7000-8000-000000000001';

let mem: InMemoryReporting;
const text = (m: { amount: string; currency: string } | null | undefined) =>
  m ? `${m.amount} ${m.currency}` : null;

const calendar = async (horizon = 7) =>
  (
    await new CashFlowCalendarQueries(mem.upcomingDeps()).getCashFlowCalendar({
      userId: USER,
      workspaceId: WS,
      horizon,
    })
  ).calendar;
const summary = async () =>
  (await new ReportSummaryQueries(mem.upcomingDeps()).getReportSummary({ userId: USER, workspaceId: WS }))
    .summary;

const money = (amount: string, currency = 'BOB') => ({ amount, currency });
const point = (
  period: string,
  start: string,
  end: string,
  monthsAhead: number,
  prediction: string,
  lower: string,
  upper: string,
  currency = 'BOB',
): ForecastPointDto => ({
  period,
  periodStart: start,
  periodEnd: end,
  monthsAhead,
  prediction: money(prediction, currency),
  interval80: { lower: money(lower, currency), upper: money(upper, currency) },
  interval95: { lower: money(lower, currency), upper: money(upper, currency) },
  baseline: { method: 'MEAN_LAST_N', n: 6, value: money(prediction, currency) },
  components: null,
  drivers: null,
  coherenceGap: null,
});

const series = (
  scope: ForecastSeriesDto['scope'],
  currency: string,
  points: ForecastPointDto[],
  readiness: ForecastSeriesDto['readiness'] = 'MODEL',
): ForecastSeriesDto => ({
  scope,
  scopeRef: null,
  name: scope === 'TOTAL_EXPENSE' ? 'TOTAL_EXPENSE' : currency,
  readiness,
  readinessReasons: [],
  historyFrom: '2026-03',
  historyTo: '2026-10',
  historyPeriods: readiness === 'INSUFFICIENT' ? 2 : 8,
  groupedCategoryIds: [],
  currency,
  model: null,
  confidence: null,
  points,
});

const latest = (list: ForecastSeriesDto[], over: Partial<LatestForecastDto> = {}): LatestForecastDto => ({
  status: 'AVAILABLE',
  stale: false,
  lastAttempt: null,
  run: {
    id: 'run-1',
    trigger: 'SCHEDULED',
    status: 'COMPLETED',
    requestedAt: '2026-11-20T11:00:00.000Z',
    requestedBy: null,
    completedAt: '2026-11-20T12:00:00.000Z',
    asOfPeriod: '2026-10',
    attempts: 1,
    failureReason: null,
    seriesCount: { published: 1, insufficient: 0, invalid: 0 },
  },
  reportingCurrency: 'BOB',
  generatedAt: '2026-11-20T12:00:00.000Z',
  series: list,
  disclaimerKey: 'forecast.disclaimer',
  meta: { conversion: null },
  ...over,
});

const NOVEMBER = point('2026-11', '2026-11-01', '2026-11-30', 1, '1500.00', '1200.00', '1900.00');
const DECEMBER = point('2026-12', '2026-12-01', '2026-12-31', 2, '1550.00', '1200.00', '1900.00');
const bobSeries = (points = [NOVEMBER, DECEMBER]) => series('LIQUID_VARIABLE_OUTFLOW', 'BOB', points);

let seq = 0;
const occurrence = (
  name: string,
  dueDate: string,
  amount: string,
  over: Partial<CashFlowOccurrenceRow> = {},
) => {
  seq += 1;
  mem.cashFlowOccurrences.push({
    occurrenceId: `occ-${seq}`,
    definitionId: `def-${seq}`,
    definitionName: name,
    kind: 'EXPENSE',
    dueDate,
    status: 'SCHEDULED',
    expected: { type: 'FIXED', amount, min: null, max: null, currency: 'BOB' },
    accountId: 'banco',
    toAccountId: null,
    managedBy: 'USER',
    categoryId: null,
    ...over,
  });
};

/** Hoy 2026-11-21 (America/La_Paz), "Banco BOB" con 5000.00 y sin movimientos: la serie principal vale 5000.00 todos los días. */
beforeEach(() => {
  seq = 0;
  mem = new InMemoryReporting();
  mem.clock.set(Instant.parse('2026-11-21T14:00:00Z'));
  mem.spendableEnabled = true;
  mem.hasActiveDefinitions = true;
  mem.addAccount({ accountId: 'banco', name: 'Banco BOB', type: 'BANK', currency: 'BOB' }, '5000.00');
  mem.addPeriod('2026-11', '2026-11-01', '2026-11-30', 'ACTIVE');
  mem.liquidSpent = [{ currency: 'BOB', amount: '1050.00' }];
});

const bobOf = (c: Awaited<ReturnType<typeof calendar>>) => c.currencies.find((x) => x.currency === 'BOB')!;
const on = (c: Awaited<ReturnType<typeof calendar>>, date: string) =>
  bobOf(c).predicted.series.find((p) => p.date === date);

describe('Calendario de flujo de caja con la banda predicha (add-predicted-cash-flow-band)', () => {
  it('[TC-REPORTING-PREDICTED-001] el calendario de 7 días informa el 2026-11-28 4640.00 esperado, 4320.00 alto y 4880.00 bajo', async () => {
    mem.forecastLatest = latest([bobSeries()]);
    const c = await calendar(7);
    const day = on(c, '2026-11-28');
    expect(text(day?.expected)).toBe('4640.00 BOB');
    expect(text(day?.high)).toBe('4320.00 BOB');
    expect(text(day?.low)).toBe('4880.00 BOB');
    // La serie principal no se toca.
    expect(text(bobOf(c).series.find((p) => p.date === '2026-11-28')?.balance)).toBe('5000.00 BOB');
    expect(bobOf(c).predicted).toMatchObject({
      status: 'AVAILABLE',
      reason: null,
      forecastRunId: 'run-1',
      stale: false,
      intervalLevel: '0.8',
    });
    expect(bobOf(c).planned).toBeNull();
  });

  it('[TC-REPORTING-PREDICTED-002] con 2000.00 ya gastados las series adicionales coinciden con la principal hasta el 2026-11-30', async () => {
    mem.forecastLatest = latest([bobSeries()]);
    mem.liquidSpent = [{ currency: 'BOB', amount: '2000.00' }];
    const c = await calendar(30);
    for (const p of bobOf(c).predicted.series.filter((d) => d.date <= '2026-11-30')) {
      expect(text(p.expected)).toBe('5000.00 BOB');
      expect(text(p.high)).toBe('5000.00 BOB');
      expect(text(p.low)).toBe('5000.00 BOB');
    }
  });

  it('[TC-REPORTING-PREDICTED-003] en el calendario de 30 días cada día de diciembre resta 50.00 BOB con gasto esperado', async () => {
    mem.forecastLatest = latest([bobSeries()]);
    const c = await calendar(30);
    const nov30 = on(c, '2026-11-30');
    const dec01 = on(c, '2026-12-01');
    const dec20 = on(c, '2026-12-20');
    expect(text(nov30?.expected)).toBe('4550.00 BOB');
    expect(text(dec01?.expected)).toBe('4500.00 BOB');
    expect(text(dec20?.expected)).toBe('3550.00 BOB');
  });

  it('[TC-REPORTING-PREDICTED-006] con la función deshabilitada no hay bandas, el motivo es DISABLED y lo demás es igual', async () => {
    const without = await calendar(30);
    mem.forecastLatest = latest([], { status: 'DISABLED', run: null, generatedAt: null });
    const disabled = await calendar(30);
    expect(bobOf(disabled).predicted).toMatchObject({
      status: 'NOT_AVAILABLE',
      reason: 'DISABLED',
      series: [],
      lowest: null,
      shortfallLikelihood: 'NOT_AVAILABLE',
    });
    const strip = (c: Awaited<ReturnType<typeof calendar>>) =>
      JSON.stringify({
        ...c,
        currencies: c.currencies.map(({ predicted: _p, ...rest }) => rest),
        meta: null,
      });
    expect(strip(disabled)).toBe(strip(without));
  });

  it('[TC-REPORTING-PREDICTED-006] sin pronóstico (NONE) o sin la serie de la moneda informa NO_FORECAST y NO_SERIES', async () => {
    mem.forecastLatest = latest([], { status: 'NONE', run: null, generatedAt: null });
    expect(bobOf(await calendar()).predicted.reason).toBe('NO_FORECAST');
    mem.forecastLatest = latest([]);
    expect(bobOf(await calendar()).predicted.reason).toBe('NO_SERIES');
  });

  it('[TC-REPORTING-PREDICTED-006] una corrida sin el periodo en curso informa NO_CURRENT_PERIOD', async () => {
    mem.forecastLatest = latest([bobSeries([DECEMBER])]);
    expect(bobOf(await calendar()).predicted.reason).toBe('NO_CURRENT_PERIOD');
  });

  it('[TC-REPORTING-PREDICTED-007] la serie en dólares con 2 periodos de historia queda sin banda y BOB conserva la suya', async () => {
    mem.addAccount({ accountId: 'banco-usd', name: 'Banco USD', type: 'BANK', currency: 'USD' }, '800.00');
    mem.forecastLatest = latest([bobSeries(), series('LIQUID_VARIABLE_OUTFLOW', 'USD', [], 'INSUFFICIENT')]);
    const c = await calendar(7);
    expect(bobOf(c).predicted.status).toBe('AVAILABLE');
    const usd = c.currencies.find((x) => x.currency === 'USD')!;
    expect(usd.predicted).toMatchObject({ status: 'NOT_AVAILABLE', reason: 'INSUFFICIENT_DATA', series: [] });
  });

  it('[TC-REPORTING-PREDICTED-004] el déficit es posible si solo el gasto alto baja de la reserva mínima y es probable si baja el esperado', async () => {
    // La serie principal baja a 2600.00 el 2026-11-22; con 1500.00 de reserva la principal no tiene riesgo.
    occurrence('Compra grande', '2026-11-22', '2400.00');
    mem.minimumReserve = { amount: '1500.00', currency: 'BOB' };
    // Esperado: restante 400.00 (950 − … ver cifras) → 2600 − 450 = 2150; alto: restante 850.00 → 1750.
    mem.forecastLatest = latest([
      bobSeries([point('2026-11', '2026-11-01', '2026-11-30', 1, '1500.00', '1200.00', '1900.00')]),
    ]);
    mem.liquidSpent = [{ currency: 'BOB', amount: '1050.00' }];
    let c = await calendar(30);
    expect(bobOf(c).risk).toBe('NONE');
    expect(bobOf(c).predicted).toMatchObject({ shortfallLikelihood: 'UNLIKELY', firstShortfallDate: null });
    // Con 2200.00 de gasto alto restante el mínimo con gasto alto baja de 1500.00.
    mem.forecastLatest = latest([
      bobSeries([point('2026-11', '2026-11-01', '2026-11-30', 1, '1500.00', '1200.00', '3500.00')]),
    ]);
    c = await calendar(30);
    expect(bobOf(c).predicted.shortfallLikelihood).toBe('POSSIBLE');
    expect(bobOf(c).predicted.firstShortfallDate).not.toBeNull();
    expect(bobOf(c).risk).toBe('NONE');
  });

  it('[TC-REPORTING-PREDICTED-008] la banda por debajo del umbral no cambia el riesgo, no usa el pronóstico en el job y la probabilidad es probable', async () => {
    occurrence('Compra grande', '2026-11-22', '2400.00');
    mem.minimumReserve = { amount: '1500.00', currency: 'BOB' };
    const evaluate = () =>
      new CashFlowCalendarQueries(mem.upcomingDeps()).evaluateRisk({
        workspaceId: WS,
        timeZone: 'America/La_Paz',
        baseCurrency: 'BOB',
        horizonDays: 30,
      });
    const before = await evaluate();
    // Esperado restante 1180.00 en noviembre: 2600.00 − 1180.00 = 1420.00 < 1500.00.
    mem.forecastLatest = latest([
      bobSeries([point('2026-11', '2026-11-01', '2026-11-30', 1, '2230.00', '2000.00', '2500.00')]),
    ]);
    const c = await calendar(30);
    expect(bobOf(c).predicted.shortfallLikelihood).toBe('LIKELY');
    expect(text(bobOf(c).predicted.lowest?.expected.amount)).toBe('1420.00 BOB');
    expect(bobOf(c).risk).toBe(before.currencies[0]?.risk);
    expect(bobOf(c).risk).toBe('NONE');
    expect(bobOf(c).firstShortfallDate).toBeNull();
    mem.forecastCalls.length = 0;
    const after = await evaluate();
    expect(after).toEqual(before);
    expect(mem.forecastCalls).toEqual([]);
  });
});

describe('Home con el pronóstico (add-predicted-cash-flow-band)', () => {
  const totalExpense = (prediction: string, lower: string, upper: string) =>
    series('TOTAL_EXPENSE', 'BOB', [
      point('2026-11', '2026-11-01', '2026-11-30', 1, prediction, lower, upper),
    ]);

  it('[TC-REPORTING-PREDICTED-009] Q3 suma el gasto esperado del periodo con su rango probable del 80 %', async () => {
    mem.forecastLatest = latest([totalExpense('4408.00', '4038.00', '4788.00'), bobSeries()]);
    const s = await summary();
    expect(s.forecast?.expectedSpending).toMatchObject({
      period: '2026-11',
      prediction: { amount: '4408.00', currency: 'BOB' },
      interval80: { lower: { amount: '4038.00' }, upper: { amount: '4788.00' } },
      generatedAt: '2026-11-20T12:00:00.000Z',
      stale: false,
    });
  });

  it('[TC-REPORTING-PREDICTED-009] sin pronóstico vigente la tarjeta no cambia: forecast y predictedShortfall son null', async () => {
    const s = await summary();
    expect(s.forecast).toBeNull();
    expect(s.cashFlow?.predictedShortfall).toBeNull();
    mem.forecastLatest = latest([], { status: 'NONE', run: null, generatedAt: null });
    const none = await summary();
    expect(none.forecast).toBeNull();
    expect(none.cashFlow?.predictedShortfall).toBeNull();
  });

  it('[TC-REPORTING-PREDICTED-010] Q8 informa el déficit posible con el gasto predicho aparte del riesgo NONE', async () => {
    occurrence('Compra grande', '2026-11-22', '2400.00');
    mem.minimumReserve = { amount: '1500.00', currency: 'BOB' };
    mem.forecastLatest = latest([
      totalExpense('4408.00', '4038.00', '4788.00'),
      bobSeries([point('2026-11', '2026-11-01', '2026-11-30', 1, '1500.00', '1200.00', '3500.00')]),
    ]);
    const s = await summary();
    expect(s.cashFlow?.worst).toBeNull();
    expect(s.cashFlow?.predictedShortfall).toMatchObject({ currency: 'BOB', likelihood: 'POSSIBLE' });
    expect(s.cashFlow?.predictedShortfall?.date).toMatch(/^2026-11-\d\d$/);
    // Una sola lectura del pronóstico para las dos tarjetas.
    expect(mem.forecastCalls.filter((x) => x.kind === 'getLatest')).toHaveLength(1);
  });
});
