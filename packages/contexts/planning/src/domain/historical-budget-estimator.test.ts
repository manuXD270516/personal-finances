import { currency, dec } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  HistoricalBudgetEstimator,
  type EstimateInput,
  type EstimatorPeriod,
} from './historical-budget-estimator.js';

const BOB = currency('BOB', 2);

const eligible = (values: readonly string[]): EstimatorPeriod[] =>
  values.map((v, i) => ({ key: `p${i + 1}`, base: 'ELIGIBLE', actual: dec(v) }));

const run = (values: readonly string[], extra: Partial<EstimateInput> = {}) =>
  HistoricalBudgetEstimator.estimate({
    method: 'AVERAGE',
    requested: values.length,
    periods: eligible(values),
    currency: BOB,
    adjustmentPercent: dec('0'),
    roundingIncrement: null,
    ...extra,
  });

const VIAJE = ['1420.00', '1515.50', '1380.00', '3950.00', '1610.00', '1474.50'];

describe('HistoricalBudgetEstimator (planning/budgets, add-historical-budgets)', () => {
  it('[TC-PLANNING-HISTBUDGET-001] el promedio de cuatro periodos es 1495.00', () => {
    const e = run(['1380.00', '1515.50', '1610.00', '1474.50']);
    expect(e.status).toBe('OK');
    expect(e.suggested).toBe('1495.00');
    expect(e.usedCount).toBe(4);
  });

  it('[TC-PLANNING-HISTBUDGET-002] un periodo sin gasto cuenta como cero', () => {
    const e = run(['0.00', '300.00', '150.00']);
    expect(e.suggested).toBe('150.00');
    expect(e.periods[0]).toMatchObject({ status: 'USED', actual: '0.00' });
  });

  it('[TC-PLANNING-HISTBUDGET-004] el empate del promedio se redondea HALF_EVEN (100.005 -> 100.00)', () => {
    expect(run(['100.00', '100.01']).suggested).toBe('100.00');
    expect(run(['100.01', '100.02']).suggested).toBe('100.02');
  });

  it('[TC-PLANNING-HISTBUDGET-007] con menos de la mitad de N en valores válidos queda INSUFFICIENT_HISTORY', () => {
    const periods: EstimatorPeriod[] = [
      { key: 'a', base: 'BEFORE_FIRST_ACTIVITY', actual: null },
      { key: 'b', base: 'INCOMPLETE', actual: null },
      { key: 'c', base: 'ELIGIBLE', actual: dec('500.00') },
    ];
    const e = HistoricalBudgetEstimator.estimate({
      method: 'AVERAGE',
      requested: 3,
      periods,
      currency: BOB,
      adjustmentPercent: dec('0'),
      roundingIncrement: null,
    });
    expect(e).toMatchObject({ status: 'INSUFFICIENT_HISTORY', suggested: null, usedCount: 1, minValid: 2 });
    expect(e.periods.map((p) => p.status)).toEqual(['BEFORE_FIRST_ACTIVITY', 'INCOMPLETE', 'USED']);
  });

  it('[TC-PLANNING-HISTBUDGET-006] un periodo sin tasa se excluye y no cuenta como cero', () => {
    const periods: EstimatorPeriod[] = [
      { key: 'a', base: 'ELIGIBLE', actual: dec('300.00') },
      { key: 'b', base: 'NO_RATE', actual: null },
      { key: 'c', base: 'ELIGIBLE', actual: dec('500.00') },
    ];
    const e = HistoricalBudgetEstimator.estimate({
      method: 'AVERAGE',
      requested: 3,
      periods,
      currency: BOB,
      adjustmentPercent: dec('0'),
      roundingIncrement: null,
    });
    expect(e.suggested).toBe('400.00');
    expect(e.periods[1]).toMatchObject({ status: 'NO_RATE', actual: null });
  });

  it('[TC-PLANNING-HISTBUDGET-008] las vallas de Tukey excluyen el mes del viaje: Q1 1420.00, Q3 1610.00, sugerencia 1480.00', () => {
    const e = run(VIAJE);
    expect(e).toMatchObject({
      q1: '1420.00',
      q3: '1610.00',
      usedCount: 5,
      mean: '1480.00',
      median: '1474.50',
      suggested: '1480.00',
      outlierRule: 'TUKEY_1_5_IQR',
    });
    expect(e.periods[3]).toMatchObject({ status: 'OUTLIER', actual: '3950.00' });
  });

  it('[TC-PLANNING-HISTBUDGET-009] con menos de cuatro valores no se excluyen atípicos: 2268.17', () => {
    const e = run(['1380.00', '3950.00', '1474.50']);
    expect(e.suggested).toBe('2268.17');
    expect(e.outlierRule).toBe('NONE_SMALL_SAMPLE');
    expect(e.periods.every((p) => p.status === 'USED')).toBe(true);
  });

  it('[TC-PLANNING-HISTBUDGET-010] excluir a mano un periodo: Ropa queda en 300.00 con 3 usados', () => {
    const e = run(['300.00', '280.00', '320.00', '300.00'], { exclude: new Set(['p4']) });
    expect(e.suggested).toBe('300.00');
    expect(e.usedCount).toBe(3);
    expect(e.periods[3]?.status).toBe('USER_EXCLUDED');
  });

  it('[TC-PLANNING-HISTBUDGET-011] reincluir el atípico da 1891.67; incluir un periodo incompleto se rechaza', () => {
    const e = run(VIAJE, { include: new Set(['p4']) });
    expect(e.suggested).toBe('1891.67');
    expect(e.usedCount).toBe(6);
    const periods: EstimatorPeriod[] = [
      { key: 'a', base: 'INCOMPLETE', actual: null },
      { key: 'b', base: 'ELIGIBLE', actual: dec('10.00') },
    ];
    expect(() =>
      HistoricalBudgetEstimator.estimate({
        method: 'AVERAGE',
        requested: 2,
        periods,
        currency: BOB,
        adjustmentPercent: dec('0'),
        roundingIncrement: null,
        include: new Set(['a']),
      }),
    ).toThrowError(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('[TC-PLANNING-HISTBUDGET-012] el año anterior con ajuste 10 % da 1100.16 (1100.165 HALF_EVEN)', () => {
    const e = run(['1000.15'], {
      method: 'SAME_PERIOD_LAST_YEAR',
      requested: 1,
      adjustmentPercent: dec('10.00'),
    });
    expect(e.suggested).toBe('1100.16');
    expect(e.minValid).toBe(1);
  });

  it('[TC-PLANNING-HISTBUDGET-013] sin el periodo del año anterior la línea queda sin sugerencia', () => {
    const e = HistoricalBudgetEstimator.estimate({
      method: 'SAME_PERIOD_LAST_YEAR',
      requested: 1,
      periods: [{ key: '2025-11', base: 'BEFORE_FIRST_ACTIVITY', actual: null }],
      currency: BOB,
      adjustmentPercent: dec('0'),
      roundingIncrement: null,
    });
    expect(e.status).toBe('INSUFFICIENT_HISTORY');
    expect(e.periods[0]?.status).toBe('BEFORE_FIRST_ACTIVITY');
  });

  it('[TC-PLANNING-HISTBUDGET-014] el redondeo al múltiplo de 50 lleva 1480.00 a 1500.00', () => {
    expect(run(VIAJE, { roundingIncrement: 50 }).suggested).toBe('1500.00');
  });

  it('[TC-PLANNING-HISTBUDGET-015] el empate al múltiplo se resuelve al par: 125.00 con incremento 50 da 100.00', () => {
    expect(run(['125.00'], { roundingIncrement: 50 }).suggested).toBe('100.00');
    expect(run(['175.00'], { roundingIncrement: 50 }).suggested).toBe('200.00');
  });

  it('[TC-PLANNING-HISTBUDGET-031] propiedades: orden indiferente, entre mínimo y máximo, el atípico nunca se usa', () => {
    const values = fc.array(fc.integer({ min: 0, max: 5_000_000 }), { minLength: 1, maxLength: 12 });
    fc.assert(
      fc.property(values, fc.integer({ min: 0, max: 1000 }), (cents, seed) => {
        const texts = cents.map((c) => dec(String(c)).div(100).toFixed(2));
        const base = run(texts);
        const shuffled = [...texts].sort((a, b) => (a + seed < b + seed ? 1 : -1));
        const permuted = run(shuffled);
        expect(permuted.suggested).toBe(base.suggested);
        expect(permuted.usedCount).toBe(base.usedCount);
        if (base.suggested !== null) {
          const used = base.periods.filter((p) => p.status === 'USED').map((p) => dec(p.actual as string));
          const min = used.reduce((a, b) => (a.lt(b) ? a : b));
          const max = used.reduce((a, b) => (a.gt(b) ? a : b));
          expect(dec(base.suggested).gte(min)).toBe(true);
          expect(dec(base.suggested).lte(max)).toBe(true);
        }
        const outliers = base.periods.filter((p) => p.status === 'OUTLIER').length;
        expect(base.usedCount + outliers).toBe(texts.length);
      }),
      { numRuns: 200 },
    );
  }, 60_000);
});
