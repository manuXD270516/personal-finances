import { dec, type Instant } from '@pf/shared-kernel';
import type { ExchangeRateState } from './exchange-rate.js';
import {
  isQuoteSideRateType,
  marketOf,
  type FxRateProvider,
  type FxRateType,
  type RateSelection,
} from './fx-types.js';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

/** Providers por rol para un tipo de tasa (`FX_PROVIDER_PRIMARY` / `FX_PROVIDER_FALLBACK` / `FX_PROVIDER_OFFICIAL`). */
export interface ProviderRoles {
  readonly primary: FxRateProvider | null;
  readonly fallback: FxRateProvider | null;
}

/** Política de valoración: roles por tipo y umbral de obsolescencia por tipo (design.md decisiones 5 y 6). */
export interface ValuationPolicy {
  readonly roles: Readonly<Partial<Record<FxRateType, ProviderRoles>>>;
  /** Antigüedad máxima (ms) de una tasa de provider para no considerarse obsoleta; sin entrada = nunca obsoleta. */
  readonly staleAfterMs: Readonly<Partial<Record<FxRateType, number>>>;
  /**
   * Umbral PROPIO del provider de respaldo de cada tipo (`FX_STALE_AFTER_FALLBACK`; decisión del owner 2026-10-03:
   * bo.dolarapi.com publica su `fechaActualizacion` con ~2 h de retraso). Sin entrada = el umbral del tipo.
   */
  readonly fallbackStaleAfterMs?: Readonly<Partial<Record<FxRateType, number>>>;
  /**
   * Último recurso con manuales de OTRO tipo (docs/31 D34): antigüedad máxima (`FX_MANUAL_FALLBACK_MAX_AGE`, 24 h por
   * defecto) y desvío máximo en % respecto de la última tasa de provider del par y tipo pedido, si existe (el umbral
   * de anomalía, `FX_ANOMALY_THRESHOLD_PCT`, 5 % por defecto). Sin entrada = defaults.
   */
  readonly manualFallbackMaxAgeMs?: number;
  readonly manualFallbackMaxDeviationPct?: string;
}

export const DEFAULT_MANUAL_FALLBACK_MAX_AGE_MS = 24 * HOUR_MS;
export const DEFAULT_MANUAL_FALLBACK_MAX_DEVIATION_PCT = '5';

/**
 * Defaults de design.md decisión 5: paralelo.bo principal, bo.dolarapi.com respaldo y oficial; 60 min / 48 h; el
 * respaldo de `PARALLEL` tiene su propio umbral de 180 min (decisión 30).
 */
export const DEFAULT_VALUATION_POLICY: ValuationPolicy = Object.freeze({
  roles: Object.freeze({
    PARALLEL: Object.freeze({ primary: 'PARALELO_BO', fallback: 'DOLARAPI_BO' }),
    OFFICIAL: Object.freeze({ primary: 'DOLARAPI_BO', fallback: null }),
  }),
  staleAfterMs: Object.freeze({ PARALLEL: 60 * MINUTE_MS, OFFICIAL: 48 * HOUR_MS }),
  fallbackStaleAfterMs: Object.freeze({ PARALLEL: 180 * MINUTE_MS }),
  manualFallbackMaxAgeMs: 24 * HOUR_MS,
  manualFallbackMaxDeviationPct: '5',
}) as ValuationPolicy;

/**
 * `StalenessPolicy`: una tasa de provider con `t − asOf > umbral` está obsoleta; las manuales nunca. El umbral es el
 * del mercado del tipo (`PARALLEL_BUY`/`PARALLEL_SELL` usan el de `PARALLEL`) y, si la tasa viene del provider que
 * cumple el rol de RESPALDO de ese mercado, el umbral propio del respaldo (`FX_STALE_AFTER_FALLBACK`).
 */
export class StalenessPolicy {
  constructor(private readonly policy: ValuationPolicy = DEFAULT_VALUATION_POLICY) {}

  /** Umbral del tipo (el del provider principal y el que aplica a manuales de otro tipo); `null` = sin umbral. */
  staleAfterMs(type: FxRateType): number | null {
    return this.policy.staleAfterMs[marketOf(type)] ?? null;
  }

