import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { computeConversion, Money, MoneyDecimal, Rate, totalsByCurrency, type Currency } from '../src/index.js';
import { arbCurrency, arbMoney, arbRateString, BOB, BTC, NUM_RUNS, TRX, USD, USDT } from './arbitraries.js';

const balanced = (legs: Parameters<typeof totalsByCurrency>[0]) =>
  [...totalsByCurrency(legs).values()].every((t) => t.isZero());

describe('Conversiones (docs/09 §6.12–6.15, §7)', () => {
  it('§6.12 USD -> BOB con fee bancario: tasa efectiva 6.91', () => {
    const d = computeConversion({
      source: Money.of('100.00', USD),
      target: Money.of('691.00', BOB),
      fees: [{ type: 'BANK', amount: Money.of('5.00', BOB) }],
      quotedRate: Rate.of(USD, BOB, '6.96'),
    });
    expect(d.grossTarget.toString()).toBe('696.00');
    expect(d.effectiveRate.toPersisted()).toBe('6.910000000000000000');
    expect(d.quotedRateMismatch).toBe(false);
    expect(balanced(d.legs)).toBe(true);
  });

  it('§6.13 BOB -> USDT (compra P2P), fee en destino: efectiva 7.007007007007007007 BOB/USDT', () => {
    const d = computeConversion({
      source: Money.of('700.00', BOB),
      target: Money.of('99.900000', USDT),
      fees: [{ type: 'PROVIDER', amount: Money.of('0.100000', USDT) }],
      quotedRate: Rate.of(USDT, BOB, '7.00'),
    });
    expect(d.grossTarget.toString()).toBe('100.000000');
    expect(d.effectiveRate.base).toBe(USDT);
    expect(d.effectiveRate.toPersisted()).toBe('7.007007007007007007');
    expect(d.quotedRateMismatch).toBe(false);
    expect(d.legs.map((l) => `${l.account} ${l.amount.toString()}`)).toEqual([
      'ASSET:source:BOB -700.00',
      'EQUITY:FX_TRADING:BOB 700.00',
      'EQUITY:FX_TRADING:USDT -100.000000',
      'ASSET:target:USDT 99.900000',
      'EXPENSE:USDT 0.100000',
    ]);
    expect(balanced(d.legs)).toBe(true);
  });

  it('§6.14 USDT -> BOB canónico: efectiva 6.85, spread 0.719424460431654676 % = 5.00 BOB', () => {
    const d = computeConversion({
      source: Money.of('100.000000', USDT),
      target: Money.of('685.00', BOB),
      fees: [{ type: 'PROVIDER', amount: Money.of('5.00', BOB) }],
      quotedRate: Rate.of(USDT, BOB, '6.90'),
      referenceRate: Rate.of(USDT, BOB, '6.95'),
    });
    expect(d.effectiveRate.toPersisted()).toBe('6.850000000000000000');
    expect(d.spread?.percentageString).toBe('0.719424460431654676');
    expect(d.spread?.amount.toString()).toBe('5.00');
    // costo total vs referencia = spread + fee
    const atReference = Rate.of(USDT, BOB, '6.95').convert(Money.of('100.000000', USDT));
    expect(atReference.subtract(Money.of('685.00', BOB)).toString()).toBe('10.00');
    expect(balanced(d.legs)).toBe(true);
  });

  it('§6.14 spread con la referencia en orientación inversa (BOB/USDT) da el mismo resultado', () => {
    const inverseRef = Rate.of(USDT, BOB, '6.95').inverse();
    const d = computeConversion({
      source: Money.of('100.000000', USDT),
      target: Money.of('685.00', BOB),
      fees: [{ type: 'PROVIDER', amount: Money.of('5.00', BOB) }],
      quotedRate: Rate.of(USDT, BOB, '6.90'),
      referenceRate: inverseRef,
    });
    expect(d.spread?.percentageString).toBe('0.719424460431654676');
  });

  it('§6.15 USDT -> BTC con fee de red en TRX (tercera moneda): Σ por moneda = 0', () => {
    const d = computeConversion({
      source: Money.of('1000.000000', USDT),
      target: Money.of('0.01600000', BTC),
      fees: [
        { type: 'PROVIDER', amount: Money.of('2.000000', USDT) },
        { type: 'NETWORK', amount: Money.of('15.000000', TRX) },
      ],
      quotedRate: Rate.of(BTC, USDT, '62375'),
    });
    expect(d.convertedSource.toString()).toBe('998.000000');
    expect(d.quotedRateMismatch).toBe(false);
    expect(d.effectiveRate.base).toBe(BTC);
    expect(d.effectiveRate.toPersisted()).toBe('62500.000000000000000000');
    const totals = totalsByCurrency(d.legs);
    expect([...totals.keys()].sort()).toEqual(['BTC', 'TRX', 'USDT']);
    expect(balanced(d.legs)).toBe(true);
  });

  it('§7.2 tasa cotizada inconsistente con los montos (> 1 unidad mínima) se marca', () => {
    const d = computeConversion({
      source: Money.of('100.00', USD),
      target: Money.of('700.00', BOB),
      fees: [],
      quotedRate: Rate.of(USD, BOB, '6.96'),
    });
    expect(d.quotedRateMismatch).toBe(true);
  });

  it('[INV-032] inversa: 1/6.96 -> 0.143678160919540230; inverse().inverse() devuelve la original', () => {
    const r = Rate.of(USD, BOB, '6.96');
    expect(r.inverse().toPersisted()).toBe('0.143678160919540230');
    expect(r.inverse().inverse()).toBe(r);
    expect(() => Rate.of(USD, USD, '1')).toThrow(/INVALID_RATE/);
    expect(() => Rate.of(USD, BOB, '0')).toThrow(/INVALID_RATE/);
    expect(() => Rate.of(USD, BOB, '-1')).toThrow(/INVALID_RATE/);
  });

  it('[INV-032] hallazgo: la cota absoluta 10^-30 no vale para tasas grandes; la relativa sí', () => {
    const r = new MoneyDecimal('975982122997428.913269897976665492'); // e.g. a wei-denominated pair
    const err = new MoneyDecimal(1).div(new MoneyDecimal(1).div(r)).minus(r).abs();
    expect(err.eq('5e-25')).toBe(true);
    expect(err.gt('1e-30')).toBe(true);
    expect(err.div(r).lt('1e-38')).toBe(true);
  });

  it('[INV-032] usar la inversa redondeada (18 dp) sí puede dar otro monto; la convertida vía Rate no', () => {
    const r = Rate.of(USD, BOB, '6.96');
    const bob = Money.of('99999999999999999999.99', BOB);
    const viaRate = r.inverse().convert(bob); // uses bob / 6.96 internally
    const viaOriginal = r.convert(bob); // same thing, direct
    const viaRoundedInverse = Money.roundToScale(
      bob.toDecimal().times(r.inverse().toPersisted()),
      USD,
    );
    expect(viaRate.equals(viaOriginal)).toBe(true);
    expect(viaRate.toString()).toBe('14367816091954022988.50');
    expect(viaRoundedInverse.toString()).not.toBe(viaRate.toString());
  });
});

