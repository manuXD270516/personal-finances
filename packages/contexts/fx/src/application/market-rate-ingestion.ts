import { Instant, LocalDate, type Clock } from '@pf/shared-kernel';
import { FX_EVENTS } from '../contracts/index.js';
import {
  AnomalyDetector,
  ExchangeRate,
  marketOf,
  ProviderError,
  type FxRateProvider,
  type MarketRateProvider,
  type ProviderSample,
} from '../domain/index.js';
import type {
  ActiveWorkspacesPort,
  CurrencyRepository,
  ExchangeRateRepository,
  IdGenerator,
  OutboxPort,
  ProviderRun,
  ProviderRunKind,
  ProviderRunOutcome,
  ProviderRunRepository,
  RatePreference,
  RatePreferenceRepository,
  UnitOfWork,
} from './ports/index.js';
import { enabledProviders, type FxProviderSettings } from './provider-settings.js';

const HOUR_MS = 3_600_000;
const RUN_RETENTION_MS = 90 * 24 * HOUR_MS;
/** Fallas consecutivas a partir de las cuales los ciclos se espacian (backoff exponencial, máx. 1 h). */
const BACKOFF_AFTER_FAILURES = 5;

/** Preferencias sembradas al crear un workspace (design.md decisión 6): USD/BOB y USDT/BOB = PARALLEL. */
export const DEFAULT_PROVIDER_PREFERENCES: readonly RatePreference[] = [
  { base: 'USD', quote: 'BOB', rateType: 'PARALLEL' },
  { base: 'USDT', quote: 'BOB', rateType: 'PARALLEL' },
];

export interface FxIngestionDeps {
  readonly uow: UnitOfWork;
  readonly rates: ExchangeRateRepository;
  readonly currencies: CurrencyRepository;
  readonly preferences: RatePreferenceRepository;
  readonly runs: ProviderRunRepository;
  readonly workspaces: ActiveWorkspacesPort;
  readonly outbox: OutboxPort;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly settings: FxProviderSettings;
  /** Adapters por provider (solo los habilitados se consultan). */
  readonly providers: Partial<Record<FxRateProvider, MarketRateProvider>>;
}

export interface ProviderCycleResult {
  readonly provider: FxRateProvider;
  readonly outcome: ProviderRunOutcome;
  readonly newSamples: number;
  readonly errorCode: string | null;
}

interface Target {
  readonly workspaceId: string;
  readonly timeZone: string;
}

interface RecordOptions {
  /** La carga histórica no detecta anomalías (design.md decisión 8). */
  readonly detectAnomalies: boolean;
  /** Un evento por tasa (polling) o uno por workspace y ejecución (carga histórica; design.md decisión 13). */
  readonly eventPerRate: boolean;
  readonly correlationId: string;
  /** Solo relleno: omite muestras de días que ya tienen alguna tasa del feed. */
  readonly skipDaysWithRates: boolean;
}

/**
 * Ingesta de tasas de mercado (fx/market-rate-providers; design.md decisiones 3, 4, 8, 12 y 13): `PollMarketRates`,
 * `BackfillHistoricalRates`, `FillRateGaps` y la siembra de preferencias al crear un workspace. La corre SOLO el
 * worker (ninguna request de usuario llama a un provider). Cada provider se consulta UNA vez por ciclo con un cliente
 * que no recibe contexto de workspace; luego las muestras se copian a cada workspace activo en una transacción propia
 * (`SET LOCAL app.workspace_id`), idempotente por (provider, par, tipo, vigencia). Escrituras del sistema (actor
 * `SYSTEM`): se trazan con `fx.RateRecorded.v1` y `fx.provider_run`, no con auditoría de usuario.
 */
export class MarketRateIngestion {
  constructor(private readonly deps: FxIngestionDeps) {}

