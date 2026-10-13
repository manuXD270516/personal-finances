import { Instant, LocalDate, type Clock } from '@pf/shared-kernel';
import {
  marketOf,
  ProviderError,
  type FxRateProvider,
  type MarketRateProvider,
  type PollableProvider,
  type ProviderSample,
} from '../domain/index.js';
import { CryptoHistorySync } from './crypto-history.js';
import { CheckFeedFreshness, EMPTY_FEED_CHECK, type FeedCheckSummary } from './feed-freshness-check.js';
import type {
  ActiveWorkspacesPort,
  CurrencyRepository,
  ExchangeRateRepository,
  FirstBalanceDatePort,
  IdGenerator,
  NotificationIntakePort,
  OutboxPort,
  ProviderHistoryCache,
  ProviderRun,
  ProviderRunKind,
  ProviderRunOutcome,
  ProviderRunRepository,
  RateFeedEpisodeRepository,
  RatePairListRepository,
  RatePreference,
  RatePreferenceRepository,
  UnitOfWork,
} from './ports/index.js';
import { ProviderRunLog, type ProviderCycleResult } from './provider-run-log.js';
import {
  anomalyThresholdsOf,
  assetClassPolicyOf,
  enabledProviders,
  type FxProviderSettings,
} from './provider-settings.js';
import { RatePairResolver } from './rate-pairs.js';
import { SampleRecorder, type RecordTarget } from './sample-recorder.js';

export type { ProviderCycleResult } from './provider-run-log.js';

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
  /** Adapters por provider (solo los habilitados se consultan). Los cripto implementan `CryptoRateProvider`. */
  readonly providers: Partial<Record<FxRateProvider, PollableProvider>>;
  /** Lista de pares automáticos de cada workspace: solo esos pares se registran (add-crypto-rate-providers). */
  readonly pairs: RatePairListRepository;
  /** Caché de cierres diarios cripto de la instalación y primera fecha con saldo (histórico cripto, D229). */
  readonly historyCache?: ProviderHistoryCache;
  readonly firstBalance?: FirstBalanceDatePort;
  /**
   * Episodios de obsolescencia por par (add-rate-feed-alerts, D233): con ellos cada ciclo de `PollMarketRates` termina
   * con la verificación de frescura. Sin ellos (tests de ingesta sin alertas) no se verifica.
   */
  readonly episodes?: RateFeedEpisodeRepository;
  /** Puerto síncrono de NOTIFY (D249) para las alertas de tasas; sin él se escriben episodios y eventos igual. */
  readonly notifications?: NotificationIntakePort;
}

type Target = RecordTarget;

/**
 * Ingesta de tasas de mercado (fx/market-rate-providers; design.md decisiones 3, 4, 8, 12 y 13): `PollMarketRates`,
 * `BackfillHistoricalRates`, `FillRateGaps` y la siembra de preferencias al crear un workspace. La corre SOLO el
 * worker (ninguna request de usuario llama a un provider). Cada provider se consulta UNA vez por ciclo con un cliente
 * que no recibe contexto de workspace; luego las muestras se copian a cada workspace activo en una transacción propia
 * (`SET LOCAL app.workspace_id`), idempotente por (provider, par, tipo, vigencia). Escrituras del sistema (actor
 * `SYSTEM`): se trazan con `fx.RateRecorded.v1` y `fx.provider_run`, no con auditoría de usuario.
 */
export class MarketRateIngestion {
  private readonly recorder: SampleRecorder;
  private readonly runLog: ProviderRunLog;
  private readonly cryptoHistory: CryptoHistorySync | null;
  private readonly feedCheck: CheckFeedFreshness | null;
  private lastFeedCheckSummary: FeedCheckSummary = EMPTY_FEED_CHECK;
  private workspaceFailures: string[] = [];

  constructor(private readonly deps: FxIngestionDeps) {
    const pairs = new RatePairResolver({
      pairs: deps.pairs,
      currencies: deps.currencies,
      assetClasses: assetClassPolicyOf(deps.settings),
      valuationOnly: true,
      // La moneda base siempre llega con el destino (`RecordTarget`): este puerto nunca se consulta.
      workspaces: {
        settingsOf: () => Promise.reject(new Error('workspace settings are not available to the worker')),
      },
    });
    this.runLog = new ProviderRunLog(deps.runs, deps.ids, deps.clock);
    this.recorder = new SampleRecorder({
      uow: deps.uow,
      rates: deps.rates,
      currencies: deps.currencies,
      outbox: deps.outbox,
      ids: deps.ids,
      clock: deps.clock,
      thresholds: anomalyThresholdsOf(deps.settings),
      pairs,
      notifications: deps.notifications,
    });
    this.feedCheck = deps.episodes
      ? new CheckFeedFreshness({
          uow: deps.uow,
          rates: deps.rates,
          pairs,
          episodes: deps.episodes,
          workspaces: deps.workspaces,
          outbox: deps.outbox,
          ids: deps.ids,
          clock: deps.clock,
          settings: deps.settings,
          notifications: deps.notifications,
        })
      : null;
    this.cryptoHistory =
      deps.historyCache && deps.firstBalance
        ? new CryptoHistorySync({
            uow: deps.uow,
            rates: deps.rates,
            runs: deps.runs,
            runLog: this.runLog,
            cache: deps.historyCache,
            firstBalance: deps.firstBalance,
            recorder: this.recorder,
            pairs,
            workspaces: deps.workspaces,
            ids: deps.ids,
            clock: deps.clock,
            settings: deps.settings,
            providers: deps.providers,
          })
        : null;
  }

