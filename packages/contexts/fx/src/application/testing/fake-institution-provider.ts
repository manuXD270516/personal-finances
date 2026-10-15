import {
  type FxInstitutionProviderId,
  type InstitutionRateProvider,
  type ProviderDescriptor,
  type ProviderError,
  ProviderSample,
  registerProviderDescriptor,
  type ProviderTerms,
} from '../../domain/index.js';

/** Verificación de términos de un doble: NUNCA corresponde a una fuente real (no existe ninguna verificada). */
export const FAKE_INSTITUTION_TERMS: ProviderTerms = Object.freeze({
  status: 'VERIFIED' as const,
  verifiedOn: '2026-10-15',
  adr: 'ADR-TEST',
});

export interface FakeInstitutionOptions {
  readonly id: FxInstitutionProviderId;
  readonly terms?: ProviderTerms;
  readonly limitPerMinute?: number;
}

/** Descriptor de un doble de provider por institución (ver `registerProviderDescriptor`). */
export function fakeInstitutionDescriptor(options: FakeInstitutionOptions): ProviderDescriptor {
  return {
    id: options.id,
    kind: 'INSTITUTION',
    terms: options.terms ?? FAKE_INSTITUTION_TERMS,
    dailyCloses: false,
    feeds: [
      { base: 'USD', quote: 'BOB', rateType: 'BANK_BUY' },
      { base: 'USD', quote: 'BOB', rateType: 'BANK_SELL' },
    ],
    quoteSideFeeds: [],
    attribution: {
      provider: options.id,
      text: `Fuente: ${options.id.toLowerCase()} (doble de prueba)`,
      url: 'https://example.invalid/instituciones',
      license: null,
      licenseUrl: null,
    },
    limitPerMinute: options.limitPerMinute ?? 600,
    history: false,
  };
}

/** Cotización publicada por una institución (ficticia) en la fuente simulada, en el vocabulario de la fuente. */
export interface FakeInstitutionQuote {
  /** Lo que la institución PAGA por comprar USD (= lo que el owner RECIBE al venderlos ⇒ `BANK_SELL`, D39). */
  readonly compra?: string;
  /** Lo que la institución COBRA por vender USD (= lo que el owner PAGA al comprarlos ⇒ `BANK_BUY`). */
  readonly venta?: string;
}

/**
 * Adapter de prueba en memoria del puerto `InstitutionRateProvider` (NO es un adapter real y no consulta ninguna
 * fuente): publica la cotización que el test programa por código de institución (todas las publicadas, no solo las
 * adoptadas), traducida como lo haría el ACL de una fuente real: `compra` de la entidad ⇒ `BANK_SELL` y `venta` ⇒
 * `BANK_BUY` (convención "desde el lado del owner", D39). Registra cada solicitud para verificar que no lleva datos de
 * ningún workspace (FR-FX-015). Solo publica el lado que la fuente publica: nunca calcula un punto medio.
 */
export class FakeInstitutionRateProvider implements InstitutionRateProvider {
  calls = 0;
  /** Cotizaciones vigentes por código de institución. */
  quotes: Record<string, FakeInstitutionQuote> = {};
  /** Vigencia publicada (`asOf`). */
  asOf = '2026-10-08T16:00:00Z';
  failure: ProviderError | null = null;
  readonly descriptorValue: ProviderDescriptor;

  constructor(
    private readonly options: FakeInstitutionOptions,
    private readonly now: () => string,
  ) {
    this.descriptorValue = fakeInstitutionDescriptor(options);
  }

  get id(): FxInstitutionProviderId {
    return this.options.id;
  }

  register(): () => void {
    return registerProviderDescriptor(this.descriptorValue);
  }

  descriptor(): ProviderDescriptor {
    return this.descriptorValue;
  }

  async fetchLatest(): Promise<ProviderSample[]> {
    this.calls++;
    if (this.failure) throw this.failure;
    const fetchedAt = this.now();
    const out: ProviderSample[] = [];
    for (const [code, quote] of Object.entries(this.quotes)) {
      const sides = [
        ['compra', quote.compra, 'BANK_SELL'],
        ['venta', quote.venta, 'BANK_BUY'],
      ] as const;
      for (const [field, value, rateType] of sides) {
        if (value === undefined) continue;
        out.push(
          ProviderSample.of({
            provider: this.id,
            base: 'USD',
            quote: 'BOB',
            rateType,
            value,
            asOf: this.asOf,
            fetchedAt,
            rawPayload: `{"entidad":"${code}","${field}":"${value}","vigencia":"${this.asOf}"}`,
            sourceLabel: `${this.id} (${field} de ${code})`,
            institutionCode: code,
          }),
        );
      }
    }
    return out;
  }
}
