import { dec } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ForecastComposer } from './forecast-composer.js';
import type { ServiceResultPoint } from './forecast-request.js';

const point = (over: Partial<ServiceResultPoint> = {}): ServiceResultPoint => ({
  period: '2026-12',
  monthsAhead: 2,
  prediction: '1660.00',
  lower80: '1290.00',
  upper80: '2040.00',
  lower95: '1100.00',
  upper95: '2300.00',
  baselineValue: '1552.00',
  drivers: { historicalAverage: '1552.00', seasonality: '120.00', trendAndLevel: '-12.00' },
  ...over,
});

const known = (amount: string, itemCount: number, withoutAmountCount = 0) => ({
  amount: dec(amount),
  itemCount,
  withoutAmountCount,
});

describe('ForecastComposer.compose', () => {
  it('[TC-FORECAST-EXPENSE-001] 2748.00 conocidos + 1660.00 variable = 4408.00 con intervalo del 80 % de 4038.00 a 4788.00', () => {
    const c = ForecastComposer.compose({
      point: point(),
      known: known('2748.00', 3),
      scale: 2,
      outlierPeriods: [],
    });
    expect(c).toMatchObject({
      prediction: '4408.00',
      lower80: '4038.00',
      upper80: '4788.00',
      lower95: '3848.00',
      upper95: '5048.00',
      knownFuture: '2748.00',
      predictedVariable: '1660.00',
      variableLower80: '1290.00',
      variableUpper80: '2040.00',
    });
  });

  it('[TC-FORECAST-EXPENSE-012] los motivos informan promedio 1552.00, estacionalidad +120.00, tendencia -12.00 y conocidos 2748.00 con 3 compromisos', () => {
    const c = ForecastComposer.compose({
      point: point(),
      known: known('2748.00', 3),
      scale: 2,
      outlierPeriods: [],
    });
    const by = Object.fromEntries(c.drivers.map((d) => [d.type, d]));
    expect(by['HISTORICAL_AVERAGE']?.value).toBe('1552.00');
    expect(by['SEASONALITY']?.effect).toBe('120.00');
    expect(by['TREND_AND_LEVEL']?.effect).toBe('-12.00');
    expect(by['KNOWN_RECURRING']).toMatchObject({ value: '2748.00', refCount: 3 });
    expect(by['OUTLIERS']).toBeUndefined();
    const sum = dec('1552.00').plus('120.00').plus('-12.00');
    expect(sum.toFixed(2)).toBe(c.predictedVariable);
  });

  it('[TC-FORECAST-EXPENSE-012] el residuo de redondeo se asigna a TREND_AND_LEVEL para que la suma sea exacta', () => {
    const c = ForecastComposer.compose({
      point: point({
        drivers: { historicalAverage: '1552.00', seasonality: '120.00', trendAndLevel: '-11.99' },
      }),
      known: known('0.00', 0),
      scale: 2,
      outlierPeriods: [],
    });
    expect(c.drivers.find((d) => d.type === 'TREND_AND_LEVEL')?.effect).toBe('-12.00');
  });

  it('[TC-FORECAST-EXPENSE-012] sin modelo estacional no hay motivo de estacionalidad', () => {
    const c = ForecastComposer.compose({
      point: point({ drivers: { historicalAverage: '1600.00', seasonality: null, trendAndLevel: '60.00' } }),
      known: known('0.00', 0),
      scale: 2,
      outlierPeriods: [],
    });
    expect(c.drivers.some((d) => d.type === 'SEASONALITY')).toBe(false);
  });

  it('[TC-FORECAST-EXPENSE-022] los periodos atípicos se informan como motivo sin alterar la predicción', () => {
    const c = ForecastComposer.compose({
      point: point(),
      known: known('0.00', 0),
      scale: 2,
      outlierPeriods: ['2026-07'],
    });
    expect(c.drivers.find((d) => d.type === 'OUTLIERS')).toMatchObject({ periods: ['2026-07'], refCount: 1 });
    expect(c.prediction).toBe('1660.00');
  });

  it('[TC-FORECAST-EXPENSE-019] el sueldo conocido de 8000.00 más 350.00 de ingreso variable da 8350.00 con intervalo de 8000.00 a 8900.00', () => {
    const c = ForecastComposer.compose({
      point: point({
        prediction: '350.00',
        lower80: '0.00',
        upper80: '900.00',
        lower95: '0.00',
        upper95: '1400.00',
        baselineValue: '300.00',
        drivers: { historicalAverage: '300.00', seasonality: null, trendAndLevel: '50.00' },
      }),
      known: known('8000.00', 1),
      scale: 2,
      outlierPeriods: [],
    });
    expect(c).toMatchObject({ prediction: '8350.00', lower80: '8000.00', upper80: '8900.00' });
  });

  it('[TC-FORECAST-EXPENSE-001] un límite variable negativo se trunca a 0 antes de sumar los conocidos', () => {
    const c = ForecastComposer.compose({
      point: point({ lower80: '-50.00', lower95: '-90.00' }),
      known: known('100.00', 1),
      scale: 2,
      outlierPeriods: [],
    });
    expect(c.lower80).toBe('100.00');
    expect(c.lower95).toBe('100.00');
  });

  it('[TC-FORECAST-EXPENSE-012] propiedad: promedio + efectos = variable y lower80 <= esperado <= upper80', () => {
    const cents = fc.integer({ min: 0, max: 5_000_000 });
    const signed = fc.integer({ min: -2_000_000, max: 2_000_000 });
    const fmt = (n: number) => (n / 100).toFixed(2);
    fc.assert(
      fc.property(cents, signed, signed, cents, cents, cents, (avg, seas, trend, knownCents, lo, hi) => {
        const variable = Math.max(avg + seas + trend, 0);
        const lower = Math.min(lo, variable);
        const upper = variable + hi;
        const c = ForecastComposer.compose({
          point: point({
            prediction: fmt(variable),
            lower80: fmt(lower),
            upper80: fmt(upper),
            lower95: fmt(Math.max(lower - 10, 0)),
            upper95: fmt(upper + 10),
            drivers: {
              historicalAverage: fmt(avg),
              seasonality: fmt(seas),
              trendAndLevel: fmt(trend),
            },
          }),
          known: known(fmt(knownCents), 1),
          scale: 2,
          outlierPeriods: [],
        });
        const effects = c.drivers
          .filter((d) => d.type === 'SEASONALITY' || d.type === 'TREND_AND_LEVEL')
          .reduce((a, d) => a.plus(d.effect ?? '0'), dec('0'));
        const avgDriver = c.drivers.find((d) => d.type === 'HISTORICAL_AVERAGE')?.value ?? '0';
        expect(dec(avgDriver).plus(effects).toFixed(2)).toBe(c.predictedVariable);
        expect(dec(c.lower80).lte(c.prediction)).toBe(true);
        expect(dec(c.prediction).lte(c.upper80)).toBe(true);
        expect(dec(c.prediction).minus(c.knownFuture).toFixed(2)).toBe(c.predictedVariable);
      }),
      { numRuns: 100 },
    );
  }, 30_000);
});

