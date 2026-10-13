import { dec, DomainError, Instant, type Decimal } from '@pf/shared-kernel';
import {
  isCryptoProviderId,
  type FxFiatRateProvider,
  type FxProviderErrorCode,
  type FxRateProvider,
  type FxRateType,
} from './fx-types.js';

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

const ATTRIBUTIONS: Readonly<Record<FxFiatRateProvider, RateAttribution>> = Object.freeze({
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

/**
 * Atribución de un provider (CC BY 4.0 para paralelo.bo; cortesía para bo.dolarapi.com; la de un provider cripto, la
 * que exijan sus términos según su verificación registrada, tomada de su descriptor).
 */
export function attributionOf(provider: FxRateProvider): RateAttribution {
  const found = findAttribution(provider);
  if (!found) throw new RangeError(`unknown provider ${provider}`);
  return found;
}

/**
 * Atribución de un provider o `null` si no está registrado (p. ej. una tasa histórica de un provider cripto cuyo
 * adapter ya no existe): la API no falla por eso, la tasa se informa sin atribución.
 */
export function findAttribution(provider: FxRateProvider): RateAttribution | null {
  return ATTRIBUTIONS[provider as FxFiatRateProvider] ?? providerDescriptor(provider)?.attribution ?? null;
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

/**
 * Verificación de términos de uso y licencia de una fuente (NFR-COMP-007, RISK-023; D225): sin `VERIFIED` con su fecha
 * y el ADR que la registra, la configuración no habilita al provider. `REJECTED` = la fuente no califica.
 */
export interface ProviderTerms {
  readonly status: 'VERIFIED' | 'REJECTED' | 'UNVERIFIED';
  /** Fecha de la verificación (`YYYY-MM-DD`); `null` si aún no se verificó. */
  readonly verifiedOn: string | null;
  /** ADR que registra el resultado, la atribución exigida y los límites (p. ej. `ADR-0025`); `null` si no hay. */
  readonly adr: string | null;
}

/** Clase de provider: tasa paralela/oficial de Bolivia (Phase 1) o precios spot de criptomonedas (D225). */
export type ProviderKind = 'PARALLEL' | 'CRYPTO';

export interface ProviderDescriptor {
  readonly id: FxRateProvider;
  readonly kind: ProviderKind;
  /** Verificación de términos registrada; la configuración rechaza providers sin `VERIFIED`. */
  readonly terms: ProviderTerms;
  /** ¿Publica cierres diarios por rango para el histórico cripto (`CryptoRateProvider.fetchDailyCloses`)? */
  readonly dailyCloses: boolean;
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
 * Parte común de todo provider (design.md decisión 1): el único contrato que conoce el dominio. Cada adapter es un
 * *anti-corruption layer* que traduce el modelo del tercero a `ProviderSample` y falla con `ProviderError` (nunca
 * devuelve una tasa inválida). Las solicitudes no llevan datos del usuario ni del workspace (FR-FX-015).
 */
export interface PollableProvider {
  descriptor(): ProviderDescriptor;
  /** Muestras vigentes (una solicitud por ciclo). */
  fetchLatest(): Promise<ProviderSample[]>;
}

/** Puerto `MarketRateProvider` de la tasa paralela/oficial: añade el histórico diario completo del provider. */
export interface MarketRateProvider extends PollableProvider {
  /** Histórico diario de días COMPLETOS (vacío si el provider no publica histórico). */
  fetchHistory(): Promise<ProviderSample[]>;
}

/** Rango de días UTC (`YYYY-MM-DD`, inclusivos) de un histórico cripto, fijado por la instalación (FR-FX-015). */
export interface DailyCloseRange {
  readonly from: string;
  readonly to: string;
}

/**
 * Puerto del provider de precios cripto (D225, D226): `fetchLatest` entrega muestras `MARKET` de cada criptomoneda del
 * catálogo global frente a USDT (precio spot = último precio publicado; `asOf` = instante publicado) y
 * `fetchDailyCloses` los cierres diarios UTC de días completos del rango pedido, con `asOf` = cierre del día
 * (`D T23:59:59Z`). Los símbolos y los rangos dependen solo del catálogo y de la configuración de la instalación, nunca
 * de los pares ni de las fechas de un workspace. Un adapter real solo se escribe tras verificar los términos de su
 * fuente (ADR-0029); hasta entonces solo existen dobles de prueba.
 */
export interface CryptoRateProvider extends PollableProvider {
  fetchDailyCloses(range: DailyCloseRange): Promise<ProviderSample[]>;
}

export const isCryptoRateProvider = (p: PollableProvider): p is CryptoRateProvider =>
  typeof (p as Partial<CryptoRateProvider>).fetchDailyCloses === 'function';

const QUOTE_SIDE_FEEDS: readonly ProviderFeed[] = Object.freeze([
  { base: 'USD', quote: 'BOB', rateType: 'PARALLEL_BUY' as const },
  { base: 'USDT', quote: 'BOB', rateType: 'PARALLEL_BUY' as const },
  { base: 'USD', quote: 'BOB', rateType: 'PARALLEL_SELL' as const },
  { base: 'USDT', quote: 'BOB', rateType: 'PARALLEL_SELL' as const },
]);

/** Verificación de ADR-0025 (paralelo.bo CC BY 4.0 y bo.dolarapi.com MIT; 2026-10-02). */
const PARALLEL_TERMS: ProviderTerms = Object.freeze({
  status: 'VERIFIED' as const,
  verifiedOn: '2026-10-02',
  adr: 'ADR-0025',
});

/** Catálogo de providers (ADR-0025): feeds, atribución, límite de uso e histórico. Lo exponen los adapters. */
export const PROVIDER_DESCRIPTORS: Readonly<Record<FxFiatRateProvider, ProviderDescriptor>> = Object.freeze({
  PARALELO_BO: Object.freeze({
    id: 'PARALELO_BO',
    kind: 'PARALLEL' as const,
    terms: PARALLEL_TERMS,
    dailyCloses: false,
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
    kind: 'PARALLEL' as const,
    terms: PARALLEL_TERMS,
    dailyCloses: false,
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

/**
 * Registro de descriptores de providers cripto. Los ids y descriptores reales (con su verificación de términos) se
 * declaran aquí tras ADR-0029; hasta entonces el registro está vacío y solo los tests registran dobles
 * (`registerProviderDescriptor`, que devuelve su baja). Nunca se enciende un provider sin `terms.status = VERIFIED`
 * (`parseFxProviderSettings`).
 */
const registered = new Map<string, ProviderDescriptor>();

/** Registra un descriptor (dobles de prueba o, tras ADR-0029, adapters reales); devuelve la función que lo da de baja. */
export function registerProviderDescriptor(descriptor: ProviderDescriptor): () => void {
  if (!isCryptoProviderId(descriptor.id)) {
    throw new RangeError(`crypto provider ids must match CRYPTO_<NAME>: ${descriptor.id}`);
  }
  registered.set(descriptor.id, descriptor);
  return () => {
    if (registered.get(descriptor.id) === descriptor) registered.delete(descriptor.id);
  };
}

/** Descriptor de un provider conocido (los de Bolivia y los cripto registrados); `null` si no existe. */
export function providerDescriptor(provider: string): ProviderDescriptor | null {
  return (
    (PROVIDER_DESCRIPTORS as Readonly<Record<string, ProviderDescriptor>>)[provider] ??
    registered.get(provider) ??
    null
  );
}

/** Descriptores de los providers cripto registrados. */
export function registeredCryptoDescriptors(): ProviderDescriptor[] {
  return [...registered.values()];
}
