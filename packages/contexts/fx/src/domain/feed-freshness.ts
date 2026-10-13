/**
 * DS `FeedFreshnessEvaluator` (fx/market-rate-providers, add-rate-feed-alerts; D233), puro: decide, por workspace, qué
 * pares configurados con cobertura automática abren o cierran su episodio de obsolescencia. Sin E/S ni reloj: recibe
 * el instante y la última tasa aceptada de provider de cada par.
 */

/** Par evaluable (configurado, con cobertura automática de su tipo) y su última tasa aceptada de provider. */
export interface FeedPairObservation {
  readonly base: string;
  readonly quote: string;
  /**
   * Última tasa ACEPTADA de provider en el tipo automático del par (no reemplazada, sin anomalía pendiente o
   * rechazada; las manuales no cuentan). `null` si el par nunca tuvo una.
   */
  readonly latest: { readonly rateId: string; readonly asOf: string } | null;
}

/** Episodio abierto de un par (fila de `fx.rate_feed_episode` sin `closed_at`). */
export interface OpenFeedEpisode {
  readonly id: string;
  readonly base: string;
  readonly quote: string;
  readonly openedAt: string;
  readonly lastRateAsOf: string | null;
}

export interface FeedFreshnessInput {
  readonly pairs: readonly FeedPairObservation[];
  readonly open: readonly OpenFeedEpisode[];
  readonly nowMs: number;
  /** `FX_FEED_STALE_ALERT_AFTER` en ms. */
  readonly staleAfterMs: number;
}

export interface FeedFreshnessResult {
  /** Pares que abren episodio (un hecho de obsolescencia cada uno). */
  readonly open: readonly {
    readonly base: string;
    readonly quote: string;
    readonly lastRateAsOf: string | null;
  }[];
  /** Episodios que se cierran porque llegó una tasa fresca (un hecho de recuperación cada uno). */
  readonly close: readonly {
    readonly episode: OpenFeedEpisode;
    readonly recovered: { readonly rateId: string; readonly asOf: string };
  }[];
  /** Episodios abiertos de pares que ya no se evalúan (par quitado o sin cobertura): se cierran SIN hecho. */
  readonly retire: readonly OpenFeedEpisode[];
}

const keyOf = (p: { readonly base: string; readonly quote: string }): string => `${p.base}/${p.quote}`;

/**
 * `stale = now − latest.asOf > N` (estrictamente mayor: a las N horas exactas no es obsoleto) o sin `latest`. Sin
 * episodio abierto y obsoleto ⇒ abrir; con episodio abierto y no obsoleto ⇒ cerrar con la tasa que lo recuperó. Una
 * vigencia futura (reloj adelantado del provider) no es obsoleta.
 */
export function evaluateFeedFreshness(input: FeedFreshnessInput): FeedFreshnessResult {
  const openByPair = new Map(input.open.map((e) => [keyOf(e), e] as const));
  const evaluated = new Set<string>();
  const open: FeedFreshnessResult['open'][number][] = [];
  const close: FeedFreshnessResult['close'][number][] = [];
  for (const pair of input.pairs) {
    const key = keyOf(pair);
    if (evaluated.has(key)) continue;
    evaluated.add(key);
    const stale = pair.latest === null || input.nowMs - Date.parse(pair.latest.asOf) > input.staleAfterMs;
    const episode = openByPair.get(key);
    if (!episode && stale) {
      open.push({ base: pair.base, quote: pair.quote, lastRateAsOf: pair.latest?.asOf ?? null });
    } else if (episode && !stale && pair.latest) {
      close.push({ episode, recovered: pair.latest });
    }
  }
  const retire = input.open.filter((e) => !evaluated.has(keyOf(e)));
  return { open, close, retire };
}
