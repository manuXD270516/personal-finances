import { LocalDate, currency, dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { calculateSchedule, type AmortizationInput } from './amortization-calculator.js';
import type { ReferenceScheduleRow, ScheduleInstallment } from './loan-types.js';
import {
  compareSchedules,
  comparisonToCsv,
  deriveComparisonStatus,
  suggestExplanations,
} from './schedule-comparator.js';

const BOB = currency('BOB', 2);
const d = (s: string) => LocalDate.parse(s);

const input: AmortizationInput = {
  currency: BOB,
  principal: '50000.00',
  annualRate: '0.115',
  dayCount: 'D30_360',
  frequency: 'MONTHLY',
  installments: 24,
  accrualStart: d('2026-10-15'),
  firstDueDate: d('2026-11-15'),
};

const system = (over: Partial<AmortizationInput> = {}): readonly ScheduleInstallment[] =>
  calculateSchedule({ ...input, ...over }).installments;

/** La tabla del banco como filas de referencia (copia exacta del cronograma). */
const refOf = (rows: readonly ScheduleInstallment[]): ReferenceScheduleRow[] =>
  rows.map((c) => ({
    n: c.n,
    dueDate: c.dueDate,
    principal: c.principal,
    interest: c.interest,
    fees: c.fees,
    insurance: c.insurance,
    taxes: c.taxes,
    total: c.total,
  }));

const compare = (
  sys: readonly ScheduleInstallment[],
  ref: readonly ReferenceScheduleRow[],
  loanPrincipal = '50000.00',
) => compareSchedules({ currency: BOB, system: sys, reference: ref, loanPrincipal });

describe('ScheduleComparator — comparación con la tabla del banco', () => {
  it('[TC-DEBT-AMORT-017] una tabla idéntica da 24 de 24 coincidentes y diferencia 0.00 en todos los componentes', () => {
    const sys = system();
    const c = compare(sys, refOf(sys));
    expect(c.summary.matching).toBe(24);
    expect(c.summary.totalRows).toBe(24);
    expect(c.summary.firstDifference).toBeNull();
    expect(c.summary.sumDifferences).toEqual({
      principal: '0.00',
      interest: '0.00',
      fees: '0.00',
      insurance: '0.00',
      taxes: '0.00',
      total: '0.00',
    });
    expect(c.summary.referencePrincipal).toBe('50000.00');
    expect(c.summary.loanPrincipal).toBe('50000.00');
    expect(c.summary.onlyReference).toEqual([]);
    expect(c.summary.onlySystem).toEqual([]);
    expect(c.rows.every((r) => r.status === 'MATCH')).toBe(true);
    expect(deriveComparisonStatus(c)).toBe('MATCH');
  });

  it('[TC-DEBT-AMORT-018] un centavo de diferencia en la cuota 24 (interés 22.22, cuota 2341.89)', () => {
    const sys = system();
    const ref = refOf(sys).map((r) => (r.n === 24 ? { ...r, interest: '22.22', total: '2341.89' } : r));
    const c = compare(sys, ref);
    expect(c.summary.matching).toBe(23);
    expect(c.summary.totalRows).toBe(24);
    expect(c.summary.firstDifference).toMatchObject({
      n: 24,
      datesMatch: true,
      differences: { principal: '0.00', interest: '-0.01', total: '-0.01' },
    });
    expect(c.summary.sumDifferences.interest).toBe('-0.01');
    expect(c.summary.differingComponents).toEqual(['interest', 'total']);
    expect(c.rows[23]).toMatchObject({ n: 24, status: 'DIFFERENT' });
    expect(deriveComparisonStatus(c)).toBe('UNEXPLAINED');
    expect(deriveComparisonStatus(c, 'el banco trunca el interés de la última cuota')).toBe('EXPLAINED');
    expect(deriveComparisonStatus(c, '   ')).toBe('UNEXPLAINED');
  });

  it('diferencias en vencimientos, filas huérfanas y suma del principal distinta', () => {
    const sys = system();
    const ref = refOf(sys)
      .filter((r) => r.n !== 5)
      .map((r) => (r.n === 2 ? { ...r, dueDate: '2026-12-16' } : r));
    ref.push({ ...ref[0]!, n: 30 });
    const c = compare(sys, ref);
    expect(c.rows.find((r) => r.n === 2)).toMatchObject({ status: 'DIFFERENT', datesMatch: false });
    expect(c.rows.find((r) => r.n === 5)).toMatchObject({
      status: 'ONLY_SYSTEM',
      reference: null,
      differences: null,
    });
    expect(c.rows.find((r) => r.n === 30)).toMatchObject({ status: 'ONLY_REFERENCE', system: null });
    expect(c.summary.onlySystem).toEqual([5]);
    expect(c.summary.onlyReference).toEqual([30]);
    expect(c.summary.firstDifference?.n).toBe(2);
    expect(c.summary.matching).toBe(22);
    expect(c.summary.totalRows).toBe(25);
    expect(c.summary.referencePrincipal).not.toBe('50000.00');
  });

  it('exporta el reporte en CSV con vencimientos y diferencias por componente', () => {
    const sys = system();
    const ref = refOf(sys).map((r) => (r.n === 24 ? { ...r, interest: '22.22', total: '2341.89' } : r));
    const csv = comparisonToCsv(compare(sys, ref));
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(25);
    expect(lines[0]).toContain('cuota,estado,vencimiento_sistema,vencimiento_banco');
    expect(lines[1]).toBe(
      [
        ['1', 'MATCH', '2026-11-15', '2026-11-15'],
        ['1862.85', '1862.85', '0.00'],
        ['479.17', '479.17', '0.00'],
        ['0.00', '0.00', '0.00'],
        ['0.00', '0.00', '0.00'],
        ['0.00', '0.00', '0.00'],
        ['2342.02', '2342.02', '0.00'],
      ]
        .flat()
        .join(','),
    );
    expect(lines[24]).toContain('24,DIFFERENT,2028-10-15,2028-10-15');
    expect(lines[24]).toContain('22.23,22.22,-0.01');
  });
});

describe('ScheduleComparator — sugerencias deterministas', () => {
  const suggest = (sys: readonly ScheduleInstallment[], ref: readonly ReferenceScheduleRow[]) =>
    suggestExplanations({
      comparison: compare(sys, ref),
      reference: ref,
      calculatorInput: input,
    });

  it('[TC-DEBT-AMORT-019] el banco usa ACT/365: coincide en más cuotas que 30/360 y las diferencias están en el interés', () => {
    const ref = refOf(system({ dayCount: 'ACT_365' }));
    expect(ref[0]!.interest).toBe('488.36');
    const comparison = compare(system(), ref);
    expect(comparison.summary.differingComponents).toContain('interest');
    expect(comparison.summary.matching).toBeLessThan(24);
    const s = suggest(system(), ref);
    const conventions = s.filter((x) => x.kind === 'CONVENTION');
    expect(conventions.map((x) => x.kind === 'CONVENTION' && x.dayCount)).toEqual([
      'D30_360',
      'ACT_360',
      'ACT_365',
    ]);
    const act365 = conventions.find((x) => x.kind === 'CONVENTION' && x.dayCount === 'ACT_365');
    const d30 = conventions.find((x) => x.kind === 'CONVENTION' && x.dayCount === 'D30_360');
    expect(act365).toMatchObject({
      matchingInstallments: 24,
      totalRows: 24,
      current: false,
      betterThanCurrent: true,
    });
    expect(d30).toMatchObject({ current: true, betterThanCurrent: false });
    expect(act365 && act365.kind === 'CONVENTION' && act365.matchingInstallments).toBeGreaterThan(
      d30 && d30.kind === 'CONVENTION' ? d30.matchingInstallments : 99,
    );
  });

  it('sin diferencias no hay sugerencias', () => {
    const sys = system();
    expect(suggest(sys, refOf(sys))).toEqual([]);
  });

  it('heurísticas: solo fechas, solo cargos, solo última cuota y suma del principal', () => {
    const sys = system();
    const base = refOf(sys);

    const soloFechas = base.map((r) => (r.n === 3 ? { ...r, dueDate: '2027-01-16' } : r));
    expect(suggest(sys, soloFechas).map((x) => x.kind)).toContain('ONLY_DATES');

    const soloCargos = base.map((r) => ({ ...r, fees: '10.00', total: dec(r.total).plus(10).toFixed(2) }));
    const kindsCargos = suggest(sys, soloCargos).map((x) => x.kind);
    expect(kindsCargos).toContain('ONLY_CHARGES');
    expect(kindsCargos).not.toContain('ONLY_DATES');

    const ultima = base.map((r) => (r.n === 24 ? { ...r, interest: '22.22', total: '2341.89' } : r));
    expect(suggest(sys, ultima).map((x) => x.kind)).toContain('ONLY_LAST_INSTALLMENT');
    // más de 0.01 × n de diferencia ya no es "solo redondeo de la última cuota"
    const grande = base.map((r) => (r.n === 24 ? { ...r, interest: '30.00', total: '2349.67' } : r));
    expect(suggest(sys, grande).map((x) => x.kind)).not.toContain('ONLY_LAST_INSTALLMENT');

    const principal = base.map((r) => (r.n === 24 ? { ...r, principal: '2319.00', total: '2341.23' } : r));
    const hallazgos = suggest(sys, principal);
    expect(hallazgos.find((x) => x.kind === 'PRINCIPAL_SUM_DIFFERS')).toMatchObject({ difference: '-0.67' });
  });
});
