import fc from 'fast-check';
import { currency, dec, Instant, Money } from '@pf/shared-kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { ExchangeRate } from './exchange-rate.js';
import {
  FX_RATE_TYPES,
  INSTITUTION_RATE_TYPES,
  isInstitutionProviderId,
  isInstitutionRateType,
  isOneSidedRateType,
  type FxRateProvider,
  type FxRateType,
} from './fx-types.js';
import {
  providerDescriptor,
  ProviderSample,
  registerProviderDescriptor,
  registeredInstitutionDescriptors,
  type ProviderDescriptor,
} from './market-rate-provider.js';
import { RateResolver, type RateCandidate } from './rate-resolver.js';
import { type ValuationPolicy } from './valuation-rate-selector.js';

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const PROVIDER = 'INSTRATE_TEST' as const;
const AS_OF = '2026-10-08T16:00:00Z';
const FETCHED = '2026-10-08T16:05:00Z';

const sample = (
  code: string | null,
  value: string,
  rateType: FxRateType = 'BANK_SELL',
  provider: FxRateProvider = PROVIDER,
) =>
  ProviderSample.of({
    provider,
    base: 'USD',
    quote: 'BOB',
    rateType,
    value,
    asOf: AS_OF,
    fetchedAt: FETCHED,
    rawPayload: `{"entidad":"${code}","valor":"${value}"}`,
    sourceLabel: 'Fuente simulada de tasas por institución (prueba)',
    institutionCode: code,
  });

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
};

const unregister: (() => void)[] = [];
afterEach(() => {
  for (const off of unregister.splice(0)) off();
});

