import { currency, Instant, Money, type Currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ExchangeRate } from './exchange-rate.js';
import type { FxRateProvider, FxRateType } from './fx-types.js';
import { ProviderSample } from './market-rate-provider.js';
import { AssetClassPolicy, type CurrencyRef } from './rate-pairs.js';
import { RateResolver, type RateCandidate } from './rate-resolver.js';
import { DEFAULT_VALUATION_POLICY, type ValuationPolicy } from './valuation-rate-selector.js';

// TDD de la valoración cripto (fx/market-rates + fx/market-rate-providers; add-crypto-rate-providers decisiones 7 y 8):
// tipo MARKET por defecto de los pares cripto, pivote del par configurado y fallback entre providers cripto.
const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const USDT = currency('USDT', 6);
const BTC = currency('BTC', 8);
const PRIMARY: FxRateProvider = 'CRYPTO_TEST_PRIMARY';
const FALLBACK: FxRateProvider = 'CRYPTO_TEST_FALLBACK';

const POLICY: ValuationPolicy = {
  ...DEFAULT_VALUATION_POLICY,
  roles: { ...DEFAULT_VALUATION_POLICY.roles, MARKET: { primary: PRIMARY, fallback: FALLBACK } },
};
const KINDS: Readonly<Record<string, CurrencyRef>> = {
  BOB: { code: 'BOB', kind: 'FIAT' },
  USD: { code: 'USD', kind: 'FIAT' },
  USDT: { code: 'USDT', kind: 'CRYPTO' },
  BTC: { code: 'BTC', kind: 'CRYPTO' },
};
const classes = new AssetClassPolicy();
const assetClassOf = (code: string) => (KINDS[code] ? classes.classOf(KINDS[code] as CurrencyRef) : null);

let seq = 0;
const id = () => `0192f3c4-0000-7000-8000-${(++seq).toString(16).padStart(12, '0')}`;

function providerRate(
  provider: FxRateProvider,
  base: Currency,
  quote: Currency,
  rateType: FxRateType,
  value: string,
  asOf: string,
): RateCandidate {
  const sample = ProviderSample.of({
    provider,
    base: base.code,
    quote: quote.code,
    rateType,
    value,
    asOf,
    fetchedAt: asOf,
    rawPayload: '{}',
    sourceLabel: provider,
  });
  const rate = ExchangeRate.fromProviderSample(sample, {
    id: id(),
    workspaceId: 'ws',
    base,
    quote,
    effectiveDate: asOf.slice(0, 10),
    createdAt: asOf,
    anomaly: null,
  });
  return { state: rate.snapshot, supersededById: null };
}

const resolver = (candidates: RateCandidate[]) => new RateResolver(candidates, POLICY);
const at = (s: string) => Instant.parse(s);

