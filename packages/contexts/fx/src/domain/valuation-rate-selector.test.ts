import fc from 'fast-check';
import { currency, DomainError, Instant, Money, type Currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ExchangeRate } from './exchange-rate.js';
import type { FxRateProvider, FxRateType } from './fx-types.js';
import { ProviderSample } from './market-rate-provider.js';
import { RateResolver, type RateCandidate } from './rate-resolver.js';
import { DEFAULT_VALUATION_POLICY } from './valuation-rate-selector.js';

// TDD de la selección de la tasa de valoración (fx/market-rate-providers; design.md decisión 6): principal →
// respaldo → última conocida obsoleta o manual más reciente → FX_RATE_NOT_FOUND. FixedClock implícito: cada caso
// valora a un instante fijo.
const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const USDT = currency('USDT', 6);
let seq = 0;
const id = () => `0192f3c4-0000-7000-8000-${(++seq).toString(16).padStart(12, '0')}`;

function providerRate(
  provider: FxRateProvider,
  value: string,
  asOf: string,
  over: {
    base?: Currency;
    anomaly?: { baselineRateId: string; variationPct: string };
    rateType?: FxRateType;
  } = {},
): ExchangeRate {
  const base = over.base ?? USD;
  const sample = ProviderSample.of({
    provider,
    base: base.code,
    quote: 'BOB',
    rateType: over.rateType ?? 'PARALLEL',
    value,
    asOf,
    fetchedAt: asOf,
    rawPayload: '{}',
    sourceLabel: provider === 'PARALELO_BO' ? 'paralelo.bo (mediana P2P USDT/BOB)' : 'bo.dolarapi.com',
  });
  return ExchangeRate.fromProviderSample(sample, {
    id: id(),
    workspaceId: 'ws',
    base,
    quote: BOB,
    effectiveDate: asOf.slice(0, 10),
    createdAt: asOf,
    anomaly: over.anomaly ?? null,
  });
}

const manualRate = (value: string, asOf: string, rateType: FxRateType = 'PARALLEL', base = USD) =>
  ExchangeRate.record({
    id: id(),
    workspaceId: 'ws',
    base,
    quote: BOB,
    value,
    rateType,
    source: 'MANUAL',
    asOf,
    effectiveDate: asOf.slice(0, 10),
    createdAt: asOf,
    createdBy: 'u1',
  });

const cand = (r: ExchangeRate, anomalyDecision: 'CONFIRMED' | 'REJECTED' | null = null): RateCandidate => ({
  state: r.snapshot,
  supersededById: null,
  anomalyDecision,
});

const value = (candidates: RateCandidate[], at: string, base: Currency = USD) =>
  new RateResolver(candidates).resolve({
    base,
    quote: BOB,
    at: Instant.parse(at),
    preferenceOf: () => 'PARALLEL',
  });

const hundredUsd = Money.parse('100.00', USD);

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
};