describe('tipos de tasa por institución (fx/market-rate-providers)', () => {
  it('BANK_BUY y BANK_SELL son tipos propios de un solo lado, distintos de BANK, y los ids INSTRATE_ son de providers por institución', () => {
    expect(FX_RATE_TYPES).toContain('BANK_BUY');
    expect(FX_RATE_TYPES).toContain('BANK_SELL');
    expect(INSTITUTION_RATE_TYPES.every((t) => isInstitutionRateType(t) && isOneSidedRateType(t))).toBe(true);
    expect(isInstitutionRateType('BANK')).toBe(false);
    expect(isOneSidedRateType('BANK')).toBe(false);
    expect(isOneSidedRateType('PARALLEL_BUY')).toBe(true);
    expect(isInstitutionProviderId('INSTRATE_TEST')).toBe(true);
    expect(isInstitutionProviderId('CRYPTO_TEST')).toBe(false);
    expect(isInstitutionProviderId('instrate_test')).toBe(false);
  });

  it('[TC-FX-INSTRATE-004] lectura exacta: 11.8537 se registra tal cual, sin pasar por punto flotante, con el código de la institución', () => {
    const s = sample('BAD', '11.8537');
    expect(s.value).toBe('11.8537');
    expect(s.institutionCode).toBe('BAD');
    const rate = ExchangeRate.fromProviderSample(s, {
      id: 'r1',
      workspaceId: 'w1',
      base: USD,
      quote: BOB,
      effectiveDate: '2026-10-08',
      createdAt: FETCHED,
      anomaly: null,
    });
    expect(rate.valueText).toBe('11.8537');
    expect(rate.snapshot.rateType).toBe('BANK_SELL');
    expect(rate.snapshot.institutionCode).toBe('BAD');
    expect(rate.snapshot.provider).toBe(PROVIDER);
    expect(rate.snapshot.source).toBe('PROVIDER');
    // Un valor con ceros finales es el mismo valor canónico.
    expect(sample('BAD', '11.8500').value).toBe('11.85');
  });

  it('[TC-FX-INSTRATE-004] compra y venta de la misma entidad son dos muestras con claves de idempotencia distintas', () => {
    const buy = sample('BAD', '11.95', 'BANK_BUY');
    const sell = sample('BAD', '11.85', 'BANK_SELL');
    expect(buy.key).not.toBe(sell.key);
    expect(sample('BAD', '11.85').key).toBe(sell.key);
    expect(sample('BBD', '11.85').key).not.toBe(sell.key);
  });

  it('una muestra por institución sin código (o con código fuera del patrón) y un código en un tipo que no es por institución son PROVIDER_PAYLOAD_INVALID', () => {
    expect(codeOf(() => sample(null, '11.85'))).toBe('PROVIDER_PAYLOAD_INVALID');
    expect(codeOf(() => sample('ba d', '11.85'))).toBe('PROVIDER_PAYLOAD_INVALID');
    expect(codeOf(() => sample('bad', '11.85'))).toBe('PROVIDER_PAYLOAD_INVALID');
    expect(codeOf(() => sample('BAD', '12.02', 'PARALLEL'))).toBe('PROVIDER_PAYLOAD_INVALID');
    expect(codeOf(() => sample('BAD', '-1'))).toBe('PROVIDER_PAYLOAD_INVALID');
    expect(codeOf(() => sample('BAD', '11.85'))).toBeUndefined();
  });

  it('[TC-FX-INSTRATE-004] PBT: cualquier valor decimal publicado se conserva exacto (texto canónico) y sin código no hay muestra', () => {
    const decimalText = fc
      .tuple(fc.bigInt({ min: 1n, max: 99_999_999n }), fc.integer({ min: 0, max: 8 }))
      .map(([units, scale]) => {
        const digits = units.toString().padStart(scale + 1, '0');
        return scale === 0 ? digits : `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
      });
    fc.assert(
      fc.property(
        decimalText,
        fc.constantFrom('BANK_BUY', 'BANK_SELL') as fc.Arbitrary<FxRateType>,
        (value, type) => {
          const s = sample('BAD', value, type);
          expect(s.value).toBe(dec(value).toFixed());
          expect(s.decimal.eq(dec(value))).toBe(true);
          expect(codeOf(() => sample(null, value, type))).toBe('PROVIDER_PAYLOAD_INVALID');
        },
      ),
      { numRuns: 100 },
    );
  }, 30_000);

  it('el registro de descriptores acepta ids INSTRATE_ de clase INSTITUTION y rechaza los que no cumplen el patrón', () => {
    const descriptor = (id: string, kind: ProviderDescriptor['kind']): ProviderDescriptor => ({
      id: id as FxRateProvider,
      kind,
      terms: { status: 'VERIFIED', verifiedOn: '2026-10-15', adr: 'ADR-TEST' },
      dailyCloses: false,
      feeds: [{ base: 'USD', quote: 'BOB', rateType: 'BANK_SELL' }],
      quoteSideFeeds: [],
      attribution: {
        provider: id as FxRateProvider,
        text: 't',
        url: 'https://example.invalid',
        license: null,
        licenseUrl: null,
      },
      limitPerMinute: 10,
      history: false,
    });
    unregister.push(registerProviderDescriptor(descriptor(PROVIDER, 'INSTITUTION')));
    expect(providerDescriptor(PROVIDER)?.kind).toBe('INSTITUTION');
    expect(registeredInstitutionDescriptors().map((d) => d.id)).toContain(PROVIDER);
    expect(() => registerProviderDescriptor(descriptor('CRYPTO_X', 'INSTITUTION'))).toThrow(RangeError);
    expect(() => registerProviderDescriptor(descriptor('INSTRATE_X', 'CRYPTO'))).toThrow(RangeError);
  });
});

describe('las tasas por institución no valoran por defecto (fx/market-rate-providers)', () => {
  const parallel = ExchangeRate.fromProviderSample(
    ProviderSample.of({
      provider: 'PARALELO_BO',
      base: 'USD',
      quote: 'BOB',
      rateType: 'PARALLEL',
      value: '12.02',
      asOf: AS_OF,
      fetchedAt: FETCHED,
      rawPayload: '{}',
      sourceLabel: 'paralelo.bo',
    }),
    {
      id: 'p1',
      workspaceId: 'w1',
      base: USD,
      quote: BOB,
      effectiveDate: '2026-10-08',
      createdAt: FETCHED,
      anomaly: null,
    },
  );
  const bankSell = ExchangeRate.fromProviderSample(sample('BAD', '11.85'), {
    id: 'b1',
    workspaceId: 'w1',
    base: USD,
    quote: BOB,
    effectiveDate: '2026-10-08',
    createdAt: FETCHED,
    anomaly: null,
  });
  const bankBuy = ExchangeRate.fromProviderSample(sample('BAD', '11.95', 'BANK_BUY'), {
    id: 'b2',
    workspaceId: 'w1',
    base: USD,
    quote: BOB,
    effectiveDate: '2026-10-08',
    createdAt: FETCHED,
    anomaly: null,
  });
  const candidates: RateCandidate[] = [parallel, bankSell, bankBuy].map((r) => ({
    state: r.snapshot,
    supersededById: null,
  }));
  const at = Instant.parse('2026-10-08T18:00:00Z');
  const policy: ValuationPolicy = {
    roles: {
      PARALLEL: { primary: 'PARALELO_BO', fallback: null },
      BANK_SELL: { primary: PROVIDER, fallback: null },
      BANK_BUY: { primary: PROVIDER, fallback: null },
    },
    staleAfterMs: { PARALLEL: 3_600_000, BANK_SELL: 72 * 3_600_000, BANK_BUY: 72 * 3_600_000 },
  };

  it('[TC-FX-INSTRATE-005] sin preferencia, 100.00 USD se valoran en 1202.00 BOB con PARALLEL aunque BANK_SELL tenga la misma vigencia', () => {
    const found = new RateResolver(candidates, policy).resolve({ base: USD, quote: BOB, at });
    expect(found.rateType).toBe('PARALLEL');
    expect(found.rate.convert(Money.parse('100.00', USD)).toFixed()).toBe('1202.00');
  });

  it('[TC-FX-INSTRATE-005] con BANK_SELL como preferencia del par, 100.00 USD se valoran en 1185.00 BOB con la tasa de la institución', () => {
    const found = new RateResolver(candidates, policy).resolve({
      base: USD,
      quote: BOB,
      at,
      preferenceOf: () => 'BANK_SELL',
    });
    expect(found.rateType).toBe('BANK_SELL');
    expect(found.provider).toBe(PROVIDER);
    expect(found.rate.convert(Money.parse('100.00', USD)).toFixed()).toBe('1185.00');
    expect(found.fxRateId).toBe('b1');
    expect(found.selection).toBe('PRIMARY');
  });

  it('[TC-FX-INSTRATE-005] BANK_BUY y BANK_SELL jamás se eligen sin pedirlos, ni siquiera sin tipo ni como sustitutas manuales', () => {
    const only = candidates.filter((c) => c.state.rateType !== 'PARALLEL');
    const resolver = new RateResolver(only, policy);
    // Sin tasa PARALLEL: no hay valoración por defecto (nunca se usa la tasa de una institución).
    expect(resolver.tryResolve({ base: USD, quote: BOB, at })).toBeNull();
    // La referencia de una conversión sin tipo explícito sigue el mismo criterio (preferencia o PARALLEL).
    expect(resolver.resolveForConversion({ base: USD, quote: BOB, at })).toBeNull();
    // Pedida explícitamente sí se resuelve (referencia de una conversión).
    expect(
      resolver.resolveForConversion({ base: USD, quote: BOB, at, rateType: 'BANK_SELL' })?.fxRateId,
    ).toBe('b1');
  });

  it('[TC-FX-INSTRATE-006] la tasa por institución es la referencia elegible de una conversión: id y versión exactos', () => {
    const ref = new RateResolver(candidates, policy).resolveForConversion({
      base: USD,
      quote: BOB,
      at,
      rateType: 'BANK_SELL',
    });
    expect(ref?.fxRateId).toBe('b1');
    expect(ref?.rate.value.toFixed()).toBe('11.85');
    expect(ref?.components).toEqual([]);
  });

  it('[TC-FX-INSTRATE-005] pedir BANK_BUY/BANK_SELL sin tasa de ese tipo nunca se sustituye por una manual fresca de otro tipo (FX_RATE_NOT_FOUND)', () => {
    const manual = ExchangeRate.record({
      id: 'm1',
      workspaceId: 'w1',
      base: USD,
      quote: BOB,
      value: '11.9',
      rateType: 'P2P',
      asOf: '2026-10-08T17:00:00Z',
      effectiveDate: '2026-10-08',
      createdAt: '2026-10-08T17:00:00Z',
      createdBy: 'u1',
    });
    const resolver = new RateResolver(
      [
        { state: manual.snapshot, supersededById: null },
        ...candidates.filter((c) => c.state.rateType === 'PARALLEL'),
      ],
      policy,
    );
    for (const type of ['BANK_BUY', 'BANK_SELL'] as const) {
      expect(resolver.tryResolve({ base: USD, quote: BOB, at, preferenceOf: () => type })).toBeNull();
    }
    // Sin preferencia la valoración por defecto sigue su regla (la manual fresca gana) y nunca usa un tipo de entidad.
    expect(resolver.resolve({ base: USD, quote: BOB, at }).rateType).toBe('P2P');
  });

  it('una tasa de institución obsoleta (más de FX_STALE_AFTER_INSTITUTION) se marca como última conocida obsoleta', () => {
    const later = Instant.parse('2026-10-11T18:00:00Z'); // ~74 h después
    const found = new RateResolver(candidates, policy).resolve({
      base: USD,
      quote: BOB,
      at: later,
      windowDays: 7,
      preferenceOf: () => 'BANK_SELL',
    });
    expect(found.selection).toBe('LAST_KNOWN_STALE');
    expect(found.stale).toBe(true);
  });
});
