import type { Clock } from '@pf/shared-kernel';
import {
  FX_RATE_PROVIDERS,
  providerDescriptor,
  StalenessPolicy,
  type FxProviderErrorCode,
  type FxRateProvider,
  type FxRateType,
  type RateAttribution,
} from '../domain/index.js';
import type {
  ExchangeRateRepository,
  InstitutionSupportPort,
  ProviderRun,
  ProviderRunRepository,
  StoredRate,
  UnitOfWork,
} from './ports/index.js';
import type { RatePairStatus, RatePairViews } from './rate-pair-views.js';
import { enabledProviders, valuationPolicyOf, type FxProviderSettings } from './provider-settings.js';

export type ProviderHealth = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'DISABLED';
export type BackfillStatus = 'NOT_APPLICABLE' | 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface ProviderFeedStatus {
  readonly base: string;
  readonly quote: string;
  readonly rateType: FxRateType;
  readonly role: 'PRIMARY' | 'FALLBACK';
  readonly lastRate: StoredRate | null;
  readonly stale: boolean;
  readonly ageSeconds: number | null;
}

/** `FxProviderStatus` del contrato (las tasas como `StoredRate`; la capa HTTP las serializa). */
export interface ProviderStatus {
  readonly provider: FxRateProvider;
  readonly enabled: boolean;
  readonly health: ProviderHealth;
  readonly feeds: readonly ProviderFeedStatus[];
  readonly lastAttemptAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastError: {
    readonly code: FxProviderErrorCode;
    readonly httpStatus: number | null;
    readonly at: string;
  } | null;
  readonly consecutiveFailures: number;
  readonly nextAttemptAt: string | null;
  readonly pollIntervalSeconds: number | null;
  readonly rateLimit: { readonly limitPerMinute: number | null; readonly retryAfterUntil: string | null };
  readonly backfill: {
    readonly status: BackfillStatus;
    readonly pointsImported?: number;
    readonly from?: string | null;
    readonly to?: string | null;
    readonly lastRunAt?: string | null;
  };
  readonly attribution: RateAttribution;
}

export interface ProviderStatusDeps {
  readonly uow: UnitOfWork;
  readonly rates: ExchangeRateRepository;
  readonly runs: ProviderRunRepository;
  readonly clock: Clock;
  readonly settings: FxProviderSettings;
  /** Vistas de los pares configurados del workspace (cobertura y antigüedad por par); sin ellas, `pairs` va vacío. */
  readonly pairViews?: RatePairViews;
  /** Estado de soporte en tasas de las instituciones adoptadas (ACCOUNTS vía composition root); sin él no se informa. */
  readonly institutionSupport?: InstitutionSupportPort;
}

/**
 * `FxProviderStatusList.institutions[]` del contrato (add-exchange-house-rate-providers, FR-FX-016): una entrada por
 * institución cubierta por el provider por institución habilitado y por institución ADOPTADA del workspace.
 */
export interface InstitutionRateStatus {
  readonly code: string;
  /** Tipos de tasa recibidos de la institución (`BANK_BUY`/`BANK_SELL`); vacío si no hay tasas automáticas. */
  readonly rateTypes: readonly FxRateType[];
  /** Vigencia de la última tasa aceptada de la institución; `null` si no hay. */
  readonly lastRateAsOf: string | null;
  readonly ageSeconds: number | null;
  /** `true` si la última tasa supera `FX_STALE_AFTER_INSTITUTION` (72 h por defecto). */
  readonly stale: boolean;
  /** Estado de la dimensión de tasas de la entrada del catálogo si la institución está adoptada; `null` si no. */
  readonly supportStatus: string | null;
  readonly reason: string | null;
}

/** Estado de los providers y de los pares configurados del workspace (`FxProviderStatusList`). */
export interface ProviderStatusReport {
  readonly providers: readonly ProviderStatus[];
  readonly pairs: readonly RatePairStatus[];
  readonly institutions: readonly InstitutionRateStatus[];
}

const SUCCESS = new Set(['OK', 'NO_NEW_SAMPLE', 'SKIPPED_CACHE']);

/**
 * `GetProviderStatus` (fx/market-rate-providers, Should; design.md decisión 12): salud, feeds con su última tasa
 * aceptada y antigüedad, intentos, fallas consecutivas, próximo intento, límite de uso, carga histórica y atribución.
 * Solo lectura: `fx.provider_run` (instalación) + `fx.exchange_rate` del workspace. Nunca llama a un provider.
 */
export class ProviderStatusQueries {
  private readonly staleness: StalenessPolicy;

  constructor(private readonly deps: ProviderStatusDeps) {
    this.staleness = new StalenessPolicy(valuationPolicyOf(deps.settings));
  }

  status(workspaceId: string): Promise<ProviderStatus[]> {
    return this.deps.uow.run(workspaceId, () => this.providers(workspaceId));
  }

