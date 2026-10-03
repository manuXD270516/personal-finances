import { DomainError, Instant } from '@pf/shared-kernel';
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_DESCRIPTORS,
  ProviderError,
  ProviderSample,
  type FxRateProvider,
  type MarketRateProvider,
} from '../domain/index.js';
import { FxQueries } from './fx.queries.js';
import { FxService } from './fx.service.js';
import { MarketRateIngestion } from './market-rate-ingestion.js';
import {
  DEFAULT_FX_PROVIDER_SETTINGS,
  parseFxProviderSettings,
  type FxProviderSettings,
} from './provider-settings.js';
import { ProviderStatusQueries } from './provider-status.queries.js';
import { inMemoryFxDeps } from './testing/in-memory.js';

// Casos de uso de los providers con dobles del puerto `MarketRateProvider` (sin red): PollMarketRates,
// BackfillHistoricalRates, FillRateGaps, ReviewRateAnomaly y GetProviderStatus (tareas 3.1–3.4).
const WS = '0192f3c4-aaaa-7000-8000-000000000001';
const WS2 = '0192f3c4-aaaa-7000-8000-000000000002';
const EDITOR = '0192f3c4-bbbb-7000-8000-000000000001';
const RATE_OK =
  '{"timestamp":"2026-10-02T08:53:07.532Z","buy":12.12,"sell":11.92,"median":12.02,"spreadPct":-1.6972,"sourceCount":4,"methodologyVersion":"ec2-backend"}';

/** Doble de un provider: devuelve las muestras programadas o lanza la falla programada; cuenta las solicitudes. */
class FakeProvider implements MarketRateProvider {
  calls = 0;
  historyCalls = 0;
  latest: (fetchedAt: string) => ProviderSample[] = () => [];
  history: (fetchedAt: string) => ProviderSample[] = () => [];
  failure: ProviderError | null = null;

  constructor(
    readonly id: FxRateProvider,
    private readonly now: () => string,
  ) {}

  descriptor() {
    return PROVIDER_DESCRIPTORS[this.id];
  }

  async fetchLatest(): Promise<ProviderSample[]> {
    this.calls++;
    if (this.failure) throw this.failure;
    return this.latest(this.now());
  }

  async fetchHistory(): Promise<ProviderSample[]> {
    this.historyCalls++;
    if (this.failure) throw this.failure;
    return this.history(this.now());
  }
}

const sample = (
  provider: FxRateProvider,
  base: string,
  rateType: 'PARALLEL' | 'OFFICIAL',
  value: string,
  asOf: string,
  fetchedAt: string,
  raw = RATE_OK,
) =>
  ProviderSample.of({
    provider,
    base,
    quote: 'BOB',
    rateType,
    value,
    asOf,
    fetchedAt,
    rawPayload: raw,
    sourceLabel: provider === 'PARALELO_BO' ? 'paralelo.bo (mediana P2P USDT/BOB)' : 'bo.dolarapi.com',
  });

const paraleloSamples = (value: string, asOf: string) => (fetchedAt: string) => [
  sample('PARALELO_BO', 'USD', 'PARALLEL', value, asOf, fetchedAt),
  sample('PARALELO_BO', 'USDT', 'PARALLEL', value, asOf, fetchedAt),
];

function setup(settings: FxProviderSettings = DEFAULT_FX_PROVIDER_SETTINGS, workspaces: string[] = [WS]) {
  const mem = inMemoryFxDeps();
  mem.clock.set(Instant.parse('2026-10-02T09:00:00Z'));
  for (const ws of workspaces) mem.state.workspaces.set(ws, 'America/La_Paz');
  const now = () => mem.clock.now().toString();
  const paralelo = new FakeProvider('PARALELO_BO', now);
  const dolarapi = new FakeProvider('DOLARAPI_BO', now);
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
    providers: { PARALELO_BO: paralelo, DOLARAPI_BO: dolarapi },
  });
  const service = new FxService(mem.deps);
  const queries = new FxQueries(mem.deps);
  const status = new ProviderStatusQueries({
    uow: mem.deps.uow,
    rates: mem.deps.rates,
    runs: mem.runs,
    clock: mem.clock,
    settings,
  });
  return { mem, paralelo, dolarapi, ingestion, service, queries, status };
}

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
const providerRates = (mem: ReturnType<typeof inMemoryFxDeps>, ws = WS) =>
  mem.state.rates.filter((r) => r.snapshot.workspaceId === ws && r.snapshot.source === 'PROVIDER');

