import { currency, DomainError, Instant, Money, dec } from '@pf/shared-kernel';
import { afterEach, describe, expect, it } from 'vitest';
import { attributionsOf, type ResolvedRateDto } from '../contracts/index.js';
import {
  findAttribution,
  providerDescriptor,
  ProviderError,
  ProviderSample,
  type FxRateProvider,
  type FxRateType,
  type MarketRateProvider,
} from '../domain/index.js';
import { FxQueries } from './fx.queries.js';
import { FxService } from './fx.service.js';
import { MarketRateIngestion } from './market-rate-ingestion.js';
import type { FxDeps } from './ports/index.js';
import {
  anomalyThresholdsOf,
  assetClassPolicyOf,
  enabledProviders,
  parseFxProviderSettings,
  valuationPolicyOf,
  type FxProviderSettings,
} from './provider-settings.js';
import { ProviderStatusQueries } from './provider-status.queries.js';
import { RatePairViews } from './rate-pair-views.js';
import { RatePairResolver } from './rate-pairs.js';
import {
  FAKE_VERIFIED_TERMS,
  FakeCryptoProvider,
  fakeCryptoDescriptor,
} from './testing/fake-crypto-provider.js';
import { inMemoryFxDeps } from './testing/in-memory.js';

// Providers cripto con DOBLES en memoria (add-crypto-rate-providers; sin red ni adapters reales: ningún adapter se
// escribe antes de verificar los términos de su fuente, ADR-0029): pares configurados por workspace, registro solo de
// los pares configurados, precios MARKET, histórico de cierres diarios, valoración cruzada y estado por par.
const WS = '0192f3c4-aaaa-7000-8000-000000000001';
const WS2 = '0192f3c4-aaaa-7000-8000-000000000002';
const ALL = ['BOB', 'USD', 'USDT', 'EUR', 'BTC', 'ETH'];
const PRIMARY = 'CRYPTO_TEST_PRIMARY' as const;
const FALLBACK = 'CRYPTO_TEST_FALLBACK' as const;
const PARALELO_RAW =
  '{"timestamp":"2026-10-13T13:58:00.000Z","buy":12.12,"sell":11.92,"median":12.02,"spreadPct":-1.6972,"sourceCount":4,"methodologyVersion":"ec2-backend"}';

const unregister: (() => void)[] = [];
afterEach(() => {
  for (const off of unregister.splice(0)) off();
});

/** Doble de un provider de tasa paralela (puerto `MarketRateProvider`); cuenta las solicitudes. */
class FakeParalelo implements MarketRateProvider {
  calls = 0;
  latest: ProviderSample[] = [];
  descriptor() {
    return providerDescriptor('PARALELO_BO') as NonNullable<ReturnType<typeof providerDescriptor>>;
  }
  async fetchLatest() {
    this.calls++;
    return this.latest;
  }
  async fetchHistory() {
    return [];
  }
}

const parallel = (base: string, value: string, asOf: string, fetchedAt: string) =>
  ProviderSample.of({
    provider: 'PARALELO_BO',
    base,
    quote: 'BOB',
    rateType: 'PARALLEL' as FxRateType,
    value,
    asOf,
    fetchedAt,
    rawPayload: PARALELO_RAW,
    sourceLabel: 'paralelo.bo (mediana P2P USDT/BOB)',
  });

const at = (iso: string) => Instant.parse(iso);
const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
  } catch (err) {
    if (err instanceof DomainError) return err.code;
    throw err;
  }
  return undefined;
};

interface SetupOptions {
  readonly env?: Record<string, string>;
  readonly workspaces?: string[];
  readonly now?: string;
  readonly symbols?: readonly string[];
}

function setup(options: SetupOptions = {}) {
  const mem = inMemoryFxDeps();
  mem.clock.set(at(options.now ?? '2026-10-13T14:00:00Z'));
  const now = () => mem.clock.now().toString();
  const primary = new FakeCryptoProvider({ id: PRIMARY, symbols: options.symbols ?? ['BTC', 'ETH'] }, now);
  const fallback = new FakeCryptoProvider({ id: FALLBACK, symbols: options.symbols ?? ['BTC', 'ETH'] }, now);
  unregister.push(primary.register(), fallback.register());
  const settings: FxProviderSettings = parseFxProviderSettings({
    FX_PROVIDER_CRYPTO_PRIMARY: 'crypto_test_primary',
    FX_PROVIDER_CRYPTO_FALLBACK: 'crypto_test_fallback',
    FX_CRYPTO_HISTORY_FROM: '2026-01-01',
    ...options.env,
  });
  const workspaces = options.workspaces ?? [WS];
  for (const ws of workspaces) {
    mem.state.workspaces.set(ws, 'America/La_Paz');
    mem.state.enabled.set(ws, new Set(ALL));
  }
  const paralelo = new FakeParalelo();
  const deps: FxDeps = {
    ...mem.deps,
    policy: valuationPolicyOf(settings),
    assetClasses: assetClassPolicyOf(settings),
    anomalyThresholds: anomalyThresholdsOf(settings),
  };
  const ingestion = new MarketRateIngestion({
    uow: mem.deps.uow,
    rates: mem.deps.rates,
    currencies: mem.deps.currencies,
    preferences: mem.deps.preferences,
    runs: mem.runs,
    workspaces: mem.workspaces,
    outbox: mem.deps.outbox,
    ids: mem.deps.ids,
    clock: mem.clock,
    settings,
    providers: { PARALELO_BO: paralelo, [PRIMARY]: primary, [FALLBACK]: fallback } as unknown as Partial<
      Record<FxRateProvider, MarketRateProvider>
    >,
    pairs: mem.deps.pairs,
    historyCache: mem.historyCache,
    firstBalance: mem.firstBalance,
  });
  const pairs = new RatePairResolver(deps);
  const views = new RatePairViews({
    uow: mem.deps.uow,
    rates: mem.deps.rates,
    pairs,
    clock: mem.clock,
    settings,
  });
  const status = new ProviderStatusQueries({
    uow: mem.deps.uow,
    rates: mem.deps.rates,
    runs: mem.runs,
    clock: mem.clock,
    settings,
    pairViews: views,
  });
  const service = new FxService(deps);
  const queries = new FxQueries(deps);
  const configure = (ws: string, list: string[]) =>
    service.replaceRatePairs({
      workspaceId: ws,
      expectedVersion: mem.state.pairLists.get(ws)?.version ?? 1,
      mode: 'CUSTOM',
      pairs: list.map((p) => ({ base: p.split('/')[0] as string, quote: p.split('/')[1] as string })),
    });
  return {
    mem,
    primary,
    fallback,
    paralelo,
    settings,
    ingestion,
    status,
    service,
    queries,
    views,
    configure,
  };
}