describe('ValuationRateSelector (fx/market-rate-providers)', () => {
  const primary = providerRate('PARALELO_BO', '12.02', '2026-10-02T08:53:07.532Z');
  const fallback = providerRate('DOLARAPI_BO', '12.055', '2026-10-02T09:50:00.000Z');

  it('[TC-FX-PROVIDER-007] principal disponible: 100.00 USD = 1202.00 BOB con 12.02 de paralelo.bo, PRIMARY, 412 s', () => {
    const r = value([cand(primary), cand(fallback)], '2026-10-02T09:00:00Z');
    expect(r.rate.convert(hundredUsd).toString()).toBe('1202.00 BOB');
    expect([r.fxRateId, r.provider, r.selection, r.stale, r.ageSeconds]).toEqual([
      primary.id,
      'PARALELO_BO',
      'PRIMARY',
      false,
      412,
    ]);
  });

  it('[TC-FX-PROVIDER-007] principal caído (66 min, obsoleto): 1205.50 BOB con 12.055 de bo.dolarapi.com, FALLBACK, 600 s', () => {
    const r = value([cand(primary), cand(fallback)], '2026-10-02T10:00:00Z');
    expect(r.rate.convert(hundredUsd).toString()).toBe('1205.50 BOB');
    expect([r.fxRateId, r.provider, r.selection, r.stale, r.ageSeconds]).toEqual([
      fallback.id,
      'DOLARAPI_BO',
      'FALLBACK',
      false,
      600,
    ]);
  });

  it('[TC-FX-PROVIDER-007] principal que responde pero repite el timestamp de 07:40Z (80 min) conmuta al respaldo', () => {
    const repeated = providerRate('PARALELO_BO', '12.02', '2026-10-02T07:40:00.000Z');
    const dolarapi = providerRate('DOLARAPI_BO', '12.055', '2026-10-02T08:50:00.000Z');
    const r = value([cand(repeated), cand(dolarapi)], '2026-10-02T09:00:00Z');
    expect(r.rate.convert(hundredUsd).toString()).toBe('1205.50 BOB');
    expect(r.selection).toBe('FALLBACK');
  });

  it('[TC-FX-PROVIDER-008] ambos caídos: 1202.00 BOB con 12.02 marcada obsoleta (LAST_KNOWN_STALE, 6 h)', () => {
    const r = value([cand(primary)], '2026-10-02T14:53:07.532Z');
    expect(r.rate.convert(hundredUsd).toString()).toBe('1202.00 BOB');
    expect([r.provider, r.selection, r.stale, r.ageSeconds]).toEqual([
      'PARALELO_BO',
      'LAST_KNOWN_STALE',
      true,
      21600,
    ]);
  });

  it('[TC-FX-PROVIDER-008] una tasa manual más reciente que la de provider gana: 1210.00 BOB, MANUAL, sin provider', () => {
    const manual = manualRate('12.10', '2026-10-02T13:00:00.000Z');
    const r = value([cand(primary), cand(manual)], '2026-10-02T14:00:00Z');
    expect(r.rate.convert(hundredUsd).toString()).toBe('1210.00 BOB');
    expect([r.fxRateId, r.source, r.selection, r.provider, r.stale]).toEqual([
      manual.id,
      'MANUAL',
      'MANUAL',
      null,
      false,
    ]);
  });

  it('[TC-FX-PROVIDER-008] sin tasa dentro de la ventana de 7 días responde FX_RATE_NOT_FOUND (nunca 1:1)', () => {
    const old = providerRate('PARALELO_BO', '11.90', '2026-09-20T12:00:00.000Z');
    const oldManual = manualRate('11.95', '2026-09-20T13:00:00.000Z');
    expect(codeOf(() => value([cand(old), cand(oldManual)], '2026-10-02T12:00:00Z'))).toBe(
      'FX_RATE_NOT_FOUND',
    );
  });

  it('[TC-FX-PROVIDER-010] una anomalía pendiente o rechazada no se usa; confirmada sí', () => {
    const jump = providerRate('PARALELO_BO', '13.50', '2026-10-02T09:08:00.000Z', {
      anomaly: { baselineRateId: primary.id, variationPct: '12.3128' },
    });
    const at = '2026-10-02T09:20:00Z';
    expect(
      value([cand(primary), cand(jump)], at)
        .rate.convert(hundredUsd)
        .toString(),
    ).toBe('1202.00 BOB');
    expect(
      value([cand(primary), cand(jump, 'REJECTED')], at)
        .rate.convert(hundredUsd)
        .toString(),
    ).toBe('1202.00 BOB');
    expect(
      value([cand(primary), cand(jump, 'CONFIRMED')], at)
        .rate.convert(hundredUsd)
        .toString(),
    ).toBe('1350.00 BOB');
  });

  it('[TC-FX-PROVIDER-007] la inversa (BOB → USD) usa la misma tasa elegida; tipos sin provider resuelven MANUAL', () => {
    const r = new RateResolver([cand(primary), cand(fallback)]).resolve({
      base: BOB,
      quote: USD,
      at: Instant.parse('2026-10-02T10:00:00Z'),
      preferenceOf: () => 'PARALLEL',
    });
    expect([r.derivation, r.fxRateId, r.selection]).toEqual(['INVERSE', fallback.id, 'FALLBACK']);
    const p2p = manualRate('11.98', '2026-10-02T09:10:00.000Z', 'P2P', USDT);
    const m = new RateResolver([cand(p2p)]).resolve({
      base: USDT,
      quote: BOB,
      at: Instant.parse('2026-10-02T09:12:00Z'),
      preferenceOf: () => 'P2P',
    });
    expect([m.fxRateId, m.selection, m.stale]).toEqual([p2p.id, 'MANUAL', false]);
  });

  it('[TC-FX-PROVIDER-009] la referencia de una conversión es la más reciente (sin niveles) y excluye anomalías pendientes', () => {
    const manual = manualRate('12.10', '2026-10-02T08:55:00.000Z');
    const jump = providerRate('PARALELO_BO', '13.50', '2026-10-02T08:58:00.000Z', {
      anomaly: { baselineRateId: primary.id, variationPct: '12.3128' },
    });
    const resolver = new RateResolver([cand(primary), cand(manual), cand(jump)]);
    const query = {
      base: USD,
      quote: BOB,
      at: Instant.parse('2026-10-02T09:00:00Z'),
      preferenceOf: () => 'PARALLEL' as const,
    };
    // Valoración: el principal fresco gana; referencia de conversión: la manual más reciente (decisión 7).
    expect(resolver.resolve(query).fxRateId).toBe(primary.id);
    expect(resolver.resolveForConversion(query)?.fxRateId).toBe(manual.id);
  });

  it('[TC-FX-PROVIDER-007] umbral configurable: con FX_STALE_AFTER_PARALLEL = 120m el principal de 66 min sigue siendo PRIMARY', () => {
    const resolver = new RateResolver([cand(primary), cand(fallback)], {
      ...DEFAULT_VALUATION_POLICY,
      staleAfterMs: { PARALLEL: 120 * 60_000, OFFICIAL: 48 * 3_600_000 },
    });
    const r = resolver.resolve({
      base: USD,
      quote: BOB,
      at: Instant.parse('2026-10-02T10:00:00Z'),
      preferenceOf: () => 'PARALLEL',
    });
    expect([r.fxRateId, r.selection]).toEqual([primary.id, 'PRIMARY']);
  });
});

