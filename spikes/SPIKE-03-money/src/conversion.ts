import { assertSameCurrency, sameCurrency, type Currency } from './currency.js';
import { type Decimal } from './decimal.js';
import { MoneyError } from './errors.js';
import { Money } from './money.js';
import { Rate } from './rate.js';
import { mulToScale, roundDecimal } from './rounding.js';

/** Effective rate per docs/09 §7.1: target(net) / source(gross), at precision 40. */
export function effectiveRate(source: Money, target: Money, displayBase?: Currency): Rate {
  if (source.isZero() || target.isZero()) {
    throw new MoneyError('INVALID_RATE', 'effective rate needs non-zero amounts');
  }
  const s = source.amount.abs();
  const t = target.amount.abs();
  // computed directly in the requested orientation, never as 1/(rounded inverse)
  if (displayBase && sameCurrency(displayBase, target.currency)) {
    return Rate.derived(target.currency, source.currency, s.div(t));
  }
  return Rate.derived(source.currency, target.currency, t.div(s));
}

export type Side = 'SELL_BASE' | 'BUY_BASE';

export interface Spread {
  /** Unrounded percentage (precision 40); positive = unfavourable to the user. */
  readonly percentage: Decimal;
  /** Persisted/display form: 18 decimals HALF_EVEN. */
  readonly percentageString: string;
  /** |q − m| × convertedBaseAmount, HALF_EVEN at quote scale. */
  readonly amount: Money;
}

/**
 * Spread of a quoted rate vs a reference rate (docs/09 §7.1). Both rates are
 * brought to the quoted orientation (quote per base, base = asset the user
 * sells or buys) using the unrounded inverse if needed.
 */
export function spread(args: {
  quoted: Rate;
  reference: Rate;
  side: Side;
  convertedBaseAmount: Money;
}): Spread {
  const { quoted, side, convertedBaseAmount } = args;
  const reference = args.reference.oriented(quoted.base);
  if (!sameCurrency(reference.quote, quoted.quote)) {
    throw new MoneyError('CURRENCY_MISMATCH', 'reference and quoted rates must share the pair');
  }
  assertSameCurrency(convertedBaseAmount.currency, quoted.base);
  const q = quoted.value;
  const m = reference.value;
  const diff = side === 'SELL_BASE' ? m.minus(q) : q.minus(m);
  const percentage = diff.div(m).times(100);
  const units = mulToScale(q.minus(m).abs(), convertedBaseAmount.amount.abs(), quoted.quote.scale, 'HALF_EVEN');
  return {
    percentage,
    percentageString: roundDecimal(percentage, 18, 'HALF_EVEN').toFixed(18),
    amount: Money.ofMinorUnits(units, quoted.quote),
  };
}

export type FeeType = 'PROVIDER' | 'NETWORK' | 'BANK' | 'TAX' | 'OTHER';

export interface Fee {
  readonly type: FeeType;
  readonly amount: Money;
}

export interface ConversionInput {
  readonly source: Money; // gross delivered
  readonly target: Money; // net received
  readonly fees: readonly Fee[];
  readonly quotedRate: Rate;
  readonly referenceRate?: Rate;
}

export interface Leg {
  readonly account: string;
  readonly amount: Money;
}

export interface ConversionDetail {
  readonly convertedSource: Money;
  readonly grossTarget: Money;
  readonly effectiveRate: Rate;
  readonly spread?: Spread;
  /** |grossTarget − convert(convertedSource, quoted)| > 1 minor unit (docs/09 §7.2). */
  readonly quotedRateMismatch: boolean;
  readonly legs: readonly Leg[];
}

/**
 * Prototype of the ConversionCalculator (docs/09 §7, §6.12-6.15): derives the
 * converted/gross amounts, effective rate, spread and the journal legs that
 * balance per currency through EQUITY:FX_TRADING (INV-004, INV-010).
 */
export function computeConversion(input: ConversionInput): ConversionDetail {
  const { source, target, fees, quotedRate, referenceRate } = input;
  if (sameCurrency(source.currency, target.currency)) {
    throw new MoneyError('CURRENCY_MISMATCH', 'a conversion needs two different currencies');
  }
  if (!source.isPositive() || !target.isPositive()) {
    throw new MoneyError('MONEY_INVALID_AMOUNT', 'conversion amounts must be positive');
  }
  const src = source.currency;
  const tgt = target.currency;
  const sum = (c: Currency) =>
    Money.sum(fees.filter((f) => sameCurrency(f.amount.currency, c)).map((f) => f.amount), c);

  const convertedSource = source.subtract(sum(src));
  const grossTarget = target.add(sum(tgt));
  const expectedGross = quotedRate.convert(convertedSource);
  const tolerance = Money.ofMinorUnits(1n, tgt);
  const quotedRateMismatch = grossTarget.subtract(expectedGross).abs().compare(tolerance) > 0;

  // display orientation = the quoted rate's orientation
  const eff = effectiveRate(source, target, quotedRate.base);

  let sp: Spread | undefined;
  if (referenceRate) {
    const sellsBase = sameCurrency(src, quotedRate.base);
    sp = spread({
      quoted: quotedRate,
      reference: referenceRate,
      side: sellsBase ? 'SELL_BASE' : 'BUY_BASE',
      convertedBaseAmount: sellsBase ? convertedSource : grossTarget,
    });
  }

  const legs: Leg[] = [
    { account: `ASSET:source:${src.code}`, amount: source.negate() },
    { account: `EQUITY:FX_TRADING:${src.code}`, amount: convertedSource },
    { account: `EQUITY:FX_TRADING:${tgt.code}`, amount: grossTarget.negate() },
    { account: `ASSET:target:${tgt.code}`, amount: target },
  ];
  for (const fee of fees) {
    if (fee.amount.isZero()) continue; // INV-005: no zero postings
    const c = fee.amount.currency;
    legs.push({ account: `EXPENSE:${c.code}`, amount: fee.amount });
    if (!sameCurrency(c, src) && !sameCurrency(c, tgt)) {
      // third-currency fee (e.g. network fee in TRX) paid from its own wallet
      legs.push({ account: `ASSET:fee-wallet:${c.code}`, amount: fee.amount.negate() });
    }
  }

  return {
    convertedSource,
    grossTarget,
    effectiveRate: eff,
    ...(sp ? { spread: sp } : {}),
    quotedRateMismatch,
    legs,
  };
}

/** Σ legs grouped by currency code (INV-004 check helper). */
export function totalsByCurrency(legs: readonly Leg[]): Map<string, Money> {
  const totals = new Map<string, Money>();
  for (const { amount } of legs) {
    const prev = totals.get(amount.currency.code) ?? Money.zero(amount.currency);
    totals.set(amount.currency.code, prev.add(amount));
  }
  return totals;
}
