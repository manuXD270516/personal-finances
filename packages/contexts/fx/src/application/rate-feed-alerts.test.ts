import { Instant } from '@pf/shared-kernel';
import { afterEach, describe, expect, it } from 'vitest';
import {
  providerDescriptor,
  ProviderError,
  ProviderSample,
  type FxRateProvider,
  type FxRateType,
  type MarketRateProvider,
} from '../domain/index.js';
import { FxService } from './fx.service.js';
import { MarketRateIngestion } from './market-rate-ingestion.js';
import { parseFxProviderSettings, type FxProviderSettings } from './provider-settings.js';
import { FakeCryptoProvider } from './testing/fake-crypto-provider.js';
import { inMemoryFxDeps } from './testing/in-memory.js';

// Alertas de obsolescencia por par y hecho de muestra retenida (add-rate-feed-alerts; D233, D234, D236, D249) con
// dobles en memoria: sin red, con reloj fijo y el doble del puerto de NOTIFY.
const WS = '0192f3c4-aaaa-7000-8000-000000000001';
const WS2 = '0192f3c4-aaaa-7000-8000-000000000002';
const CRYPTO = 'CRYPTO_TEST_PRIMARY' as const;
const RAW =
  '{"timestamp":"2026-10-13T08:00:00.000Z","buy":12.12,"sell":11.92,"median":12.02,"spreadPct":-1.6972,"sourceCount":4,"methodologyVersion":"ec2-backend"}';
const at = (iso: string) => Instant.parse(iso);

const unregister: (() => void)[] = [];
afterEach(() => {
  for (const off of unregister.splice(0)) off();
});

class FakeParalelo implements MarketRateProvider {
  latest: ProviderSample[] = [];
  failure: ProviderError | null = null;
  descriptor() {
    return providerDescriptor('PARALELO_BO') as NonNullable<ReturnType<typeof providerDescriptor>>;
  }
  async fetchLatest() {
    if (this.failure) throw this.failure;
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
    rawPayload: RAW,
    sourceLabel: 'paralelo.bo (mediana P2P USDT/BOB)',
  });

interface SetupOptions {
  readonly env?: Record<string, string>;
  readonly workspaces?: string[];
  readonly now?: string;
  readonly withCrypto?: boolean;
  readonly withNotifications?: boolean;
}

function setup(options: SetupOptions = {}) {
  const mem = inMemoryFxDeps();
  mem.clock.set(at(options.now ?? '2026-10-13T08:05:00Z'));
  const now = () => mem.clock.now().toString();
  const crypto = new FakeCryptoProvider({ id: CRYPTO, symbols: ['BTC'] }, now);
  if (options.withCrypto) unregister.push(crypto.register());
  const settings: FxProviderSettings = parseFxProviderSettings({
    ...(options.withCrypto ? { FX_PROVIDER_CRYPTO_PRIMARY: 'crypto_test_primary' } : {}),
    ...options.env,
  });
  for (const ws of options.workspaces ?? [WS]) {
    mem.state.workspaces.set(ws, 'America/La_Paz');
    mem.state.enabled.set(ws, new Set(['BOB', 'USD', 'USDT', 'EUR', 'BTC']));
  }
  const paralelo = new FakeParalelo();
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
    providers: { PARALELO_BO: paralelo, [CRYPTO]: crypto } as unknown as Partial<
      Record<FxRateProvider, MarketRateProvider>
    >,
    pairs: mem.deps.pairs,
    historyCache: mem.historyCache,
    firstBalance: mem.firstBalance,
    episodes: mem.episodes,
    ...(options.withNotifications === false ? {} : { notifications: mem.notifications }),
  });
  const service = new FxService(mem.deps);
  const configure = (ws: string, list: string[]) =>
    service.replaceRatePairs({
      workspaceId: ws,
      expectedVersion: mem.state.pairLists.get(ws)?.version ?? 1,
      mode: 'CUSTOM',
      pairs: list.map((p) => ({ base: p.split('/')[0] as string, quote: p.split('/')[1] as string })),
    });
  const advance = (iso: string) => mem.clock.set(at(iso));
  /** Un ciclo con la caída del provider (y sin tasas nuevas) a este instante. */
  const down = async (iso: string) => {
    advance(iso);
    paralelo.failure = new ProviderError('PROVIDER_UNAVAILABLE', 'unexpected HTTP 503', 503);
    return ingestion.poll();
  };
  const episodes = (ws = WS) => mem.state.episodes.filter((e) => e.workspaceId === ws);
  const events = (type: string) => mem.state.outbox.filter((e) => e.eventType === type);
  return { mem, paralelo, crypto, settings, ingestion, service, configure, advance, down, episodes, events };
}