  /** Resumen de la verificación de frescura del último ciclo de `poll()` (para la bitácora del job). */
  get lastFeedCheck(): FeedCheckSummary {
    return this.lastFeedCheckSummary;
  }

  /** Nombre del error de cada workspace cuya copia de muestras falló en el último ciclo (se reintenta en el siguiente). */
  get lastWorkspaceFailures(): readonly string[] {
    return this.workspaceFailures;
  }

  /**
   * `PollMarketRates`: un ciclo de consulta de todos los providers habilitados. Termina SIEMPRE con la verificación de
   * frescura de los pares (`CheckFeedFreshness`), también cuando todos los intentos fallaron: es justo el caso de la
   * alerta de obsolescencia.
   */
  async poll(): Promise<ProviderCycleResult[]> {
    const correlationId = this.deps.ids.next();
    const results: ProviderCycleResult[] = [];
    this.workspaceFailures = [];
    for (const provider of enabledProviders(this.deps.settings)) {
      results.push(await this.pollProvider(provider, correlationId));
    }
    this.lastFeedCheckSummary = this.feedCheck ? await this.feedCheck.run(correlationId) : EMPTY_FEED_CHECK;
    await this.deps.runs.purgeBefore(
      new Date(this.deps.clock.now().epochMillis - RUN_RETENTION_MS).toISOString(),
    );
    return results;
  }

  /** `BackfillHistoricalRates` de un workspace recién creado (consumidor de `identity.WorkspaceCreated.v1`). */
  async backfill(target: Target): Promise<ProviderCycleResult | null> {
    return this.history('BACKFILL', [target]);
  }

  /** `BackfillCryptoHistory` de un workspace: cierres diarios cripto desde la primera fecha con saldo hasta ayer. */
  async cryptoBackfill(target: Target): Promise<ProviderCycleResult[]> {
    return this.cryptoHistory ? this.cryptoHistory.backfill(target) : [];
  }

  /** `FillCryptoGaps` diario: actualiza la caché de instalación y completa los días cripto faltantes de cada workspace. */
  async cryptoFillGaps(): Promise<ProviderCycleResult[]> {
    return this.cryptoHistory ? this.cryptoHistory.fillGaps() : [];
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
      try {
        inserted += await this.recorder.recordIn(target, samples, {
          detectAnomalies: true,
          eventPerRate: true,
          correlationId,
          skipDaysWithRates: false,
        });
      } catch (err) {
        // La transacción del workspace (muestras, eventos y avisos a NOTIFY) se revirtió completa: el resto de los
        // workspaces sigue y el ciclo siguiente reintenta (design.md add-rate-feed-alerts, riesgos).
        this.workspaceFailures.push(err instanceof Error ? err.name : typeof err);
      }
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
    if (sample.rateType === 'MARKET') return provider === s.cryptoPrimary || provider === s.cryptoFallback;
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
      inserted += await this.recorder.recordIn(target, samples, {
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

  // ------------------------------------------------------------------ bitácora

  private failure(
    provider: FxRateProvider,
    kind: ProviderRunKind,
    startedAt: Instant,
    err: unknown,
  ): Promise<ProviderCycleResult> {
    return this.runLog.failure(provider, kind, startedAt, err);
  }

  private finish(
    provider: FxRateProvider,
    kind: ProviderRunKind,
    startedAt: Instant,
    outcome: ProviderRunOutcome,
    newSamples: number,
    error: ProviderError | null,
    extra: Partial<Pick<ProviderRun, 'retryAfterUntil' | 'historyPoints' | 'historyFrom' | 'historyTo'>> = {},
  ): Promise<ProviderCycleResult> {
    return this.runLog.finish(provider, kind, startedAt, outcome, newSamples, error, extra);
  }
}

const configError = (message: string) => new ProviderError('FX_PROVIDER_CONFIG_INVALID', message);
