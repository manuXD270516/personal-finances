import type { FxRate, FxRatePreference, FxRateType } from '../common/types';

/**
 * Orientación de display de un par (design.md decisión 2): la moneda base del workspace va como quote
 * (`USDT/BOB`, `USD/BOB`), tanto al vender como al comprar; sin la moneda base, el origen es la base.
 */
export function pairOrientation(
  source: string,
  target: string,
  workspaceBase: string,
): { base: string; quote: string } {
  if (target === workspaceBase) return { base: source, quote: target };
  if (source === workspaceBase) return { base: target, quote: source };
  return { base: source, quote: target };
}

export interface RatePairGroup {
  readonly pair: string;
  readonly base: string;
  readonly quote: string;
  /** Vigentes primero (más reciente arriba); las reemplazadas al final, para la vista de versiones. */
  readonly rates: readonly FxRate[];
  readonly preferred: FxRateType | null;
}

/** Agrupa las tasas por par (orden de la API: `asOf` más reciente primero) con la preferencia de tipo del par. */
export function groupRatesByPair(
  rates: readonly FxRate[],
  prefs: readonly FxRatePreference[],
): RatePairGroup[] {
  const groups = new Map<string, FxRate[]>();
  for (const r of rates) {
    const key = `${r.base}/${r.quote}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([pair, list]) => {
      const [base = '', quote = ''] = pair.split('/');
      const preferred =
        prefs.find((p) => (p.base === base && p.quote === quote) || (p.base === quote && p.quote === base))
          ?.rateType ?? null;
      return {
        pair,
        base,
        quote,
        preferred,
        rates: [...list.filter((r) => !r.supersededByRateId), ...list.filter((r) => r.supersededByRateId)],
      };
    })
    .sort((a, b) => a.pair.localeCompare(b.pair));
}

/** Reemplaza (o agrega/quita) la preferencia de tipo de un par en la lista completa (`PUT fx-rate-preferences`). */
export function withPreference(
  prefs: readonly FxRatePreference[],
  base: string,
  quote: string,
  rateType: FxRateType | '',
): FxRatePreference[] {
  const rest = prefs.filter(
    (p) => !((p.base === base && p.quote === quote) || (p.base === quote && p.quote === base)),
  );
  return rateType ? [...rest, { base, quote, rateType }] : rest;
}
