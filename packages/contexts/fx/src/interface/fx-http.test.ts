import 'reflect-metadata';
import { currency, Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import { ExchangeRate } from '../domain/index.js';
import { attributionsOf, type ResolvedRateDto } from '../contracts/index.js';
import { fakeCryptoDescriptor } from '../application/testing/fake-crypto-provider.js';
import {
  ProviderSample,
  RateResolver,
  registerProviderDescriptor,
  type FxRateProvider,
  type RateCandidate,
} from '../domain/index.js';
import { toFxRateDto, toRatePairListDto, toRatePairStatusDto, toResolvedRateDto } from './fx-http.js';

const USDT = currency('USDT', 6);
const BOB = currency('BOB', 2);

const observation = ExchangeRate.userConversionObservation({
  id: 'obs-1',
  workspaceId: 'ws',
  base: USDT,
  quote: BOB,
  value: '11.900000000000000000',
  executedAt: '2026-10-05T14:00:00Z',
  effectiveDate: '2026-10-05',
  conversion: { transactionId: 'tx-1', revision: 1 },
  createdAt: '2026-10-05T14:00:02Z',
});

describe('FxRate del contrato: observaciones de conversiones propias (D231)', () => {
  it('[TC-FX-USERCONV-004] la observación expone su origen, la conversión de origen y sin marca de anulada', () => {
    const dto = toFxRateDto({ rate: observation, supersededById: null, withdrawal: null });
    expect(dto).toMatchObject({
      source: 'USER_CONVERSION',
      rateType: 'CUSTOM',
      value: '11.9',
      conversionRef: { transactionId: 'tx-1', revision: 1 },
      withdrawn: null,
      sourceLabel: 'Conversión',
    });
  });

  it('[TC-FX-USERCONV-004] la observación anulada informa cuándo y por qué sin cambiar su valor', () => {
    const dto = toFxRateDto({
      rate: observation,
      supersededById: null,
      withdrawal: {
        rateId: 'obs-1',
        workspaceId: 'ws',
        transactionId: 'tx-1',
        reason: 'conversión anulada',
        withdrawnAt: '2026-10-06T10:00:00.000Z',
      },
    });
    expect(dto).toMatchObject({
      value: '11.9',
      withdrawn: { at: '2026-10-06T10:00:00.000Z', reason: 'conversión anulada' },
    });
  });

  it('una tasa manual no lleva conversionRef ni withdrawn', () => {
    const manual = ExchangeRate.record({
      id: 'm1',
      workspaceId: 'ws',
      base: USDT,
      quote: BOB,
      value: '12.00',
      rateType: 'P2P',
      asOf: '2026-10-05T13:00:00Z',
      effectiveDate: '2026-10-05',
      createdAt: '2026-10-05T13:00:00Z',
      createdBy: 'u1',
    });
    const dto = toFxRateDto({ rate: manual, supersededById: null });
    expect('conversionRef' in dto).toBe(false);
    expect('withdrawn' in dto).toBe(false);
  });
});

describe('Pares de tasa configurados en el contrato (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-021] FxRatePairList expone modo, versión y cada par con su clase, tipo por defecto y cobertura', () => {
    const dto = toRatePairListDto({
      mode: 'CUSTOM',
      version: 2,
      pairs: [
        {
          base: 'BTC',
          quote: 'USDT',
          assetClass: 'VOLATILE_CRYPTO',
          defaultRateType: 'MARKET',
          coverage: 'MANUAL_ONLY',
          providers: [],
        },
      ],
    });
    expect(dto).toEqual({
      mode: 'CUSTOM',
      version: 2,
      pairs: [
        {
          base: 'BTC',
          quote: 'USDT',
          assetClass: 'VOLATILE_CRYPTO',
          defaultRateType: 'MARKET',
          coverage: 'MANUAL_ONLY',
          providers: [],
        },
      ],
    });
  });

  it('[TC-FX-PROVIDER-037] FxRatePairStatus expone cobertura, última tasa automática y antigüedad', () => {
    expect(
      toRatePairStatusDto({
        base: 'EUR',
        quote: 'BOB',
        coverage: 'MANUAL_ONLY',
        providers: [],
        lastAutomaticRateAt: null,
        ageSeconds: null,
        stale: true,
      }),
    ).toEqual({
      base: 'EUR',
      quote: 'BOB',
      coverage: 'MANUAL_ONLY',
      providers: [],
      lastAutomaticRateAt: null,
      ageSeconds: null,
      stale: true,
    });
  });

  it('[TC-FX-PROVIDER-032] el umbral informado de una anomalía es el de la clase de activo de la moneda base', () => {
    const BTC = currency('BTC', 8);
    const sample = ProviderSample.of({
      provider: 'CRYPTO_TEST_PRIMARY',
      base: 'BTC',
      quote: 'USDT',
      rateType: 'MARKET',
      value: '72000.00',
      asOf: '2026-10-13T14:00:00Z',
      fetchedAt: '2026-10-13T14:00:01Z',
      rawPayload: '{}',
      sourceLabel: 'doble',
    });
    const rate = ExchangeRate.fromProviderSample(sample, {
      id: 'btc-1',
      workspaceId: 'ws',
      base: BTC,
      quote: currency('USDT', 6),
      effectiveDate: '2026-10-13',
      createdAt: '2026-10-13T14:00:01Z',
      anomaly: { baselineRateId: 'btc-0', variationPct: '10.7692' },
    });
    const byClass = (code: string) => (code === 'BTC' ? '10' : '5');
    expect(toFxRateDto({ rate, supersededById: null }, byClass).anomaly?.thresholdPct).toBe('10');
    expect(toFxRateDto({ rate, supersededById: null }, '5').anomaly?.thresholdPct).toBe('5');
  });
});