describe('Valoración cripto (fx/market-rates)', () => {
  it('[TC-FX-RATE-007] 0.01500000 BTC se valoran en BOB con la cruzada 781300.00 por el pivote USDT del par configurado', () => {
    const r = resolver([
      providerRate(PRIMARY, BTC, USDT, 'MARKET', '65000.00', '2026-10-13T14:00:00Z'),
      providerRate('PARALELO_BO', USDT, BOB, 'PARALLEL', '12.02', '2026-10-13T14:00:00Z'),
    ]).resolve({
      base: BTC,
      quote: BOB,
      at: at('2026-10-13T14:05:00Z'),
      allowCross: true,
      pivot: USD,
      pivotOf: (code) => (code === 'BTC' ? USDT : null),
      assetClassOf,
    });
    expect(r.derivation).toBe('CROSS');
    expect(r.approx).toBe(true);
    expect(r.rate.value.toFixed()).toBe('781300');
    expect(r.rate.convert(Money.parse('0.01500000', BTC)).toString()).toBe('11719.50 BOB');
    expect(r.components.map((c) => [c.rate.base.code, c.rate.quote.code, c.rateType, c.provider])).toEqual([
      ['BTC', 'USDT', 'MARKET', PRIMARY],
      ['USDT', 'BOB', 'PARALLEL', 'PARALELO_BO'],
    ]);
  });

  it('[TC-FX-RATE-007] sin par configurado la cruzada usa USD y, sin BTC/USD, no hay tasa (nunca 1:1)', () => {
    const only = resolver([
      providerRate(PRIMARY, BTC, USDT, 'MARKET', '65000.00', '2026-10-13T14:00:00Z'),
      providerRate('PARALELO_BO', USDT, BOB, 'PARALLEL', '12.02', '2026-10-13T14:00:00Z'),
    ]);
    expect(
      only.tryResolve({
        base: BTC,
        quote: BOB,
        at: at('2026-10-13T14:05:00Z'),
        allowCross: true,
        pivot: USD,
        assetClassOf,
      }),
    ).toBeNull();
  });

  it('[TC-FX-RATE-007] una conversión real BTC→BOB nunca usa la cruzada como referencia', () => {
    const r = resolver([
      providerRate(PRIMARY, BTC, USDT, 'MARKET', '65000.00', '2026-10-13T14:00:00Z'),
      providerRate('PARALELO_BO', USDT, BOB, 'PARALLEL', '12.02', '2026-10-13T14:00:00Z'),
    ]);
    expect(
      r.resolveForConversion({ base: BTC, quote: BOB, at: at('2026-10-13T14:05:00Z'), assetClassOf }),
    ).toBeNull();
  });

  it('[TC-FX-RATE-007] regresión: USDT→BOB sin USDT/BOB se sigue cruzando por USD (la quote del par es el destino)', () => {
    const usdt = providerRate('PARALELO_BO', USDT, USD, 'PARALLEL', '0.9990', '2026-10-13T14:00:00Z');
    const usd = providerRate('PARALELO_BO', USD, BOB, 'PARALLEL', '6.96', '2026-10-13T14:00:00Z');
    const r = resolver([usdt, usd]).resolve({
      base: USDT,
      quote: BOB,
      at: at('2026-10-13T14:05:00Z'),
      allowCross: true,
      pivot: USD,
      // Configurado USDT/BOB: la quote es el destino, así que se usa el pivote por defecto.
      pivotOf: (code) => (code === 'USDT' ? BOB : null),
      assetClassOf,
    });
    expect(r.rate.value.toFixed()).toBe('6.95304');
  });

  it('[TC-FX-RATE-008] BTC/USDT sin preferencia se valora con MARKET: 0.01000000 BTC = 650.000000 USDT', () => {
    const market = providerRate(PRIMARY, BTC, USDT, 'MARKET', '65000.00', '2026-10-13T14:00:00Z');
    const parallelNoise = providerRate('PARALELO_BO', BTC, USDT, 'PARALLEL', '1.00', '2026-10-13T14:03:00Z');
    const r = resolver([market, parallelNoise]).resolve({
      base: BTC,
      quote: USDT,
      at: at('2026-10-13T14:05:00Z'),
      assetClassOf,
    });
    expect(r.rateType).toBe('MARKET');
    expect(r.requestedRateType).toBe('MARKET');
    expect(r.rate.value.toFixed()).toBe('65000');
    expect(r.rate.convert(Money.parse('0.01000000', BTC)).toString()).toBe('650.000000 USDT');
  });

  it('[TC-FX-RATE-008] regresión: USD/BOB sin preferencia sigue usando PARALLEL', () => {
    const parallel = providerRate('PARALELO_BO', USD, BOB, 'PARALLEL', '9.80', '2026-09-30T12:00:00Z');
    const official = providerRate('DOLARAPI_BO', USD, BOB, 'OFFICIAL', '6.96', '2026-10-01T12:00:00Z');
    const r = new RateResolver([parallel, official]).resolve({
      base: USD,
      quote: BOB,
      at: at('2026-10-01T13:00:00Z'),
      assetClassOf,
    });
    expect([r.rateType, r.rate.value.toFixed()]).toEqual(['PARALLEL', '9.8']);
  });

  it('[TC-FX-RATE-008] una preferencia explícita del par gana sobre el default MARKET', () => {
    const market = providerRate(PRIMARY, BTC, USDT, 'MARKET', '65000.00', '2026-10-13T14:00:00Z');
    const manual = ExchangeRate.record({
      id: id(),
      workspaceId: 'ws',
      base: BTC,
      quote: USDT,
      value: '64000.00',
      rateType: 'P2P',
      source: 'MANUAL',
      asOf: '2026-10-13T13:00:00Z',
      effectiveDate: '2026-10-13',
      createdAt: '2026-10-13T13:00:00Z',
      createdBy: 'u1',
    });
    const r = resolver([market, { state: manual.snapshot, supersededById: null }]).resolve({
      base: BTC,
      quote: USDT,
      at: at('2026-10-13T14:05:00Z'),
      preferenceOf: () => 'P2P',
      assetClassOf,
    });
    expect([r.rateType, r.rate.value.toFixed()]).toEqual(['P2P', '64000']);
  });
});

describe('Fallback entre providers cripto (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-033] con el principal a 70 minutos se usa el respaldo: 0.01000000 BTC = 651.000000 USDT', () => {
    const r = resolver([
      providerRate(PRIMARY, BTC, USDT, 'MARKET', '65000.00', '2026-10-13T12:50:00Z'),
      providerRate(FALLBACK, BTC, USDT, 'MARKET', '65100.00', '2026-10-13T13:58:00Z'),
    ]).resolve({ base: BTC, quote: USDT, at: at('2026-10-13T14:00:00Z'), assetClassOf });
    expect(r.selection).toBe('FALLBACK');
    expect(r.stale).toBe(false);
    expect([r.provider, r.rate.value.toFixed(), r.ageSeconds]).toEqual([FALLBACK, '65100', 120]);
    expect(r.rate.convert(Money.parse('0.01000000', BTC)).toString()).toBe('651.000000 USDT');
  });

  it('[TC-FX-PROVIDER-033] con el principal vigente (10 minutos) el nivel es PRIMARY', () => {
    const r = resolver([
      providerRate(PRIMARY, BTC, USDT, 'MARKET', '65000.00', '2026-10-13T13:50:00Z'),
      providerRate(FALLBACK, BTC, USDT, 'MARKET', '65100.00', '2026-10-13T13:58:00Z'),
    ]).resolve({ base: BTC, quote: USDT, at: at('2026-10-13T14:00:00Z'), assetClassOf });
    expect([r.selection, r.provider]).toEqual(['PRIMARY', PRIMARY]);
  });

  it('[TC-FX-PROVIDER-033] el respaldo cripto usa el umbral de 60 minutos de MARKET (no los 180 de PARALLEL)', () => {
    const r = resolver([
      providerRate(FALLBACK, BTC, USDT, 'MARKET', '65100.00', '2026-10-13T12:30:00Z'),
    ]).resolve({
      base: BTC,
      quote: USDT,
      at: at('2026-10-13T14:00:00Z'),
      assetClassOf,
    });
    expect([r.selection, r.stale]).toEqual(['LAST_KNOWN_STALE', true]);
  });
});
