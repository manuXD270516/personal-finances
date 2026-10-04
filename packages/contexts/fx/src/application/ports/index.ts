import type { AuditPort, LifecyclePort, LifecycleQuery } from '@pf/audit/contracts';
import type { Clock, Instant } from '@pf/shared-kernel';
import type {
  AnomalyStatus,
  CurrencyDefinition,
  CurrencyKind,
  ExchangeRate,
  FxProviderErrorCode,
  FxRateProvider,
  FxRateSource,
  FxRateType,
  RateCandidate,
  ValuationPolicy,
} from '../../domain/index.js';

/** Transacción PG + `SET LOCAL app.workspace_id`; reutiliza la del llamador si existe (Transactions, idempotencia). */
export interface UnitOfWork {
  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}

/** Decisión de un miembro sobre una tasa anómala (`fx.rate_anomaly_review`, append-only). */
export interface AnomalyReview {
  readonly rateId: string;
  readonly workspaceId: string;
  readonly decision: 'CONFIRMED' | 'REJECTED';
  readonly reason: string;
  readonly decidedBy: string;
  readonly decidedAt: string;
}

/** Tasa con su estado de reemplazo (la versión que la reemplazó, si existe) y la revisión de su anomalía. */
export interface StoredRate {
  readonly rate: ExchangeRate;
  readonly supersededById: string | null;
  readonly anomalyReview?: AnomalyReview | null;
}

/** Estado de la anomalía de una tasa almacenada (`null` si no está marcada). */
export function anomalyStatusOf(stored: StoredRate): AnomalyStatus | null {
  if (stored.rate.snapshot.anomaly === null) return null;
  return stored.anomalyReview?.decision ?? 'PENDING';
}

/** Feed de un provider en un workspace (par y tipo). */
export interface ProviderFeedKey {
  readonly provider: FxRateProvider;
  readonly base: string;
  readonly quote: string;
  readonly rateType: FxRateType;
}

export interface RateListFilter {
  readonly base?: string;
  readonly quote?: string;
  readonly rateType?: FxRateType;
  readonly source?: FxRateSource;
  readonly provider?: FxRateProvider;
  readonly asOfFrom?: string;
  readonly asOfTo?: string;
  readonly includeSuperseded: boolean;
}

/**
 * Historial APPEND-ONLY de tasas (INV-011): solo `insert`; sin update ni delete. La BD lo garantiza con grants
 * (`SELECT, INSERT`) y con el índice único parcial de `supersedes_id` (reemplazo de un solo nivel por versión).
 */