const ratesOf = (mem: ReturnType<typeof setup>['mem'], ws: string, base: string, quote: string) =>
  mem.state.rates.filter(
    (r) => r.snapshot.workspaceId === ws && r.rate.base.code === base && r.rate.quote.code === quote,
  );

describe('Configuración de providers cripto solo con términos verificados (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-036] sin providers cripto verificados el default es none y no hay ningún id real habilitable', () => {
    const s = parseFxProviderSettings();
    expect([s.cryptoPrimary, s.cryptoFallback, s.cryptoConfigError, s.configError]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(enabledProviders(s)).toEqual(['PARALELO_BO', 'DOLARAPI_BO']);
    // El único modo de enchufar un provider cripto hoy es registrar un doble: un id desconocido no se habilita.
    const unknown = parseFxProviderSettings({ FX_PROVIDER_CRYPTO_PRIMARY: 'crypto_binance' });
    expect(unknown.cryptoConfigError).toMatch(/no registered adapter/);
    expect(unknown.cryptoPrimary).toBeNull();
  });

  it('[TC-FX-PROVIDER-036] un provider sin verificación o con verificación REJECTED no se habilita; paralelo.bo sigue', () => {
    const unverified = new FakeCryptoProvider(
      {
        id: 'CRYPTO_TEST_UNVERIFIED',
        terms: { status: 'UNVERIFIED', verifiedOn: null, adr: null },
      },
      () => '2026-10-13T14:00:00Z',
    );
    const rejected = new FakeCryptoProvider(
      {
        id: 'CRYPTO_TEST_REJECTED',
        terms: { status: 'REJECTED', verifiedOn: '2026-10-13', adr: 'ADR-TEST' },
      },
      () => '2026-10-13T14:00:00Z',
    );
    unregister.push(unverified.register(), rejected.register());
    for (const id of ['crypto_test_unverified', 'crypto_test_rejected']) {
      const s = parseFxProviderSettings({ FX_PROVIDER_CRYPTO_PRIMARY: id });
      expect(s.cryptoConfigError, id).toMatch(/cannot be enabled/);
      expect([s.cryptoPrimary, s.cryptoFallback]).toEqual([null, null]);
      // Los providers de tasa paralela y el resto del sistema siguen funcionando.
      expect([s.configError, s.primary, s.fallback, s.official]).toEqual([
        null,
        'PARALELO_BO',
        'DOLARAPI_BO',
        'DOLARAPI_BO',
      ]);
      expect(enabledProviders(s)).toEqual(['PARALELO_BO', 'DOLARAPI_BO']);
    }
  });

  it('[TC-FX-PROVIDER-036] una verificación VERIFIED con fecha y ADR habilita al provider; principal y respaldo deben diferir', () => {
    const { settings } = setup();
    expect([settings.cryptoPrimary, settings.cryptoFallback, settings.cryptoConfigError]).toEqual([
      PRIMARY,
      FALLBACK,
      null,
    ]);
    expect(enabledProviders(settings)).toEqual(['PARALELO_BO', 'DOLARAPI_BO', PRIMARY, FALLBACK]);
    expect(
      parseFxProviderSettings({
        FX_PROVIDER_CRYPTO_PRIMARY: 'crypto_test_primary',
        FX_PROVIDER_CRYPTO_FALLBACK: 'crypto_test_primary',
      }).cryptoConfigError,
    ).toMatch(/must differ/);
  });

  it('[TC-FX-PROVIDER-036] una configuración cripto inválida deja a los cripto deshabilitados y el estado informa FX_PROVIDER_CONFIG_INVALID', async () => {
    const { mem, status } = setup({ env: { FX_ANOMALY_THRESHOLD_VOLATILE_PCT: '0' } });
    const settings = parseFxProviderSettings({
      FX_PROVIDER_CRYPTO_PRIMARY: 'crypto_test_primary',
      FX_ANOMALY_THRESHOLD_VOLATILE_PCT: '0',
    });
    expect(settings.cryptoConfigError).toMatch(/FX_ANOMALY_THRESHOLD_VOLATILE_PCT/);
    expect(enabledProviders(settings)).toEqual(['PARALELO_BO', 'DOLARAPI_BO']);
    const statuses = await new ProviderStatusQueries({
      uow: mem.deps.uow,
      rates: mem.deps.rates,
      runs: mem.runs,
      clock: mem.clock,
      settings,
    }).status(WS);
    const crypto = statuses.find((p) => p.provider === PRIMARY);
    expect([crypto?.enabled, crypto?.health, crypto?.lastError?.code]).toEqual([
      false,
      'DISABLED',
      'FX_PROVIDER_CONFIG_INVALID',
    ]);
    const parallelStatus = statuses.find((p) => p.provider === 'PARALELO_BO');
    expect([parallelStatus?.enabled, parallelStatus?.lastError]).toEqual([true, null]);
    void status;
  });

  it('[TC-FX-PROVIDER-036] las configuraciones inválidas generales siguen deshabilitando todo, también los cripto', () => {
    setup();
    const s = parseFxProviderSettings({
      FX_POLL_INTERVAL: '30s',
      FX_PROVIDER_CRYPTO_PRIMARY: 'crypto_test_primary',
    });
    expect(s.configError).not.toBeNull();
    expect(enabledProviders(s)).toEqual([]);
  });
});

