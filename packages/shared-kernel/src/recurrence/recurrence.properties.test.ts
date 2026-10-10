import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { LocalDate } from '../time/local-date.js';
import { CADENCES, expand, ruleFromCadence, type RecurrenceRule } from './recurrence-rule.js';
import { RRuleSubset } from './rrule-subset.js';
import { WeekendAdjustment } from './weekend-adjustment.js';

// 100 corridas por defecto (PR); NIGHTLY=1 ⇒ 10 000 (TC-COMMITMENTS-RECUR-014 y -045).
vi.setConfig({ testTimeout: 300_000 });
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const RUNS = env?.NIGHTLY ? 10_000 : 100;

const START = LocalDate.of(2024, 1, 1).toEpochDay();
const dateArb = fc.integer({ min: START, max: START + 365 * 6 }).map((n) => LocalDate.ofEpochDay(n));
const windowArb = fc
  .tuple(fc.integer({ min: START - 400, max: START + 365 * 7 }), fc.integer({ min: 0, max: 800 }))
  .map(([from, len]) => ({ from: LocalDate.ofEpochDay(from), to: LocalDate.ofEpochDay(from + len) }));

const monthDayArb = fc.oneof(fc.integer({ min: 1, max: 31 }), fc.constant(-1));
const cadenceRuleArb: fc.Arbitrary<RecurrenceRule> = fc
  .tuple(
    fc.constantFrom(...CADENCES),
    fc.integer({ min: 1, max: 12 }),
    dateArb,
    fc.uniqueArray(monthDayArb, { minLength: 2, maxLength: 2 }),
    fc.option(fc.integer({ min: 1, max: 40 }), { nil: null }),
  )
  .map(([cadence, interval, dtstart, two, count]) =>
    ruleFromCadence({
      cadence,
      interval,
      dtstart,
      ...(cadence === 'SEMIMONTHLY' ? { monthDays: two } : {}),
      count,
    }),
  );

const CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const rruleArb: fc.Arbitrary<RecurrenceRule> = fc
  .tuple(
    dateArb,
    fc.integer({ min: 1, max: 4 }),
    fc.uniqueArray(fc.integer({ min: 1, max: 7 }), { minLength: 1, maxLength: 3 }),
    fc.constantFrom(1, 2, -1),
    fc.constantFrom('weekly', 'setpos', 'monthday', 'ordinal'),
  )
  .map(([dtstart, interval, weekdays, pos, shape]) => {
    const days = weekdays.map((w) => CODES[w - 1]).join(',');
    let text: string;
    if (shape === 'weekly') text = `FREQ=WEEKLY;INTERVAL=${interval};BYDAY=${days}`;
    else if (shape === 'setpos') text = `FREQ=MONTHLY;INTERVAL=${interval};BYDAY=${days};BYSETPOS=${pos}`;
    else if (shape === 'monthday')
      text = `FREQ=MONTHLY;INTERVAL=${interval};BYMONTHDAY=${pos === 2 ? 31 : pos}`;
    else text = `FREQ=MONTHLY;INTERVAL=${interval};BYDAY=${pos}${CODES[(weekdays[0] as number) - 1]}`;
    return RRuleSubset.parse(text, dtstart);
  });
const ruleArb = fc.oneof(cadenceRuleArb, rruleArb);

const iso = (list: readonly LocalDate[]) => list.map((d) => d.toString());

