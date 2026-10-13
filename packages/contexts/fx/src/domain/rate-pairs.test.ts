import fc from 'fast-check';
import { dec } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { anomalyDetectorFor, anomalyThresholdFor, DEFAULT_ANOMALY_THRESHOLDS } from './anomaly-detector.js';
import {
  AssetClassPolicy,
  defaultRatePairs,
  defaultRateTypeFor,
  pairKey,
  RatePairList,
  type CurrencyRef,
  type RatePair,
} from './rate-pairs.js';

// TDD de los pares de tasa automáticos (fx/market-rate-providers, add-crypto-rate-providers; D220, D227, D228, D230,
// D250): lista por defecto, clases de activo, agregado `RatePairList` y umbrales de anomalía por clase.
const CATALOG: Readonly<Record<string, CurrencyRef>> = {
  BOB: { code: 'BOB', kind: 'FIAT' },
  USD: { code: 'USD', kind: 'FIAT' },
  EUR: { code: 'EUR', kind: 'FIAT' },
  USDT: { code: 'USDT', kind: 'CRYPTO' },
  USDC: { code: 'USDC', kind: 'CRYPTO' },
  BTC: { code: 'BTC', kind: 'CRYPTO' },
  ETH: { code: 'ETH', kind: 'CRYPTO' },
};
const policy = new AssetClassPolicy();
const refs = (...codes: string[]) => codes.map((c) => CATALOG[c] as CurrencyRef);
const keys = (pairs: readonly RatePair[]) => pairs.map(pairKey);

describe('AssetClassPolicy', () => {
  it('[TC-FX-PROVIDER-020] fiat del catálogo es FIAT, USDT es STABLE y el resto de las criptos es VOLATILE_CRYPTO', () => {
    expect(policy.classOf(CATALOG['USD'] as CurrencyRef)).toBe('FIAT');
    expect(policy.classOf(CATALOG['USDT'] as CurrencyRef)).toBe('STABLE');
    expect(policy.classOf(CATALOG['BTC'] as CurrencyRef)).toBe('VOLATILE_CRYPTO');
    // FX_STABLECOIN_CODES configurable: con USDC también estable, deja de ser volátil.
    expect(new AssetClassPolicy(['USDT', 'USDC']).classOf(CATALOG['USDC'] as CurrencyRef)).toBe('STABLE');
  });
});

describe('DefaultRatePairs (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-020] con BOB, USD, USDT y BTC habilitadas la lista es USD/BOB, USDT/BOB y BTC/USDT', () => {
    const pairs = defaultRatePairs({
      enabled: refs('BOB', 'USD', 'USDT', 'BTC'),
      baseCurrency: 'BOB',
      policy,
    });
    expect(keys(pairs)).toEqual(['USD/BOB', 'USDT/BOB', 'BTC/USDT']);
  });

  it('[TC-FX-PROVIDER-020] sin cripto volátil no hay pares contra USDT; habilitar ETH lo agrega solo', () => {
    expect(
      keys(defaultRatePairs({ enabled: refs('BOB', 'USD', 'USDT'), baseCurrency: 'BOB', policy })),
    ).toEqual(['USD/BOB', 'USDT/BOB']);
    expect(
      keys(
        defaultRatePairs({ enabled: refs('BOB', 'USD', 'USDT', 'BTC', 'ETH'), baseCurrency: 'BOB', policy }),
      ),
    ).toEqual(['USD/BOB', 'USDT/BOB', 'BTC/USDT', 'ETH/USDT']);
  });

  it('[TC-FX-PROVIDER-020] la cripto volátil sin USDT habilitada igual trae el pivote USDT/BOB', () => {
    expect(keys(defaultRatePairs({ enabled: refs('BOB', 'BTC'), baseCurrency: 'BOB', policy }))).toEqual([
      'USDT/BOB',
      'BTC/USDT',
    ]);
  });

  it('[TC-FX-PROVIDER-020] sin moneda base conocida (valoración) solo los pares cripto contra USDT', () => {
    expect(
      keys(defaultRatePairs({ enabled: refs('BOB', 'USD', 'BTC'), baseCurrency: null, policy })),
    ).toEqual(['BTC/USDT']);
  });

  it('[TC-FX-PROVIDER-020] PBT: ningún par repite moneda ni tiene la moneda base como base, sin repetidos y con pivote', () => {
    const codes = Object.keys(CATALOG);
    fc.assert(
      fc.property(
        fc.subarray(codes, { minLength: 0 }),
        fc.constantFrom('BOB', 'USD', 'USDT', 'EUR'),
        (enabled, baseCurrency) => {
          const pairs = defaultRatePairs({ enabled: refs(...enabled), baseCurrency, policy });
          const seen = new Set(keys(pairs));
          expect(seen.size).toBe(pairs.length);
          for (const p of pairs) {
            expect(p.base).not.toBe(p.quote);
            expect(p.base).not.toBe(baseCurrency);
            expect([baseCurrency, 'USDT']).toContain(p.quote);
          }
          const anyAgainstUsdt = pairs.some((p) => p.quote === 'USDT' && p.base !== 'USDT');
          if (anyAgainstUsdt && baseCurrency !== 'USDT') expect(seen.has(`USDT/${baseCurrency}`)).toBe(true);
          // Idempotente y determinista.
          expect(keys(defaultRatePairs({ enabled: refs(...enabled), baseCurrency, policy }))).toEqual(
            keys(pairs),
          );
        },
      ),
      { numRuns: 500 },
    );
  }, 60_000);
});

