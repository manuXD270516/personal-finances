import { DomainError, Instant, LocalDate } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  PeriodCalendar,
  horizonOf,
  labelOf,
  planCoverage,
  planReschedule,
  plusDays,
  type PlannedPeriod,
} from './period-calendar.js';

const d = (s: string) => LocalDate.parse(s);
const range = (p: { range: { start: LocalDate; end: LocalDate } }) =>
  `${p.range.start.toString()}..${p.range.end.toString()}`;
const code = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
};

describe('PeriodCalendar (planning/financial-periods)', () => {
  it('[TC-PLANNING-PERIOD-001] día de inicio 1: meses calendario, febrero y año bisiesto', () => {
    expect(range({ range: PeriodCalendar.rangeFor('2026-10', 1) })).toBe('2026-10-01..2026-10-31');
    expect(range({ range: PeriodCalendar.rangeFor('2026-02', 1) })).toBe('2026-02-01..2026-02-28');
    expect(range({ range: PeriodCalendar.rangeFor('2028-02', 1) })).toBe('2028-02-01..2028-02-29');
  });

  it('[TC-PLANNING-PERIOD-001] día de inicio 25 (cobro del salario) y cruce de año', () => {
    expect(range({ range: PeriodCalendar.rangeFor('2026-10', 25) })).toBe('2026-10-25..2026-11-24');
    expect(range({ range: PeriodCalendar.rangeFor('2026-12', 25) })).toBe('2026-12-25..2027-01-24');
  });

  it('[TC-PLANNING-PERIOD-001] día de inicio 28 alrededor de febrero; la etiqueta es el mes de inicio', () => {
    expect(range({ range: PeriodCalendar.rangeFor('2027-01', 28) })).toBe('2027-01-28..2027-02-27');
    expect(range({ range: PeriodCalendar.rangeFor('2027-02', 28) })).toBe('2027-02-28..2027-03-27');
    expect(labelOf(d('2027-02-28'))).toBe('2027-02');
    expect(PeriodCalendar.periodContaining(d('2027-02-27'), 28).label).toBe('2027-01');
  });

  it('[TC-PLANNING-PERIOD-001] el día de inicio fuera de 1..28 o una etiqueta inválida se rechazan', () => {
    expect(code(() => PeriodCalendar.rangeFor('2026-10', 29))).toBe('VALIDATION_FAILED');
    expect(code(() => PeriodCalendar.rangeFor('2026-10', 0))).toBe('VALIDATION_FAILED');
    expect(code(() => PeriodCalendar.rangeFor('2026-13', 1))).toBe('VALIDATION_FAILED');
  });

  it('[TC-PLANNING-TZ-001] (dominio) el periodo lo decide la fecha de negocio: 2026-10-31 es de "2026-10"; con día 25, 2026-11-24 es de "2026-10" y 2026-11-25 de "2026-11"', () => {
    // El gasto se registra en el instante 2026-11-01T03:30Z (23:30 del 31 en La Paz): su fecha de negocio manda.
    const businessDate = LocalDate.ofInstant(Instant.parse('2026-11-01T03:30:00Z'), 'America/La_Paz');
    expect(businessDate.toString()).toBe('2026-10-31');
    expect(PeriodCalendar.periodContaining(businessDate, 1).label).toBe('2026-10');
    // El mismo instante en UTC ya es 2026-11-01, pero el hecho conserva su fecha de negocio.
    expect(LocalDate.ofInstant(Instant.parse('2026-11-01T03:30:00Z'), 'UTC').toString()).toBe('2026-11-01');
    expect(PeriodCalendar.periodContaining(d('2026-11-24'), 25).label).toBe('2026-10');
    expect(PeriodCalendar.periodContaining(d('2026-11-25'), 25).label).toBe('2026-11');
    expect(range(PeriodCalendar.periodContaining(d('2026-11-25'), 25))).toBe('2026-11-25..2026-12-24');
  });

  it('aritmética de fechas: días, fin de mes y horizonte de 24 meses', () => {
    expect(plusDays(d('2026-12-31'), 1).toString()).toBe('2027-01-01');
    expect(plusDays(d('2028-03-01'), -1).toString()).toBe('2028-02-29');
    expect(horizonOf(d('2026-10-05')).toString()).toBe('2028-10-05');
    expect(horizonOf(d('2026-02-28')).toString()).toBe('2028-02-28');
  });
});

