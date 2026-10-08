import { LocalDate } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { newPeriodLock, nextDay, YearMonth } from './period.js';
import { firstOpenDateOnOrAfter, isDateLocked } from './period-range.js';

const d = (s: string) => LocalDate.parse(s);
const lock = (ym: string, start: string | null, end: string, openStart = false) =>
  newPeriodLock({
    workspaceId: 'w',
    yearMonth: YearMonth.parse(ym),
    periodStart: start ? d(start) : null,
    periodEnd: d(end),
    openStart,
  });

describe('bloqueo por rango del periodo financiero (ADR-0028)', () => {
  it('[TC-LEDGER-PERIOD-003] día de inicio 25: 10-25 y 11-24 rechazados; 10-24 y 11-25 aceptados', () => {
    const locks = [lock('2026-10', '2026-10-25', '2026-11-24')];
    expect(isDateLocked(locks, d('2026-10-25'))).toBe(true);
    expect(isDateLocked(locks, d('2026-11-24'))).toBe(true);
    expect(isDateLocked(locks, d('2026-10-24'))).toBe(false);
    expect(isDateLocked(locks, d('2026-11-25'))).toBe(false);
  });

  it('[TC-LEDGER-PERIOD-003] el primer periodo cerrado queda abierto hacia atrás', () => {
    const locks = [lock('2026-07', null, '2026-07-31', true)];
    expect(locks[0]!.periodStart).toBeNull();
    expect(isDateLocked(locks, d('2026-06-15'))).toBe(true);
    expect(isDateLocked(locks, d('1999-01-01'))).toBe(true);
    expect(isDateLocked(locks, d('2026-07-31'))).toBe(true);
    expect(isDateLocked(locks, d('2026-08-01'))).toBe(false);
  });

  it('[TC-LEDGER-PERIOD-001] sin rango explícito el lock es el mes calendario de yearMonth', () => {
    const l = newPeriodLock({ workspaceId: 'w', yearMonth: YearMonth.parse('2026-02') });
    expect([l.periodStart?.toString(), l.periodEnd.toString()]).toEqual(['2026-02-01', '2026-02-28']);
    expect(isDateLocked([l], d('2026-02-28'))).toBe(true);
    expect(isDateLocked([l], d('2026-03-01'))).toBe(false);
    expect(
      newPeriodLock({ workspaceId: 'w', yearMonth: YearMonth.parse('2028-02') }).periodEnd.toString(),
    ).toBe('2028-02-29');
  });

  it('rechaza un rango invertido', () => {
    expect(() => lock('2026-10', '2026-11-01', '2026-10-31')).toThrow();
  });

  it('firstOpenDateOnOrAfter salta periodos contiguos (periodEnd + 1) y deja intacta una fecha abierta', () => {
    const locks = [
      lock('2026-11', '2026-11-25', '2026-12-24'),
      lock('2026-10', '2026-10-25', '2026-11-24'),
      lock('2026-09', null, '2026-10-24', true),
    ];
    expect(firstOpenDateOnOrAfter(locks, d('2026-08-01')).toString()).toBe('2026-12-25');
    expect(firstOpenDateOnOrAfter(locks, d('2026-11-30')).toString()).toBe('2026-12-25');
    expect(firstOpenDateOnOrAfter(locks, d('2026-12-25')).toString()).toBe('2026-12-25');
    expect(firstOpenDateOnOrAfter([], d('2026-01-01')).toString()).toBe('2026-01-01');
    expect(nextDay(d('2026-12-31')).toString()).toBe('2027-01-01');
  });

  const dateArb = fc
    .integer({ min: 0, max: 800 })
    .map((n) => LocalDate.parse(new Date(Date.UTC(2025, 0, 1) + n * 86_400_000).toISOString().slice(0, 10)));
  const rangeArb = fc
    .tuple(fc.integer({ min: 0, max: 800 }), fc.integer({ min: 0, max: 60 }), fc.boolean())
    .map(([s, len, open]) => {
      const iso = (n: number) => new Date(Date.UTC(2025, 0, 1) + n * 86_400_000).toISOString().slice(0, 10);
      return { periodStart: open ? null : d(iso(s)), periodEnd: d(iso(s + len)) };
    });

  it('[TC-LEDGER-PERIOD-003] (propiedad) isDateLocked ≡ pertenencia a algún rango; firstOpenDate nunca queda cerrada', () => {
    fc.assert(
      fc.property(fc.array(rangeArb, { maxLength: 6 }), dateArb, (ranges, date) => {
        const member = ranges.some(
          (r) =>
            (r.periodStart === null || r.periodStart.toString() <= date.toString()) &&
            date.toString() <= r.periodEnd.toString(),
        );
        expect(isDateLocked(ranges, date)).toBe(member);
        const open = firstOpenDateOnOrAfter(ranges, date);
        expect(isDateLocked(ranges, open)).toBe(false);
        expect(open.toString() >= date.toString()).toBe(true);
      }),
      { numRuns: 200, seed: 20261008 },
    );
  });
});
