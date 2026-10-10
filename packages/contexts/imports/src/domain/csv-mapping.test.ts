import { describe, expect, it } from 'vitest';
import { dataRecords, parseMapping } from './csv-mapping.js';

const VALID = {
  hasHeader: true,
  skipRows: 0,
  columns: {
    date: { index: 0 },
    description: { index: 1 },
    amount: { mode: 'SIGNED', index: 2, signConvention: 'NEGATIVE_IS_OUTFLOW' },
  },
  dateFormat: 'dd/MM/yyyy',
  decimalSeparator: ',',
};

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (
      (e as { code: string; violations: { pointer: string }[] }).code +
      ':' +
      ((e as { violations: { pointer: string }[] }).violations[0]?.pointer ?? '')
    );
  }
  return 'OK';
};

describe('parseMapping', () => {
  it('acepta un mapeo válido de monto con signo y de débito/crédito', () => {
    expect(parseMapping(VALID, 3).columns.amount).toEqual({
      mode: 'SIGNED',
      index: 2,
      signConvention: 'NEGATIVE_IS_OUTFLOW',
    });
    const dc = parseMapping(
      {
        ...VALID,
        columns: { ...VALID.columns, amount: { mode: 'DEBIT_CREDIT', debitIndex: 2, creditIndex: 3 } },
      },
      4,
    );
    expect(dc.columns.amount).toEqual({ mode: 'DEBIT_CREDIT', debitIndex: 2, creditIndex: 3 });
    expect(dc.skipRows).toBe(0);
  });

  it('[TC-IMPORTS-CSV-009] una columna inexistente es IMPORT_MAPPING_INVALID', () => {
    const input = { ...VALID, columns: { ...VALID.columns, amount: { ...VALID.columns.amount, index: 7 } } };
    expect(codeOf(() => parseMapping(input, 3))).toBe('IMPORT_MAPPING_INVALID:/columns/amount/index');
  });

  it.each([
    [
      'sin monto',
      { ...VALID, columns: { date: VALID.columns.date, description: VALID.columns.description } },
    ],
    [
      'sin fecha',
      { ...VALID, columns: { description: VALID.columns.description, amount: VALID.columns.amount } },
    ],
    ['sin descripción', { ...VALID, columns: { date: VALID.columns.date, amount: VALID.columns.amount } }],
    ['formato de fecha fuera del catálogo', { ...VALID, dateFormat: 'yyyy/MM/dd' }],
    ['separador decimal inválido', { ...VALID, decimalSeparator: ';' }],
    ['skipRows fuera de rango', { ...VALID, skipRows: 51 }],
    ['hasHeader no booleano', { ...VALID, hasHeader: 'si' }],
    ['columnas repetidas', { ...VALID, columns: { ...VALID.columns, description: { index: 0 } } }],
    [
      'débito igual a crédito',
      {
        ...VALID,
        columns: { ...VALID.columns, amount: { mode: 'DEBIT_CREDIT', debitIndex: 2, creditIndex: 2 } },
      },
    ],
    [
      'convención de signo ausente',
      { ...VALID, columns: { ...VALID.columns, amount: { mode: 'SIGNED', index: 2 } } },
    ],
    ['índice negativo', { ...VALID, columns: { ...VALID.columns, date: { index: -1 } } }],
    ['no es un objeto', 'x'],
  ])('rechaza: %s', (_name, input) => {
    expect(codeOf(() => parseMapping(input, 4))).toMatch(/^IMPORT_MAPPING_INVALID:/);
  });
});

describe('dataRecords', () => {
  const records = Array.from({ length: 6 }, (_, i) => ({ line: i + 1, cells: [String(i)] }));

  it('salta los registros iniciales y el encabezado', () => {
    const mapping = parseMapping({ ...VALID, skipRows: 2 }, 3);
    expect(dataRecords(records, mapping).map((r) => r.line)).toEqual([4, 5, 6]);
    expect(dataRecords(records, parseMapping({ ...VALID, hasHeader: false }, 3)).map((r) => r.line)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });
});
