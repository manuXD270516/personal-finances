import { DomainError, Instant, Money, Rate, type Currency } from '@pf/shared-kernel';
import type {
  ConversionCostDto,
  CurrencyInfoDto,
  FxConversionPricingPort,
  MoneyDto,
  RatePairDto,
  RatePairsQuery,
  ReferenceRateDto,
} from '../contracts/index.js';
import {
  anomalyThresholdFor,
  type AssetClassPolicy,
  DEFAULT_ANOMALY_THRESHOLDS,
  DEFAULT_PIVOT_CURRENCY,
  DEFAULT_RATE_WINDOW_DAYS,
  RateResolver,
  totalCost,
  type AssetClass,
  type CurrencyDefinition,
  type CurrencyKind,
  type FxRateType,
  type ResolvedRate,
} from '../domain/index.js';
import type { CurrencyRow, FxDeps, RateListFilter, RatePreferenceSet, StoredRate } from './ports/index.js';
import { RatePairResolver, type EffectiveRatePairs } from './rate-pairs.js';

const DAY_MS = 86_400_000;

export const notFound = (id: string) => new DomainError('RESOURCE_NOT_FOUND', `fx rate ${id} not found`);

const sameUnorderedPair = (a1: string, b1: string, a2: string, b2: string) =>
  (a1 === a2 && b1 === b2) || (a1 === b2 && b1 === a2);

/** Referencia registrada de una versión exacta (fx/conversion-pricing). */
export function toReferenceDto(stored: StoredRate): ReferenceRateDto {
  const s = stored.rate.snapshot;
  return {
    fxRateId: s.id,
    rate: { base: s.rate.base.code, quote: s.rate.quote.code, value: stored.rate.valueText },
    rateType: s.rateType,
    source: s.source,
    sourceLabel: s.sourceLabel,
    asOf: s.asOf,
  };
}

/**
 * Consultas de FX (sin efectos) y el puerto `FxConversionPricingPort` que consume TRANSACTIONS: catálogo, tasas,
 * resolución *as-of* (`RateResolver`), valoración (`ConvertForValuation`) y costo total de una conversión.
 */
export class FxQueries implements FxConversionPricingPort, RatePairsQuery {
  private readonly pairResolver: RatePairResolver;
  private readonly assetClasses: AssetClassPolicy;

  constructor(private readonly deps: FxDeps) {
    this.pairResolver = new RatePairResolver(deps);
    this.assetClasses = this.pairResolver.policy;
  }

  /**
   * Ventana de vigencia (días) de la resolución *as-of*. El valor es un ajuste de REPORTING (docs/31 D53,
   * `REPORTING_RATE_VALIDITY_WINDOW`) que la composición inyecta en `FxDeps.windowDays`; FX solo lo aplica.
   */
  get windowDays(): number {
    return this.deps.windowDays ?? DEFAULT_RATE_WINDOW_DAYS;
  }

  /** Umbral de anomalía de fiat y estables (`FX_ANOMALY_THRESHOLD_PCT`), para `FxRate.anomaly.thresholdPct`. */
  get anomalyThresholdPct(): string {
    return (this.deps.anomalyThresholds ?? DEFAULT_ANOMALY_THRESHOLDS).fiatStablePct;
  }

  /**
   * Umbral de anomalía que aplica a la moneda base de cada tasa (5 % fiat y estables, 10 % cripto volátil; D228) para
   * informar `FxRate.anomaly.thresholdPct`: una lectura del catálogo y una función por código.
   */
  anomalyThresholdResolver(workspaceId: string): Promise<(baseCurrency: string) => string> {
    return this.deps.uow.run(workspaceId, async () => {
      const thresholds = this.deps.anomalyThresholds ?? DEFAULT_ANOMALY_THRESHOLDS;
      const kinds = new Map(
        (await this.deps.currencies.list(workspaceId, {})).map(
          (r) => [r.definition.code, r.definition.kind] as const,
        ),
      );
      return (code: string) =>
        anomalyThresholdFor(thresholds, this.assetClasses.classOf({ code, kind: kinds.get(code) ?? 'FIAT' }));
    });
  }

  /** Lista efectiva de pares de tasa automáticos del workspace (la fijada o la derivada de sus monedas). */
  effectiveRatePairs(workspaceId: string): Promise<EffectiveRatePairs> {
    return this.deps.uow.run(workspaceId, () => this.pairResolver.effective(workspaceId));
  }

