import { describe, expect, it } from 'vitest';
import { addDays, addMonthsClamped, dayOfMonth, monthStart, withDay } from './calendar.js';

describe('calendario del dataset Demo v2 (fechas relativas a la ancla, design.md decisión 4)', () => {
  it('[TC-IDENTITY-DEMO-020] un paso de un mes conserva el día del mes y usa el último día si no existe', () => {
    expect(addMonthsClamped('2026-09-30', -1)).toBe('2026-08-30');
    expect(addMonthsClamped('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-03-31', -1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-10-10', -7)).toBe('2026-03-10');
    expect(addMonthsClamped('2026-12-15', 2)).toBe('2027-02-15');
  });

  it('[TC-IDENTITY-DEMO-020] helpers de día y de mes', () => {
    expect(monthStart('2026-09-30')).toBe('2026-09-01');
    expect(dayOfMonth(addDays('2026-09-30', -25))).toBe(5);
    expect(withDay('2026-02-10', 31)).toBe('2026-02-28');
    expect(withDay('2026-09-10', 1)).toBe('2026-09-01');
  });
});
