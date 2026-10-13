import { describe, expect, it } from 'vitest';
import { CostPeriodCalendar, MAX_COST_PERIODS } from './cost-periods.js';

describe('CostPeriodCalendar (D246, RISK-020)', () => {
  it('[TC-FX-COST-004] con el mes financiero desde el día 25, 2026-10-27 es del periodo 2026-10-25 a 2026-11-24 o de octubre según la agrupación', () => {
    const financial = CostPeriodCalendar.of('FINANCIAL_PERIOD', [], 25);
    expect(financial.periodOf('2026-10-27')).toEqual({
      label: '2026-10',
      from: '2026-10-25',
      to: '2026-11-24',
    });
    expect(financial.periodOf('2026-10-24')).toEqual({
      label: '2026-09',
      from: '2026-09-25',
      to: '2026-10-24',
    });
    const calendar = CostPeriodCalendar.of('CALENDAR_MONTH', [], 25);
    expect(calendar.periodOf('2026-10-27')).toEqual({
      label: '2026-10',
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(calendar.periodOf('2026-02-28')).toEqual({
      label: '2026-02',
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });

  it('[TC-FX-COST-004] un periodo existente (p. ej. de transición) gana sobre la regla del día de inicio', () => {
    const transition = { label: '2026-10', periodStart: '2026-10-10', periodEnd: '2026-11-24' };
    const calendar = CostPeriodCalendar.of('FINANCIAL_PERIOD', [transition], 25);
    expect(calendar.periodOf('2026-10-12')).toEqual({
      label: '2026-10',
      from: '2026-10-10',
      to: '2026-11-24',
    });
    // Fuera de los existentes se aplica la regla del día de inicio.
    expect(calendar.periodOf('2026-12-30')).toEqual({
      label: '2026-12',
      from: '2026-12-25',
      to: '2027-01-24',
    });
  });

  it('sin día de inicio conocido usa el de los periodos existentes más recientes, o 1 sin periodos', () => {
    const known = [{ label: '2026-09', periodStart: '2026-09-15', periodEnd: '2026-10-14' }];
    expect(CostPeriodCalendar.of('FINANCIAL_PERIOD', known, null).periodOf('2026-11-20').from).toBe(
      '2026-11-15',
    );
    expect(CostPeriodCalendar.of('FINANCIAL_PERIOD', [], null).periodOf('2026-11-20').from).toBe(
      '2026-11-01',
    );
  });

  it('periodsBetween cuenta los periodos distintos del rango y se detiene pasado el máximo', () => {
    const calendar = CostPeriodCalendar.of('CALENDAR_MONTH', [], 1);
    expect(calendar.periodsBetween('2026-01-15', '2026-03-02').map((p) => p.label)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
    expect(calendar.periodsBetween('2020-01-01', '2026-12-31').length).toBeGreaterThan(MAX_COST_PERIODS);
  });
});
