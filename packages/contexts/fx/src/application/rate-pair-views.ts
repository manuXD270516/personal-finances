import type { Clock } from '@pf/shared-kernel';
import {
  providerDescriptor,
  StalenessPolicy,
  type AssetClass,
  type FxRateProvider,
  type FxRateType,
} from '../domain/index.js';
import type { ExchangeRateRepository, UnitOfWork } from './ports/index.js';
import { enabledProviders, valuationPolicyOf, type FxProviderSettings } from './provider-settings.js';
import type { EffectiveRatePair, RatePairResolver } from './rate-pairs.js';

export type PairCoverage = 'AUTOMATIC' | 'MANUAL_ONLY';

/** `FxRatePairList.pairs[]` del contrato: el par con su clase, su tipo por defecto y qué providers lo cubren. */
export interface RatePairView extends EffectiveRatePair {
  readonly defaultRateType: FxRateType;
  readonly coverage: PairCoverage;
  readonly providers: readonly FxRateProvider[];
}

export interface RatePairListView {
  readonly mode: 'DEFAULT' | 'CUSTOM';
  readonly version: number;
  readonly pairs: readonly RatePairView[];
}

/** `FxRatePairStatus` del contrato: cobertura y antigüedad de la última tasa automática de un par configurado. */
export interface RatePairStatus {
  readonly base: string;
  readonly quote: string;
  readonly coverage: PairCoverage;
  readonly providers: readonly FxRateProvider[];
  readonly lastAutomaticRateAt: string | null;
  readonly ageSeconds: number | null;
  readonly stale: boolean;
}

export interface RatePairViewsDeps {
  readonly uow: UnitOfWork;
  readonly rates: ExchangeRateRepository;
  readonly pairs: RatePairResolver;
  readonly clock: Clock;
  readonly settings: FxProviderSettings;
}

interface Cover {
  readonly provider: FxRateProvider;
  readonly rateType: FxRateType;
}

/**
 * Vistas de lectura de los pares configurados (fx/market-rate-providers, FR-FX-009 y FR-FX-016): cobertura por los
 * providers HABILITADOS (un par que ningún provider publica es `MANUAL_ONLY`) y, en el estado, la antigüedad de su
 * última tasa automática aceptada. Solo lectura; nunca llama a un provider.
 */
export class RatePairViews {
  private readonly staleness: StalenessPolicy;

  constructor(private readonly deps: RatePairViewsDeps) {
    this.staleness = new StalenessPolicy(valuationPolicyOf(deps.settings));
  }

  /** Claves `BASE/QUOTE` de los pares configurados del workspace (dentro de la unidad de trabajo del llamador). */
  async pairKeys(workspaceId: string): Promise<ReadonlySet<string>> {
    const effective = await this.deps.pairs.effective(workspaceId);
    return new Set(effective.pairs.map((p) => `${p.base}/${p.quote}`));
  }

  list(workspaceId: string): Promise<RatePairListView> {
    return this.deps.uow.run(workspaceId, async () => {
      const effective = await this.deps.pairs.effective(workspaceId);
      return {
        mode: effective.mode,
        version: effective.version,
        pairs: effective.pairs.map((p) => {
          const covers = this.covers(p);
          return {
            ...p,
            defaultRateType: this.defaultRateType(p),
            coverage: covers.length > 0 ? 'AUTOMATIC' : 'MANUAL_ONLY',
            providers: [...new Set(covers.map((c) => c.provider))],
          };
        }),
      };
    });
  }

  /** Estado por par configurado del workspace (dentro de la unidad de trabajo del llamador). */
  async status(workspaceId: string): Promise<RatePairStatus[]> {
    const effective = await this.deps.pairs.effective(workspaceId);
    const now = this.deps.clock.now();
    const out: RatePairStatus[] = [];
    for (const p of effective.pairs) {
      const covers = this.covers(p);
      let newest: Awaited<ReturnType<ExchangeRateRepository['latestAccepted']>> = null;
      for (const c of covers) {
        const found = await this.deps.rates.latestAccepted(workspaceId, {
          provider: c.provider,
          base: p.base,
          quote: p.quote,
          rateType: c.rateType,
        });
        if (
          found &&
          (!newest || Date.parse(found.rate.snapshot.asOf) > Date.parse(newest.rate.snapshot.asOf))
        ) {
          newest = found;
        }
      }
      out.push({
        base: p.base,
        quote: p.quote,
        coverage: covers.length > 0 ? 'AUTOMATIC' : 'MANUAL_ONLY',
        providers: [...new Set(covers.map((c) => c.provider))],
        lastAutomaticRateAt: newest ? newest.rate.snapshot.asOf : null,
        ageSeconds: newest
          ? Math.max(0, Math.floor((now.epochMillis - Date.parse(newest.rate.snapshot.asOf)) / 1000))
          : null,
        stale: newest ? this.staleness.isStale(newest.rate.snapshot, now) : true,
      });
    }
    return out;
  }

  /** Feeds de los providers habilitados que publican este par exacto (con el rol que cada tipo exige). */
  private covers(pair: EffectiveRatePair): Cover[] {
    const s = this.deps.settings;
    const serves = (provider: FxRateProvider, rateType: FxRateType): boolean => {
      if (rateType === 'PARALLEL') return provider === s.primary || provider === s.fallback;
      if (rateType === 'OFFICIAL') return provider === s.official;
      if (rateType === 'MARKET') return provider === s.cryptoPrimary || provider === s.cryptoFallback;
      return false;
    };
    const out: Cover[] = [];
    for (const provider of enabledProviders(s)) {
      const descriptor = providerDescriptor(provider);
      if (!descriptor) continue;
      for (const feed of descriptor.feeds) {
        if (feed.base === pair.base && feed.quote === pair.quote && serves(provider, feed.rateType)) {
          out.push({ provider, rateType: feed.rateType });
        }
      }
    }
    return out;
  }

  /** Tipo de un par sin preferencia: MARKET si su base es cripto volátil cotizada frente a una estable. */
  private defaultRateType(pair: EffectiveRatePair): FxRateType {
    const volatile: AssetClass = 'VOLATILE_CRYPTO';
    return pair.assetClass === volatile && this.deps.settings.stablecoinCodes.includes(pair.quote)
      ? 'MARKET'
      : 'PARALLEL';
  }
}
