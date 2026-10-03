import { DomainError, Instant, Rate, type Currency } from '@pf/shared-kernel';
import type { FxRateProvider, FxRateSource, FxRateType } from './fx-types.js';
import type { ProviderSample } from './market-rate-provider.js';

/** NUMERIC(38,18): como máximo 20 dígitos enteros y 18 decimales; las tasas NO se redondean a la escala de la moneda. */
const RATE_VALUE = /^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/;
const MAX_LABEL = 200;

export interface ExchangeRateState {
  readonly id: string;
  /** `null` = tasa global de un provider (add-market-rate-providers); las manuales siempre son del workspace. */
  readonly workspaceId: string | null;
  /** 1 base = value quote (docs/09 §7.1), con el valor exacto registrado (precisión 40, sin redondeo). */
  readonly rate: Rate;
  readonly rateType: FxRateType;
  readonly source: FxRateSource;
  readonly sourceLabel: string | null;
  /** Instante de vigencia (RFC 3339 UTC). */
  readonly asOf: string;
  /** Fecha de negocio de `asOf` en la zona del workspace. */
  readonly effectiveDate: string;
  readonly supersedesId: string | null;
  readonly supersedeReason: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
  /** Provider que la originó (`source = PROVIDER`); `null` en tasas manuales (add-market-rate-providers). */
  readonly provider: FxRateProvider | null;
  /** Instante en que el worker obtuvo la muestra (`asOf` es el publicado por el provider). */
  readonly fetchedAt: string | null;
  /** Respuesta cruda exacta del provider (evidencia; nunca se expone en la API). */
  readonly rawPayload: string | null;
  /** Marca de anomalía inmutable de la fila (la decisión vive en `fx.rate_anomaly_review`). */
  readonly anomaly: AnomalyMark | null;
}

/** Variación de una muestra de provider que superó el umbral respecto de la tasa aceptada anterior (design.md 8). */
export interface AnomalyMark {
  readonly baselineRateId: string;
  /** Porcentaje con signo, HALF_EVEN a 4 decimales (`"12.3128"`). */
  readonly variationPct: string;
}

/** Datos de una tasa de provider que no vienen de la muestra (copia por workspace; design.md decisión 3). */
export interface ProviderRateInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly base: Currency;
  readonly quote: Currency;
  readonly effectiveDate: string;
  readonly createdAt: string;
  readonly anomaly: AnomalyMark | null;
}

export interface RecordRateInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly base: Currency;
  readonly quote: Currency;
  readonly value: string;
  readonly rateType: FxRateType;
  readonly source?: FxRateSource;
  readonly sourceLabel?: string | null;
  readonly asOf: string;
  readonly effectiveDate: string;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

export interface SupersedeInput {
  readonly id: string;
  readonly value: string;
  readonly reason: string;
  readonly sourceLabel?: string | null;
  readonly createdAt: string;
  readonly createdBy: string | null;
}

const invalid = (message: string, pointer: string) =>
  new DomainError('VALIDATION_FAILED', message).at(pointer);

/** Valor de tasa validado (> 0, base ≠ quote, ≤ 18 decimales) → `Rate` del shared-kernel. */
export function parseRateValue(base: Currency, quote: Currency, value: string, pointer = '/value'): Rate {
  if (base.code === quote.code) throw invalid('base and quote must differ', '/quote');
  if (typeof value !== 'string' || !RATE_VALUE.test(value)) {
    throw invalid('rate must be a positive decimal string with at most 18 decimals', pointer);
  }
  try {
    return Rate.of(base, quote, value);
  } catch (err) {
    // INVALID_RATE del shared-kernel ⇒ VALIDATION_FAILED del contrato (fx/market-rates: tasa ≤ 0 o base = quote).
    if (err instanceof DomainError) throw invalid(err.message, pointer);
    throw err;
  }
}

function label(value: string | null | undefined): string | null {
  const v = value?.trim() ?? '';
  if (v.length === 0) return null;
  if (v.length > MAX_LABEL)
    throw invalid(`sourceLabel must be at most ${MAX_LABEL} characters`, '/sourceLabel');
  return v;
}

