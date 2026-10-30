import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CsvRecord } from './csv-sniffer.js';
import { parseProfileMapping, type ProfileMapping } from './profile-options.js';
import {
  cleanDescriptionPrefix,
  inferDecimalSeparator,
  normalizeStatementRow,
  parseTime,
  selectDataRecords,
} from './statement-normalizer.js';

const CTX = { currencyCode: 'BOB', scale: 2 } as const;

const rec = (line: number, ...cells: string[]): CsvRecord => ({ line, cells });

/** Fecha;Descripción;Glosa;Nro. Doc.;Importe;D/C;Moneda;Saldo (extracto sintético del perfil de banco). */
const bankMapping = (over: Record<string, unknown> = {}): ProfileMapping =>
  parseProfileMapping(
    {
      hasHeader: true,
      skipRows: 1,
      skipFooterRows: 2,
      dateFormat: 'dd/MM/yyyy',
      decimalSeparator: ',',
      columns: {
        date: { index: 0 },
        description: { indexes: [1, 2] },
        reference: { index: 3, unique: false },
        amount: { mode: 'INDICATOR', index: 4, indicator: { index: 5 } },
        currency: { index: 6 },
        runningBalance: { index: 7 },
      },
      ...over,
    },
    8,
  );

describe('normalizador de extractos con perfil', () => {
  it('[TC-IMPORTS-PIPELINE-032] las filas de pie declaradas no aparecen como filas ni como inválidas', () => {
    const records = [
      rec(1, 'Reporte SINTETICO'),
      rec(2, 'Fecha', 'Descripción', 'Glosa', 'Nro. Doc.', 'Importe', 'D/C', 'Moneda', 'Saldo'),
      rec(3, '01/10/2026', 'PAGO QR', 'CAFÉ', '1', '245,30', 'D', 'Bs.', '754,70'),
      rec(4, '02/10/2026', 'ABONO', 'SUELDO', '2', '1.000,00', 'C', 'Bs.', '1.754,70'),
      rec(5, 'Total débitos', '', '', '', '245,30', '', '', ''),
      rec(6, 'Saldo final', '', '', '', '1.754,70', '', '', ''),
    ];
    const data = selectDataRecords(records, bankMapping());
    expect(data.map((r) => r.line)).toEqual([3, 4]);
    for (const r of data) expect(normalizeStatementRow(r, bankMapping(), CTX).issues).toEqual([]);
  });

  it('[TC-IMPORTS-PIPELINE-033] el indicador D/C convierte "245,30" con "D" en una salida de 245.30', () => {
    const out = normalizeStatementRow(
      rec(3, '01/10/2026', 'PAGO', 'QR', '1', '245,30', 'D', 'Bs.', ''),
      bankMapping(),
      CTX,
    );
    expect(out.amount).toBe('-245.30');
    const credit = normalizeStatementRow(
      rec(4, '01/10/2026', 'ABONO', '', '2', '245,30', 'c', 'Bs.', ''),
      bankMapping(),
      CTX,
    );
    expect(credit.amount).toBe('245.30');
  });

  it('[TC-IMPORTS-PIPELINE-033] un indicador desconocido invalida la fila', () => {
    const out = normalizeStatementRow(
      rec(3, '01/10/2026', 'X', '', '', '10,00', 'Z', 'Bs.', ''),
      bankMapping(),
      CTX,
    );
    expect(out.amount).toBeNull();
    expect(out.issues).toContainEqual({ code: 'IMPORT_INVALID_AMOUNT', severity: 'ERROR' });
  });

  it('[TC-IMPORTS-PIPELINE-034] la descripción se forma uniendo las columnas del perfil', () => {
    const out = normalizeStatementRow(
      rec(3, '01/10/2026', 'PAGO QR', 'CAFÉ CENTRAL', '1', '10,00', 'D', 'Bs.', ''),
      bankMapping(),
      CTX,
    );
    expect(out.description).toBe('PAGO QR CAFÉ CENTRAL');
  });

  it('[TC-IMPORTS-PIPELINE-035] "Bs." es BOB y "$us" invalida la fila por moneda', () => {
    const bs = normalizeStatementRow(
      rec(3, '01/10/2026', 'A', '', '', '10,00', 'D', 'Bs.', ''),
      bankMapping(),
      CTX,
    );
    const usd = normalizeStatementRow(
      rec(4, '01/10/2026', 'B', '', '', '10,00', 'D', '$us', ''),
      bankMapping(),
      CTX,
    );
    expect(bs.currency).toBe('BOB');
    expect(bs.issues).toEqual([]);
    expect(usd.currency).toBe('USD');
    expect(usd.issues).toContainEqual({ code: 'IMPORT_CURRENCY_MISMATCH', severity: 'ERROR' });
  });

  it('[TC-IMPORTS-PIPELINE-035] el perfil puede agregar alias de moneda', () => {
    const mapping = bankMapping({
      columns: {
        date: { index: 0 },
        description: { index: 1 },
        amount: { mode: 'INDICATOR', index: 4, indicator: { index: 5 } },
        currency: { index: 6, aliases: { bolivianos: 'BOB' } },
      },
    });
    const out = normalizeStatementRow(
      rec(3, '01/10/2026', 'A', '', '', '10,00', 'D', 'Bolivianos', ''),
      mapping,
      CTX,
    );
    expect(out.issues).toEqual([]);
  });

  it('[TC-IMPORTS-PIPELINE-053] una referencia declarada no única no es identificador externo', () => {
    const shared = '88231';
    const interest = normalizeStatementRow(
      rec(3, '03/10/2026', 'INTERES', '', shared, '12,40', 'C', 'Bs.', ''),
      bankMapping(),
      CTX,
    );
    const retention = normalizeStatementRow(
      rec(4, '03/10/2026', 'RETENCION', '', shared, '1,60', 'D', 'Bs.', ''),
      bankMapping(),
      CTX,
    );
    expect([interest.externalId, retention.externalId]).toEqual([null, null]);
    expect([interest.reference, retention.reference]).toEqual([shared, shared]);
    expect([interest.amount, retention.amount]).toEqual(['12.40', '-1.60']);
  });

  it('una referencia única sí es identificador externo', () => {
    const mapping = bankMapping({
      columns: {
        date: { index: 0 },
        description: { index: 1 },
        reference: { index: 3, unique: true },
        amount: { mode: 'SIGNED', index: 4, signConvention: 'NEGATIVE_IS_OUTFLOW' },
      },
    });
    const out = normalizeStatementRow(
      rec(3, '03/10/2026', 'X', '', 'AB-1', '-5,00', '', '', ''),
      mapping,
      CTX,
    );
    expect(out.externalId).toBe('AB-1');
    expect(out.reference).toBeNull();
  });

  it('lee la hora, la fecha valor y el saldo corrido', () => {
    const mapping = bankMapping({
      columns: {
        date: { index: 0 },
        description: { index: 1 },
        amount: { mode: 'SIGNED', index: 4, signConvention: 'NEGATIVE_IS_OUTFLOW' },
        time: { index: 2, format: 'HH:mm' },
        valueDate: { index: 3 },
        runningBalance: { index: 7 },
      },
    });
    const out = normalizeStatementRow(
      rec(3, '03/10/2026', 'X', '9:05', '04/10/2026', '-5,00', '', '', '1.754,70'),
      mapping,
      CTX,
    );
    expect(out.time).toBe('09:05:00');
    expect(out.valueDate).toBe('2026-10-04');
    expect(out.runningBalance).toBe('1754.70');
    expect(parseTime('25:00', 'HH:mm')).toBeNull();
  });

  it('un monto con más decimales que la escala invalida la fila y no se redondea', () => {
    const out = normalizeStatementRow(
      rec(3, '01/10/2026', 'X', '', '', '10,005', 'D', 'Bs.', ''),
      bankMapping(),
      CTX,
    );
    expect(out.amount).toBeNull();
    expect(out.issues).toContainEqual({ code: 'IMPORT_INVALID_AMOUNT', severity: 'ERROR' });
  });

  it('el monto cero se informa como 0.00 para que lo rechace el validador', () => {
    const out = normalizeStatementRow(
      rec(3, '01/10/2026', 'X', '', '', '0,00', 'D', 'Bs.', ''),
      bankMapping(),
      CTX,
    );
    expect(out.amount).toBe('0.00');
  });

  it('limpia prefijos literales de la descripción sin interpretarlos como expresiones regulares', () => {
    expect(cleanDescriptionPrefix('COMPRA TIENDA', ['COMPRA '])).toBe('TIENDA');
    expect(cleanDescriptionPrefix('(a+)+b rest', ['(a+)+b'])).toBe('rest');
    expect(cleanDescriptionPrefix('OTRA COSA', ['COMPRA '])).toBe('OTRA COSA');
    const mapping = bankMapping({
      descriptionCleanup: ['PAGO '],
      columns: {
        date: { index: 0 },
        description: { index: 1 },
        amount: { mode: 'SIGNED', index: 4, signConvention: 'NEGATIVE_IS_OUTFLOW' },
      },
    });
    expect(
      normalizeStatementRow(rec(3, '01/10/2026', 'PAGO LUZ', '', '', '-5,00', '', '', ''), mapping, CTX)
        .description,
    ).toBe('LUZ');
  });

  it('un número ambiguo sin separador elegido da IMPORT_AMBIGUOUS_NUMBER; con otro monto se infiere', () => {
    const free = (over: Record<string, unknown> = {}) =>
      bankMapping({
        decimalSeparator: undefined,
        columns: {
          date: { index: 0 },
          description: { index: 1 },
          amount: { mode: 'SIGNED', index: 4, signConvention: 'NEGATIVE_IS_OUTFLOW' },
        },
        ...over,
      });
    const ambiguous = normalizeStatementRow(
      rec(3, '01/10/2026', 'X', '', '', '-1.234', '', '', ''),
      free(),
      CTX,
    );
    expect(ambiguous.issues).toContainEqual({ code: 'IMPORT_AMBIGUOUS_NUMBER', severity: 'ERROR' });
    const inferred = normalizeStatementRow(
      rec(4, '01/10/2026', 'X', '', '', '-1.234,50', '', '', ''),
      free(),
      CTX,
    );
    expect(inferred.amount).toBe('-1234.50');
    expect(inferDecimalSeparator('12,5')).toEqual({ kind: 'OK', separator: ',' });
    expect(inferDecimalSeparator('1,234,567')).toEqual({ kind: 'OK', separator: '.' });
    expect(inferDecimalSeparator('0,125')).toEqual({ kind: 'OK', separator: ',' });
  });

  it('débito/crédito en dos columnas y mapeo CSV básico siguen funcionando', () => {
    const mapping = parseProfileMapping(
      {
        hasHeader: true,
        dateFormat: 'dd/MM/yyyy',
        decimalSeparator: ',',
        columns: {
          date: { index: 0 },
          description: { index: 1 },
          amount: { mode: 'DEBIT_CREDIT', debitIndex: 2, creditIndex: 3 },
        },
      },
      4,
    );
    expect(normalizeStatementRow(rec(2, '01/10/2026', 'A', '10,00', ''), mapping, CTX).amount).toBe('-10.00');
    expect(normalizeStatementRow(rec(3, '01/10/2026', 'B', '', '7,5'), mapping, CTX).amount).toBe('7.50');
    expect(normalizeStatementRow(rec(4, '01/10/2026', 'C', '1', '2'), mapping, CTX).amount).toBeNull();
  });
});