  /** `PollMarketRates`: un ciclo de consulta de todos los providers habilitados. */
  async poll(): Promise<ProviderCycleResult[]> {
    const correlationId = this.deps.ids.next();
    const results: ProviderCycleResult[] = [];
    for (const provider of enabledProviders(this.deps.settings)) {
      results.push(await this.pollProvider(provider, correlationId));
    }
    await this.deps.runs.purgeBefore(
      new Date(this.deps.clock.now().epochMillis - RUN_RETENTION_MS).toISOString(),
    );
    return results;
  }

  /** `BackfillHistoricalRates` de un workspace recién creado (consumidor de `identity.WorkspaceCreated.v1`). */
  async backfill(target: Target): Promise<ProviderCycleResult | null> {
    return this.history('BACKFILL', [target]);
  }

  /** `FillRateGaps` diario: relee el histórico y rellena los días sin tasa del provider en todos los workspaces. */
  async fillGaps(): Promise<ProviderCycleResult | null> {
    const targets = await this.deps.workspaces.list();
    // Workspaces creados antes de los providers (sin `WorkspaceCreated` que consumir): misma siembra condicional.
    for (const t of targets) await this.seedPreferences(t.workspaceId);
    return this.history('GAP_FILL', targets);
  }

  /**
   * Siembra USD/BOB y USDT/BOB = PARALLEL si el workspace nunca fijó sus preferencias (idempotente). Corre dentro de
   * la transacción del consumidor de `WorkspaceCreated` (la unidad de trabajo la reutiliza).
   */
  async seedPreferences(workspaceId: string): Promise<void> {
    if (enabledProviders(this.deps.settings).length === 0) return;
    await this.deps.uow.run(workspaceId, () =>
      this.deps.preferences.seedDefaults(workspaceId, DEFAULT_PROVIDER_PREFERENCES),
    );
  }

  // ------------------------------------------------------------------ polling

  private async pollProvider(provider: FxRateProvider, correlationId: string): Promise<ProviderCycleResult> {
    const startedAt = this.deps.clock.now();
    const adapter = this.deps.providers[provider];
    if (!adapter)
      return this.finish(provider, 'POLL', startedAt, 'FAILED', 0, configError('adapter missing'));
    const recent = await this.deps.runs.recent(provider, 50, ['POLL']);
    const blocked = recent.find(
      (r) => r.retryAfterUntil !== null && Date.parse(r.retryAfterUntil) > startedAt.epochMillis,
    );
    if (blocked) {
      return this.finish(provider, 'POLL', startedAt, 'SKIPPED_RATE_LIMIT', 0, null, {
        retryAfterUntil: blocked.retryAfterUntil,
      });
    }
    if (this.inBackoff(recent, startedAt)) {
      return this.finish(provider, 'POLL', startedAt, 'SKIPPED_RATE_LIMIT', 0, null);
    }
    let samples: ProviderSample[];
    try {
      samples = (await adapter.fetchLatest()).filter((s) => this.servesRole(provider, s));
    } catch (err) {
      return this.failure(provider, 'POLL', startedAt, err);
    }
    let inserted = 0;
    for (const target of await this.deps.workspaces.list()) {
      inserted += await this.recordIn(target, samples, {
        detectAnomalies: true,
        eventPerRate: true,
        correlationId,
        skipDaysWithRates: false,
      });
    }
    const fromCache =
      samples.length > 0 && samples.every((s) => Date.parse(s.fetchedAt) < startedAt.epochMillis);
    const outcome: ProviderRunOutcome = inserted > 0 ? 'OK' : fromCache ? 'SKIPPED_CACHE' : 'NO_NEW_SAMPLE';
    return this.finish(provider, 'POLL', startedAt, outcome, inserted, null);
  }

  /**
   * Muestras de los feeds para los que el provider tiene rol (PARALLEL y su compra/venta: principal/respaldo;
   * OFFICIAL: oficial).
   */
  private servesRole(provider: FxRateProvider, sample: ProviderSample): boolean {
    const s = this.deps.settings;
    if (marketOf(sample.rateType) === 'PARALLEL') return provider === s.primary || provider === s.fallback;
    if (sample.rateType === 'OFFICIAL') return provider === s.official;
    return false;
  }

