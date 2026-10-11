import { describe, expect, it } from 'vitest';
import { LocalDate } from './local-date.js';
import { FinancialPeriodCalendar } from './period-calendar.js';

describe('FinancialPeriodCalendar (openspec add-savings-goals N8)', () => {
  const d = (s: string) => LocalDate.parse(s);
  it('[TC-GOALS-SAVINGS-031] periodsBetween cuenta los periodos de hoy a la fecha objetivo, ambos incluidos', () => {
    const day1 = FinancialPeriodCalendar.periodsBetween(1, d('2026-10-10'), d('2027-03-31'));
    expect(day1.map((p) => p.label)).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
    ]);
    const day25 = FinancialPeriodCalendar.periodsBetween(25, d('2026-10-10'), d('2027-03-31'));
    expect(day25.map((p) => p.label)).toEqual([
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
      '2027-03',
    ]);
  });

  it('[TC-GOALS-SAVINGS-031] un solo periodo si ambas fechas caen en el mismo; vacío si el destino es anterior', () => {
    expect(FinancialPeriodCalendar.periodsBetween(1, d('2026-10-01'), d('2026-10-31'))).toHaveLength(1);
    expect(FinancialPeriodCalendar.periodsBetween(1, d('2026-10-10'), d('2026-09-30'))).toHaveLength(0);
  });

  it('[TC-GOALS-SAVINGS-033] periodsBefore devuelve los N periodos anteriores al actual, el más reciente primero', () => {
    const before = FinancialPeriodCalendar.periodsBefore(1, d('2026-10-10'), 3);
    expect(before.map((p) => p.label)).toEqual(['2026-09', '2026-08', '2026-07']);
    expect(before[0]?.range.end.toString()).toBe('2026-09-30');
    const day25 = FinancialPeriodCalendar.periodsBefore(25, d('2026-10-10'), 1);
    expect(day25[0]?.range.start.toString()).toBe('2026-08-25');
    expect(day25[0]?.range.end.toString()).toBe('2026-09-24');
  });
});
