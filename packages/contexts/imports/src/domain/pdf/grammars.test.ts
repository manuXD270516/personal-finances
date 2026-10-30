import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseLongDate, parseMonthYear, parsePdfDate, parsePdfTime } from './date-grammar.js';
import { stripWildcardLiteral } from './literals.js';
import { formatPdfNumber, parsePdfNumber, type PdfNumberFormat } from './number-grammar.js';
import { spanishMonth } from './spanish-months.js';

const FORMATS: readonly PdfNumberFormat[] = [
  { decimal: '.', thousands: null },
  { decimal: '.', thousands: ',' },
  { decimal: ',', thousands: '.' },
  { decimal: ',', thousands: null },
];

describe('PdfNumberGrammar', () => {
  it('[TC-IMPORTS-PDF-026] un crédito con miles con coma se lee como decimal exacto', () => {
    const r = parsePdfNumber('10,500.75', { decimal: '.', thousands: ',' }, 2);
    expect(r).toEqual({ kind: 'OK', value: '10500.75', exact: '10500.75' });
    expect(parsePdfNumber('-1,200.50', { decimal: '.', thousands: ',' }, 2)).toMatchObject({
      kind: 'OK',
      value: '-1200.50',
    });
  });

  it('[TC-IMPORTS-PDF-027] un diseño con coma decimal y punto de miles lee el monto exacto', () => {
    const format: PdfNumberFormat = { decimal: ',', thousands: '.' };
    expect(parsePdfNumber('1.325,00', format, 2)).toMatchObject({ kind: 'OK', value: '1325.00' });
    expect(parsePdfNumber('-85,5', format, 2)).toMatchObject({ kind: 'OK', value: '-85.50' });
    // Con los separadores del otro diseño el número es ambiguo, nunca se adivina.
    expect(parsePdfNumber('1325.00', format, 2)).toEqual({ kind: 'AMBIGUOUS' });
    expect(parsePdfNumber('1,325.00', { decimal: '.', thousands: null }, 2)).toEqual({ kind: 'INVALID' });
    expect(parsePdfNumber('1250,00', { decimal: '.', thousands: null }, 2)).toEqual({ kind: 'AMBIGUOUS' });
  });

  it('[TC-IMPORTS-PDF-028] un monto con más decimales que la escala no se redondea', () => {
    expect(parsePdfNumber('-12.345', { decimal: '.', thousands: null }, 2)).toEqual({
      kind: 'SCALE',
      exact: '-12.345',
    });
    // Ceros sobrantes no cambian el valor.
    expect(parsePdfNumber('12.340', { decimal: '.', thousands: null }, 2)).toMatchObject({
      kind: 'OK',
      value: '12.34',
    });
  });

  it('rechaza agrupaciones de miles inválidas, vacíos y basura', () => {
    const f: PdfNumberFormat = { decimal: '.', thousands: ',' };
    for (const bad of [
      '',
      '-',
      '1,2.00',
      '12,34.00',
      '1,2345.00',
      '1.2.3',
      'abc',
      '1e5',
      '1 000.00',
      '.50',
      '12.',
    ]) {
      expect(parsePdfNumber(bad, f, 2).kind).not.toBe('OK');
    }
  });

  it('[TC-IMPORTS-PDF-031] todo monto generado y escrito con los separadores de un diseño se lee igual', () => {
    const amount = fc
      .tuple(fc.boolean(), fc.bigInt({ min: 0n, max: 99_999_999_999n }), fc.integer({ min: 0, max: 99 }))
      .map(([neg, int, frac]) => {
        const text = `${int}.${String(frac).padStart(2, '0')}`;
        return neg && (int !== 0n || frac !== 0) ? `-${text}` : text;
      });
    fc.assert(
      fc.property(amount, fc.constantFrom(...FORMATS), (value, format) => {
        const printed = formatPdfNumber(value, format, 2);
        const parsed = parsePdfNumber(printed, format, 2);
        return parsed.kind === 'OK' && parsed.value === value;
      }),
      { numRuns: 1000 },
    );
  }, 60_000);
});

describe('PdfDateGrammar y SpanishMonths', () => {
  it('lee los formatos del diseño y valida el calendario', () => {
    expect(parsePdfDate('20260301', 'YYYYMMDD')).toEqual({ kind: 'OK', iso: '2026-03-01' });
    expect(parsePdfDate('01/03/2026', 'DD/MM/YYYY')).toEqual({ kind: 'OK', iso: '2026-03-01' });
    expect(parsePdfDate('01-03-2026', 'DD-MM-YYYY')).toEqual({ kind: 'OK', iso: '2026-03-01' });
    expect(parsePdfDate('31/02/2026', 'DD/MM/YYYY')).toEqual({ kind: 'INVALID' });
    expect(parsePdfDate('29/02/2028', 'DD/MM/YYYY')).toEqual({ kind: 'OK', iso: '2028-02-29' });
    expect(parsePdfDate('-', 'DD/MM/YYYY')).toEqual({ kind: 'NOT_DATE' });
    expect(parsePdfDate('1250.00', 'YYYYMMDD')).toEqual({ kind: 'NOT_DATE' });
    expect(parsePdfTime('10:15:00', 'HH:mm:ss')).toBe('10:15:00');
    expect(parsePdfTime('08:50', 'HH:mm')).toBe('08:50:00');
    expect(parsePdfTime('24:00:00', 'HH:mm:ss')).toBeNull();
    expect(parsePdfTime('10:00:00 Hs.', 'HH:mm:ss')).toBe('10:00:00');
  });

  it('[TC-IMPORTS-PDF-030] la fecha compacta y el mes en español se leen igual con otro idioma y zona del sistema', () => {
    const read = () => ({
      compact: parsePdfDate('20260305', 'YYYYMMDD'),
      month: parseMonthYear('Marzo 2026'),
      long: parseLongDate('01 de marzo, 2026'),
      abbreviated: spanishMonth('Sep.'),
      accented: spanishMonth('SETIEMBRE'),
    });
    const before = read();
    const previous = process.env['TZ'];
    try {
      for (const tz of ['Pacific/Auckland', 'America/La_Paz', 'UTC', 'Asia/Tokyo']) {
        process.env['TZ'] = tz;
        expect(read()).toEqual(before);
      }
    } finally {
      if (previous === undefined) delete process.env['TZ'];
      else process.env['TZ'] = previous;
    }
    expect(before.month).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(before.long).toBe('2026-03-01');
    expect(before.compact).toEqual({ kind: 'OK', iso: '2026-03-05' });
    expect(spanishMonth('diciembre')).toBe(12);
    expect(spanishMonth('Inventado')).toBeNull();
    expect(parseMonthYear('Febrero 2028')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
});

describe('VolatileFragments', () => {
  it('quita el comodín numérico y los literales sin expresiones regulares', () => {
    expect(stripWildcardLiteral('Transferencia de 000. PERSONA Aún falta 350', 'Aún falta {n}')).toBe(
      'Transferencia de 000. PERSONA',
    );
    expect(stripWildcardLiteral('PERSONA Completado', 'Completado')).toBe('PERSONA');
    expect(stripWildcardLiteral('Aún falta', 'Aún falta {n}')).toBe('Aún falta');
    // Sin retroceso exponencial con entradas hostiles.
    const hostile = 'a'.repeat(200_000);
    const t0 = performance.now();
    expect(stripWildcardLiteral(hostile, 'a{n}b{n}c')).toBe(hostile);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