  /** Umbral aplicable a una tasa de provider concreta según el rol de su provider; `null` = nunca obsoleta. */
  thresholdFor(state: ExchangeRateState): number | null {
    if (state.source !== 'PROVIDER') return null;
    const market = marketOf(state.rateType);
    const roles = this.rolesFor(market);
    if (state.provider !== null && state.provider === roles.fallback && state.provider !== roles.primary) {
      const own = this.policy.fallbackStaleAfterMs?.[market];
      if (own !== undefined) return own;
    }
    return this.staleAfterMs(market);
  }

  isStale(state: ExchangeRateState, at: Instant): boolean {
    const limit = this.thresholdFor(state);
    return limit !== null && at.epochMillis - Date.parse(state.asOf) > limit;
  }

  rolesFor(type: FxRateType): ProviderRoles {
    return this.policy.roles[marketOf(type)] ?? { primary: null, fallback: null };
  }
}

/** Tasa elegida para valorar con su nivel de fallback (`ResolvedRate.selection` / `stale`). */
export interface ValuationChoice {
  readonly state: ExchangeRateState;
  readonly selection: RateSelection;
  readonly stale: boolean;
}

/** Contexto opcional de `select`: tipo pedido y manuales de OTRO tipo candidatas al nivel 3. */
export interface SelectOptions {
  /** Tipo pedido (explícito o preferido del par); `null` = sin tipo (cualquiera). */
  readonly requestedType?: FxRateType | null;
  /**
   * Tasas usables (no reemplazadas, sin anomalía pendiente/rechazada, dentro de la ventana) del par de OTROS tipos.
   * El selector solo admite manuales con `asOf ≤ t`, `t − asOf ≤ manualFallbackMaxAgeMs` y desvío respecto de
   * `providerReference` ≤ `manualFallbackMaxDeviationPct`; nunca de compra/venta y solo si el tipo pedido lo alimentan
   * providers (tiene umbral de obsolescencia) (docs/31 D34; design.md decisión 31).
   */
  readonly otherTypes?: readonly ExchangeRateState[];
  /** Última tasa de provider usable del par (cualquier orientación) y tipo pedido: referencia del desvío. */
  readonly providerReference?: ExchangeRateState | null;
}

/** Orden total "más reciente": vigencia, luego registro, luego id (determinista). */
export const newestState = (a: ExchangeRateState, b: ExchangeRateState): ExchangeRateState => {
  const ta = Date.parse(a.asOf);
  const tb = Date.parse(b.asOf);
  if (ta !== tb) return ta > tb ? a : b;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? a : b;
  return a.id > b.id ? a : b;
};

const latestOf = (states: readonly ExchangeRateState[]): ExchangeRateState | null =>
  states.reduce<ExchangeRateState | null>((acc, s) => (acc ? newestState(acc, s) : s), null);

/**
 * DS `ValuationRateSelector` (fx/market-rate-providers; design.md decisión 6), puro. Recibe las tasas ELEGIBLES de
 * un par en una orientación (no reemplazadas, sin anomalía pendiente o rechazada, `asOf ≤ t`, dentro de la ventana y
 * del tipo resuelto) y elige, en orden:
 *   1. la última del provider principal del tipo, si no está obsoleta → `PRIMARY`;
 *   2. la última del provider de respaldo, si no está obsoleta → `FALLBACK`;
 *   3. la más reciente entre la última de provider (obsoleta, `stale = true`) y la última manual → `LAST_KNOWN_STALE`
 *      o `MANUAL`; la manual puede ser de OTRO tipo del par solo si es fresca respecto del umbral del tipo pedido
 *      (`SelectOptions.otherTypes`; nunca compra/venta, nunca con `asOf > t`);
 *   4. ninguna → `null` (el llamador responde `FX_RATE_NOT_FOUND`; nunca inventa un valor).
 * Para tipos sin provider (P2P, BANK, CUSTOM) solo hay manuales: el resultado es el de `fx/market-rates` con
 * `selection = MANUAL`.
 */
export class ValuationRateSelector {
  private readonly staleness: StalenessPolicy;

  constructor(private readonly policy: ValuationPolicy = DEFAULT_VALUATION_POLICY) {
    this.staleness = new StalenessPolicy(policy);
  }