describe('defaultRateTypeFor', () => {
  const classOf = (code: string) => policy.classOf(CATALOG[code] as CurrencyRef);
  it('[TC-FX-RATE-008] BTC/USDT (en cualquier orientación) usa MARKET; USD/BOB y USDT/BOB usan PARALLEL', () => {
    expect(defaultRateTypeFor('BTC', 'USDT', classOf)).toBe('MARKET');
    expect(defaultRateTypeFor('USDT', 'BTC', classOf)).toBe('MARKET');
    expect(defaultRateTypeFor('USD', 'BOB', classOf)).toBe('PARALLEL');
    expect(defaultRateTypeFor('USDT', 'BOB', classOf)).toBe('PARALLEL');
    expect(defaultRateTypeFor('BTC', 'BOB', classOf)).toBe('PARALLEL');
  });
});

describe('RatePairList (fx/market-rate-providers; D230, D250)', () => {
  const ctx = {
    baseCurrency: 'BOB',
    enabledCodes: new Set(['BOB', 'USD', 'USDT', 'BTC', 'ETH']),
    catalogCodes: new Set(Object.keys(CATALOG)),
  };
  const four: RatePair[] = [
    { base: 'USD', quote: 'BOB' },
    { base: 'USDT', quote: 'BOB' },
    { base: 'BTC', quote: 'USDT' },
    { base: 'ETH', quote: 'USDT' },
  ];
  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (err) {
      return (err as { code?: string }).code;
    }
    return undefined;
  };

  it('[TC-FX-PROVIDER-021] la lista nueva guarda los cuatro pares y sube la versión; sin lista previa es DEFAULT v1', () => {
    const initial = RatePairList.defaults();
    expect([initial.mode, initial.version]).toEqual(['DEFAULT', 1]);
    const next = initial.replace({ mode: 'CUSTOM', pairs: four }, ctx);
    expect([next.mode, next.version]).toEqual(['CUSTOM', 2]);
    expect(keys(next.snapshot.pairs)).toEqual(['USD/BOB', 'USDT/BOB', 'BTC/USDT', 'ETH/USDT']);
    // El agregado es inmutable.
    expect(initial.mode).toBe('DEFAULT');
  });

  it('[TC-FX-PROVIDER-021] volver a DEFAULT borra la lista explícita y la efectiva se deriva de nuevo', () => {
    const custom = RatePairList.defaults().replace({ mode: 'CUSTOM', pairs: four }, ctx);
    const back = custom.replace({ mode: 'DEFAULT' }, ctx);
    expect([back.mode, back.version, back.snapshot.pairs.length]).toEqual(['DEFAULT', 3, 0]);
    const derived = defaultRatePairs({ enabled: refs('BOB', 'USD', 'USDT'), baseCurrency: 'BOB', policy });
    expect(keys(back.effective(derived))).toEqual(['USD/BOB', 'USDT/BOB']);
    expect(keys(custom.effective(derived))).toEqual(keys(four));
  });

  it('[TC-FX-PROVIDER-022] ETH no habilitada ⇒ CURRENCY_NOT_ENABLED y la lista no cambia', () => {
    const list = RatePairList.defaults();
    const without = { ...ctx, enabledCodes: new Set(['BOB', 'USD', 'USDT', 'BTC']) };
    expect(codeOf(() => list.replace({ mode: 'CUSTOM', pairs: four }, without))).toBe('CURRENCY_NOT_ENABLED');
    expect(list.version).toBe(1);
  });

  it('[TC-FX-PROVIDER-022] BTC/USD en un workspace BOB ⇒ VALIDATION_FAILED (quote distinta de la base y de USDT)', () => {
    expect(
      codeOf(() =>
        RatePairList.defaults().replace({ mode: 'CUSTOM', pairs: [{ base: 'BTC', quote: 'USD' }] }, ctx),
      ),
    ).toBe('VALIDATION_FAILED');
    // Aunque la moneda además no esté habilitada, la forma se valida primero.
    expect(
      codeOf(() =>
        RatePairList.defaults().replace(
          { mode: 'CUSTOM', pairs: [{ base: 'EUR', quote: 'USD' }] },
          { ...ctx, enabledCodes: new Set(['BOB']) },
        ),
      ),
    ).toBe('VALIDATION_FAILED');
  });

  it('[TC-FX-PROVIDER-022] repetidos, base = quote y más de 50 pares ⇒ VALIDATION_FAILED', () => {
    const list = RatePairList.defaults();
    const dup = [
      { base: 'USD', quote: 'BOB' },
      { base: 'USD', quote: 'BOB' },
    ];
    expect(codeOf(() => list.replace({ mode: 'CUSTOM', pairs: dup }, ctx))).toBe('VALIDATION_FAILED');
    expect(codeOf(() => list.replace({ mode: 'CUSTOM', pairs: [{ base: 'BOB', quote: 'BOB' }] }, ctx))).toBe(
      'VALIDATION_FAILED',
    );
    const many = Array.from({ length: 51 }, () => ({ base: 'USD', quote: 'BOB' }));
    expect(codeOf(() => list.replace({ mode: 'CUSTOM', pairs: many }, ctx))).toBe('VALIDATION_FAILED');
  });
});

