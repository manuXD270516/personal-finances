import { currency, Instant, Money } from '@pf/shared-kernel';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FX_INSTITUTION_PROVIDER_IDS,
  providerDescriptor,
  ProviderError,
  ProviderSample,
  registeredInstitutionDescriptors,
  type FxRateProvider,
  type MarketRateProvider,
} from '../domain/index.js';
import { FxQueries } from './fx.queries.js';
import { FxService } from './fx.service.js';
import { MarketRateIngestion } from './market-rate-ingestion.js';
import type { FxDeps, InstitutionSupportPort } from './ports/index.js';
import {
  anomalyThresholdsOf,
  assetClassPolicyOf,
  enabledProviders,
  parseFxProviderSettings,
  valuationPolicyOf,
  type FxProviderSettings,
} from './provider-settings.js';
import { ProviderStatusQueries } from './provider-status.queries.js';
import { FakeInstitutionRateProvider } from './testing/fake-institution-provider.js';
import { inMemoryFxDeps } from './testing/in-memory.js';

// Tasas por institución con DOBLES en memoria (add-exchange-house-rate-providers; sin red ni adapters reales: ningún
// adapter se escribe antes de verificar los términos de su fuente): configuración con términos verificados, ingesta con
// idempotencia por institución y lado, anomalías por entidad y lado, valoración y estado por institución.
const WS = '0192f3c4-aaaa-7000-8000-000000000001';
const WS2 = '0192f3c4-aaaa-7000-8000-000000000002';
const ID = 'INSTRATE_TEST' as const;
const PARALELO_RAW =
  '{"timestamp":"2026-10-08T15:58:00.000Z","buy":12.12,"sell":11.92,"median":12.02,"spreadPct":-1.6972,"sourceCount":4,"methodologyVersion":"ec2-backend"}';

const unregister: (() => void)[] = [];
afterEach(() => {
  for (const off of unregister.splice(0)) off();
});

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

const parallel = (value: string, asOf: string, fetchedAt: string) =>
  ProviderSample.of({
    provider: 'PARALELO_BO',
    base: 'USD',
    quote: 'BOB',
    rateType: 'PARALLEL',
    value,
    asOf,
    fetchedAt,
    rawPayload: PARALELO_RAW,
    sourceLabel: 'paralelo.bo (mediana P2P USDT/BOB)',
  });

const at = (iso: string) => Instant.parse(iso);

interface SetupOptions {
  readonly env?: Record<string, string>;
  readonly workspaces?: string[];
  readonly now?: string;
  readonly support?: InstitutionSupportPort;
}

function setup(options: SetupOptions = {}) {
  const mem = inMemoryFxDeps();
  mem.clock.set(at(options.now ?? '2026-10-08T16:10:00Z'));
  const now = () => mem.clock.now().toString();
  const institution = new FakeInstitutionRateProvider({ id: ID }, now);
  unregister.push(institution.register());
  const settings: FxProviderSettings = parseFxProviderSettings({
    FX_PROVIDER_FALLBACK: 'none',
    FX_PROVIDER_OFFICIAL: 'none',
    FX_PROVIDER_INSTITUTION_RATES: 'instrate_test',
    ...options.env,
  });
  for (const ws of options.workspaces ?? [WS]) {
    mem.state.workspaces.set(ws, 'America/La_Paz');
    mem.state.enabled.set(ws, new Set(['BOB', 'USD', 'USDT']));
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
    providers: { PARALELO_BO: paralelo, [ID]: institution } as unknown as Partial<
      Record<FxRateProvider, MarketRateProvider>
    >,
    pairs: mem.deps.pairs,
  });
  const status = new ProviderStatusQueries({
    uow: mem.deps.uow,
    rates: mem.deps.rates,
    runs: mem.runs,
    clock: mem.clock,
    settings,
    ...(options.support ? { institutionSupport: options.support } : {}),
  });
  return {
    mem,
    institution,
    paralelo,
    settings,
    ingestion,
    status,
    service: new FxService(deps),
    queries: new FxQueries(deps),
  };
}

const institutionRates = (mem: ReturnType<typeof setup>['mem'], ws = WS) =>
  mem.state.rates.filter((r) => r.snapshot.workspaceId === ws && r.snapshot.institutionCode);