describe('Atribución de las tasas cruzadas en el contrato (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-035] ResolvedRate serializa la atribución de cada componente y attributionsOf las une sin duplicados', () => {
    const off = registerProviderDescriptor(
      fakeCryptoDescriptor({ id: 'CRYPTO_TEST_PRIMARY', symbols: ['BTC'] }),
    );
    try {
      const BTC = currency('BTC', 8);
      const candidate = (
        provider: FxRateProvider,
        base: ReturnType<typeof currency>,
        quote: ReturnType<typeof currency>,
        rateType: 'MARKET' | 'PARALLEL',
        value: string,
      ): RateCandidate => ({
        state: ExchangeRate.fromProviderSample(
          ProviderSample.of({
            provider,
            base: base.code,
            quote: quote.code,
            rateType,
            value,
            asOf: '2026-10-13T14:00:00Z',
            fetchedAt: '2026-10-13T14:00:01Z',
            rawPayload: '{}',
            sourceLabel: provider,
          }),
          {
            id: `${provider}-${base.code}`,
            workspaceId: 'ws',
            base,
            quote,
            effectiveDate: '2026-10-13',
            createdAt: '2026-10-13T14:00:01Z',
            anomaly: null,
          },
        ).snapshot,
        supersededById: null,
      });
      const resolved = new RateResolver([
        candidate('CRYPTO_TEST_PRIMARY', BTC, currency('USDT', 6), 'MARKET', '65000.00'),
        candidate('PARALELO_BO', currency('USDT', 6), BOB, 'PARALLEL', '12.02'),
      ]).resolve({
        base: BTC,
        quote: BOB,
        at: Instant.parse('2026-10-13T14:05:00Z'),
        allowCross: true,
        pivot: currency('USD', 2),
        pivotOf: (code) => (code === 'BTC' ? currency('USDT', 6) : null),
        assetClassOf: (code) => (code === 'BTC' ? 'VOLATILE_CRYPTO' : code === 'USDT' ? 'STABLE' : 'FIAT'),
      });
      const dto = toResolvedRateDto(resolved) as unknown as ResolvedRateDto;
      expect(dto.derivation).toBe('CROSS');
      expect(dto.components).toHaveLength(2);
      expect(attributionsOf(dto).map((a) => a.provider)).toEqual(['CRYPTO_TEST_PRIMARY', 'PARALELO_BO']);
      expect(attributionsOf(dto).find((a) => a.provider === 'PARALELO_BO')).toMatchObject({
        text: 'Fuente: paralelo.bo',
        license: 'CC BY 4.0',
      });
    } finally {
      off();
    }
  });
});
