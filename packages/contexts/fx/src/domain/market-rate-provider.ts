import { dec, DomainError, Instant, type Decimal } from '@pf/shared-kernel';
import type { FxProviderErrorCode, FxRateProvider, FxRateType } from './fx-types.js';

/** Igual que NUMERIC(38,18) de `fx.exchange_rate.rate`: ≤ 20 dígitos enteros y ≤ 18 decimales, sin signo. */
const DECIMAL_TEXT = /^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/;

/**
 * Atribución que debe mostrarse junto a toda tasa de provider (`RateAttribution` del contrato; FR-FX-014,
 * NFR-COMP-007). Única fuente del texto (design.md decisión 11): los adapters la exponen en `descriptor()`.
 */
export interface RateAttribution {
  readonly provider: FxRateProvider;
  readonly text: string;
  readonly url: string;
  readonly license: string | null;
  readonly licenseUrl: string | null;
}

const ATTRIBUTIONS: Readonly<Record<FxRateProvider, RateAttribution>> = Object.freeze({
  PARALELO_BO: Object.freeze({
    provider: 'PARALELO_BO',
    text: 'Fuente: paralelo.bo',
    url: 'https://paralelo.bo',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  }),
  DOLARAPI_BO: Object.freeze({
    provider: 'DOLARAPI_BO',
    text: 'Fuente: bo.dolarapi.com',
    url: 'https://bo.dolarapi.com',
    license: null,
    licenseUrl: null,
  }),
});

/** Atribución de un provider (CC BY 4.0 para paralelo.bo; cortesía para bo.dolarapi.com). */
export function attributionOf(provider: FxRateProvider): RateAttribution {
  return ATTRIBUTIONS[provider];
}

/**
 * Falla de un provider (nunca una tasa): la registra `fx.provider_run` y la muestra el estado. `retryAfterUntil` solo
 * con `PROVIDER_RATE_LIMITED` (instante hasta el que no se consulta al provider).
 */