describe('PollMarketRates (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-001] registra la mediana 12.02 de paralelo.bo como USD/BOB y USDT/BOB PARALLEL con procedencia completa', async () => {
    const { mem, paralelo, ingestion } = setup();
    paralelo.latest = paraleloSamples('12.02', '2026-10-02T08:53:07.532Z');
    await ingestion.poll();
    const rows = providerRates(mem).filter((r) => r.snapshot.provider === 'PARALELO_BO');
    expect(rows.map((r) => [r.rate.base.code, r.valueText, r.snapshot.rateType])).toEqual([
      ['USD', '12.02', 'PARALLEL'],
      ['USDT', '12.02', 'PARALLEL'],
    ]);
    for (const r of rows) {
      expect(r.snapshot).toMatchObject({
        source: 'PROVIDER',
        provider: 'PARALELO_BO',
        asOf: '2026-10-02T08:53:07.532Z',
        fetchedAt: '2026-10-02T09:00:00.000Z',
        effectiveDate: '2026-10-02',
        rawPayload: RATE_OK,
        createdBy: null,
        anomaly: null,
        supersedesId: null,
      });
    }
  });

  it('[TC-FX-PROVIDER-005] la muestra repetida de las 09:15Z no se duplica: 0 tasas y 0 eventos nuevos, intento NO_NEW_SAMPLE', async () => {
    const { mem, paralelo, ingestion } = setup(
      parseFxProviderSettings({ FX_PROVIDER_FALLBACK: 'none', FX_PROVIDER_OFFICIAL: 'none' }),
    );
    paralelo.latest = paraleloSamples('12.02', '2026-10-02T08:53:07.532Z');
    expect((await ingestion.poll()).map((r) => [r.outcome, r.newSamples])).toEqual([['OK', 2]]);
    expect(mem.state.outbox).toHaveLength(2);
    for (const e of mem.state.outbox) {
      expect(e).toMatchObject({
        eventType: 'fx.RateRecorded',
        workspaceId: WS,
        actor: { type: 'SYSTEM', id: 'fx-provider:PARALELO_BO' },
        payload: { source: 'PROVIDER', provider: 'PARALELO_BO', anomalyFlagged: false, value: '12.02' },
      });
    }
    mem.clock.set(at('2026-10-02T09:15:00Z'));
    expect((await ingestion.poll()).map((r) => [r.outcome, r.newSamples])).toEqual([['NO_NEW_SAMPLE', 0]]);
    expect(providerRates(mem)).toHaveLength(2);
    expect(mem.state.outbox).toHaveLength(2);
    expect(mem.state.runs.map((r) => [r.kind, r.outcome, r.startedAt])).toEqual([
      ['POLL', 'OK', '2026-10-02T09:00:00.000Z'],
      ['POLL', 'NO_NEW_SAMPLE', '2026-10-02T09:15:00.000Z'],
    ]);
  });

  it('[TC-FX-PROVIDER-002] el respaldo registra OFFICIAL 12 y PARALLEL 12.055 con provider bo.dolarapi.com', async () => {
    const { mem, dolarapi, ingestion } = setup(parseFxProviderSettings({ FX_PROVIDER_PRIMARY: 'none' }));
    dolarapi.latest = (f) => [
      sample('DOLARAPI_BO', 'USD', 'OFFICIAL', '12', '2026-10-01T00:00:00.000Z', f),
      sample('DOLARAPI_BO', 'USD', 'PARALLEL', '12.055', '2026-10-02T08:50:00.000Z', f),
      sample('DOLARAPI_BO', 'USDT', 'PARALLEL', '12.055', '2026-10-02T08:50:00.000Z', f),
    ];
    await ingestion.poll();
    expect(
      providerRates(mem).map((r) => [
        r.rate.base.code,
        r.snapshot.rateType,
        r.valueText,
        r.snapshot.provider,
      ]),
    ).toEqual([
      ['USD', 'OFFICIAL', '12', 'DOLARAPI_BO'],
      ['USD', 'PARALLEL', '12.055', 'DOLARAPI_BO'],
      ['USDT', 'PARALLEL', '12.055', 'DOLARAPI_BO'],
    ]);
  });

  it('[TC-FX-PROVIDER-013] dos workspaces: UNA solicitud por provider y ciclo; cada workspace recibe sus filas', async () => {
    const { mem, paralelo, dolarapi, ingestion } = setup(DEFAULT_FX_PROVIDER_SETTINGS, [WS, WS2]);
    paralelo.latest = paraleloSamples('12.02', '2026-10-02T08:53:07.532Z');
    await ingestion.poll();
    expect([paralelo.calls, dolarapi.calls]).toEqual([1, 1]);
    expect(providerRates(mem, WS)).toHaveLength(2);
    expect(providerRates(mem, WS2)).toHaveLength(2);
    expect(new Set([...providerRates(mem, WS), ...providerRates(mem, WS2)].map((r) => r.id)).size).toBe(4);
  });

  it('[TC-FX-PROVIDER-004] una muestra inválida no registra tasas, cuenta como FAILED PROVIDER_PAYLOAD_INVALID y la última válida sigue', async () => {
    const { mem, paralelo, ingestion, status } = setup(
      parseFxProviderSettings({ FX_PROVIDER_FALLBACK: 'none', FX_PROVIDER_OFFICIAL: 'none' }),
    );
    paralelo.latest = paraleloSamples('12.02', '2026-10-02T08:53:07.532Z');
    await ingestion.poll();
    mem.clock.set(at('2026-10-02T09:15:00Z'));
    paralelo.failure = new ProviderError('PROVIDER_PAYLOAD_INVALID', 'median is not a number');
    expect((await ingestion.poll())[0]).toMatchObject({
      outcome: 'FAILED',
      errorCode: 'PROVIDER_PAYLOAD_INVALID',
    });
    expect(providerRates(mem)).toHaveLength(2);
    expect(mem.state.runs.at(-1)).toMatchObject({ outcome: 'FAILED', errorCode: 'PROVIDER_PAYLOAD_INVALID' });
    const [p] = await status.status(WS);
    expect([p?.lastError?.code, p?.consecutiveFailures, p?.feeds[0]?.lastRate?.rate.valueText]).toEqual([
      'PROVIDER_PAYLOAD_INVALID',
      1,
      '12.02',
    ]);
  });

  it('[TC-FX-PROVIDER-011] un Retry-After persistido evita consultar al provider hasta su vencimiento', async () => {
    const { mem, paralelo, ingestion } = setup(
      parseFxProviderSettings({ FX_PROVIDER_FALLBACK: 'none', FX_PROVIDER_OFFICIAL: 'none' }),
    );
    paralelo.failure = new ProviderError('PROVIDER_RATE_LIMITED', '429', 429, '2026-10-02T09:02:00.000Z');
    await ingestion.poll();
    expect(mem.state.runs.at(-1)).toMatchObject({
      outcome: 'FAILED',
      retryAfterUntil: '2026-10-02T09:02:00.000Z',
    });
    paralelo.failure = null;
    paralelo.latest = paraleloSamples('12.02', '2026-10-02T08:53:07.532Z');
    mem.clock.set(at('2026-10-02T09:01:00Z'));
    expect((await ingestion.poll())[0]?.outcome).toBe('SKIPPED_RATE_LIMIT');
    expect(paralelo.calls).toBe(1);
    mem.clock.set(at('2026-10-02T09:02:00Z'));
    expect((await ingestion.poll())[0]?.outcome).toBe('OK');
    expect(paralelo.calls).toBe(2);
  });

  it('tras 5 fallas seguidas los ciclos se espacian (backoff exponencial, máx. 1 h)', async () => {
    const { mem, paralelo, ingestion } = setup(
      parseFxProviderSettings({ FX_PROVIDER_FALLBACK: 'none', FX_PROVIDER_OFFICIAL: 'none' }),
    );
    paralelo.failure = new ProviderError('PROVIDER_UNAVAILABLE', '503', 503);
    for (let i = 0; i < 5; i++) {
      mem.clock.set(Instant.ofEpochMillis(Date.parse('2026-10-02T09:00:00Z') + i * 900_000));
      await ingestion.poll();
    }
    expect(paralelo.calls).toBe(5);
    mem.clock.set(at('2026-10-02T10:15:00Z'));
    expect((await ingestion.poll())[0]?.outcome).toBe('SKIPPED_RATE_LIMIT');
    mem.clock.set(at('2026-10-02T10:30:00Z'));
    await ingestion.poll();
    expect(paralelo.calls).toBe(6);
  });

  it('[TC-FX-PROVIDER-014] con providers en none no se consulta a ningún provider y el core sigue con tasas manuales', async () => {
    const none = parseFxProviderSettings({
      FX_PROVIDER_PRIMARY: 'none',
      FX_PROVIDER_FALLBACK: 'none',
      FX_PROVIDER_OFFICIAL: 'none',
    });
    const { mem, paralelo, dolarapi, ingestion, service, queries } = setup(none);
    expect(await ingestion.poll()).toEqual([]);
    expect(await ingestion.fillGaps()).toBeNull();
    await ingestion.seedPreferences(WS);
    expect([paralelo.calls, dolarapi.calls, paralelo.historyCalls, mem.state.runs.length]).toEqual([
      0, 0, 0, 0,
    ]);
    await service.recordManualRate({
      workspaceId: WS,
      userId: EDITOR,
      base: 'USDT',
      quote: 'BOB',
      value: '11.98',
      rateType: 'P2P',
      asOf: '2026-10-02T08:30:00Z',
    });
    const valued = await queries.convertForValuation({
      workspaceId: WS,
      amount: { amount: '50.000000', currency: 'USDT' },
      to: 'BOB',
    });
    expect([valued.amount.toString(), valued.resolved?.selection]).toEqual(['599.00 BOB', 'MANUAL']);
  });
});

