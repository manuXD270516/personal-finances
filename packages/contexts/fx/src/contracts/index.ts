/**
 * API pública de `@pf/fx` (openspec add-manual-conversions; ADR-0003). Hoja: no importa capas internas.
 * Montos como `{amount: "<decimal>", currency: "<código>"}` y tasas como `{base, quote, value: "<decimal>"}` (nunca
 * `number`, ADR-0006).
 */
import type { AuditFieldPoliciesDto } from '@pf/audit/contracts';

export const FX_CONTEXT = 'fx' as const;

/** Eventos publicados por el outbox (contracts/events/fx/*.v1.schema.json). */
export const FX_EVENTS = {
  rateRecorded: { eventType: 'fx.RateRecorded', eventVersion: 1 },
  // add-rate-feed-alerts (D233, D234): sin consumidores en Phase 5 (catálogo y trazabilidad; NOTIFY recibe el aviso por su puerto).
  rateFeedStale: { eventType: 'fx.RateFeedStale', eventVersion: 1 },
  rateFeedRecovered: { eventType: 'fx.RateFeedRecovered', eventVersion: 1 },
  rateAnomalyRetained: { eventType: 'fx.RateAnomalyRetained', eventVersion: 1 },
} as const;

export type FxRateTypeDto =
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
export type FxRateSourceDto = 'MANUAL' | 'PROVIDER' | 'USER_CONVERSION';
export type CurrencyKindDto = 'FIAT' | 'CRYPTO' | 'COMMODITY' | 'CUSTOM';

export interface MoneyDto {
  readonly amount: string;
  readonly currency: string;
}

/** 1 `base` = `value` `quote`. */
export interface RateDto {
  readonly base: string;
  readonly quote: string;
  readonly value: string;
}

/** Versión EXACTA de la tasa de referencia que una conversión registra (fx/conversion-pricing, FR-FX-008). */
export interface ReferenceRateDto {
  readonly fxRateId: string;
  /** En la orientación almacenada de la versión (la original; nunca una inversa redondeada). */
  readonly rate: RateDto;
  readonly rateType: FxRateTypeDto;
  readonly source: FxRateSourceDto;
  readonly sourceLabel: string | null;
  readonly asOf: string;
  /** Código de catálogo de la institución que publicó la tasa (`BANK_BUY`/`BANK_SELL`); `null` en el resto. */
  readonly institutionCode?: string | null;
}

export interface ConversionCostDto {
  /** Fees + spread valorados en la moneda de reporte del workspace, con una sola cuantización HALF_EVEN. */
  readonly amount: MoneyDto;
  readonly complete: boolean;
  readonly missingValuations: readonly MoneyDto[];
}

/** Moneda del catálogo (tipo y escala canónica, FR-FX-001). */
export interface CurrencyInfoDto {
  readonly code: string;
  readonly kind: CurrencyKindDto;
  readonly scale: number;
}

/** Moneda activa del catálogo con su escala canónica y si está habilitada en el workspace. */
export interface WorkspaceCurrencyDto extends CurrencyInfoDto {
  readonly enabled: boolean;
}

/**
 * Puerto que TRANSACTIONS consume (in-process, dentro de SU unidad de trabajo) para el pricing de conversiones.
 * Errores (`DomainError.code`): `REFERENCE_NOT_FOUND` (id explícito inexistente), `CURRENCY_MISMATCH` (la tasa
 * explícita no es del par).
 */
export interface FxConversionPricingPort {
  /**
   * Referencia de una conversión: la versión explícita (`fxRateId`) o la resuelta al `executedAt` con el tipo
   * preferido del par (directa o inversa, NUNCA cruzada; ventana de 7 días). `null` si no hay ninguna.
   */
  referenceForConversion(input: {
    readonly workspaceId: string;
    readonly base: string;
    readonly quote: string;
    readonly executedAt: string;
    readonly fxRateId?: string | null;
  }): Promise<ReferenceRateDto | null>;
  /**
   * Costo total (fees + spread) en la moneda de reporte, valorando cada componente con la referencia del instante de
   * ejecución (la de la conversión para su par; para otras monedas, la misma política de resolución). Derivado: nunca
   * se persiste y se recalcula siempre con las tasas vigentes AL `executedAt`, no con tasas nuevas.
   */
  conversionCost(input: {
    readonly workspaceId: string;
    readonly executedAt: string;
    readonly components: readonly MoneyDto[];
    readonly reference: ReferenceRateDto | null;
  }): Promise<ConversionCostDto>;
  /** Tipo y escala de una moneda activa del catálogo (`null` si no existe o está inactiva). */
  currency(code: string): Promise<CurrencyInfoDto | null>;
}

