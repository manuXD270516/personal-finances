import { Module, type DynamicModule } from '@nestjs/common';
import type { AuditPort, LifecycleMachineDto, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import { API_CONVENTIONS, type ApiConventionsOptions } from '@pf/platform/nest';
import { Instant, type Clock } from '@pf/shared-kernel';
import type { Pool } from 'pg';
import type { NotificationIntakePort } from '@pf/notifications/contracts';
import type { EventConsumerDefinition } from '@pf/platform/events';
import {
  FX_USER_CONVERSION_CONSUMER,
  type FxConversionPricingPort,
  type FxQuoteSideRatesPort,
  type FxValuationPort,
  type RatePairsQuery,
  type ValuationRateDto,
} from '../contracts/index.js';
import { FxQueries } from '../application/fx.queries.js';
import { FxService } from '../application/fx.service.js';
import { MarketRateIngestion } from '../application/market-rate-ingestion.js';
import type {
  ActiveWorkspacesPort,
  FirstBalanceDatePort,
  FxDeps,
  OutboxPort,
  WorkspaceSettingsPort,
} from '../application/ports/index.js';
import {
  anomalyThresholdsOf,
  assetClassPolicyOf,
  DEFAULT_FX_PROVIDER_SETTINGS,
  enabledProviders,
  parseFxProviderSettings,
  valuationPolicyOf,
  type FxProviderEnv,
  type FxProviderSettings,
} from '../application/provider-settings.js';
import { ProviderStatusQueries } from '../application/provider-status.queries.js';
import { RatePairViews } from '../application/rate-pair-views.js';
import { RatePairResolver } from '../application/rate-pairs.js';
import {
  observationFactOf,
  UserConversionObservations,
  type ConversionBackfillSource,
} from '../application/user-conversion-observations.js';
import { EXCHANGE_RATE_LIFECYCLE } from '../domain/index.js';
import type { CryptoRateProvider, FxRateProvider, PollableProvider, ResolvedRate } from '../domain/index.js';
import {
  PgCurrencyRepository,
  PgExchangeRateRepository,
  PgFxUnitOfWork,
  PgRateAnomalyReviewRepository,
  PgRatePairListRepository,
  PgRatePreferenceRepository,
  uuidV7Ids,
} from '../infrastructure/pg-fx.js';
import { PgProviderHistoryCache } from '../infrastructure/pg-provider-history.js';
import { PgProviderRunRepository } from '../infrastructure/pg-provider-runs.js';
import { PgRateFeedEpisodeRepository } from '../infrastructure/pg-rate-feed-episodes.js';
import { DolarApiBoProvider } from '../infrastructure/providers/dolarapi-bo.provider.js';
import { ParaleloBoProvider } from '../infrastructure/providers/paralelo-bo.provider.js';
import {
  PROVIDER_HOSTS,
  ProviderHttpClient,
  type HttpTransport,
} from '../infrastructure/providers/provider-http-client.js';
import {
  FX_PROVIDER_STATUS,
  FX_QUERIES,
  FX_RATE_PAIR_VIEWS,
  FX_SERVICE,
  FxController,
  toResolvedRateDto,
} from './fx-http.js';

export interface FxRuntimeOptions {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly audit: AuditPort;
  /** Auditoría + recorrido de tasas manuales (add-lifecycle-timeline). */
  readonly lifecycle: LifecyclePort;
  readonly lifecycleQuery: LifecycleQuery;
  readonly outbox: OutboxPort;
  /** Moneda de reporte y zona horaria del workspace (IDENTITY, vía composition root). */
  readonly workspaces: WorkspaceSettingsPort;
  /**
   * Ventana de vigencia de la resolución *as-of* en días (7 por defecto). Es un ajuste de REPORTING (docs/31 D53):
   * la composición lo lee de `REPORTING_RATE_VALIDITY_WINDOW` y lo entrega aquí; FX no tiene variable propia.
   */
  readonly windowDays?: number;
  /** Configuración `FX_*` validada (roles, obsolescencia, umbral de anomalía); por defecto la de design.md. */
  readonly providers?: FxProviderSettings;
}

export interface FxRuntime {
  readonly service: FxService;
  readonly queries: FxQueries;
  /** `GetProviderStatus` (solo lectura; nunca llama a un provider). */
  readonly providerStatus: ProviderStatusQueries;
  /** Pares de tasa automáticos del workspace con su cobertura (`GET/PUT fx-rate-pairs`). */
  readonly ratePairViews: RatePairViews;
  /** Lectura pública de los pares configurados (`@pf/fx/contracts` `RatePairsQuery`, para el change 39). */
  readonly ratePairs: RatePairsQuery;
  /** Puerto in-process para TRANSACTIONS (`@pf/fx/contracts`): referencia y costo de conversiones. */
  readonly pricing: FxConversionPricingPort;
  /** Valoración por lote para REPORTING (`@pf/fx/contracts`, add-basic-dashboard). */
  readonly valuation: FxValuationPort;
  /** Tasas de compra/venta paralela por lote para el spread alternativo de REPORTING (add-conversion-cost-analysis). */
  readonly quoteSide: FxQuoteSideRatesPort;
  /** Gancho síncrono de `CreateWorkspace`: habilita las monedas por defecto. */
  readonly provisioner: {
    onWorkspaceCreated(input: { readonly workspaceId: string; readonly userId: string }): Promise<void>;
  };
}

/** Tasa a precisión completa en la orientación almacenada (la original de una inversa; la cruzada tal cual). */
function exactRate(r: ResolvedRate): ValuationRateDto['exact'] {
  const stored = r.derivation === 'INVERSE' ? r.rate.inverse() : r.rate;
  return { base: stored.base.code, quote: stored.quote.code, value: stored.value.toFixed() };
}

/** `FxValuationPort` sobre las consultas de FX (misma unidad de trabajo del llamador si existe). */
function valuationPort(queries: FxQueries): FxValuationPort {
  return {
    get windowDays() {
      return queries.windowDays;
    },
    async resolveValuationRates({ workspaceId, requests, windowDays }) {
      const found = await queries.resolveValuationRates(
        workspaceId,
        requests.map((r) => ({ base: r.base, quote: r.quote, at: Instant.parse(r.at) })),
        windowDays,
      );
      return found.map((r) => (r ? { resolved: toResolvedRateDto(r), exact: exactRate(r) } : null));
    },
    async enabledCurrencies(workspaceId) {
      const rows = await queries.listCurrencies(workspaceId, { enabled: true });
      return rows.map((r) => ({
        code: r.definition.code,
        kind: r.definition.kind,
        scale: r.definition.scale,
      }));
    },
    async workspaceCurrencies(workspaceId) {
      const rows = await queries.listCurrencies(workspaceId, {});
      return rows.map((r) => ({
        code: r.definition.code,
        kind: r.definition.kind,
        scale: r.definition.scale,
        enabled: r.enabled,
      }));
    },
  };
}

/** `FxQuoteSideRatesPort` sobre las consultas de FX (misma unidad de trabajo del llamador si existe). */
function quoteSidePort(queries: FxQueries): FxQuoteSideRatesPort {
  return {
    async resolveQuoteSideRates({ workspaceId, requests, windowDays }) {
      const found = await queries.resolveQuoteSideRates(
        workspaceId,
        requests.map((r) => ({ base: r.base, quote: r.quote, at: Instant.parse(r.at), side: r.side })),
        windowDays,
      );
      return found.map((r) => (r ? { resolved: toResolvedRateDto(r), exact: exactRate(r) } : null));
    },
  };
}

/** Puerto que un proceso de solo lectura nunca debe invocar (falla fuerte si se usa por error). */
const unavailable = <T>(what: string): T =>
  new Proxy(
    {},
    {
      get: () => () => {
        throw new Error(`${what} is not available in the read-only FX valuation runtime`);
      },
    },
  ) as T;

/**
 * Valoración de FX para procesos SIN comandos (el worker de PLANNING evalúa umbrales con las mismas reglas que el
 * Home; openspec add-budgets, docs/33 D109): solo lee tasas y monedas con la ventana de vigencia indicada. Los puertos
 * de escritura (auditoría, outbox, workspaces) no existen aquí.
 */
export function createFxValuation(options: {
  readonly pool: Pool;
  readonly clock: Clock;
  readonly windowDays?: number;
  readonly providers?: FxProviderSettings;
}): FxValuationPort {
  const settings = options.providers ?? DEFAULT_FX_PROVIDER_SETTINGS;
  const deps: FxDeps = {
    uow: new PgFxUnitOfWork(options.pool),
    rates: new PgExchangeRateRepository(),
    currencies: new PgCurrencyRepository(),
    preferences: new PgRatePreferenceRepository(),
    reviews: new PgRateAnomalyReviewRepository(),
    pairs: new PgRatePairListRepository(),
    workspaces: unavailable('workspace settings'),
    outbox: unavailable('outbox'),
    audit: unavailable('audit'),
    lifecycle: unavailable('lifecycle'),
    lifecycleQuery: unavailable('lifecycle query'),
    ids: uuidV7Ids,
    clock: options.clock,
    policy: valuationPolicyOf(settings),
    anomalyThresholdPct: settings.anomalyThresholdPct,
    anomalyThresholds: anomalyThresholdsOf(settings),
    assetClasses: assetClassPolicyOf(settings),
    // Sin acceso a la moneda base del workspace: la lista por defecto se deriva solo con los pares cripto.
    valuationOnly: true,
    ...(options.windowDays ? { windowDays: options.windowDays } : {}),
  };
  return valuationPort(new FxQueries(deps));
}

/** Composición de FX sobre PostgreSQL. */
export function createFxRuntime(options: FxRuntimeOptions): FxRuntime {
  const settings = options.providers ?? DEFAULT_FX_PROVIDER_SETTINGS;
  const rates = new PgExchangeRateRepository();
  const uow = new PgFxUnitOfWork(options.pool);
  const deps: FxDeps = {
    uow,
    rates,
    currencies: new PgCurrencyRepository(),
    preferences: new PgRatePreferenceRepository(),
    reviews: new PgRateAnomalyReviewRepository(),
    pairs: new PgRatePairListRepository(),
    workspaces: options.workspaces,
    outbox: options.outbox,
    audit: options.audit,
    lifecycle: options.lifecycle,
    lifecycleQuery: options.lifecycleQuery,
    ids: uuidV7Ids,
    clock: options.clock,
    policy: valuationPolicyOf(settings),
    anomalyThresholdPct: settings.anomalyThresholdPct,
    anomalyThresholds: anomalyThresholdsOf(settings),
    assetClasses: assetClassPolicyOf(settings),
    ...(options.windowDays ? { windowDays: options.windowDays } : {}),
  };
  const service = new FxService(deps);
  const queries = new FxQueries(deps);
  const ratePairViews = new RatePairViews({
    uow,
    rates,
    pairs: new RatePairResolver(deps),
    clock: options.clock,
    settings,
    episodes: new PgRateFeedEpisodeRepository(),
  });
  return {
    service,
    queries,
    providerStatus: new ProviderStatusQueries({
      uow,
      rates,
      runs: new PgProviderRunRepository(options.pool),
      clock: options.clock,
      settings,
      pairViews: ratePairViews,
    }),
    ratePairViews,
    ratePairs: queries,
    pricing: queries,
    valuation: valuationPort(queries),
    quoteSide: quoteSidePort(queries),
    provisioner: {
      // Sin consultar IDENTITY: el workspace aún se está creando en la misma transacción (BOB, USD, USDT).
      onWorkspaceCreated: ({ workspaceId }) => service.onWorkspaceCreated({ workspaceId }),
    },
  };
}

export interface FxModuleOptions {
  readonly runtime: FxRuntime;
  readonly conventions: ApiConventionsOptions;
}

/** Módulo HTTP de FX (`/currencies`, `/fx-rates*`, `/fx-rate-preferences`, `/fx-rate-pairs`, `/fx-providers/status`). */
@Module({})
export class FxModule {
  static register(options: FxModuleOptions): DynamicModule {
    return {
      module: FxModule,
      controllers: [FxController],
      providers: [
        { provide: API_CONVENTIONS, useValue: options.conventions },
        { provide: FX_SERVICE, useValue: options.runtime.service },
        { provide: FX_QUERIES, useValue: options.runtime.queries },
        { provide: FX_PROVIDER_STATUS, useValue: options.runtime.providerStatus },
        { provide: FX_RATE_PAIR_VIEWS, useValue: options.runtime.ratePairViews },
      ],
    };
  }
}

// ------------------------------------------------------------------ worker: observaciones de conversiones propias

export interface FxUserConversionOptions {
  /** Pool del worker (`pf_worker`). */
  readonly pool: Pool;
  readonly clock: Clock;
  readonly outbox: OutboxPort;
}

/** Composición del registro de observaciones de conversiones propias para el worker (D231; tareas 4.4 y 5.2). */
export function createUserConversionObservations(
  options: FxUserConversionOptions,
): UserConversionObservations {
  return new UserConversionObservations({
    uow: new PgFxUnitOfWork(options.pool),
    rates: new PgExchangeRateRepository(),
    currencies: new PgCurrencyRepository(),
    outbox: options.outbox,
    ids: uuidV7Ids,
    clock: options.clock,
  });
}

/**
 * Consumidor `fx.user-conversion-observations` (D231, D249): el único consumidor nuevo de Phase 5. Concurrencia 1 (no
 * reserva conexiones del pool del worker). En la transacción del consumidor (inbox + RLS del workspace, INV-028):
 * `ConversionRecorded.v1` registra la observación de la conversión, `ConversionRevised.v1` registra la de la revisión
 * nueva reemplazando a la anterior y `TransactionVoided.v1` (solo conversiones) marca la vigente como anulada.
 */
export function userConversionConsumers(observations: UserConversionObservations): EventConsumerDefinition[] {
  return [
    {
      consumer: FX_USER_CONVERSION_CONSUMER,
      concurrency: 1,
      events: [
        { type: 'transactions.ConversionRecorded', version: 1 },
        { type: 'transactions.ConversionRevised', version: 1 },
        { type: 'transactions.TransactionVoided', version: 1 },
      ],
      handler: async (event) => {
        if (event.eventType === 'transactions.TransactionVoided') {
          const payload = event.payload as { readonly kind?: unknown; readonly transactionId?: unknown };
          if (payload.kind !== 'CONVERSION' || typeof payload.transactionId !== 'string') return;
          await observations.withdraw({
            workspaceId: event.workspaceId,
            transactionId: payload.transactionId,
          });
          return;
        }
        await observations.record(observationFactOf(event.workspaceId, event.payload));
      },
    },
  ];
}

export { UserConversionObservations, type ConversionBackfillSource };

/** Máquina de estados `ExchangeRate` (tasas manuales; add-lifecycle-timeline), para AUDIT en el composition root. */
export const EXCHANGE_RATE_LIFECYCLE_MACHINE: LifecycleMachineDto = EXCHANGE_RATE_LIFECYCLE.definition;

// ------------------------------------------------------------------ worker: providers de tasas de mercado

/**
 * Fábricas de los adapters REALES de providers cripto por id (`CRYPTO_<NOMBRE>`). Vacío a propósito: ningún adapter se
 * escribe antes de verificar y registrar en ADR-0029 los términos de uso y la licencia de su fuente (NFR-COMP-007,
 * RISK-023, D225). Cada adapter nuevo se agrega aquí junto con su descriptor `VERIFIED` del dominio.
 */
export const CRYPTO_ADAPTER_FACTORIES: Readonly<
  Record<
    string,
    (deps: {
      readonly http: ProviderHttpClient;
      readonly clock: Clock;
      readonly baseUrl: string | undefined;
    }) => CryptoRateProvider
  >
> = Object.freeze({});

/** Colas pg-boss de los providers (design.md decisión 4). */
export const FX_POLL_QUEUE = 'fx.poll-market-rates';
export const FX_BACKFILL_QUEUE = 'fx.backfill-historical-rates';
export const FX_GAP_FILL_QUEUE = 'fx.fill-rate-gaps';
/** Cron diario del relleno de días faltantes (02:00 America/La_Paz). */
export const FX_GAP_FILL_CRON = '0 2 * * *';
export const FX_GAP_FILL_TZ = 'America/La_Paz';
/** Consumidor de `identity.WorkspaceCreated.v1` (siembra preferencias y encola la carga histórica). */
export const FX_WORKSPACE_PROVISIONING_CONSUMER = 'fx.market-rate-provisioning';

export interface FxMarketRateJobsOptions {
  /** Pool del worker (`pf_worker`). */
  readonly pool: Pool;
  readonly clock: Clock;
  readonly outbox: OutboxPort;
  /** Workspaces activos (IDENTITY, vía composition root). */
  readonly workspaces: ActiveWorkspacesPort;
  readonly settings: FxProviderSettings;
  /**
   * Primera fecha con saldo por moneda del workspace (LEDGER, vía el composition root): base del histórico de cierres
   * cripto. Sin él no se carga el histórico cripto.
   */
  readonly firstBalance?: FirstBalanceDatePort;
  /**
   * Adapters de providers cripto inyectados (dobles de prueba). Hasta que ADR-0029 registre los términos de una fuente
   * no existe ningún adapter real: en producción esta opción no se usa y `CRYPTO_ADAPTER_FACTORIES` está vacío.
   */
  readonly cryptoProviders?: Partial<Record<FxRateProvider, CryptoRateProvider>>;
  /**
   * Puerto síncrono de NOTIFY (`@pf/notifications/contracts`, add-rate-feed-alerts, D249) para las alertas de
   * obsolescencia y de muestra retenida: el composition root del worker lo cablea. Sin él se escriben igual los
   * episodios y los eventos de dominio.
   */
  readonly notifications?: NotificationIntakePort;
  /** Tests: servidor HTTP local en lugar de los providers reales (nunca red en CI). */
  readonly endpoints?: {
    readonly baseUrls?: Partial<Record<FxRateProvider, string>>;
    readonly allowedHosts?: readonly string[];
    readonly transport?: HttpTransport;
  };
}

export interface FxMarketRateJobs {
  readonly settings: FxProviderSettings;
  /** `false` con todos los roles en `none` o configuración inválida: no se registran colas (degradación). */
  readonly enabled: boolean;
  readonly ingestion: MarketRateIngestion;
}

/**
 * Composición de la ingesta de tasas de mercado para el worker (fx/market-rate-providers). El cliente HTTP se
 * construye UNA vez, fuera del bucle por workspace, y no recibe ningún contexto de workspace (NFR-COMP-001).
 */
export function createFxMarketRateJobs(options: FxMarketRateJobsOptions): FxMarketRateJobs {
  const { settings } = options;
  const urls = options.endpoints?.baseUrls ?? {};
  const allowedHosts = options.endpoints?.allowedHosts ?? providerHostsFor(urls);
  const http = new ProviderHttpClient({
    clock: options.clock,
    timeoutMs: settings.timeoutMs,
    ...(options.endpoints?.transport ? { transport: options.endpoints.transport } : {}),
    allowedHosts,
  });
  const providers: Partial<Record<FxRateProvider, PollableProvider>> = {
    PARALELO_BO: new ParaleloBoProvider(http, options.clock, urls.PARALELO_BO),
    DOLARAPI_BO: new DolarApiBoProvider(http, urls.DOLARAPI_BO),
  };
  // Providers cripto: solo los verificados (la configuración rechaza el resto) y con adapter registrado.
  for (const id of [settings.cryptoPrimary, settings.cryptoFallback]) {
    if (id === null) continue;
    const injected = options.cryptoProviders?.[id];
    const factory = CRYPTO_ADAPTER_FACTORIES[id];
    if (injected) providers[id] = injected;
    else if (factory) providers[id] = factory({ http, clock: options.clock, baseUrl: urls[id] });
  }
  const ingestion = new MarketRateIngestion({
    uow: new PgFxUnitOfWork(options.pool),
    rates: new PgExchangeRateRepository(),
    currencies: new PgCurrencyRepository(),
    preferences: new PgRatePreferenceRepository(),
    runs: new PgProviderRunRepository(options.pool),
    workspaces: options.workspaces,
    outbox: options.outbox,
    ids: uuidV7Ids,
    clock: options.clock,
    settings,
    providers,
    pairs: new PgRatePairListRepository(),
    historyCache: new PgProviderHistoryCache(options.pool),
    ...(options.firstBalance ? { firstBalance: options.firstBalance } : {}),
    // Alertas de obsolescencia por par y de muestra retenida (add-rate-feed-alerts, D233, D234, D249).
    episodes: new PgRateFeedEpisodeRepository(),
    ...(options.notifications ? { notifications: options.notifications } : {}),
  });
  return { settings, enabled: enabledProviders(settings).length > 0, ingestion };
}

/**
 * Allowlist de hosts: los de los providers reales más los de las URL base alternativas (solo local/CI: providers
 * simulados por un servidor HTTP local en las pruebas E2E; `FX_PROVIDER_*_URL` se rechaza en staging/production).
 */
export function providerHostsFor(baseUrls: Partial<Record<FxRateProvider, string>>): string[] {
  const extra = Object.values(baseUrls)
    .filter((u): u is string => typeof u === 'string' && u !== '')
    .map((u) => new URL(u).hostname);
  return [...new Set([...PROVIDER_HOSTS, ...extra])];
}

export { FX_AUDIT_POLICY, type FxConversionPricingPort } from '../contracts/index.js';
export { parseFxProviderSettings, type FxProviderEnv, type FxProviderSettings };
export type { ActiveWorkspacesPort, FirstBalanceDatePort, OutboxPort, WorkspaceSettingsPort };