describe('Configuración del provider por institución solo con términos verificados (fx/market-rate-providers)', () => {
  it('[TC-FX-INSTRATE-001] el default es none: sin provider por institución habilitado y sin id real habilitable', () => {
    const s = parseFxProviderSettings();
    expect([s.institutionProvider, s.institutionConfigError, s.configError]).toEqual([null, null, null]);
    expect(enabledProviders(s)).toEqual(['PARALELO_BO', 'DOLARAPI_BO']);
    expect(FX_INSTITUTION_PROVIDER_IDS).toEqual([]);
    expect([s.institutionPollIntervalMs, s.staleAfterInstitutionMs]).toEqual([3_600_000, 72 * 3_600_000]);
    // Un id sin adapter ni verificación registrados no se habilita: el único modo de enchufar uno hoy es un doble.
    const unknown = parseFxProviderSettings({ FX_PROVIDER_INSTITUTION_RATES: 'instrate_bcb' });
    expect(unknown.institutionConfigError).toMatch(/no registered adapter/);
    expect(unknown.institutionProvider).toBeNull();
    const malformed = parseFxProviderSettings({ FX_PROVIDER_INSTITUTION_RATES: 'bcb' });
    expect(malformed.institutionConfigError).toMatch(/INSTRATE_<NAME>/);
  });

  it('[TC-FX-INSTRATE-001] un provider sin verificación de términos queda deshabilitado con FX_PROVIDER_CONFIG_INVALID y NO envía ninguna solicitud; los demás siguen', async () => {
    const unverified = new FakeInstitutionRateProvider(
      { id: 'INSTRATE_UNVERIFIED', terms: { status: 'UNVERIFIED', verifiedOn: null, adr: null } },
      () => '2026-10-08T16:10:00Z',
    );
    unverified.quotes = { BAD: { compra: '11.85' } };
    unregister.push(unverified.register());
    const s = parseFxProviderSettings({ FX_PROVIDER_INSTITUTION_RATES: 'instrate_unverified' });
    expect(s.institutionConfigError).toMatch(/cannot be enabled, its terms of use are not verified/);
    expect(s.institutionProvider).toBeNull();
    // Los providers ya verificados (paralela, oficial) siguen funcionando.
    expect([s.configError, s.primary, s.fallback, s.official]).toEqual([
      null,
      'PARALELO_BO',
      'DOLARAPI_BO',
      'DOLARAPI_BO',
    ]);
    expect(enabledProviders(s)).toEqual(['PARALELO_BO', 'DOLARAPI_BO']);

    const mem = inMemoryFxDeps();
    mem.clock.set(at('2026-10-08T16:10:00Z'));
    mem.state.workspaces.set(WS, 'America/La_Paz');
    mem.state.enabled.set(WS, new Set(['BOB', 'USD']));
    const paralelo = new FakeParalelo();
    paralelo.latest = [parallel('12.02', '2026-10-08T16:00:00Z', '2026-10-08T16:10:00Z')];
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
      settings: { ...s, fallback: null, official: null },
      providers: { PARALELO_BO: paralelo, INSTRATE_UNVERIFIED: unverified } as unknown as Partial<
        Record<FxRateProvider, MarketRateProvider>
      >,
      pairs: mem.deps.pairs,
    });
    await ingestion.poll();
    expect(unverified.calls).toBe(0);
    expect(paralelo.calls).toBe(1);
    expect(mem.state.rates.filter((r) => r.snapshot.institutionCode)).toEqual([]);
    expect(mem.state.rates.some((r) => r.snapshot.provider === 'PARALELO_BO')).toBe(true);
  });

  it('[TC-FX-INSTRATE-002] una fuente cuyos términos prohíben la automatización (REJECTED) no se habilita y no se consulta', () => {
    const rejected = new FakeInstitutionRateProvider(
      { id: 'INSTRATE_REJECTED', terms: { status: 'REJECTED', verifiedOn: '2026-10-15', adr: 'ADR-TEST' } },
      () => '2026-10-08T16:10:00Z',
    );
    unregister.push(rejected.register());
    const s = parseFxProviderSettings({ FX_PROVIDER_INSTITUTION_RATES: 'instrate_rejected' });
    expect(s.institutionConfigError).toMatch(/terms of use are rejected/);
    expect(s.institutionProvider).toBeNull();
    expect(enabledProviders(s)).not.toContain('INSTRATE_REJECTED');
    expect(rejected.calls).toBe(0);
  });

  it('una verificación VERIFIED con fecha y ADR habilita al provider; sus roles y su obsolescencia entran a la política de valoración', () => {
    const { settings } = setup();
    expect([settings.institutionProvider, settings.institutionConfigError]).toEqual([ID, null]);
    expect(enabledProviders(settings)).toEqual(['PARALELO_BO', ID]);
    const policy = valuationPolicyOf(settings);
    expect(policy.roles.BANK_SELL).toEqual({ primary: ID, fallback: null });
    expect(policy.roles.BANK_BUY).toEqual({ primary: ID, fallback: null });
    expect(policy.staleAfterMs.BANK_SELL).toBe(72 * 3_600_000);
    // Sin provider por institución la política de valoración no cambia en nada.
    const none = valuationPolicyOf(parseFxProviderSettings());
    expect(none.roles.BANK_SELL).toBeUndefined();
    expect(none.staleAfterMs.BANK_SELL).toBeUndefined();
  });

  it('valida el intervalo (mínimo 60 s), la obsolescencia y su coherencia sin tocar a los demás providers', () => {
    const base = { FX_PROVIDER_INSTITUTION_RATES: 'instrate_test' };
    setup(); // registra el doble
    const bad = (env: Record<string, string>) => parseFxProviderSettings({ ...base, ...env });
    expect(bad({ FX_INSTITUTION_RATES_INTERVAL: '30s' }).institutionConfigError).toMatch(
      /at least 60 seconds/,
    );
    expect(bad({ FX_INSTITUTION_RATES_INTERVAL: 'rápido' }).institutionConfigError).toMatch(/duration/);
    expect(bad({ FX_STALE_AFTER_INSTITUTION: '0h' }).institutionConfigError).toMatch(/duration/);
    expect(bad({ FX_STALE_AFTER_INSTITUTION: '30m' }).institutionConfigError).toMatch(
      /must not be shorter than FX_POLL_INTERVAL nor than FX_INSTITUTION_RATES_INTERVAL/,
    );
    const err = bad({ FX_STALE_AFTER_INSTITUTION: '30m' });
    expect([err.institutionProvider, err.configError, err.primary]).toEqual([null, null, 'PARALELO_BO']);
    expect(bad({ FX_INSTITUTION_RATES_INTERVAL: '60s' }).institutionConfigError).toBeNull();
  });

  it('la pila E2E (FX_POLL_INTERVAL=24h, FX_FEED_STALE_ALERT_AFTER=24h) con el provider habilitado no produce errores de configuración', () => {
    setup();
    const s = parseFxProviderSettings({
      FX_POLL_INTERVAL: '24h',
      FX_FEED_STALE_ALERT_AFTER: '24h',
      FX_PROVIDER_INSTITUTION_RATES: 'instrate_test',
    });
    expect([s.configError, s.institutionConfigError, s.cryptoConfigError]).toEqual([null, null, null]);
    expect(s.institutionProvider).toBe(ID);
  });
});

