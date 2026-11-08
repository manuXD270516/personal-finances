import { currency as makeCurrency, dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { CategoryVariation } from './category-variation.js';
import { ShortfallEpisodePolicy } from './shortfall-episode.js';

const BOB = makeCurrency('BOB', 2);
const variation = (current: string, previous: string | null, nature: 'EXPENSE' | 'INCOME' = 'EXPENSE') =>
  CategoryVariation.of({
    current: dec(current),
    previous: previous === null ? null : dec(previous),
    nature,
    reporting: BOB,
  });

describe('CategoryVariation: variación por categoría de los tops (Q7)', () => {
  it('[TC-REPORTING-FORECAST-029] Supermercado +105.00 BOB y +8.75 % es un aumento desfavorable', () => {
    const v = variation('1305', '1200')!;
    expect(v.amount.toFixed()).toBe('105.00');
    expect(v.percent).toBe('8.75');
    expect(v).toMatchObject({ isNew: false, direction: 'UNFAVORABLE' });
  });

  it('[TC-REPORTING-FORECAST-029] una categoría que no existía antes es nueva y no tiene porcentaje', () => {
    const v = variation('5', '0')!;
    expect(v.amount.toFixed()).toBe('5.00');
    expect(v).toMatchObject({ percent: null, isNew: true, direction: 'UNFAVORABLE' });
  });

  it('[TC-REPORTING-FORECAST-029] en un ingreso el aumento es favorable y la baja desfavorable', () => {
    expect(variation('1100', '1000', 'INCOME')?.direction).toBe('FAVORABLE');
    expect(variation('900', '1000', 'INCOME')?.direction).toBe('UNFAVORABLE');
    expect(variation('900', '1000', 'EXPENSE')?.direction).toBe('FAVORABLE');
  });

  it('[TC-REPORTING-FORECAST-029] sin cambio no hay sentido y sin monto anterior la variación no está disponible', () => {
    expect(variation('100', '100')).toMatchObject({ percent: '0.00', direction: 'NONE', isNew: false });
    expect(variation('100', null)).toBeNull();
  });
});

describe('ShortfallEpisodePolicy: episodio de riesgo (D381)', () => {
  it('[TC-REPORTING-FORECAST-018] abre solo con riesgo HIGH y sin episodio abierto', () => {
    expect(ShortfallEpisodePolicy.decide({ hasOpenEpisode: false, risk: 'HIGH' })).toBe('OPEN');
    expect(ShortfallEpisodePolicy.decide({ hasOpenEpisode: false, risk: 'LOW' })).toBe('NONE');
    expect(ShortfallEpisodePolicy.decide({ hasOpenEpisode: false, risk: 'NONE' })).toBe('NONE');
  });

  it('[TC-REPORTING-FORECAST-018] con el episodio abierto y el riesgo sostenido no publica nada', () => {
    expect(ShortfallEpisodePolicy.decide({ hasOpenEpisode: true, risk: 'HIGH' })).toBe('SUSTAIN');
  });

  it('[TC-REPORTING-FORECAST-019] cierra con NONE o LOW e ignora POSSIBLE', () => {
    expect(ShortfallEpisodePolicy.decide({ hasOpenEpisode: true, risk: 'NONE' })).toBe('CLOSE');
    expect(ShortfallEpisodePolicy.decide({ hasOpenEpisode: true, risk: 'LOW' })).toBe('CLOSE');
    expect(ShortfallEpisodePolicy.decide({ hasOpenEpisode: true, risk: 'POSSIBLE' })).toBe('NONE');
    expect(ShortfallEpisodePolicy.decide({ hasOpenEpisode: false, risk: 'POSSIBLE' })).toBe('NONE');
  });
});
