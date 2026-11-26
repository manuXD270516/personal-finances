import { currency, DomainError, Instant, Rate, type Currency } from '@pf/shared-kernel';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ExchangeRate, type ExchangeRateState } from './exchange-rate.js';
import {
  DEFAULT_RATE_WINDOW_DAYS,
  FX_RATE_TYPES,
  isOneSidedRateType,
  type FxRateProvider,
  type FxRateType,
} from './fx-types.js';
import { defaultRateTypeFor, type AssetClass } from './rate-pairs.js';
import {
  isUsableCandidate,
  RateResolver,
  type RateCandidate,
  type ResolvedRate,
  type ResolveQuery,
} from './rate-resolver.js';
import {
  DEFAULT_VALUATION_POLICY,
  newestState,
  ValuationRateSelector,
  type ValuationChoice,
  type ValuationPolicy,
} from './valuation-rate-selector.js';

/*
 * TC-FX-RATE-009 (equivalencia) y TC-FX-RATE-010 (costo acotado) de `fix-trends-report-perf`.
 *
 * `OracleRateResolver` es la copia LITERAL de `RateResolver` de `main` 4cdc7689 (búsqueda lineal por cada solicitud):
 * se conserva solo aquí como regresión mientras el test exista. Lo único que cambia respecto del original son los
 * nombres (`Oracle…`) y que importa los tipos y `isUsableCandidate` de los módulos vigentes.
 */

const DAY_MS = 86_400_000;

interface OraclePick extends ValuationChoice {
  readonly inverse: boolean;
}

class OracleRateResolver {
  private readonly selector: ValuationRateSelector;

  constructor(
    private readonly candidates: readonly RateCandidate[],
    policy: ValuationPolicy = DEFAULT_VALUATION_POLICY,
  ) {
    this.selector = new ValuationRateSelector(policy);
  }

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

  resolveForConversion(query: Omit<ResolveQuery, 'allowCross' | 'pivot'>): ResolvedRate | null {
    return this.resolveWith({ ...query, allowCross: false }, 'newest');
  }

  tryResolve(query: ResolveQuery): ResolvedRate | null {
    return this.resolveWith(query, 'valuation');
  }