describe('Pares configurados por workspace (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-021] el EDITOR agrega ETH: la lista queda guardada y la auditoría registra las listas anterior y nueva', async () => {
    const { mem, queries, configure } = setup();
    expect((await queries.effectiveRatePairs(WS)).pairs.map((p) => `${p.base}/${p.quote}`)).toEqual([
      'EUR/BOB',
      'USD/BOB',
      'USDT/BOB',
      'BTC/USDT',
      'ETH/USDT',
    ]);
    const saved = await configure(WS, ['USD/BOB', 'USDT/BOB', 'BTC/USDT', 'ETH/USDT']);
    expect(saved).toEqual({ mode: 'CUSTOM', version: 2 });
    const effective = await queries.effectiveRatePairs(WS);
    expect([effective.mode, effective.version]).toEqual(['CUSTOM', 2]);
    expect(effective.pairs.map((p) => [p.base, p.quote, p.assetClass])).toEqual([
      ['USD', 'BOB', 'FIAT'],
      ['USDT', 'BOB', 'STABLE'],
      ['BTC', 'USDT', 'VOLATILE_CRYPTO'],
      ['ETH', 'USDT', 'VOLATILE_CRYPTO'],
    ]);
    const entry = mem.state.audit.at(-1);
    expect(entry).toMatchObject({
      action: 'fx.rate_pairs.replaced',
      aggregateType: 'RatePairs',
      aggregateId: WS,
      aggregateVersion: 2,
    });
    const pairsChange = entry?.changes?.find((c) => c.field === 'pairs');
    expect(JSON.parse(String(pairsChange?.before))).toEqual([
      'EUR/BOB',
      'USD/BOB',
      'USDT/BOB',
      'BTC/USDT',
      'ETH/USDT',
    ]);
    expect(JSON.parse(String(pairsChange?.after))).toEqual(['USD/BOB', 'USDT/BOB', 'BTC/USDT', 'ETH/USDT']);
    expect(entry?.changes?.find((c) => c.field === 'mode')).toMatchObject({
      before: 'DEFAULT',
      after: 'CUSTOM',
    });
  });

  it('[TC-FX-PROVIDER-021] un If-Match viejo responde PRECONDITION_FAILED y la lista no cambia', async () => {
    const { mem, service, configure } = setup();
    await configure(WS, ['USD/BOB']);
    const auditBefore = mem.state.audit.length;
    expect(
      await codeOf(
        service.replaceRatePairs({
          workspaceId: WS,
          expectedVersion: 1,
          mode: 'CUSTOM',
          pairs: [{ base: 'USDT', quote: 'BOB' }],
        }),
      ),
    ).toBe('PRECONDITION_FAILED');
    expect(mem.state.pairLists.get(WS)?.version).toBe(2);
    expect(mem.state.audit).toHaveLength(auditBefore);
  });

  it('[TC-FX-PROVIDER-021] volver a DEFAULT borra la lista explícita y se deriva de nuevo (habilitar una moneda la agrega sola)', async () => {
    const { mem, queries, service, configure } = setup();
    await configure(WS, ['USD/BOB']);
    await service.replaceRatePairs({ workspaceId: WS, expectedVersion: 2, mode: 'DEFAULT' });
    const effective = await queries.effectiveRatePairs(WS);
    expect([effective.mode, effective.version, effective.pairs.length]).toEqual(['DEFAULT', 3, 5]);
    mem.state.enabled.set(WS, new Set(['BOB', 'USD', 'USDT']));
    expect((await queries.effectiveRatePairs(WS)).pairs.map((p) => `${p.base}/${p.quote}`)).toEqual([
      'USD/BOB',
      'USDT/BOB',
    ]);
  });

  it('[TC-FX-PROVIDER-022] ETH no habilitada ⇒ CURRENCY_NOT_ENABLED y BTC/USD ⇒ VALIDATION_FAILED, sin cambiar la lista ni su versión', async () => {
    const { mem, configure } = setup();
    mem.state.enabled.set(WS, new Set(['BOB', 'USD', 'USDT', 'BTC']));
    expect(await codeOf(configure(WS, ['USD/BOB', 'ETH/USDT']))).toBe('CURRENCY_NOT_ENABLED');
    expect(await codeOf(configure(WS, ['BTC/USD']))).toBe('VALIDATION_FAILED');
    expect(mem.state.pairLists.has(WS)).toBe(false);
    expect(mem.state.audit.filter((a) => a.action === 'fx.rate_pairs.replaced')).toHaveLength(0);
  });

  it('[TC-FX-RATE-006] el usuario registra BTC/USDT = 64990.50 tipo MARKET como tasa manual y el evento lleva MARKET', async () => {
    const { mem, service } = setup();
    const stored = await service.recordManualRate({
      workspaceId: WS,
      userId: '0192f3c4-bbbb-7000-8000-000000000001',
      base: 'BTC',
      quote: 'USDT',
      value: '64990.50',
      rateType: 'MARKET',
      asOf: '2026-10-13T14:00:00Z',
      sourceLabel: 'Precio del exchange',
    });
    expect(stored.rate.snapshot).toMatchObject({
      source: 'MANUAL',
      rateType: 'MARKET',
      asOf: '2026-10-13T14:00:00.000Z',
      provider: null,
    });
    expect(stored.rate.valueText).toBe('64990.5');
    expect(dec(stored.rate.valueText).eq('64990.50')).toBe(true);
    expect(mem.state.outbox.at(-1)).toMatchObject({
      eventType: 'fx.RateRecorded',
      payload: { rateType: 'MARKET', source: 'MANUAL', value: '64990.5' },
    });
  });
});

