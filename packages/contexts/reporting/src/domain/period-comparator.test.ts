import { dec, Instant, LocalDate } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { PeriodComparator, endOfDayInstant } from './period-comparator.js';

const d = (s: string) => LocalDate.parse(s);
const range = (r: { from: LocalDate; to: LocalDate }) => `${r.from.toString()}..${r.to.toString()}`;

describe('PeriodComparator (docs/14 §6; design.md decisión 4)', () => {
  it('[TC-REPORTING-KPI-007] el 2026-09-15 compara 1..15 de septiembre contra 1..15 de agosto', () => {
    const period = PeriodComparator.month('2026-09');
    const cmp = PeriodComparator.comparison(period, d('2026-09-15'), 'PREVIOUS_PERIOD_TO_DATE');
    expect(cmp && range(cmp.current)).toBe('2026-09-01..2026-09-15');
    expect(cmp && range(cmp.previous)).toBe('2026-08-01..2026-08-15');
    expect(cmp?.mode).toBe('PREVIOUS_PERIOD_TO_DATE');
  });

  it('[TC-REPORTING-KPI-007] gastos 1305.00 vs 1200.00: +105.00 y +8.75 %', () => {
    const v = PeriodComparator.variation(dec('1305.00'), dec('1200.00'));
    expect(v.deltaAbs.toFixed(2)).toBe('105.00');
    expect(v.deltaPct).toBe('8.75');
    expect(v.isNew).toBe(false);
  });

  it('[TC-REPORTING-KPI-007] ingresos 8000.00 vs 0.00: +8000.00, deltaPct null e isNew', () => {
    const v = PeriodComparator.variation(dec('8000.00'), dec('0'));
    expect(v.deltaAbs.toFixed(2)).toBe('8000.00');
    expect(v.deltaPct).toBeNull();
    expect(v.isNew).toBe(true);
  });

  it('[TC-REPORTING-KPI-007] borde: el 31 de octubre se compara contra 1..30 de septiembre', () => {
    const cmp = PeriodComparator.comparison(
      PeriodComparator.month('2026-10'),
      d('2026-10-31'),
      'PREVIOUS_PERIOD_TO_DATE',
    );
    expect(cmp && range(cmp.current)).toBe('2026-10-01..2026-10-31');
    expect(cmp && range(cmp.previous)).toBe('2026-09-01..2026-09-30');
    const mar = PeriodComparator.comparison(
      PeriodComparator.month('2027-03'),
      d('2027-03-30'),
      'PREVIOUS_PERIOD_TO_DATE',
    );
    expect(mar && range(mar.previous)).toBe('2027-02-01..2027-02-28');
  });

  it('un mes cerrado se compara completo; PREVIOUS_PERIOD siempre completo; NONE no compara', () => {
    const aug = PeriodComparator.month('2026-08');
    const closed = PeriodComparator.comparison(aug, d('2026-09-15'), 'PREVIOUS_PERIOD_TO_DATE');
    expect(closed && range(closed.current)).toBe('2026-08-01..2026-08-31');
    expect(closed && range(closed.previous)).toBe('2026-07-01..2026-07-31');
    const full = PeriodComparator.comparison(
      PeriodComparator.month('2026-09'),
      d('2026-09-15'),
      'PREVIOUS_PERIOD',
    );
    expect(full && range(full.current)).toBe('2026-09-01..2026-09-30');
    expect(full && range(full.previous)).toBe('2026-08-01..2026-08-31');
    expect(PeriodComparator.comparison(aug, d('2026-09-15'), 'NONE')).toBeNull();
    const jan = PeriodComparator.comparison(
      PeriodComparator.month('2027-01'),
      d('2027-02-01'),
      'PREVIOUS_PERIOD',
    );
    expect(jan && range(jan.previous)).toBe('2026-12-01..2026-12-31');
  });

  it('un rango libre se compara con el rango inmediatamente anterior de la misma longitud', () => {
    const p = PeriodComparator.range('2026-09-11', '2026-09-20');
    const cmp = PeriodComparator.comparison(p, d('2026-10-01'), 'PREVIOUS_PERIOD_TO_DATE');
    expect(cmp && range(cmp.previous)).toBe('2026-09-01..2026-09-10');
  });

  it('rechaza meses y rangos inválidos con VALIDATION_FAILED', () => {
    expect(() => PeriodComparator.month('2026-13')).toThrow(/YYYY-MM/);
    expect(() => PeriodComparator.range('2026-09-30', '2026-09-01')).toThrow(/dateFrom/);
  });

  it('[TC-REPORTING-KPI-008] el cierre del día de negocio en America/La_Paz es 23:59:59.999-04:00', () => {
    expect(endOfDayInstant('2026-09-30', 'America/La_Paz').toString()).toBe('2026-10-01T03:59:59.999Z');
    // El instante de registro 2026-10-01T02:30:00Z sigue siendo 30 de septiembre en La Paz.
    expect(LocalDate.ofInstant(Instant.parse('2026-10-01T02:30:00Z'), 'America/La_Paz').toString()).toBe(
      '2026-09-30',
    );
    expect(PeriodComparator.contains(PeriodComparator.month('2026-09'), d('2026-09-30'))).toBe(true);
    expect(PeriodComparator.contains(PeriodComparator.month('2026-10'), d('2026-09-30'))).toBe(false);
  });
});