describe('Ingesta de tasas por institución (fx/market-rate-providers)', () => {
  it('[TC-FX-INSTRATE-003] un ciclo registra la compra de cada entidad como BANK_SELL con la vigencia publicada y un segundo ciclo con la misma publicación no duplica', async () => {
    const { mem, institution, ingestion } = setup();
    institution.quotes = { BAD: { compra: '11.85' }, BBD: { compra: '12.03' } };
    await ingestion.poll();
    const rates = institutionRates(mem);
    expect(
      rates.map((r) => [r.snapshot.institutionCode, r.snapshot.rateType, r.valueText, r.snapshot.asOf]),
    ).toEqual([
      ['BAD', 'BANK_SELL', '11.85', '2026-10-08T16:00:00.000Z'],
      ['BBD', 'BANK_SELL', '12.03', '2026-10-08T16:00:00.000Z'],
    ]);
    expect(rates.every((r) => r.snapshot.source === 'PROVIDER' && r.snapshot.provider === ID)).toBe(true);
    expect(rates.every((r) => r.rate.base.code === 'USD' && r.rate.quote.code === 'BOB')).toBe(true);
    // Ninguna BANK_BUY ni BANK para esas entidades.
    expect(
      mem.state.rates.some((r) => r.snapshot.rateType === 'BANK_BUY' || r.snapshot.rateType === 'BANK'),
    ).toBe(false);

    // Mismo ciclo con la misma publicación: idempotente (otra hora del mismo intervalo, mismo asOf).
    mem.clock.set(at('2026-10-08T17:10:00Z'));
    await ingestion.poll();
    expect(institutionRates(mem)).toHaveLength(2);
    expect(institution.calls).toBe(2);
  });

  it('[TC-FX-INSTRATE-004] la fuente que publica compra y venta registra BANK_SELL y BANK_BUY; un valor con más decimales se guarda exacto', async () => {
    const { mem, institution, ingestion } = setup();
    institution.quotes = { BAD: { compra: '11.8537', venta: '11.95' } };
    await ingestion.poll();
    const rates = institutionRates(mem);
    expect(rates.map((r) => [r.snapshot.institutionCode, r.snapshot.rateType, r.valueText]).sort()).toEqual([
      ['BAD', 'BANK_BUY', '11.95'],
      ['BAD', 'BANK_SELL', '11.8537'],
    ]);
    // El raw se conserva como evidencia y la fuente no calcula un punto medio BANK.
    expect(rates.every((r) => r.snapshot.rawPayload?.includes('"entidad":"BAD"'))).toBe(true);
    expect(mem.state.rates.some((r) => r.snapshot.rateType === 'BANK')).toBe(false);
  });

  it('registra TODAS las entidades publicadas en cada workspace activo (copias por workspace), no solo las adoptadas', async () => {
    const { mem, institution, ingestion } = setup({ workspaces: [WS, WS2] });
    institution.quotes = { BAD: { compra: '11.85' }, BBD: { compra: '12.03' }, CID: { compra: '11.7' } };
    await ingestion.poll();
    expect(institutionRates(mem, WS)).toHaveLength(3);
    expect(institutionRates(mem, WS2)).toHaveLength(3);
    expect(institution.calls).toBe(1);
  });

  it('el evento fx.RateRecorded lleva institutionCode solo en las tasas por institución', async () => {
    const { mem, institution, paralelo, ingestion } = setup();
    institution.quotes = { BAD: { compra: '11.85' } };
    paralelo.latest = [parallel('12.02', '2026-10-08T16:00:00Z', '2026-10-08T16:10:00Z')];
    await ingestion.poll();
    const events = mem.state.outbox.filter((e) => e.eventType === 'fx.RateRecorded');
    const bank = events.find((e) => e.payload['rateType'] === 'BANK_SELL');
    const par = events.find((e) => e.payload['rateType'] === 'PARALLEL');
    expect(bank?.payload['institutionCode']).toBe('BAD');
    expect(bank?.payload['provider']).toBe(ID);
    expect(par).toBeDefined();
    expect('institutionCode' in (par?.payload ?? {})).toBe(false);
  });

  it('la anomalía se evalúa por entidad y lado: una variación de BAD/BANK_SELL no retiene a BBD ni a BAD/BANK_BUY', async () => {
    const { mem, institution, ingestion } = setup();
    institution.quotes = { BAD: { compra: '11.85', venta: '11.95' }, BBD: { compra: '12.03' } };
    await ingestion.poll();
    // Un día después: BAD compra +13.9 % (anómala), BAD venta +0.5 %, BBD compra +0.3 %.
    mem.clock.set(at('2026-10-09T16:10:00Z'));
    institution.asOf = '2026-10-09T16:00:00Z';
    institution.quotes = { BAD: { compra: '13.50', venta: '12.01' }, BBD: { compra: '12.07' } };
    await ingestion.poll();
    const flagged = institutionRates(mem).filter((r) => r.snapshot.anomaly !== null);
    expect(flagged.map((r) => [r.snapshot.institutionCode, r.snapshot.rateType, r.valueText])).toEqual([
      ['BAD', 'BANK_SELL', '13.5'],
    ]);
    const mark = flagged[0]?.snapshot.anomaly;
    // La línea base es la tasa anterior de LA MISMA entidad y lado, no la de otra entidad.
    const baseline = mem.state.rates.find((r) => r.id === mark?.baselineRateId);
    expect([baseline?.snapshot.institutionCode, baseline?.snapshot.rateType, baseline?.valueText]).toEqual([
      'BAD',
      'BANK_SELL',
      '11.85',
    ]);
    expect(institutionRates(mem)).toHaveLength(6);
  });

  it('las tasas por institución no cambian la valoración por defecto: PARALLEL sigue valorando y BANK_SELL solo con preferencia', async () => {
    const { mem, institution, paralelo, ingestion, queries, service } = setup();
    institution.quotes = { BAD: { compra: '11.85' } };
    paralelo.latest = [parallel('12.02', '2026-10-08T16:00:00Z', '2026-10-08T16:10:00Z')];
    await ingestion.poll();
    const usd = currency('USD', 2);
    const valued = async () => {
      const [found] = await queries.resolveValuationRates(WS, [
        { base: 'USD', quote: 'BOB', at: mem.clock.now() },
      ]);
      return found;
    };
    const def = await valued();
    expect(def?.rateType).toBe('PARALLEL');
    expect(def?.rate.convert(Money.parse('100.00', usd)).toFixed()).toBe('1202.00');
    expect(mem.state.rates.filter((r) => r.snapshot.rateType === 'BANK_SELL')).toHaveLength(1);
    // Con BANK_SELL como preferencia del par valora con la tasa de la institución.
    await service.replacePreferences({
      workspaceId: WS,
      expectedVersion: 1,
      preferences: [{ base: 'USD', quote: 'BOB', rateType: 'BANK_SELL' }],
    });
    const preferred = await valued();
    expect(preferred?.rateType).toBe('BANK_SELL');
    expect(preferred?.rate.convert(Money.parse('100.00', usd)).toFixed()).toBe('1185.00');
  });

  it('una falla del provider por institución no afecta a la tasa paralela y queda en fx.provider_run', async () => {
    const { mem, institution, paralelo, ingestion } = setup();
    paralelo.latest = [parallel('12.02', '2026-10-08T16:00:00Z', '2026-10-08T16:10:00Z')];
    institution.failure = new ProviderError('PROVIDER_UNAVAILABLE', 'fuente caída', 503);
    const results = await ingestion.poll();
    expect(results.map((r) => [r.provider, r.outcome])).toEqual([
      ['PARALELO_BO', 'OK'],
      [ID, 'FAILED'],
    ]);
    expect(mem.state.rates.some((r) => r.snapshot.rateType === 'PARALLEL')).toBe(true);
    expect(institutionRates(mem)).toEqual([]);
    expect(mem.state.runs.find((r) => r.provider === ID)?.errorCode).toBe('PROVIDER_UNAVAILABLE');
  });
});

