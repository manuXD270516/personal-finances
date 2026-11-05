import { LocalDate } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { SuggestionWindow, type PeriodRowRef } from './suggestion-window.js';

const row = (label: string, status = 'CLOSED'): PeriodRowRef => {
  const [y, m] = label.split('-').map(Number) as [number, number];
  const start = LocalDate.of(y, m, 1);
  const end = LocalDate.of(y, m, LocalDate.daysInMonth(y, m));
  return { id: `id-${label}`, label, periodStart: start.toString(), periodEnd: end.toString(), status };
};

const build = (over: Partial<Parameters<typeof SuggestionWindow.build>[0]> = {}) =>
  SuggestionWindow.build({
    targetLabel: '2026-11',
    targetStart: '2026-11-01',
    count: 4,
    today: LocalDate.parse('2026-11-04'),
    startDay: 1,
    firstActivity: '2025-01-10',
    rows: ['2026-07', '2026-08', '2026-09', '2026-10'].map((l) => row(l)),
    ...over,
  });

describe('SuggestionWindow (planning/budgets, add-historical-budgets)', () => {
  it('[TC-PLANNING-HISTBUDGET-001] toma los N periodos terminados anteriores al objetivo, del más antiguo al más reciente', () => {
    const w = build();
    expect(w.periods.map((p) => p.label)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(w.periods.every((p) => p.base === 'ELIGIBLE' && p.closed)).toBe(true);
    expect(w.sameLastYear.label).toBe('2025-11');
  });

  it('[TC-PLANNING-HISTBUDGET-003] planificar un periodo futuro deja el periodo en curso fuera, informado IN_PROGRESS', () => {
    const w = build({
      targetLabel: '2026-12',
      targetStart: '2026-12-01',
      count: 3,
      today: LocalDate.parse('2026-11-20'),
      rows: ['2026-08', '2026-09', '2026-10', '2026-11'].map((l, i) => row(l, i === 3 ? 'ACTIVE' : 'CLOSED')),
    });
    expect(w.periods.map((p) => [p.label, p.base])).toEqual([
      ['2026-08', 'ELIGIBLE'],
      ['2026-09', 'ELIGIBLE'],
      ['2026-10', 'ELIGIBLE'],
      ['2026-11', 'IN_PROGRESS'],
    ]);
  });

  it('[TC-PLANNING-HISTBUDGET-005] el periodo que contiene la primera actividad es INCOMPLETE y el anterior BEFORE_FIRST_ACTIVITY', () => {
    const w = build({ count: 4, firstActivity: '2026-08-20' });
    expect(w.periods.map((p) => p.base)).toEqual([
      'BEFORE_FIRST_ACTIVITY',
      'INCOMPLETE',
      'ELIGIBLE',
      'ELIGIBLE',
    ]);
  });

  it('[TC-PLANNING-HISTBUDGET-013] sin actividad todo es BEFORE_FIRST_ACTIVITY y un periodo sin fila sale del calendario', () => {
    const w = build({ firstActivity: null, rows: [] });
    expect(w.periods.every((p) => p.base === 'BEFORE_FIRST_ACTIVITY' && p.periodId === null)).toBe(true);
    expect(w.sameLastYear).toMatchObject({ label: '2025-11', start: '2025-11-01', end: '2025-11-30' });
    const feb = build({ firstActivity: '2026-02-01', rows: [] });
    expect(feb.sameLastYear.base).toBe('BEFORE_FIRST_ACTIVITY');
  });

  it('respeta el día de inicio del calendario cuando el periodo no existe como fila', () => {
    const w = build({ startDay: 5, rows: [], count: 1 });
    // 2026-10 con día de inicio 5 termina el 2026-11-04 (hoy): todavía no terminó antes de hoy
    expect(w.periods.map((p) => [p.label, p.base])).toEqual([
      ['2026-09', 'ELIGIBLE'],
      ['2026-10', 'IN_PROGRESS'],
    ]);
    expect(w.periods[1]).toMatchObject({ start: '2026-10-05', end: '2026-11-04' });
  });
});
