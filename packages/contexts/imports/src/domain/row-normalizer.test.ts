import { currency } from '@pf/shared-kernel';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CsvMapping } from './csv-mapping.js';
import { normalizeDescription, normalizeRow, parseAmountText, parseDate } from './row-normalizer.js';

const BOB = currency('BOB', 2);

const SIGNED: CsvMapping = {
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
const record = (line: number, ...cells: string[]) => ({ line, cells });

describe('parseAmountText', () => {
  it('[TC-IMPORTS-CSV-010] 8.000,00 con coma decimal es 8000.00 exactos', () => {
    expect(parseAmountText('8.000,00', ',')).toEqual({ kind: 'OK', negative: false, magnitude: '8000.00' });
  });

  it.each([
    ['-245,30', ',', true, '245.30'],
    ['245,30-', ',', true, '245.30'],
    ['(1.234,56)', ',', true, '1234.56'],
    ['+12,5', ',', false, '12.5'],
    ['1,234.56', '.', false, '1234.56'],
    ['1 234,56', ',', false, '1234.56'],
    ['1.234.567,89', ',', false, '1234567.89'],
    [',50', ',', false, '0.50'],
    ['007,5', ',', false, '7.5'],
    ['1.234', ',', false, '1234'],
  ] as const)('%j (%j) → signo %j magnitud %j', (raw, sep, negative, magnitude) => {
    expect(parseAmountText(raw, sep)).toEqual({ kind: 'OK', negative, magnitude });
  });

  it.each([
    ['1.23,4', ','],
    ['12a', ','],
    ['Bs 12', ','],
    ['1,2,3', ','],
    ['--5', ','],
    ['(5)-', ','],
    ['-', ','],
    ['1e5', '.'],
    ['12.345,6', '.'],
    [',', ','],
  ] as const)('rechaza %j (%j)', (raw, sep) => {
    expect(parseAmountText(raw, sep).kind).toBe('INVALID');
  });

  it('vacío y solo espacios es EMPTY', () => {
    expect(parseAmountText('  ', ',').kind).toBe('EMPTY');
  });

  it('[TC-IMPORTS-CSV-010] PBT: parse(format(m, locale)) == m para todo monto, escala y separador', () => {
    const grouped = (digits: string, sep: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10n ** 20n }),
        fc.integer({ min: 0, max: 8 }),
        fc.constantFrom(',', '.'),
        fc.boolean(),
        fc.boolean(),
        (units, scale, decimalSeparator, withThousands, negative) => {
          const digits = units.toString().padStart(scale + 1, '0');
          const integer = digits.slice(0, digits.length - scale);
          const fraction = digits.slice(digits.length - scale);
          const thousands = decimalSeparator === ',' ? '.' : ',';
          const text = `${negative ? '-' : ''}${withThousands ? grouped(integer, thousands) : integer}${
            scale > 0 ? decimalSeparator + fraction : ''
          }`;
          const expected = `${integer.replace(/^0+(?=\d)/, '')}${scale > 0 ? '.' + fraction : ''}`;
          expect(parseAmountText(text, decimalSeparator)).toEqual({
            kind: 'OK',
            negative,
            magnitude: expected,
          });
        },
      ),
      { numRuns: 500 },
    );
  }, 60_000);
});

describe('parseDate', () => {
  it('[TC-IMPORTS-CSV-012] 03/04/2026 es 2026-04-03 con dd/MM/yyyy y 2026-03-04 con MM/dd/yyyy', () => {
    expect(parseDate('03/04/2026', 'dd/MM/yyyy')?.toString()).toBe('2026-04-03');
    expect(parseDate('03/04/2026', 'MM/dd/yyyy')?.toString()).toBe('2026-03-04');
  });

  it.each([
    ['31/02/2026', 'dd/MM/yyyy'],
    ['29/02/2025', 'dd/MM/yyyy'],
    ['13/13/2026', 'MM/dd/yyyy'],
    ['2026/10/01', 'yyyy-MM-dd'],
    ['01/10/2026 10:30', 'dd/MM/yyyy'],
    ['', 'dd/MM/yyyy'],
    ['01.10.2026', 'dd/MM/yyyy'],
  ] as const)('%j no es una fecha válida en %s', (raw, format) => {
    expect(parseDate(raw, format)).toBeNull();
  });

  it('formatos soportados y pivote 2000-2099 para dd/MM/yy', () => {
    expect(parseDate('05-10-2026', 'dd-MM-yyyy')?.toString()).toBe('2026-10-05');
    expect(parseDate('2026-10-05', 'yyyy-MM-dd')?.toString()).toBe('2026-10-05');
    expect(parseDate('5/1/99', 'dd/MM/yy')?.toString()).toBe('2099-01-05');
    expect(parseDate('29/02/24', 'dd/MM/yy')?.toString()).toBe('2024-02-29');
  });
});