describe('Umbral de obsolescencia propio del respaldo (decisión del owner 2026-10-03)', () => {
  const primary = providerRate('PARALELO_BO', '12.02', '2026-10-02T08:53:07.532Z');
  // bo.dolarapi.com publica `fechaActualizacion` con ~2 h de retraso.
  const lagging = providerRate('DOLARAPI_BO', '12.055', '2026-10-02T09:01:00.000Z');

  it('[TC-FX-PROVIDER-017] respaldo con 119 min de antigüedad (≤ 180 min de FX_STALE_AFTER_FALLBACK) sigue siendo FALLBACK, no obsoleto', () => {
    const r = value([cand(primary), cand(lagging)], '2026-10-02T11:00:00Z');
    expect(r.rate.convert(hundredUsd).toString()).toBe('1205.50 BOB');
    expect([r.fxRateId, r.provider, r.selection, r.stale, r.ageSeconds]).toEqual([
      lagging.id,
      'DOLARAPI_BO',
      'FALLBACK',
      false,
      7140,
    ]);
  });

  it('[TC-FX-PROVIDER-017] respaldo de más de 180 min queda obsoleto: última conocida (LAST_KNOWN_STALE)', () => {
    const r = value([cand(primary), cand(lagging)], '2026-10-02T12:30:00Z');
    expect([r.fxRateId, r.selection, r.stale, r.ageSeconds]).toEqual([
      lagging.id,
      'LAST_KNOWN_STALE',
      true,
      12_540,
    ]);
  });

  it('[TC-FX-PROVIDER-017] el umbral del respaldo no relaja al principal ni a OFFICIAL: el principal de 67 min está obsoleto', () => {
    const r = value([cand(primary)], '2026-10-02T10:00:00Z');
    expect([r.selection, r.stale]).toEqual(['LAST_KNOWN_STALE', true]);
    // Roles invertidos por configuración: bo.dolarapi.com principal usa 60 min; paralelo.bo respaldo usa 180 min.
    const swapped = new RateResolver([cand(primary), cand(lagging)], {
      ...DEFAULT_VALUATION_POLICY,
      roles: {
        ...DEFAULT_VALUATION_POLICY.roles,
        PARALLEL: { primary: 'DOLARAPI_BO', fallback: 'PARALELO_BO' },
      },
    }).resolve({
      base: USD,
      quote: BOB,
      at: Instant.parse('2026-10-02T10:30:00Z'),
      preferenceOf: () => 'PARALLEL',
    });
    expect([swapped.fxRateId, swapped.selection, swapped.stale]).toEqual([primary.id, 'FALLBACK', false]);
    const official = providerRate('DOLARAPI_BO', '12', '2026-10-01T00:00:00.000Z', { rateType: 'OFFICIAL' });
    const o = new RateResolver([cand(official)]).resolve({
      base: USD,
      quote: BOB,
      at: Instant.parse('2026-10-02T23:00:00Z'),
      rateType: 'OFFICIAL',
    });
    expect([o.selection, o.stale]).toEqual(['PRIMARY', false]);
  });

  it('[TC-FX-PROVIDER-017] el umbral del respaldo es configurable (FX_STALE_AFTER_FALLBACK = 60m vuelve al comportamiento anterior)', () => {
    const r = new RateResolver([cand(primary), cand(lagging)], {
      ...DEFAULT_VALUATION_POLICY,
      fallbackStaleAfterMs: { PARALLEL: 60 * 60_000 },
    }).resolve({
      base: USD,
      quote: BOB,
      at: Instant.parse('2026-10-02T11:00:00Z'),
      preferenceOf: () => 'PARALLEL',
    });
    expect([r.fxRateId, r.selection, r.stale]).toEqual([lagging.id, 'LAST_KNOWN_STALE', true]);
  });
});

