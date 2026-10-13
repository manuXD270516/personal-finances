import {
  AssetClassPolicy,
  defaultRatePairs,
  RatePairList,
  type AssetClass,
  type RatePair,
  type RatePairMode,
} from '../domain/index.js';
import type { FxDeps } from './ports/index.js';

/** Par configurado con la clase de activo de su moneda base (fiat, estable o cripto volátil). */
export interface EffectiveRatePair extends RatePair {
  readonly assetClass: AssetClass;
}

export interface EffectiveRatePairs {
  readonly mode: RatePairMode;
  readonly version: number;
  readonly pairs: readonly EffectiveRatePair[];
}

type PairDeps = Pick<FxDeps, 'pairs' | 'currencies' | 'workspaces' | 'assetClasses' | 'valuationOnly'>;

/**
 * Lista efectiva de pares de tasa automáticos de un workspace (add-crypto-rate-providers decisión 3): la lista fijada
 * (`CUSTOM`) o la derivada de las monedas habilitadas con `DefaultRatePairs` (`DEFAULT`, así habilitar una moneda la
 * agrega sola). Solo lectura: corre en la unidad de trabajo del llamador (RLS del workspace).
 */
export class RatePairResolver {
  readonly policy: AssetClassPolicy;

  constructor(private readonly deps: PairDeps) {
    this.policy = deps.assetClasses ?? new AssetClassPolicy();
  }

  /** Moneda base del workspace; `null` en procesos de solo valoración (sin acceso a IDENTITY). */
  async baseCurrencyOf(workspaceId: string, known?: string | null): Promise<string | null> {
    if (known !== undefined) return known;
    if (this.deps.valuationOnly) return null;
    return (await this.deps.workspaces.settingsOf(workspaceId)).baseCurrency;
  }

  async effective(workspaceId: string, knownBaseCurrency?: string | null): Promise<EffectiveRatePairs> {
    const list = RatePairList.rehydrate(await this.deps.pairs.get(workspaceId));
    const rows = await this.deps.currencies.list(workspaceId, {});
    const kinds = new Map(rows.map((r) => [r.definition.code, r.definition.kind] as const));
    const refs = (codes: Iterable<string>) =>
      [...codes].map((code) => ({ code, kind: kinds.get(code) ?? ('FIAT' as const) }));
    const derived =
      list.mode === 'DEFAULT'
        ? defaultRatePairs({
            enabled: refs(rows.filter((r) => r.enabled).map((r) => r.definition.code)),
            baseCurrency: await this.baseCurrencyOf(workspaceId, knownBaseCurrency),
            policy: this.policy,
          })
        : [];
    const pairs = list.effective(derived).map((p) => ({
      ...p,
      assetClass: this.policy.classOf({ code: p.base, kind: kinds.get(p.base) ?? 'FIAT' }),
    }));
    return { mode: list.mode, version: list.version, pairs };
  }
}
