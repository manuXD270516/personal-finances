import type { AuditPort } from '@pf/audit/contracts';
import type { Clock, Instant } from '@pf/shared-kernel';
import type {
  CurrencyDefinition,
  CurrencyKind,
  ExchangeRate,
  FxRateSource,
  FxRateType,
  RateCandidate,
} from '../../domain/index.js';

/** Transacción PG + `SET LOCAL app.workspace_id`; reutiliza la del llamador si existe (Transactions, idempotencia). */
export interface UnitOfWork {
  run<T>(workspaceId: string, fn: () => Promise<T>): Promise<T>;
}

/** Tasa con su estado de reemplazo (la versión que la reemplazó, si existe). */
export interface StoredRate {
  readonly rate: ExchangeRate;
  readonly supersededById: string | null;
}

export interface RateListFilter {
  readonly base?: string;
  readonly quote?: string;
  readonly rateType?: FxRateType;
  readonly source?: FxRateSource;
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
}

/** Ajustes del workspace (IDENTITY vía composition root): moneda de reporte y zona horaria. */
export interface WorkspaceSettingsPort {
  settingsOf(workspaceId: string): Promise<{ readonly baseCurrency: string; readonly timeZone: string }>;
}

export interface OutboxPort {
  append(event: {
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
  readonly ids: IdGenerator;
  readonly clock: Clock;
  /** Ventana de vigencia de la resolución *as-of* (días; 7 por defecto). */
  readonly windowDays?: number;
}
