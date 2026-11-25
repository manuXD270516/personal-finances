import { expandRecurrence, LocalDate, ruleFromCadence } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { addDays, dayOfMonth, epochDay, fromEpochDay, monthEnd } from '../calendar.js';
import { buildGoals, monthlyPlanDates } from './goals.js';

/**
 * Reproduce la regla del dominio de metas: la definición administrada se crea con `monthDays: [día]` y arranque en
 * `nextMonthlyDate(inicio, día)`; cada mes se resuelve desde el día del plan con tope al último día del mes.
 */
function domainOccurrences(start: string, day: number, until: string): string[] {
  const first = LocalDate.parse(start);
  const clamp = (y: number, m: number) => LocalDate.of(y, m, Math.min(day, LocalDate.daysInMonth(y, m)));
  const thisMonth = clamp(first.year, first.month);
  const dtstart =
    thisMonth.compare(first) >= 0
      ? thisMonth
      : first.month === 12
        ? clamp(first.year + 1, 1)
        : clamp(first.year, first.month + 1);
  const rule = ruleFromCadence({ cadence: 'MONTHLY', monthDays: [day], dtstart });
  return expandRecurrence(rule, { from: dtstart, to: LocalDate.parse(until) }).map((d) => d.toString());
}

describe('aportes del Fondo de emergencia contra la regla de la meta (TC-IDENTITY-DEMO-026)', () => {
  it('[TC-IDENTITY-DEMO-026] con la ancla 2026-11-25 (día del plan 31) los aportes caen el último día de cada mes: 2025-12-31 y no 2025-12-30', () => {
    const goals = buildGoals('2026-11-25');
    expect(goals.emergencyContributions).toContain('2025-12-31');
    expect(goals.emergencyContributions).not.toContain('2025-12-30');
    expect(goals.emergencyContributions.slice(0, 3)).toEqual(['2025-11-30', '2025-12-31', '2026-01-31']);
  });

  it('[TC-IDENTITY-DEMO-026] barrido de 3 años de anclas: los aportes y las ocurrencias del plan coinciden con las del dominio', () => {
    const from = epochDay('2025-01-01');
    for (let day = from; day < from + 3 * 366; day += 1) {
      const anchor = fromEpochDay(day);
      const goals = buildGoals(anchor);
      const planOp = goals.ops.find((o) => o.op === 'goalPlan' && o.goal === 'emergency');
      const planDay = planOp?.op === 'goalPlan' ? (planOp.dayOfMonth as number) : -1;
      expect(planDay, anchor).toBe(dayOfMonth(addDays(anchor, -25)));
      const expected = domainOccurrences(goals.dates.emergencyStart, planDay, anchor);
      expect(goals.emergencyContributions, anchor).toEqual(expected);
      const occurrences = goals.ops
        .filter((o) => o.op === 'occurrence' && o.target.type === 'goalPlan')
        .map((o) => (o.op === 'occurrence' ? o.occurrenceDate : ''));
      expect(occurrences, anchor).toEqual(expected);
    }
  }, 120_000);
  it('[TC-IDENTITY-DEMO-026] monthlyPlanDates no encadena desde el mes corto: el día 31 vuelve al último día de cada mes', () => {
    expect(monthlyPlanDates('2025-11-30', 31, '2026-03-31')).toEqual([
      '2025-11-30',
      '2025-12-31',
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    expect(monthEnd(2026, 2)).toBe('2026-02-28');
  });
});