describe('ReviewRateAnomaly (fx/market-rate-providers)', () => {
  async function withAnomaly() {
    const ctx = setup(
      parseFxProviderSettings({ FX_PROVIDER_FALLBACK: 'none', FX_PROVIDER_OFFICIAL: 'none' }),
    );
    ctx.paralelo.latest = paraleloSamples('12.02', '2026-10-02T08:53:07.532Z');
    await ctx.ingestion.poll();
    ctx.mem.clock.set(at('2026-10-02T09:15:00Z'));
    ctx.paralelo.latest = paraleloSamples('13.50', '2026-10-02T09:08:00.000Z');
    await ctx.ingestion.poll();
    const jump = providerRates(ctx.mem).find((r) => r.valueText === '13.5' && r.rate.base.code === 'USD');
    const base = providerRates(ctx.mem).find((r) => r.valueText === '12.02' && r.rate.base.code === 'USD');
    return { ...ctx, jumpId: jump?.id as string, baseId: base?.id as string };
  }

  it('[TC-FX-PROVIDER-010] 12.02 → 13.50 se registra marcada (+12.3128 %) y la valoración sigue usando 12.02', async () => {
    const { mem, queries, jumpId, baseId } = await withAnomaly();
    const stored = await queries.getRate(WS, jumpId);
    expect(stored.rate.snapshot.anomaly).toEqual({ baselineRateId: baseId, variationPct: '12.3128' });
    expect(mem.state.outbox.at(-1)?.payload).toMatchObject({ anomalyFlagged: true, value: '13.5' });
    mem.clock.set(at('2026-10-02T09:20:00Z'));
    const valued = await queries.convertForValuation({
      workspaceId: WS,
      amount: { amount: '100.00', currency: 'USD' },
      to: 'BOB',
      rateType: 'PARALLEL',
    });
    expect([valued.amount.toString(), valued.resolved?.fxRateId]).toEqual(['1202.00 BOB', baseId]);
  });

  it('[TC-FX-PROVIDER-010] un EDITOR confirma con motivo (auditado): 100.00 USD = 1350.00 BOB; segunda revisión ⇒ 409', async () => {
    const { mem, service, queries, jumpId } = await withAnomaly();
    mem.clock.set(at('2026-10-02T09:25:00Z'));
    const reviewed = await service.reviewAnomaly({
      workspaceId: WS,
      userId: EDITOR,
      rateId: jumpId,
      decision: 'CONFIRM',
      reason: 'devaluación anunciada',
    });
    expect(reviewed.anomalyReview).toMatchObject({
      decision: 'CONFIRMED',
      decidedBy: EDITOR,
      reason: 'devaluación anunciada',
    });
    expect(mem.state.audit.at(-1)).toMatchObject({
      action: 'fx.exchange_rate.anomaly_reviewed',
      aggregateId: jumpId,
      reason: 'devaluación anunciada',
      changes: [{ field: 'anomalyStatus', before: 'PENDING', after: 'CONFIRMED' }],
    });
    const valued = await queries.convertForValuation({
      workspaceId: WS,
      amount: { amount: '100.00', currency: 'USD' },
      to: 'BOB',
      rateType: 'PARALLEL',
    });
    expect(valued.amount.toString()).toBe('1350.00 BOB');
    expect(
      await codeOf(
        service.reviewAnomaly({
          workspaceId: WS,
          userId: EDITOR,
          rateId: jumpId,
          decision: 'REJECT',
          reason: 'otra vez',
        }),
      ),
    ).toBe('FX_RATE_ANOMALY_ALREADY_REVIEWED');
  });

  it('[TC-FX-PROVIDER-010] una anomalía rechazada nunca se usa ni pasa a ser línea base; una tasa no marcada ⇒ FX_RATE_NOT_ANOMALOUS', async () => {
    const { mem, service, queries, ingestion, paralelo, jumpId, baseId } = await withAnomaly();
    await service.reviewAnomaly({
      workspaceId: WS,
      userId: EDITOR,
      rateId: jumpId,
      decision: 'REJECT',
      reason: 'error del P2P',
    });
    expect(
      await codeOf(
        service.reviewAnomaly({
          workspaceId: WS,
          userId: EDITOR,
          rateId: baseId,
          decision: 'CONFIRM',
          reason: 'ok ok',
        }),
      ),
    ).toBe('FX_RATE_NOT_ANOMALOUS');
    expect(
      await codeOf(
        service.reviewAnomaly({
          workspaceId: WS,
          userId: EDITOR,
          rateId: jumpId,
          decision: 'CONFIRM',
          reason: ' ',
        }),
      ),
    ).toBe('VALIDATION_FAILED');
    // 12.10 vs la línea base 12.02 (no 13.50): +0.6656 %, se usa sin confirmación.
    mem.clock.set(at('2026-10-02T09:30:00Z'));
    paralelo.latest = paraleloSamples('12.10', '2026-10-02T09:25:00.000Z');
    await ingestion.poll();
    const normal = providerRates(mem).find((r) => r.valueText === '12.1' && r.rate.base.code === 'USD');
    expect(normal?.snapshot.anomaly).toBeNull();
    const valued = await queries.convertForValuation({
      workspaceId: WS,
      amount: { amount: '100.00', currency: 'USD' },
      to: 'BOB',
      rateType: 'PARALLEL',
    });
    expect(valued.amount.toString()).toBe('1210.00 BOB');
  });
});

