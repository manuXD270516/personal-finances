import type { Instant } from '@pf/shared-kernel';
import type { ExchangeRateState } from './exchange-rate.js';
import type { FxRateProvider, FxRateType, RateSelection } from './fx-types.js';

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
}

/** Defaults de design.md decisión 5: paralelo.bo principal, bo.dolarapi.com respaldo y oficial; 60 min / 48 h. */
export const DEFAULT_VALUATION_POLICY: ValuationPolicy = Object.freeze({
  roles: Object.freeze({
    PARALLEL: Object.freeze({ primary: 'PARALELO_BO', fallback: 'DOLARAPI_BO' }),
    OFFICIAL: Object.freeze({ primary: 'DOLARAPI_BO', fallback: null }),
  }),
  staleAfterMs: Object.freeze({ PARALLEL: 60 * MINUTE_MS, OFFICIAL: 48 * HOUR_MS }),
}) as ValuationPolicy;

/** `StalenessPolicy`: una tasa de provider con `t − asOf > staleAfter(tipo)` está obsoleta. Las manuales nunca. */
export class StalenessPolicy {
  constructor(private readonly policy: ValuationPolicy = DEFAULT_VALUATION_POLICY) {}

  staleAfterMs(type: FxRateType): number | null {
    return this.policy.staleAfterMs[type] ?? null;
  }

  isStale(state: ExchangeRateState, at: Instant): boolean {
    if (state.source !== 'PROVIDER') return false;
    const limit = this.staleAfterMs(state.rateType);
    return limit !== null && at.epochMillis - Date.parse(state.asOf) > limit;
  }

  rolesFor(type: FxRateType): ProviderRoles {
    return this.policy.roles[type] ?? { primary: null, fallback: null };
  }
}

/** Tasa elegida para valorar con su nivel de fallback (`ResolvedRate.selection` / `stale`). */
export interface ValuationChoice {
  readonly state: ExchangeRateState;
  readonly selection: RateSelection;
  readonly stale: boolean;
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
 *   3. la más reciente entre la última de provider (obsoleta, `stale = true`) y la última manual →
 *      `LAST_KNOWN_STALE` o `MANUAL`;
 *   4. ninguna → `null` (el llamador responde `FX_RATE_NOT_FOUND`; nunca inventa un valor).
 * Para tipos sin provider (P2P, BANK, CUSTOM) solo hay manuales: el resultado es el de `fx/market-rates` con
 * `selection = MANUAL`.
 */
export class ValuationRateSelector {
  private readonly staleness: StalenessPolicy;

  constructor(policy: ValuationPolicy = DEFAULT_VALUATION_POLICY) {
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

  select(eligible: readonly ExchangeRateState[], at: Instant): ValuationChoice | null {
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
    const lastManual = latestOf(eligible.filter((s) => s.source !== 'PROVIDER'));
    if (!lastProvider && !lastManual) return null;
    const chosen =
      lastProvider && lastManual ? newestState(lastProvider, lastManual) : (lastProvider ?? lastManual);
    if (!chosen) return null;
    if (chosen.source !== 'PROVIDER') return { state: chosen, selection: 'MANUAL', stale: false };
    return { state: chosen, selection: 'LAST_KNOWN_STALE', stale: this.staleness.isStale(chosen, at) };
  }
}