  /** Tras 5 fallas seguidas, el siguiente intento espera intervalo × 2^(n−4), como máximo 1 h. */
  private inBackoff(recent: readonly ProviderRun[], now: Instant): boolean {
    const attempts = recent.filter((r) => r.outcome !== 'SKIPPED_RATE_LIMIT');
    let failures = 0;
    for (const r of attempts) {
      if (r.outcome !== 'FAILED') break;
      failures++;
    }
    if (failures < BACKOFF_AFTER_FAILURES || !attempts[0]) return false;
    const wait = Math.min(
      this.deps.settings.pollIntervalMs * 2 ** (failures - BACKOFF_AFTER_FAILURES + 1),
      HOUR_MS,
    );
    return Date.parse(attempts[0].startedAt) + wait > now.epochMillis;
  }

  // ------------------------------------------------------------------ histórico

  private async history(
    kind: ProviderRunKind,
    targets: readonly Target[],
  ): Promise<ProviderCycleResult | null> {
    const s = this.deps.settings;
    if (!s.backfillEnabled) return null;
    const provider = [s.primary, s.fallback].find(
      (p): p is FxRateProvider => p !== null && this.deps.providers[p]?.descriptor().history === true,
    );
    if (!provider) return null;
    const startedAt = this.deps.clock.now();
    let samples: ProviderSample[];
    try {
      samples = await (this.deps.providers[provider] as MarketRateProvider).fetchHistory();
    } catch (err) {
      return this.failure(provider, kind, startedAt, err);
    }
    const correlationId = this.deps.ids.next();
    let inserted = 0;
    for (const target of targets) {
      inserted += await this.recordIn(target, samples, {
        detectAnomalies: false,
        eventPerRate: false,
        correlationId,
        skipDaysWithRates: true,
      });
    }
    const days = [
      ...new Set(samples.map((x) => LocalDate.ofInstant(Instant.parse(x.asOf), 'America/La_Paz').toString())),
    ].sort();
    return this.finish(provider, kind, startedAt, inserted > 0 ? 'OK' : 'NO_NEW_SAMPLE', inserted, null, {
      historyPoints: days.length,
      historyFrom: days[0] ?? null,
      historyTo: days.at(-1) ?? null,
    });
  }

  // ------------------------------------------------------------------ registro por workspace

  private recordIn(
    target: Target,
    samples: readonly ProviderSample[],
    options: RecordOptions,
  ): Promise<number> {
    if (samples.length === 0) return Promise.resolve(0);
    const { workspaceId, timeZone } = target;
    return this.deps.uow.run(workspaceId, async () => {
      const detector = new AnomalyDetector(this.deps.settings.anomalyThresholdPct);
      const now = this.deps.clock.now().toString();
      const daysWithRates = new Map<string, Set<string>>();
      let inserted = 0;
      let last: ExchangeRate | null = null;
      const catalog = new Map<string, Awaited<ReturnType<CurrencyRepository['find']>>>();
      const currency = async (code: string) => {
        if (!catalog.has(code)) catalog.set(code, await this.deps.currencies.find(code));
        return catalog.get(code) ?? null;
      };
      for (const sample of samples) {
        const base = await currency(sample.base);
        const quote = await currency(sample.quote);
        if (!base || !quote) continue;
        const feed = {
          provider: sample.provider,
          base: sample.base,
          quote: sample.quote,
          rateType: sample.rateType,
        };
        const effectiveDate = LocalDate.ofInstant(Instant.parse(sample.asOf), timeZone).toString();
        if (options.skipDaysWithRates) {
          const key = `${feed.base}/${feed.quote}/${feed.rateType}`;
          let days = daysWithRates.get(key);
          if (!days) {
            days = await this.deps.rates.providerDays(workspaceId, feed, '0001-01-01', '9999-12-31');
            daysWithRates.set(key, days);
          }
          if (days.has(effectiveDate)) continue;
        }
        let anomaly = null;
        if (options.detectAnomalies) {
          const baseline = await this.deps.rates.latestAccepted(workspaceId, feed);
          if (baseline && Date.parse(baseline.rate.snapshot.asOf) < Date.parse(sample.asOf)) {
            anomaly =
              detector.assess(sample.value, { rateId: baseline.rate.id, value: baseline.rate.valueText })
                ?.mark ?? null;
          }
        }
        const rate = ExchangeRate.fromProviderSample(sample, {
          id: this.deps.ids.next(),
          workspaceId,
          base: base.toCurrency(),
          quote: quote.toCurrency(),
          effectiveDate,
          createdAt: now,
          anomaly,
        });
        if (!(await this.deps.rates.insertProviderRate(rate))) continue;
        inserted++;
        if (options.eventPerRate) await this.publish(rate, options.correlationId);
        else last = rate;
      }
      if (last) await this.publish(last, options.correlationId);
      return inserted;
    });
  }

