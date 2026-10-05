import { currency, type DomainError, Instant, Money, type Currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { totalCost } from './conversion-pricing.js';
import { ExchangeRate } from './exchange-rate.js';
import { ProviderSample } from './market-rate-provider.js';
import type { FxRateType } from './fx-types.js';
import { RateResolver, type RateCandidate } from './rate-resolver.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const USDT = currency('USDT', 6);
const TRX = currency('TRX', 6);

let n = 0;
function rate(base: Currency, quote: Currency, value: string, asOf: string, rateType: FxRateType = 'P2P') {
  n += 1;
  return ExchangeRate.record({
    id: `r${n}`,
    workspaceId: 'ws',
    base,
    quote,
    value,
    rateType,
    sourceLabel: `fuente ${n}`,
    asOf,
    effectiveDate: asOf.slice(0, 10),
    createdAt: asOf,
    createdBy: 'u1',
  });
}
const live = (...rates: ExchangeRate[]): RateCandidate[] =>
  rates.map((r) => ({ state: r.snapshot, supersededById: null }));
const at = (s: string) => Instant.parse(s);

describe('RateResolver (fx/market-rates)', () => {
  // R1 = 9.65 (error) reemplazada por R2 = 6.95, ambas del 2026-09-29; 6.93 del 2026-09-25.
  const old = rate(USDT, BOB, '6.93', '2026-09-25T19:00:00Z');
  const r1 = rate(USDT, BOB, '9.65', '2026-09-29T19:00:00Z');
  const r2 = r1.supersede(
    { id: 'R2', value: '6.95', reason: 'error de tipeo', createdAt: '2026-09-29T20:00:00Z', createdBy: 'u1' },
    null,
  );
  const candidates: RateCandidate[] = [
    { state: old.snapshot, supersededById: null },
    { state: r1.snapshot, supersededById: 'R2' },
    { state: r2.snapshot, supersededById: null },
  ];

  it('[TC-FX-RATE-003] la tasa vigente es la última no reemplazada dentro de la ventana de 7 días', () => {
    const found = new RateResolver(candidates).resolve({
      base: USDT,
      quote: BOB,
      at: at('2026-10-01T03:59:59Z'), // 2026-09-30T23:59:59-04:00
      rateType: 'P2P',
    });
    expect(found.fxRateId).toBe('R2');
    expect(found.rate.value.toFixed()).toBe('6.95');
    expect([found.derivation, found.effectiveDate, found.sourceLabel]).toEqual([
      'DIRECT',
      '2026-09-29',
      r1.snapshot.sourceLabel,
    ]);
  });

  it('[TC-FX-RATE-003] fuera de la ventana responde FX_RATE_NOT_FOUND sin valor aproximado ni 1:1', () => {
    const resolver = new RateResolver(candidates);
    let code: string | undefined;
    try {
      resolver.resolve({ base: USDT, quote: BOB, at: at('2026-10-10T16:00:00Z'), rateType: 'P2P' });
    } catch (err) {
      code = (err as DomainError).code;
    }
    expect(code).toBe('FX_RATE_NOT_FOUND');
    expect(
      resolver.resolveForConversion({ base: USDT, quote: BOB, at: at('2026-10-10T16:00:00Z') }),
    ).toBeNull();
    // Una tasa posterior al instante consultado nunca se usa.
    expect(resolver.tryResolve({ base: USDT, quote: BOB, at: at('2026-09-20T00:00:00Z') })).toBeNull();
  });

  it('[TC-FX-CONVERSION-001] la inversa de USD/BOB 6.96 se deriva de la original y valora 1000.00 BOB = 143.68 USD', () => {
    const usdBob = rate(USD, BOB, '6.96', '2026-09-30T12:00:00Z', 'OFFICIAL');
    const found = new RateResolver(live(usdBob)).resolve({
      base: BOB,
      quote: USD,
      at: at('2026-09-30T13:00:00Z'),
    });
    expect(found.derivation).toBe('INVERSE');
    expect(found.fxRateId).toBe(usdBob.id);
    expect(found.components.map((c) => c.id)).toEqual([usdBob.id]);
    expect(found.rate.toPersisted()).toBe('0.143678160919540230');
    expect(found.rate.isDerivedInverse).toBe(true);
    expect(found.rate.convert(Money.parse('1000.00', BOB)).toFixed()).toBe('143.68');
  });

  it('tasa cruzada USDT→BOB vía USD solo para valoración: 6.95304 y 100.000000 USDT = 695.30 BOB (aprox.)', () => {
    const resolver = new RateResolver(
      live(
        rate(USDT, USD, '0.9990', '2026-09-30T12:00:00Z', 'P2P'),
        rate(USD, BOB, '6.96', '2026-09-30T11:00:00Z', 'OFFICIAL'),
      ),
    );
    const q = { base: USDT, quote: BOB, at: at('2026-09-30T13:00:00Z') };
    const cross = resolver.resolve({ ...q, allowCross: true, pivot: USD });
    expect([cross.derivation, cross.fxRateId, cross.approx]).toEqual(['CROSS', null, true]);
    expect(cross.rate.value.toFixed()).toBe('6.95304');
    expect(cross.components).toHaveLength(2);
    expect(cross.rate.convert(Money.parse('100.000000', USDT)).toFixed()).toBe('695.30');
    // Una conversión real nunca usa una referencia cruzada.
    expect(resolver.resolveForConversion(q)).toBeNull();
    expect(resolver.tryResolve(q)).toBeNull();
  });

  it('[TC-FX-RATE-004] la valoración usa el tipo preferido del par; sin preferencia, PARALLEL', () => {
    const official = rate(USD, BOB, '6.96', '2026-09-30T12:00:00Z', 'OFFICIAL');
    const parallel = rate(USD, BOB, '9.80', '2026-09-30T12:00:00Z', 'PARALLEL');
    const resolver = new RateResolver(live(official, parallel));
    const q = { base: USD, quote: BOB, at: at('2026-09-30T23:00:00Z') };
    const amount = Money.parse('100.00', USD);
    const pref = (t: FxRateType) => (a: string, b: string) =>
      [a, b].sort().join('/') === 'BOB/USD' ? t : null;
    const withOfficial = resolver.resolve({ ...q, preferenceOf: pref('OFFICIAL') });
    expect([withOfficial.rateType, withOfficial.rate.convert(amount).toFixed()]).toEqual([
      'OFFICIAL',
      '696.00',
    ]);
    const withParallel = resolver.resolve({ ...q, preferenceOf: pref('PARALLEL') });
    expect([withParallel.rateType, withParallel.rate.convert(amount).toFixed()]).toEqual([
      'PARALLEL',
      '980.00',
    ]);
    // Sin preferencia: PARALLEL (docs/31 D48), aunque haya una de otro tipo más reciente (no fresca: > 24 h, D34);
    // antes se usaba la más reciente de cualquier tipo (BANK). Informa el tipo usado.
    const bank = rate(USD, BOB, '6.97', '2026-09-30T15:00:00Z', 'BANK');
    const byDefault = new RateResolver(live(official, parallel, bank)).resolve({
      ...q,
      at: at('2026-10-01T16:00:00Z'),
    });
    expect([byDefault.fxRateId, byDefault.rateType, byDefault.requestedRateType]).toEqual([
      parallel.id,
      'PARALLEL',
      'PARALLEL',
    ]);
    expect(official.valueText).toBe('6.96');
  });

  describe('[TC-FX-RATE-005] par sin preferencia: el tipo por defecto es PARALLEL (docs/31 D48)', () => {
    const BTC = currency('BTC', 8);
    const pAt = at('2026-10-05T12:00:00Z');
    // Las de otro tipo son más recientes que la PARALLEL pero no frescas (> 24 h): no entran al último recurso (D34).
    const usdtUsdParallel = rate(USDT, USD, '0.9990', '2026-10-02T12:00:00Z', 'PARALLEL');
    const usdtUsdP2p = rate(USDT, USD, '1.0010', '2026-10-04T09:00:00Z', 'P2P');
    const btcUsdtParallel = rate(BTC, USDT, '62000', '2026-10-01T12:00:00Z', 'PARALLEL');
    const btcUsdtCustom = rate(BTC, USDT, '62500', '2026-10-04T09:00:00Z', 'CUSTOM');
    const resolver = new RateResolver(live(usdtUsdParallel, usdtUsdP2p, btcUsdtParallel, btcUsdtCustom));
    const none = () => null;

    it('escenario del TC: USD/BOB sin preferencia, PARALLEL 9.80 (paralelo.bo) del 30/09 y OFFICIAL 6.96 del 01/10 → 980.00 BOB', () => {
      const parallelBo = ExchangeRate.fromProviderSample(
        ProviderSample.of({
          provider: 'PARALELO_BO',
          base: 'USD',
          quote: 'BOB',
          rateType: 'PARALLEL',
          value: '9.80',
          asOf: '2026-09-30T12:00:00Z',
          fetchedAt: '2026-09-30T12:00:00Z',
          rawPayload: '{}',
          sourceLabel: 'paralelo.bo',
        }),
        {
          id: 'P-9.80',
          workspaceId: 'ws',
          base: USD,
          quote: BOB,
          effectiveDate: '2026-09-30',
          createdAt: '2026-09-30T12:00:00Z',
          anomaly: null,
        },
      );
      const official = rate(USD, BOB, '6.96', '2026-10-01T12:00:00Z', 'OFFICIAL');
      const found = new RateResolver(live(parallelBo, official)).resolve({
        base: USD,
        quote: BOB,
        at: at('2026-10-02T03:59:59Z'), // 2026-10-01T23:59:59-04:00
        preferenceOf: () => null,
      });
      expect([found.fxRateId, found.rateType, found.requestedRateType, found.sourceLabel]).toEqual([
        'P-9.80',
        'PARALLEL',
        'PARALLEL',
        'paralelo.bo',
      ]);
      expect(found.rate.convert(Money.parse('100.00', USD)).toFixed()).toBe('980.00');
      // La OFFICIAL más reciente (fresca) no entra al último recurso: se desvía > 5 % de la PARALLEL (D34).
      expect(found.selection).toBe('LAST_KNOWN_STALE');
    });

    it('USDT/USD y BTC/USDT sin preferencia usan PARALLEL aunque haya otra más reciente de otro tipo', () => {
      const usdt = resolver.resolve({ base: USDT, quote: USD, at: pAt, preferenceOf: none });
      expect([usdt.fxRateId, usdt.rateType, usdt.requestedRateType]).toEqual([
        usdtUsdParallel.id,
        'PARALLEL',
        'PARALLEL',
      ]);
      const btc = resolver.resolve({ base: BTC, quote: USDT, at: pAt });
      expect([btc.fxRateId, btc.rateType, btc.rate.value.toFixed()]).toEqual([
        btcUsdtParallel.id,
        'PARALLEL',
        '62000',
      ]);
      // La referencia de una conversión real también usa PARALLEL (directa o inversa, nunca cruzada).
      const reference = resolver.resolveForConversion({ base: USDT, quote: BTC, at: pAt });
      expect([reference?.fxRateId, reference?.derivation, reference?.rateType]).toEqual([
        btcUsdtParallel.id,
        'INVERSE',
        'PARALLEL',
      ]);
    });

    it('una preferencia explícita del par o un tipo pedido siguen ganando sobre el default', () => {
      const preferP2p = (a: string, b: string) => ([a, b].sort().join('/') === 'USD/USDT' ? 'P2P' : null);
      const preferred = resolver.resolve({ base: USDT, quote: USD, at: pAt, preferenceOf: preferP2p });
      expect([preferred.fxRateId, preferred.rateType]).toEqual([usdtUsdP2p.id, 'P2P']);
      const requested = resolver.resolve({ base: BTC, quote: USDT, at: pAt, rateType: 'CUSTOM' });
      expect([requested.fxRateId, requested.rateType]).toEqual([btcUsdtCustom.id, 'CUSTOM']);
    });

    it('sin PARALLEL del par: FX_RATE_NOT_FOUND salvo el último recurso fresco (D34); la referencia de conversión queda vacía', () => {
      const onlyP2p = new RateResolver(live(rate(USDT, USD, '1.0010', '2026-10-01T11:00:00Z', 'P2P')));
      expect(onlyP2p.resolveForConversion({ base: USDT, quote: USD, at: pAt })).toBeNull();
      // Una manual de otro tipo vieja (> 24 h) no entra en el último recurso (D34).
      expect(onlyP2p.tryResolve({ base: USDT, quote: USD, at: pAt })).toBeNull();
      let code: string | undefined;
      try {
        onlyP2p.resolve({ base: USDT, quote: USD, at: pAt });
      } catch (err) {
        code = (err as DomainError).code;
      }
      expect(code).toBe('FX_RATE_NOT_FOUND');
      // Cadena de fallback vigente: una manual de otro tipo FRESCA (≤ 24 h) sí se usa para valorar (selection MANUAL),
      // pero nunca como referencia de una conversión real.
      const fresh = rate(USDT, USD, '1.0020', '2026-10-05T08:00:00Z', 'P2P');
      const withFresh = new RateResolver(live(fresh));
      const valued = withFresh.resolve({ base: USDT, quote: USD, at: pAt });
      expect([valued.fxRateId, valued.rateType, valued.requestedRateType, valued.selection]).toEqual([
        fresh.id,
        'P2P',
        'PARALLEL',
        'MANUAL',
      ]);
      expect(withFresh.resolveForConversion({ base: USDT, quote: USD, at: pAt })).toBeNull();
    });
  });
});

describe('ConversionPricingService.totalCost (fx/conversion-pricing)', () => {
  const ref = rate(USDT, BOB, '6.95', '2026-09-29T19:00:00Z').rate;
  const rateFor = (code: string) => (code === 'USDT' ? ref : null);

  it('[TC-FX-PRICING-004] canónica: 5.00 BOB de fee + 5.00 BOB de spread = 10.00 BOB = 100 × 6.95 − 685.00', () => {
    const cost = totalCost([Money.parse('5.00', BOB), Money.parse('5.00', BOB)], BOB, rateFor);
    expect([cost.amount.toFixed(), cost.complete]).toEqual(['10.00', true]);
    expect(ref.convert(Money.parse('100.000000', USDT)).subtract(Money.parse('685.00', BOB)).toFixed()).toBe(
      '10.00',
    );
  });

  it('[TC-FX-PRICING-004] compra: 0.100000 USDT (0.695 BOB) + 5.00 BOB = 5.695 → 5.70 BOB con un solo redondeo', () => {
    const cost = totalCost([Money.parse('0.100000', USDT), Money.parse('5.00', BOB)], BOB, rateFor);
    expect(cost.amount.toFixed()).toBe('5.70');
    // Redondear por componente daría 0.70 + 5.00 = 5.70 aquí, pero 0.695 se conserva exacto hasta el total.
    expect(cost.complete).toBe(true);
  });

  it('[TC-FX-PRICING-004] swap con fee de red en TRX sin tasa TRX/BOB: costo incompleto con missingValuations', () => {
    const cost = totalCost([Money.parse('2.000000', USDT), Money.parse('15.000000', TRX)], BOB, rateFor);
    expect(cost.complete).toBe(false);
    expect(cost.missingValuations.map((m) => m.toString())).toEqual(['15.000000 TRX']);
    expect(cost.amount.toFixed()).toBe('13.90');
  });
});
