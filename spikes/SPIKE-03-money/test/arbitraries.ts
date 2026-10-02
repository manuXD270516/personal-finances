import fc from 'fast-check';
import { CURRENCIES, Money, type Currency } from '../src/index.js';

/** PR runs by default; NIGHTLY=1 → 10 000 runs (TC-LEDGER-MONEY-004/006/008). */
export const NUM_RUNS = process.env.NIGHTLY ? 10_000 : 1_000;

export const { BOB, USD, JPY, USDT, BTC, ETH, TRX } = CURRENCIES;

export const arbCurrency: fc.Arbitrary<Currency> = fc.constantFrom(BOB, USD, JPY, USDT, BTC, ETH);

const maxUnits = (c: Currency): bigint => 10n ** BigInt(20 + c.scale) - 1n;

/** Any valid Money of currency `c` (up to 20 integer digits, never via floats). */
export const arbMoney = (c: Currency): fc.Arbitrary<Money> =>
  fc
    .oneof(
      fc.bigInt({ min: -maxUnits(c), max: maxUnits(c) }),
      fc.bigInt({ min: -(10n ** 6n), max: 10n ** 6n }), // small values hit ties/zero more often
    )
    .map((u) => Money.ofMinorUnits(u, c));

export const arbMoneyAnyCurrency: fc.Arbitrary<Money> = arbCurrency.chain(arbMoney);

/** Decimal string with up to `maxScale` decimals and up to 20 integer digits. */
export const arbDecimalString = (maxScale = 18): fc.Arbitrary<string> =>
  fc
    .integer({ min: 0, max: maxScale })
    .chain((scale) => {
      const max = 10n ** BigInt(20 + scale) - 1n;
      return fc.tuple(fc.oneof(fc.bigInt({ min: -max, max }), fc.bigInt({ min: -1000n, max: 1000n })), fc.constant(scale));
    })
    .map(([units, scale]) => {
      const neg = units < 0n;
      const digits = (neg ? -units : units).toString().padStart(scale + 1, '0');
      const int = digits.slice(0, digits.length - scale).replace(/^0+(?=\d)/, '');
      const frac = scale ? `.${digits.slice(digits.length - scale)}` : '';
      return `${neg ? '-' : ''}${int}${frac}`;
    });

/** Positive rate string with 8..18 decimals, value in [1e-8, 1e8). */
export const arbRateString: fc.Arbitrary<string> = fc
  .integer({ min: 8, max: 18 })
  .chain((scale) => fc.tuple(fc.bigInt({ min: 10n ** BigInt(scale - 8), max: 10n ** BigInt(scale + 8) - 1n }), fc.constant(scale)))
  .map(([units, scale]) => {
    const digits = units.toString().padStart(scale + 1, '0');
    const int = digits.slice(0, digits.length - scale).replace(/^0+(?=\d)/, '');
    return `${int}.${digits.slice(digits.length - scale)}`;
  });