export interface ExchangeRateRepository {
  /** `FX_RATE_ALREADY_SUPERSEDED` si otra versión ya reemplazó a `supersedesId` (carrera resuelta por la BD). */
  insert(rate: ExchangeRate): Promise<void>;
  findById(workspaceId: string, id: string): Promise<StoredRate | null>;
  /** Tasas visibles (del workspace o globales) entre las monedas dadas con `asOf` en [from, to]. */
  candidates(
    workspaceId: string,
    currencies: readonly string[],
    from: Instant,
    to: Instant,
  ): Promise<RateCandidate[]>;
  /** Página por offset, `asOf` descendente (el cursor opaco lo firma la capa HTTP). */
  list(
    workspaceId: string,
    filter: RateListFilter,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<StoredRate[]>;
  /**
   * Inserta una tasa de provider si no existe otra con el mismo (workspace, provider, par, tipo, vigencia) — índice
   * único `exchange_rate_provider_uk`, `ON CONFLICT DO NOTHING`. `true` si se insertó.
   */
  insertProviderRate(rate: ExchangeRate): Promise<boolean>;
  /**
   * Última tasa ACEPTADA de un feed (no marcada, o marcada y confirmada; nunca pendiente ni rechazada): línea base de
   * la detección de anomalías y "última tasa" del estado de providers.
   */
  latestAccepted(workspaceId: string, feed: ProviderFeedKey): Promise<StoredRate | null>;
  /** Fechas efectivas (YYYY-MM-DD) con alguna tasa del feed en [from, to] (relleno de días faltantes). */
  providerDays(workspaceId: string, feed: ProviderFeedKey, from: string, to: string): Promise<Set<string>>;
}

/** Revisiones de anomalías (append-only; PK = tasa). */
export interface RateAnomalyReviewRepository {
  /** `FX_RATE_ANOMALY_ALREADY_REVIEWED` si la tasa ya tiene una decisión (carrera resuelta por la PK). */
  insert(review: AnomalyReview): Promise<void>;
}

export type ProviderRunKind = 'POLL' | 'BACKFILL' | 'GAP_FILL';
export type ProviderRunOutcome = 'OK' | 'NO_NEW_SAMPLE' | 'FAILED' | 'SKIPPED_RATE_LIMIT' | 'SKIPPED_CACHE';

/** Intento de un provider (`fx.provider_run`, tabla de instalación sin datos de usuario). */
export interface ProviderRun {
  readonly id: string;
  readonly provider: FxRateProvider;
  readonly kind: ProviderRunKind;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly outcome: ProviderRunOutcome;
  readonly errorCode: FxProviderErrorCode | null;
  readonly httpStatus: number | null;
  readonly latencyMs: number;
  /** Tasas nuevas registradas (suma de todos los workspaces). */
  readonly newSamples: number;
  readonly retryAfterUntil: string | null;
  /** Solo BACKFILL/GAP_FILL: días completos publicados por el histórico y su rango. */
  readonly historyPoints: number | null;
  readonly historyFrom: string | null;
  readonly historyTo: string | null;
}

export interface ProviderRunRepository {
  record(run: ProviderRun): Promise<void>;
  /** Últimas `limit` corridas del provider (más recientes primero), opcionalmente de ciertos tipos. */
  recent(provider: FxRateProvider, limit: number, kinds?: readonly ProviderRunKind[]): Promise<ProviderRun[]>;
  /** Borra corridas anteriores a `before` (retención de 90 días). */
  purgeBefore(before: string): Promise<number>;
}

/** Workspaces activos (IDENTITY vía composition root) a los que el worker copia las tasas de provider. */
export interface ActiveWorkspacesPort {
  list(): Promise<readonly { readonly workspaceId: string; readonly timeZone: string }[]>;
}

export interface CurrencyRow {
  readonly definition: CurrencyDefinition;
  readonly enabled: boolean;
}

export interface CurrencyRepository {
  /** Catálogo visible al workspace con su marca de habilitada. */
  list(workspaceId: string, filter: { readonly kind?: CurrencyKind }): Promise<CurrencyRow[]>;
  /** Moneda ACTIVA del catálogo (`null` si no existe o está inactiva). */
  find(code: string): Promise<CurrencyDefinition | null>;
  /** Idempotente (`ON CONFLICT DO NOTHING`). */
  enable(workspaceId: string, codes: readonly string[]): Promise<void>;
}

export interface RatePreference {
  readonly base: string;
  readonly quote: string;
  readonly rateType: FxRateType;
}

export interface RatePreferenceSet {
  readonly preferences: readonly RatePreference[];
  /** Versión de la lista completa (ETag; `1` si nunca se fijó). */
  readonly version: number;
}

export interface RatePreferenceRepository {
  get(workspaceId: string, options?: { readonly forUpdate?: boolean }): Promise<RatePreferenceSet>;
  /** Reemplazo completo con optimistic locking: `false` si la versión cambió. */
  replace(
    workspaceId: string,
    preferences: readonly RatePreference[],
    expectedVersion: number,
  ): Promise<boolean>;
  /**
   * Siembra preferencias por defecto SOLO si el usuario nunca fijó la lista (sin versión guardada) y el par no tiene
   * preferencia (`ON CONFLICT DO NOTHING`); no cambia la versión.
   */
  seedDefaults(workspaceId: string, preferences: readonly RatePreference[]): Promise<void>;
}

/** Ajustes del workspace (IDENTITY vía composition root): moneda de reporte y zona horaria. */
export interface WorkspaceSettingsPort {
  settingsOf(workspaceId: string): Promise<{ readonly baseCurrency: string; readonly timeZone: string }>;
}

export interface OutboxPort {
  append(event: {
    /** Productor del evento (providers: `{type: SYSTEM, id: "fx-provider:<id>"}`); por defecto el del contexto. */
    readonly actor?: { readonly type: 'USER' | 'SYSTEM' | 'SERVICE'; readonly id: string | null };
    readonly correlationId?: string;
    readonly eventId: string;
    readonly eventType: string;
    readonly eventVersion: number;
    readonly occurredAt: string;
    readonly workspaceId: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly aggregateVersion: number;
    readonly payload: object;
  }): Promise<void>;
}

export interface IdGenerator {
  /** UUIDv7. */
  next(): string;
}

export interface FxDeps {
  readonly uow: UnitOfWork;
  readonly rates: ExchangeRateRepository;
  readonly currencies: CurrencyRepository;
  readonly preferences: RatePreferenceRepository;
  readonly workspaces: WorkspaceSettingsPort;
  readonly outbox: OutboxPort;
  readonly audit: AuditPort;
  /** Auditoría + recorrido de tasas manuales (add-lifecycle-timeline). */
  readonly lifecycle: LifecyclePort;
  /** `GetLifecycle` de AUDIT para `GET W/fx-rates/{id}/lifecycle`. */
  readonly lifecycleQuery: LifecycleQuery;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** Ventana de vigencia de la resolución *as-of* (días; 7 por defecto). */
  readonly windowDays?: number;
  /** Revisiones de anomalías (fx/market-rate-providers). */
  readonly reviews: RateAnomalyReviewRepository;
  /** Roles de providers y obsolescencia de la valoración (por defecto, los de design.md decisión 5). */
  readonly policy?: ValuationPolicy;
  /** Umbral de anomalía vigente (`FX_ANOMALY_THRESHOLD_PCT`), informado en `FxRate.anomaly.thresholdPct`. */
  readonly anomalyThresholdPct?: string;
}
