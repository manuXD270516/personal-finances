import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS } from './budget-types.js';
import { ThresholdEvaluator } from './threshold-evaluator.js';
import { normalizeThresholds } from './thresholds.js';

const DEFAULTS = [...DEFAULT_THRESHOLDS];
const evalAt = (actual: string, crossed: string[] = [], reference = '600.00', thresholds = DEFAULTS) =>
  ThresholdEvaluator.evaluate({ thresholds, alreadyCrossed: crossed, actual, reference });

describe('normalizeThresholds', () => {
  it('[TC-PLANNING-THRESHOLD-002] acepta 80 y 110 (ordenados, canónicos) y rechaza 0, 1001, repetidos, más de 10 y más de 2 decimales', () => {
    expect(normalizeThresholds(['110', '80'])).toEqual(['80', '110']);
    expect(normalizeThresholds(['75.50', '90.00'])).toEqual(['75.5', '90']);
    for (const bad of [['0'], ['1001'], ['80', '80'], ['75.555'], ['-5'], ['abc'], []]) {
      expect(() => normalizeThresholds(bad), JSON.stringify(bad)).toThrowError(
        expect.objectContaining({ code: 'BUDGET_THRESHOLD_INVALID' }),
      );
    }
    const eleven = Array.from({ length: 11 }, (_, i) => String(i + 1));
    expect(() => normalizeThresholds(eleven)).toThrowError(
      expect.objectContaining({ code: 'BUDGET_THRESHOLD_INVALID' }),
    );
    expect(normalizeThresholds(['1000'])).toEqual(['1000']);
  });

  it('[TC-PLANNING-THRESHOLD-001] los umbrales por defecto son 50, 75, 90 y 100', () => {
    expect(DEFAULTS).toEqual(['50', '75', '90', '100']);
  });
});

describe('ThresholdEvaluator', () => {
  it('[TC-PLANNING-THRESHOLD-003] 310.00 de 600.00 cruza el 50 %', () => {
    expect(evalAt('310.00')).toEqual({ highest: '50', alsoCrossed: [], newlyCrossed: ['50'] });
    expect(evalAt('280.00')).toBeNull();
  });

  it('[TC-PLANNING-THRESHOLD-004] bajar y volver a subir no re-emite el 50 % ya registrado', () => {
    expect(evalAt('270.00', ['50'])).toBeNull();
    expect(evalAt('330.00', ['50'])).toBeNull();
  });

  it('[TC-PLANNING-THRESHOLD-006] de 280.00 a 550.00 emite el 90 % con alsoCrossed 50 y 75; luego a 600.00 solo el 100 %', () => {
    expect(evalAt('550.00')).toEqual({
      highest: '90',
      alsoCrossed: ['50', '75'],
      newlyCrossed: ['50', '75', '90'],
    });
    expect(evalAt('600.00', ['50', '75', '90'])).toEqual({
      highest: '100',
      alsoCrossed: [],
      newlyCrossed: ['100'],
    });
  });

  it('[TC-PLANNING-THRESHOLD-007] bajar el máximo a 500.00 con 470.00 cruza el 90 % (94.0 %) sin re-emitir 50 ni 75', () => {
    expect(evalAt('470.00', ['50', '75'], '500.00')).toEqual({
      highest: '90',
      alsoCrossed: [],
      newlyCrossed: ['90'],
    });
  });

  it('con referencia 0.00 no se evalúa ningún umbral', () => {
    expect(evalAt('40.00', [], '0.00')).toBeNull();
  });

  it('un umbral personalizado de 110 % solo cruza al exceder el planificado', () => {
    const custom = ['80', '110'];
    expect(evalAt('600.00', [], '600.00', custom)?.highest).toBe('80');
    expect(evalAt('660.00', ['80'], '600.00', custom)?.highest).toBe('110');
  });

  it('PBT [TC-PLANNING-THRESHOLD-004]: para toda secuencia de gastados cada umbral se emite a lo sumo una vez', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 900 }), { minLength: 1, maxLength: 30 }), (actuals) => {
        const crossed = new Set<string>();
        const emitted: string[] = [];
        for (const a of actuals) {
          const r = ThresholdEvaluator.evaluate({
            thresholds: DEFAULTS,
            alreadyCrossed: crossed,
            actual: `${a}.00`,
            reference: '600.00',
          });
          if (!r) continue;
          emitted.push(r.highest);
          for (const t of r.newlyCrossed) {
            expect(crossed.has(t)).toBe(false);
            crossed.add(t);
          }
        }
        expect(new Set(emitted).size).toBe(emitted.length);
        // Todo umbral alcanzado por el máximo gastado quedó registrado.
        const peak = Math.max(...actuals);
        for (const t of DEFAULTS) {
          if (peak * 100 >= 600 * Number(t)) expect(crossed.has(t)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
});
