import { readFile } from 'node:fs/promises';
import type { ForecastRequestV1, ForecastResponseV1, ServiceSeriesResult } from '../domain/index.js';
import { ForecastServiceError, type ForecastServicePort } from '../application/ports.js';

export interface MlServiceClientOptions {
  /** `http://ml-forecasting:8090` (`FORECASTING_SERVICE_URL`). */
  readonly baseUrl: string;
  /** Archivo con la credencial de servicio (`FORECASTING_SERVICE_TOKEN_FILE`); se lee en cada llamada (rotación). */
  readonly tokenFile: string;
  /** `FORECASTING_SERVICE_TIMEOUT_MS` (300 000). */
  readonly timeoutMs: number;
  readonly fetch?: typeof fetch;
  readonly readToken?: (file: string) => Promise<string>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const DECIMAL = /^-?\d+(\.\d+)?$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const REF = /^s[1-9]\d{0,3}$/;

/**
 * Valida la forma de `ForecastResponseV1` (contracts/ml/forecast-response.v1.schema.json). Estricta con los campos
 * requeridos y los tipos; las reglas de negocio de cada serie las valida `ForecastResultValidator`. Los tests de
 * contrato comparan este parser con el JSON Schema sobre los ejemplos compartidos de `contracts/ml/examples/`.
 */
export function parseForecastResponse(json: unknown): ForecastResponseV1 {
  const fail = (what: string): never => {
    throw new ForecastServiceError('INVALID_OUTPUT', `invalid service response: ${what}`);
  };
  if (!isRecord(json)) return fail('not an object');
  const allowedTop = ['schemaVersion', 'requestId', 'serviceVersion', 'results', 'durationMs'];
  if (Object.keys(json).some((k) => !allowedTop.includes(k))) fail('unknown fields');
  if (json['schemaVersion'] !== '1') fail('schemaVersion');
  if (typeof json['requestId'] !== 'string' || json['requestId'] === '') fail('requestId');
  if (typeof json['serviceVersion'] !== 'string' || json['serviceVersion'] === '') fail('serviceVersion');
  if (!Number.isInteger(json['durationMs']) || (json['durationMs'] as number) < 0) fail('durationMs');
  if (!Array.isArray(json['results'])) return fail('results');
  const results: ServiceSeriesResult[] = (json['results'] as unknown[]).map((r) => {
    if (!isRecord(r)) return fail('result');
    const ref = r['ref'];
    if (typeof ref !== 'string' || !REF.test(ref)) fail('ref');
    if (r['status'] !== 'OK' && r['status'] !== 'ERROR') fail('status');
    if (r['error'] !== null && typeof r['error'] !== 'string') fail('error');
    const model = r['model'];
    if (
      model !== null &&
      !(isRecord(model) && typeof model['name'] === 'string' && typeof model['version'] === 'string')
    ) {
      fail('model');
    }
    const baseline = r['baseline'];
    if (baseline !== null && !(isRecord(baseline) && typeof baseline['method'] === 'string'))
      fail('baseline');
    if (!Array.isArray(r['points'])) fail('points');
    const points = (r['points'] as unknown[]).map((p) => {
      if (!isRecord(p)) return fail('point');
      if (typeof p['period'] !== 'string' || !PERIOD.test(p['period'])) fail('period');
      if (!Number.isInteger(p['monthsAhead'])) fail('monthsAhead');
      for (const k of ['prediction', 'lower80', 'upper80', 'lower95', 'upper95', 'baselineValue']) {
        if (typeof p[k] !== 'string' || !DECIMAL.test(p[k] as string)) fail(`amount ${k}`);
      }
      return p as unknown as ServiceSeriesResult['points'][number];
    });
    return {
      ref: ref as string,
      status: r['status'] as 'OK' | 'ERROR',
      error: r['error'] as string | null,
      model: model as ServiceSeriesResult['model'],
      baseline: baseline as ServiceSeriesResult['baseline'],
      points,
    };
  });
  return {
    schemaVersion: '1',
    requestId: json['requestId'] as string,
    serviceVersion: json['serviceVersion'] as string,
    durationMs: json['durationMs'] as number,
    results,
  };
}

/**
 * ACL del servicio `finance-ml` (decisión 3 y 5): `POST /v1/forecasts` con `Authorization: Bearer`, un tiempo máximo de
 * espera y la respuesta validada. Mapea los errores a motivos de falla de la corrida: sin respuesta o 5xx ⇒
 * `SERVICE_UNAVAILABLE`; 4xx ⇒ `SERVICE_REJECTED`; tiempo excedido o 504 ⇒ `TIMEOUT`; cuerpo inválido ⇒ `INVALID_OUTPUT`.
 * Nunca se invoca dentro de una unidad de trabajo (sin conexión retenida).
 */
export class MlForecastingServiceClient implements ForecastServicePort {
  constructor(private readonly options: MlServiceClientOptions) {}

  async forecast(request: ForecastRequestV1): Promise<ForecastResponseV1> {
    const doFetch = this.options.fetch ?? fetch;
    let token: string;
    try {
      token = (await (this.options.readToken ?? ((f) => readFile(f, 'utf8')))(this.options.tokenFile)).trim();
    } catch {
      throw new ForecastServiceError('SERVICE_REJECTED', 'service credential unavailable');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${this.options.baseUrl.replace(/\/$/, '')}/v1/forecasts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
      throw new ForecastServiceError(
        aborted ? 'TIMEOUT' : 'SERVICE_UNAVAILABLE',
        aborted ? 'timeout' : 'unreachable',
      );
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 504) throw new ForecastServiceError('TIMEOUT', 'service compute deadline exceeded');
    if (res.status === 503 || res.status >= 500) {
      throw new ForecastServiceError('SERVICE_UNAVAILABLE', `service status ${res.status}`);
    }
    if (res.status >= 400) throw new ForecastServiceError('SERVICE_REJECTED', `service status ${res.status}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ForecastServiceError('INVALID_OUTPUT', 'service response is not JSON');
    }
    return parseForecastResponse(body);
  }
}