describe('planCoverage: periodos que faltan (creación automática y cobertura)', () => {
  const labels = (ps: readonly PlannedPeriod[]) => ps.map((p) => p.label);

  it('workspace nuevo, hoy 2026-10-05, día 1 y anticipación 3: "2026-10" a "2027-01"', () => {
    const plan = planCoverage({
      existing: [],
      startDay: 1,
      today: d('2026-10-05'),
      from: d('2026-10-05'),
      through: d('2026-10-05'),
      lookahead: 3,
    });
    expect(labels(plan)).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(plan.every((p) => !p.isTransition && p.startDay === 1)).toBe(true);
  });

  it('[TC-PLANNING-COVERAGE-001] (dominio) cobertura hacia atrás desde 2026-07-01 y hacia adelante hasta 2027-06-10, con tope de 24 meses', () => {
    const existing = planCoverage({
      existing: [],
      startDay: 1,
      today: d('2026-10-05'),
      from: d('2026-10-05'),
      through: d('2026-10-05'),
      lookahead: 3,
    });
    const back = planCoverage({
      existing,
      startDay: 1,
      today: d('2026-10-05'),
      from: d('2026-07-01'),
      through: d('2027-06-10'),
      lookahead: 3,
    });
    expect(labels(back)).toEqual([
      '2026-07',
      '2026-08',
      '2026-09',
      '2027-02',
      '2027-03',
      '2027-04',
      '2027-05',
      '2027-06',
    ]);
    expect(range(back[0]!)).toBe('2026-07-01..2026-07-31');
    // 2029-01-15 está más allá del horizonte (hoy + 24 meses = 2028-10-05): nada después de "2028-10".
    const far = planCoverage({
      existing,
      startDay: 1,
      today: d('2026-10-05'),
      from: d('2026-10-05'),
      through: d('2029-01-15'),
      lookahead: 3,
    });
    expect(far.at(-1)?.label).toBe('2028-10');
  });

  it('hacia atrás se conserva el día en que empieza el primer periodo existente (sin transiciones retroactivas)', () => {
    const existing = [{ label: '2026-10', range: PeriodCalendar.rangeFor('2026-10', 25) }];
    const plan = planCoverage({
      existing,
      startDay: 1,
      today: d('2026-10-30'),
      from: d('2026-09-01'),
      through: d('2026-10-30'),
      lookahead: 0,
    });
    expect(plan.map((p) => `${p.label} ${range(p)} ${p.startDay}`)).toEqual([
      '2026-08 2026-08-25..2026-09-24 25',
      '2026-09 2026-09-25..2026-10-24 25',
    ]);
  });

  it('hacia adelante, tras un periodo con otro día de inicio, el primero nuevo es de transición', () => {
    const existing = [{ label: '2026-10', range: PeriodCalendar.rangeFor('2026-10', 1) }];
    const plan = planCoverage({
      existing,
      startDay: 25,
      today: d('2026-10-05'),
      from: d('2026-10-05'),
      through: d('2026-10-05'),
      lookahead: 2,
    });
    expect(plan.map((p) => `${p.label} ${range(p)} ${String(p.isTransition)}`)).toEqual([
      '2026-11 2026-11-01..2026-12-24 true',
      '2026-12 2026-12-25..2027-01-24 false',
    ]);
  });
});

describe('planReschedule: cambio del día de inicio solo hacia adelante', () => {
  const at = (label: string, startDay: number, status: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'REOPENED') => ({
    label,
    range: PeriodCalendar.rangeFor(label, startDay),
    status,
  });

  it('[TC-PLANNING-FISCALDAY-001] (dominio) de día 1 a 25: "2026-10" no cambia, "2026-11" es de transición y los demás DRAFT se recalculan con su etiqueta', () => {
    const changes = planReschedule(
      [
        at('2026-10', 1, 'ACTIVE'),
        at('2026-11', 1, 'DRAFT'),
        at('2026-12', 1, 'DRAFT'),
        at('2027-01', 1, 'DRAFT'),
      ],
      25,
    );
    expect(changes.map((c) => `${c.label} ${range(c.after)} ${String(c.after.isTransition)}`)).toEqual([
      '2026-11 2026-11-01..2026-12-24 true',
      '2026-12 2026-12-25..2027-01-24 false',
      '2027-01 2027-01-25..2027-02-24 false',
    ]);
    expect(changes.map((c) => `${c.before.start.toString()}..${c.before.end.toString()}`)).toEqual([
      '2026-11-01..2026-11-30',
      '2026-12-01..2026-12-31',
      '2027-01-01..2027-01-31',
    ]);
  });

  it('[TC-PLANNING-FISCALDAY-002] de día 25 a 1: "2026-11" va del 25 al 30 de noviembre (transición) y "2026-12" es el mes calendario', () => {
    const changes = planReschedule(
      [at('2026-10', 25, 'ACTIVE'), at('2026-11', 25, 'DRAFT'), at('2026-12', 25, 'DRAFT')],
      1,
    );
    expect(changes.map((c) => `${c.label} ${range(c.after)} ${String(c.after.isTransition)}`)).toEqual([
      '2026-11 2026-11-25..2026-11-30 true',
      '2026-12 2026-12-01..2026-12-31 false',
    ]);
  });

  it('[TC-PLANNING-FISCALDAY-002] sin cambio de día o sin DRAFT no hay recálculo; los periodos no-DRAFT nunca se tocan', () => {
    expect(planReschedule([at('2026-10', 1, 'ACTIVE'), at('2026-11', 1, 'DRAFT')], 1)).toEqual([]);
    expect(planReschedule([at('2026-09', 1, 'CLOSED'), at('2026-10', 1, 'ACTIVE')], 25)).toEqual([]);
  });
});
