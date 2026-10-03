import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { currency, type Currency } from './currency.js';
import { dec, MoneyDecimal } from './decimal.js';
import { Money } from './money.js';
import { roundDecimal } from './rounding.js';

/** 100 corridas en cada PR; `NIGHTLY=1` → 10 000 (Financial Regression Suite, tarea 8.1). */
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const NUM_RUNS = env?.NIGHTLY ? 10_000 : 100;
const runs = { numRuns: NUM_RUNS };

const BOB = currency('BOB', 2);
const arbCurrency: fc.Arbitrary<Currency> = fc.constantFrom(
  BOB,
  currency('USD', 2),
  currency('JPY', 0),
  currency('USDT', 6),
  currency('BTC', 8),
  currency('ETH', 18),
);
const maxUnits = (c: Currency): bigint => 10n ** BigInt(20 + c.scale) - 1n;

const arbMoney = (c: Currency): fc.Arbitrary<Money> =>
  fc
    .oneof(
      fc.bigInt({ min: -maxUnits(c), max: maxUnits(c) }),
      fc.bigInt({ min: -(10n ** 6n), max: 10n ** 6n }),
    )
    .map((u) => Money.ofMinorUnits(u, c));
const arbMoneyAnyCurrency = arbCurrency.chain(arbMoney);

const arbDecimalString = (maxScale = 18): fc.Arbitrary<string> =>
  fc
    .integer({ min: 0, max: maxScale })
    .chain((scale) => {
      const max = 10n ** BigInt(20 + scale) - 1n;
      return fc.tuple(
        fc.oneof(fc.bigInt({ min: -max, max }), fc.bigInt({ min: -1000n, max: 1000n })),
        fc.constant(scale),
      );
    })
    .map(([units, scale]) => {
      const neg = units < 0n;
      const digits = (neg ? -units : units).toString().padStart(scale + 1, '0');
      const int = digits.slice(0, digits.length - scale).replace(/^0+(?=\d)/, '');
      const frac = scale ? `.${digits.slice(digits.length - scale)}` : '';
      return `${neg ? '-' : ''}${int}${frac}`;
    });

function canonical(s: string, scale: number): string {
  const neg = s.startsWith('-');
  const [int, frac = ''] = (neg ? s.slice(1) : s).split('.');
  const out = scale > 0 ? `${int}.${frac.padEnd(scale, '0').slice(0, scale)}` : int!;
  return `${neg && !/^[0.]+$/.test(out) ? '-' : ''}${out}`;
}

