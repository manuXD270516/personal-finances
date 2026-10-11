import { DomainError, LocalDate, currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { validateCustomSchedule, type CustomScheduleInput } from './custom-schedule.js';

const BOB = currency('BOB', 2);
const d = (s: string) => LocalDate.parse(s);

const input = (over: Partial<CustomScheduleInput> = {}): CustomScheduleInput => ({
  currency: BOB,
  expectedPrincipal: '1000.00',
  after: d('2026-10-15'),
  accrualStart: d('2026-10-15'),
  firstInstallmentNo: 1,
  rows: [
    { dueDate: '2026-11-15', principal: '400.00', interest: '10.00' },
    { dueDate: '2026-12-15', principal: '300.00', interest: '6.00' },
    { dueDate: '2027-01-15', principal: '300.00', interest: '3.00' },
  ],
  ...over,
});

const problem = (fn: () => unknown): DomainError => {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err;
    throw err;
  }
  throw new Error('no error');
};

describe('CustomScheduleValidator', () => {
  it('[TC-DEBT-AMORT-026] tres cuotas cargadas a mano quedan con 410.00, 306.00 y 303.00', () => {
    const rows = validateCustomSchedule(input());
    expect(rows.map((r) => r.total)).toEqual(['410.00', '306.00', '303.00']);
    expect(rows.map((r) => [r.openingBalance, r.closingBalance])).toEqual([
      ['1000.00', '600.00'],
      ['600.00', '300.00'],
      ['300.00', '0.00'],
    ]);
    expect(rows.map((r) => r.periodStart)).toEqual(['2026-10-15', '2026-11-15', '2026-12-15']);
    expect(rows.map((r) => r.n)).toEqual([1, 2, 3]);
  });

  it('[TC-DEBT-AMORT-027] un principal que no suma se rechaza informando 999.99 frente a 1000.00', () => {
    const err = problem(() =>
      validateCustomSchedule(
        input({
          rows: [
            { dueDate: '2026-11-15', principal: '400.00', interest: '10.00' },
            { dueDate: '2026-12-15', principal: '299.99', interest: '6.00' },
            { dueDate: '2027-01-15', principal: '300.00', interest: '3.00' },
          ],
        }),
      ),
    );
    expect(err.code).toBe('CUSTOM_SCHEDULE_INVALID');
    expect(err.details).toMatchObject({ principalSum: { expected: '1000.00', actual: '999.99' } });
  });

  it('rechaza vencimientos no crecientes o anteriores al piso, componentes negativos y escala excedida, con la cuota', () => {
    const err = problem(() =>
      validateCustomSchedule(
        input({
          rows: [
            { dueDate: '2026-10-15', principal: '400.00', interest: '10.00' },
            { dueDate: '2026-12-15', principal: '300.00', interest: '-6.00' },
            { dueDate: '2026-12-15', principal: '300.001', interest: '3.00' },
          ],
        }),
      ),
    );
    expect(err.code).toBe('CUSTOM_SCHEDULE_INVALID');
    const rows = (err.details as { rows: { n: number; field: string; reason: string }[] }).rows;
    expect(rows).toEqual(
      expect.arrayContaining([
        { n: 1, field: 'dueDate', reason: 'NOT_AFTER_START' },
        { n: 2, field: 'interest', reason: 'NEGATIVE' },
        { n: 3, field: 'principal', reason: 'SCALE_EXCEEDED' },
        { n: 3, field: 'dueDate', reason: 'NOT_INCREASING' },
      ]),
    );
  });

  it('continúa la numeración de un préstamo en curso y exige el correlativo y el total coherente', () => {
    const rows = validateCustomSchedule(
      input({
        firstInstallmentNo: 4,
        rows: [
          { n: 4, dueDate: '2026-11-15', principal: '500.00', interest: '10.00', total: '510.00' },
          { n: 5, dueDate: '2026-12-15', principal: '500.00', interest: '5.00' },
        ],
      }),
    );
    expect(rows.map((r) => r.n)).toEqual([4, 5]);
    const gap = problem(() =>
      validateCustomSchedule(
        input({
          firstInstallmentNo: 4,
          rows: [
            { n: 5, dueDate: '2026-11-15', principal: '500.00', total: '999.00' },
            { dueDate: '2026-12-15', principal: '500.00' },
          ],
        }),
      ),
    );
    expect((gap.details as { rows: { reason: string }[] }).rows.map((r) => r.reason)).toEqual(
      expect.arrayContaining(['NUMBERING_GAP', 'TOTAL_MISMATCH']),
    );
  });

  it('rechaza un cronograma vacío', () => {
    expect(problem(() => validateCustomSchedule(input({ rows: [] }))).code).toBe('CUSTOM_SCHEDULE_INVALID');
  });
});