describe('Registro automático solo de los pares configurados (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-024] W1 (USDT/BOB y BTC/USDT) no registra USD/BOB; W2 con la lista por defecto sí; una sola solicitud', async () => {
    const { mem, paralelo, primary, ingestion, configure } = setup({ workspaces: [WS, WS2] });
    await configure(WS, ['USDT/BOB', 'BTC/USDT']);
    const fetchedAt = mem.clock.now().toString();
    paralelo.latest = [
      parallel('USD', '12.02', '2026-10-13T13:58:00Z', fetchedAt),
      parallel('USDT', '12.02', '2026-10-13T13:58:00Z', fetchedAt),
    ];
    primary.prices = { BTC: { price: '65000.01000000', asOf: '2026-10-13T14:00:00.000Z' } };
    await ingestion.poll();
    const registered = (ws: string) =>
      mem.state.rates
        .filter((r) => r.snapshot.workspaceId === ws && r.snapshot.source === 'PROVIDER')
        .map((r) => `${r.rate.base.code}/${r.rate.quote.code}:${r.snapshot.rateType}`)
        .sort();
    expect(registered(WS)).toEqual(['BTC/USDT:MARKET', 'USDT/BOB:PARALLEL']);
    // W2 (lista por defecto con USD, USDT, EUR, BTC y ETH habilitadas): USD/BOB y USDT/BOB como antes y BTC/USDT.
    expect(registered(WS2)).toEqual(['BTC/USDT:MARKET', 'USD/BOB:PARALLEL', 'USDT/BOB:PARALLEL']);
    expect([paralelo.calls, primary.latestRequests.length]).toEqual([1, 1]);
  });

  it('[TC-FX-PROVIDER-026] el provider cripto principal registra BTC/USDT MARKET exacto con su provider y vigencia, y publica el evento', async () => {
    const { mem, primary, ingestion, configure } = setup();
    await configure(WS, ['BTC/USDT']);
    primary.prices = { BTC: { price: '65000.01000000', asOf: '2026-10-13T14:00:00.000Z' } };
    const results = await ingestion.poll();
    expect(results.find((r) => r.provider === PRIMARY)).toMatchObject({ outcome: 'OK', newSamples: 1 });
    const [rate] = ratesOf(mem, WS, 'BTC', 'USDT');
    expect(rate?.snapshot).toMatchObject({
      source: 'PROVIDER',
      provider: PRIMARY,
      rateType: 'MARKET',
      asOf: '2026-10-13T14:00:00.000Z',
      effectiveDate: '2026-10-13',
      anomaly: null,
    });
    expect(dec(rate?.valueText ?? '0').eq('65000.01000000')).toBe(true);
    expect(mem.state.outbox.at(-1)).toMatchObject({
      actor: { type: 'SYSTEM', id: `fx-provider:${PRIMARY}` },
      payload: { rateType: 'MARKET', provider: PRIMARY, base: 'BTC', quote: 'USDT' },
    });
  });

  it('[TC-FX-PROVIDER-028] un precio con 19 decimales no registra tasas y cuenta como falla PROVIDER_PAYLOAD_INVALID en el estado', async () => {
    const { mem, primary, ingestion, status, configure } = setup();
    await configure(WS, ['ETH/USDT']);
    primary.prices = { ETH: { price: '2450.1234567890123456789', asOf: '2026-10-13T14:00:00.000Z' } };
    const results = await ingestion.poll();
    expect(results.find((r) => r.provider === PRIMARY)).toMatchObject({
      outcome: 'FAILED',
      errorCode: 'PROVIDER_PAYLOAD_INVALID',
    });
    expect(ratesOf(mem, WS, 'ETH', 'USDT')).toHaveLength(0);
    const report = await status.statusReport(WS);
    expect(report.providers.find((p) => p.provider === PRIMARY)).toMatchObject({
      consecutiveFailures: 1,
      lastError: { code: 'PROVIDER_PAYLOAD_INVALID' },
    });
    // Precio nulo, cero o negativo: misma falla, sin tasas.
    for (const price of ['0', '-1', 'null', '']) {
      primary.prices = { ETH: { price, asOf: '2026-10-13T14:00:00.000Z' } };
      expect((await ingestion.poll()).find((r) => r.provider === PRIMARY)?.errorCode, price).toBe(
        'PROVIDER_PAYLOAD_INVALID',
      );
    }
    expect(ratesOf(mem, WS, 'ETH', 'USDT')).toHaveLength(0);
  });

  it('[TC-FX-PROVIDER-032] la cripto volátil usa el umbral de 10 % y la fiat/estable el de 5 % en la ingesta', async () => {
    const { mem, primary, paralelo, ingestion, configure } = setup();
    await configure(WS, ['USDT/BOB', 'BTC/USDT']);
    const feed = (btc: string, usdt: string, asOf: string) => {
      primary.prices = { BTC: { price: btc, asOf } };
      paralelo.latest = [parallel('USDT', usdt, asOf, mem.clock.now().toString())];
    };
    feed('65000.00', '12.02', '2026-10-13T13:00:00.000Z');
    await ingestion.poll();
    // BTC +7.69 % (bajo 10 %) se acepta; USDT/BOB +5.66 % (sobre 5 %) queda anómala.
    mem.clock.set(at('2026-10-13T14:00:00Z'));
    feed('70000.00', '12.70', '2026-10-13T14:00:00.000Z');
    await ingestion.poll();
    const btc = ratesOf(mem, WS, 'BTC', 'USDT');
    const usdt = ratesOf(mem, WS, 'USDT', 'BOB');
    expect(btc.map((r) => r.snapshot.anomaly)).toEqual([null, null]);
    expect(usdt.map((r) => r.snapshot.anomaly?.variationPct ?? null)).toEqual([null, '5.6572']);
    // BTC +10.77 % (sobre 10 %) queda anómala.
    mem.clock.set(at('2026-10-13T15:00:00Z'));
    feed('77500.00', '12.70', '2026-10-13T15:00:00.000Z');
    await ingestion.poll();
    expect(ratesOf(mem, WS, 'BTC', 'USDT').at(-1)?.snapshot.anomaly?.variationPct).toBe('10.7143');
  });

  it('[TC-FX-PROVIDER-023] quitar BTC/USDT deja de registrarlo y conserva intactas las tasas ya registradas', async () => {
    const { mem, primary, ingestion, configure, service } = setup();
    await configure(WS, ['USDT/BOB', 'BTC/USDT']);
    primary.prices = { BTC: { price: '65000.00', asOf: '2026-10-13T13:00:00.000Z' } };
    await ingestion.poll();
    const before = ratesOf(mem, WS, 'BTC', 'USDT').map((r) => [r.id, r.valueText, r.snapshot.asOf]);
    expect(before).toHaveLength(1);
    await service.replaceRatePairs({
      workspaceId: WS,
      expectedVersion: 2,
      mode: 'CUSTOM',
      pairs: [{ base: 'USDT', quote: 'BOB' }],
    });
    mem.clock.set(at('2026-10-13T14:15:00Z'));
    primary.prices = { BTC: { price: '65100.00', asOf: '2026-10-13T14:10:00.000Z' } };
    await ingestion.poll();
    expect(ratesOf(mem, WS, 'BTC', 'USDT').map((r) => [r.id, r.valueText, r.snapshot.asOf])).toEqual(before);
  });

  it('[TC-FX-PROVIDER-025] EUR/BOB sin provider se informa solo manual y el resto de los pares se registra con normalidad', async () => {
    const { mem, paralelo, ingestion, views, configure } = setup();
    await configure(WS, ['EUR/BOB', 'USDT/BOB']);
    paralelo.latest = [parallel('USDT', '12.02', '2026-10-13T13:58:00Z', mem.clock.now().toString())];
    await ingestion.poll();
    const list = await views.list(WS);
    expect(list.pairs.map((p) => [p.base, p.quote, p.coverage, p.providers])).toEqual([
      ['EUR', 'BOB', 'MANUAL_ONLY', []],
      ['USDT', 'BOB', 'AUTOMATIC', ['PARALELO_BO', 'DOLARAPI_BO']],
    ]);
    expect(ratesOf(mem, WS, 'USDT', 'BOB')).toHaveLength(1);
    expect(ratesOf(mem, WS, 'EUR', 'BOB')).toHaveLength(0);
  });
});

