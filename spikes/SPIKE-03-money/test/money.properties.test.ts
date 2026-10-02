import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dec, Money, MoneyDecimal } from '../src/index.js';
import { roundDecimal } from '../src/rounding.js';
import { arbCurrency, arbDecimalString, arbMoney, arbMoneyAnyCurrency, BOB, NUM_RUNS } from './arbitraries.js';

const runs = { numRuns: NUM_RUNS };

/** Canonical form of a decimal string for currency scale (pad, no -0). */
function canonical(s: string, scale: number): string {
  const neg = s.startsWith('-');
  const [int, frac = ''] = (neg ? s.slice(1) : s).split('.');
  const out = scale > 0 ? `${int}.${frac.padEnd(scale, '0').slice(0, scale)}` : int!;
  const isZero = /^[0.]+$/.test(out);
  return `${neg && !isZero ? '-' : ''}${out}`;
}

describe('Money — propiedades', () => {
  it('[TC-LEDGER-MONEY-002] round-trip parse/format (10^5 valores, INV-001)', () => {
    fc.assert(
      fc.property(arbCurrency.chain((c) => fc.tuple(fc.constant(c), arbDecimalString(c.scale))), ([c, s]) => {
        const m = Money.parse(s, c);
        expect(m.toString()).toBe(canonical(s, c.scale));
        expect(Money.parse(m.toString(), c).equals(m)).toBe(true);
        expect(Money.parse(m.toNumeric(), c).equals(m)).toBe(true); // NUMERIC(38,18) text
        expect(Money.ofMinorUnits(m.toMinorUnits(), c).equals(m)).toBe(true);
      }),
      { numRuns: 100_000 },
    );
  });

  it('[TC-LEDGER-MONEY-004] redondeo determinista, idempotente, simétrico y acotado', () => {
    fc.assert(
      fc.property(arbCurrency, arbDecimalString(18), (c, s) => {
        const x = dec(s);
        fc.pre(x.abs().lt(new MoneyDecimal(10).pow(20).minus(1))); // rounding stays within NUMERIC(38,18)
        const r = Money.roundToScale(x, c);
        expect(Money.roundToScale(r.amount, c).equals(r)).toBe(true);
        expect(r.amount.decimalPlaces()).toBeLessThanOrEqual(c.scale);
        const half = new MoneyDecimal(10).pow(-c.scale).div(2);
        expect(r.amount.minus(x).abs().lte(half)).toBe(true);
        expect(Money.roundToScale(x.neg(), c).equals(r.negate())).toBe(true);
        expect(Money.roundToScale(s, c).toString()).toBe(r.toString());
        // bigint quantizer agrees with decimal.js toDecimalPlaces(ROUND_HALF_EVEN)
        expect(r.amount.eq(x.toDecimalPlaces(c.scale, MoneyDecimal.ROUND_HALF_EVEN))).toBe(true);
      }),
      runs,
    );
  });

  it('[TC-LEDGER-MONEY-004] HALF_EVEN no tiene sesgo (HALF_UP sí)', () => {
    // exhaustive: every 3-decimal value in [0, 100) rounded to 2 decimals
    let even = new MoneyDecimal(0);
    let up = new MoneyDecimal(0);
    for (let k = 0n; k < 100_000n; k++) {
      const x = dec(`${k / 1000n}.${(k % 1000n).toString().padStart(3, '0')}`);
      even = even.plus(roundDecimal(x, 2, 'HALF_EVEN').minus(x));
      up = up.plus(roundDecimal(x, 2, 'HALF_UP').minus(x));
    }
    expect(even.toFixed()).toBe('0');
    expect(up.toFixed()).toBe('50'); // 10 000 ties × +0.005

    // random ties: mean error of HALF_EVEN ~ 0, HALF_UP exactly +0.005
    const ties = fc.sample(fc.bigInt({ min: 0n, max: 10n ** 12n }), { numRuns: 20_000, seed: 42 });
    let e = new MoneyDecimal(0);
    for (const u of ties) {
      const x = dec(`${u * 10n + 5n}`).div(1000); // random value with an exact tie at the 3rd decimal
      e = e.plus(roundDecimal(x, 2, 'HALF_EVEN').minus(x));
    }
    const meanAbs = e.div(ties.length).abs();
    expect(meanAbs.lt('0.0002')).toBe(true); // vs 0.005 for HALF_UP
  });

  it('[TC-LEDGER-MONEY-006] allocate: Σ partes = total, error < 1 unidad, determinista, peso 0 -> 0', () => {
    const arbWeights = fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 12 }).filter(
      (ws) => ws.some((w) => w > 0),
    );
    fc.assert(
      fc.property(arbMoneyAnyCurrency, arbWeights, (total, ws) => {
        const c = total.currency;
        const parts = total.allocate(ws);
        expect(parts).toHaveLength(ws.length);
        expect(Money.sum(parts, c).equals(total)).toBe(true);
        const sumW = ws.reduce((a, b) => a + b, 0);
        const unit = new MoneyDecimal(10).pow(-c.scale);
        parts.forEach((p, i) => {
          expect(p.currency).toBe(c);
          expect(p.amount.decimalPlaces()).toBeLessThanOrEqual(c.scale);
          const exact = total.amount.times(ws[i]!).div(sumW);
          expect(p.amount.minus(exact).abs().lt(unit)).toBe(true);
          if (ws[i] === 0) expect(p.isZero()).toBe(true);
        });
        expect(total.allocate(ws).map(String)).toEqual(parts.map(String));
        expect(total.negate().allocate(ws).map(String)).toEqual(parts.map((p) => p.negate().toString()));
      }),
      runs,
    );
  });

  it('[TC-LEDGER-MONEY-006] allocate(n): partes difieren a lo sumo en 1 unidad menor (INV-021)', () => {
    fc.assert(
      fc.property(arbMoneyAnyCurrency, fc.integer({ min: 1, max: 50 }), (total, n) => {
        const parts = total.allocate(n);
        expect(Money.sum(parts, total.currency).equals(total)).toBe(true);
        const units = parts.map((p) => p.toMinorUnits());
        const max = units.reduce((a, b) => (a > b ? a : b));
        const min = units.reduce((a, b) => (a < b ? a : b));
        expect(max - min <= 1n).toBe(true);
        // larger parts first (index tie-break)
        const abs = units.map((u) => (u < 0n ? -u : u));
        for (let i = 1; i < abs.length; i++) expect(abs[i]! <= abs[i - 1]!).toBe(true);
      }),
      runs,
    );
  });

  it('[TC-LEDGER-MONEY-007] monedas distintas: add/subtract/compare lanzan, equals es false', () => {
    fc.assert(
      fc.property(arbMoneyAnyCurrency, arbMoneyAnyCurrency, (a, b) => {
        fc.pre(a.currency.code !== b.currency.code);
        expect(() => a.add(b)).toThrow(/CURRENCY_MISMATCH/);
        expect(() => a.subtract(b)).toThrow(/CURRENCY_MISMATCH/);
        expect(() => a.compare(b)).toThrow(/CURRENCY_MISMATCH/);
        expect(a.equals(b)).toBe(false);
      }),
      runs,
    );
  });

  it('[TC-LEDGER-MONEY-008] suma exacta, conmutativa, asociativa, neutro e inversa', () => {
    fc.assert(
      fc.property(
        arbCurrency.chain((c) => fc.tuple(arbMoney(c), arbMoney(c), arbMoney(c))),
        ([a, b, c]) => {
          // keep sums inside NUMERIC(38,18): |x| < 10^20
          fc.pre(a.amount.abs().plus(b.amount.abs()).plus(c.amount.abs()).lt(new MoneyDecimal(10).pow(20)));
          const z = Money.zero(a.currency);
          expect(a.add(b).equals(b.add(a))).toBe(true);
          expect(a.add(b).add(c).equals(a.add(b.add(c)))).toBe(true);
          expect(a.add(b).subtract(b).equals(a)).toBe(true);
          expect(a.add(z).equals(a)).toBe(true);
          expect(a.subtract(a).isZero()).toBe(true);
          // exact vs bigint minor units
          expect(a.add(b).toMinorUnits()).toBe(a.toMinorUnits() + b.toMinorUnits());
        },
      ),
      runs,
    );
  });

  it('[TC-LEDGER-MONEY-008] negate es involución y una reversa suma cero (INV-008)', () => {
    fc.assert(
      fc.property(arbMoneyAnyCurrency, (a) => {
        expect(a.negate().negate().equals(a)).toBe(true);
        expect(a.add(a.negate()).isZero()).toBe(true);
        expect(a.add(a.negate()).isNegative()).toBe(false); // never -0
      }),
      runs,
    );
  });

  it('multiply exacto coincide con aritmética bigint racional', () => {
    fc.assert(
      fc.property(arbMoney(BOB), arbDecimalString(18), (m, f) => {
        // reference: decimal.js with enough precision to make a 38×38-digit product exact
        const Wide = MoneyDecimal.clone({ precision: 100 });
        const exact = new Wide(m.amount.toFixed()).times(f).toDecimalPlaces(2, Wide.ROUND_HALF_EVEN);
        fc.pre(exact.abs().lt(new Wide(10).pow(20)));
        expect(m.multiply(f, 'HALF_EVEN').amount.toFixed(2)).toBe(exact.toFixed(2));
      }),
      { numRuns: NUM_RUNS, seed: 7 },
    );
  });
});