  private resolveWith(query: ResolveQuery, mode: 'valuation' | 'newest'): ResolvedRate | null {
    const { base, quote, at } = query;
    if (base.code === quote.code) {
      throw new DomainError('VALIDATION_FAILED', 'base and quote must differ').at('/quote');
    }
    const windowDays = query.windowDays ?? DEFAULT_RATE_WINDOW_DAYS;
    const classOf = query.assetClassOf ?? (() => null);
    const typeFor = (a: string, b: string): FxRateType =>
      query.rateType ?? query.preferenceOf?.(a, b) ?? defaultRateTypeFor(a, b, classOf);
    const requested = typeFor(base.code, quote.code);
    const direct = this.pick(base.code, quote.code, at, windowDays, requested, mode);
    if (direct) return this.single(direct, base, at, requested);
    if (!query.allowCross) return null;
    const configured = query.pivotOf?.(base.code) ?? null;
    const pivot =
      configured && configured.code !== quote.code && configured.code !== base.code
        ? configured
        : (query.pivot ?? null);
    if (!pivot || pivot.code === base.code || pivot.code === quote.code) return null;
    const first = this.pick(base.code, pivot.code, at, windowDays, typeFor(base.code, pivot.code), mode);
    const second = this.pick(pivot.code, quote.code, at, windowDays, typeFor(pivot.code, quote.code), mode);
    if (!first || !second) return null;
    const r1 = oracleOrient(first, base);
    const r2 = oracleOrient(second, pivot);
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
      ...oracleAge(at, older.asOf),
      approx: true,
      provider: older.provider,
      selection:
        Date.parse(first.state.asOf) <= Date.parse(second.state.asOf) ? first.selection : second.selection,
      stale: first.stale || second.stale,
    };
  }

  private single(p: OraclePick, base: Currency, at: Instant, requested: FxRateType | null): ResolvedRate {
    const s = p.state;
    return {
      rate: oracleOrient(p, base),
      derivation: p.inverse ? 'INVERSE' : 'DIRECT',
      fxRateId: s.id,
      components: p.inverse ? [s] : [],
      rateType: s.rateType,
      requestedRateType: requested,
      source: s.source,
      sourceLabel: s.sourceLabel,
      asOf: s.asOf,
      effectiveDate: s.effectiveDate,
      ...oracleAge(at, s.asOf),
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
  ): OraclePick | null {
    const to = at.epochMillis;
    const from = to - windowDays * DAY_MS;
    const usable = this.candidates
      .filter(isUsableCandidate)
      .map((c) => c.state)
      .filter((s) => {
        const t = Date.parse(s.asOf);
        return t <= to && t >= from;
      });
    const ofType = (s: ExchangeRateState) =>
      type === null ? !isOneSidedRateType(s.rateType) : s.rateType === type;
    const eligible = usable.filter(ofType);
    const others = type === null ? [] : usable.filter((s) => s.rateType !== type);
    const samePair = (s: ExchangeRateState) =>
      (s.rate.base.code === a && s.rate.quote.code === b) ||
      (s.rate.base.code === b && s.rate.quote.code === a);
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

function oracleOrient(p: OraclePick, base: Currency): Rate {
  return p.state.rate.oriented(base);
}

function oracleAge(at: Instant, asOf: string): { ageDays: number; ageSeconds: number } {
  const ms = Math.max(0, at.epochMillis - Date.parse(asOf));
  return { ageDays: Math.floor(ms / DAY_MS), ageSeconds: Math.floor(ms / 1000) };
}

// ───────────────────────────────────────────── datos generados

const BOB = currency('BOB', 2);
const USD = currency('USD', 2);
const USDT = currency('USDT', 6);
const BTC = currency('BTC', 8);
const CURRENCIES: readonly Currency[] = [BOB, USD, USDT, BTC];
const T0 = Date.parse('2026-03-01T00:00:00Z');
const HOUR_MS = 3_600_000;

const PROVIDERS: readonly (FxRateProvider | null)[] = [null, 'PARALELO_BO', 'DOLARAPI_BO'];

interface CandidateSpec {
  readonly base: number;
  readonly quote: number;
  readonly type: FxRateType;
  readonly source: 'MANUAL' | 'PROVIDER' | 'USER_CONVERSION';
  readonly provider: number;
  readonly value: string;
  /** Desplazamiento de `asOf` en horas desde T0 (rejilla gruesa: genera empates exactos de vigencia). */
  readonly hours: number;
  /** Milisegundos extra (0 casi siempre) y desfase horario del texto de `asOf`. */
  readonly extraMs: number;
  readonly offsetMinutes: number;
  readonly superseded: boolean;
  readonly anomaly: boolean;
  readonly decision: 'CONFIRMED' | 'REJECTED' | null;
  readonly institution: boolean;
}

// Pares frecuentes de producción (en ambas orientaciones) más alguno ajeno: solicitudes y candidatas coinciden a menudo.
const pairArb = fc.constantFrom<readonly [number, number]>(
  [1, 0],
  [1, 0],
  [0, 1],
  [2, 0],
  [2, 0],
  [0, 2],
  [3, 1],
  [3, 1],
  [1, 3],
  [3, 2],
  [2, 1],
  [3, 0],
);

const candidateArb: fc.Arbitrary<CandidateSpec> = fc
  .record({
    pair: pairArb,
    type: fc.constantFrom<FxRateType>(
      ...FX_RATE_TYPES,
      'PARALLEL',
      'PARALLEL',
      'PARALLEL',
      'OFFICIAL',
      'OFFICIAL',
      'MARKET',
    ),
    source: fc.constantFrom<'MANUAL' | 'PROVIDER' | 'USER_CONVERSION'>(
      'MANUAL',
      'MANUAL',
      'PROVIDER',
      'PROVIDER',
      'PROVIDER',
      'PROVIDER',
      'USER_CONVERSION',
    ),
    provider: fc.integer({ min: 0, max: 2 }),
    value: fc
      .integer({ min: 1, max: 99_999 })
      .map((n) => `${String(Math.floor(n / 100))}.${String(n % 100)}1`),
    hours: fc.integer({ min: 0, max: 24 * 8 }),
    extraMs: fc.constantFrom(0, 0, 0, 0, 7, 999),
    offsetMinutes: fc.constantFrom(0, 0, 0, -240, 330),
    superseded: fc.constantFrom(false, false, false, false, false, false, false, true),
    anomaly: fc.constantFrom(false, false, false, false, false, true),
    decision: fc.constantFrom<'CONFIRMED' | 'REJECTED' | null>(null, null, 'CONFIRMED', 'REJECTED'),
    institution: fc.boolean(),
  })
  .map(({ pair, ...rest }) => ({ base: pair[0], quote: pair[1], ...rest }));

let seq = 0;
function buildCandidate(spec: CandidateSpec): RateCandidate {
  seq += 1;
  const base = CURRENCIES[spec.base] as Currency;
  const quote = CURRENCIES[spec.quote] as Currency;
  const epoch = T0 + spec.hours * HOUR_MS + spec.extraMs;
  const asOf = new Date(epoch).toISOString();
  const recorded = ExchangeRate.record({
    id: `c${seq}`,
    workspaceId: 'ws',
    base,
    quote,
    value: spec.value,
    rateType: spec.type,
    sourceLabel: `fuente ${seq}`,
    asOf,
    effectiveDate: asOf.slice(0, 10),
    createdAt: asOf,
    createdBy: 'u',
  }).snapshot;
  // `asOf` con desfase horario distinto del UTC: mismo instante, otro texto (Date.parse lo interpreta igual).
  const sign = spec.offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(spec.offsetMinutes);
  const local = new Date(epoch + spec.offsetMinutes * 60_000).toISOString().replace('Z', '');
  const asOfText =
    spec.offsetMinutes === 0
      ? asOf
      : `${local}${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  const state: ExchangeRateState = {
    ...recorded,
    asOf: spec.extraMs === 0 ? asOfText : asOf,
    source: spec.source,
    provider: spec.source === 'PROVIDER' ? (PROVIDERS[spec.provider] ?? null) : null,
    anomaly: spec.anomaly ? { baselineRateId: 'b', variationPct: '12.5' } : null,
    institutionCode:
      spec.institution && (spec.type === 'BANK_BUY' || spec.type === 'BANK_SELL') ? 'BNB' : null,
  };
  return { state, supersededById: spec.superseded ? 'X' : null, anomalyDecision: spec.decision };
}

interface QuerySpec {
  readonly base: number;
  readonly quote: number;
  readonly hours: number;
  readonly windowDays: number | undefined;
  readonly rateType: FxRateType | null;
  readonly preference: 'NONE' | 'PARALLEL' | 'OFFICIAL' | 'BUY';
  readonly allowCross: boolean;
  readonly pivot: number | null;
  readonly pivotOf: boolean;
  readonly crypto: boolean;
}

const queryArb: fc.Arbitrary<QuerySpec> = fc
  .record({
    pair: pairArb,
    hours: fc.integer({ min: 0, max: 24 * 10 }),
    windowDays: fc.constantFrom<number | undefined>(undefined, 1, 2, 7, 7, 15, 30),
    rateType: fc.constantFrom<FxRateType | null>(
      null,
      null,
      null,
      null,
      null,
      'PARALLEL',
      'OFFICIAL',
      'MARKET',
      'BANK_BUY',
    ),
    preference: fc.constantFrom<'NONE' | 'PARALLEL' | 'OFFICIAL' | 'BUY'>(
      'NONE',
      'NONE',
      'NONE',
      'PARALLEL',
      'OFFICIAL',
      'BUY',
    ),
    allowCross: fc.boolean(),
    pivot: fc.constantFrom<number | null>(null, 1, 2, 0),
    pivotOf: fc.boolean(),
    crypto: fc.boolean(),
  })
  .map(({ pair, ...rest }) => ({ base: pair[0], quote: pair[1], ...rest }));

function buildQuery(spec: QuerySpec): ResolveQuery {
  const preferred: FxRateType | null =
    spec.preference === 'NONE'
      ? null
      : spec.preference === 'BUY'
        ? 'PARALLEL_BUY'
        : spec.preference === 'OFFICIAL'
          ? 'OFFICIAL'
          : 'PARALLEL';
  const classOf = (code: string): AssetClass | null =>
    code === 'BTC' ? 'VOLATILE_CRYPTO' : code === 'USDT' ? 'STABLE' : null;
  return {
    base: CURRENCIES[spec.base] as Currency,
    quote: CURRENCIES[spec.quote] as Currency,
    at: Instant.parse(new Date(T0 + spec.hours * HOUR_MS).toISOString()),
    ...(spec.windowDays !== undefined ? { windowDays: spec.windowDays } : {}),
    ...(spec.rateType !== null ? { rateType: spec.rateType } : {}),
    ...(preferred !== null ? { preferenceOf: () => preferred } : {}),
    allowCross: spec.allowCross,
    pivot: spec.pivot === null ? null : (CURRENCIES[spec.pivot] as Currency),
    ...(spec.pivotOf ? { pivotOf: (code: string) => (code === 'BTC' ? USDT : null) } : {}),
    ...(spec.crypto ? { assetClassOf: classOf } : {}),
  };
}

/** Forma comparable de un resultado (los `Decimal` como texto exacto; `components` por id). */
function shape(r: ResolvedRate | null): unknown {
  if (r === null) return null;
  return {
    rate: `${r.rate.base.code}/${r.rate.quote.code}=${r.rate.value.toFixed()}`,
    derivation: r.derivation,
    fxRateId: r.fxRateId,
    components: r.components.map((c) => c.id),
    rateType: r.rateType,
    requestedRateType: r.requestedRateType,
    source: r.source,
    sourceLabel: r.sourceLabel,
    asOf: r.asOf,
    effectiveDate: r.effectiveDate,
    ageDays: r.ageDays,
    ageSeconds: r.ageSeconds,
    approx: r.approx,
    provider: r.provider,
    selection: r.selection,
    stale: r.stale,
  };
}

function outcome(fn: () => ResolvedRate | null): unknown {
  try {
    return shape(fn());
  } catch (err) {
    return { error: err instanceof DomainError ? err.code : String(err) };
  }
}

const SEED = 20_261_123;

/** Cobertura del generador: el PBT no es vacuo si resuelve de verdad (directas, inversas, cruzadas y ausentes). */
const seen = { DIRECT: 0, INVERSE: 0, CROSS: 0, NONE: 0, STALE: 0 };
const tally = (r: ResolvedRate | null): void => {
  if (r === null) seen.NONE += 1;
  else {
    seen[r.derivation] += 1;
    if (r.stale) seen.STALE += 1;
  }
};

describe('RateResolver indexado: equivalencia con la búsqueda lineal anterior (TC-FX-RATE-009)', () => {
  it('[TC-FX-RATE-009] tryResolve, resolve y resolveForConversion devuelven lo mismo que el resolvedor anterior', () => {
    fc.assert(
      fc.property(
        fc.array(candidateArb, { minLength: 0, maxLength: 120, size: 'max' }),
        fc.array(queryArb, { minLength: 1, maxLength: 25, size: 'max' }),
        (specs, queries) => {
          const candidates = specs.map(buildCandidate);
          const oracle = new OracleRateResolver(candidates);
          const indexed = new RateResolver(candidates);
          for (const spec of queries) {
            const q = buildQuery(spec);
            expect(outcome(() => indexed.tryResolve(q))).toEqual(outcome(() => oracle.tryResolve(q)));
            tally(indexed.tryResolve(q));
            expect(outcome(() => indexed.resolve(q))).toEqual(outcome(() => oracle.resolve(q)));
            const { allowCross: _a, pivot: _p, ...conversion } = q;
            expect(outcome(() => indexed.resolveForConversion(conversion))).toEqual(
              outcome(() => oracle.resolveForConversion(conversion)),
            );
          }
        },
      ),
      { numRuns: 400, seed: SEED, endOnFailure: false },
    );
  }, 120_000);

  it('[TC-FX-RATE-009] con tasas cargadas para los bordes de la ventana y empates exactos de vigencia', () => {
    // Todas en la misma hora: los empates dependen del orden original de las candidatas.
    const dense = fc.array(
      candidateArb.map((c) => ({ ...c, hours: 0, extraMs: 0, offsetMinutes: 0 })),
      { minLength: 2, maxLength: 40, size: 'max' },
    );
    fc.assert(
      fc.property(
        dense,
        fc.array(queryArb, { minLength: 1, maxLength: 15, size: 'max' }),
        (specs, queries) => {
          const candidates = specs.map(buildCandidate);
          const oracle = new OracleRateResolver(candidates);
          const indexed = new RateResolver(candidates);
          for (const spec of queries) {
            // `at` exactamente en el borde de la ventana: T0 + w días (la tasa de T0 entra) y +1 ms (sale).
            const days = spec.windowDays ?? DEFAULT_RATE_WINDOW_DAYS;
            for (const delta of [0, 1, days * DAY_MS, days * DAY_MS + 1]) {
              const q = { ...buildQuery(spec), at: Instant.parse(new Date(T0 + delta).toISOString()) };
              expect(outcome(() => indexed.tryResolve(q))).toEqual(outcome(() => oracle.tryResolve(q)));
            }
          }
        },
      ),
      { numRuns: 300, seed: SEED + 1, endOnFailure: false },
    );
  }, 120_000);

  it('[TC-FX-RATE-009] el generador cubre directas, inversas, cruzadas, obsoletas y solicitudes sin tasa', () => {
    expect(seen.DIRECT).toBeGreaterThan(100);
    expect(seen.INVERSE).toBeGreaterThan(20);
    expect(seen.CROSS).toBeGreaterThan(20);
    expect(seen.STALE).toBeGreaterThan(20);
    expect(seen.NONE).toBeGreaterThan(100);
    console.info(`[TC-FX-RATE-009] cobertura: ${JSON.stringify(seen)}`);
  });

  it('[TC-FX-RATE-009] pedir la misma moneda sigue siendo VALIDATION_FAILED', () => {
    const q = { ...buildQuery(queryExample), base: USD, quote: USD };
    expect(outcome(() => new RateResolver([]).tryResolve(q))).toEqual(
      outcome(() => new OracleRateResolver([]).tryResolve(q)),
    );
    expect(outcome(() => new RateResolver([]).tryResolve(q))).toEqual({ error: 'VALIDATION_FAILED' });
  });
});

const queryExample: QuerySpec = {
  base: 1,
  quote: 0,
  hours: 0,
  windowDays: undefined,
  rateType: null,
  preference: 'NONE',
  allowCross: true,
  pivot: 1,
  pivotOf: false,
  crypto: false,
};

// ───────────────────────────────────────────── costo acotado (TC-FX-RATE-010)

/** Candidata con `asOf` contado: cada lectura del texto de vigencia incrementa el contador compartido. */
function counted(candidate: RateCandidate, counter: { reads: number }): RateCandidate {
  const state = new Proxy(candidate.state, {
    get(target, prop, receiver) {
      if (prop === 'asOf') counter.reads += 1;
      return Reflect.get(target, prop, receiver) as unknown;
    },
  });
  return { ...candidate, state };
}

describe('RateResolver: costo del lote acotado (TC-FX-RATE-010)', () => {
  const CANDIDATES = 10_000;
  const REQUESTS = 2_000;

  function production(): { candidates: RateCandidate[]; queries: ResolveQuery[] } {
    const day0 = Date.parse('2023-10-01T16:00:00Z');
    const candidates: RateCandidate[] = [];
    const sources: { base: Currency; quote: Currency; type: FxRateType; provider: FxRateProvider }[] = [];
    for (const provider of ['PARALELO_BO', 'DOLARAPI_BO'] as const) {
      for (const base of [USD, USDT]) {
        for (const type of ['PARALLEL', 'OFFICIAL'] as const) {
          sources.push({ base, quote: BOB, type, provider });
        }
      }
    }
    const template = (base: Currency, quote: Currency, type: FxRateType) =>
      ExchangeRate.record({
        id: 'tpl',
        workspaceId: 'ws',
        base,
        quote,
        value: '9.123456',
        rateType: type,
        asOf: '2023-10-01T16:00:00Z',
        effectiveDate: '2023-10-01',
        createdAt: '2023-10-01T16:00:00Z',
        createdBy: 'u',
      }).snapshot;
    let id = 0;
    for (let d = 0; d < 1_095; d += 1) {
      const asOf = new Date(day0 + d * DAY_MS).toISOString();
      for (const s of sources) {
        id += 1;
        candidates.push({
          state: {
            ...template(s.base, s.quote, s.type),
            id: `p${id}`,
            asOf,
            effectiveDate: asOf.slice(0, 10),
            source: 'PROVIDER',
            provider: s.provider,
          },
          supersededById: null,
        });
      }
      id += 1;
      candidates.push({
        state: {
          ...template(BTC, USD, 'PARALLEL'),
          id: `p${id}`,
          asOf,
          effectiveDate: asOf.slice(0, 10),
          source: 'PROVIDER',
          provider: 'PARALELO_BO',
        },
        supersededById: null,
      });
    }
    // Completa hasta 10 000 con tasas manuales de USD/BOB.
    while (candidates.length < CANDIDATES) {
      id += 1;
      const asOf = new Date(day0 + (id % 1_095) * DAY_MS + 3_600_000).toISOString();
      candidates.push({
        state: { ...template(USD, BOB, 'PARALLEL'), id: `m${id}`, asOf, effectiveDate: asOf.slice(0, 10) },
        supersededById: null,
      });
    }
    const queries: ResolveQuery[] = [];
    const bases = [USD, USDT, BTC];
    for (let i = 0; i < REQUESTS; i += 1) {
      const base = bases[i % 3] as Currency;
      const day = 30 + ((i * 7) % 1_000);
      queries.push({
        base,
        quote: BOB,
        at: Instant.parse(new Date(day0 + day * DAY_MS + 6 * HOUR_MS).toISOString()),
        allowCross: true,
        pivot: USD,
      });
    }
    return { candidates, queries };
  }

  it('[TC-FX-RATE-010] 2 000 solicitudes contra 10 000 candidatas leen asOf a lo sumo 2 x candidatas + 200 x solicitudes', () => {
    const { candidates, queries } = production();
    expect(candidates).toHaveLength(CANDIDATES);
    const counter = { reads: 0 };
    const wrapped = candidates.map((c) => counted(c, counter));
    const resolver = new RateResolver(wrapped);
    const results = queries.map((q) => resolver.tryResolve(q));
    expect(counter.reads).toBeLessThanOrEqual(2 * CANDIDATES + 200 * REQUESTS);
    console.info(`[TC-FX-RATE-010] lecturas de asOf: ${counter.reads}`);
    // Algo se resolvió (el escenario no es vacío) y coincide con el oráculo en una muestra.
    expect(results.filter((r) => r !== null).length).toBeGreaterThan(1_500);
    const oracle = new OracleRateResolver(candidates);
    for (let i = 0; i < queries.length; i += 40) {
      const q = queries[i] as ResolveQuery;
      expect(shape(results[i] ?? null)).toEqual(shape(oracle.tryResolve(q)));
    }
  }, 300_000);
});
