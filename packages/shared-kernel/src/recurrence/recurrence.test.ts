import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { LocalDate } from '../time/local-date.js';
import { createRule, expand, nextDates, ruleFromCadence, type Cadence } from './recurrence-rule.js';
import { RRuleSubset } from './rrule-subset.js';
import { WeekendAdjustment } from './weekend-adjustment.js';

const d = (s: string) => LocalDate.parse(s);
const win = (from: string, to: string) => ({ from: d(from), to: d(to) });
const dates = (list: readonly LocalDate[]) => list.map((x) => x.toString());
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof DomainError ? err.code : `no-domain:${String(err)}`;
  }
  return undefined;
};

describe('LocalDate: aritmética pura del calendario', () => {
  it('epoch day, día de la semana y suma de días son consistentes (bisiestos y fin de año)', () => {
    expect(d('1970-01-01').toEpochDay()).toBe(0);
    expect(d('1970-01-01').dayOfWeek()).toBe(4);
    expect(d('2026-10-10').dayOfWeek()).toBe(6); // sábado
    expect(d('2026-10-25').dayOfWeek()).toBe(7); // domingo
    expect(d('2028-02-28').plusDays(1).toString()).toBe('2028-02-29');
    expect(d('2027-02-28').plusDays(1).toString()).toBe('2027-03-01');
    expect(d('2026-12-31').plusDays(1).toString()).toBe('2027-01-01');
    expect(d('2026-03-01').plusDays(-1).toString()).toBe('2026-02-28');
    for (const day of [-600_000, -1, 0, 1, 11_000, 20_000, 2_000_000]) {
      expect(LocalDate.ofEpochDay(day).toEpochDay()).toBe(day);
    }
    expect(d('2028-02-10').lengthOfMonth()).toBe(29);
    expect(LocalDate.daysInMonth(2027, 4)).toBe(30);
  });
});