export class ProviderError extends Error {
  constructor(
    readonly code: FxProviderErrorCode,
    message: string,
    readonly httpStatus: number | null = null,
    readonly retryAfterUntil: string | null = null,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface ProviderSampleInput {
  readonly provider: FxRateProvider;
  readonly base: string;
  readonly quote: string;
  readonly rateType: FxRateType;
  /** Texto decimal exacto (lectura lossless): nunca un `number`. */
  readonly value: string;
  readonly asOf: string;
  readonly fetchedAt: string;
  /** Respuesta cruda EXACTA del provider (texto), conservada como evidencia (auditoría byte a byte). */
  readonly rawPayload: string;
  /** Descripción legible de la metodología (p. ej. "paralelo.bo (mediana P2P USDT/BOB)"). */
  readonly sourceLabel: string;
}

/**
 * VO `ProviderSample` (design.md, tabla de agregados): una muestra de un provider ya traducida por su ACL. El valor
 * es un decimal exacto > 0 con ≤ 18 decimales (INV-001, INV-032); una muestra que no lo cumple es
 * `PROVIDER_PAYLOAD_INVALID` (falla del provider, nunca una tasa).
 */
export class ProviderSample {
  private constructor(
    readonly provider: FxRateProvider,
    readonly base: string,
    readonly quote: string,
    readonly rateType: FxRateType,
    /** Valor canónico (sin ceros finales). */
    readonly value: string,
    readonly asOf: string,
    readonly fetchedAt: string,
    readonly rawPayload: string,
    readonly sourceLabel: string,
  ) {
    Object.freeze(this);
  }

  static of(input: ProviderSampleInput): ProviderSample {
    if (input.base === input.quote) {
      throw new ProviderError('PROVIDER_PAYLOAD_INVALID', 'base and quote must differ');
    }
    let asOf: string;
    let fetchedAt: string;
    try {
      asOf = Instant.parse(input.asOf).toString();
      fetchedAt = Instant.parse(input.fetchedAt).toString();
    } catch (err) {
      if (err instanceof DomainError) {
        throw new ProviderError('PROVIDER_PAYLOAD_INVALID', `invalid instant: ${err.message}`);
      }
      throw err;
    }
    return new ProviderSample(
      input.provider,
      input.base,
      input.quote,
      input.rateType,
      canonicalRateValue(input.value),
      asOf,
      fetchedAt,
      input.rawPayload,
      input.sourceLabel,
    );
  }

  get decimal(): Decimal {
    return dec(this.value);
  }

  /** Clave de idempotencia natural (índice único `exchange_rate_provider_uk`). */
  get key(): string {
    return `${this.provider}|${this.base}/${this.quote}|${this.rateType}|${this.asOf}`;
  }
}

/**
 * Texto decimal → valor canónico exacto de una tasa: positivo, ≤ 18 decimales tras normalizar (`12.0200` → `12.02`,
 * `1.2e1` → `12`). Cualquier otra cosa es `PROVIDER_PAYLOAD_INVALID`. Nunca pasa por `number`.
 */
export function canonicalRateValue(text: string): string {
  if (typeof text !== 'string' || !/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(text)) {
    throw new ProviderError('PROVIDER_PAYLOAD_INVALID', 'rate value is not a decimal number');
  }
  const d = dec(text);
  if (d.lte(0)) throw new ProviderError('PROVIDER_PAYLOAD_INVALID', 'rate value must be positive');
  const canonical = d.toFixed();
  if (!DECIMAL_TEXT.test(canonical)) {
    throw new ProviderError(
      'PROVIDER_PAYLOAD_INVALID',
      'rate value exceeds 18 decimals or NUMERIC(38,18) bounds',
    );
  }
  return canonical;
}

/** Una tarifa publicada (feed): par y tipo que el provider entrega. */
export interface ProviderFeed {
  readonly base: string;
  readonly quote: string;
  readonly rateType: FxRateType;
}

export interface ProviderDescriptor {
  readonly id: FxRateProvider;
  /** Feeds de valoración (mediana/punto medio y oficial): los que informa el estado del provider. */
  readonly feeds: readonly ProviderFeed[];
  /**
   * Compra/venta publicadas (`PARALLEL_BUY`/`PARALLEL_SELL`, perspectiva de quien opera; design.md decisión 29):
   * se registran además de la mediana y no participan del estado ni de la valoración por defecto.
   */
  readonly quoteSideFeeds: readonly ProviderFeed[];
  readonly attribution: RateAttribution;
  /** Límite de solicitudes por minuto que el cliente respeta (paralelo.bo publica 60; dolarapi 30 conservador). */
  readonly limitPerMinute: number;
  /** ¿Publica histórico diario? (solo paralelo.bo). */
  readonly history: boolean;
}

/**
 * Puerto `MarketRateProvider` (design.md decisión 1): el único contrato del provider que conoce el dominio. Cada
 * adapter es un *anti-corruption layer* que traduce el modelo del tercero a `ProviderSample` y falla con
 * `ProviderError` (nunca devuelve una tasa inválida).
 */
export interface MarketRateProvider {
  descriptor(): ProviderDescriptor;
  /** Muestras vigentes (una solicitud). */
  fetchLatest(): Promise<ProviderSample[]>;
  /** Histórico diario de días COMPLETOS (vacío si el provider no publica histórico). */
  fetchHistory(): Promise<ProviderSample[]>;
}

const QUOTE_SIDE_FEEDS: readonly ProviderFeed[] = Object.freeze([
  { base: 'USD', quote: 'BOB', rateType: 'PARALLEL_BUY' as const },
  { base: 'USDT', quote: 'BOB', rateType: 'PARALLEL_BUY' as const },
  { base: 'USD', quote: 'BOB', rateType: 'PARALLEL_SELL' as const },
  { base: 'USDT', quote: 'BOB', rateType: 'PARALLEL_SELL' as const },
]);

/** Catálogo de providers (ADR-0025): feeds, atribución, límite de uso e histórico. Lo exponen los adapters. */
export const PROVIDER_DESCRIPTORS: Readonly<Record<FxRateProvider, ProviderDescriptor>> = Object.freeze({
  PARALELO_BO: Object.freeze({
    id: 'PARALELO_BO',
    feeds: [
      { base: 'USD', quote: 'BOB', rateType: 'PARALLEL' as const },
      { base: 'USDT', quote: 'BOB', rateType: 'PARALLEL' as const },
    ],
    quoteSideFeeds: QUOTE_SIDE_FEEDS,
    attribution: attributionOf('PARALELO_BO'),
    limitPerMinute: 60,
    history: true,
  }),
  DOLARAPI_BO: Object.freeze({
    id: 'DOLARAPI_BO',
    feeds: [
      { base: 'USD', quote: 'BOB', rateType: 'PARALLEL' as const },
      { base: 'USDT', quote: 'BOB', rateType: 'PARALLEL' as const },
      { base: 'USD', quote: 'BOB', rateType: 'OFFICIAL' as const },
    ],
    quoteSideFeeds: QUOTE_SIDE_FEEDS,
    attribution: attributionOf('DOLARAPI_BO'),
    // No publica límite: 30/min conservador (design.md decisión 9).
    limitPerMinute: 30,
    history: false,
  }),
});