  /** Providers y, para cada par configurado del workspace, su cobertura y la antigüedad de su última tasa. */
  statusReport(workspaceId: string): Promise<ProviderStatusReport> {
    return this.deps.uow.run(workspaceId, async () => ({
      providers: await this.providers(workspaceId),
      pairs: this.deps.pairViews ? await this.deps.pairViews.status(workspaceId) : [],
      institutions: await this.institutions(workspaceId),
    }));
  }

  /**
   * Tasas por institución del workspace: para cada institución cubierta por el provider habilitado, sus tipos, la
   * vigencia de la última tasa, su antigüedad y si está obsoleta (`FX_STALE_AFTER_INSTITUTION`); para cada institución
   * adoptada, el estado de soporte en tasas y su razón (también sin provider habilitado). Solo lectura: nunca llama a un
   * provider. Consultas secuenciales (misma unidad de trabajo).
   */
  private async institutions(workspaceId: string): Promise<InstitutionRateStatus[]> {
    const s = this.deps.settings;
    const now = this.deps.clock.now().epochMillis;
    const byCode = new Map<string, { types: Set<FxRateType>; lastAsOf: string | null }>();
    const entry = (code: string) => {
      let e = byCode.get(code);
      if (!e) {
        e = { types: new Set(), lastAsOf: null };
        byCode.set(code, e);
      }
      return e;
    };
    if (s.institutionProvider !== null) {
      for (const stored of await this.deps.rates.latestInstitutionRates(workspaceId, s.institutionProvider)) {
        const snapshot = stored.rate.snapshot;
        if (!snapshot.institutionCode) continue;
        const e = entry(snapshot.institutionCode);
        e.types.add(snapshot.rateType);
        if (e.lastAsOf === null || Date.parse(snapshot.asOf) > Date.parse(e.lastAsOf))
          e.lastAsOf = snapshot.asOf;
      }
    }
    const support = new Map<string, { status: string; reason: string | null }>();
    if (this.deps.institutionSupport) {
      for (const adopted of await this.deps.institutionSupport.adoptedRatesSupport(workspaceId)) {
        entry(adopted.code);
        support.set(adopted.code, { status: adopted.status, reason: adopted.reason });
      }
    }
    return [...byCode.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([code, e]) => {
        const ageMs = e.lastAsOf === null ? null : Math.max(0, now - Date.parse(e.lastAsOf));
        return {
          code,
          rateTypes: [...e.types].sort(),
          lastRateAsOf: e.lastAsOf,
          ageSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
          stale: ageMs !== null && ageMs > s.staleAfterInstitutionMs,
          supportStatus: support.get(code)?.status ?? null,
          reason: support.get(code)?.reason ?? null,
        };
      });
  }

  /** Los providers de Bolivia y los cripto que la configuración nombra (habilitados o no) con descriptor registrado. */
  private async providers(workspaceId: string): Promise<ProviderStatus[]> {
    const out: ProviderStatus[] = [];
    const ids: FxRateProvider[] = [
      ...FX_RATE_PROVIDERS,
      ...this.deps.settings.cryptoRequested,
      ...this.deps.settings.institutionRequested,
    ];
    for (const provider of [...new Set(ids)]) {
      if (providerDescriptor(provider)) out.push(await this.statusOf(workspaceId, provider));
    }
    return out;
  }

