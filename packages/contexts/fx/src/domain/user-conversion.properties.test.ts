import fc from 'fast-check';
import { currency, Instant, type Currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ExchangeRate } from './exchange-rate.js';
import { RateResolver, type RateCandidate } from './rate-resolver.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const USDT = currency('USDT', 6);
const BTC = currency('BTC', 8);
const CCYS: readonly Currency[] = [BOB, USD, USDT, BTC];
const BASE_TIME = Date.parse('2026-10-05T12:00:00Z');

const manual = (id: string, base: Currency, quote: Currency, value: string, asOf: string) =>
  ExchangeRate.record({
    id,
    workspaceId: 'ws',
    base,
    quote,
    value,
    rateType: 'PARALLEL',
    asOf,
    effectiveDate: asOf.slice(0, 10),
    createdAt: asOf,
    createdBy: 'u1',
  });

/** Tasas reales del workspace: USDT/BOB y USD/BOB paralelas y BTC/USDT; las observaciones se agregan encima. */
const REAL: RateCandidate[] = [
  manual('m1', USDT, BOB, '12.02', '2026-10-05T13:50:00Z'),
  manual('m2', USD, BOB, '12.00', '2026-10-05T13:00:00Z'),
  manual('m3', BTC, USDT, '65000.5', '2026-10-05T13:30:00Z'),
].map((r) => ({ state: r.snapshot, supersededById: null }));

const observation = (i: number, base: Currency, quote: Currency, value: string, minutes: number) =>
  ExchangeRate.userConversionObservation({
    id: `obs-${i}`,
    workspaceId: 'ws',
    base,
    quote,
    value,
    executedAt: new Date(BASE_TIME + minutes * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    effectiveDate: '2026-10-05',
    conversion: { transactionId: `tx-${i}`, revision: 1 },
    createdAt: '2026-10-05T14:00:00Z',
  });

const pair = fc
  .tuple(fc.nat({ max: CCYS.length - 1 }), fc.nat({ max: CCYS.length - 2 }))
  .map(([i, j]) => [CCYS[i] as Currency, CCYS.filter((_, k) => k !== i)[j] as Currency] as const);

let seq = 0;
const arbObservation = fc
  .tuple(pair, fc.integer({ min: 1, max: 99_999 }), fc.integer({ min: -60, max: 180 }))
  .map(([[b, q], v, m]) => observation((seq += 1), b, q, (v / 100).toFixed(2), m));

const QUERIES: readonly { base: Currency; quote: Currency }[] = CCYS.flatMap((b) =>
  CCYS.filter((q) => q.code !== b.code).map((q) => ({ base: b, quote: q })),
);
const AT = Instant.parse('2026-10-05T14:05:00Z');

const answers = (candidates: readonly RateCandidate[]) => {
  const resolver = new RateResolver(candidates);
  return QUERIES.map((q) => {
    const valuation = resolver.tryResolve({ ...q, at: AT, allowCross: true, pivot: USDT });
    const reference = resolver.resolveForConversion({ ...q, at: AT });
    const describe = (r: typeof valuation) =>
      r
        ? [r.rate.base.code, r.rate.quote.code, r.rate.value.toFixed(), r.derivation, r.fxRateId, r.source]
        : null;
    return [describe(valuation), describe(reference)];
  });
};

describe('Propiedades de las observaciones de conversiones propias (D231, D29)', () => {
  it('[TC-FX-USERCONV-002] agregar observaciones aleatorias (más recientes, de cualquier par) no cambia ninguna valoración, referencia ni tasa cruzada', () => {
    const without = answers(REAL);
    fc.assert(
      fc.property(fc.array(arbObservation, { minLength: 1, maxLength: 12 }), (observations) => {
        const withObservations: RateCandidate[] = [
          ...REAL,
          ...observations.map((o) => ({ state: o.snapshot, supersededById: null })),
        ];
        expect(answers(withObservations)).toEqual(without);
      }),
      { numRuns: 200 },
    );
  }, 60_000);

  it('[TC-FX-USERCONV-002] sin otra tasa del par, una observación no valora: no hay tasa en lugar de usarla', () => {
    const only = observation(1, USDT, BOB, '11.90', 0);
    const resolver = new RateResolver([{ state: only.snapshot, supersededById: null }]);
    expect(resolver.tryResolve({ base: USDT, quote: BOB, at: AT })).toBeNull();
    expect(resolver.resolveForConversion({ base: USDT, quote: BOB, at: AT })).toBeNull();
    expect(resolver.tryResolve({ base: BOB, quote: USDT, at: AT, allowCross: true, pivot: USD })).toBeNull();
  });
});