describe('Conversiones — propiedades', () => {
  const arbPair = fc
    .tuple(arbCurrency, arbCurrency)
    .filter(([a, b]) => a.code !== b.code) as fc.Arbitrary<[Currency, Currency]>;

  it('[INV-032] |1/(1/r) − r| < 10^-30 a precisión 40 y convertir por la inversa = dividir por la original', () => {
    fc.assert(
      fc.property(arbPair, arbRateString, ([base, quote], v) => {
        const r = Rate.of(base, quote, v);
        const inv = new MoneyDecimal(1).div(r.value);
        expect(new MoneyDecimal(1).div(inv).minus(r.value).abs().lt('1e-30')).toBe(true);
        expect(r.inverse().inverse()).toBe(r);
        const amt = Money.ofMinorUnits(123456789n, quote);
        expect(r.inverse().convert(amt).equals(r.convert(amt))).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('[INV-004][INV-010] conversión aleatoria: montos reconcilian y el asiento cuadra por moneda', () => {
    fc.assert(
      fc.property(
        arbPair.chain(([s, t]) =>
          fc.tuple(
            fc.constant(s),
            fc.constant(t),
            arbRateString,
            fc.bigInt({ min: 1n, max: 10n ** 12n }),
            fc.bigInt({ min: 0n, max: 10n ** 6n }),
            fc.bigInt({ min: 0n, max: 10n ** 3n }),
            arbMoney(TRX).map((m) => m.abs()),
          ),
        ),
        ([s, t, v, convertedUnits, srcFeeUnits, tgtFeeUnits, trxFee]) => {
          const quoted = Rate.of(s, t, v);
          const convertedSource = Money.ofMinorUnits(convertedUnits, s);
          const exactTarget = convertedSource.amount.times(quoted.value);
          fc.pre(exactTarget.lt('1e19')); // stay inside NUMERIC(38,18)
          const grossTarget = quoted.convert(convertedSource);
          const tgtFee = Money.ofMinorUnits(tgtFeeUnits, t);
          fc.pre(grossTarget.compare(tgtFee) > 0 && grossTarget.isPositive());
          const fees = [
            { type: 'PROVIDER' as const, amount: Money.ofMinorUnits(srcFeeUnits, s) },
            { type: 'BANK' as const, amount: tgtFee },
            ...(s.code !== 'TRX' && t.code !== 'TRX' ? [{ type: 'NETWORK' as const, amount: trxFee }] : []),
          ];
          const source = convertedSource.add(fees[0]!.amount);
          const target = grossTarget.subtract(tgtFee);
          const d = computeConversion({ source, target, fees, quotedRate: quoted });
          expect(d.convertedSource.equals(convertedSource)).toBe(true);
          expect(d.grossTarget.equals(grossTarget)).toBe(true);
          expect(d.quotedRateMismatch).toBe(false);
          expect(balanced(d.legs)).toBe(true);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
