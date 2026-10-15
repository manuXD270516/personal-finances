/** Tipos compartidos de montos y tasas (INV-001: `DecimalString`, nunca `number`); lo usan Home y Metas. */

export interface Money {
  readonly amount: string;
  readonly currency: string;
}

export type FxRateType =
  | 'OFFICIAL'
  | 'PARALLEL'
  | 'P2P'
  | 'BANK'
  | 'CUSTOM'
  | 'PARALLEL_BUY'
  | 'PARALLEL_SELL'
  | 'MARKET'
  | 'BANK_BUY'
  | 'BANK_SELL';
export type FxRateSource = 'MANUAL' | 'PROVIDER' | 'USER_CONVERSION';
/**
 * Conjunto abierto: los providers cripto (`CRYPTO_<NOMBRE>`, ADR-0029) y los de tasas por institución
 * (`INSTRATE_<NOMBRE>`) se agregan tras verificar los términos de sus fuentes.
 */
export type FxRateProvider = 'PARALELO_BO' | 'DOLARAPI_BO' | `CRYPTO_${string}` | `INSTRATE_${string}`;
export type RateSelection = 'PRIMARY' | 'FALLBACK' | 'LAST_KNOWN_STALE' | 'MANUAL';

export interface RateAttribution {
  readonly provider: FxRateProvider;
  readonly text: string;
  readonly url: string;
  readonly license?: string | null;
  readonly licenseUrl?: string | null;
}

export interface ResolvedRate {
  readonly rate: { readonly base: string; readonly quote: string; readonly value: string };
  readonly fxRateId?: string | null;
  readonly derivation: 'DIRECT' | 'INVERSE' | 'CROSS';
  readonly rateType: FxRateType;
  /** Tipo pedido; si difiere de `rateType`, se usó una tasa manual fresca de otro tipo. */
  readonly requestedRateType?: FxRateType | null;
  readonly source: FxRateSource;
  readonly asOf: string;
  readonly ageDays: number;
  readonly approx: boolean;
  readonly ageSeconds?: number;
  readonly provider?: FxRateProvider | null;
  readonly selection?: RateSelection;
  readonly stale?: boolean;
  readonly attribution?: RateAttribution | null;
  /** Fuente declarada de una tasa manual (p. ej. "Casa de cambio centro"). */
  readonly sourceLabel?: string | null;
  /** Tasas almacenadas usadas por una inversa o cruzada (cada una con su atribución de provider, si la tiene). */
  readonly components?: readonly {
    readonly base?: string;
    readonly quote?: string;
    readonly attribution?: RateAttribution | null;
  }[];
}
