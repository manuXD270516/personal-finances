import type { FxRateProvider, RateAttribution } from '../dashboard/types';
import type { FxRate, FxRateType } from '../common/types';

/**
 * Tipos del contrato `getFxProviderStatus` (`GET /workspaces/{workspaceId}/fx-providers/status`) y lógica pura de la
 * pantalla `/fx` → Proveedores (add-market-rate-providers 6.2). Tasas y porcentajes son `DecimalString`: nunca
 * `number` (INV-001).
 */

export type ProviderHealth = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'DISABLED';
export type BackfillStatus = 'NOT_APPLICABLE' | 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface FxProviderFeed {
  readonly base: string;
  readonly quote: string;
  readonly rateType: FxRateType;
  readonly role: 'PRIMARY' | 'FALLBACK';
  readonly lastRate: FxRate | null;
  readonly stale: boolean;
  readonly ageSeconds: number | null;
}

export interface FxProviderStatus {
  readonly provider: FxRateProvider;
  readonly enabled: boolean;
  readonly health: ProviderHealth;
  readonly feeds: readonly FxProviderFeed[];
  readonly lastAttemptAt: string | null;
  readonly lastSuccessAt: string | null;
  readonly lastError: {
    readonly code: string;
    readonly httpStatus: number | null;
    readonly at: string;
  } | null;
  readonly consecutiveFailures: number;
  readonly nextAttemptAt: string | null;
  readonly pollIntervalSeconds: number | null;
  readonly rateLimit?: { readonly limitPerMinute?: number | null; readonly retryAfterUntil?: string | null };
  readonly backfill: {
    readonly status: BackfillStatus;
    readonly pointsImported?: number;
    readonly from?: string | null;
    readonly to?: string | null;
    readonly lastRunAt?: string | null;
  };
  readonly attribution: RateAttribution;
}

/** Nombre visible de cada provider (el mismo que su atribución, sin el prefijo "Fuente:"). */
export const PROVIDER_NAMES: Readonly<Record<string, string>> = {
  PARALELO_BO: 'paralelo.bo',
  DOLARAPI_BO: 'bo.dolarapi.com',
};
export const providerName = (p: string): string => PROVIDER_NAMES[p] ?? p;

/** Pares y tipos cuya tasa de valoración se muestra (los feeds de valoración de los providers). */
export const VALUATION_FEEDS: readonly { base: string; quote: string; rateType: FxRateType }[] = [
  { base: 'USD', quote: 'BOB', rateType: 'PARALLEL' },
  { base: 'USDT', quote: 'BOB', rateType: 'PARALLEL' },
  { base: 'USD', quote: 'BOB', rateType: 'OFFICIAL' },
];

/** Ventana de vigencia de la valoración: las anomalías y compra/venta más antiguas ya no se usan. */
export const PROVIDER_WINDOW_DAYS = 7;

/** Límite inferior (`asOfFrom`) del listado de tasas de provider: ahora − 7 días. */
export const providerWindowStart = (now: Date = new Date()): string =>
  new Date(now.getTime() - PROVIDER_WINDOW_DAYS * 86_400_000).toISOString();

const newestFirst = (a: FxRate, b: FxRate) => b.asOf.localeCompare(a.asOf);

/** Muestras anómalas pendientes de revisión (bandeja), la más reciente primero. */
export const pendingAnomalies = (rates: readonly FxRate[]): FxRate[] =>
  rates.filter((r) => r.anomaly?.status === 'PENDING').sort(newestFirst);

/** Anomalías ya revisadas (confirmadas o rechazadas) dentro de la ventana, la más reciente primero. */
export const reviewedAnomalies = (rates: readonly FxRate[]): FxRate[] =>
  rates
    .filter((r) => r.anomaly && r.anomaly.status !== 'PENDING')
    .sort((a, b) => (b.anomaly?.reviewedAt ?? '').localeCompare(a.anomaly?.reviewedAt ?? ''));

export interface QuoteSides {
  /** `PARALLEL_BUY`: BOB que pagas al comprar 1 unidad de la base (docs/31 D39: el valor mayor). */
  readonly buy: FxRate | null;
  /** `PARALLEL_SELL`: BOB que recibes al vender 1 unidad de la base (el valor menor). */
  readonly sell: FxRate | null;
}

/**
 * Última compra y venta publicadas por provider y par (`PROVIDER:BASE/QUOTE`), sin reemplazadas ni anomalías
 * pendientes o rechazadas: la convención es la del owner (D39), compra = lo que pagas, venta = lo que recibes.
 */
export function quoteSidesByProviderPair(rates: readonly FxRate[]): Map<string, QuoteSides> {
  const out = new Map<string, { buy: FxRate | null; sell: FxRate | null }>();
  const usable = rates
    .filter(
      (r) =>
        r.provider &&
        !r.supersededByRateId &&
        (r.rateType === 'PARALLEL_BUY' || r.rateType === 'PARALLEL_SELL') &&
        (!r.anomaly || r.anomaly.status === 'CONFIRMED'),
    )
    .sort(newestFirst);
  for (const r of usable) {
    const key = `${r.provider}:${r.base}/${r.quote}`;
    const entry = out.get(key) ?? { buy: null, sell: null };
    if (r.rateType === 'PARALLEL_BUY' && !entry.buy) entry.buy = r;
    if (r.rateType === 'PARALLEL_SELL' && !entry.sell) entry.sell = r;
    out.set(key, entry);
  }
  return out;
}

/** Motivo de la revisión de una anomalía: 3–500 caracteres (`FxRateAnomalyReview.reason`). */
export function reviewReasonError(reason: string): 'REASON_MIN' | 'REASON_MAX' | null {
  const r = reason.trim();
  if (r.length < 3) return 'REASON_MIN';
  if (r.length > 500) return 'REASON_MAX';
  return null;
}

/** Variación con signo explícito (`+12.31`), redondeada para mostrar sin pasar por `number`. */
export function signedPct(value: string): string {
  const negative = value.startsWith('-');
  const unsigned = value.replace(/^[-+]/, '');
  return `${negative ? '-' : '+'}${unsigned}`;
}
