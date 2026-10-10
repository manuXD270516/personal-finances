import { LocalDate, currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import type { CsvMapping } from './csv-mapping.js';
import { normalizeRow } from './row-normalizer.js';
import { hasErrors, validateRow, type ValidationContext } from './row-validator.js';

const MAPPING: CsvMapping = {
  hasHeader: true,
  skipRows: 0,
  columns: {
    date: { index: 0 },
    amount: { mode: 'SIGNED', index: 1, signConvention: 'NEGATIVE_IS_OUTFLOW' },
    description: { index: 2 },
  },
  dateFormat: 'dd/MM/yyyy',
  decimalSeparator: ',',
};
const CTX: ValidationContext = {
  today: LocalDate.parse('2026-10-20'),
  futureToleranceDays: 3,
  closedPeriods: [{ start: '2026-08-01', end: '2026-08-31' }],
};
const check = (date: string, amount: string, line = 2) =>
  validateRow(normalizeRow({ line, cells: [date, amount, 'X'] }, MAPPING, currency('BOB', 2)), CTX).map(
    (i) => i.code,
  );

describe('RowValidator', () => {
  it('[TC-IMPORTS-CSV-013] monto cero y fecha futura son inválidos; hoy + 3 días es válido', () => {
    expect(check('10/10/2026', '0,00')).toEqual(['IMPORT_INVALID_AMOUNT']);
    expect(check('25/10/2026', '-50,00')).toEqual(['IMPORT_FUTURE_DATE']);
    expect(check('22/10/2026', '-30,00')).toEqual([]);
    expect(check('23/10/2026', '-30,00')).toEqual([]);
    expect(check('24/10/2026', '-30,00')).toEqual(['IMPORT_FUTURE_DATE']);
  });

  it('[TC-IMPORTS-CSV-014] una fecha en un periodo cerrado es PERIOD_CLOSED', () => {
    expect(check('15/08/2026', '-75,00')).toEqual(['PERIOD_CLOSED']);
    expect(check('31/08/2026', '-75,00')).toEqual(['PERIOD_CLOSED']);
    expect(check('01/09/2026', '-75,00')).toEqual([]);
  });

  it('una fila con errores de normalización conserva solo esos errores', () => {
    expect(check('31/02/2026', 'abc')).toEqual(['IMPORT_INVALID_DATE', 'IMPORT_INVALID_AMOUNT']);
  });

  it('hasErrors ignora las advertencias', () => {
    expect(hasErrors([{ code: 'IMPORT_DESCRIPTION_TRUNCATED', severity: 'WARNING' }])).toBe(false);
    expect(hasErrors([{ code: 'PERIOD_CLOSED', severity: 'ERROR' }])).toBe(true);
  });
});