describe('ForecastComposer.confidence', () => {
  it('[TC-FORECAST-EXPENSE-013] una serie de 9 periodos con MASE 0.70 tiene confianza baja', () => {
    expect(
      ForecastComposer.confidence({
        historyPeriods: 9,
        selectedBy: 'BACKTEST',
        mase: '0.7000',
        coverage80: '0.8000',
      }),
    ).toBe('LOW');
  });

  it('[TC-FORECAST-EXPENSE-013] la estimación simple o un MASE mayor que 1 también es confianza baja', () => {
    expect(
      ForecastComposer.confidence({ historyPeriods: 30, selectedBy: 'SIMPLE', mase: null, coverage80: null }),
    ).toBe('LOW');
    expect(
      ForecastComposer.confidence({
        historyPeriods: 30,
        selectedBy: 'BASELINE_FALLBACK',
        mase: '1.0200',
        coverage80: '0.8000',
      }),
    ).toBe('LOW');
  });

  it('[TC-FORECAST-EXPENSE-014] 30 periodos, MASE 0.72 y cobertura 0.79 dan confianza alta', () => {
    expect(
      ForecastComposer.confidence({
        historyPeriods: 30,
        selectedBy: 'BACKTEST',
        mase: '0.7200',
        coverage80: '0.7900',
      }),
    ).toBe('HIGH');
  });

  it('[TC-FORECAST-EXPENSE-014] sin cobertura calibrada o con menos de 24 periodos es media', () => {
    expect(
      ForecastComposer.confidence({
        historyPeriods: 30,
        selectedBy: 'BACKTEST',
        mase: '0.7200',
        coverage80: '0.5000',
      }),
    ).toBe('MEDIUM');
    expect(
      ForecastComposer.confidence({
        historyPeriods: 18,
        selectedBy: 'BACKTEST',
        mase: '0.7200',
        coverage80: '0.8000',
      }),
    ).toBe('MEDIUM');
  });
});

describe('ForecastComposer.coherenceGap', () => {
  it('[TC-FORECAST-EXPENSE-020] categorías 4700.00 contra total 4408.00: diferencia de 292.00 que supera el 5 %', () => {
    const g = ForecastComposer.coherenceGap({
      total: '4408.00',
      categories: ['2000.00', '1700.00', '1000.00'],
      scale: 2,
      ratio: '0.05',
    });
    expect(g).toEqual({ gap: '-292.00', exceeds: true });
  });

  it('[TC-FORECAST-EXPENSE-020] una diferencia de hasta el 5 % del total no se informa', () => {
    const g = ForecastComposer.coherenceGap({
      total: '4408.00',
      categories: ['4300.00'],
      scale: 2,
      ratio: '0.05',
    });
    expect(g).toEqual({ gap: '108.00', exceeds: false });
  });
});
