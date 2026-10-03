import { DomainError, type Instant, Rate, type Currency } from '@pf/shared-kernel';
import type { ExchangeRateState } from './exchange-rate.js';
import { DEFAULT_RATE_WINDOW_DAYS, type FxRateSource, type FxRateType } from './fx-types.js';

const DAY_MS = 86_400_000;

/** Tasa candidata con su estado de reemplazo (`supersededById` = versión que la reemplazó, si existe). */
export interface RateCandidate {
  readonly state: ExchangeRateState;
  readonly supersededById: string | null;
}

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
  readonly source: FxRateSource;
  readonly sourceLabel: string | null;
  readonly asOf: string;
  readonly effectiveDate: string;
  readonly ageDays: number;
  readonly ageSeconds: number;
  /** `true` para tasas cruzadas (FR-FX-005). */
  readonly approx: boolean;
}

export interface ResolveQuery {
  readonly base: Currency;
  readonly quote: Currency;
  readonly at: Instant;
  /** Tipo pedido explícitamente; si falta se usa el preferido del par y, sin preferencia, cualquier tipo. */
  readonly rateType?: FxRateType | null;
  /** Tipo preferido de un par (en cualquier orientación); `null` = sin preferencia (FR-FX-006). */
  readonly preferenceOf?: (a: string, b: string) => FxRateType | null;
  readonly windowDays?: number;
  /** Solo valoración (FR-FX-005); nunca para la referencia de una conversión real. */
  readonly allowCross?: boolean;
  readonly pivot?: Currency | null;
}

interface Pick {
  readonly state: ExchangeRateState;
  readonly inverse: boolean;
}

const newest = (a: ExchangeRateState, b: ExchangeRateState): ExchangeRateState => {
  const ta = Date.parse(a.asOf);
  const tb = Date.parse(b.asOf);
  if (ta !== tb) return ta > tb ? a : b;
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt ? a : b;
  return a.id > b.id ? a : b;
};

/**
 * DS `RateResolver` (FR-FX-004/005/006; design.md decisión 4), puro: la tasa vigente de un par a un instante es la
 * tasa NO reemplazada más reciente con `asOf ≤ instante` y dentro de la ventana (7 días por defecto), del tipo pedido
 * o del preferido del par (sin preferencia: cualquier tipo, informando cuál). Orden: directa → inversa (derivada de
 * la original a precisión 40, INV-032) → cruzada por pivote solo si `allowCross`. Nunca inventa un valor ni usa 1:1.
 */
export class RateResolver {
  constructor(private readonly candidates: readonly RateCandidate[]) {}

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
    return this.tryResolve({ ...query, allowCross: false });
  }

  tryResolve(query: ResolveQuery): ResolvedRate | null {
    const { base, quote, at } = query;
    if (base.code === quote.code) {
      throw new DomainError('VALIDATION_FAILED', 'base and quote must differ').at('/quote');
    }
    const windowDays = query.windowDays ?? DEFAULT_RATE_WINDOW_DAYS;
    const typeFor = (a: string, b: string) => query.rateType ?? query.preferenceOf?.(a, b) ?? null;
    const direct = this.pick(base.code, quote.code, at, windowDays, typeFor(base.code, quote.code));
    if (direct) return this.single(direct, base, at);
    if (!query.allowCross) return null;
    const pivot = query.pivot;
    if (!pivot || pivot.code === base.code || pivot.code === quote.code) return null;
    const first = this.pick(base.code, pivot.code, at, windowDays, typeFor(base.code, pivot.code));
    const second = this.pick(pivot.code, quote.code, at, windowDays, typeFor(pivot.code, quote.code));
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
      source: older.source,
      sourceLabel: null,
      asOf: older.asOf,
      effectiveDate: older.effectiveDate,
      ...age(at, older.asOf),
      approx: true,
    };
  }

  private single(p: Pick, base: Currency, at: Instant): ResolvedRate {
    const s = p.state;
    return {
      rate: orient(p, base),
      derivation: p.inverse ? 'INVERSE' : 'DIRECT',
      fxRateId: s.id,
      components: p.inverse ? [s] : [],
      rateType: s.rateType,
      source: s.source,
      sourceLabel: s.sourceLabel,
      asOf: s.asOf,
      effectiveDate: s.effectiveDate,
      ...age(at, s.asOf),
      approx: false,
    };
  }

  private pick(a: string, b: string, at: Instant, windowDays: number, type: FxRateType | null): Pick | null {
    const to = at.epochMillis;
    const from = to - windowDays * DAY_MS;
    const eligible = this.candidates
      .filter((c) => c.supersededById === null)
      .map((c) => c.state)
      .filter((s) => {
        const t = Date.parse(s.asOf);
        return t <= to && t >= from && (type === null || s.rateType === type);
      });
    const latest = (base: string, quote: string) =>
      eligible
        .filter((s) => s.rate.base.code === base && s.rate.quote.code === quote)
        .reduce<ExchangeRateState | null>((acc, s) => (acc ? newest(acc, s) : s), null);
    const direct = latest(a, b);
    if (direct) return { state: direct, inverse: false };
    const inverse = latest(b, a);
    return inverse ? { state: inverse, inverse: true } : null;
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
