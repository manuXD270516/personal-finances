import { Instant, LocalDate, type Clock } from '@pf/shared-kernel';
import {
  PROVIDER_DESCRIPTORS,
  ProviderError,
  ProviderSample,
  type MarketRateProvider,
  type ProviderDescriptor,
} from '../../domain/index.js';
import { isJsonObject, JsonNumber, LosslessJsonReader, type JsonValue } from './lossless-json-reader.js';
import type { ProviderHttpClient } from './provider-http-client.js';

export const PARALELO_BO_BASE_URL = 'https://paralelo.bo';
/** Zona de "día completo" del histórico (Bolivia: UTC−4 fijo, sin horario de verano). */
const LA_PAZ = 'America/La_Paz';
const LA_PAZ_OFFSET_MS = 4 * 3_600_000;
const DAY_MS = 86_400_000;
const LABEL = 'paralelo.bo (mediana P2P USDT/BOB)';
const PAIRS = [
  { base: 'USD', quote: 'BOB' },
  { base: 'USDT', quote: 'BOB' },
] as const;

const DESCRIPTOR: ProviderDescriptor = PROVIDER_DESCRIPTORS.PARALELO_BO;

const schemaChanged = (message: string) => new ProviderError('PROVIDER_SCHEMA_CHANGED', message);
const payloadInvalid = (message: string) => new ProviderError('PROVIDER_PAYLOAD_INVALID', message);

/**
 * Consumer contract de `GET /api/v1/rate` (equivalente al JSON Schema del adapter; design.md decisión 1):
 * objeto con `timestamp` (string), `median` (número o null), `buy`/`sell`/`spreadPct`/`sourceCount` y
 * `methodologyVersion`. La ausencia de `timestamp` o `median` es un cambio de schema; un `median` nulo, no numérico,
 * ≤ 0 o con más de 18 decimales es un payload inválido.
 */
export const PARALELO_RATE_CONTRACT = {
  type: 'object',
  required: ['timestamp', 'median'],
  properties: {
    timestamp: { type: 'string', format: 'date-time' },
    median: { type: ['number', 'null'] },
    buy: { type: ['number', 'null'] },
    sell: { type: ['number', 'null'] },
    spreadPct: { type: ['number', 'null'] },
    sourceCount: { type: ['number', 'null'] },
    methodologyVersion: { type: 'string' },
  },
} as const;

/** Consumer contract de `GET /api/v1/historical.json`: `currencyPair` "USD/BOB" y `points[{t, v}]`. */
export const PARALELO_HISTORY_CONTRACT = {
  type: 'object',
  required: ['currencyPair', 'points'],
  properties: {
    currencyPair: { const: 'USD/BOB' },
    points: {
      type: 'array',
      items: {
        type: 'object',
        required: ['t', 'v'],
        properties: { t: { type: 'string' }, v: { type: 'number' } },
      },
    },
  },
} as const;

function numberText(v: JsonValue | undefined, field: string): string {
  if (!(v instanceof JsonNumber)) throw payloadInvalid(`${field} is not a number`);
  return v.text;
}

function instantText(v: JsonValue | undefined, field: string): string {
  if (typeof v !== 'string') throw schemaChanged(`${field} is not a string`);
  // Acepta cualquier instante RFC 3339 del provider y lo normaliza a UTC con Z.
  const ms = Date.parse(v);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(v) || Number.isNaN(ms)) throw payloadInvalid(`${field} is not an instant`);
  return Instant.ofEpochMillis(ms).toString();
}

/**
 * Adapter ACL de paralelo.bo (fuente principal; ADR-0025). `fetchLatest` → 2 muestras `PARALLEL` (USD/BOB y USDT/BOB)
 * con `value = median` y `asOf = timestamp`; `buy`, `sell`, `spreadPct`, `sourceCount` y `methodologyVersion` solo
 * quedan en la respuesta cruda. `fetchHistory` → por cada punto de un día COMPLETO D (D < hoy en America/La_Paz), 2
 * muestras vigentes al cierre de D (`D 23:59:59 -04:00`).
 */
export class ParaleloBoProvider implements MarketRateProvider {
  constructor(
    private readonly http: ProviderHttpClient,
    private readonly clock: Clock,
    private readonly baseUrl: string = PARALELO_BO_BASE_URL,
  ) {}

  descriptor(): ProviderDescriptor {
    return DESCRIPTOR;
  }

  async fetchLatest(): Promise<ProviderSample[]> {
    const res = await this.http.getText(
      'PARALELO_BO',
      `${this.baseUrl}/api/v1/rate`,
      DESCRIPTOR.limitPerMinute,
    );
    const doc = LosslessJsonReader.read(res.body);
    if (!isJsonObject(doc)) throw schemaChanged('rate response is not an object');
    if (!('timestamp' in doc) || !('median' in doc))
      throw schemaChanged('rate response lacks timestamp/median');
    const asOf = instantText(doc['timestamp'], 'timestamp');
    const value = numberText(doc['median'], 'median');
    return PAIRS.map((p) =>
      ProviderSample.of({
        provider: 'PARALELO_BO',
        ...p,
        rateType: 'PARALLEL',
        value,
        asOf,
        fetchedAt: res.fetchedAt,
        rawPayload: res.body,
        sourceLabel: LABEL,
      }),
    );
  }

  async fetchHistory(): Promise<ProviderSample[]> {
    const url = `${this.baseUrl}/api/v1/historical.json`;
    const res = await this.http.getText('PARALELO_BO', url, DESCRIPTOR.limitPerMinute);
    const doc = LosslessJsonReader.read(res.body);
    if (!isJsonObject(doc) || !Array.isArray(doc['points'])) throw schemaChanged('historical lacks points');
    if (doc['currencyPair'] !== 'USD/BOB') throw schemaChanged('historical currencyPair is not USD/BOB');
    const today = LocalDate.ofInstant(this.clock.now(), LA_PAZ).toString();
    const byDay = new Map<string, { t: string; v: string }>();
    for (const point of doc['points']) {
      if (!isJsonObject(point) || !('t' in point) || !('v' in point)) throw schemaChanged('point lacks t/v');
      const t = instantText(point['t'], 't');
      const v = numberText(point['v'], 'v');
      const day = t.slice(0, 10);
      if (day < today) byDay.set(day, { t, v });
    }
    const samples: ProviderSample[] = [];
    for (const [day, point] of [...byDay].sort(([a], [b]) => (a < b ? -1 : 1))) {
      // Vigente al cierre del día en La Paz: D 23:59:59-04:00 = D+1 03:59:59Z.
      const asOf = Instant.ofEpochMillis(Date.parse(`${day}T00:00:00Z`) + DAY_MS - 1000 + LA_PAZ_OFFSET_MS);
      // Respuesta cruda por punto (texto exacto del número): conservar el histórico completo en cada fila sería
      // ~34 KB × 1 576 filas por workspace (design.md decisión 25).
      const raw = `{"source":"${url}","currencyPair":"USD/BOB","resolution":"daily","point":{"t":"${point.t}","v":${point.v}}}`;
      for (const p of PAIRS) {
        samples.push(
          ProviderSample.of({
            provider: 'PARALELO_BO',
            ...p,
            rateType: 'PARALLEL',
            value: point.v,
            asOf: asOf.toString(),
            fetchedAt: res.fetchedAt,
            rawPayload: raw,
            sourceLabel: `${LABEL}, cierre diario`,
          }),
        );
      }
    }
    return samples;
  }
}