describe('Compra y venta como tipos propios (decisión del owner 2026-10-03)', () => {
  const median = providerRate('PARALELO_BO', '12.02', '2026-10-02T08:53:07.532Z');
  const buy = providerRate('PARALELO_BO', '12.12', '2026-10-02T08:53:07.532Z', { rateType: 'PARALLEL_BUY' });
  const sell = providerRate('PARALELO_BO', '11.92', '2026-10-02T08:53:07.532Z', {
    rateType: 'PARALLEL_SELL',
  });
  const at = Instant.parse('2026-10-02T09:00:00Z');

  it('[TC-FX-PROVIDER-016] la valoración por defecto (PARALLEL o sin preferencia) sigue usando la mediana 12.02', () => {
    const all = [cand(sell), cand(median), cand(buy)];
    const resolver = new RateResolver(all);
    expect(value(all, '2026-10-02T09:00:00Z').fxRateId).toBe(median.id);
    const any = resolver.resolve({ base: USD, quote: BOB, at, preferenceOf: () => null });
    expect([any.fxRateId, any.rateType]).toEqual([median.id, 'PARALLEL']);
    expect(resolver.resolveForConversion({ base: USD, quote: BOB, at })?.fxRateId).toBe(median.id);
    // Sin la mediana, compra/venta nunca la sustituyen implícitamente.
    expect(new RateResolver([cand(buy), cand(sell)]).tryResolve({ base: USD, quote: BOB, at })).toBeNull();
  });

  it('[TC-FX-PROVIDER-016] pedida explícitamente, la compra 12.12 se elige con los niveles y la obsolescencia de PARALLEL', () => {
    const resolver = new RateResolver([cand(sell), cand(median), cand(buy)]);
    const r = resolver.resolve({ base: USD, quote: BOB, at, rateType: 'PARALLEL_BUY' });
    expect([r.fxRateId, r.rate.value.toFixed(), r.selection, r.stale, r.provider]).toEqual([
      buy.id,
      '12.12',
      'PRIMARY',
      false,
      'PARALELO_BO',
    ]);
    const late = resolver.resolve({
      base: USD,
      quote: BOB,
      at: Instant.parse('2026-10-02T10:00:00Z'),
      preferenceOf: () => 'PARALLEL_SELL',
    });
    expect([late.fxRateId, late.selection, late.stale]).toEqual([sell.id, 'LAST_KNOWN_STALE', true]);
  });
});

