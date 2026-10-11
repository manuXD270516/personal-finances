import { Money, currency, dec, Instant, LocalDate } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculateRequiredContribution } from './required-contribution-calculator.js';

const BOB = currency('BOB', 2);
const d = (s: string) => LocalDate.parse(s);
const input = (over: Partial<Parameters<typeof calculateRequiredContribution>[0]> = {}) => ({
  remaining: dec('10000.00'),
  currency: BOB,
  today: d('2026-10-10'),
  targetDate: d('2027-03-31') as LocalDate | null,
  startDay: 1,
  ...over,
});

describe('RequiredContributionCalculator (FR-GOALS-003)', () => {
  it('[TC-GOALS-SAVINGS-031] 10000.00 BOB en 6 periodos (2026-10 a 2027-03) = 1666.67 BOB', () => {
    const r = calculateRequiredContribution(input());
    expect(r.monthly?.toFixed()).toBe('1666.67');
    expect(r.periods).toBe(6);
    expect(r.overdue).toBe(false);
  });

  it('[TC-GOALS-SAVINGS-032] con mes financiero que empieza el 25: 7 periodos (2026-09 a 2027-03) = 1428.57 BOB', () => {
    const r = calculateRequiredContribution(input({ startDay: 25 }));
    expect(r.periods).toBe(7);
    expect(r.monthly?.toFixed()).toBe('1428.57');
  });

  it('[TC-GOALS-SAVINGS-032] fecha objetivo vencida: todo el restante, marcado vencido', () => {
    const r = calculateRequiredContribution(
      input({ remaining: dec('1000.00'), targetDate: d('2026-09-30') }),
    );
    expect(r.monthly?.toFixed()).toBe('1000.00');
    expect(r.overdue).toBe(true);
    expect(r.periods).toBe(0);
  });

  it('[TC-GOALS-SAVINGS-032] sin fecha objetivo no informa requerido (null, no 0.00)', () => {
    const r = calculateRequiredContribution(input({ targetDate: null }));
    expect(r.monthly).toBeNull();
    expect(r.periods).toBeNull();
    expect(r.overdue).toBe(false);
  });

  it('[TC-GOALS-SAVINGS-032] restante 0 ⇒ 0.00 y nunca vencido', () => {
    const r = calculateRequiredContribution(input({ remaining: dec('0'), targetDate: d('2026-09-30') }));
    expect(r.monthly?.toFixed()).toBe('0.00');
    expect(r.overdue).toBe(false);
  });

  it('[TC-GOALS-SAVINGS-032] fecha objetivo en el mismo periodo: un solo periodo', () => {
    const r = calculateRequiredContribution(input({ targetDate: d('2026-10-31') }));
    expect(r.periods).toBe(1);
    expect(r.monthly?.toFixed()).toBe('10000.00');
  });

  it('[TC-GOALS-SAVINGS-032] 10000.00/9 = 1111.11 y 4000.00/6 = 666.67', () => {
    expect(calculateRequiredContribution(input({ targetDate: d('2027-06-30') })).monthly?.toFixed()).toBe(
      '1111.11',
    );
    expect(calculateRequiredContribution(input({ remaining: dec('4000.00') })).monthly?.toFixed()).toBe(
      '666.67',
    );
  });

  it('[TC-GOALS-SAVINGS-032] borde 24/25 de octubre en America/La_Paz (día de inicio 25), con TZ del proceso irrelevante', () => {
    // 2026-10-24T23:30-04:00 = 2026-10-25T03:30Z: en La Paz aún es 24 (periodo 2026-09); a las 00:05 del 25 empieza 2026-10.
    const before = LocalDate.ofInstant(Instant.parse('2026-10-25T03:30:00Z'), 'America/La_Paz');
    const after = LocalDate.ofInstant(Instant.parse('2026-10-25T04:05:00Z'), 'America/La_Paz');
    expect(before.toString()).toBe('2026-10-24');
    expect(after.toString()).toBe('2026-10-25');
    const target = d('2027-03-31');
    const a = calculateRequiredContribution(input({ today: before, targetDate: target, startDay: 25 }));
    const b = calculateRequiredContribution(input({ today: after, targetDate: target, startDay: 25 }));
    expect(a.periods).toBe(7);
    expect(b.periods).toBe(6);
  });

  it('[TC-GOALS-SAVINGS-032] 29-feb y fin de mes: la fecha objetivo del 29-feb-2028 cuenta su periodo', () => {
    const r = calculateRequiredContribution(
      input({ today: d('2028-01-31'), targetDate: d('2028-02-29'), remaining: dec('300.00') }),
    );
    expect(r.periods).toBe(2);
    expect(r.monthly?.toFixed()).toBe('150.00');
  });

  it('PBT: requerido × periodos reconstruye el restante dentro de medio centavo por periodo', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000_000 }),
        fc.integer({ min: 0, max: 400 }),
        fc.integer({ min: 1, max: 28 }),
        (cents, plusDays, startDay) => {
          const today = d('2026-10-10');
          const remaining = dec(String(cents)).div(100);
          const r = calculateRequiredContribution({
            remaining,
            currency: BOB,
            today,
            targetDate: today.plusDays(plusDays),
            startDay,
          });
          if (r.overdue || r.periods === null || r.monthly === null) return;
          const rebuilt = r.monthly.toDecimal().times(r.periods);
          expect(rebuilt.minus(remaining).abs().lte(dec('0.005').times(r.periods))).toBe(true);
          expect(Money.zero(BOB).compare(r.monthly)).toBeLessThanOrEqual(0);
        },
      ),
      { numRuns: 300 },
    );
  }, 30_000);
});
