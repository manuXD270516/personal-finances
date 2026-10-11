import { LocalDate, currency, dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  calculateExpectedDate,
  paceWindow,
  type ExpectedDateInput,
  type PeriodNet,
} from './expected-date-calculator.js';

const BOB = currency('BOB', 2);
const d = (s: string) => LocalDate.parse(s);
const nets = (rows: Record<string, string>): Map<string, PeriodNet> =>
  new Map(Object.entries(rows).map(([k, v]) => [k, { net: dec(v), complete: true }]));
const base = (over: Partial<ExpectedDateInput> = {}): ExpectedDateInput => ({
  remaining: dec('10000.00'),
  currency: BOB,
  today: d('2026-10-10'),
  startDay: 1,
  goalStartDate: d('2026-01-01'),
  pacePeriods: 3,
  periodNets: new Map(),
  planMonthly: null,
  achievedOn: null,
  ...over,
});

describe('ExpectedDateCalculator (FR-GOALS-003)', () => {
  it('[TC-GOALS-SAVINGS-033] ritmo de 1200.00 BOB (1200, 900 y 1500) ⇒ 9 periodos desde 2026-10 ⇒ 2027-06-30', () => {
    const r = calculateExpectedDate(
      base({ periodNets: nets({ '2026-07': '1200.00', '2026-08': '900.00', '2026-09': '1500.00' }) }),
    );
    expect(r.pace?.toFixed()).toBe('1200.00');
    expect(r.source).toBe('HISTORY');
    expect(r.periods).toBe(3);
    expect(r.date?.toString()).toBe('2027-06-30');
  });

  it('[TC-GOALS-SAVINGS-033] meta nueva (sin periodos terminados) con plan de 2000.00 BOB ⇒ 2027-02-28 (fuente PLAN)', () => {
    const r = calculateExpectedDate(base({ goalStartDate: d('2026-10-01'), planMonthly: dec('2000.00') }));
    expect(r.source).toBe('PLAN');
    expect(r.date?.toString()).toBe('2027-02-28');
  });

  it('[TC-GOALS-SAVINGS-033] sin historia ni plan, o con netos negativos: sin fecha (NO_PACE)', () => {
    const none = calculateExpectedDate(base({ goalStartDate: d('2026-10-01') }));
    expect(none).toMatchObject({ date: null, reason: 'NO_PACE', source: 'NONE', pace: null });
    const negative = calculateExpectedDate(
      base({ periodNets: nets({ '2026-07': '0', '2026-08': '-100.00', '2026-09': '-100.00' }) }),
    );
    expect(negative.date).toBeNull();
    expect(negative.reason).toBe('NO_PACE');
    expect(negative.pace?.toFixed()).toBe('-66.67');
    // ritmo cero
    expect(calculateExpectedDate(base({ periodNets: nets({}) })).reason).toBe('NO_PACE');
  });

  it('[TC-GOALS-SAVINGS-033] con menos de N periodos terminados usa los que hay (desde el periodo del inicio)', () => {
    const r = calculateExpectedDate(
      base({
        goalStartDate: d('2026-08-15'),
        periodNets: nets({ '2026-08': '600.00', '2026-09': '1000.00' }),
      }),
    );
    expect(r.periods).toBe(2);
    expect(r.pace?.toFixed()).toBe('800.00');
  });

  it('[TC-GOALS-SAVINGS-033] un periodo sin movimientos cuenta 0 dentro del promedio', () => {
    const r = calculateExpectedDate(base({ periodNets: nets({ '2026-09': '900.00' }) }));
    expect(r.pace?.toFixed()).toBe('300.00');
  });

  it('[TC-GOALS-SAVINGS-035] la simulación usa el aporte simulado como ritmo: 2000.00 ⇒ 2027-02-28', () => {
    const r = calculateExpectedDate(base({ simulatedPace: dec('2000.00') }));
    expect(r.source).toBe('SIMULATED');
    expect(r.date?.toString()).toBe('2027-02-28');
  });

  it('[TC-GOALS-SAVINGS-035] objetivo 12000 con 8000 acumulados y ritmo 1200 ⇒ restante 4000 ⇒ 2027-01-31', () => {
    const r = calculateExpectedDate(
      base({
        remaining: dec('4000.00'),
        periodNets: nets({ '2026-07': '1200.00', '2026-08': '1200.00', '2026-09': '1200.00' }),
      }),
    );
    expect(r.date?.toString()).toBe('2027-01-31');
  });

  it('restante 0 ⇒ la fecha en que se alcanzó', () => {
    const r = calculateExpectedDate(base({ remaining: dec('0'), achievedOn: d('2026-10-05') }));
    expect(r.date?.toString()).toBe('2026-10-05');
    expect(r.reason).toBeNull();
  });

  it('con mes financiero que empieza el día 25 los periodos y la fecha esperada respetan el día de inicio', () => {
    const r = calculateExpectedDate(
      base({ startDay: 25, remaining: dec('2000.00'), simulatedPace: dec('2000.00') }),
    );
    // hoy 2026-10-10 está en el periodo 2026-09 (25-sep a 24-oct)
    expect(r.date?.toString()).toBe('2026-10-24');
    expect(
      paceWindow({
        startDay: 25,
        today: d('2026-10-10'),
        goalStartDate: d('2026-01-01'),
        pacePeriods: 2,
      }).map((p) => p.label),
    ).toEqual(['2026-07', '2026-08']);
  });

  it('marca el ritmo incompleto si un periodo quedó sin tasa y descarta pasados de 100 años', () => {
    const r = calculateExpectedDate(
      base({
        periodNets: new Map([['2026-09', { net: dec('100.00'), complete: false }]]),
      }),
    );
    expect(r.complete).toBe(false);
    const far = calculateExpectedDate(base({ remaining: dec('99999999.00'), simulatedPace: dec('0.01') }));
    expect(far.date).toBeNull();
    expect(far.reason).toBe('BEYOND_HORIZON');
  });
});