export const FX_CONVERSION_PRICING_PORT = Symbol.for('pf.fx.FxConversionPricingPort');

/** Consumidor de FX de las conversiones propias (D231, D249): observación de tasa por cada conversión posteada. */
export const FX_USER_CONVERSION_CONSUMER = 'fx.user-conversion-observations';
/** Job de la carga inicial idempotente de las observaciones de las conversiones anteriores al cambio. */
export const FX_USER_CONVERSION_BACKFILL_JOB = 'fx.backfill-user-conversion-observations';

/** Lado publicado de la cotización paralela (`PARALLEL_BUY` / `PARALLEL_SELL`). */
export type FxQuoteSideDto = 'PARALLEL_BUY' | 'PARALLEL_SELL';

/**
 * Tasa de un solo lado (compra o venta paralela) vigente a un instante, para el spread alternativo del análisis de
 * costo de conversiones (add-conversion-cost-analysis, Could, D247). Directa o inversa, nunca cruzada, con el selector
 * de providers; `null` si no hay tasa de ese lado en la ventana. Sin efectos.
 */
export interface FxQuoteSideRatesPort {
  resolveQuoteSideRates(input: {
    readonly workspaceId: string;
    readonly requests: readonly {
      readonly base: string;
      readonly quote: string;
      readonly at: string;
      readonly side: FxQuoteSideDto;
    }[];
    readonly windowDays?: number;
  }): Promise<readonly (ValuationRateDto | null)[]>;
}

export const FX_QUOTE_SIDE_RATES_PORT = Symbol.for('pf.fx.FxQuoteSideRatesPort');

/**
 * Providers de tasa paralela/oficial, de precios cripto (`CRYPTO_<NOMBRE>`, ids fijados en ADR-0029) y de tasas por
 * institución (`INSTRATE_<NOMBRE>`, ids fijados en el ADR de sus fuentes).
 */
export type FxRateProviderDto = 'PARALELO_BO' | 'DOLARAPI_BO' | `CRYPTO_${string}` | `INSTRATE_${string}`;
export type RateSelectionDto = 'PRIMARY' | 'FALLBACK' | 'LAST_KNOWN_STALE' | 'MANUAL';
export type RateDerivationDto = 'DIRECT' | 'INVERSE' | 'CROSS';

/** Atribución que debe mostrarse junto a una tasa de provider (`RateAttribution` del contrato HTTP). */
export interface RateAttributionDto {
  readonly provider: FxRateProviderDto;
  readonly text: string;
  readonly url: string;
  readonly license: string | null;
  readonly licenseUrl: string | null;
}

/**
 * Atribuciones de una tasa resuelta: la de su provider y, en una tasa cruzada o inversa, la de cada tasa componente
 * que venga de un provider (FR-FX-014), sin repetir. Cada componente es un `FxRate` del contrato con su `attribution`.
 */
export function attributionsOf(resolved: ResolvedRateDto): RateAttributionDto[] {
  const byProvider = new Map<string, RateAttributionDto>();
  if (resolved.attribution) byProvider.set(resolved.attribution.provider, resolved.attribution);
  for (const component of resolved.components) {
    const attribution = (component as { readonly attribution?: RateAttributionDto | null }).attribution;
    if (attribution) byProvider.set(attribution.provider, attribution);
  }
  return [...byProvider.values()];
}

/** `ResolvedRate` del contrato HTTP (fx/market-rates + fx/market-rate-providers), listo para serializar. */
export interface ResolvedRateDto {
  readonly rate: RateDto;
  readonly fxRateId: string | null;
  readonly derivation: RateDerivationDto;
  /** Tasas almacenadas usadas por una inversa/cruzada (`FxRate` del contrato HTTP). */
  readonly components: readonly object[];
  readonly rateType: FxRateTypeDto;
  /** Tipo pedido (explícito o preferido); si difiere de `rateType` se usó una manual fresca de otro tipo. */
  readonly requestedRateType: FxRateTypeDto | null;
  readonly source: FxRateSourceDto;
  readonly sourceLabel: string | null;
  readonly asOf: string;
  readonly ageDays: number;
  readonly ageSeconds: number;
  readonly approx: boolean;
  readonly provider: FxRateProviderDto | null;
  readonly selection: RateSelectionDto;
  readonly stale: boolean;
  readonly attribution: RateAttributionDto | null;
}