  /**
   * Referencia de una conversión real (design.md decisión 7): la más reciente, SIN niveles de fallback (el resolver
   * de `fx/market-rates` no cambia salvo la exclusión de anomalías); solo se etiqueta el nivel informativo.
   */
  newest(eligible: readonly ExchangeRateState[], at: Instant): ValuationChoice | null {
    const chosen = latestOf(eligible);
    if (!chosen) return null;
    if (chosen.source !== 'PROVIDER') return { state: chosen, selection: 'MANUAL', stale: false };
    const roles = this.staleness.rolesFor(chosen.rateType);
    const stale = this.staleness.isStale(chosen, at);
    if (!stale && roles.primary === chosen.provider) return { state: chosen, selection: 'PRIMARY', stale };
    if (!stale && roles.fallback === chosen.provider) return { state: chosen, selection: 'FALLBACK', stale };
    return { state: chosen, selection: 'LAST_KNOWN_STALE', stale };
  }

  /**
   * Manuales de otro tipo admisibles en el nivel 3 (docs/31 D34): manual, no de compra/venta, `0 ≤ t − asOf ≤`
   * antigüedad máxima y, si hay tasa de provider de referencia, `|m − p| / p × 100 ≤` desvío máximo (Decimal).
   */
  freshSubstitutes(options: SelectOptions, at: Instant): ExchangeRateState[] {
    const requested = options.requestedType ?? null;
    if (requested === null || this.staleness.staleAfterMs(requested) === null) return [];
    const maxAge = this.policy.manualFallbackMaxAgeMs ?? DEFAULT_MANUAL_FALLBACK_MAX_AGE_MS;
    const maxDeviation = dec(
      this.policy.manualFallbackMaxDeviationPct ?? DEFAULT_MANUAL_FALLBACK_MAX_DEVIATION_PCT,
    );
    const reference = options.providerReference ?? null;
    return (options.otherTypes ?? []).filter((s) => {
      const age = at.epochMillis - Date.parse(s.asOf);
      if (
        s.source === 'PROVIDER' ||
        s.rateType === requested ||
        isQuoteSideRateType(s.rateType) ||
        age < 0 ||
        age > maxAge
      )
        return false;
      if (!reference) return true;
      const p = reference.rate.oriented(s.rate.base).value;
      return s.rate.value.minus(p).abs().div(p).times(100).lte(maxDeviation);
    });
  }

  select(
    eligible: readonly ExchangeRateState[],
    at: Instant,
    options: SelectOptions = {},
  ): ValuationChoice | null {
    const fresh = (provider: FxRateProvider | null, tier: 'primary' | 'fallback') =>
      latestOf(
        eligible.filter(
          (s) =>
            s.source === 'PROVIDER' &&
            s.provider !== null &&
            s.provider === provider &&
            this.staleness.rolesFor(s.rateType)[tier] === s.provider,
        ),
      );
    for (const tier of ['primary', 'fallback'] as const) {
      // Con tipo resuelto todas comparten tipo; sin preferencia (cualquier tipo) cada tasa usa los roles del suyo.
      const providers = new Set(eligible.map((s) => this.staleness.rolesFor(s.rateType)[tier]));
      const candidates = [...providers]
        .filter((p): p is FxRateProvider => p !== null)
        .map((p) => fresh(p, tier))
        .filter((s): s is ExchangeRateState => s !== null && !this.staleness.isStale(s, at));
      const best = latestOf(candidates);
      if (best) return { state: best, selection: tier === 'primary' ? 'PRIMARY' : 'FALLBACK', stale: false };
    }
    const lastProvider = latestOf(eligible.filter((s) => s.source === 'PROVIDER'));
    const sameTypeManual = latestOf(eligible.filter((s) => s.source !== 'PROVIDER'));
    const substitute = latestOf(this.freshSubstitutes(options, at));
    // Más reciente gana; a igual vigencia, la del tipo pedido.
    const lastManual =
      sameTypeManual && substitute
        ? Date.parse(substitute.asOf) > Date.parse(sameTypeManual.asOf)
          ? substitute
          : sameTypeManual
        : (sameTypeManual ?? substitute);
    if (!lastProvider && !lastManual) return null;
    const chosen =
      lastProvider && lastManual ? newestState(lastProvider, lastManual) : (lastProvider ?? lastManual);
    if (!chosen) return null;
    if (chosen.source !== 'PROVIDER') return { state: chosen, selection: 'MANUAL', stale: false };
    return { state: chosen, selection: 'LAST_KNOWN_STALE', stale: this.staleness.isStale(chosen, at) };
  }
}