  /** `RatePairsQuery` (`@pf/fx/contracts`): pares configurados con su clase de activo. */
  async listRatePairs(workspaceId: string): Promise<readonly RatePairDto[]> {
    const effective = await this.effectiveRatePairs(workspaceId);
    return effective.pairs.map((p) => ({ base: p.base, quote: p.quote, assetClass: p.assetClass }));
  }

  /**
   * Contexto de valoración de un workspace: pivote por moneda a partir de su lista de pares (la quote del par de la
   * moneda, USDT para BTC/USDT) y clase de activo por código (default `MARKET` de los pares cripto). Dentro de la
   * unidad de trabajo del llamador.
   */
  private async valuationContext(
    workspaceId: string,
    definitions: Map<string, CurrencyDefinition | null>,
  ): Promise<{
    readonly pivotOf: (code: string) => Currency | null;
    readonly assetClassOf: (code: string) => AssetClass | null;
  }> {
    const effective = await this.pairResolver.effective(workspaceId);
    const quoteOf = new Map(effective.pairs.map((p) => [p.base, p.quote] as const));
    // Las monedas de los pares configurados entran al mapa (sus definiciones dan la clase y la escala del pivote).
    for (const p of effective.pairs) {
      for (const code of [p.base, p.quote]) {
        if (!definitions.has(code)) definitions.set(code, await this.deps.currencies.find(code));
      }
    }
    return {
      pivotOf: (code) => {
        const quote = quoteOf.get(code);
        return quote ? (definitions.get(quote)?.toCurrency() ?? null) : null;
      },
      assetClassOf: (code) => {
        const def = definitions.get(code);
        return def ? this.assetClasses.classOf({ code: def.code, kind: def.kind }) : null;
      },
    };
  }

  listCurrencies(
    workspaceId: string,
    filter: { readonly kind?: CurrencyKind; readonly enabled?: boolean; readonly q?: string },
  ): Promise<CurrencyRow[]> {
    return this.deps.uow.run(workspaceId, async () => {
      const rows = await this.deps.currencies.list(workspaceId, filter.kind ? { kind: filter.kind } : {});
      const q = filter.q?.trim().toLowerCase();
      return rows.filter(
        (r) =>
          (filter.enabled === undefined || r.enabled === filter.enabled) &&
          (!q ||
            r.definition.code.toLowerCase().includes(q) ||
            r.definition.snapshot.name.toLowerCase().includes(q)),
      );
    });
  }

  getRate(workspaceId: string, id: string): Promise<StoredRate> {
    return this.deps.uow.run(workspaceId, async () => {
      const found = await this.deps.rates.findById(workspaceId, id);
      if (!found) throw notFound(id);
      return found;
    });
  }

  listRates(
    workspaceId: string,
    filter: RateListFilter,
    page: { readonly offset: number; readonly limit: number },
  ): Promise<StoredRate[]> {
    return this.deps.uow.run(workspaceId, () => this.deps.rates.list(workspaceId, filter, page));
  }

  listPreferences(workspaceId: string): Promise<RatePreferenceSet> {
    return this.deps.uow.run(workspaceId, () => this.deps.preferences.get(workspaceId));
  }

