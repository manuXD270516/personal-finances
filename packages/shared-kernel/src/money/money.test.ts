import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { currency } from './currency.js';
import { Money } from './money.js';

const BOB = currency('BOB', 2);
const USDT = currency('USDT', 6);

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    return err instanceof DomainError ? err.code : `no-domain:${String(err)}`;
  }
  return undefined;
};

describe('Money en el borde HTTP (platform/api-conventions)', () => {
  it('[TC-PLATFORM-API-017] 1500 BOB se serializa con la escala canónica "1500.00"', () => {
    expect(Money.parse('1500', BOB).toJSON()).toEqual({ amount: '1500.00', currency: 'BOB' });
    expect(Money.parse('1500', 'BOB', 2).toFixed()).toBe('1500.00');
  });

  it('[TC-PLATFORM-API-017] 100.000000 USDT y 685.00 BOB se preservan como strings con su escala', () => {
    const usdt = Money.parse('100.000000', USDT);
    const bob = Money.parse('685.00', BOB);
    expect(JSON.parse(JSON.stringify({ from: usdt, to: bob }))).toEqual({
      from: { amount: '100.000000', currency: 'USDT' },
      to: { amount: '685.00', currency: 'BOB' },
    });
    expect(typeof usdt.toJSON().amount).toBe('string');
  });

  it('[TC-PLATFORM-API-017] un monto que no es string decimal se rechaza (nunca number ni exponente)', () => {
    for (const bad of ['75,5', '1e3', ' 75', '75.', '.5', '+1', '0x10', 'NaN', '', '01.00']) {
      expect(
        codeOf(() => Money.parse(bad, BOB)),
        bad,
      ).toBe('MONEY_INVALID_AMOUNT');
    }
    expect(codeOf(() => Money.parse(75.5 as unknown as string, BOB))).toBe('MONEY_INVALID_AMOUNT');
  });

  it('[TC-PLATFORM-API-018] 685.005 BOB y 100.0000001 USDT se rechazan con AMOUNT_SCALE_EXCEEDED sin redondear', () => {
    expect(codeOf(() => Money.parse('685.005', BOB))).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(codeOf(() => Money.parse('100.0000001', USDT))).toBe('AMOUNT_SCALE_EXCEEDED');
    expect(codeOf(() => Money.parse('-0.001', BOB))).toBe('AMOUNT_SCALE_EXCEEDED');
  });

  it('[TC-PLATFORM-API-018] los ceros finales no son decimales significativos (NUMERIC(38,18) de PostgreSQL)', () => {
    expect(Money.parse('685.000000000000000000', BOB).toFixed()).toBe('685.00');
  });

  it('rechaza montos fuera de NUMERIC(38,18) y códigos/escala de moneda inválidos', () => {
    expect(codeOf(() => Money.parse('100000000000000000000', BOB))).toBe('AMOUNT_OUT_OF_RANGE');
    expect(Money.parse('99999999999999999999.99', BOB).toFixed()).toBe('99999999999999999999.99');
    expect(codeOf(() => Money.parse('1', 'bob', 2))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => Money.parse('1', 'BOB', 19))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => Money.parse('1', 'BOB', 1.5))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => Money.parse('1', 'BOB', -1))).toBe('VALIDATION_FAILED');
  });

  it('fromJson resuelve la escala con el catálogo; -0 se normaliza a 0; igualdad por moneda y valor', () => {
    const scaleOf = (code: string) => (code === 'USDT' ? 6 : 2);
    const m = Money.fromJson({ amount: '-0.00', currency: 'BOB' }, scaleOf);
    expect(m.toFixed()).toBe('0.00');
    expect(m.isZero()).toBe(true);
    expect(m.isNegative()).toBe(false);
    expect(m.isPositive()).toBe(false);
    expect(Money.fromJson({ amount: '1', currency: 'USDT' }, scaleOf).toFixed()).toBe('1.000000');
    expect(Money.parse('1.5', BOB).equals(Money.parse('1.50', BOB))).toBe(true);
    expect(Money.parse('1.5', BOB).equals(Money.parse('1.5', currency('USD', 2)))).toBe(false);
    expect(Money.parse('1.5', BOB).equals(Money.parse('1.51', BOB))).toBe(false);
    expect(Money.parse('-2', BOB).isNegative()).toBe(true);
    expect(Money.parse('2', BOB).isPositive()).toBe(true);
    expect(Money.zero(USDT).toString()).toBe('0.000000 USDT');
  });

  describe('propiedades (fast-check)', () => {
    const scale = fc.integer({ min: 0, max: 18 });
    const digits = (min: number, max: number) =>
      fc.array(fc.integer({ min: 0, max: 9 }), { minLength: min, maxLength: max }).map((d) => d.join(''));
    const intPart = fc.oneof(
      fc.constant('0'),
      fc.tuple(fc.integer({ min: 1, max: 9 }), digits(0, 19)).map(([h, t]) => `${h}${t}`),
    );

    it('[TC-PLATFORM-API-017] round-trip string ↔ Decimal sin pérdida en la escala canónica', () => {
      fc.assert(
        fc.property(scale, intPart, fc.boolean(), (s, int, negative) =>
          fc.assert(
            fc.property(digits(0, s), (frac) => {
              const raw = `${negative ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
              const m = Money.parse(raw, currency('XTS', s));
              const fixed = m.toFixed();
              // Exacta: mismo valor decimal, con exactamente `s` decimales, y re-parseable a lo mismo.
              expect(m.amount.eq(raw)).toBe(true);
              expect(fixed.split('.')[1]?.length ?? 0).toBe(s);
              expect(Money.parse(fixed, currency('XTS', s)).equals(m)).toBe(true);
            }),
            { numRuns: 5 },
          ),
        ),
        { numRuns: 200 },
      );
    });

    it('[TC-PLATFORM-API-018] más decimales significativos que la escala ⇒ siempre AMOUNT_SCALE_EXCEEDED', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 17 }),
          intPart,
          fc.integer({ min: 1, max: 9 }),
          (s, int, last) => {
            const frac = `${'0'.repeat(s)}${last}`; // s + 1 decimales, el último distinto de 0
            expect(codeOf(() => Money.parse(`${int}.${frac}`, currency('XTS', s)))).toBe(
              'AMOUNT_SCALE_EXCEEDED',
            );
          },
        ),
        { numRuns: 300 },
      );
    });
  });
});