/** USDT/BOB con su última tasa PARALLEL de vigencia 08:00Z y los providers caídos desde las 08:10Z (TC-FX-PROVIDER-038). */
async function usdtDownFrom0810(options: SetupOptions = {}) {
  const ctx = setup(options);
  await ctx.configure(WS, ['USDT/BOB', 'EUR/BOB']);
  ctx.paralelo.latest = [parallel('USDT', '12.02', '2026-10-13T08:00:00Z', ctx.mem.clock.now().toString())];
  await ctx.ingestion.poll();
  expect(ctx.episodes()).toHaveLength(0);
  return ctx;
}

describe('Episodios de obsolescencia por par configurado (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-038] a las 6 h exactas no hay episodio; a las 14:15Z se abre uno desde 08:00Z con un único hecho', async () => {
    const { mem, down, episodes, events } = await usdtDownFrom0810();
    await down('2026-10-13T14:00:00Z');
    expect(episodes()).toHaveLength(0);
    expect(events('fx.RateFeedStale')).toHaveLength(0);

    await down('2026-10-13T14:15:00Z');
    const [episode, ...rest] = episodes();
    expect(rest).toHaveLength(0);
    expect(episode).toMatchObject({
      base: 'USDT',
      quote: 'BOB',
      openedAt: '2026-10-13T14:15:00.000Z',
      lastRateAsOf: '2026-10-13T08:00:00.000Z',
      closedAt: null,
    });
    const [stale, ...more] = events('fx.RateFeedStale');
    expect(more).toHaveLength(0);
    expect(stale).toMatchObject({
      aggregateId: episode?.id,
      actor: { type: 'SYSTEM' },
      payload: {
        episodeId: episode?.id,
        base: 'USDT',
        quote: 'BOB',
        lastRateAsOf: '2026-10-13T08:00:00.000Z',
        staleAfterSeconds: 21600,
        detectedAt: '2026-10-13T14:15:00.000Z',
      },
    });
    expect(mem.state.notified).toHaveLength(1);
    expect(mem.state.notified[0]).toMatchObject({
      workspaceId: WS,
      type: 'FX_RATE_FEED_STALE',
      factKey: episode?.id,
      payload: { base: 'USDT', quote: 'BOB', timeZone: 'America/La_Paz', staleAfterSeconds: 21600 },
    });
  });

  it('[TC-FX-PROVIDER-038] las verificaciones de las 14:30Z, 14:45Z y 15:00Z no abren otro episodio ni publican otro hecho', async () => {
    const { mem, down, episodes, events } = await usdtDownFrom0810();
    await down('2026-10-13T14:15:00Z');
    for (const t of ['14:30', '14:45', '15:00']) await down(`2026-10-13T${t}:00Z`);
    expect(episodes()).toHaveLength(1);
    expect(events('fx.RateFeedStale')).toHaveLength(1);
    expect(mem.state.notified).toHaveLength(1);
  });

  it('[TC-FX-PROVIDER-039] la tasa fresca cierra el episodio con la tasa de recuperación y un único hecho; una tasa manual no lo cierra', async () => {
    const { mem, paralelo, ingestion, service, down, advance, episodes, events } = await usdtDownFrom0810();
    await down('2026-10-13T14:15:00Z');
    // El EDITOR registra USDT/BOB P2P 12.00 manual: el episodio sigue abierto (ningún provider publicó).
    advance('2026-10-13T15:00:00Z');
    await service.recordManualRate({
      workspaceId: WS,
      userId: '0192f3c4-bbbb-7000-8000-000000000001',
      base: 'USDT',
      quote: 'BOB',
      value: '12.00',
      rateType: 'P2P',
      asOf: '2026-10-13T14:59:00Z',
    });
    paralelo.failure = new ProviderError('PROVIDER_UNAVAILABLE', '503', 503);
    await ingestion.poll();
    expect(episodes().filter((e) => e.closedAt === null)).toHaveLength(1);
    expect(events('fx.RateFeedRecovered')).toHaveLength(0);

    // paralelo.bo vuelve a las 16:00Z con vigencia 15:58Z.
    advance('2026-10-13T16:00:00Z');
    paralelo.failure = null;
    paralelo.latest = [parallel('USDT', '12.05', '2026-10-13T15:58:00Z', mem.clock.now().toString())];
    await ingestion.poll();
    const [episode] = episodes();
    const recovered = mem.state.rates.find(
      (r) => r.snapshot.provider === 'PARALELO_BO' && r.snapshot.asOf === '2026-10-13T15:58:00.000Z',
    );
    expect(episode).toMatchObject({
      closedAt: '2026-10-13T16:00:00.000Z',
      closedReason: 'RECOVERED',
      recoveredRateId: recovered?.id,
    });
    expect(events('fx.RateFeedRecovered')).toHaveLength(1);
    expect(events('fx.RateFeedRecovered')[0]?.payload).toMatchObject({
      episodeId: episode?.id,
      rateId: recovered?.id,
      asOf: '2026-10-13T15:58:00.000Z',
      openedAt: '2026-10-13T14:15:00.000Z',
    });
    expect(mem.state.notified.map((f) => f.type)).toEqual(['FX_RATE_FEED_STALE', 'FX_RATE_FEED_RECOVERED']);

    // 16:15Z: ni otro hecho de recuperación.
    advance('2026-10-13T16:15:00Z');
    await ingestion.poll();
    expect(events('fx.RateFeedRecovered')).toHaveLength(1);

    // Una nueva caída de más de 6 h abre un episodio nuevo.
    await down('2026-10-13T22:30:00Z');
    expect(episodes()).toHaveLength(2);
    expect(episodes().filter((e) => e.closedAt === null)).toHaveLength(1);
    expect(events('fx.RateFeedStale')).toHaveLength(2);
  });

  it('[TC-FX-PROVIDER-041] un par solo manual (EUR/BOB) nunca abre episodio, ni con dos días sin tasas', async () => {
    const { down, episodes } = await usdtDownFrom0810();
    await down('2026-10-15T08:00:00Z');
    expect(episodes().map((e) => `${e.base}/${e.quote}`)).toEqual(['USDT/BOB']);
  });

  it('[TC-FX-PROVIDER-041] con todos los providers deshabilitados no se abre ningún episodio', async () => {
    const { mem, ingestion, advance, episodes } = setup({
      env: {
        FX_PROVIDER_PRIMARY: 'none',
        FX_PROVIDER_FALLBACK: 'none',
        FX_PROVIDER_OFFICIAL: 'none',
      },
    });
    advance('2026-10-20T00:00:00Z');
    expect(await ingestion.poll()).toEqual([]);
    expect(episodes()).toHaveLength(0);
    expect(mem.state.notified).toHaveLength(0);
    expect(ingestion.lastFeedCheck.workspaces).toBe(0);
  });

  it('[TC-FX-PROVIDER-041] un N menor que el intervalo de polling o que la obsolescencia de la valoración es una configuración inválida', () => {
    const tooShort = parseFxProviderSettings({ FX_FEED_STALE_ALERT_AFTER: '10m' });
    expect(tooShort.configError).toMatch(/FX_FEED_STALE_ALERT_AFTER/);
    expect(tooShort.primary).toBeNull();
    // Menor que el umbral de obsolescencia de PARALLEL (60 min) aunque no que el polling.
    const belowStale = parseFxProviderSettings({
      FX_FEED_STALE_ALERT_AFTER: '30m',
      FX_POLL_INTERVAL: '5m',
    });
    expect(belowStale.configError).toMatch(/FX_FEED_STALE_ALERT_AFTER/);
    expect(parseFxProviderSettings({ FX_FEED_STALE_ALERT_AFTER: 'seis horas' }).configError).toMatch(
      /FX_FEED_STALE_ALERT_AFTER/,
    );
    const ok = parseFxProviderSettings();
    expect([ok.configError, ok.feedStaleAlertAfterMs]).toEqual([null, 6 * 3_600_000]);
    expect(parseFxProviderSettings({ FX_FEED_STALE_ALERT_AFTER: '12h' }).feedStaleAlertAfterMs).toBe(
      12 * 3_600_000,
    );
  });

  it('[TC-FX-PROVIDER-038] quitar el par con episodio abierto lo cierra sin aviso de recuperación', async () => {
    const { mem, down, configure, episodes, events } = await usdtDownFrom0810();
    await down('2026-10-13T14:15:00Z');
    await configure(WS, ['EUR/BOB']);
    await down('2026-10-13T14:30:00Z');
    expect(episodes()[0]).toMatchObject({ closedReason: 'PAIR_REMOVED', recoveredRateId: null });
    expect(events('fx.RateFeedRecovered')).toHaveLength(0);
    expect(mem.state.notified.map((f) => f.type)).toEqual(['FX_RATE_FEED_STALE']);
  });

  it('[TC-FX-PROVIDER-038] un par que nunca tuvo tasa abre con lastRateAsOf null en el primer ciclo sin ninguna', async () => {
    const { mem, down, configure, episodes, events } = setup();
    await configure(WS, ['USDT/BOB']);
    await down('2026-10-13T08:15:00Z');
    expect(episodes()[0]).toMatchObject({ lastRateAsOf: null });
    expect(events('fx.RateFeedStale')[0]?.payload).toMatchObject({ lastRateAsOf: null });
    expect(mem.state.notified[0]).toMatchObject({ payload: { lastRateAsOf: null } });
  });

  it('[TC-FX-PROVIDER-038] la obsolescencia cripto se mide sobre MARKET con el provider cripto, no con paralelo.bo', async () => {
    const { mem, crypto, paralelo, ingestion, configure, advance, episodes } = setup({ withCrypto: true });
    await configure(WS, ['BTC/USDT', 'USDT/BOB']);
    crypto.prices = { BTC: { price: '65000.00', asOf: '2026-10-13T08:00:00.000Z' } };
    paralelo.latest = [parallel('USDT', '12.02', '2026-10-13T08:00:00Z', mem.clock.now().toString())];
    await ingestion.poll();
    // Paralelo sigue publicando; el provider cripto cae: solo BTC/USDT abre episodio.
    advance('2026-10-13T14:15:00Z');
    paralelo.latest = [parallel('USDT', '12.02', '2026-10-13T14:10:00Z', mem.clock.now().toString())];
    crypto.prices = {};
    await ingestion.poll();
    expect(episodes().map((e) => `${e.base}/${e.quote}`)).toEqual(['BTC/USDT']);
  });

  it('[TC-FX-PROVIDER-038] una muestra anómala retenida no cuenta como tasa fresca: el par abre episodio aunque llegue una muestra', async () => {
    const { mem, paralelo, ingestion, advance, configure, episodes } = setup();
    await configure(WS, ['USDT/BOB']);
    paralelo.latest = [parallel('USDT', '12.00', '2026-10-13T08:00:00Z', mem.clock.now().toString())];
    await ingestion.poll();
    // 12.00 → 13.00 (+8.3 %) supera 5 %: queda retenida y no es la última tasa aceptada.
    advance('2026-10-13T14:15:00Z');
    paralelo.latest = [parallel('USDT', '13.00', '2026-10-13T14:10:00Z', mem.clock.now().toString())];
    await ingestion.poll();
    expect(episodes()).toHaveLength(1);
    expect(episodes()[0]).toMatchObject({ lastRateAsOf: '2026-10-13T08:00:00.000Z' });
  });

  it('[TC-NOTIFICATIONS-FX-009] un error del puerto de NOTIFY revierte episodio, evento y notificación de ese workspace y el ciclo siguiente reintenta', async () => {
    const { mem, down, episodes, events } = await usdtDownFrom0810();
    mem.faults.notify = new Error('NOTIFY caído');
    const results = await down('2026-10-13T14:15:00Z');
    expect(results).toHaveLength(2);
    expect(episodes()).toHaveLength(0);
    expect(events('fx.RateFeedStale')).toHaveLength(0);
    expect(mem.state.notified).toHaveLength(0);
    expect(mem.state.outbox.filter((e) => e.eventType === 'fx.RateRecorded')).toHaveLength(1);

    delete mem.faults.notify;
    await down('2026-10-13T14:30:00Z');
    expect(episodes()).toHaveLength(1);
    expect(events('fx.RateFeedStale')).toHaveLength(1);
    expect(mem.state.notified).toHaveLength(1);
  });

  it('[TC-NOTIFICATIONS-FX-009] el fallo de un workspace no detiene la verificación de los demás y se informa sin datos', async () => {
    const { mem, ingestion, paralelo, configure, advance, episodes } = setup({ workspaces: [WS, WS2] });
    await configure(WS, ['USDT/BOB']);
    await configure(WS2, ['USDT/BOB']);
    paralelo.latest = [parallel('USDT', '12.02', '2026-10-13T08:00:00Z', mem.clock.now().toString())];
    await ingestion.poll();
    // NOTIFY falla solo mientras procesa el primer workspace.
    let calls = 0;
    const original = mem.notifications.notify.bind(mem.notifications);
    mem.notifications.notify = async (fact) => {
      calls += 1;
      if (calls === 1) throw new Error('NOTIFY caído');
      return original(fact);
    };
    advance('2026-10-13T14:15:00Z');
    paralelo.failure = new ProviderError('PROVIDER_UNAVAILABLE', '503', 503);
    await ingestion.poll();
    expect(ingestion.lastFeedCheck).toMatchObject({ failed: 1, opened: 1, errors: ['Error'] });
    expect(episodes(WS)).toHaveLength(0);
    expect(episodes(WS2)).toHaveLength(1);
  });

  it('[TC-FX-PROVIDER-038] sin el puerto de NOTIFY se escriben igual los episodios y los eventos', async () => {
    const { mem, down, episodes, events } = await usdtDownFrom0810({ withNotifications: false });
    await down('2026-10-13T14:15:00Z');
    expect(episodes()).toHaveLength(1);
    expect(events('fx.RateFeedStale')).toHaveLength(1);
    expect(mem.state.notified).toHaveLength(0);
  });
});

