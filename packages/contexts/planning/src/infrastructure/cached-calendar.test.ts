import { describe, expect, it } from 'vitest';
import { cachedCalendar } from './pg-budgets.js';

describe('cachedCalendar (worker de presupuestos)', () => {
  it('lee el calendario una vez por workspace dentro del TTL y vuelve a leerlo al vencer', async () => {
    let calls = 0;
    let clock = 1_000;
    const calendar = cachedCalendar(
      {
        calendarOf: async (workspaceId) => {
          calls += 1;
          return { timeZone: 'America/La_Paz', fiscalMonthStartDay: workspaceId === 'a' ? 1 : 25 };
        },
      },
      60_000,
      () => clock,
    );
    expect(await calendar.calendarOf('a')).toEqual({ timeZone: 'America/La_Paz', fiscalMonthStartDay: 1 });
    expect(await calendar.calendarOf('a')).toEqual({ timeZone: 'America/La_Paz', fiscalMonthStartDay: 1 });
    expect(await calendar.calendarOf('b')).toEqual({ timeZone: 'America/La_Paz', fiscalMonthStartDay: 25 });
    expect(calls).toBe(2);
    clock += 60_001;
    await calendar.calendarOf('a');
    expect(calls).toBe(3);
  });
});
