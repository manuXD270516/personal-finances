import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canonicalDecimal } from './canonical-decimal.js';
import { dec } from './decimal.js';

// Forma canónica de los textos decimales de `numeric(38,18)` (INV-001): todo opera sobre texto, nunca sobre `number`.
describe('canonicalDecimal (shared-kernel)', () => {
  it.each([
    ['1.500000000000000000', '1.5'],
    ['10.000', '10'],
    ['100', '100'],
    ['0.10', '0.1'],
    ['0.000000000000000001', '0.000000000000000001'],
    ['-12.50', '-12.5'],
    ['7.', '7'],
    ['-7.', '-7'],
    ['0', '0'],
    ['0.0000', '0'],
  ])('%s se canoniza a %s', (input, expected) => {
    expect(canonicalDecimal(input)).toBe(expected);
  });

  it('-0 y los ceros negativos con fracción nula se normalizan a 0', () => {
    expect(canonicalDecimal('-0')).toBe('0');
    expect(canonicalDecimal('-0.000000000000000000')).toBe('0');
  });

  it('conserva los ceros de la parte entera (solo recorta la fracción)', () => {
    expect(canonicalDecimal('1000.5000')).toBe('1000.5');
    expect(canonicalDecimal('-1000.0000')).toBe('-1000');
  });

  it('PBT: preserva el valor exacto (Decimal), es idempotente y no deja ceros finales en la fracción', () => {
    const digits = (min: number, max: number) =>
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: min, maxLength: max }).map((ds) => ds.join(''));
    fc.assert(
      fc.property(
        fc.boolean(),
        digits(1, 20).map((d) => d.replace(/^0+(?=\d)/u, '')),
        fc.option(digits(0, 18), { nil: undefined }),
        (negative, whole, fraction) => {
          const text = `${negative ? '-' : ''}${whole}${fraction === undefined ? '' : `.${fraction}`}`;
          const out = canonicalDecimal(text);
          expect(dec(out).equals(dec(text))).toBe(true);
          expect(canonicalDecimal(out)).toBe(out);
          expect(out).not.toMatch(/\.$/u);
          expect(out).not.toMatch(/\.\d*0$/u);
          expect(out).not.toBe('-0');
        },
      ),
      { numRuns: 500 },
    );
  }, 30_000);
});