describe('Cadencias predefinidas con intervalo (FR-COMMITMENTS-002)', () => {
  it('[TC-COMMITMENTS-RECUR-005] la cadencia trimestral con intervalo 2 produce una fecha cada seis meses', () => {
    const rule = ruleFromCadence({ cadence: 'QUARTERLY', interval: 2, dtstart: d('2026-01-10') });
    expect(dates(expand(rule, win('2026-01-01', '2027-03-31')))).toEqual([
      '2026-01-10',
      '2026-07-10',
      '2027-01-10',
    ]);
  });

  it('[TC-COMMITMENTS-RECUR-005] tabla de las 9 cadencias con intervalo 1 y 3', () => {
    const start = d('2026-01-15');
    const to = '2027-12-31';
    const table: Record<Cadence, { one: string[]; three: string[]; monthDays?: number[] }> = {
      DAILY: {
        one: ['2026-01-15', '2026-01-16', '2026-01-17'],
        three: ['2026-01-15', '2026-01-18', '2026-01-21'],
      },
      WEEKLY: {
        one: ['2026-01-15', '2026-01-22', '2026-01-29'],
        three: ['2026-01-15', '2026-02-05', '2026-02-26'],
      },
      BIWEEKLY: {
        one: ['2026-01-15', '2026-01-29', '2026-02-12'],
        three: ['2026-01-15', '2026-02-26', '2026-04-09'],
      },
      SEMIMONTHLY: {
        monthDays: [15, -1],
        one: ['2026-01-15', '2026-01-31', '2026-02-15'],
        three: ['2026-01-15', '2026-01-31', '2026-04-15'],
      },
      MONTHLY: {
        one: ['2026-01-15', '2026-02-15', '2026-03-15'],
        three: ['2026-01-15', '2026-04-15', '2026-07-15'],
      },
      BIMONTHLY: {
        one: ['2026-01-15', '2026-03-15', '2026-05-15'],
        three: ['2026-01-15', '2026-07-15', '2027-01-15'],
      },
      QUARTERLY: {
        one: ['2026-01-15', '2026-04-15', '2026-07-15'],
        three: ['2026-01-15', '2026-10-15', '2027-07-15'],
      },
      SEMIANNUAL: { one: ['2026-01-15', '2026-07-15', '2027-01-15'], three: ['2026-01-15', '2027-07-15'] },
      ANNUAL: { one: ['2026-01-15', '2027-01-15'], three: ['2026-01-15'] },
    };
    for (const [cadence, expected] of Object.entries(table) as [Cadence, (typeof table)[Cadence]][]) {
      const base = {
        cadence,
        dtstart: start,
        ...(expected.monthDays ? { monthDays: expected.monthDays } : {}),
      };
      const one = dates(expand(ruleFromCadence({ ...base, interval: 1 }), win('2026-01-01', to)));
      const three = dates(expand(ruleFromCadence({ ...base, interval: 3 }), win('2026-01-01', to)));
      expect(one.slice(0, expected.one.length), `${cadence} x1`).toEqual(expected.one);
      expect(three.slice(0, expected.three.length), `${cadence} x3`).toEqual(expected.three);
    }
  });

  it('[TC-COMMITMENTS-RECUR-006] la semimensual exige dos días y produce el 15 y el último de cada mes', () => {
    const rule = ruleFromCadence({ cadence: 'SEMIMONTHLY', monthDays: [15, -1], dtstart: d('2026-10-01') });
    expect(dates(expand(rule, win('2026-10-01', '2026-11-30')))).toEqual([
      '2026-10-15',
      '2026-10-31',
      '2026-11-15',
      '2026-11-30',
    ]);
    expect(
      codeOf(() => ruleFromCadence({ cadence: 'SEMIMONTHLY', monthDays: [15], dtstart: d('2026-10-01') })),
    ).toBe('RECURRING_INVALID_SCHEDULE');
    expect(
      codeOf(() =>
        ruleFromCadence({ cadence: 'SEMIMONTHLY', monthDays: [15, 15], dtstart: d('2026-10-01') }),
      ),
    ).toBe('RECURRING_INVALID_SCHEDULE');
  });

  it('la semimensual con días 30 y 31 colapsa a un solo día en febrero (sin duplicados)', () => {
    const rule = ruleFromCadence({ cadence: 'SEMIMONTHLY', monthDays: [30, 31], dtstart: d('2027-01-30') });
    expect(dates(expand(rule, win('2027-01-01', '2027-03-31')))).toEqual([
      '2027-01-30',
      '2027-01-31',
      '2027-02-28',
      '2027-03-30',
      '2027-03-31',
    ]);
  });

  it('[TC-COMMITMENTS-RECUR-045] caso fijo quincenal desde el viernes 2026-10-02', () => {
    const rule = ruleFromCadence({ cadence: 'BIWEEKLY', dtstart: d('2026-10-02') });
    expect(dates(expand(rule, win('2026-10-01', '2026-11-30')))).toEqual([
      '2026-10-02',
      '2026-10-16',
      '2026-10-30',
      '2026-11-13',
      '2026-11-27',
    ]);
  });

  it('rechaza intervalos, días y combinaciones inválidos con RECURRING_INVALID_SCHEDULE', () => {
    const base = { dtstart: d('2026-10-01') };
    expect(codeOf(() => ruleFromCadence({ cadence: 'MONTHLY', interval: 0, ...base }))).toBe(
      'RECURRING_INVALID_SCHEDULE',
    );
    expect(codeOf(() => ruleFromCadence({ cadence: 'MONTHLY', interval: 1.5, ...base }))).toBe(
      'RECURRING_INVALID_SCHEDULE',
    );
    expect(codeOf(() => ruleFromCadence({ cadence: 'MONTHLY', monthDays: [32], ...base }))).toBe(
      'RECURRING_INVALID_SCHEDULE',
    );
    expect(codeOf(() => ruleFromCadence({ cadence: 'MONTHLY', monthDays: [5, 6], ...base }))).toBe(
      'RECURRING_INVALID_SCHEDULE',
    );
    expect(codeOf(() => ruleFromCadence({ cadence: 'WEEKLY', monthDays: [5], ...base }))).toBe(
      'RECURRING_INVALID_SCHEDULE',
    );
    expect(
      codeOf(() => ruleFromCadence({ cadence: 'MONTHLY', count: 3, until: d('2027-01-01'), ...base })),
    ).toBe('RECURRING_INVALID_SCHEDULE');
    expect(codeOf(() => ruleFromCadence({ cadence: 'MONTHLY', until: d('2026-09-01'), ...base }))).toBe(
      'RECURRING_INVALID_SCHEDULE',
    );
    expect(codeOf(() => ruleFromCadence({ cadence: 'MONTHLY', count: 0, ...base }))).toBe(
      'RECURRING_INVALID_SCHEDULE',
    );
  });
});

