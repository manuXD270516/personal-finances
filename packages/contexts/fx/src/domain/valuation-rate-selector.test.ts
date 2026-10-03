import fc from 'fast-check';
import { currency, DomainError, Instant, Money, type Currency } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ExchangeRate } from './exchange-rate.js';
import type { FxRateProvider } from './fx-types.js';
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
  over: { base?: Currency; anomaly?: { baselineRateId: string; variationPct: string } } = {},
): ExchangeRate {
  const base = over.base ?? USD;
  const sample = ProviderSample.of({
    provider,
    base: base.code,
    quote: 'BOB',
    rateType: 'PARALLEL',
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

const manualRate = (value: string, asOf: string, rateType: 'PARALLEL' | 'P2P' = 'PARALLEL', base = USD) =>
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
});
