/** Tipos de tasa de FR-FX-002 (docs/31 D13; design.md pregunta abierta resuelta a favor de FR-FX-002). */
export const FX_RATE_TYPES = ['OFFICIAL', 'PARALLEL', 'P2P', 'BANK', 'CUSTOM'] as const;
export type FxRateType = (typeof FX_RATE_TYPES)[number];

/** Origen de una tasa: manual (este change), provider (add-market-rate-providers) u observación de conversión. */
export const FX_RATE_SOURCES = ['MANUAL', 'PROVIDER', 'USER_CONVERSION'] as const;
export type FxRateSource = (typeof FX_RATE_SOURCES)[number];

/** Phase 1: FIAT y CRYPTO (COMMODITY/CUSTOM llegan en Phase 5, FR-FX-012). */
export const CURRENCY_KINDS = ['FIAT', 'CRYPTO', 'COMMODITY', 'CUSTOM'] as const;
export type CurrencyKind = (typeof CURRENCY_KINDS)[number];

/** Ventana de vigencia por defecto de la resolución *as-of* (FR-FX-004; design.md pregunta abierta: se modela en FX). */
export const DEFAULT_RATE_WINDOW_DAYS = 7;
/** Moneda pivote por defecto para tasas cruzadas (FR-FX-005). */
export const DEFAULT_PIVOT_CURRENCY = 'USD';

export const isFxRateType = (v: unknown): v is FxRateType =>
  typeof v === 'string' && (FX_RATE_TYPES as readonly string[]).includes(v);

/** Monedas habilitadas por defecto en un workspace (design.md § Modelo de datos; decisión 11). */
export const DEFAULT_WORKSPACE_CURRENCIES = ['BOB', 'USD', 'USDT'] as const;
