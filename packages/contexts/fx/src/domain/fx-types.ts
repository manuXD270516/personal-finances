/**
 * Tipos de tasa de FR-FX-002 (docs/31 D13; design.md pregunta abierta resuelta a favor de FR-FX-002) más la compra
 * y la venta publicadas del mercado paralelo (`PARALLEL_BUY` / `PARALLEL_SELL`; decisión del owner 2026-10-03,
 * add-market-rate-providers decisión 29).
 */
export const FX_RATE_TYPES = [
  'OFFICIAL',
  'PARALLEL',
  'P2P',
  'BANK',
  'CUSTOM',
  'PARALLEL_BUY',
  'PARALLEL_SELL',
] as const;
export type FxRateType = (typeof FX_RATE_TYPES)[number];

/**
 * Cotizaciones de un solo lado (compra/venta publicadas por la fuente, tal como la fuente las nombra). Se registran
 * además de la mediana/punto medio `PARALLEL` y SOLO se usan cuando se piden explícitamente (tipo pedido o
 * preferencia del par): sin tipo resuelto y en el nivel de manuales de otro tipo nunca entran, así la valoración
 * por defecto no cambia (design.md decisión 29).
 */
export const QUOTE_SIDE_RATE_TYPES = ['PARALLEL_BUY', 'PARALLEL_SELL'] as const;
export type QuoteSideRateType = (typeof QUOTE_SIDE_RATE_TYPES)[number];

export const isQuoteSideRateType = (t: FxRateType): t is QuoteSideRateType =>
  (QUOTE_SIDE_RATE_TYPES as readonly string[]).includes(t);

/** Mercado de un tipo: compra/venta paralela comparten roles de providers y obsolescencia con `PARALLEL`. */
export const marketOf = (t: FxRateType): FxRateType => (isQuoteSideRateType(t) ? 'PARALLEL' : t);

/** Origen de una tasa: manual (este change), provider (add-market-rate-providers) u observación de conversión. */
export const FX_RATE_SOURCES = ['MANUAL', 'PROVIDER', 'USER_CONVERSION'] as const;
export type FxRateSource = (typeof FX_RATE_SOURCES)[number];

/** Phase 1: FIAT y CRYPTO (COMMODITY/CUSTOM llegan en Phase 5, FR-FX-012). */
export const CURRENCY_KINDS = ['FIAT', 'CRYPTO', 'COMMODITY', 'CUSTOM'] as const;
export type CurrencyKind = (typeof CURRENCY_KINDS)[number];

/**
 * Respaldo técnico de la ventana de vigencia de la resolución *as-of* (FR-FX-004). El valor es un ajuste de REPORTING
 * (docs/31 D53, `REPORTING_RATE_VALIDITY_WINDOW`) que la composición inyecta (`FxDeps.windowDays`); esto solo aplica si
 * FX se compone sin él (tests, provisión de la seed).
 */
export const DEFAULT_RATE_WINDOW_DAYS = 7;
/**
 * Tipo de tasa de un par SIN preferencia (decisión del owner 2026-10-05, docs/31 D48): `PARALLEL`, el mismo que se
 * siembra para USD/BOB y USDT/BOB (D29). Una preferencia explícita del par o un tipo pedido siempre ganan. Se
 * resuelve exactamente igual que una preferencia `PARALLEL` (incluido el último recurso con manuales frescas de otro
 * tipo en la valoración, D34).
 */
export const DEFAULT_RATE_TYPE: FxRateType = 'PARALLEL';
/** Moneda pivote por defecto para tasas cruzadas (FR-FX-005). */
export const DEFAULT_PIVOT_CURRENCY = 'USD';

export const isFxRateType = (v: unknown): v is FxRateType =>
  typeof v === 'string' && (FX_RATE_TYPES as readonly string[]).includes(v);

/** Monedas habilitadas por defecto en un workspace (design.md § Modelo de datos; decisión 11). */
export const DEFAULT_WORKSPACE_CURRENCIES = ['BOB', 'USD', 'USDT'] as const;

/** Providers de tasas de mercado (add-market-rate-providers; ADR-0025). */
export const FX_RATE_PROVIDERS = ['PARALELO_BO', 'DOLARAPI_BO'] as const;
export type FxRateProvider = (typeof FX_RATE_PROVIDERS)[number];

export const isFxRateProvider = (v: unknown): v is FxRateProvider =>
  typeof v === 'string' && (FX_RATE_PROVIDERS as readonly string[]).includes(v);

/** Cómo se eligió la tasa de valoración (`RateSelection` del contrato; design.md decisión 6). */
export type RateSelection = 'PRIMARY' | 'FALLBACK' | 'LAST_KNOWN_STALE' | 'MANUAL';

/** Estado de una muestra anómala (`FxRateAnomaly.status`). */
export type AnomalyStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED';

/** Códigos de falla de un provider (`FxProviderErrorCode` del contrato). */
export const FX_PROVIDER_ERROR_CODES = [
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_PAYLOAD_INVALID',
  'PROVIDER_SCHEMA_CHANGED',
  'FX_PROVIDER_CONFIG_INVALID',
] as const;
export type FxProviderErrorCode = (typeof FX_PROVIDER_ERROR_CODES)[number];