describe('expansión de recurrencias: propiedades (RISK-020)', () => {
  it('[TC-COMMITMENTS-RECUR-045] fechas estrictamente crecientes y dentro de la ventana', () => {
    fc.assert(
      fc.property(ruleArb, windowArb, (rule, window) => {
        const out = expand(rule, window);
        for (let i = 0; i < out.length; i += 1) {
          const date = out[i] as LocalDate;
          expect(date.compare(window.from) >= 0 && date.compare(window.to) <= 0).toBe(true);
          expect(date.compare(rule.dtstart) >= 0).toBe(true);
          if (i > 0) expect(date.compare(out[i - 1] as LocalDate)).toBe(1);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('[TC-COMMITMENTS-RECUR-014] expand(w1) ∪ expand(w2) = expand(w1 ∪ w2) y expand(w) dos veces = una vez', () => {
    fc.assert(
      fc.property(ruleArb, windowArb, windowArb, (rule, w1, w2) => {
        expect(iso(expand(rule, w1))).toEqual(iso(expand(rule, w1)));
        const from = w1.from.compare(w2.from) <= 0 ? w1.from : w2.from;
        const to = w1.to.compare(w2.to) >= 0 ? w1.to : w2.to;
        const overlapping =
          w1.from.compare(w2.to.plusDays(1)) <= 0 && w2.from.compare(w1.to.plusDays(1)) <= 0;
        const union = new Set([...iso(expand(rule, w1)), ...iso(expand(rule, w2))]);
        const whole = iso(expand(rule, { from, to }));
        if (overlapping) expect([...union].sort()).toEqual(whole);
        else for (const x of union) expect(whole).toContain(x);
      }),
      { numRuns: RUNS },
    );
  });

  it('el conteo de una serie con COUNT nunca excede COUNT y es independiente de la ventana', () => {
    fc.assert(
      fc.property(cadenceRuleArb, windowArb, (rule, window) => {
        const bounded = expand(rule, window);
        const all = expand(rule, { from: rule.dtstart, to: LocalDate.of(2060, 12, 31) });
        if (rule.count !== null) {
          expect(bounded.length).toBeLessThanOrEqual(rule.count);
          expect(all.length).toBeLessThanOrEqual(rule.count);
        }
        const inWindow = all.filter((d) => d.compare(window.from) >= 0 && d.compare(window.to) <= 0);
        expect(iso(bounded)).toEqual(iso(inWindow));
      }),
      { numRuns: RUNS },
    );
  });

  it('ninguna fecha nominal cae fuera del mes de su ancla (clamp de 29–31)', () => {
    fc.assert(
      fc.property(
        dateArb,
        fc.integer({ min: 1, max: 12 }),
        fc.constantFrom('MONTHLY', 'BIMONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'ANNUAL') as fc.Arbitrary<
          'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL'
        >,
        (dtstart, interval, cadence) => {
          const rule = ruleFromCadence({ cadence, interval, dtstart });
          const out = expand(rule, { from: dtstart, to: LocalDate.of(2035, 12, 31) });
          const step = rule.interval * (rule.freq === 'YEARLY' ? 12 : 1);
          out.forEach((date, k) => {
            const m = dtstart.year * 12 + dtstart.month - 1 + k * step;
            expect([date.year, date.month]).toEqual([Math.floor(m / 12), (m % 12) + 1]);
            expect(date.day).toBe(Math.min(dtstart.day, date.lengthOfMonth()));
          });
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('[TC-COMMITMENTS-RECUR-045] con PREVIOUS/NEXT el vencimiento nunca cae en fin de semana y dista ≤ 2 días', () => {
    fc.assert(
      fc.property(
        dateArb,
        fc.constantFrom('PREVIOUS', 'NEXT') as fc.Arbitrary<'PREVIOUS' | 'NEXT'>,
        (date, mode) => {
          const due = WeekendAdjustment.apply(date, mode);
          expect(due.dayOfWeek()).toBeLessThanOrEqual(5);
          expect(Math.abs(due.toEpochDay() - date.toEpochDay())).toBeLessThanOrEqual(2);
          expect(WeekendAdjustment.apply(due, mode).equals(due)).toBe(true);
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('format/parse de RRULE es un ida y vuelta estable', () => {
    fc.assert(
      fc.property(rruleArb, (rule) => {
        const text = RRuleSubset.format(rule);
        const again = RRuleSubset.parse(text, rule.dtstart);
        expect(RRuleSubset.format(again)).toBe(text);
        const window = { from: rule.dtstart, to: LocalDate.of(2032, 1, 1) };
        expect(iso(expand(again, window))).toEqual(iso(expand(rule, window)));
      }),
      { numRuns: RUNS },
    );
  });
});