describe('Money — propiedades (fast-check)', () => {
  it('[TC-LEDGER-MONEY-002] ida y vuelta parse/format/NUMERIC/unidades menores sin pérdida (INV-001)', () => {
    fc.assert(
      fc.property(
        arbCurrency.chain((c) => fc.tuple(fc.constant(c), arbDecimalString(c.scale))),
        ([c, s]) => {
          const m = Money.parse(s, c);
          expect(m.toFixed()).toBe(canonical(s, c.scale));
          expect(Money.parse(m.toFixed(), c).equals(m)).toBe(true);
          expect(Money.parse(m.toNumeric(), c).equals(m)).toBe(true);
          expect(Money.ofMinorUnits(m.toMinorUnits(), c).equals(m)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS * 10 },
    );
  });

  it('[TC-LEDGER-MONEY-004] redondeo determinista, idempotente, simétrico y acotado (INV-020)', () => {
    fc.assert(
      fc.property(arbCurrency, arbDecimalString(18), (c, s) => {
        const x = dec(s);
        fc.pre(x.abs().lt(new MoneyDecimal(10).pow(20).minus(1)));
        const r = Money.roundToScale(x, c);
        expect(Money.roundToScale(r.amount, c).equals(r)).toBe(true);
        expect(r.amount.decimalPlaces()).toBeLessThanOrEqual(c.scale);
        const half = new MoneyDecimal(10).pow(-c.scale).div(2);
        expect(r.amount.minus(x).abs().lte(half)).toBe(true);
        expect(Money.roundToScale(x.neg(), c).equals(r.negate())).toBe(true);
        expect(Money.roundToScale(s, c).toFixed()).toBe(r.toFixed());
        expect(r.amount.eq(x.toDecimalPlaces(c.scale, MoneyDecimal.ROUND_HALF_EVEN))).toBe(true);
      }),
      runs,
    );
  });

  it('[TC-LEDGER-MONEY-004] HALF_EVEN no tiene sesgo (HALF_UP sí)', () => {
    let even = new MoneyDecimal(0);
    let up = new MoneyDecimal(0);
    for (let k = 0n; k < 100_000n; k++) {
      const x = dec(`${k / 1000n}.${(k % 1000n).toString().padStart(3, '0')}`);
      even = even.plus(roundDecimal(x, 2, 'HALF_EVEN').minus(x));
      up = up.plus(roundDecimal(x, 2, 'HALF_UP').minus(x));
    }
    expect(even.toFixed()).toBe('0');
    expect(up.toFixed()).toBe('50');
    // 100 000 redondeos exactos: en runners de CI supera el timeout por defecto de 5 s.
  }, 30_000);

  it('[TC-LEDGER-MONEY-006] allocate: Σ partes = total, error < 1 unidad, determinista, peso 0 → 0 (INV-021)', () => {
    const arbWeights = fc
      .array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 12 })
      .filter((ws) => ws.some((w) => w > 0));
    fc.assert(
      fc.property(arbMoneyAnyCurrency, arbWeights, (total, ws) => {
        const c = total.currency;
        const parts = total.allocate(ws);
        expect(parts).toHaveLength(ws.length);
        expect(Money.sum(parts, c).equals(total)).toBe(true);
        const sumW = ws.reduce((a, b) => a + b, 0);
        const unit = new MoneyDecimal(10).pow(-c.scale);
        parts.forEach((p, i) => {
          const exact = total.amount.times(ws[i]!).div(sumW);
          expect(p.amount.minus(exact).abs().lt(unit)).toBe(true);
          if (ws[i] === 0) expect(p.isZero()).toBe(true);
        });
        expect(total.allocate(ws).map((p) => p.toFixed())).toEqual(parts.map((p) => p.toFixed()));
        expect(
          total
            .negate()
            .allocate(ws)
            .map((p) => p.toFixed()),
        ).toEqual(parts.map((p) => p.negate().toFixed()));
      }),
      runs,
    );
  });

  it('[TC-LEDGER-MONEY-006] allocate(n): las partes difieren a lo sumo en 1 unidad menor, mayores primero', () => {
    fc.assert(
      fc.property(arbMoneyAnyCurrency, fc.integer({ min: 1, max: 50 }), (total, n) => {
        const parts = total.allocate(n);
        expect(Money.sum(parts, total.currency).equals(total)).toBe(true);
        const abs = parts.map((p) => {
          const u = p.toMinorUnits();
          return u < 0n ? -u : u;
        });
        for (let i = 1; i < abs.length; i++) {
          expect(abs[i]! <= abs[i - 1]!).toBe(true);
          expect(abs[0]! - abs[i]! <= 1n).toBe(true);
        }
      }),
      runs,
    );
  });

  it('[TC-LEDGER-MONEY-007] monedas distintas: add/subtract/compare lanzan CURRENCY_MISMATCH, equals es false', () => {
    fc.assert(
      fc.property(arbMoneyAnyCurrency, arbMoneyAnyCurrency, (a, b) => {
        fc.pre(a.currency.code !== b.currency.code);
        expect(() => a.add(b)).toThrow(/CURRENCY_MISMATCH|USD|BOB|JPY|USDT|BTC|ETH/);
        expect(() => a.subtract(b)).toThrow();
        expect(() => a.compare(b)).toThrow();
        expect(a.equals(b)).toBe(false);
      }),
      runs,
    );
  });

  it('[TC-LEDGER-MONEY-008] suma exacta, conmutativa, asociativa, con neutro e inversa (INV-002)', () => {
    fc.assert(
      fc.property(
        arbCurrency.chain((c) => fc.tuple(arbMoney(c), arbMoney(c), arbMoney(c))),
        ([a, b, c]) => {
          fc.pre(a.amount.abs().plus(b.amount.abs()).plus(c.amount.abs()).lt(new MoneyDecimal(10).pow(20)));
          const z = Money.zero(a.currency);
          expect(a.add(b).equals(b.add(a))).toBe(true);
          expect(
            a
              .add(b)
              .add(c)
              .equals(a.add(b.add(c))),
          ).toBe(true);
          expect(a.add(b).subtract(b).equals(a)).toBe(true);
          expect(a.add(z).equals(a)).toBe(true);
          expect(a.subtract(a).isZero()).toBe(true);
          expect(a.add(b).toMinorUnits()).toBe(a.toMinorUnits() + b.toMinorUnits());
        },
      ),
      runs,
    );
  });

  it('[TC-LEDGER-MONEY-008] negate es involución y original + negado suma cero, nunca -0 (INV-008)', () => {
    fc.assert(
      fc.property(arbMoneyAnyCurrency, (a) => {
        expect(a.negate().negate().equals(a)).toBe(true);
        expect(a.add(a.negate()).isZero()).toBe(true);
        expect(a.add(a.negate()).isNegative()).toBe(false);
      }),
      runs,
    );
  });

  it('multiply exacto coincide con aritmética racional de precisión amplia', () => {
    fc.assert(
      fc.property(arbMoney(BOB), arbDecimalString(18), (m, f) => {
        const Wide = MoneyDecimal.clone({ precision: 100 });
        const exact = new Wide(m.amount.toFixed()).times(f).toDecimalPlaces(2, Wide.ROUND_HALF_EVEN);
        fc.pre(exact.abs().lt(new Wide(10).pow(20)));
        expect(m.multiply(f, 'HALF_EVEN').amount.toFixed(2)).toBe(exact.toFixed(2));
      }),
      { numRuns: NUM_RUNS, seed: 7 },
    );
  });
});
