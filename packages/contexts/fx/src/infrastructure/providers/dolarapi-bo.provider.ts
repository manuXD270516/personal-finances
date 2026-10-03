import { dec, Instant, MoneyDecimal } from '@pf/shared-kernel';
import {
  canonicalRateValue,
  PROVIDER_DESCRIPTORS,
  ProviderError,
  ProviderSample,
  type MarketRateProvider,
  type ProviderDescriptor,
} from '../../domain/index.js';
import { isJsonObject, JsonNumber, LosslessJsonReader, type JsonValue } from './lossless-json-reader.js';
import type { ProviderHttpClient } from './provider-http-client.js';

export const DOLARAPI_BO_BASE_URL = 'https://bo.dolarapi.com';

const DESCRIPTOR: ProviderDescriptor = PROVIDER_DESCRIPTORS.DOLARAPI_BO;

/**
 * Consumer contract de `GET /v1/dolares` (equivalente al JSON Schema del adapter): arreglo de casas con `casa`,
 * `compra`, `venta` (números) y `fechaActualizacion` (instante). Sin las casas `oficial` ni `binance` es un cambio de
 * schema.
 */
export const DOLARAPI_DOLARES_CONTRACT = {
  type: 'array',
  items: {
    type: 'object',
    required: ['casa', 'compra', 'venta', 'fechaActualizacion'],
    properties: {
      moneda: { type: 'string' },
      casa: { type: 'string' },
      compra: { type: 'number' },
      venta: { type: 'number' },
      fechaActualizacion: { type: 'string', format: 'date-time' },
    },
  },
} as const;

const schemaChanged = (message: string) => new ProviderError('PROVIDER_SCHEMA_CHANGED', message);
const payloadInvalid = (message: string) => new ProviderError('PROVIDER_PAYLOAD_INVALID', message);

function numberText(v: JsonValue | undefined, field: string): string {
  if (!(v instanceof JsonNumber)) throw payloadInvalid(`${field} is not a number`);
  return canonicalRateValue(v.text);
}

/**
 * Punto medio EXACTO `(compra + venta) / 2` a precisión 40 (12.04/12.07 → 12.055). Con entradas de ≤ 18 decimales el
 * resultado tiene ≤ 19; si excediera 18 se cuantiza HALF_EVEN a 18 (design.md decisión 1).
 */
export function midpoint(buy: string, sell: string): string {
  return canonicalRateValue(
    dec(buy).plus(sell).div(2).toDecimalPlaces(18, MoneyDecimal.ROUND_HALF_EVEN).toFixed(),
  );
}

/**
 * Adapter ACL de bo.dolarapi.com (respaldo `PARALLEL` y única fuente `OFFICIAL`; ADR-0025): casa `oficial` →
 * `OFFICIAL` USD/BOB; casa `binance` → `PARALLEL` USD/BOB y USDT/BOB, ambas con el punto medio compra/venta y
 * `asOf = fechaActualizacion`. La casa `binance` aporta además `PARALLEL_BUY` = `venta` (lo que paga quien compra
 * USD) y `PARALLEL_SELL` = `compra` (lo que recibe quien vende), misma perspectiva que paralelo.bo (decisión del
 * owner 2026-10-03). Las demás casas se ignoran. Sin histórico.
 */
export class DolarApiBoProvider implements MarketRateProvider {
  constructor(
    private readonly http: ProviderHttpClient,
    private readonly baseUrl: string = DOLARAPI_BO_BASE_URL,
  ) {}

  descriptor(): ProviderDescriptor {
    return DESCRIPTOR;
  }

  async fetchLatest(): Promise<ProviderSample[]> {
    const res = await this.http.getText(
      'DOLARAPI_BO',
      `${this.baseUrl}/v1/dolares`,
      DESCRIPTOR.limitPerMinute,
    );
    const doc = LosslessJsonReader.read(res.body);
    if (!Array.isArray(doc)) throw schemaChanged('dolares response is not an array');
    const byCasa = new Map<string, { [key: string]: JsonValue }>();
    for (const entry of doc) {
      if (!isJsonObject(entry) || typeof entry['casa'] !== 'string') throw schemaChanged('entry lacks casa');
      byCasa.set(entry['casa'], entry);
    }
    const oficial = byCasa.get('oficial');
    const binance = byCasa.get('binance');
    if (!oficial && !binance) throw schemaChanged('neither casa oficial nor casa binance is present');
    const samples: ProviderSample[] = [];
    const make = (
      entry: { [key: string]: JsonValue },
      casa: string,
      pairs: readonly { base: string; rateType: 'OFFICIAL' | 'PARALLEL' }[],
      label: string,
      quoteSides = false,
    ) => {
      for (const field of ['compra', 'venta', 'fechaActualizacion']) {
        if (!(field in entry)) throw schemaChanged(`casa ${casa} lacks ${field}`);
      }
      const compra = numberText(entry['compra'], 'compra');
      const venta = numberText(entry['venta'], 'venta');
      const value = midpoint(compra, venta);
      const at = entry['fechaActualizacion'];
      if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) {
        throw payloadInvalid(`casa ${casa} fechaActualizacion is not an instant`);
      }
      const asOf = Instant.ofEpochMillis(Date.parse(at)).toString();
      for (const p of pairs) {
        samples.push(
          ProviderSample.of({
            provider: 'DOLARAPI_BO',
            base: p.base,
            quote: 'BOB',
            rateType: p.rateType,
            value,
            asOf,
            fetchedAt: res.fetchedAt,
            rawPayload: res.body,
            sourceLabel: label,
          }),
        );
      }
      if (!quoteSides) return;
      const sides = [
        { rateType: 'PARALLEL_BUY' as const, value: venta, label: 'bo.dolarapi.com (Binance P2P, venta)' },
        { rateType: 'PARALLEL_SELL' as const, value: compra, label: 'bo.dolarapi.com (Binance P2P, compra)' },
      ];
      for (const side of sides) {
        for (const p of pairs) {
          samples.push(
            ProviderSample.of({
              provider: 'DOLARAPI_BO',
              base: p.base,
              quote: 'BOB',
              rateType: side.rateType,
              value: side.value,
              asOf,
              fetchedAt: res.fetchedAt,
              rawPayload: res.body,
              sourceLabel: side.label,
            }),
          );
        }
      }
    };
    if (oficial)
      make(oficial, 'oficial', [{ base: 'USD', rateType: 'OFFICIAL' }], 'bo.dolarapi.com (oficial)');
    if (binance) {
      make(
        binance,
        'binance',
        [
          { base: 'USD', rateType: 'PARALLEL' },
          { base: 'USDT', rateType: 'PARALLEL' },
        ],
        'bo.dolarapi.com (Binance P2P, punto medio compra/venta)',
        true,
      );
    }
    return samples;
  }

  async fetchHistory(): Promise<ProviderSample[]> {
    return [];
  }
}