describe('normalizeDescription', () => {
  it('[TC-IMPORTS-CSV-026] elimina controles, colapsa espacios y trunca a 500 con advertencia', () => {
    const raw = `COMPRA\t\tTIENDA   ${'X'.repeat(620)}`;
    const r = normalizeDescription(raw);
    expect(r.truncated).toBe(true);
    expect(Array.from(r.text as string)).toHaveLength(500);
    expect(r.text).not.toMatch(/\t| {2}/);
    expect(r.text?.startsWith('COMPRA TIENDA X')).toBe(true);
  });

  it('guarda la fórmula literal (sin interpretarla ni escaparla)', () => {
    const formula = '=HYPERLINK("http://example.test","clic")';
    expect(normalizeDescription(formula)).toEqual({ text: formula, truncated: false });
  });

  it('quita controles C0/C1 y bidireccionales; una descripción vacía es nula', () => {
    expect(normalizeDescription('A\u0007B\u202eC\u200bD').text).toBe('ABCD');
    expect(normalizeDescription(' \t\r\n ')).toEqual({ text: null, truncated: false });
  });

  it('cuenta caracteres Unicode, no unidades UTF-16', () => {
    const r = normalizeDescription('😀'.repeat(501));
    expect(r.truncated).toBe(true);
    expect(Array.from(r.text as string)).toHaveLength(500);
  });
});

