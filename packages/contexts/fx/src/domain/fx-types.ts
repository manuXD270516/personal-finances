/**
 * Tipos de tasa de FR-FX-002 (docs/31 D13; design.md pregunta abierta resuelta a favor de FR-FX-002) más la compra
 * y la venta publicadas del mercado paralelo (`PARALLEL_BUY` / `PARALLEL_SELL`; decisión del owner 2026-10-03,
 * add-market-rate-providers decisión 29) y `MARKET`, el precio spot de mercado de una criptomoneda frente a USDT
 * (D226, add-crypto-rate-providers; `PARALLEL` conserva su significado de dólar paralelo).
 */
export const FX_RATE_TYPES = [
  'OFFICIAL',
  'PARALLEL',
  'P2P',
  'BANK',
  'CUSTOM',
  'PARALLEL_BUY',
  'PARALLEL_SELL',
  'MARKET',
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

/** Providers de tasa paralela y oficial de Bolivia (add-market-rate-providers; ADR-0025). */
export const FX_RATE_PROVIDERS = ['PARALELO_BO', 'DOLARAPI_BO'] as const;
export type FxFiatRateProvider = (typeof FX_RATE_PROVIDERS)[number];

/**
 * Id de un provider de precios cripto (add-crypto-rate-providers, D225): siempre `CRYPTO_<NOMBRE>`. Los ids reales se
 * fijan en ADR-0029 tras verificar los términos de uso de cada fuente (NFR-COMP-007); hasta entonces no existe ninguno
 * (`FX_CRYPTO_PROVIDER_IDS` vacío) y el patrón solo permite que los dobles de prueba usen el mismo puerto.
 */
export type FxCryptoProviderId = `CRYPTO_${string}`;
export const CRYPTO_PROVIDER_ID_PATTERN = /^CRYPTO_[A-Z0-9_]{1,32}$/;

/** Providers de precios cripto con adapter real y términos verificados (vacío hasta ADR-0029). */
export const FX_CRYPTO_PROVIDER_IDS: readonly FxCryptoProviderId[] = [];

export type FxRateProvider = FxFiatRateProvider | FxCryptoProviderId;

export const isCryptoProviderId = (v: unknown): v is FxCryptoProviderId =>
  typeof v === 'string' && CRYPTO_PROVIDER_ID_PATTERN.test(v);

/** ¿Id con la forma de un provider conocido (fiat o cripto)? La habilitación real la decide el catálogo de términos. */
export const isFxRateProvider = (v: unknown): v is FxRateProvider =>
  typeof v === 'string' && ((FX_RATE_PROVIDERS as readonly string[]).includes(v) || isCryptoProviderId(v));

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