describe('Hecho por muestra retenida como anómala (fx/market-rate-providers)', () => {
  async function bitcoinHeld() {
    const ctx = setup({ withCrypto: true, now: '2026-10-13T14:00:00Z' });
    await ctx.configure(WS, ['BTC/USDT']);
    ctx.crypto.prices = { BTC: { price: '65000.00', asOf: '2026-10-13T14:00:00.000Z' } };
    await ctx.ingestion.poll();
    ctx.advance('2026-10-13T14:15:00Z');
    ctx.crypto.prices = { BTC: { price: '72000.00', asOf: '2026-10-13T14:10:00.000Z' } };
    await ctx.ingestion.poll();
    return ctx;
  }

  it('[TC-FX-PROVIDER-040] una muestra de BTC/USDT 72000.00 sobre 65000.00 publica un único hecho con valor, línea base y variación', async () => {
    const { mem, events } = await bitcoinHeld();
    const held = mem.state.rates.find((r) => r.valueText === '72000' || r.valueText === '72000.00');
    expect(held?.snapshot.anomaly).toMatchObject({ variationPct: '10.7692' });
    const [fact, ...rest] = events('fx.RateAnomalyRetained');
    expect(rest).toHaveLength(0);
    expect(fact).toMatchObject({
      aggregateId: held?.id,
      actor: { type: 'SYSTEM' },
      payload: {
        rateId: held?.id,
        base: 'BTC',
        quote: 'USDT',
        rateType: 'MARKET',
        provider: CRYPTO,
        baselineValue: '65000',
        variationPct: '10.7692',
        thresholdPct: '10',
      },
    });
    expect(String((fact?.payload as { value: string }).value).replace(/\.0+$/, '')).toBe('72000');
    expect(mem.state.notified.at(-1)).toMatchObject({
      type: 'FX_RATE_ANOMALY_RETAINED',
      factKey: held?.id,
      payload: { rateId: held?.id, variationPct: '10.7692', timeZone: 'America/La_Paz' },
    });
  });

  it('[TC-FX-PROVIDER-040] repetir el ciclo con la misma vigencia y pasar 3 días sin revisión no publica otro hecho y la muestra sigue retenida', async () => {
    const { mem, ingestion, advance, events } = await bitcoinHeld();
    await ingestion.poll();
    advance('2026-10-16T14:15:00Z');
    await ingestion.poll();
    expect(events('fx.RateAnomalyRetained')).toHaveLength(1);
    expect(mem.state.notified.filter((f) => f.type === 'FX_RATE_ANOMALY_RETAINED')).toHaveLength(1);
    const held = mem.state.rates.find((r) => r.snapshot.anomaly !== null);
    // Sin aceptación automática: ninguna revisión y la valoración sigue con la línea base.
    expect(mem.state.reviews).toHaveLength(0);
    expect(held?.snapshot.anomaly).not.toBeNull();
  });

  it('[TC-FX-PROVIDER-040] una muestra dentro del umbral y la carga histórica no publican hecho de anomalía', async () => {
    const ctx = setup({ withCrypto: true, now: '2026-10-13T14:00:00Z' });
    await ctx.configure(WS, ['BTC/USDT']);
    ctx.crypto.prices = { BTC: { price: '65000.00', asOf: '2026-10-13T14:00:00.000Z' } };
    await ctx.ingestion.poll();
    ctx.advance('2026-10-13T14:15:00Z');
    ctx.crypto.prices = { BTC: { price: '65500.00', asOf: '2026-10-13T14:10:00.000Z' } };
    await ctx.ingestion.poll();
    expect(ctx.events('fx.RateAnomalyRetained')).toHaveLength(0);
  });
});
