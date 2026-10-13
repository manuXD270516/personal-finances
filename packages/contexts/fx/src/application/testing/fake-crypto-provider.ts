import {
  type ProviderError,
  ProviderSample,
  registerProviderDescriptor,
  type CryptoRateProvider,
  type DailyCloseRange,
  type FxCryptoProviderId,
  type ProviderDescriptor,
  type ProviderTerms,
} from '../../domain/index.js';

/** Verificación de términos de un doble: NUNCA corresponde a una fuente real (no existe ninguna verificada). */
export const FAKE_VERIFIED_TERMS: ProviderTerms = Object.freeze({
  status: 'VERIFIED' as const,
  verifiedOn: '2026-10-13',
  adr: 'ADR-TEST',
});

export interface FakeCryptoOptions {
  readonly id: FxCryptoProviderId;
  /** Criptomonedas del catálogo global que publica (frente a USDT). */
  readonly symbols?: readonly string[];
  readonly terms?: ProviderTerms;
  readonly limitPerMinute?: number;
}

/** Descriptor de un doble de provider cripto (ver `registerProviderDescriptor`). */
export function fakeCryptoDescriptor(options: FakeCryptoOptions): ProviderDescriptor {
  return {
    id: options.id,
    kind: 'CRYPTO',
    terms: options.terms ?? FAKE_VERIFIED_TERMS,
    dailyCloses: true,
    feeds: (options.symbols ?? ['BTC', 'ETH']).map((base) => ({
      base,
      quote: 'USDT',
      rateType: 'MARKET' as const,
    })),
    quoteSideFeeds: [],
    attribution: {
      provider: options.id,
      text: `Fuente: ${options.id.toLowerCase()} (doble de prueba)`,
      url: 'https://example.invalid/crypto',
      license: null,
      licenseUrl: null,
    },
    limitPerMinute: options.limitPerMinute ?? 600,
    history: false,
  };
}

/**
 * Adapter de prueba en memoria del puerto `CryptoRateProvider` (NO es un adapter real y no consulta ninguna fuente):
 * publica los precios y los cierres diarios que el test programa, con la misma validación de `ProviderSample` que un
 * adapter real. Registra cada solicitud (símbolos y rangos) para verificar que no dependen de ningún workspace
 * (FR-FX-015). `register()` da de alta su descriptor y devuelve la baja.
 */
export class FakeCryptoProvider implements CryptoRateProvider {
  readonly latestRequests: { readonly symbols: readonly string[] }[] = [];
  readonly closeRequests: DailyCloseRange[] = [];
  /** Último precio publicado por símbolo: texto exacto y vigencia. */
  prices: Record<string, { readonly price: string; readonly asOf: string }> = {};
  /** Cierres diarios por símbolo: día UTC → texto exacto del cierre. */
  closes: Record<string, Record<string, string>> = {};
  failure: ProviderError | null = null;
  readonly descriptorValue: ProviderDescriptor;

  constructor(
    private readonly options: FakeCryptoOptions,
    private readonly now: () => string,
  ) {
    this.descriptorValue = fakeCryptoDescriptor(options);
  }

  get id(): FxCryptoProviderId {
    return this.options.id;
  }

  register(): () => void {
    return registerProviderDescriptor(this.descriptorValue);
  }

  descriptor(): ProviderDescriptor {
    return this.descriptorValue;
  }

  async fetchLatest() {
    const symbols = this.descriptorValue.feeds.map((f) => f.base);
    this.latestRequests.push({ symbols });
    if (this.failure) throw this.failure;
    const fetchedAt = this.now();
    return symbols
      .filter((base) => this.prices[base] !== undefined)
      .map((base) => {
        const { price, asOf } = this.prices[base] as { price: string; asOf: string };
        return ProviderSample.of({
          provider: this.id,
          base,
          quote: 'USDT',
          rateType: 'MARKET',
          value: price,
          asOf,
          fetchedAt,
          rawPayload: `{"symbol":"${base}USDT","price":"${price}","time":"${asOf}"}`,
          sourceLabel: `${this.id} (precio spot ${base}/USDT)`,
        });
      });
  }

  async fetchDailyCloses(range: DailyCloseRange) {
    this.closeRequests.push({ from: range.from, to: range.to });
    if (this.failure) throw this.failure;
    const fetchedAt = this.now();
    const out: ProviderSample[] = [];
    for (const base of this.descriptorValue.feeds.map((f) => f.base)) {
      for (const [day, close] of Object.entries(this.closes[base] ?? {})) {
        if (day < range.from || day > range.to) continue;
        out.push(
          ProviderSample.of({
            provider: this.id,
            base,
            quote: 'USDT',
            rateType: 'MARKET',
            value: close,
            asOf: `${day}T23:59:59Z`,
            fetchedAt,
            rawPayload: `{"symbol":"${base}USDT","day":"${day}","close":"${close}"}`,
            sourceLabel: `${this.id} (cierre diario ${base}/USDT)`,
          }),
        );
      }
    }
    return out;
  }
}