describe('Fin de mes y bisiestos (FR-COMMITMENTS-005, RISK-020)', () => {
  it('[TC-COMMITMENTS-RECUR-012] el día 31 y el 29 de febrero producen el último día del mes en meses cortos', () => {
    const monthly = ruleFromCadence({ cadence: 'MONTHLY', dtstart: d('2027-01-31') });
    expect(dates(expand(monthly, win('2027-01-01', '2027-04-30')))).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
    const annual = ruleFromCadence({ cadence: 'ANNUAL', dtstart: d('2028-02-29') });
    expect(dates(expand(annual, win('2028-01-01', '2030-03-01')))).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
    ]);
  });

  it('el día 31 vuelve a 31 en los meses largos (no deriva a 28)', () => {
    const monthly = ruleFromCadence({ cadence: 'MONTHLY', dtstart: d('2027-01-31') });
    expect(dates(expand(monthly, win('2027-05-01', '2027-08-31')))).toEqual([
      '2027-05-31',
      '2027-06-30',
      '2027-07-31',
      '2027-08-31',
    ]);
  });

  it('el bisiesto 2028 conserva el 29 de febrero y el cambio de día por revisión usa monthDays', () => {
    const monthly = ruleFromCadence({ cadence: 'MONTHLY', monthDays: [29], dtstart: d('2028-01-15') });
    expect(dates(expand(monthly, win('2028-01-01', '2028-03-31')))).toEqual([
      '2028-01-29',
      '2028-02-29',
      '2028-03-29',
    ]);
  });
});

describe('Ajuste de fin de semana (FR-COMMITMENTS-005)', () => {
  it('[TC-COMMITMENTS-RECUR-013] mueve solo el vencimiento: sábado al viernes anterior y domingo al lunes siguiente', () => {
    const sat = d('2026-10-10');
    const sun = d('2026-10-25');
    expect(WeekendAdjustment.apply(sat, 'PREVIOUS').toString()).toBe('2026-10-09');
    expect(WeekendAdjustment.apply(sun, 'NEXT').toString()).toBe('2026-10-26');
    expect(WeekendAdjustment.apply(sat, 'NEXT').toString()).toBe('2026-10-12');
    expect(WeekendAdjustment.apply(sun, 'PREVIOUS').toString()).toBe('2026-10-23');
    expect(WeekendAdjustment.apply(sat, 'NONE').toString()).toBe('2026-10-10');
    expect(WeekendAdjustment.apply(d('2026-10-14'), 'PREVIOUS').toString()).toBe('2026-10-14');
    expect(WeekendAdjustment.apply(d('2026-10-14'), 'NEXT').toString()).toBe('2026-10-14');
  });
});

describe('COUNT y UNTIL (FR-COMMITMENTS-009)', () => {
  it('[TC-COMMITMENTS-RECUR-033] el máximo de 12 ocurrencias termina en 2027-09-15', () => {
    const rule = ruleFromCadence({ cadence: 'MONTHLY', dtstart: d('2026-10-15'), count: 12 });
    const all = dates(expand(rule, win('2026-01-01', '2035-01-01')));
    expect(all).toHaveLength(12);
    expect(all[0]).toBe('2026-10-15');
    expect(all[11]).toBe('2027-09-15');
    // El conteo incluye las fechas anteriores a la ventana pedida.
    expect(dates(expand(rule, win('2027-08-01', '2035-01-01')))).toEqual(['2027-08-15', '2027-09-15']);
  });

  it('until acota la serie de forma inclusiva', () => {
    const rule = ruleFromCadence({ cadence: 'MONTHLY', dtstart: d('2026-10-20'), until: d('2026-12-20') });
    expect(dates(expand(rule, win('2026-01-01', '2030-01-01')))).toEqual([
      '2026-10-20',
      '2026-11-20',
      '2026-12-20',
    ]);
  });
});

