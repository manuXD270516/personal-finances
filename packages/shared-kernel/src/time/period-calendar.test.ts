import { describe, expect, it } from 'vitest';
import { type DomainError } from '../errors/domain-error.js';
import { Instant } from './instant.js';
import { LocalDate } from './local-date.js';
import {
  assertStartDay,
  FinancialPeriodCalendar,
  HORIZON_MONTHS,
  horizonOf,
  labelOf,
  maxDate,
  minDate,
  parseLabel,
  PeriodCalendar,
  planCoverage,
  planReschedule,
  plusDays,
  plusMonths,
  shiftLabel,
  type DateRange,
  type PlannedPeriod,
} from './period-calendar.js';

const d = (s: string) => LocalDate.parse(s);
const range = (start: string, end: string): DateRange => ({ start: d(start), end: d(end) });
const show = (p: PlannedPeriod) => `${p.label}:${p.range.start}..${p.range.end}:${String(p.isTransition)}`;
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as DomainError).code;
  }
  return undefined;
};

// Cálculo puro de rangos de fechas de negocio (openspec add-financial-periods): sin instantes ni zona horaria; la
// zona America/La_Paz solo interviene al obtener "hoy" (LocalDate.ofInstant), que es la frontera de este módulo.
describe('PeriodCalendar: etiquetas y aritmética de fechas', () => {
  it('assertStartDay admite 1..28 y rechaza el resto con VALIDATION_FAILED', () => {
    expect(() => assertStartDay(1)).not.toThrow();
    expect(() => assertStartDay(28)).not.toThrow();
    for (const bad of [0, 29, -1, 1.5, Number.NaN])
      expect(codeOf(() => assertStartDay(bad))).toBe('VALIDATION_FAILED');
  });

  it('parseLabel acepta YYYY-MM y rechaza formatos y meses inválidos', () => {
    expect(parseLabel('2026-10')).toEqual({ year: 2026, month: 10 });
    for (const bad of ['2026-13', '2026-00', '26-10', '2026-1', '2026-10-01', '']) {
      expect(codeOf(() => parseLabel(bad))).toBe('VALIDATION_FAILED');
    }
    expect(codeOf(() => parseLabel(undefined as unknown as string))).toBe('VALIDATION_FAILED');
  });

  it('labelOf y shiftLabel cruzan años en ambos sentidos', () => {
    expect(labelOf(d('2026-10-25'))).toBe('2026-10');
    expect(shiftLabel('2026-11', 2)).toBe('2027-01');
    expect(shiftLabel('2026-01', -1)).toBe('2025-12');
    expect(shiftLabel('2026-12', 0)).toBe('2026-12');
    expect(shiftLabel('2026-03', -15)).toBe('2024-12');
  });

  it('plusDays cruza mes, año y febrero bisiesto', () => {
    expect(plusDays(d('2026-10-31'), 1).toString()).toBe('2026-11-01');
    expect(plusDays(d('2026-12-31'), 1).toString()).toBe('2027-01-01');
    expect(plusDays(d('2028-02-28'), 1).toString()).toBe('2028-02-29');
    expect(plusDays(d('2027-02-28'), 1).toString()).toBe('2027-03-01');
    expect(plusDays(d('2026-03-01'), -1).toString()).toBe('2026-02-28');
  });

  it('plusMonths acota el día al último del mes destino (meses cortos y febrero bisiesto)', () => {
    expect(plusMonths(d('2027-01-31'), 1).toString()).toBe('2027-02-28');
    expect(plusMonths(d('2028-01-31'), 1).toString()).toBe('2028-02-29');
    expect(plusMonths(d('2026-03-31'), 1).toString()).toBe('2026-04-30');
    expect(plusMonths(d('2026-10-05'), -10).toString()).toBe('2025-12-05');
  });

  it('horizonOf es hoy + 24 meses y maxDate/minDate eligen la fecha mayor y menor', () => {
    expect(HORIZON_MONTHS).toBe(24);
    expect(horizonOf(d('2026-10-05')).toString()).toBe('2028-10-05');
    expect(horizonOf(d('2026-02-28')).toString()).toBe('2028-02-28');
    expect(maxDate(d('2026-01-01'), d('2026-02-01')).toString()).toBe('2026-02-01');
    expect(maxDate(d('2026-03-01'), d('2026-02-01')).toString()).toBe('2026-03-01');
    expect(minDate(d('2026-01-01'), d('2026-02-01')).toString()).toBe('2026-01-01');
    expect(minDate(d('2026-03-01'), d('2026-02-01')).toString()).toBe('2026-02-01');
  });
});

