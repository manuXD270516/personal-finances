import { DomainError, type Instant, Rate, type Currency } from '@pf/shared-kernel';
import type { ExchangeRateState } from './exchange-rate.js';
import {
  DEFAULT_RATE_TYPE,
  DEFAULT_RATE_WINDOW_DAYS,
  isQuoteSideRateType,
  type FxRateProvider,
  type FxRateSource,
  type FxRateType,
  type RateSelection,
} from './fx-types.js';
import {
  DEFAULT_VALUATION_POLICY,
  newestState,
  ValuationRateSelector,
  type ValuationChoice,
  type ValuationPolicy,
} from './valuation-rate-selector.js';

const DAY_MS = 86_400_000;

/** Tasa candidata con su estado de reemplazo (`supersededById` = versión que la reemplazó, si existe). */
export interface RateCandidate {
  readonly state: ExchangeRateState;
  readonly supersededById: string | null;
  /** Decisión sobre una tasa marcada como anómala (`null`/ausente = sin revisar). */
  readonly anomalyDecision?: 'CONFIRMED' | 'REJECTED' | null;
}

/**
 * ¿Puede usarse para valorar o como referencia? No reemplazada y, si es anómala, confirmada (una anomalía pendiente
 * o rechazada nunca se usa; fx/market-rate-providers).
 */
export const isUsableCandidate = (c: RateCandidate): boolean =>
  c.supersededById === null && (c.state.anomaly === null || c.anomalyDecision === 'CONFIRMED');

export type RateDerivation = 'DIRECT' | 'INVERSE' | 'CROSS';

/** Resultado de `RateResolver` (`ResolvedRate` del contrato). `rate` está en la orientación pedida (base → quote). */
export interface ResolvedRate {
  readonly rate: Rate;
  readonly derivation: RateDerivation;
  /** Versión exacta usada; `null` en tasas cruzadas (no son una tasa almacenada). */
  readonly fxRateId: string | null;
  /** Tasas almacenadas usadas (la original de una inversa; las dos componentes de una cruzada). */
  readonly components: readonly ExchangeRateState[];
  readonly rateType: FxRateType;
  /**
   * Tipo pedido (explícito, preferido del par o `DEFAULT_RATE_TYPE` sin preferencia, D48). Si difiere de `rateType`, la valoración usó una
   * tasa manual fresca de otro tipo en el nivel de manuales (decisión del owner 2026-10-03).
   */
  readonly requestedRateType: FxRateType | null;
  readonly source: FxRateSource;
  readonly sourceLabel: string | null;
  readonly asOf: string;
  readonly effectiveDate: string;
  readonly ageDays: number;
  readonly ageSeconds: number;
  /** `true` para tasas cruzadas (FR-FX-005). */
  readonly approx: boolean;
  /** Provider de la tasa usada (de la más antigua en una cruzada); `null` si es manual. */
  readonly provider: FxRateProvider | null;
  /** Nivel de fallback (fx/market-rate-providers). */
  readonly selection: RateSelection;
  /** `true` si se usa una tasa de provider obsoleta como última conocida (en una cruzada: alguna componente). */
  readonly stale: boolean;
}

export interface ResolveQuery {
  readonly base: Currency;
  readonly quote: Currency;
  readonly at: Instant;
  /**
   * Tipo pedido explícitamente; si falta se usa el preferido del par y, sin preferencia, `DEFAULT_RATE_TYPE`
   * (`PARALLEL`, docs/31 D48).
   */
  readonly rateType?: FxRateType | null;
  /** Tipo preferido de un par (en cualquier orientación); `null` = sin preferencia (FR-FX-006). */
  readonly preferenceOf?: (a: string, b: string) => FxRateType | null;
  readonly windowDays?: number;
  /** Solo valoración (FR-FX-005); nunca para la referencia de una conversión real. */
  readonly allowCross?: boolean;
  readonly pivot?: Currency | null;
}

interface Pick extends ValuationChoice {
  readonly inverse: boolean;
}

/**
 * DS `RateResolver` (FR-FX-004/005/006; design.md decisión 4), puro: la tasa vigente de un par a un instante es la
 * tasa NO reemplazada más reciente con `asOf ≤ instante` y dentro de la ventana (7 días por defecto), del tipo pedido
 * o del preferido del par (sin preferencia: `PARALLEL`, docs/31 D48; informando el tipo usado). Orden: directa → inversa (derivada de
 * la original a precisión 40, INV-032) → cruzada por pivote solo si `allowCross`. Nunca inventa un valor ni usa 1:1.
 */
export class RateResolver {
  private readonly selector: ValuationRateSelector;

  /**
   * `policy`: roles de providers y obsolescencia (fx/market-rate-providers). Dentro de cada orientación la tasa se
   * elige con `ValuationRateSelector` (principal → respaldo → última conocida obsoleta o manual más reciente).
   */
  constructor(
    private readonly candidates: readonly RateCandidate[],
    policy: ValuationPolicy = DEFAULT_VALUATION_POLICY,
  ) {
    this.selector = new ValuationRateSelector(policy);
  }

  /** Resolución para valoración/consulta: lanza `FX_RATE_NOT_FOUND` si no hay tasa. */
  resolve(query: ResolveQuery): ResolvedRate {
    const found = this.tryResolve(query);
    if (!found) {
      throw new DomainError(
        'FX_RATE_NOT_FOUND',
        `no ${query.base.code}/${query.quote.code} rate at or before ${query.at.toString()} within ${
          query.windowDays ?? DEFAULT_RATE_WINDOW_DAYS
        } days`,
      );
    }
    return found;
  }

