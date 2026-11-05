import { DomainError } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { isoWeekOf, ReportPeriodCalendar } from './report-periods.js';

const fin25 = [
  { label: '2026-09', periodStart: '2026-09-25', periodEnd: '2026-10-24' },
  { label: '2026-10', periodStart: '2026-10-25', periodEnd: '2026-11-24' },
];
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof DomainError ? e.code : 'other';
  }
  return null;
};

describe('ReportPeriodCalendar', () => {
  it('[TC-REPORTING-REPORTS-003] un gasto del 2026-10-27 cae en el periodo financiero 25-oct a 24-nov y en octubre calendario', () => {
    const fin = ReportPeriodCalendar.of('FINANCIAL_PERIOD', fin25, 25, '2026-11-10');
    expect(fin.periodOf('2026-10-27')).toMatchObject({ from: '2026-10-25', to: '2026-11-24', partial: true });
    const cal = ReportPeriodCalendar.of('CALENDAR_MONTH', fin25, 25, '2026-11-10');
    expect(cal.periodOf('2026-10-27')).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
      partial: false,
    });
  });

  it('[TC-REPORTING-REPORTS-003] un rango de 25 periodos se rechaza con VALIDATION_FAILED y uno de 24 se acepta', () => {
    const cal = ReportPeriodCalendar.of('CALENDAR_MONTH', [], 1, '2026-10-15');
    expect(cal.periods('2024-11-01', '2026-10-31')).toHaveLength(24);
    expect(code(() => cal.periods('2024-10-01', '2026-10-31'))).toBe('VALIDATION_FAILED');
  });

  it('[TC-REPORTING-REPORTS-003] recorta los periodos al rango y marca como parcial el que contiene hoy', () => {
    const cal = ReportPeriodCalendar.of('CALENDAR_MONTH', [], 1, '2026-10-15');
    const [p] = cal.periods('2026-10-01', '2026-10-10');
    expect(p).toMatchObject({
      label: '2026-10',
      from: '2026-10-01',
      to: '2026-10-10',
      days: 10,
      partial: true,
    });
  });

  it('[TC-REPORTING-REPORTS-003] semanas ISO de lunes a domingo, con tope de 106', () => {
    expect(isoWeekOf('2026-10-14')).toEqual({
      label: '2026-W42',
      monday: '2026-10-12',
      sunday: '2026-10-18',
    });
    expect(isoWeekOf('2021-01-03').label).toBe('2020-W53');
    const cal = ReportPeriodCalendar.of('CALENDAR_MONTH', [], 1, '2026-10-15');
    const weeks = cal.weeks('2026-10-01', '2026-10-31');
    expect(weeks[0]).toMatchObject({ from: '2026-10-01', to: '2026-10-04' });
    expect(weeks.at(-1)).toMatchObject({ from: '2026-10-26', to: '2026-10-31' });
    expect(code(() => cal.weeks('2024-01-01', '2026-10-31'))).toBe('VALIDATION_FAILED');
  });

  it('[TC-REPORTING-REPORTS-010] periodo anterior y mismo periodo del año anterior (incluido el que empieza el día 25)', () => {
    const cal = ReportPeriodCalendar.of('FINANCIAL_PERIOD', fin25, 25, '2026-11-10');
    expect(cal.previous({ from: '2026-10-25' })).toMatchObject({ from: '2026-09-25', to: '2026-10-24' });
    expect(cal.yearAgo({ from: '2026-10-25' })).toMatchObject({ from: '2025-10-25', to: '2025-11-24' });
    expect(cal.priorPeriods({ from: '2026-10-25' }, 2).map((p) => p.from)).toEqual([
      '2026-09-25',
      '2026-08-25',
    ]);
  });
});
