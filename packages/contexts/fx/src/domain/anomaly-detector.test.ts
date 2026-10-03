import { describe, expect, it } from 'vitest';
import { AnomalyDetector, variationPct } from './anomaly-detector.js';

// TDD de la detección de anomalías (fx/market-rate-providers; design.md decisión 8).
describe('AnomalyDetector (fx/market-rate-providers)', () => {
  const detector = new AnomalyDetector('5');
  const baseline = { rateId: 'r-12.02', value: '12.02' };

  it('[TC-FX-PROVIDER-010] 12.02 → 13.50 = +12.3128 % (precisión 40, HALF_EVEN a 4 decimales): anómala', () => {
    expect(variationPct('13.50', '12.02').toFixed().startsWith('12.31281198003327787021')).toBe(true);
    expect(detector.assess('13.50', baseline)).toEqual({
      variationPct: '12.3128',
      flagged: true,
      mark: { baselineRateId: 'r-12.02', variationPct: '12.3128' },
    });
  });

  it('[TC-FX-PROVIDER-010] 12.02 → 12.10 = +0.6656 %: variación normal, se usa sin confirmación', () => {
    expect(detector.assess('12.10', baseline)).toEqual({
      variationPct: '0.6656',
      flagged: false,
      mark: null,
    });
  });

  it('[TC-FX-PROVIDER-010] las caídas también cuentan (valor absoluto) y el umbral es estricto', () => {
    expect(detector.assess('11.00', baseline)?.flagged).toBe(true);
    expect(detector.assess('11.00', baseline)?.variationPct).toBe('-8.4859');
    // Exactamente +5 % no supera el umbral.
    expect(new AnomalyDetector('5').assess('105', { rateId: 'b', value: '100' })?.flagged).toBe(false);
    expect(new AnomalyDetector('5').assess('105.01', { rateId: 'b', value: '100' })?.flagged).toBe(true);
  });

  it('[TC-FX-PROVIDER-010] sin línea base (primera muestra) no hay anomalía; umbral ≤ 0 es inválido', () => {
    expect(detector.assess('13.50', null)).toBeNull();
    expect(() => new AnomalyDetector('0')).toThrow(RangeError);
  });
});