  /** `fx.RateRecorded.v1` (aditivo: `provider`, `anomalyFlagged`) con actor `SYSTEM fx-provider:<id>`. */
  private publish(rate: ExchangeRate, correlationId: string): Promise<void> {
    const s = rate.snapshot;
    return this.deps.outbox.append({
      eventId: this.deps.ids.next(),
      eventType: FX_EVENTS.rateRecorded.eventType,
      eventVersion: FX_EVENTS.rateRecorded.eventVersion,
      occurredAt: this.deps.clock.now().toString(),
      workspaceId: s.workspaceId as string,
      aggregateType: 'ExchangeRate',
      aggregateId: s.id,
      aggregateVersion: 1,
      actor: { type: 'SYSTEM', id: `fx-provider:${String(s.provider)}` },
      correlationId,
      payload: {
        rateId: s.id,
        base: s.rate.base.code,
        quote: s.rate.quote.code,
        value: rate.valueText,
        rateType: s.rateType,
        source: s.source,
        sourceLabel: s.sourceLabel,
        asOf: s.asOf,
        effectiveDate: s.effectiveDate,
        supersedesRateId: null,
        provider: s.provider,
        anomalyFlagged: s.anomaly !== null,
      },
    });
  }

  // ------------------------------------------------------------------ bitácora

  private async failure(
    provider: FxRateProvider,
    kind: ProviderRunKind,
    startedAt: Instant,
    err: unknown,
  ): Promise<ProviderCycleResult> {
    if (!(err instanceof ProviderError)) throw err;
    return this.finish(provider, kind, startedAt, 'FAILED', 0, err, {
      retryAfterUntil: err.retryAfterUntil,
    });
  }

  private async finish(
    provider: FxRateProvider,
    kind: ProviderRunKind,
    startedAt: Instant,
    outcome: ProviderRunOutcome,
    newSamples: number,
    error: ProviderError | null,
    extra: Partial<Pick<ProviderRun, 'retryAfterUntil' | 'historyPoints' | 'historyFrom' | 'historyTo'>> = {},
  ): Promise<ProviderCycleResult> {
    const finishedAt = this.deps.clock.now();
    await this.deps.runs.record({
      id: this.deps.ids.next(),
      provider,
      kind,
      startedAt: startedAt.toString(),
      finishedAt: finishedAt.toString(),
      outcome,
      errorCode: error?.code ?? null,
      httpStatus: error?.httpStatus ?? null,
      latencyMs: Math.max(0, finishedAt.epochMillis - startedAt.epochMillis),
      newSamples,
      retryAfterUntil: extra.retryAfterUntil ?? null,
      historyPoints: extra.historyPoints ?? null,
      historyFrom: extra.historyFrom ?? null,
      historyTo: extra.historyTo ?? null,
    });
    return { provider, outcome, newSamples, errorCode: error?.code ?? null };
  }
}

const configError = (message: string) => new ProviderError('FX_PROVIDER_CONFIG_INVALID', message);