describe('Manual de otro tipo en el fallback (decisión del owner 2026-10-03)', () => {
  const primary = providerRate('PARALELO_BO', '12.02', '2026-10-02T08:53:07.532Z');
  const at = '2026-10-02T14:00:00Z';

  it('[TC-FX-PROVIDER-018] sin providers vigentes, una manual P2P de 30 min (≤ 24 h, desvío −0.33 % ≤ 5 %) se usa, marcada con el tipo usado', () => {
    const p2p = manualRate('11.98', '2026-10-02T13:30:00.000Z', 'P2P');
    const r = value([cand(primary), cand(p2p)], at);
    expect(r.rate.convert(hundredUsd).toString()).toBe('1198.00 BOB');
    expect([r.fxRateId, r.selection, r.source, r.rateType, r.requestedRateType, r.stale, r.provider]).toEqual(
      [p2p.id, 'MANUAL', 'MANUAL', 'P2P', 'PARALLEL', false, null],
    );
  });

  it('[TC-FX-PROVIDER-018] una manual de otro tipo de más de 24 h (FX_MANUAL_FALLBACK_MAX_AGE) NO se usa; de 90 min sí', () => {
    const recent = manualRate('11.98', '2026-10-02T12:30:00.000Z', 'P2P');
    expect(value([cand(primary), cand(recent)], at).fxRateId).toBe(recent.id);
    const p2p = manualRate('11.98', '2026-10-01T13:00:00.000Z', 'P2P');
    const r = value([cand(primary), cand(p2p)], at);
    expect([r.fxRateId, r.selection, r.stale, r.rateType]).toEqual([
      primary.id,
      'LAST_KNOWN_STALE',
      true,
      'PARALLEL',
    ]);
    expect(codeOf(() => value([cand(p2p)], at))).toBe('FX_RATE_NOT_FOUND');
    // Configurable: con 26 h la misma manual vuelve a valer.
    const relaxed = new RateResolver([cand(p2p)], {
      ...DEFAULT_VALUATION_POLICY,
      manualFallbackMaxAgeMs: 26 * 3_600_000,
    }).resolve({ base: USD, quote: BOB, at: Instant.parse(at), preferenceOf: () => 'PARALLEL' });
    expect(relaxed.fxRateId).toBe(p2p.id);
  });

  it('[TC-FX-PROVIDER-018] una manual de otro tipo con desvío > 5 % respecto de la última tasa de provider NO se usa', () => {
    const far = manualRate('12.70', '2026-10-02T13:30:00.000Z', 'P2P'); // +5.66 % vs 12.02
    const near = manualRate('12.62', '2026-10-02T13:30:00.000Z', 'BANK'); // +4.99 %
    expect(value([cand(primary), cand(far)], at).fxRateId).toBe(primary.id);
    expect(value([cand(primary), cand(near)], at).fxRateId).toBe(near.id);
    // La referencia también vale en la orientación inversa (manual BOB/USD).
    const inverse = ExchangeRate.record({
      id: id(),
      workspaceId: 'ws',
      base: BOB,
      quote: USD,
      value: '0.07874',
      rateType: 'P2P',
      source: 'MANUAL',
      asOf: '2026-10-02T13:30:00.000Z',
      effectiveDate: '2026-10-02',
      createdAt: '2026-10-02T13:30:00.000Z',
      createdBy: 'u1',
    }); // 1/0.07874 = 12.70 BOB por USD ⇒ desvío > 5 %
    expect(value([cand(primary), cand(inverse)], at).fxRateId).toBe(primary.id);
    // Sin tasa de provider no hay referencia: solo rige la antigüedad.
    expect(value([cand(far)], at).fxRateId).toBe(far.id);
  });

  it('[TC-FX-PROVIDER-018] nunca reemplazada, con anomalía pendiente/rechazada, con asOf > t ni de compra/venta', () => {
    const p2p = manualRate('11.98', '2026-10-02T13:30:00.000Z', 'P2P');
    const flagged = { ...p2p.snapshot, anomaly: { baselineRateId: primary.id, variationPct: '9.0000' } };
    const future = manualRate('11.97', '2026-10-02T14:00:01.000Z', 'BANK');
    const buy = manualRate('12.12', '2026-10-02T13:45:00.000Z', 'PARALLEL_BUY');
    const used = (cs: RateCandidate[]) => value([cand(primary), ...cs], at).fxRateId;
    expect(used([{ state: p2p.snapshot, supersededById: 'v2', anomalyDecision: null }])).toBe(primary.id);
    expect(used([{ state: flagged, supersededById: null, anomalyDecision: null }])).toBe(primary.id);
    expect(used([{ state: flagged, supersededById: null, anomalyDecision: 'REJECTED' }])).toBe(primary.id);
    expect(used([{ state: flagged, supersededById: null, anomalyDecision: 'CONFIRMED' }])).toBe(p2p.id);
    expect(used([cand(future)])).toBe(primary.id);
    expect(used([cand(buy)])).toBe(primary.id);
  });

  it('[TC-FX-PROVIDER-018] los niveles de provider van primero y la manual del tipo pedido no exige frescura', () => {
    const p2p = manualRate('11.98', '2026-10-02T09:00:00.000Z', 'P2P');
    expect(value([cand(primary), cand(p2p)], '2026-10-02T09:00:00Z').fxRateId).toBe(primary.id);
    const sameType = manualRate('12.10', '2026-10-02T10:00:00.000Z');
    const fresher = manualRate('11.98', '2026-10-02T13:10:00.000Z', 'P2P');
    // P2P de 50 min (fresca) es más reciente que la manual PARALLEL de 4 h: gana la más reciente.
    expect(value([cand(primary), cand(sameType), cand(fresher)], at).fxRateId).toBe(fresher.id);
    // Sin P2P fresca, la manual PARALLEL de 4 h sigue valiendo (comportamiento de fx/market-rates).
    const r = value([cand(primary), cand(sameType)], at);
    expect([r.fxRateId, r.rateType, r.requestedRateType]).toEqual([sameType.id, 'PARALLEL', 'PARALLEL']);
  });

  it('[TC-FX-PROVIDER-018] sin umbral para el tipo pedido (P2P) no hay sustitución; la referencia de conversión no cambia', () => {
    const parallel = manualRate('12.05', '2026-10-02T13:55:00.000Z');
    expect(
      new RateResolver([cand(parallel)]).tryResolve({
        base: USD,
        quote: BOB,
        at: Instant.parse(at),
        preferenceOf: () => 'P2P',
      }),
    ).toBeNull();
    const p2p = manualRate('11.98', '2026-10-02T13:30:00.000Z', 'P2P');
    const ref = new RateResolver([cand(primary), cand(p2p)]).resolveForConversion({
      base: USD,
      quote: BOB,
      at: Instant.parse(at),
      preferenceOf: () => 'PARALLEL',
    });
    expect(ref?.fxRateId).toBe(primary.id);
  });
});

