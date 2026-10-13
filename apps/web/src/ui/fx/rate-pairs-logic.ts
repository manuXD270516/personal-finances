import type { FxRateProvider, RateAttribution } from '../dashboard/types';
import type { FxRateType } from '../common/types';

/**
 * Tipos del contrato `getFxRatePairs` / `replaceFxRatePairs` (`/workspaces/{workspaceId}/fx-rate-pairs`) y lógica pura
 * de Configuración → Tasas automáticas (add-crypto-rate-providers 6.1; D220, D227, D230). Sin `number` para dinero
 * (INV-001): aquí solo hay códigos de moneda y antigüedades en segundos.
 */
export type PairMode = 'DEFAULT' | 'CUSTOM';
export type PairAssetClass = 'FIAT' | 'STABLE' | 'VOLATILE_CRYPTO';
export type PairCoverage = 'AUTOMATIC' | 'MANUAL_ONLY';

export interface FxPair {
  readonly base: string;
  readonly quote: string;
}

export interface FxRatePairView extends FxPair {
  readonly assetClass: PairAssetClass;
  readonly defaultRateType: FxRateType;
  readonly coverage: PairCoverage;
  readonly providers: readonly FxRateProvider[];
}

export interface FxRatePairList {
  readonly mode: PairMode;
  readonly version: number;
  readonly pairs: readonly FxRatePairView[];
}

/** `FxRatePairStatus` del estado de providers: antigüedad de la última tasa automática de cada par configurado. */
export interface FxRatePairStatus extends FxPair {
  readonly coverage: PairCoverage;
  readonly providers: readonly FxRateProvider[];
  readonly lastAutomaticRateAt: string | null;
  readonly ageSeconds: number | null;
  readonly stale: boolean;
}

/** Máximo de pares de una lista (contrato `FxRatePairListInput`). */
export const MAX_PAIRS = 50;
/** Moneda pivote de los pares cripto (D227). */
export const PIVOT_QUOTE = 'USDT';

export const pairKey = (p: FxPair): string => `${p.base}/${p.quote}`;

/** Monedas contra las que puede cotizar un par: la moneda base del workspace y USDT (D227), sin repetir. */
export const allowedQuotes = (baseCurrency: string): string[] => [...new Set([baseCurrency, PIVOT_QUOTE])];

export type AddPairError = 'INVALID' | 'DUPLICATE' | 'TOO_MANY';

/** Agrega un par al borrador de la lista personalizada; un error deja el borrador intacto. */
export function addPair(
  draft: readonly FxPair[],
  base: string,
  quote: string,
  baseCurrency: string,
): { readonly pairs: readonly FxPair[]; readonly error: null } | { readonly error: AddPairError } {
  if (!base || !quote || base === quote || !allowedQuotes(baseCurrency).includes(quote)) {
    return { error: 'INVALID' };
  }
  if (draft.some((p) => p.base === base && p.quote === quote)) return { error: 'DUPLICATE' };
  if (draft.length >= MAX_PAIRS) return { error: 'TOO_MANY' };
  return { pairs: [...draft, { base, quote }], error: null };
}

export const removePair = (draft: readonly FxPair[], key: string): FxPair[] =>
  draft.filter((p) => pairKey(p) !== key);

/** ¿El borrador difiere de lo guardado (modo o lista)? */
export function listChanged(
  saved: { readonly mode: PairMode; readonly pairs: readonly FxPair[] },
  mode: PairMode,
  draft: readonly FxPair[],
): boolean {
  if (saved.mode !== mode) return true;
  if (mode === 'DEFAULT') return false;
  const a = saved.pairs.map(pairKey);
  const b = draft.map(pairKey);
  return a.length !== b.length || a.some((k, i) => k !== b[i]);
}

/** Cuerpo de `replaceFxRatePairs`: con `DEFAULT` no se envían pares. */
export const requestBody = (
  mode: PairMode,
  draft: readonly FxPair[],
): { mode: PairMode; pairs?: FxPair[] } =>
  mode === 'DEFAULT' ? { mode } : { mode, pairs: draft.map((p) => ({ base: p.base, quote: p.quote })) };

/** Estado por par (`BASE/QUOTE`) para unir la lista con la antigüedad de su última tasa automática. */
export const statusByPair = (list: readonly FxRatePairStatus[]): Map<string, FxRatePairStatus> =>
  new Map(list.map((s) => [pairKey(s), s]));

/** Atribuciones de los providers del estado, por id (para enlazar la fuente de cada par). */
export const attributionByProvider = (
  providers: readonly { readonly provider: string; readonly attribution: RateAttribution }[],
): Map<string, RateAttribution> => new Map(providers.map((p) => [p.provider, p.attribution]));
