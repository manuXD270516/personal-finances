import fc from 'fast-check';
import { currency, Instant, Money, MoneyDecimal, Rate, type Currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ExchangeRate } from './exchange-rate.js';
import { RateResolver, type RateCandidate } from './rate-resolver.js';

const CCYS: readonly Currency[] = [
  currency('BOB', 2),
  currency('USD', 2),
  currency('USDT', 6),
  currency('BTC', 8),
];
const NUM_RUNS = 100;

/** Par de monedas distintas. */
const pair = fc.tuple(fc.nat({ max: CCYS.length - 1 }), fc.nat({ max: CCYS.length - 2 })).map(([i, j]) => {
  const a = CCYS[i] as Currency;
  const rest = CCYS.filter((_, k) => k !== i);
  return [a, rest[j] as Currency] as const;
});

/** Tasa como string decimal en (0.000001, 1000000), con hasta 8 decimales. */
const rateString = fc
  .bigInt({ min: 100n, max: 100_000_000_000_000n })
  .map((units) => new MoneyDecimal(units.toString()).div('100000000').toFixed());

const units = (m: Money) => m.toMinorUnits();

describe('Propiedades FX (INV-032, INV-011, INV-012)', () => {
  it('[TC-FX-CONVERSION-001] convertir y volver con la tasa ORIGINAL difiere a lo sumo una cota de unidades menores', () => {
    fc.assert(
      fc.property(pair, rateString, fc.bigInt({ min: 0n, max: 10n ** 12n }), ([s, t], r, x) => {
        const rate = Rate.of(s, t, r);
        const amount = Money.ofMinorUnits(x, s);
        const y = rate.convert(amount);
        const back = rate.convert(y);
        // |x2 − x| ≤ max(1 unidad de source, ⌈0.5 · r⁻¹ · 10^-t.scale⌉ en unidades de source).
        const a = new MoneyDecimal('0.5')
          .div(rate.value)
          .div(new MoneyDecimal(10).pow(t.scale))
          .times(new MoneyDecimal(10).pow(s.scale))
          .ceil();
        const bound = BigInt(MoneyDecimal.max('1', a).toFixed());
        const diff = units(back) - units(amount);
        expect(diff <= bound && -diff <= bound).toBe(true);
        // Determinista y cero ↦ cero.
        expect(rate.convert(amount).equals(y)).toBe(true);
        expect(rate.convert(Money.zero(s)).isZero()).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('[TC-FX-CONVERSION-001] la inversa nunca se encadena: inverse().inverse() es la original y 1/(1/r) ≈ r con error < 10^-38', () => {
    fc.assert(
      fc.property(pair, rateString, ([s, t], r) => {
        const rate = Rate.of(s, t, r);
        expect(rate.inverse().inverse()).toBe(rate);
        const roundTrip = new MoneyDecimal(1).div(new MoneyDecimal(1).div(rate.value));
        expect(roundTrip.minus(rate.value).abs().div(rate.value).lt('1e-38')).toBe(true);
        // Convertir con la inversa derivada usa la original: mismo resultado que dividir por r.
        const m = Money.ofMinorUnits(123_456_789n, t);
        expect(rate.inverse().convert(m).equals(rate.convert(m))).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('[TC-FX-HISTORICAL-001] registrar o reemplazar tasas posteriores no cambia la tasa resuelta a un instante pasado ni la versión leída', () => {
    const USDT = currency('USDT', 6);
    const BOB = currency('BOB', 2);
    const T0 = Instant.parse('2026-09-30T18:42:00Z');
    const r2 = ExchangeRate.record({
      id: 'R2',
      workspaceId: 'ws',
      base: USDT,
      quote: BOB,
      value: '6.95',
      rateType: 'P2P',
      asOf: '2026-09-29T19:00:00Z',
      effectiveDate: '2026-09-29',
      createdAt: '2026-09-29T19:00:00Z',
      createdBy: 'u',
    });
    const later = fc.array(
      fc.record({
        offsetMinutes: fc.integer({ min: 1, max: 60 * 24 * 30 }),
        value: rateString,
        supersedeR2: fc.boolean(),
      }),
      { maxLength: 10 },
    );
    fc.assert(
      fc.property(later, (events) => {
        const candidates: RateCandidate[] = [{ state: r2.snapshot, supersededById: null }];
        const before = new RateResolver(candidates).resolveForConversion({ base: USDT, quote: BOB, at: T0 });
        let k = 0;
        for (const e of events) {
          k += 1;
          const asOf = T0.plusMillis(e.offsetMinutes * 60_000).toString();
          candidates.push({
            state: ExchangeRate.record({
              id: `L${k}`,
              workspaceId: 'ws',
              base: USDT,
              quote: BOB,
              value: e.value,
              rateType: 'P2P',
              asOf,
              effectiveDate: asOf.slice(0, 10),
              createdAt: asOf,
              createdBy: 'u',
            }).snapshot,
            supersededById: null,
          });
        }
        const after = new RateResolver(candidates).resolveForConversion({ base: USDT, quote: BOB, at: T0 });
        expect(after?.fxRateId).toBe(before?.fxRateId);
        expect(after?.rate.value.toFixed()).toBe('6.95');
        // La versión R2 leída por id sigue idéntica (inmutable, INV-011), aunque luego se reemplace.
        if (events.some((e) => e.supersedeR2)) {
          const r3 = r2.supersede(
            { id: 'R3', value: '6.97', reason: 'corrección', createdAt: 'x', createdBy: 'u' },
            null,
          );
          expect(r3.snapshot.supersedesId).toBe('R2');
        }
        expect(r2.valueText).toBe('6.95');
        expect(Object.isFrozen(r2.snapshot.rate)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