describe('Umbral de anomalía por clase de activo (fx/market-rate-providers; D228)', () => {
  const baseline = (value: string) => ({ rateId: 'b', value });
  const detector = (cls: 'FIAT' | 'STABLE' | 'VOLATILE_CRYPTO') =>
    anomalyDetectorFor(DEFAULT_ANOMALY_THRESHOLDS, cls);

  it('[TC-FX-PROVIDER-032] USDT/BOB 12.02 → 12.70 (+5.66 %) queda anómala con el umbral de 5 %', () => {
    expect(detector('STABLE').assess('12.70', baseline('12.02'))?.flagged).toBe(true);
    expect(detector('FIAT').assess('12.70', baseline('12.02'))?.flagged).toBe(true);
  });

  it('[TC-FX-PROVIDER-032] BTC/USDT 65000.00 → 70000.00 (+7.69 %) se acepta y 72000.00 (+10.77 %) queda anómala', () => {
    const d = detector('VOLATILE_CRYPTO');
    expect(d.assess('70000.00', baseline('65000.00'))).toMatchObject({
      variationPct: '7.6923',
      flagged: false,
    });
    expect(d.assess('72000.00', baseline('65000.00'))).toMatchObject({
      variationPct: '10.7692',
      flagged: true,
    });
  });

  it('[TC-FX-PROVIDER-032] los umbrales son configurables por clase', () => {
    const custom = { fiatStablePct: '2', volatilePct: '20' };
    expect(anomalyThresholdFor(custom, 'FIAT')).toBe('2');
    expect(anomalyThresholdFor(custom, 'VOLATILE_CRYPTO')).toBe('20');
    expect(
      anomalyDetectorFor(custom, 'VOLATILE_CRYPTO').assess('72000.00', baseline('65000.00'))?.flagged,
    ).toBe(false);
  });

  it('[TC-FX-PROVIDER-032] PBT: anómala si y solo si |variación| supera el umbral de su clase', () => {
    const value = fc
      .bigInt({ min: 1n, max: 10_000_000_000n })
      .map((n) => `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`);
    fc.assert(
      fc.property(
        fc.constantFrom('FIAT', 'STABLE', 'VOLATILE_CRYPTO') as fc.Arbitrary<
          'FIAT' | 'STABLE' | 'VOLATILE_CRYPTO'
        >,
        value,
        value,
        (cls, prev, next) => {
          const threshold = anomalyThresholdFor(DEFAULT_ANOMALY_THRESHOLDS, cls);
          const assessment = detector(cls).assess(next, baseline(prev));
          // Formulación independiente (sin dividir): |next − prev| × 100 > umbral × prev.
          const exceeds = dec(next).minus(prev).abs().times(100).gt(dec(threshold).times(prev));
          expect(assessment?.flagged).toBe(exceeds);
        },
      ),
      { numRuns: 500 },
    );
  }, 60_000);
});