describe('Intervalo propio del provider por institución (FX_INSTITUTION_RATES_INTERVAL)', () => {
  it('con el ciclo cada 15 min y la fuente cada 60 min, solo se consulta en el primer ciclo con 60 min desde el último intento', async () => {
    const { mem, institution, paralelo, ingestion } = setup({
      env: { FX_POLL_INTERVAL: '15m', FX_INSTITUTION_RATES_INTERVAL: '60m' },
    });
    institution.quotes = { BAD: { compra: '11.85' } };
    await ingestion.poll();
    for (const minutes of [15, 30, 45]) {
      mem.clock.set(at('2026-10-08T16:10:00Z').plusMillis(minutes * 60_000));
      await ingestion.poll();
    }
    expect([institution.calls, paralelo.calls]).toEqual([1, 4]);
    mem.clock.set(at('2026-10-08T16:10:00Z').plusMillis(60 * 60_000));
    await ingestion.poll();
    expect([institution.calls, paralelo.calls]).toEqual([2, 5]);
    // Los ciclos omitidos no dejan filas en fx.provider_run.
    expect(mem.state.runs.filter((r) => r.provider === ID)).toHaveLength(2);
  });

  it('con un intervalo no mayor que el del ciclo (pila E2E con ciclo de 24 h) se consulta en cada ciclo', async () => {
    const { mem, institution, ingestion } = setup({
      env: {
        FX_POLL_INTERVAL: '24h',
        FX_FEED_STALE_ALERT_AFTER: '24h',
        FX_INSTITUTION_RATES_INTERVAL: '60m',
      },
    });
    institution.quotes = { BAD: { compra: '11.85' } };
    await ingestion.poll();
    mem.clock.set(at('2026-10-08T16:11:00Z'));
    await ingestion.poll();
    expect(institution.calls).toBe(2);
  });
});

