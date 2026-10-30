import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { InvalidLinearRegexError, LinearRegex } from './linear-regex.js';
import { normalizeText } from './normalize.js';

describe('normalizeText', () => {
  it('[TC-RULES-ENGINE-005] ignora mayúsculas, acentos y espacios repetidos', () => {
    expect(normalizeText('PAGO QR  CAFÉ Alexander')).toBe('pago qr cafe alexander');
    expect(normalizeText('  Niño   ')).toBe('nino');
  });

  it('es idempotente', () => {
    fc.assert(
      fc.property(fc.string(), (s) => normalizeText(normalizeText(s)) === normalizeText(s)),
      {
        numRuns: 100,
      },
    );
  });
});

describe('LinearRegex', () => {
  it('[TC-RULES-ENGINE-010] rechaza referencias hacia atrás y lookaround', () => {
    expect(() => LinearRegex.compile(String.raw`(a+)\1`)).toThrow(InvalidLinearRegexError);
    expect(() => LinearRegex.compile('(?=a)b')).toThrow(InvalidLinearRegexError);
    expect(() => LinearRegex.compile('(?<!a)b')).toThrow(InvalidLinearRegexError);
    expect(() => LinearRegex.compile('[')).toThrow(InvalidLinearRegexError);
    expect(() => LinearRegex.compile('a'.repeat(201))).toThrow(InvalidLinearRegexError);
    expect(() => LinearRegex.compile('')).toThrow(InvalidLinearRegexError);
  });

  it('[TC-RULES-ENGINE-011] un patrón patológico termina en menos de 50 ms sin coincidencia', () => {
    const re = LinearRegex.compile('(a|aa)*b');
    // El mínimo de varias corridas descarta el calentamiento del JIT y la carga del runner sin relajar los 50 ms.
    let fastest = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 5; run += 1) {
      const started = performance.now();
      expect(re.test('a'.repeat(500))).toBe(false);
      fastest = Math.min(fastest, performance.now() - started);
    }
    expect(fastest).toBeLessThan(50);
  });

  it('ignora mayúsculas y solo mira los primeros 500 caracteres', () => {
    expect(LinearRegex.compile('^tigo.*recarga$').test('TIGO MONEY RECARGA')).toBe(true);
    expect(LinearRegex.compile('z').test(`${'a'.repeat(500)}z`)).toBe(false);
  });
});
