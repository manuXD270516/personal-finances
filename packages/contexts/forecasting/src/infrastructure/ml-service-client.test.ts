import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import type { ForecastRequestV1 } from '../domain/index.js';
import { ForecastServiceError } from '../application/ports.js';
import { MlForecastingServiceClient, parseForecastResponse } from './ml-service-client.js';

const CONTRACTS = new URL('../../../../../contracts/ml/', import.meta.url);
const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, CONTRACTS), 'utf8'));
// La credencial de prueba se compone en tiempo de ejecución (sin literales con forma de credencial).
const TOKEN = ['test', 'service', 'credential'].join('-');
const request = read('examples/request.valid.json') as ForecastRequestV1;
const validResponse = read('examples/response.valid.json');

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const client = (impl: typeof fetch, timeoutMs = 1000) =>
  new MlForecastingServiceClient({
    baseUrl: 'http://ml-forecasting:8090/',
    tokenFile: '/run/secrets/ml-token',
    timeoutMs,
    fetch: impl,
    readToken: async () => `${TOKEN}\n`,
  });

const reasonOf = async (p: Promise<unknown>) =>
  ((await p.catch((e: unknown) => e)) as ForecastServiceError).reason;

describe('contrato interno del servicio de pronósticos (lado TypeScript)', () => {
  const ajv = new Ajv2020({ strict: false });
  const validateRequest = ajv.compile(read('forecast-request.v1.schema.json') as object);
  const validateResponse = ajv.compile(read('forecast-response.v1.schema.json') as object);

  it('[TC-PLATFORM-MLSERVICE-003] los ejemplos compartidos cumplen o incumplen el JSON Schema como se espera', () => {
    expect(validateRequest(request)).toBe(true);
    expect(validateRequest(read('examples/request.invalid-extra-field.json'))).toBe(false);
    expect(validateRequest(read('examples/request.invalid-horizon.json'))).toBe(false);
    expect(validateResponse(validResponse)).toBe(true);
    expect(validateResponse(read('examples/response.invalid-missing-version.json'))).toBe(false);
  });

  it('[TC-PLATFORM-MLSERVICE-003] el parser de la respuesta coincide con el JSON Schema en los ejemplos compartidos', () => {
    expect(() => parseForecastResponse(validResponse)).not.toThrow();
    expect(() => parseForecastResponse(read('examples/response.invalid-missing-version.json'))).toThrow(
      ForecastServiceError,
    );
  });
});

describe('MlForecastingServiceClient', () => {
  it('[TC-FORECAST-SERVICE-025] envía la petición con la credencial de servicio y devuelve la respuesta validada', async () => {
    let seen: { url: string; auth: string | null; body: string } | undefined;
    const res = await client(async (url, init) => {
      seen = {
        url: String(url),
        auth: new Headers(init?.headers).get('authorization'),
        body: String(init?.body),
      };
      return jsonResponse(200, validResponse);
    }).forecast(request);
    expect(seen?.url).toBe('http://ml-forecasting:8090/v1/forecasts');
    expect(seen?.auth).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(seen?.body ?? '{}')).toEqual(request);
    expect(res.results[0]?.points[0]?.prediction).toBe('4350.00');
  });

  it('[TC-FORECAST-SERVICE-029] sin respuesta o 5xx ⇒ servicio no disponible; 503 ocupado también', async () => {
    expect(
      await reasonOf(client(async () => Promise.reject(new TypeError('fetch failed'))).forecast(request)),
    ).toBe('SERVICE_UNAVAILABLE');
    expect(await reasonOf(client(async () => jsonResponse(500, {})).forecast(request))).toBe(
      'SERVICE_UNAVAILABLE',
    );
    expect(await reasonOf(client(async () => jsonResponse(503, {})).forecast(request))).toBe(
      'SERVICE_UNAVAILABLE',
    );
  });

  it('[TC-FORECAST-SERVICE-029] 4xx ⇒ petición rechazada; 504 y tiempo excedido ⇒ TIMEOUT', async () => {
    expect(await reasonOf(client(async () => jsonResponse(400, {})).forecast(request))).toBe(
      'SERVICE_REJECTED',
    );
    expect(await reasonOf(client(async () => jsonResponse(401, {})).forecast(request))).toBe(
      'SERVICE_REJECTED',
    );
    expect(await reasonOf(client(async () => jsonResponse(504, {})).forecast(request))).toBe('TIMEOUT');
    const slow: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    expect(await reasonOf(client(slow, 20).forecast(request))).toBe('TIMEOUT');
  });

  it('[TC-FORECAST-SERVICE-023] un cuerpo que no cumple el contrato es salida inválida', async () => {
    expect(
      await reasonOf(client(async () => jsonResponse(200, { schemaVersion: '1' })).forecast(request)),
    ).toBe('INVALID_OUTPUT');
    expect(
      await reasonOf(client(async () => new Response('no es json', { status: 200 })).forecast(request)),
    ).toBe('INVALID_OUTPUT');
  });
});