describe('Tasas manuales frente a providers (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-009] la tasa manual indicada es la referencia de la conversión y el provider no toca tasas manuales', async () => {
    const { mem, paralelo, ingestion, service, queries } = setup(
      parseFxProviderSettings({ FX_PROVIDER_FALLBACK: 'none', FX_PROVIDER_OFFICIAL: 'none' }),
    );
    mem.clock.set(at('2026-10-02T08:55:00Z'));
    const manualUsd = await service.recordManualRate({
      workspaceId: WS,
      userId: EDITOR,
      base: 'USD',
      quote: 'BOB',
      value: '12.10',
      rateType: 'PARALLEL',
      asOf: '2026-10-02T07:00:00Z',
    });
    mem.clock.set(at('2026-10-02T09:00:00Z'));
    paralelo.latest = paraleloSamples('12.02', '2026-10-02T08:53:07.532Z');
    await ingestion.poll();
    mem.clock.set(at('2026-10-02T09:10:00Z'));
    const p2p = await service.recordManualRate({
      workspaceId: WS,
      userId: EDITOR,
      base: 'USDT',
      quote: 'BOB',
      value: '11.98',
      rateType: 'P2P',
      asOf: '2026-10-02T09:10:00Z',
    });
    const reference = await queries.referenceForConversion({
      workspaceId: WS,
      base: 'USDT',
      quote: 'BOB',
      executedAt: '2026-10-02T09:12:00Z',
      fxRateId: p2p.rate.id,
    });
    expect(reference).toMatchObject({
      fxRateId: p2p.rate.id,
      rate: { base: 'USDT', quote: 'BOB', value: '11.98' },
      rateType: 'P2P',
      source: 'MANUAL',
    });
    const manual = await queries.getRate(WS, manualUsd.rate.id);
    expect([manual.rate.valueText, manual.supersededById, manual.rate.snapshot.source]).toEqual([
      '12.1',
      null,
      'MANUAL',
    ]);
    expect(providerRates(mem).every((r) => r.snapshot.supersedesId === null)).toBe(true);
  });
});