describe('Propiedades de la selección (fx/market-rate-providers)', () => {
  const START = Date.parse('2026-09-20T00:00:00Z');
  const HOUR = 3_600_000;
  const providers = fc.constantFrom<FxRateProvider | null>('PARALELO_BO', 'DOLARAPI_BO', null);
  const candidate = fc.record({
    provider: providers,
    offsetMin: fc.integer({ min: 0, max: 20 * 24 * 60 }),
    cents: fc.integer({ min: 900, max: 1500 }),
    superseded: fc.boolean(),
    anomaly: fc.constantFrom<'none' | 'PENDING' | 'CONFIRMED' | 'REJECTED'>(
      'none',
      'none',
      'PENDING',
      'CONFIRMED',
      'REJECTED',
    ),
  });

  it('[TC-FX-PROVIDER-007] nunca devuelve una tasa con asOf > t, fuera de la ventana, reemplazada ni anómala sin confirmar', () => {
    fc.assert(
      fc.property(
        fc.array(candidate, { maxLength: 12 }),
        fc.integer({ min: 0, max: 20 * 24 }),
        (specs, atHours) => {
          const candidates = specs.map((s): RateCandidate => {
            const asOf = new Date(START + s.offsetMin * 60_000).toISOString();
            const v = `${Math.trunc(s.cents / 100)}.${String(s.cents % 100).padStart(2, '0')}`;
            const r =
              s.provider === null
                ? manualRate(v, asOf)
                : providerRate(s.provider, v, asOf, {
                    ...(s.anomaly !== 'none'
                      ? { anomaly: { baselineRateId: 'b', variationPct: '6.0000' } }
                      : {}),
                  });
            return {
              state: r.snapshot,
              supersededById: s.superseded ? 'other' : null,
              anomalyDecision:
                s.provider !== null && (s.anomaly === 'CONFIRMED' || s.anomaly === 'REJECTED')
                  ? s.anomaly
                  : null,
            };
          });
          const at = Instant.ofEpochMillis(START + atHours * HOUR);
          const found = new RateResolver(candidates).tryResolve({
            base: USD,
            quote: BOB,
            at,
            preferenceOf: () => 'PARALLEL',
          });
          if (!found) return;
          const used = candidates.find((c) => c.state.id === found.fxRateId);
          expect(used).toBeDefined();
          const t = Date.parse(used!.state.asOf);
          expect(t).toBeLessThanOrEqual(at.epochMillis);
          expect(t).toBeGreaterThanOrEqual(at.epochMillis - 7 * 24 * HOUR);
          expect(used!.supersededById).toBeNull();
          if (used!.state.anomaly !== null) expect(used!.anomalyDecision).toBe('CONFIRMED');
          // Si hay una tasa principal fresca y usable, se elige el nivel PRIMARY.
          if (found.selection === 'LAST_KNOWN_STALE') expect(found.provider).not.toBeNull();
        },
      ),
      { numRuns: 300 },
    );
  });

  const anyType = fc.constantFrom<FxRateType>(
    'OFFICIAL',
    'PARALLEL',
    'P2P',
    'BANK',
    'CUSTOM',
    'PARALLEL_BUY',
    'PARALLEL_SELL',
  );
  const mixed = fc.record({
    provider: providers,
    rateType: anyType,
    offsetMin: fc.integer({ min: 0, max: 3 * 24 * 60 }),
    cents: fc.integer({ min: 900, max: 1500 }),
    superseded: fc.boolean(),
    anomaly: fc.constantFrom<'none' | 'PENDING' | 'CONFIRMED' | 'REJECTED'>(
      'none',
      'none',
      'PENDING',
      'CONFIRMED',
      'REJECTED',
    ),
  });

  it('[TC-FX-PROVIDER-018] otro tipo solo si es manual, ≤ antigüedad máxima, desvío ≤ 5 % vs provider, no reemplazada, sin anomalía sin confirmar, asOf ≤ t y marcada', () => {
    const BASE = Date.parse('2026-09-30T00:00:00Z');
    fc.assert(
      fc.property(
        fc.array(mixed, { maxLength: 14 }),
        fc.integer({ min: 0, max: 3 * 24 * 60 }),
        fc.integer({ min: 1, max: 48 * 60 }),
        fc.constantFrom<FxRateType>('PARALLEL', 'OFFICIAL'),
        (specs, atMin, maxAgeMin, requested) => {
          const candidates = specs.map((s): RateCandidate => {
            const asOf = new Date(BASE + s.offsetMin * 60_000).toISOString();
            const v = `${Math.trunc(s.cents / 100)}.${String(s.cents % 100).padStart(2, '0')}`;
            const r =
              s.provider === null
                ? manualRate(v, asOf, s.rateType)
                : providerRate(s.provider, v, asOf, { rateType: s.rateType });
            const state =
              s.anomaly === 'none'
                ? r.snapshot
                : { ...r.snapshot, anomaly: { baselineRateId: 'b', variationPct: '6.0000' } };
            return {
              state,
              supersededById: s.superseded ? 'other' : null,
              anomalyDecision: s.anomaly === 'CONFIRMED' || s.anomaly === 'REJECTED' ? s.anomaly : null,
            };
          });
          const policy = { ...DEFAULT_VALUATION_POLICY, manualFallbackMaxAgeMs: maxAgeMin * 60_000 };
          const at = Instant.ofEpochMillis(BASE + atMin * 60_000);
          const found = new RateResolver(candidates, policy).tryResolve({
            base: USD,
            quote: BOB,
            at,
            preferenceOf: () => requested,
          });
          if (!found) return;
          expect(found.requestedRateType).toBe(requested);
          const used = candidates.find((c) => c.state.id === found.fxRateId);
          expect(used).toBeDefined();
          expect(used!.supersededById).toBeNull();
          if (used!.state.anomaly !== null) expect(used!.anomalyDecision).toBe('CONFIRMED');
          const age = at.epochMillis - Date.parse(used!.state.asOf);
          expect(age).toBeGreaterThanOrEqual(0);
          if (found.rateType !== requested) {
            expect(used!.state.source).not.toBe('PROVIDER');
            expect(found.selection).toBe('MANUAL');
            expect(['PARALLEL_BUY', 'PARALLEL_SELL']).not.toContain(found.rateType);
            expect(age).toBeLessThanOrEqual(maxAgeMin * 60_000);
            expect(found.stale).toBe(false);
            // Referencia: última tasa de provider usable del tipo pedido (asOf ≤ t, ventana de 7 días).
            const reference = candidates
              .filter(
                (c) =>
                  c.state.source === 'PROVIDER' &&
                  c.state.rateType === requested &&
                  c.supersededById === null &&
                  (c.state.anomaly === null || c.anomalyDecision === 'CONFIRMED') &&
                  Date.parse(c.state.asOf) <= at.epochMillis &&
                  Date.parse(c.state.asOf) >= at.epochMillis - 7 * 24 * 3_600_000,
              )
              .map((c) => c.state)
              .sort((x, y) =>
                x.asOf !== y.asOf
                  ? Date.parse(x.asOf) - Date.parse(y.asOf)
                  : x.createdAt !== y.createdAt
                    ? x.createdAt < y.createdAt
                      ? -1
                      : 1
                    : x.id < y.id
                      ? -1
                      : 1,
              )
              .at(-1);
            if (reference) {
              const p = reference.rate.value;
              expect(used!.state.rate.value.minus(p).abs().div(p).times(100).lte(5)).toBe(true);
            }
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
