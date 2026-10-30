import { describe, expect, it } from 'vitest';
import { parseProfileMapping } from '../../domain/profile-options.js';
import { normalizeStatementRow, selectDataRecords } from '../../domain/statement-normalizer.js';
import { sniffStatementFormat } from '../../domain/statement-sniffer.js';
import { shortestDecimal, readXlsxTable } from './xlsx-reader.js';
import { buildXlsx, zip, type SyntheticCell } from './xlsx-builder.test-support.js';

const text = (value: string): SyntheticCell => ({ kind: 'text', value });
const num = (value: string): SyntheticCell => ({ kind: 'number', value });
const LIMITS = { maxRows: 5000, maxColumns: 50 };
const CTX = { currencyCode: 'BOB', scale: 2 } as const;

const mapping = parseProfileMapping(
  {
    hasHeader: true,
    dateFormat: 'yyyy-MM-dd',
    decimalSeparator: '.',
    columns: {
      date: { index: 0 },
      description: { index: 1 },
      amount: { mode: 'SIGNED', index: 2, signConvention: 'NEGATIVE_IS_OUTFLOW' },
    },
  },
  3,
);

const amountOf = (cell: SyntheticCell) => {
  const book = buildXlsx('Movimientos', [
    [text('Fecha'), text('Descripción'), text('Monto')],
    [{ kind: 'date', serial: '46082' }, text('COMPRA SINTETICA'), cell],
  ]);
  const read = readXlsxTable(book, { sheet: 'Movimientos', ...LIMITS });
  if (!read.ok) throw new Error('lectura');
  const row = selectDataRecords(read.records, mapping)[0]!;
  return normalizeStatementRow(row, mapping, CTX);
};

describe('lector XLSX (Could)', () => {
  it('[TC-IMPORTS-PIPELINE-022] la celda numérica 1234.5 de la hoja "Movimientos" se lee como 1234.50 BOB', () => {
    const out = amountOf(num('1234.5'));
    expect(out.amount).toBe('1234.50');
    expect(out.bookingDate).toBe('2026-03-01');
    expect(out.description).toBe('COMPRA SINTETICA');
  });

  it('[TC-IMPORTS-PIPELINE-023] una fórmula se lee por su valor guardado -60 y no se evalúa', () => {
    const out = amountOf({ kind: 'formula', formula: 'SUM(A1:A9)*1000', cached: '-60' });
    expect(out.amount).toBe('-60.00');
    // El texto de la fórmula nunca llega a ninguna celda leída.
    const book = buildXlsx('Hoja', [[{ kind: 'formula', formula: 'HYPERLINK("http://x")', cached: '-60' }]]);
    const read = readXlsxTable(book, LIMITS);
    expect(read.ok && read.records[0]?.cells).toEqual(['-60']);
  });

  it('[TC-IMPORTS-PIPELINE-024] 0.30000000000000004 excede la escala: la fila es inválida y no se vuelve 0.30', () => {
    const out = amountOf(num('0.30000000000000004'));
    expect(out.amount).toBeNull();
    expect(out.issues).toContainEqual({ code: 'IMPORT_INVALID_AMOUNT', severity: 'ERROR' });
  });

  it('representa el decimal más corto sin notación científica', () => {
    expect(shortestDecimal('1234.5')).toBe('1234.5');
    expect(shortestDecimal('1E+21')).toBe('1000000000000000000000');
    expect(shortestDecimal('1.5E-7')).toBe('0.00000015');
    expect(shortestDecimal('-0.1')).toBe('-0.1');
    expect(shortestDecimal('abc')).toBeNull();
  });

  it('elige la hoja del perfil; una hoja inexistente o un ZIP inválido fallan la lectura', () => {
    const book = buildXlsx('Movimientos', [[text('a')]]);
    expect(readXlsxTable(book, { sheet: 'Otra', ...LIMITS })).toEqual({
      ok: false,
      failure: { code: 'IMPORT_PARSE_FAILED', pointer: 'sheet' },
    });
    expect(readXlsxTable(new TextEncoder().encode('no es zip'), LIMITS).ok).toBe(false);
  });

  it('rechaza DOCTYPE y corta por filas y columnas', () => {
    const evil = zip({
      'xl/workbook.xml':
        '<!DOCTYPE x [<!ENTITY a "b">]><workbook><sheets><sheet name="S" r:id="rId1"/></sheets></workbook>',
    });
    expect(readXlsxTable(evil, LIMITS)).toEqual({
      ok: false,
      failure: { code: 'IMPORT_PARSE_FAILED', pointer: 'dtd' },
    });
    const rows = Array.from({ length: 4 }, (_, i) => [text(`f${i}`)]);
    const tooMany = readXlsxTable(buildXlsx('S', rows), { maxRows: 2, maxColumns: 50 });
    expect(tooMany).toEqual({ ok: false, failure: { code: 'IMPORT_TOO_MANY_ROWS', pointer: null } });
    const wide = readXlsxTable(buildXlsx('S', [Array.from({ length: 3 }, () => text('x'))]), {
      maxRows: 10,
      maxColumns: 2,
    });
    expect(wide).toEqual({ ok: false, failure: { code: 'IMPORT_UNSUPPORTED_FORMAT', pointer: null } });
  });

  it('[TC-IMPORTS-PIPELINE-011] el detector reconoce un libro XLSX por su contenido', () => {
    const book = buildXlsx('S', [[text('a')]]);
    expect(sniffStatementFormat(book)?.format).toBe('XLSX');
  });
});