describe('Estado de las tasas por institución (fx/market-rate-providers, Should)', () => {
  it('[TC-FX-INSTRATE-007] la última BANK_SELL de BAD de hace 80 h con umbral de 72 h se informa obsoleta con su antigüedad, sin llamar a ningún proveedor', async () => {
    const { mem, institution, ingestion, status } = setup({ now: '2026-10-08T16:10:00Z' });
    institution.quotes = { BAD: { compra: '11.85' } };
    institution.asOf = '2026-10-08T16:00:00Z';
    await ingestion.poll();
    const callsBefore = institution.calls;
    mem.clock.set(at('2026-10-12T00:00:00Z')); // vigencia + 80 h
    const report = await status.statusReport(WS);
    const bad = report.institutions.find((i) => i.code === 'BAD');
    expect(bad).toMatchObject({
      code: 'BAD',
      rateTypes: ['BANK_SELL'],
      lastRateAsOf: '2026-10-08T16:00:00.000Z',
      ageSeconds: 80 * 3600,
      stale: true,
    });
    expect(institution.calls).toBe(callsBefore);
    // Dentro del umbral no está obsoleta.
    mem.clock.set(at('2026-10-10T16:00:00Z'));
    expect((await status.statusReport(WS)).institutions.find((i) => i.code === 'BAD')).toMatchObject({
      ageSeconds: 48 * 3600,
      stale: false,
    });
  });

  it('[TC-FX-INSTRATE-008] una institución adoptada sin proveedor informa su estado de soporte en tasas y la razón, sin tasas automáticas', async () => {
    const support: InstitutionSupportPort = {
      adoptedRatesSupport: async () => [
        { code: 'CID', status: 'NOT_ELIGIBLE', reason: 'NO_PUBLICATION' },
        { code: 'BAL', status: 'NOT_APPLICABLE', reason: null },
      ],
    };
    // Sin provider por institución habilitado (default none).
    const mem = inMemoryFxDeps();
    const settings = parseFxProviderSettings();
    const status = new ProviderStatusQueries({
      uow: mem.deps.uow,
      rates: mem.deps.rates,
      runs: mem.runs,
      clock: mem.clock,
      settings,
      institutionSupport: support,
    });
    const report = await status.statusReport(WS);
    expect(report.institutions).toEqual([
      {
        code: 'BAL',
        rateTypes: [],
        lastRateAsOf: null,
        ageSeconds: null,
        stale: false,
        supportStatus: 'NOT_APPLICABLE',
        reason: null,
      },
      {
        code: 'CID',
        rateTypes: [],
        lastRateAsOf: null,
        ageSeconds: null,
        stale: false,
        supportStatus: 'NOT_ELIGIBLE',
        reason: 'NO_PUBLICATION',
      },
    ]);
  });

  it('las instituciones cubiertas por el provider se informan con su estado de soporte cuando están adoptadas', async () => {
    const support: InstitutionSupportPort = {
      adoptedRatesSupport: async () => [{ code: 'BAD', status: 'SUPPORTED', reason: null }],
    };
    const { institution, ingestion, status } = setup({ support });
    institution.quotes = { BAD: { compra: '11.85', venta: '11.95' }, BBD: { compra: '12.03' } };
    await ingestion.poll();
    const report = await status.statusReport(WS);
    expect(report.institutions.map((i) => [i.code, i.rateTypes, i.supportStatus])).toEqual([
      ['BAD', ['BANK_BUY', 'BANK_SELL'], 'SUPPORTED'],
      ['BBD', ['BANK_SELL'], null],
    ]);
    // El provider por institución aparece en la lista de providers sin feeds por par.
    const provider = report.providers.find((p) => p.provider === ID);
    expect([provider?.enabled, provider?.feeds, provider?.health]).toEqual([true, [], 'HEALTHY']);
    expect(provider?.pollIntervalSeconds).toBe(3600);
    expect(registeredInstitutionDescriptors().map((d) => d.id)).toContain(ID);
  });

  it('una configuración inválida del provider por institución se informa como FX_PROVIDER_CONFIG_INVALID solo en él', async () => {
    setup(); // registra el doble
    const settings = parseFxProviderSettings({
      FX_PROVIDER_INSTITUTION_RATES: 'instrate_test',
      FX_INSTITUTION_RATES_INTERVAL: '10s',
    });
    const mem = inMemoryFxDeps();
    const statuses = await new ProviderStatusQueries({
      uow: mem.deps.uow,
      rates: mem.deps.rates,
      runs: mem.runs,
      clock: mem.clock,
      settings,
    }).status(WS);
    const inst = statuses.find((p) => p.provider === ID);
    expect([inst?.enabled, inst?.health, inst?.lastError?.code]).toEqual([
      false,
      'DISABLED',
      'FX_PROVIDER_CONFIG_INVALID',
    ]);
    expect(statuses.find((p) => p.provider === 'PARALELO_BO')?.lastError).toBeNull();
  });
});
