import { dec } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RobustStats } from './robust-stats.js';

const d = (xs: readonly (string | number)[]) => xs.map((x) => dec(String(x)));
const RESTAURANTS = d([60, 65, 70, 75, 78, 80, 80, 82, 85, 90, 95, 100]);
const money = fc.integer({ min: 1, max: 5_000_000 }).map((n) => dec((n / 100).toFixed(2)));

describe('RobustStats', () => {
  it('[TC-FORECAST-ANOMALY-001] mediana 80.00 y MAD 7.50 de los 12 gastos de «Restaurantes»', () => {
    const median = RobustStats.median(RESTAURANTS);
    expect(median.toFixed(2)).toBe('80.00');
    expect(RobustStats.mad(RESTAURANTS, median).toFixed(2)).toBe('7.50');
  });

  it('[TC-FORECAST-ANOMALY-001] el puntaje robusto de 304.00 supera ampliamente 3.5', () => {
    const z = RobustStats.robustScore(dec('304'), dec('80'), dec('7.5'));
    expect(z?.gte(3.5)).toBe(true);
    expect(z?.toDecimalPlaces(2).toFixed(2)).toBe('20.15');
  });

  it('[TC-FORECAST-ANOMALY-004] con MAD igual a cero el puntaje no está definido', () => {
    const forty = d(Array.from({ length: 10 }, () => 40));
    const median = RobustStats.median(forty);
    const mad = RobustStats.mad(forty, median);
    expect(mad.isZero()).toBe(true);
    expect(RobustStats.robustScore(dec('132'), median, mad)).toBeNull();
  });

  it('[TC-FORECAST-ANOMALY-001] la mediana de una muestra par es el promedio de los dos centrales', () => {
    expect(RobustStats.median(d([1, 2, 3, 10])).toFixed(2)).toBe('2.50');
    expect(RobustStats.median(d([5])).toFixed(2)).toBe('5.00');
  });

  it('[TC-FORECAST-ANOMALY-006] percentil por rango más cercano: ⌈p/100 × n⌉', () => {
    const xs = d(Array.from({ length: 20 }, (_, i) => (i + 1) * 100)); // 100..2000
    expect(RobustStats.percentileNearestRank(xs, 95).toFixed(0)).toBe('1900');
    expect(RobustStats.percentileNearestRank(xs, 100).toFixed(0)).toBe('2000');
    expect(RobustStats.percentileNearestRank(d([7]), 95).toFixed(0)).toBe('7');
  });

  it('una muestra vacía o un percentil fuera de rango se rechazan', () => {
    expect(() => RobustStats.median([])).toThrow();
    expect(() => RobustStats.percentileNearestRank(d([1]), 0)).toThrow();
    expect(() => RobustStats.percentileNearestRank(d([1]), 101)).toThrow();
  });

  it('[TC-FORECAST-ANOMALY-002] PBT: la mediana y el MAD no cambian al permutar la muestra', () => {
    fc.assert(
      fc.property(fc.array(money, { minLength: 1, maxLength: 40 }), fc.integer(), (xs, seed) => {
        const k = Math.abs(seed) % xs.length;
        const shuffled = [...xs.slice(k), ...xs.slice(0, k)].reverse();
        const m1 = RobustStats.median(xs);
        const m2 = RobustStats.median(shuffled);
        return m1.eq(m2) && RobustStats.mad(xs, m1).eq(RobustStats.mad(shuffled, m2));
      }),
      { numRuns: 200 },
    );
  }, 30_000);

  it('[TC-FORECAST-ANOMALY-003] PBT: la mediana queda entre el mínimo y el máximo y el MAD no es negativo', () => {
    fc.assert(
      fc.property(fc.array(money, { minLength: 1, maxLength: 40 }), (xs) => {
        const median = RobustStats.median(xs);
        const min = xs.reduce((a, b) => (b.lt(a) ? b : a));
        const max = xs.reduce((a, b) => (b.gt(a) ? b : a));
        return median.gte(min) && median.lte(max) && !RobustStats.mad(xs, median).isNegative();
      }),
      { numRuns: 200 },
    );
  }, 30_000);

  it('[TC-FORECAST-ANOMALY-004] PBT: el percentil por rango más cercano pertenece a la muestra y crece con p', () => {
    fc.assert(
      fc.property(fc.array(money, { minLength: 1, maxLength: 40 }), (xs) => {
        const p50 = RobustStats.percentileNearestRank(xs, 50);
        const p95 = RobustStats.percentileNearestRank(xs, 95);
        return xs.some((x) => x.eq(p95)) && p95.gte(p50);
      }),
      { numRuns: 200 },
    );
  }, 30_000);
});