/** Tasa de valoración resuelta: la de presentación y la EXACTA para convertir (nunca una inversa redondeada). */
export interface ValuationRateDto {
  readonly resolved: ResolvedRateDto;
  /**
   * Tasa a precisión completa en la orientación ALMACENADA (directa/inversa: la original; cruzada: el producto a
   * precisión 40). Para convertir `m` de `exact.base` se multiplica; de `exact.quote`, se divide (INV-032).
   */
  readonly exact: RateDto;
}

/**
 * Puerto de valoración (`ConvertForValuation` por lote; openspec add-basic-dashboard, FR-FX-006/010) que consume
 * REPORTING: para cada pedido `(base, quote, at)` la tasa de valoración del tipo preferido del par con la selección de
 * fx/market-rate-providers (principal → respaldo → última conocida obsoleta o manual más reciente), directa → inversa →
 * cruzada por pivote (`approx`), dentro de la ventana; `null` si no hay ninguna (nunca 1:1). Sin efectos.
 */
export interface FxValuationPort {
  resolveValuationRates(input: {
    readonly workspaceId: string;
    readonly requests: readonly { readonly base: string; readonly quote: string; readonly at: string }[];
    /**
     * Ventana de vigencia (días) que fija el llamador: es un ajuste de REPORTING (docs/31 D53,
     * `REPORTING_RATE_VALIDITY_WINDOW`). Sin ella, la ventana con la que se compuso FX (`windowDays`).
     */
    readonly windowDays?: number;
  }): Promise<readonly (ValuationRateDto | null)[]>;
  /** Monedas habilitadas del workspace con su escala canónica. */
  enabledCurrencies(workspaceId: string): Promise<readonly CurrencyInfoDto[]>;
  /**
   * Catálogo de monedas activas con su escala canónica y `enabled` por workspace (UNA lectura): la escala de una moneda
   * no habilitada (p. ej. una cuenta BTC sin postings) sale del catálogo, nunca de un valor de respaldo.
   */
  workspaceCurrencies(workspaceId: string): Promise<readonly WorkspaceCurrencyDto[]>;
  /**
   * Ventana de vigencia en días con la que se compuso FX: la entrega la composición desde el ajuste de REPORTING
   * (docs/31 D53); 7 por defecto.
   */
  readonly windowDays: number;
}

export const FX_VALUATION_PORT = Symbol.for('pf.fx.FxValuationPort');

export type FxAssetClassDto = 'FIAT' | 'STABLE' | 'VOLATILE_CRYPTO';

/** Par de tasa automático configurado de un workspace (fx/market-rate-providers). */
export interface RatePairDto {
  readonly base: string;
  readonly quote: string;
  readonly assetClass: FxAssetClassDto;
}

/**
 * Lectura de los pares de tasa automáticos de un workspace (lista fijada o por defecto), para otros contextos (p. ej.
 * las alertas de obsolescencia del change 39). Corre en la unidad de trabajo del llamador. Sin efectos.
 */
export interface RatePairsQuery {
  listRatePairs(workspaceId: string): Promise<readonly RatePairDto[]>;
}

export const FX_RATE_PAIRS_QUERY = Symbol.for('pf.fx.RatePairsQuery');

/**
 * Episodio abierto de obsolescencia de un par configurado (`fx.rate_feed_episode` sin `closed_at`; add-rate-feed-alerts,
 * D233), tal como lo expone el estado de providers (`FxRatePairStatus.openEpisode`).
 */
export interface RateFeedOpenEpisodeDto {
  readonly openedAt: string;
  /** Vigencia de la última tasa aceptada al abrirse; `null` si el par nunca tuvo una. */
  readonly lastRateAsOf: string | null;
}

/**
 * Allow-list de auditoría de FX (add-audit-trail, NFR-SEC-015): las tasas son datos de mercado (valor como texto
 * decimal exacto); lo no listado nunca se copia a `audit.audit_log`.
 */
export const FX_AUDIT_POLICY = {
  ExchangeRate: {
    base: 'plain',
    quote: 'plain',
    value: 'plain',
    rateType: 'plain',
    source: 'plain',
    sourceLabel: 'plain',
    asOf: 'plain',
    effectiveDate: 'plain',
    supersedesRateId: 'plain',
    anomalyStatus: 'plain',
  },
  RatePreferences: {
    preferences: 'plain',
  },
  RatePairs: {
    mode: 'plain',
    pairs: 'plain',
  },
} as const satisfies AuditFieldPoliciesDto;

export * from './portability.js';