describe('montos del normalizador (propiedad)', () => {
  const format = (units: bigint, thousands: string, decimal: string, scale: number): string => {
    const digits = units.toString().padStart(scale + 1, '0');
    const int = digits.slice(0, digits.length - scale);
    const frac = digits.slice(digits.length - scale);
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
    return scale === 0 ? grouped : `${grouped}${decimal}${frac}`;
  };

  it('[TC-IMPORTS-PIPELINE-032] parse(format(m)) == m para cualquier monto y estilo de separadores, sin number', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 16n }),
        fc.boolean(),
        fc.constantFrom<[string, string]>([',', '.'], ['.', ','], ['', ','], ['', '.']),
        (units, negative, [thousands, decimal]) => {
          const mapping = parseProfileMapping(
            {
              hasHeader: false,
              dateFormat: 'yyyy-MM-dd',
              decimalSeparator: decimal,
              columns: {
                date: { index: 0 },
                description: { index: 1 },
                amount: { mode: 'SIGNED', index: 2, signConvention: 'NEGATIVE_IS_OUTFLOW' },
              },
            },
            3,
          );
          const text = `${negative ? '-' : ''}${format(units, thousands, decimal, 2)}`;
          const out = normalizeStatementRow(rec(1, '2026-01-01', 'X', text), mapping, CTX);
          const canonical = `${negative ? '-' : ''}${format(units, '', '.', 2)}`;
          expect(out.amount).toBe(canonical);
        },
      ),
      { numRuns: 300 },
    );
  }, 30_000);
});