  /** `GetRate` *as-of* (`GET fx-rates/latest`): directa → inversa → cruzada solo con `allowCross`. */
  latest(input: {
    readonly workspaceId: string;
    readonly base: string;
    readonly quote: string;
    readonly asOf?: string;
    readonly rateType?: FxRateType | null;
    readonly allowCross?: boolean;
  }): Promise<ResolvedRate> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const base = await this.requireCurrency(input.base, '/base');
      const quote = await this.requireCurrency(input.quote, '/quote');
      const at = input.asOf ? Instant.parse(input.asOf) : this.deps.clock.now();
      const pivot = input.allowCross ? await this.deps.currencies.find(DEFAULT_PIVOT_CURRENCY) : null;
      const definitions = new Map<string, CurrencyDefinition | null>();
      for (const code of [base.code, quote.code, ...(pivot ? [pivot.code] : [])]) {
        definitions.set(code, await this.deps.currencies.find(code));
      }
      const context = await this.valuationContext(input.workspaceId, definitions);
      // Las componentes de una cruzada usan el pivote del par configurado (USDT para BTC/USDT).
      const pivots = new Set<string>();
      if (input.allowCross) {
        const configured = context.pivotOf(base.code);
        if (configured) pivots.add(configured.code);
      }
      const { resolver, preferenceOf } = await this.resolverFor(
        input.workspaceId,
        [base.code, quote.code, ...(pivot ? [pivot.code] : []), ...pivots],
        at,
      );
      return resolver.resolve({
        base,
        quote,
        at,
        rateType: input.rateType ?? null,
        preferenceOf,
        windowDays: this.windowDays,
        allowCross: input.allowCross ?? false,
        pivot: pivot?.toCurrency() ?? null,
        pivotOf: context.pivotOf,
        assetClassOf: context.assetClassOf,
      });
    });
  }

  /**
   * `ConvertForValuation` (FR-FX-006): valora un monto en otra moneda con el tipo preferido del par (o el pedido),
   * usando la tasa original y UNA cuantización HALF_EVEN; admite tasa cruzada (valoración, nunca conversión real).
   */
  convertForValuation(input: {
    readonly workspaceId: string;
    readonly amount: MoneyDto;
    readonly to: string;
    readonly asOf?: string;
    readonly rateType?: FxRateType | null;
  }): Promise<{ readonly amount: Money; readonly resolved: ResolvedRate | null }> {
    return this.deps.uow.run(input.workspaceId, async () => {
      const from = await this.requireCurrency(input.amount.currency, '/amount/currency');
      const amount = Money.parse(input.amount.amount, from);
      if (input.amount.currency === input.to) return { amount, resolved: null };
      const resolved = await this.latest({
        workspaceId: input.workspaceId,
        base: input.amount.currency,
        quote: input.to,
        ...(input.asOf ? { asOf: input.asOf } : {}),
        rateType: input.rateType ?? null,
        allowCross: true,
      });
      return { amount: resolved.rate.convert(amount), resolved };
    });
  }

  /**
   * Valoración por lote (add-basic-dashboard): resuelve cada `(base, quote, at)` con UNA sola lectura de candidatas
   * (ventana desde el instante más antiguo hasta el más reciente) y la misma política que `latest`/`convertForValuation`
   * (tipo preferido del par, niveles de fallback, cruzada por pivote marcada `approx`). `null` = sin tasa.
   */
  resolveValuationRates(
    workspaceId: string,
    requests: readonly { readonly base: string; readonly quote: string; readonly at: Instant }[],
    windowDaysOverride?: number,
  ): Promise<(ResolvedRate | null)[]> {
    const windowDays = windowDaysOverride ?? this.windowDays;
    if (!Number.isInteger(windowDays) || windowDays < 1) {
      return Promise.reject(
        new DomainError('VALIDATION_FAILED', 'windowDays must be a positive integer').at('/windowDays'),
      );
    }
    return this.deps.uow.run(workspaceId, async () => {
      if (requests.length === 0) return [];
      const definitions = new Map<string, CurrencyDefinition | null>();
      const currencyOf = async (code: string) => {
        if (!definitions.has(code)) definitions.set(code, await this.deps.currencies.find(code));
        return definitions.get(code)?.toCurrency() ?? null;
      };
      const pivot = await currencyOf(DEFAULT_PIVOT_CURRENCY);
      for (const r of requests) {
        await currencyOf(r.base);
        await currencyOf(r.quote);
      }
      const context = await this.valuationContext(workspaceId, definitions);
      // Pivotes de los pares configurados de las monedas valoradas (USDT para BTC/USDT): también son candidatas.
      for (const r of requests) {
        const configured = context.pivotOf(r.base);
        if (configured) await currencyOf(configured.code);
      }
      const defs = new Map([...definitions].map(([code, d]) => [code, d?.toCurrency() ?? null] as const));
      const codes = [...defs.entries()].filter(([, c]) => c !== null).map(([code]) => code);
      const times = requests.map((r) => r.at.epochMillis);
      const from = Instant.ofEpochMillis(Math.min(...times) - windowDays * DAY_MS);
      const to = Instant.ofEpochMillis(Math.max(...times));
      const candidates = await this.deps.rates.candidates(workspaceId, codes, from, to);
      const { preferences } = await this.deps.preferences.get(workspaceId);
      const preferenceOf = (a: string, b: string) =>
        preferences.find((p) => sameUnorderedPair(p.base, p.quote, a, b))?.rateType ?? null;
      const resolver = new RateResolver(candidates, this.deps.policy);
      return requests.map((r) => {
        const base = defs.get(r.base) ?? null;
        const quote = defs.get(r.quote) ?? null;
        if (!base || !quote || base.code === quote.code) return null;
        return resolver.tryResolve({
          base,
          quote,
          at: r.at,
          preferenceOf,
          windowDays,
          allowCross: true,
          pivot,
          pivotOf: context.pivotOf,
          assetClassOf: context.assetClassOf,
        });
      });
    });
  }

  /**
   * Tasa de un solo lado (`PARALLEL_BUY` / `PARALLEL_SELL`) vigente a cada instante, por lote (add-conversion-cost-analysis,
   * Could, D247): el tipo se pide explícitamente, directa o inversa, nunca cruzada, con el selector de providers.
   * `null` = sin tasa de ese lado dentro de la ventana (nunca se sustituye por otra).
   */
  resolveQuoteSideRates(
    workspaceId: string,
    requests: readonly {
      readonly base: string;
      readonly quote: string;
      readonly at: Instant;
      readonly side: 'PARALLEL_BUY' | 'PARALLEL_SELL';
    }[],
    windowDaysOverride?: number,
  ): Promise<(ResolvedRate | null)[]> {
    const windowDays = windowDaysOverride ?? this.windowDays;
    if (!Number.isInteger(windowDays) || windowDays < 1) {
      return Promise.reject(
        new DomainError('VALIDATION_FAILED', 'windowDays must be a positive integer').at('/windowDays'),
      );
    }
    return this.deps.uow.run(workspaceId, async () => {
      if (requests.length === 0) return [];
      const defs = new Map<string, Currency | null>();
      for (const code of new Set(requests.flatMap((r) => [r.base, r.quote]))) {
        defs.set(code, (await this.deps.currencies.find(code))?.toCurrency() ?? null);
      }
      const codes = [...defs.entries()].filter(([, c]) => c !== null).map(([code]) => code);
      const times = requests.map((r) => r.at.epochMillis);
      const from = Instant.ofEpochMillis(Math.min(...times) - windowDays * DAY_MS);
      const to = Instant.ofEpochMillis(Math.max(...times));
      const candidates = await this.deps.rates.candidates(workspaceId, codes, from, to);
      const resolver = new RateResolver(candidates, this.deps.policy);
      return requests.map((r) => {
        const base = defs.get(r.base) ?? null;
        const quote = defs.get(r.quote) ?? null;
        if (!base || !quote || base.code === quote.code) return null;
        return resolver.tryResolve({
          base,
          quote,
          at: r.at,
          rateType: r.side,
          windowDays,
          allowCross: false,
        });
      });
    });
  }

  // ------------------------------------------------------------------ FxConversionPricingPort

  async currency(code: string): Promise<CurrencyInfoDto | null> {
    const def = await this.deps.currencies.find(code);
    return def ? { code: def.code, kind: def.kind, scale: def.scale } : null;
  }

  async referenceForConversion(input: {
    readonly workspaceId: string;
    readonly base: string;
    readonly quote: string;
    readonly executedAt: string;
    readonly fxRateId?: string | null;
  }): Promise<ReferenceRateDto | null> {
    if (input.fxRateId) {
      const stored = await this.deps.rates.findById(input.workspaceId, input.fxRateId);
      if (!stored) {
        throw new DomainError('REFERENCE_NOT_FOUND', `fx rate ${input.fxRateId} not found`).at(
          '/referenceFxRateId',
        );
      }
      const r = stored.rate.rate;
      if (!sameUnorderedPair(r.base.code, r.quote.code, input.base, input.quote)) {
        throw new DomainError(
          'CURRENCY_MISMATCH',
          `fx rate ${input.fxRateId} is ${r.base.code}/${r.quote.code}, not ${input.base}/${input.quote}`,
        ).at('/referenceFxRateId');
      }
      return toReferenceDto(stored);
    }
    const base = await this.deps.currencies.find(input.base);
    const quote = await this.deps.currencies.find(input.quote);
    if (!base || !quote) return null;
    const at = Instant.parse(input.executedAt);
    const { resolver, preferenceOf } = await this.resolverFor(input.workspaceId, [base.code, quote.code], at);
    const found = resolver.resolveForConversion({
      base: base.toCurrency(),
      quote: quote.toCurrency(),
      at,
      preferenceOf,
      windowDays: this.windowDays,
      assetClassOf: this.classLookup([base, quote]),
    });
    if (!found || found.fxRateId === null) return null;
    const stored = await this.deps.rates.findById(input.workspaceId, found.fxRateId);
    return stored ? toReferenceDto(stored) : null;
  }

  async conversionCost(input: {
    readonly workspaceId: string;
    readonly executedAt: string;
    readonly components: readonly MoneyDto[];
    readonly reference: ReferenceRateDto | null;
  }): Promise<ConversionCostDto> {
    const { baseCurrency } = await this.deps.workspaces.settingsOf(input.workspaceId);
    const reporting = await this.requireCurrency(baseCurrency, '/reportingCurrency');
    const components: Money[] = [];
    const scales = new Map<string, Currency>();
    for (const c of input.components) {
      const def = await this.requireCurrency(c.currency, '/components');
      scales.set(def.code, def);
      components.push(Money.parse(c.amount, def));
    }
    const at = Instant.parse(input.executedAt);
    const rates = new Map<string, Rate | null>();
    const reference = input.reference;
    for (const code of scales.keys()) {
      if (code === reporting.code || rates.has(code)) continue;
      if (reference && sameUnorderedPair(reference.rate.base, reference.rate.quote, code, reporting.code)) {
        const base = reference.rate.base === code ? scales.get(code) : reporting;
        const quote = reference.rate.base === code ? reporting : scales.get(code);
        if (base && quote) {
          rates.set(code, Rate.of(base, quote, reference.rate.value));
          continue;
        }
      }
      const { resolver, preferenceOf } = await this.resolverFor(
        input.workspaceId,
        [code, reporting.code],
        at,
      );
      const found = resolver.resolveForConversion({
        base: scales.get(code) as Currency,
        quote: reporting,
        at,
        preferenceOf,
        windowDays: this.windowDays,
        assetClassOf: this.classLookup(await this.definitionsOf([code, reporting.code])),
      });
      rates.set(code, found?.rate ?? null);
    }
    const cost = totalCost(components, reporting, (code) => rates.get(code) ?? null);
    return {
      amount: cost.amount.toJSON(),
      complete: cost.complete,
      missingValuations: cost.missingValuations.map((m) => m.toJSON()),
    };
  }

  // ------------------------------------------------------------------ helpers

  /** Clase de activo por código a partir de definiciones ya leídas del catálogo. */
  private classLookup(defs: readonly (CurrencyDefinition | null)[]): (code: string) => AssetClass | null {
    const byCode = new Map(defs.filter((d): d is CurrencyDefinition => d !== null).map((d) => [d.code, d]));
    return (code) => {
      const def = byCode.get(code);
      return def ? this.assetClasses.classOf({ code: def.code, kind: def.kind }) : null;
    };
  }

  /** Definiciones del catálogo en SECUENCIA (nunca consultas en paralelo sobre el mismo cliente pg). */
  private async definitionsOf(codes: readonly string[]): Promise<(CurrencyDefinition | null)[]> {
    const out: (CurrencyDefinition | null)[] = [];
    for (const code of codes) out.push(await this.deps.currencies.find(code));
    return out;
  }

  private async requireCurrency(code: string, pointer: string): Promise<Currency> {
    const def: CurrencyDefinition | null = await this.deps.currencies.find(code);
    if (!def) {
      throw new DomainError('CURRENCY_NOT_ENABLED', `currency ${code} is not enabled`).at(pointer);
    }
    return def.toCurrency();
  }

  private async resolverFor(
    workspaceId: string,
    codes: readonly string[],
    at: Instant,
  ): Promise<{ resolver: RateResolver; preferenceOf: (a: string, b: string) => FxRateType | null }> {
    const from = Instant.ofEpochMillis(at.epochMillis - this.windowDays * DAY_MS);
    const candidates = await this.deps.rates.candidates(workspaceId, codes, from, at);
    const { preferences } = await this.deps.preferences.get(workspaceId);
    const preferenceOf = (a: string, b: string) =>
      preferences.find((p) => sameUnorderedPair(p.base, p.quote, a, b))?.rateType ?? null;
    return { resolver: new RateResolver(candidates, this.deps.policy), preferenceOf };
  }
}