describe('Histórico diario de precios cripto (fx/market-rate-providers; D229)', () => {
  /** Cierres de BTC del 2026-01-01 al 2026-10-13 (hoy incluido, que nunca debe registrarse). */
  function programCloses(primary: FakeCryptoProvider) {
    const closes: Record<string, string> = {};
    for (
      let ms = Date.parse('2026-01-01T00:00:00Z');
      ms <= Date.parse('2026-10-13T00:00:00Z');
      ms += 86_400_000
    ) {
      closes[new Date(ms).toISOString().slice(0, 10)] = '60000.00';
    }
    closes['2026-03-31'] = '82000.00';
    primary.closes = { BTC: closes };
  }

  it('[TC-FX-PROVIDER-030] registra 217 cierres BTC/USDT del 2026-03-10 al 2026-10-12, con el cierre del 2026-03-31 y sin el día en curso; la recarga es idempotente', async () => {
    const { mem, primary, ingestion, configure } = setup();
    await configure(WS, ['USDT/BOB', 'BTC/USDT']);
    mem.state.firstBalance.set(WS, new Map([['BTC', '2026-03-10']]));
    programCloses(primary);
    const results = await ingestion.cryptoBackfill({ workspaceId: WS, timeZone: 'America/La_Paz' });
    expect(results.find((r) => r.provider === PRIMARY)).toMatchObject({ outcome: 'OK', newSamples: 217 });
    const rows = ratesOf(mem, WS, 'BTC', 'USDT');
    expect(rows).toHaveLength(217);
    const days = rows.map((r) => r.snapshot.asOf.slice(0, 10)).sort();
    expect([days[0], days.at(-1)]).toEqual(['2026-03-10', '2026-10-12']);
    expect(days).not.toContain('2026-10-13');
    const march31 = rows.find((r) => r.snapshot.asOf.startsWith('2026-03-31'));
    expect(march31?.snapshot).toMatchObject({
      provider: PRIMARY,
      rateType: 'MARKET',
      source: 'PROVIDER',
      asOf: '2026-03-31T23:59:59.000Z',
      anomaly: null,
    });
    expect(dec(march31?.valueText ?? '0').eq('82000.00')).toBe(true);
    // Un evento por workspace y ejecución (no uno por cierre).
    expect(
      mem.state.outbox.filter((e) => (e.payload as { provider?: string }).provider === PRIMARY),
    ).toHaveLength(1);
    // Recarga con los mismos cierres: nada nuevo.
    const again = await ingestion.cryptoBackfill({ workspaceId: WS, timeZone: 'America/La_Paz' });
    expect(again.find((r) => r.provider === PRIMARY)).toMatchObject({
      outcome: 'NO_NEW_SAMPLE',
      newSamples: 0,
    });
    expect(ratesOf(mem, WS, 'BTC', 'USDT')).toHaveLength(217);
    expect(mem.state.runs.filter((r) => r.provider === PRIMARY).at(-1)).toMatchObject({
      kind: 'BACKFILL',
      historyFrom: '2026-01-01',
      historyTo: '2026-10-12',
    });
  }, 60_000);

  it('[TC-FX-PROVIDER-031] el relleno diario agrega los 9 cierres anteriores cuando un movimiento con fecha pasada adelanta la primera fecha con saldo, sin alterar los previos', async () => {
    const { mem, primary, ingestion, configure } = setup();
    await configure(WS, ['USDT/BOB', 'BTC/USDT']);
    mem.state.firstBalance.set(WS, new Map([['BTC', '2026-03-10']]));
    programCloses(primary);
    await ingestion.cryptoFillGaps();
    const before = ratesOf(mem, WS, 'BTC', 'USDT').map((r) => [r.id, r.valueText, r.snapshot.asOf]);
    expect(before).toHaveLength(217);
    // Movimiento en BTC con fecha 2026-03-01: la primera fecha con saldo retrocede.
    mem.state.firstBalance.set(WS, new Map([['BTC', '2026-03-01']]));
    mem.clock.set(at('2026-10-14T02:00:00Z'));
    const results = await ingestion.cryptoFillGaps();
    // 2026-10-13 ya es un día completo ese día: 9 anteriores (03-01..03-09) + el 13 de octubre.
    expect(results.find((r) => r.provider === PRIMARY)?.newSamples).toBe(10);
    const after = ratesOf(mem, WS, 'BTC', 'USDT');
    const days = after.map((r) => r.snapshot.asOf.slice(0, 10)).sort();
    expect(days.slice(0, 10)).toEqual([
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
    expect(after.filter((r) => before.some((b) => b[0] === r.id))).toHaveLength(217);
    for (const b of before) {
      const r = after.find((x) => x.id === b[0]);
      expect([r?.valueText, r?.snapshot.asOf]).toEqual([b[1], b[2]]);
    }
  }, 60_000);

  it('[TC-FX-PROVIDER-031] el mismo día del relleno (sin cambios) no registra ninguna tasa nueva', async () => {
    const { mem, primary, ingestion, configure } = setup();
    await configure(WS, ['BTC/USDT']);
    mem.state.firstBalance.set(WS, new Map([['BTC', '2026-10-01']]));
    programCloses(primary);
    await ingestion.cryptoFillGaps();
    const outboxBefore = mem.state.outbox.length;
    expect((await ingestion.cryptoFillGaps()).every((r) => r.newSamples === 0)).toBe(true);
    expect(mem.state.outbox).toHaveLength(outboxBefore);
  });

  it('[TC-FX-PROVIDER-030] sin movimientos en la cripto (sin primera fecha con saldo) no se copia ningún cierre', async () => {
    const { mem, primary, ingestion, configure } = setup();
    await configure(WS, ['BTC/USDT']);
    programCloses(primary);
    await ingestion.cryptoFillGaps();
    expect(ratesOf(mem, WS, 'BTC', 'USDT')).toHaveLength(0);
    // La caché de instalación sí se completó (no depende de ningún workspace).
    expect((await mem.historyCache.summary(PRIMARY)).from).toBe('2026-01-01');
  });

  it('[TC-FX-PROVIDER-034] las solicitudes al provider cripto son idénticas con distintos pares y fechas de los workspaces', async () => {
    const run = async (lists: Record<string, string[]>, first: Record<string, string>) => {
      const ctx = setup({ workspaces: [WS, WS2] });
      for (const [ws, list] of Object.entries(lists)) await ctx.configure(ws, list);
      for (const [ws, date] of Object.entries(first))
        ctx.mem.state.firstBalance.set(ws, new Map([['BTC', date]]));
      ctx.primary.prices = { BTC: { price: '65000.00', asOf: '2026-10-13T14:00:00.000Z' } };
      programCloses(ctx.primary);
      await ctx.ingestion.poll();
      await ctx.ingestion.cryptoFillGaps();
      unregister.splice(0).forEach((off) => off());
      return { latest: ctx.primary.latestRequests, closes: ctx.primary.closeRequests };
    };
    const withPairs = await run(
      { [WS]: ['BTC/USDT'], [WS2]: ['ETH/USDT'] },
      { [WS]: '2026-03-10', [WS2]: '2026-05-05' },
    );
    const without = await run({ [WS]: ['USD/BOB'], [WS2]: ['USDT/BOB'] }, {});
    expect(withPairs.latest).toEqual(without.latest);
    expect(withPairs.closes).toEqual(without.closes);
    // Símbolos de instalación (catálogo) y rangos fijados por FX_CRYPTO_HISTORY_FROM, no la primera fecha de un workspace.
    expect(withPairs.latest[0]?.symbols).toEqual(['BTC', 'ETH']);
    expect(withPairs.closes[0]).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(withPairs.closes.at(-1)).toEqual({ from: '2026-10-01', to: '2026-10-12' });
    expect(withPairs.closes).toHaveLength(10);
  });

  it('[TC-REPORTING-NETWORTH-014] valorar al 2026-03-31 usa el cierre histórico cargado (82000.00 × 10.20 = 836400), no el precio de hoy', async () => {
    const { mem, primary, ingestion, queries, service, configure } = setup();
    await configure(WS, ['USDT/BOB', 'BTC/USDT']);
    mem.state.firstBalance.set(WS, new Map([['BTC', '2026-03-10']]));
    programCloses(primary);
    await ingestion.cryptoFillGaps();
    primary.prices = { BTC: { price: '65000.00', asOf: '2026-10-13T14:00:00.000Z' } };
    await ingestion.poll();
    await service.recordManualRate({
      workspaceId: WS,
      userId: '0192f3c4-bbbb-7000-8000-000000000001',
      base: 'USDT',
      quote: 'BOB',
      value: '10.20',
      rateType: 'PARALLEL',
      asOf: '2026-03-31T20:00:00Z',
    });
    const [btc] = await queries.resolveValuationRates(WS, [
      { base: 'BTC', quote: 'BOB', at: at('2026-03-31T23:59:59Z') },
    ]);
    expect(btc?.derivation).toBe('CROSS');
    expect(btc?.rate.value.toFixed()).toBe('836400');
    expect(btc?.rate.convert(Money.parse('0.01500000', currency('BTC', 8))).toString()).toBe('12546.00 BOB');
    expect(btc?.components.map((c) => [c.rate.base.code, c.rateType, c.asOf])).toEqual([
      ['BTC', 'MARKET', '2026-03-31T23:59:59.000Z'],
      ['USDT', 'PARALLEL', '2026-03-31T20:00:00.000Z'],
    ]);
  }, 60_000);

  it('[TC-FX-PROVIDER-029] un Retry-After persistido bloquea el backfill y los ciclos del provider cripto hasta su vencimiento', async () => {
    const { mem, primary, ingestion, configure } = setup();
    await configure(WS, ['BTC/USDT']);
    mem.state.firstBalance.set(WS, new Map([['BTC', '2026-03-10']]));
    programCloses(primary);
    primary.failure = new ProviderError('PROVIDER_RATE_LIMITED', '429', 429, '2026-10-13T14:02:00.000Z');
    const first = await ingestion.poll();
    expect(first.find((r) => r.provider === PRIMARY)).toMatchObject({
      outcome: 'FAILED',
      errorCode: 'PROVIDER_RATE_LIMITED',
    });
    primary.failure = null;
    const requestsBefore = primary.closeRequests.length + primary.latestRequests.length;
    mem.clock.set(at('2026-10-13T14:01:00Z'));
    expect((await ingestion.poll()).find((r) => r.provider === PRIMARY)?.outcome).toBe('SKIPPED_RATE_LIMIT');
    const blocked = await ingestion.cryptoFillGaps();
    expect(blocked.find((r) => r.provider === PRIMARY)?.outcome).toBe('SKIPPED_RATE_LIMIT');
    expect(primary.closeRequests.length + primary.latestRequests.length).toBe(requestsBefore);
    // Vencido Retry-After se reanuda donde quedó.
    mem.clock.set(at('2026-10-13T14:02:00Z'));
    expect((await ingestion.cryptoFillGaps()).find((r) => r.provider === PRIMARY)?.outcome).toBe('OK');
  });

  it('una falla a mitad del backfill paginado conserva las páginas ya cacheadas y el siguiente ciclo continúa sin huecos', async () => {
    const { mem, primary, ingestion, configure } = setup();
    await configure(WS, ['BTC/USDT']);
    mem.state.firstBalance.set(WS, new Map([['BTC', '2026-01-05']]));
    programCloses(primary);
    const original = primary.fetchDailyCloses.bind(primary);
    let calls = 0;
    primary.fetchDailyCloses = async (range) => {
      calls++;
      if (calls === 3) throw new ProviderError('PROVIDER_UNAVAILABLE', '503', 503);
      return original(range);
    };
    const failed = await ingestion.cryptoFillGaps();
    expect(failed.find((r) => r.provider === PRIMARY)).toMatchObject({
      outcome: 'FAILED',
      errorCode: 'PROVIDER_UNAVAILABLE',
    });
    expect((await mem.historyCache.summary(PRIMARY)).to).toBe('2026-02-28');
    primary.fetchDailyCloses = original;
    mem.clock.set(at('2026-10-13T14:30:00Z'));
    await ingestion.cryptoFillGaps();
    expect((await mem.historyCache.summary(PRIMARY)).to).toBe('2026-10-12');
    expect((await mem.historyCache.summary(PRIMARY)).points).toBe(285);
  });
});

describe('Valoración, atribución y estado de los pares cripto (fx/market-rate-providers)', () => {
  async function seedWorld() {
    const ctx = setup({ now: '2026-10-13T14:05:00Z' });
    await ctx.configure(WS, ['USDT/BOB', 'BTC/USDT', 'EUR/BOB']);
    const fetchedAt = '2026-10-13T14:05:00.000Z';
    ctx.paralelo.latest = [parallel('USDT', '12.02', '2026-10-13T14:00:00.000Z', fetchedAt)];
    ctx.primary.prices = { BTC: { price: '65000.00', asOf: '2026-10-13T14:00:00.000Z' } };
    await ctx.ingestion.poll();
    return ctx;
  }

  it('[TC-FX-RATE-007] 0.01500000 BTC se valoran en 11719.50 BOB con la cruzada 781300.00 por el pivote USDT del par configurado', async () => {
    const { queries } = await seedWorld();
    const valued = await queries.convertForValuation({
      workspaceId: WS,
      amount: { amount: '0.01500000', currency: 'BTC' },
      to: 'BOB',
    });
    expect(valued.amount.toString()).toBe('11719.50 BOB');
    expect(valued.resolved?.derivation).toBe('CROSS');
    expect(valued.resolved?.approx).toBe(true);
    expect(valued.resolved?.rate.value.toFixed()).toBe('781300');
    expect(valued.resolved?.components.map((c) => [c.rate.base.code, c.rateType, c.provider])).toEqual([
      ['BTC', 'MARKET', PRIMARY],
      ['USDT', 'PARALLEL', 'PARALELO_BO'],
    ]);
  });

  it('[TC-FX-RATE-008] 0.01000000 BTC en USDT sin tipo pedido usa la tasa MARKET 65000.00', async () => {
    const { queries } = await seedWorld();
    const valued = await queries.convertForValuation({
      workspaceId: WS,
      amount: { amount: '0.01000000', currency: 'BTC' },
      to: 'USDT',
    });
    expect(valued.amount.toString()).toBe('650.000000 USDT');
    expect([valued.resolved?.rateType, valued.resolved?.provider, valued.resolved?.selection]).toEqual([
      'MARKET',
      PRIMARY,
      'PRIMARY',
    ]);
  });

  it('[TC-FX-PROVIDER-035] la tasa cruzada lista la atribución de cada componente de provider sin duplicados', async () => {
    const { queries } = await seedWorld();
    const resolved = await queries.latest({
      workspaceId: WS,
      base: 'BTC',
      quote: 'BOB',
      allowCross: true,
    });
    // El DTO del contrato lleva la atribución de cada componente (la serialización HTTP se prueba en fx-http.test.ts).
    const attributionOfProvider = (p: FxRateProvider | null) => (p ? findAttribution(p) : null);
    const dto = {
      attribution: attributionOfProvider(resolved.provider),
      components: resolved.components.map((c) => ({ attribution: attributionOfProvider(c.provider) })),
    } as unknown as ResolvedRateDto;
    expect(attributionsOf(dto).map((a) => [a.provider, a.text])).toEqual([
      [PRIMARY, `Fuente: ${PRIMARY.toLowerCase()} (doble de prueba)`],
      ['PARALELO_BO', 'Fuente: paralelo.bo'],
    ]);
    expect(attributionsOf(dto).find((a) => a.provider === 'PARALELO_BO')?.license).toBe('CC BY 4.0');
  });

  it('[TC-FX-PROVIDER-033] con el principal cripto a 70 minutos la valoración usa el respaldo (nivel FALLBACK)', async () => {
    const { mem, primary, fallback, ingestion, queries, configure } = setup({ now: '2026-10-13T12:50:00Z' });
    await configure(WS, ['BTC/USDT']);
    primary.prices = { BTC: { price: '65000.00', asOf: '2026-10-13T12:50:00.000Z' } };
    await ingestion.poll();
    mem.clock.set(at('2026-10-13T13:58:00Z'));
    fallback.prices = { BTC: { price: '65100.00', asOf: '2026-10-13T13:58:00.000Z' } };
    await ingestion.poll();
    mem.clock.set(at('2026-10-13T14:00:00Z'));
    const valued = await queries.convertForValuation({
      workspaceId: WS,
      amount: { amount: '0.01000000', currency: 'BTC' },
      to: 'USDT',
    });
    expect(valued.amount.toString()).toBe('651.000000 USDT');
    expect([valued.resolved?.provider, valued.resolved?.selection, valued.resolved?.ageSeconds]).toEqual([
      FALLBACK,
      'FALLBACK',
      120,
    ]);
  });

  it('[TC-FX-PROVIDER-037] el estado informa por cada par su cobertura y la antigüedad de su última tasa automática', async () => {
    const { status } = await seedWorld();
    const report = await status.statusReport(WS);
    const byPair = new Map(report.pairs.map((p) => [`${p.base}/${p.quote}`, p]));
    expect(byPair.get('USDT/BOB')).toMatchObject({
      coverage: 'AUTOMATIC',
      providers: ['PARALELO_BO', 'DOLARAPI_BO'],
      lastAutomaticRateAt: '2026-10-13T14:00:00.000Z',
      ageSeconds: 300,
      stale: false,
    });
    expect(byPair.get('BTC/USDT')).toMatchObject({
      coverage: 'AUTOMATIC',
      providers: [PRIMARY, FALLBACK],
      lastAutomaticRateAt: '2026-10-13T14:00:00.000Z',
      ageSeconds: 300,
      stale: false,
    });
    expect(byPair.get('EUR/BOB')).toMatchObject({
      coverage: 'MANUAL_ONLY',
      providers: [],
      lastAutomaticRateAt: null,
      ageSeconds: null,
    });
    // Los providers cripto aparecen en el estado con rol, feeds MARKET y atribución propia.
    const crypto = report.providers.find((p) => p.provider === PRIMARY);
    expect(crypto).toMatchObject({ enabled: true, health: 'HEALTHY' });
    // Solo los feeds de los pares configurados del workspace (ETH/USDT no está en su lista).
    expect(crypto?.feeds.map((f) => [f.base, f.quote, f.rateType, f.role])).toEqual([
      ['BTC', 'USDT', 'MARKET', 'PRIMARY'],
    ]);
    expect(crypto?.attribution.provider).toBe(PRIMARY);
  });

  it('[TC-FX-PROVIDER-037] el descriptor del doble declara su verificación; un registro duplicado se da de baja', () => {
    const d = fakeCryptoDescriptor({ id: 'CRYPTO_TEST_X' });
    expect(d.terms).toEqual(FAKE_VERIFIED_TERMS);
    expect(providerDescriptor('CRYPTO_TEST_X')).toBeNull();
    expect(() => fakeCryptoDescriptor({ id: 'NO_CRYPTO' as never })).not.toThrow();
  });
});