  /** Referencia de una conversión real: solo directa o inversa, nunca cruzada (INV-032, docs/04 §3.10). */
  resolveForConversion(query: Omit<ResolveQuery, 'allowCross' | 'pivot'>): ResolvedRate | null {
    return this.resolveWith({ ...query, allowCross: false }, 'newest');
  }

  tryResolve(query: ResolveQuery): ResolvedRate | null {
    return this.resolveWith(query, 'valuation');
  }

  /** `valuation`: niveles de fallback (fx/market-rate-providers); `newest`: la más reciente (referencias). */
  private resolveWith(query: ResolveQuery, mode: 'valuation' | 'newest'): ResolvedRate | null {
    const { base, quote, at } = query;
    if (base.code === quote.code) {
      throw new DomainError('VALIDATION_FAILED', 'base and quote must differ').at('/quote');
    }
    const windowDays = query.windowDays ?? DEFAULT_RATE_WINDOW_DAYS;
    // Tipo pedido > preferencia del par > PARALLEL (docs/31 D48: el default de los pares BOB para todo par).
    const typeFor = (a: string, b: string): FxRateType =>
      query.rateType ?? query.preferenceOf?.(a, b) ?? DEFAULT_RATE_TYPE;
    const requested = typeFor(base.code, quote.code);
    const direct = this.pick(base.code, quote.code, at, windowDays, requested, mode);
    if (direct) return this.single(direct, base, at, requested);
    if (!query.allowCross) return null;
    const pivot = query.pivot;
    if (!pivot || pivot.code === base.code || pivot.code === quote.code) return null;
    const first = this.pick(base.code, pivot.code, at, windowDays, typeFor(base.code, pivot.code), mode);
    const second = this.pick(pivot.code, quote.code, at, windowDays, typeFor(pivot.code, quote.code), mode);
    if (!first || !second) return null;
    const r1 = orient(first, base);
    const r2 = orient(second, pivot);
    const older = Date.parse(first.state.asOf) <= Date.parse(second.state.asOf) ? first.state : second.state;
    return {
      rate: Rate.derived(base, quote, r1.value.times(r2.value)),
      derivation: 'CROSS',
      fxRateId: null,
      components: [first.state, second.state],
      rateType: older.rateType,
      requestedRateType: requested,
      source: older.source,
      sourceLabel: null,
      asOf: older.asOf,
      effectiveDate: older.effectiveDate,
      ...age(at, older.asOf),
      approx: true,
      provider: older.provider,
      selection:
        Date.parse(first.state.asOf) <= Date.parse(second.state.asOf) ? first.selection : second.selection,
      stale: first.stale || second.stale,
    };
  }

  private single(p: Pick, base: Currency, at: Instant, requested: FxRateType | null): ResolvedRate {
    const s = p.state;
    return {
      rate: orient(p, base),
      derivation: p.inverse ? 'INVERSE' : 'DIRECT',
      fxRateId: s.id,
      components: p.inverse ? [s] : [],
      rateType: s.rateType,
      requestedRateType: requested,
      source: s.source,
      sourceLabel: s.sourceLabel,
      asOf: s.asOf,
      effectiveDate: s.effectiveDate,
      ...age(at, s.asOf),
      approx: false,
      provider: s.provider,
      selection: p.selection,
      stale: p.stale,
    };
  }

  private pick(
    a: string,
    b: string,
    at: Instant,
    windowDays: number,
    type: FxRateType | null,
    mode: 'valuation' | 'newest',
  ): Pick | null {
    const to = at.epochMillis;
    const from = to - windowDays * DAY_MS;
    const usable = this.candidates
      .filter(isUsableCandidate)
      .map((c) => c.state)
      .filter((s) => {
        const t = Date.parse(s.asOf);
        return t <= to && t >= from;
      });
    // Compra/venta solo si se piden explícitamente (sin tipo nunca entran; design.md decisión 29).
    const ofType = (s: ExchangeRateState) =>
      type === null ? !isQuoteSideRateType(s.rateType) : s.rateType === type;
    const eligible = usable.filter(ofType);
    const others = type === null ? [] : usable.filter((s) => s.rateType !== type);
    const samePair = (s: ExchangeRateState) =>
      (s.rate.base.code === a && s.rate.quote.code === b) ||
      (s.rate.base.code === b && s.rate.quote.code === a);
    // Referencia del desvío de una manual de otro tipo: la última tasa de provider usable del par y tipo pedido.
    const providerReference = eligible
      .filter((s) => s.source === 'PROVIDER' && samePair(s))
      .reduce<ExchangeRateState | null>((acc, s) => (acc ? newestState(acc, s) : s), null);
    const choose = (base: string, quote: string) => {
      const inPair = (s: ExchangeRateState) => s.rate.base.code === base && s.rate.quote.code === quote;
      const pair = eligible.filter(inPair);
      return mode === 'newest'
        ? this.selector.newest(pair, at)
        : this.selector.select(pair, at, {
            requestedType: type,
            otherTypes: others.filter(inPair),
            providerReference,
          });
    };
    const direct = choose(a, b);
    if (direct) return { ...direct, inverse: false };
    const inverse = choose(b, a);
    return inverse ? { ...inverse, inverse: true } : null;
  }
}

/** La tasa almacenada en la orientación pedida: la original o su inversa VINCULADA (nunca una inversa redondeada). */
function orient(p: Pick, base: Currency): Rate {
  return p.state.rate.oriented(base);
}

function age(at: Instant, asOf: string): { ageDays: number; ageSeconds: number } {
  const ms = Math.max(0, at.epochMillis - Date.parse(asOf));
  return { ageDays: Math.floor(ms / DAY_MS), ageSeconds: Math.floor(ms / 1000) };
}