describe('BackfillHistoricalRates y FillRateGaps (fx/market-rate-providers)', () => {
  /** 788 puntos diarios 2024-08-06..2026-10-02 (el último, del día en curso, ya excluido por el adapter). */
  const historyDays = (() => {
    const days: string[] = [];
    for (
      let t = Date.parse('2024-08-06T00:00:00Z');
      t < Date.parse('2026-10-02T00:00:00Z');
      t += 86_400_000
    ) {
      days.push(new Date(t).toISOString().slice(0, 10));
    }
    return days;
  })();
  const closeOf = (day: string) =>
    new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000 - 1000 + 4 * 3_600_000).toISOString();
  const historySamples = (days: readonly string[]) => (fetchedAt: string) =>
    days.flatMap((d) =>
      ['USD', 'USDT'].map((base) =>
        sample(
          'PARALELO_BO',
          base,
          'PARALLEL',
          d === '2026-09-10' ? '11.96' : '12.01',
          closeOf(d),
          fetchedAt,
          `{"point":"${d}"}`,
        ),
      ),
    );

  it('[TC-FX-PROVIDER-006] 787 días completos por par, idempotente, un solo evento y preferencias PARALLEL sembradas', async () => {
    const { mem, paralelo, ingestion, queries, status } = setup();
    mem.clock.set(at('2026-10-02T12:00:00Z'));
    expect(historyDays).toHaveLength(787);
    paralelo.history = historySamples(historyDays);
    await ingestion.seedPreferences(WS);
    const first = await ingestion.backfill({ workspaceId: WS, timeZone: 'America/La_Paz' });
    expect([first?.outcome, first?.newSamples]).toEqual(['OK', 1574]);
    const usd = providerRates(mem).filter((r) => r.rate.base.code === 'USD');
    expect(usd).toHaveLength(787);
    const sep10 = usd.find((r) => r.snapshot.effectiveDate === '2026-09-10');
    expect([sep10?.valueText, sep10?.snapshot.asOf, sep10?.snapshot.anomaly]).toEqual([
      '11.96',
      '2026-09-11T03:59:59.000Z',
      null,
    ]);
    expect(mem.state.outbox).toHaveLength(1);
    expect((await queries.listPreferences(WS)).preferences).toEqual([
      { base: 'USD', quote: 'BOB', rateType: 'PARALLEL' },
      { base: 'USDT', quote: 'BOB', rateType: 'PARALLEL' },
    ]);
    const again = await ingestion.backfill({ workspaceId: WS, timeZone: 'America/La_Paz' });
    expect([again?.outcome, again?.newSamples]).toEqual(['NO_NEW_SAMPLE', 0]);
    expect(mem.state.outbox).toHaveLength(1);
    const paraleloStatus = (await status.status(WS)).find((p) => p.provider === 'PARALELO_BO');
    expect(paraleloStatus?.backfill).toMatchObject({
      status: 'COMPLETED',
      pointsImported: 787,
      from: '2024-08-06',
      to: '2026-10-01',
    });
  }, 30_000);

  it('[TC-FX-PROVIDER-006] el relleno diario registra solo los 3 días faltantes por par y no toca los demás', async () => {
    const { mem, paralelo, ingestion } = setup();
    mem.clock.set(at('2026-10-02T06:00:00Z'));
    const gap = ['2026-09-20', '2026-09-21', '2026-09-22'];
    paralelo.history = historySamples(historyDays.filter((d) => !gap.includes(d)));
    await ingestion.backfill({ workspaceId: WS, timeZone: 'America/La_Paz' });
    const before = providerRates(mem).map((r) => r.id);
    paralelo.history = historySamples(historyDays);
    const filled = await ingestion.fillGaps();
    expect([filled?.outcome, filled?.newSamples]).toEqual(['OK', 6]);
    const added = providerRates(mem).filter((r) => !before.includes(r.id));
    expect(added.map((r) => `${r.rate.base.code} ${r.snapshot.effectiveDate}`).sort()).toEqual([
      'USD 2026-09-20',
      'USD 2026-09-21',
      'USD 2026-09-22',
      'USDT 2026-09-20',
      'USDT 2026-09-21',
      'USDT 2026-09-22',
    ]);
    expect(mem.state.runs.at(-1)?.kind).toBe('GAP_FILL');
  });
});