describe('PeriodCalendar: rangos con día de inicio 1 y 25', () => {
  it('rangeFor con día de inicio 1: el mes calendario, con febrero corto y bisiesto', () => {
    expect(PeriodCalendar.rangeFor('2026-10', 1)).toEqual(range('2026-10-01', '2026-10-31'));
    expect(PeriodCalendar.rangeFor('2026-11', 1)).toEqual(range('2026-11-01', '2026-11-30'));
    expect(PeriodCalendar.rangeFor('2027-02', 1)).toEqual(range('2027-02-01', '2027-02-28'));
    expect(PeriodCalendar.rangeFor('2028-02', 1)).toEqual(range('2028-02-01', '2028-02-29'));
  });

  it('rangeFor con día de inicio 25 y 28: termina el día anterior al inicio del mes siguiente', () => {
    expect(PeriodCalendar.rangeFor('2026-10', 25)).toEqual(range('2026-10-25', '2026-11-24'));
    expect(PeriodCalendar.rangeFor('2026-12', 25)).toEqual(range('2026-12-25', '2027-01-24'));
    expect(PeriodCalendar.rangeFor('2028-01', 28)).toEqual(range('2028-01-28', '2028-02-27'));
    expect(codeOf(() => PeriodCalendar.rangeFor('2026-10', 29))).toBe('VALIDATION_FAILED');
  });

  it('periodContaining con día 25: antes del 25 pertenece al periodo del mes anterior', () => {
    expect(show(PeriodCalendar.periodContaining(d('2026-10-24'), 25))).toBe(
      '2026-09:2026-09-25..2026-10-24:false',
    );
    expect(show(PeriodCalendar.periodContaining(d('2026-10-25'), 25))).toBe(
      '2026-10:2026-10-25..2026-11-24:false',
    );
    expect(show(PeriodCalendar.periodContaining(d('2026-01-10'), 25))).toBe(
      '2025-12:2025-12-25..2026-01-24:false',
    );
    expect(show(PeriodCalendar.periodContaining(d('2026-10-31'), 1))).toBe(
      '2026-10:2026-10-01..2026-10-31:false',
    );
  });

  it('next: periodo regular tras uno que cierra el último día; transición si no empieza en el día de inicio', () => {
    expect(show(PeriodCalendar.next(d('2026-10-31'), 1))).toBe('2026-11:2026-11-01..2026-11-30:false');
    expect(show(PeriodCalendar.next(d('2026-11-14'), 1))).toBe('2026-11:2026-11-15..2026-11-30:true');
    // Cambio de día 1 a 25: el periodo siguiente empieza el 01-nov y llega hasta el 24-dic (58 días).
    expect(show(PeriodCalendar.next(d('2026-10-31'), 25))).toBe('2026-11:2026-11-01..2026-12-24:true');
  });

  it('previous: regular, con el día en que empieza el siguiente', () => {
    expect(show(PeriodCalendar.previous(d('2026-11-25')))).toBe('2026-10:2026-10-25..2026-11-24:false');
    expect(show(PeriodCalendar.previous(d('2026-01-01')))).toBe('2025-12:2025-12-01..2025-12-31:false');
  });

  it('contains es inclusivo en ambos extremos', () => {
    const r = range('2026-10-01', '2026-10-31');
    expect(PeriodCalendar.contains(r, d('2026-10-01'))).toBe(true);
    expect(PeriodCalendar.contains(r, d('2026-10-31'))).toBe(true);
    expect(PeriodCalendar.contains(r, d('2026-09-30'))).toBe(false);
    expect(PeriodCalendar.contains(r, d('2026-11-01'))).toBe(false);
  });

  it('la fecha de negocio manda: el instante 03:30Z en La Paz sigue siendo el día anterior', () => {
    // 2026-11-01T03:30Z = 2026-10-31 23:30 en America/La_Paz (UTC-4).
    const today = LocalDate.ofInstant(Instant.parse('2026-11-01T03:30:00Z'), 'America/La_Paz');
    expect(today.toString()).toBe('2026-10-31');
    expect(PeriodCalendar.periodContaining(today, 1).label).toBe('2026-10');
  });
});