  private async statusOf(workspaceId: string, provider: FxRateProvider): Promise<ProviderStatus> {
    const s = this.deps.settings;
    const now = this.deps.clock.now();
    const descriptor = providerDescriptor(provider) as NonNullable<ReturnType<typeof providerDescriptor>>;
    const enabled = enabledProviders(s).includes(provider);
    const feeds: ProviderFeedStatus[] = [];
    // Con pares configurados, los feeds del estado son los de los pares del workspace (la salud de un provider no
    // depende de un par que el workspace no registra).
    const configured = this.deps.pairViews ? await this.deps.pairViews.pairKeys(workspaceId) : null;
    // El estado de un provider por institución se informa por institución (`institutions[]`), no por feed.
    for (const feed of descriptor.kind === 'INSTITUTION' ? [] : descriptor.feeds) {
      if (configured && !configured.has(`${feed.base}/${feed.quote}`)) continue;
      const [primary, fallback] =
        feed.rateType === 'MARKET'
          ? [s.cryptoPrimary, s.cryptoFallback]
          : feed.rateType === 'OFFICIAL'
            ? [s.official, null]
            : [s.primary, s.fallback];
      const role = primary === provider ? 'PRIMARY' : fallback === provider ? 'FALLBACK' : null;
      if (!enabled || role === null) continue;
      const lastRate = await this.deps.rates.latestAccepted(workspaceId, { provider, ...feed });
      const asOf = lastRate ? Date.parse(lastRate.rate.snapshot.asOf) : null;
      feeds.push({
        ...feed,
        role,
        lastRate,
        stale: lastRate ? this.staleness.isStale(lastRate.rate.snapshot, now) : true,
        ageSeconds: asOf === null ? null : Math.max(0, Math.floor((now.epochMillis - asOf) / 1000)),
      });
    }
    const polls = await this.deps.runs.recent(provider, 200, ['POLL']);
    const attempts = polls.filter((r) => r.outcome !== 'SKIPPED_RATE_LIMIT');
    const lastSuccess = attempts.find((r) => SUCCESS.has(r.outcome)) ?? null;
    const lastFailure = attempts.find((r) => r.outcome === 'FAILED') ?? null;
    let consecutiveFailures = 0;
    for (const r of attempts) {
      if (r.outcome !== 'FAILED') break;
      consecutiveFailures++;
    }
    const retryAfter = polls.find(
      (r) => r.retryAfterUntil !== null && Date.parse(r.retryAfterUntil) > now.epochMillis,
    );
    const retryAfterUntil = retryAfter?.retryAfterUntil ?? null;
    // Una configuración general inválida afecta a todos; la de los providers cripto, solo a los cripto.
    const configError =
      s.configError ||
      (descriptor.kind === 'CRYPTO' && s.cryptoConfigError) ||
      (descriptor.kind === 'INSTITUTION' && s.institutionConfigError)
        ? { code: 'FX_PROVIDER_CONFIG_INVALID' as const, httpStatus: null, at: now.toString() }
        : null;
    const lastError =
      configError ??
      (lastFailure && lastFailure.errorCode
        ? { code: lastFailure.errorCode, httpStatus: lastFailure.httpStatus, at: lastFailure.startedAt }
        : null);
    const anyStale = feeds.some((f) => f.stale);
    const lastFailed = attempts[0]?.outcome === 'FAILED';
    const health: ProviderHealth = !enabled
      ? 'DISABLED'
      : anyStale
        ? 'DOWN'
        : lastFailed
          ? 'DEGRADED'
          : 'HEALTHY';
    return {
      provider,
      enabled,
      health,
      feeds,
      lastAttemptAt: attempts[0]?.startedAt ?? null,
      lastSuccessAt: lastSuccess?.startedAt ?? null,
      lastError,
      consecutiveFailures,
      nextAttemptAt: enabled
        ? nextTick(
            Math.max(now.epochMillis, Date.parse(retryAfterUntil ?? '') || 0),
            provider === s.institutionProvider
              ? Math.max(s.pollIntervalMs, s.institutionPollIntervalMs)
              : s.pollIntervalMs,
          )
        : null,
      pollIntervalSeconds: enabled
        ? Math.round(
            (provider === s.institutionProvider
              ? Math.max(s.pollIntervalMs, s.institutionPollIntervalMs)
              : s.pollIntervalMs) / 1000,
          )
        : null,
      rateLimit: { limitPerMinute: descriptor.limitPerMinute, retryAfterUntil },
      backfill: await this.backfillOf(provider, enabled),
      attribution: descriptor.attribution,
    };
  }

  private async backfillOf(provider: FxRateProvider, enabled: boolean): Promise<ProviderStatus['backfill']> {
    const s = this.deps.settings;
    const descriptor = providerDescriptor(provider);
    if (descriptor?.dailyCloses) {
      // Histórico cripto (D229): cada provider cripto habilitado mantiene su caché de cierres diarios.
      if (!enabled || !s.backfillEnabled) return { status: 'NOT_APPLICABLE' };
    } else {
      const historyProvider = [s.primary, s.fallback].find(
        (p) => p !== null && providerDescriptor(p)?.history,
      );
      if (!enabled || !s.backfillEnabled || historyProvider !== provider) return { status: 'NOT_APPLICABLE' };
    }
    const [last] = await this.deps.runs.recent(provider, 1, ['BACKFILL', 'GAP_FILL']);
    if (!last) return { status: 'PENDING', pointsImported: 0, from: null, to: null, lastRunAt: null };
    return backfillFrom(last);
  }
}

function backfillFrom(run: ProviderRun): ProviderStatus['backfill'] {
  return {
    status: run.outcome === 'FAILED' ? 'FAILED' : 'COMPLETED',
    pointsImported: run.historyPoints ?? 0,
    from: run.historyFrom,
    to: run.historyTo,
    lastRunAt: run.finishedAt,
  };
}

/** Próximo disparo del cron alineado al intervalo (UTC) estrictamente posterior a `fromMs`. */
function nextTick(fromMs: number, intervalMs: number): string | null {
  if (intervalMs <= 0) return null;
  return new Date((Math.floor(fromMs / intervalMs) + 1) * intervalMs).toISOString();
}