describe('normalizeRow', () => {
  it('[TC-IMPORTS-CSV-006] monto con signo: salidas y entradas con signo canónico', () => {
    const rows = [
      record(2, '01/10/2026', 'COMPRA SUPERMERCADO', '-245,30'),
      record(3, '02/10/2026', 'PAGO QR CAFÉ', '-18,00'),
      record(5, '05/10/2026', 'ABONO SUELDO', '8.000,00'),
    ].map((r) => normalizeRow(r, SIGNED, BOB));
    expect(rows.map((r) => [r.direction, r.amount, r.signedAmount])).toEqual([
      ['OUT', '245.30', '-245.30'],
      ['OUT', '18.00', '-18.00'],
      ['IN', '8000.00', '8000.00'],
    ]);
    expect(rows.every((r) => r.issues.length === 0)).toBe(true);
    expect(rows[0]?.bookingDate).toBe('2026-10-01');
  });

  it('[TC-IMPORTS-CSV-008] positivo es salida: el cargo de tarjeta 120,00 es una salida de 120.00', () => {
    const mapping: CsvMapping = {
      ...SIGNED,
      columns: {
        ...SIGNED.columns,
        amount: { mode: 'SIGNED', index: 2, signConvention: 'POSITIVE_IS_OUTFLOW' },
      },
    };
    const row = normalizeRow(record(2, '03/10/2026', 'CARGO', '120,00'), mapping, BOB);
    expect([row.direction, row.amount, row.signedAmount]).toEqual(['OUT', '120.00', '-120.00']);
    const refund = normalizeRow(record(3, '03/10/2026', 'ABONO', '-30,00'), mapping, BOB);
    expect([refund.direction, refund.signedAmount]).toEqual(['IN', '30.00']);
  });

  const DEBIT_CREDIT: CsvMapping = {
    ...SIGNED,
    columns: {
      date: { index: 0 },
      description: { index: 1 },
      amount: { mode: 'DEBIT_CREDIT', debitIndex: 2, creditIndex: 3 },
    },
  };

  it('[TC-IMPORTS-CSV-007] débito/crédito: una columna con valor es salida/entrada; ambas es inválida', () => {
    const debit = normalizeRow(record(3, '03/10/2026', 'COMPRA', '245,30', ''), DEBIT_CREDIT, BOB);
    expect([debit.direction, debit.amount, debit.issues]).toEqual(['OUT', '245.30', []]);
    const credit = normalizeRow(record(4, '03/10/2026', 'ABONO', '', '10,00'), DEBIT_CREDIT, BOB);
    expect([credit.direction, credit.amount]).toEqual(['IN', '10.00']);
    const both = normalizeRow(record(5, '03/10/2026', 'RARO', '5,00', '7,00'), DEBIT_CREDIT, BOB);
    expect(both.issues).toEqual([{ code: 'IMPORT_INVALID_AMOUNT', severity: 'ERROR' }]);
    expect(both.amount).toBeNull();
    const neither = normalizeRow(record(6, '03/10/2026', 'VACIO', '', ''), DEBIT_CREDIT, BOB);
    expect(neither.issues.map((i) => i.code)).toEqual(['IMPORT_INVALID_AMOUNT']);
  });

  it('[TC-IMPORTS-CSV-007] débito con valor y crédito en cero sigue siendo una salida', () => {
    const row = normalizeRow(record(3, '03/10/2026', 'COMPRA', '245,30', '0,00'), DEBIT_CREDIT, BOB);
    expect([row.direction, row.amount]).toEqual(['OUT', '245.30']);
  });

  it('[TC-IMPORTS-CSV-011] exceso de escala nunca se redondea: 1.234 con punto decimal en BOB es inválido', () => {
    const mapping: CsvMapping = { ...SIGNED, decimalSeparator: '.' };
    const row = normalizeRow(record(2, '03/10/2026', 'X', '1.234'), mapping, BOB);
    expect(row.issues).toEqual([{ code: 'IMPORT_INVALID_AMOUNT', severity: 'ERROR' }]);
    expect(row.amount).toBeNull();
    // Los ceros finales no son significativos: 1.230 es exactamente 1.23.
    const exact = normalizeRow(record(3, '03/10/2026', 'X', '1.230'), mapping, BOB);
    expect(exact.amount).toBe('1.23');
  });

  it('[TC-IMPORTS-CSV-012] fecha inexistente: IMPORT_INVALID_DATE con su número de línea', () => {
    const row = normalizeRow(record(6, '31/02/2026', 'X', '-1,00'), SIGNED, BOB);
    expect(row.lineNumber).toBe(6);
    expect(row.bookingDate).toBeNull();
    expect(row.issues).toEqual([{ code: 'IMPORT_INVALID_DATE', severity: 'ERROR' }]);
  });

  it('un monto cero se normaliza sin dirección (lo rechaza el validador) y celdas ausentes son inválidas', () => {
    const zero = normalizeRow(record(2, '10/10/2026', 'X', '0,00'), SIGNED, BOB);
    expect([zero.amount, zero.direction, zero.signedAmount, zero.issues]).toEqual(['0.00', null, null, []]);
    const short = normalizeRow(record(3, '10/10/2026'), SIGNED, BOB);
    expect(short.issues.map((i) => i.code)).toEqual(['IMPORT_INVALID_AMOUNT']);
  });

  it('una descripción larga agrega la advertencia sin invalidar la fila', () => {
    const row = normalizeRow(record(2, '10/10/2026', 'Z'.repeat(620), '-5,00'), SIGNED, BOB);
    expect(row.issues).toEqual([{ code: 'IMPORT_DESCRIPTION_TRUNCATED', severity: 'WARNING' }]);
    expect(row.amount).toBe('5.00');
  });

  it('escala 0 y escala 6: la escala la fija la moneda de la cuenta', () => {
    const jpy = normalizeRow(record(2, '10/10/2026', 'X', '-1.500'), SIGNED, currency('JPY', 0));
    expect(jpy.amount).toBe('1500');
    const usdt = normalizeRow(record(3, '10/10/2026', 'X', '-0,123456'), SIGNED, currency('USDT', 6));
    expect(usdt.amount).toBe('0.123456');
  });
});