describe('RRULE personalizada (FR-COMMITMENTS-003)', () => {
  it('[TC-COMMITMENTS-RECUR-007] el último viernes de cada mes', () => {
    const rule = RRuleSubset.parse('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1', d('2026-10-01'));
    expect(dates(expand(rule, win('2026-10-01', '2026-12-31')))).toEqual([
      '2026-10-30',
      '2026-11-27',
      '2026-12-25',
    ]);
  });

  it('BYDAY con ordinal (segundo martes), semanal con varios días y diaria entre semana', () => {
    const second = RRuleSubset.parse('FREQ=MONTHLY;BYDAY=2TU', d('2026-10-01'));
    expect(dates(expand(second, win('2026-10-01', '2026-12-31')))).toEqual([
      '2026-10-13',
      '2026-11-10',
      '2026-12-08',
    ]);
    const weekly = RRuleSubset.parse('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', d('2026-10-05'));
    expect(dates(expand(weekly, win('2026-10-05', '2026-10-31')))).toEqual([
      '2026-10-05',
      '2026-10-07',
      '2026-10-19',
      '2026-10-21',
    ]);
    const weekdays = RRuleSubset.parse('FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR', d('2026-10-09'));
    expect(dates(expand(weekdays, win('2026-10-09', '2026-10-14')))).toEqual([
      '2026-10-09',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ]);
  });

  it('BYMONTHDAY con BYSETPOS (primer y último de los días listados), UNTIL y COUNT', () => {
    const last = RRuleSubset.parse('FREQ=MONTHLY;BYMONTHDAY=10,20;BYSETPOS=-1', d('2026-10-01'));
    expect(dates(expand(last, win('2026-10-01', '2026-11-30')))).toEqual(['2026-10-20', '2026-11-20']);
    const until = RRuleSubset.parse('FREQ=MONTHLY;BYMONTHDAY=-1;UNTIL=20261130', d('2026-10-01'));
    expect(dates(expand(until, win('2026-10-01', '2027-12-31')))).toEqual(['2026-10-31', '2026-11-30']);
    const count = RRuleSubset.parse('FREQ=YEARLY;COUNT=2', d('2026-03-05'));
    expect(dates(expand(count, win('2026-01-01', '2040-01-01')))).toEqual(['2026-03-05', '2027-03-05']);
  });

  it('[TC-COMMITMENTS-RECUR-008] partes fuera del subconjunto, COUNT con UNTIL o reglas vacías ⇒ INVALID_RRULE', () => {
    const start = d('2026-10-01');
    for (const bad of [
      'FREQ=HOURLY;INTERVAL=2',
      'FREQ=MONTHLY;COUNT=12;UNTIL=20271231',
      'FREQ=MONTHLY;BYMONTH=2',
      'FREQ=MONTHLY;BYDAY=XX',
      'FREQ=MONTHLY;BYDAY=6FR',
      'FREQ=MONTHLY;INTERVAL=0',
      'FREQ=MONTHLY;INTERVAL=a',
      'FREQ=MONTHLY;BYMONTHDAY=0',
      'FREQ=MONTHLY;BYMONTHDAY=32',
      'FREQ=MONTHLY;BYSETPOS=0;BYDAY=FR',
      'FREQ=MONTHLY;BYSETPOS=1',
      'FREQ=MONTHLY;FREQ=DAILY',
      'FREQ=WEEKLY;BYMONTHDAY=5',
      'FREQ=YEARLY;BYDAY=MO',
      'FREQ=MONTHLY;UNTIL=2027',
      'FREQ=MONTHLY;UNTIL=20270231',
      'FREQ=MONTHLY;UNTIL=20200101',
      'BYDAY=FR',
      '',
      'FREQ',
      'FREQ=MONTHLY;BYDAY=5MO;BYMONTHDAY=3',
    ]) {
      expect(
        codeOf(() => RRuleSubset.parse(bad, start)),
        bad,
      ).toBe('INVALID_RRULE');
    }
    // Sin fechas: el primer lunes de octubre (05) es anterior al inicio y UNTIL cierra la serie ese mismo dia.
    expect(codeOf(() => RRuleSubset.parse('FREQ=MONTHLY;BYDAY=1MO;UNTIL=20261009', d('2026-10-09')))).toBe(
      'INVALID_RRULE',
    );
  });

  it('format es la forma normalizada y parse(format(r)) conserva la regla', () => {
    const rule = RRuleSubset.parse(
      'rrule:freq=monthly;byday=fr;bysetpos=-1;interval=2;count=6',
      d('2026-10-01'),
    );
    const text = RRuleSubset.format(rule);
    expect(text).toBe('FREQ=MONTHLY;INTERVAL=2;BYDAY=FR;BYSETPOS=-1;COUNT=6');
    expect(RRuleSubset.parse(text, d('2026-10-01'))).toEqual(rule);
    expect(
      RRuleSubset.format(RRuleSubset.parse('FREQ=MONTHLY;BYDAY=-1FR,2TU;UNTIL=2027-06-30', d('2026-10-01'))),
    ).toBe('FREQ=MONTHLY;INTERVAL=1;BYDAY=2TU,-1FR;UNTIL=20270630');
  });
});

describe('vista previa de próximas fechas', () => {
  it('devuelve las próximas n fechas desde un día dado', () => {
    const rule = ruleFromCadence({ cadence: 'MONTHLY', dtstart: d('2026-10-05') });
    expect(dates(nextDates(rule, d('2026-11-06'), 3))).toEqual(['2026-12-05', '2027-01-05', '2027-02-05']);
    const finite = ruleFromCadence({ cadence: 'MONTHLY', dtstart: d('2026-10-05'), count: 2 });
    expect(dates(nextDates(finite, d('2026-10-01'), 6))).toEqual(['2026-10-05', '2026-11-05']);
  });
});

describe('createRule', () => {
  it('normaliza (ordena y deduplica) y congela', () => {
    const rule = createRule({ freq: 'MONTHLY', byMonthDay: [-1, 15, 15, 3], dtstart: d('2026-10-01') });
    expect([...rule.byMonthDay]).toEqual([3, 15, -1]);
    expect(Object.isFrozen(rule)).toBe(true);
  });
});