describe('planCoverage', () => {
  const today = d('2026-10-05');
  const base = { startDay: 1, today, from: today, through: today, lookahead: 3 };

  it('sin periodos crea el que contiene hoy y los 3 de anticipación (2026-10..2027-01)', () => {
    expect(planCoverage({ ...base, existing: [] }).map(show)).toEqual([
      '2026-10:2026-10-01..2026-10-31:false',
      '2026-11:2026-11-01..2026-11-30:false',
      '2026-12:2026-12-01..2026-12-31:false',
      '2027-01:2027-01-01..2027-01-31:false',
    ]);
  });

  it('con día de inicio 25 el primer periodo es el que contiene hoy (2026-09) y la anticipación cuenta inicios futuros', () => {
    const plan = planCoverage({ ...base, startDay: 25, existing: [] });
    expect(plan.map((p) => p.label)).toEqual(['2026-09', '2026-10', '2026-11', '2026-12']);
    expect(plan[0]?.range).toEqual(range('2026-09-25', '2026-10-24'));
  });

  it('es idempotente: con lo ya creado no propone nada', () => {
    const existing = planCoverage({ ...base, existing: [] }).map((p) => ({ label: p.label, range: p.range }));
    expect(planCoverage({ ...base, existing })).toEqual([]);
  });

  it('cobertura hacia adelante: extiende hasta la fecha pedida (acotada al horizonte de 24 meses)', () => {
    const existing = [{ label: '2026-10', range: range('2026-10-01', '2026-10-31') }];
    const plan = planCoverage({ ...base, existing, lookahead: 0, through: d('2027-01-15') });
    expect(plan.map((p) => p.label)).toEqual(['2026-11', '2026-12', '2027-01']);
    const far = planCoverage({ ...base, existing, lookahead: 100, through: d('2040-01-01') });
    expect(far).toHaveLength(24);
    expect(far.at(-1)?.label).toBe('2028-10');
    expect(far.at(-1)?.range.start.compare(horizonOf(today))).toBeLessThanOrEqual(0);
  });

  it('cobertura retroactiva: crea periodos anteriores al primero en orden de inicio', () => {
    const existing = [{ label: '2026-10', range: range('2026-10-01', '2026-10-31') }];
    const plan = planCoverage({ ...base, existing, lookahead: 0, from: d('2026-08-15') });
    expect(plan.map(show)).toEqual([
      '2026-08:2026-08-01..2026-08-31:false',
      '2026-09:2026-09-01..2026-09-30:false',
    ]);
  });

  it('sin periodos y con una fecha de inicio anterior a hoy parte del periodo que contiene esa fecha', () => {
    const plan = planCoverage({ ...base, existing: [], lookahead: 0, from: d('2026-08-15') });
    expect(plan.map((p) => p.label)).toEqual(['2026-08', '2026-09', '2026-10']);
  });
});

describe('planReschedule (cambio del día de inicio, decisión 9)', () => {
  const periods = [
    { label: '2026-10', range: range('2026-10-01', '2026-10-31'), status: 'CLOSED' },
    { label: '2026-11', range: range('2026-11-01', '2026-11-30'), status: 'DRAFT' },
    { label: '2026-12', range: range('2026-12-01', '2026-12-31'), status: 'DRAFT' },
  ];

  it('de día 1 a 25: el primer DRAFT absorbe el desfase (transición) y los demás cambian de rango', () => {
    const changes = planReschedule(periods, 25);
    expect(changes.map((c) => [c.label, show(c.after)])).toEqual([
      ['2026-11', '2026-11:2026-11-01..2026-12-24:true'],
      ['2026-12', '2026-12:2026-12-25..2027-01-24:false'],
    ]);
    expect(changes[0]?.before).toEqual(range('2026-11-01', '2026-11-30'));
  });

  it('sin cambio efectivo devuelve [] y un día de inicio inválido se rechaza', () => {
    expect(planReschedule(periods, 1)).toEqual([]);
    expect(planReschedule([], 25)).toEqual([]);
    expect(planReschedule(periods.slice(0, 1), 25)).toEqual([]);
    expect(codeOf(() => planReschedule(periods, 30))).toBe('VALIDATION_FAILED');
  });

  it('sin periodos no DRAFT parte del inicio del primer DRAFT; no importa el orden de entrada', () => {
    const drafts = [periods[2]!, periods[1]!];
    const changes = planReschedule(drafts, 25);
    expect(changes.map((c) => c.label)).toEqual(['2026-11', '2026-12']);
    expect(show(changes[0]!.after)).toBe('2026-11:2026-11-01..2026-12-24:true');
  });

  it('un DRAFT con día de inicio o marca de transición distintos se recalcula aunque el rango no cambie', () => {
    const same = range('2026-11-01', '2026-11-30');
    const withDay = [{ label: '2026-11', range: same, status: 'DRAFT', startDay: 25 }];
    expect(planReschedule(withDay, 1).map((c) => c.after.startDay)).toEqual([1]);
    const withMark = [{ label: '2026-11', range: same, status: 'DRAFT', startDay: 1, isTransition: true }];
    expect(planReschedule(withMark, 1).map((c) => c.after.isTransition)).toEqual([false]);
    const consistent = [{ label: '2026-11', range: same, status: 'DRAFT', startDay: 1, isTransition: false }];
    expect(planReschedule(consistent, 1)).toEqual([]);
  });
});

describe('FinancialPeriodCalendar: casos de borde', () => {
  it('periodOf resuelve el periodo regular de una fecha', () => {
    expect(show(FinancialPeriodCalendar.periodOf(25, d('2026-10-10')))).toBe(
      '2026-09:2026-09-25..2026-10-24:false',
    );
  });

  it('periodsBefore con n = 0 es vacío y cruza el cambio de año', () => {
    expect(FinancialPeriodCalendar.periodsBefore(1, d('2026-02-10'), 0)).toEqual([]);
    expect(FinancialPeriodCalendar.periodsBefore(1, d('2026-02-10'), 3).map((p) => p.label)).toEqual([
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
  });
});