describe('GetProviderStatus (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-015] principal con 3 fallas recientes: DEGRADED, último éxito 09:00Z, última tasa de 3142 s no obsoleta', async () => {
    const { mem, paralelo, dolarapi, ingestion, status } = setup();
    paralelo.latest = paraleloSamples('12.02', '2026-10-02T08:53:07.532Z');
    dolarapi.latest = (f) => [
      sample('DOLARAPI_BO', 'USD', 'OFFICIAL', '12', '2026-10-01T00:00:00.000Z', f),
      sample('DOLARAPI_BO', 'USD', 'PARALLEL', '12.055', mem.clock.now().toString(), f),
      sample('DOLARAPI_BO', 'USDT', 'PARALLEL', '12.055', mem.clock.now().toString(), f),
    ];
    await ingestion.poll();
    for (const t of ['09:15', '09:30', '09:45']) {
      mem.clock.set(at(`2026-10-02T${t}:00Z`));
      paralelo.failure = new ProviderError('PROVIDER_UNAVAILABLE', 'unexpected HTTP 503', 503);
      await ingestion.poll();
    }
    mem.clock.set(at('2026-10-02T09:45:30Z'));
    const [p, d] = await status.status(WS);
    expect(p).toMatchObject({
      provider: 'PARALELO_BO',
      enabled: true,
      health: 'DEGRADED',
      consecutiveFailures: 3,
      lastSuccessAt: '2026-10-02T09:00:00.000Z',
      lastAttemptAt: '2026-10-02T09:45:00.000Z',
      lastError: { code: 'PROVIDER_UNAVAILABLE', httpStatus: 503, at: '2026-10-02T09:45:00.000Z' },
      nextAttemptAt: '2026-10-02T10:00:00.000Z',
      pollIntervalSeconds: 900,
      rateLimit: { limitPerMinute: 60, retryAfterUntil: null },
    });
    expect(
      p?.feeds.map((f) => [f.base, f.rateType, f.role, f.lastRate?.rate.valueText, f.ageSeconds, f.stale]),
    ).toEqual([
      ['USD', 'PARALLEL', 'PRIMARY', '12.02', 3142, false],
      ['USDT', 'PARALLEL', 'PRIMARY', '12.02', 3142, false],
    ]);
    expect(p?.attribution.text).toBe('Fuente: paralelo.bo');
    expect(d?.health).toBe('HEALTHY');
    expect(d?.feeds.map((f) => [f.base, f.rateType, f.role])).toEqual([
      ['USD', 'PARALLEL', 'FALLBACK'],
      ['USDT', 'PARALLEL', 'FALLBACK'],
      ['USD', 'OFFICIAL', 'PRIMARY'],
    ]);
  });

  it('[TC-FX-PROVIDER-015] con providers deshabilitados ambos figuran DISABLED sin intentos programados; config inválida informa FX_PROVIDER_CONFIG_INVALID', async () => {
    const none = setup(
      parseFxProviderSettings({
        FX_PROVIDER_PRIMARY: 'none',
        FX_PROVIDER_FALLBACK: 'none',
        FX_PROVIDER_OFFICIAL: 'none',
      }),
    );
    for (const s of await none.status.status(WS)) {
      expect([s.health, s.enabled, s.nextAttemptAt, s.pollIntervalSeconds, s.feeds]).toEqual([
        'DISABLED',
        false,
        null,
        null,
        [],
      ]);
    }
    const invalid = setup(parseFxProviderSettings({ FX_POLL_INTERVAL: '30s' }));
    const [s] = await invalid.status.status(WS);
    expect([s?.health, s?.lastError?.code]).toEqual(['DISABLED', 'FX_PROVIDER_CONFIG_INVALID']);
  });
});