/**
 * AR `ExchangeRate` (fx/market-rates; INV-011): tasa histórica INMUTABLE. No hay operación de modificación: corregir
 * = `supersede`, que crea una versión nueva con el mismo par, tipo y vigencia (`supersedes_id`) y deja la original
 * consultable. Una versión solo puede reemplazarse una vez (`FX_RATE_ALREADY_SUPERSEDED`).
 */
export class ExchangeRate {
  private constructor(private readonly state: ExchangeRateState) {
    Object.freeze(this);
  }

  static rehydrate(state: ExchangeRateState): ExchangeRate {
    return new ExchangeRate(state);
  }

  /** `RecordManualRate` (FR-FX-002): valor > 0, base ≠ quote; los decimales se conservan sin pérdida. */
  static record(input: RecordRateInput): ExchangeRate {
    const rate = parseRateValue(input.base, input.quote, input.value);
    return new ExchangeRate({
      id: input.id,
      workspaceId: input.workspaceId,
      rate,
      rateType: input.rateType,
      source: input.source ?? 'MANUAL',
      sourceLabel: label(input.sourceLabel),
      asOf: Instant.parse(input.asOf).toString(),
      effectiveDate: input.effectiveDate,
      supersedesId: null,
      supersedeReason: null,
      createdAt: input.createdAt,
      createdBy: input.createdBy,
      provider: null,
      fetchedAt: null,
      rawPayload: null,
      anomaly: null,
    });
  }

  /**
   * Tasa de provider (`source = PROVIDER`; FR-FX-009): copia por workspace de una muestra, con provider, vigencia
   * publicada, instante de obtención y respuesta cruda. Nunca reemplaza (`supersedes_id`) ni toca tasas manuales.
   */
  static fromProviderSample(sample: ProviderSample, input: ProviderRateInput): ExchangeRate {
    if (input.base.code !== sample.base || input.quote.code !== sample.quote) {
      throw new DomainError('VALIDATION_FAILED', 'currencies do not match the provider sample');
    }
    return new ExchangeRate({
      id: input.id,
      workspaceId: input.workspaceId,
      rate: parseRateValue(input.base, input.quote, sample.value),
      rateType: sample.rateType,
      source: 'PROVIDER',
      sourceLabel: label(sample.sourceLabel),
      asOf: sample.asOf,
      effectiveDate: input.effectiveDate,
      supersedesId: null,
      supersedeReason: null,
      createdAt: input.createdAt,
      createdBy: null,
      provider: sample.provider,
      fetchedAt: sample.fetchedAt,
      rawPayload: sample.rawPayload,
      anomaly: input.anomaly,
    });
  }

  get id(): string {
    return this.state.id;
  }
  get rate(): Rate {
    return this.state.rate;
  }
  get snapshot(): ExchangeRateState {
    return this.state;
  }
  /** Valor canónico sin ceros finales (`"6.95"`, `"6.965432109876543210"` → `"6.96543210987654321"`). */
  get valueText(): string {
    return this.state.rate.value.toFixed();
  }

  /**
   * `SupersedeRate` (FR-FX-003): nueva versión con motivo (3–500 caracteres) que reemplaza a esta. `supersededBy` es
   * la versión que ya la reemplazó (si existe): reemplazar dos veces la misma versión se rechaza indicando la vigente.
   */
  supersede(input: SupersedeInput, supersededBy: string | null): ExchangeRate {
    if (supersededBy !== null) {
      throw new DomainError(
        'FX_RATE_ALREADY_SUPERSEDED',
        `rate ${this.state.id} was already superseded by ${supersededBy}; correct the current version instead`,
      );
    }
    const reason = input.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw invalid('reason must have between 3 and 500 characters', '/reason');
    }
    const s = this.state;
    if (s.workspaceId === null) {
      throw new DomainError('VALIDATION_FAILED', 'global provider rates cannot be superseded by a workspace');
    }
    return new ExchangeRate({
      ...s,
      id: input.id,
      rate: parseRateValue(s.rate.base, s.rate.quote, input.value),
      source: 'MANUAL',
      sourceLabel: input.sourceLabel === undefined ? s.sourceLabel : label(input.sourceLabel),
      supersedesId: s.id,
      supersedeReason: reason,
      createdAt: input.createdAt,
      createdBy: input.createdBy,
      provider: null,
      fetchedAt: null,
      rawPayload: null,
      anomaly: null,
    });
  }
}
