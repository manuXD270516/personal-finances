import { FixedClock, Instant } from '@pf/shared-kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProviderError } from '../../domain/index.js';
import { DolarApiBoProvider, midpoint } from './dolarapi-bo.provider.js';
import { fixture, FixtureServer } from './fixture-server.test-support.js';
import { ParaleloBoProvider } from './paralelo-bo.provider.js';
import { ProviderHttpClient } from './provider-http-client.js';

// Contract tests de los adapters ACL contra RESPUESTAS GRABADAS (test/fixtures/providers) servidas por un servidor
// HTTP local: sin red (design.md decisión 14; tarea 4.3).
const server = new FixtureServer();
const clock = new FixedClock(Instant.parse('2026-10-02T09:00:00Z'));
let paralelo: ParaleloBoProvider;
let dolarapi: DolarApiBoProvider;

const fresh = () => {
  const http = new ProviderHttpClient({ clock, timeoutMs: 2000, allowedHosts: ['127.0.0.1'] });
  paralelo = new ParaleloBoProvider(http, clock, server.baseUrl);
  dolarapi = new DolarApiBoProvider(http, server.baseUrl);
};

async function errorOf(p: Promise<unknown>): Promise<ProviderError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ProviderError) return err;
    throw err;
  }
  throw new Error('expected a ProviderError');
}

const plain = (s: {
  base: string;
  quote: string;
  rateType: string;
  value: string;
  asOf: string;
  provider: string;
}) => ({
  pair: `${s.base}/${s.quote}`,
  rateType: s.rateType,
  value: s.value,
  asOf: s.asOf,
  provider: s.provider,
});

beforeAll(async () => {
  await server.start();
});
afterAll(async () => {
  await server.stop();
});

describe('ParaleloBoProvider (contrato contra respuestas grabadas)', () => {
  it('[TC-FX-PROVIDER-001] rate.ok.json → USD/BOB y USDT/BOB PARALLEL = mediana 12.02 con vigencia publicada; buy/sell solo en el crudo', async () => {
    fresh();
    const body = fixture('paralelo-bo/rate.ok.json');
    server.route('/api/v1/rate', {
      body,
      headers: { 'cache-control': 'public, max-age=60', 'ratelimit-limit': '60' },
    });
    const samples = await paralelo.fetchLatest();
    expect(samples.map(plain)).toEqual([
      {
        pair: 'USD/BOB',
        rateType: 'PARALLEL',
        value: '12.02',
        asOf: '2026-10-02T08:53:07.532Z',
        provider: 'PARALELO_BO',
      },
      {
        pair: 'USDT/BOB',
        rateType: 'PARALLEL',
        value: '12.02',
        asOf: '2026-10-02T08:53:07.532Z',
        provider: 'PARALELO_BO',
      },
    ]);
    for (const s of samples) {
      expect(s.fetchedAt).toBe('2026-10-02T09:00:00.000Z');
      expect(s.rawPayload).toBe(body);
      expect(s.rawPayload).toContain('"buy":12.12');
      expect(s.rawPayload).toContain('"sell":11.92');
      expect(s.rawPayload).toContain('"spreadPct":-1.6972');
      expect(s.rawPayload).toContain('"sourceCount":4');
      expect(['12.12', '11.92']).not.toContain(s.value);
    }
    expect(paralelo.descriptor().attribution).toEqual({
      provider: 'PARALELO_BO',
      text: 'Fuente: paralelo.bo',
      url: 'https://paralelo.bo',
      license: 'CC BY 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    });
  });

  it('[TC-FX-PROVIDER-003] rate.18-decimals.json se registra como "12.020000000000000001"', async () => {
    fresh();
    server.route('/api/v1/rate', { body: fixture('paralelo-bo/rate.18-decimals.json') });
    const [usd] = await paralelo.fetchLatest();
    expect(usd?.value).toBe('12.020000000000000001');
  });

  it('[TC-FX-PROVIDER-004] median null ⇒ PROVIDER_PAYLOAD_INVALID; schema cambiado ⇒ PROVIDER_SCHEMA_CHANGED; 503 y cuerpo truncado', async () => {
    fresh();
    server.route('/api/v1/rate', { body: fixture('paralelo-bo/rate.median-null.json') });
    expect((await errorOf(paralelo.fetchLatest())).code).toBe('PROVIDER_PAYLOAD_INVALID');
    for (const variant of ['"N/A"', '0', '-12.02', '12.0200000000000000001']) {
      fresh();
      server.route('/api/v1/rate', {
        body: `{"timestamp":"2026-10-02T09:10:00.000Z","buy":12.12,"sell":11.92,"median":${variant},"sourceCount":4}`,
      });
      expect((await errorOf(paralelo.fetchLatest())).code, variant).toBe('PROVIDER_PAYLOAD_INVALID');
    }
    fresh();
    server.route('/api/v1/rate', { body: fixture('paralelo-bo/rate.schema-changed.json') });
    expect((await errorOf(paralelo.fetchLatest())).code).toBe('PROVIDER_SCHEMA_CHANGED');
    fresh();
    server.route('/api/v1/rate', { body: fixture('paralelo-bo/rate.truncated.json') });
    expect((await errorOf(paralelo.fetchLatest())).code).toBe('PROVIDER_PAYLOAD_INVALID');
    fresh();
    server.route('/api/v1/rate', { status: 503, body: '{"error":"unavailable"}' });
    const down = await errorOf(paralelo.fetchLatest());
    expect([down.code, down.httpStatus]).toEqual(['PROVIDER_UNAVAILABLE', 503]);
  });

  it('[TC-FX-PROVIDER-006] historical.sample.json: 787 días completos por par; el día en curso se omite; 2026-09-10 = 11.96 al cierre en La Paz', async () => {
    fresh();
    const at = new FixedClock(Instant.parse('2026-10-02T12:00:00Z'));
    const http = new ProviderHttpClient({ clock: at, timeoutMs: 2000, allowedHosts: ['127.0.0.1'] });
    server.route('/api/v1/historical.json', { body: fixture('paralelo-bo/historical.sample.json') });
    const samples = await new ParaleloBoProvider(http, at, server.baseUrl).fetchHistory();
    const usd = samples.filter((s) => s.base === 'USD');
    const usdt = samples.filter((s) => s.base === 'USDT');
    expect([usd.length, usdt.length]).toEqual([787, 787]);
    expect(usd[0]?.asOf).toBe('2024-08-07T03:59:59.000Z');
    expect(usd.at(-1)?.asOf).toBe('2026-10-02T03:59:59.000Z');
    const sep10 = usd.find((s) => s.asOf === '2026-09-11T03:59:59.000Z');
    expect([sep10?.value, sep10?.rateType, sep10?.provider]).toEqual(['11.96', 'PARALLEL', 'PARALELO_BO']);
    expect(sep10?.rawPayload).toContain('"point":{"t":"2026-09-10T12:00:00.000Z","v":11.96}');
    expect(samples.some((s) => s.asOf.startsWith('2026-10-02T') && s.asOf > '2026-10-02T04')).toBe(false);
  });

  it('una respuesta grabada en vivo (2026-10-03) sigue cumpliendo el contrato del adapter', async () => {
    fresh();
    server.route('/api/v1/rate', { body: fixture('paralelo-bo/rate.recorded-2026-10-03.json') });
    const samples = await paralelo.fetchLatest();
    expect(samples).toHaveLength(2);
    expect(samples[0]?.value).toMatch(/^\d+(\.\d{1,18})?$/);
  });
});

describe('DolarApiBoProvider (contrato contra respuestas grabadas)', () => {
  it('[TC-FX-PROVIDER-002] oficial 12/12 → OFFICIAL USD/BOB 12; binance 12.04/12.07 → PARALLEL USD/BOB y USDT/BOB 12.055 exacto', async () => {
    fresh();
    server.route('/v1/dolares', { body: fixture('dolarapi-bo/dolares.ok.json') });
    const samples = await dolarapi.fetchLatest();
    expect(samples.map(plain)).toEqual([
      {
        pair: 'USD/BOB',
        rateType: 'OFFICIAL',
        value: '12',
        asOf: '2026-10-01T00:00:00.000Z',
        provider: 'DOLARAPI_BO',
      },
      {
        pair: 'USD/BOB',
        rateType: 'PARALLEL',
        value: '12.055',
        asOf: '2026-10-02T08:50:00.000Z',
        provider: 'DOLARAPI_BO',
      },
      {
        pair: 'USDT/BOB',
        rateType: 'PARALLEL',
        value: '12.055',
        asOf: '2026-10-02T08:50:00.000Z',
        provider: 'DOLARAPI_BO',
      },
    ]);
    expect(dolarapi.descriptor().attribution).toMatchObject({
      text: 'Fuente: bo.dolarapi.com',
      url: 'https://bo.dolarapi.com',
      license: null,
    });
    expect(await dolarapi.fetchHistory()).toEqual([]);
  });

  it('[TC-FX-PROVIDER-002] casas distintas de oficial y binance no generan tasas; sin ninguna de ellas ⇒ PROVIDER_SCHEMA_CHANGED', async () => {
    fresh();
    server.route('/v1/dolares', {
      body: '[{"moneda":"USD","casa":"blue","compra":13,"venta":13.2,"fechaActualizacion":"2026-10-02T08:50:00.000Z"},{"moneda":"USD","casa":"binance","compra":12.04,"venta":12.07,"fechaActualizacion":"2026-10-02T08:50:00.000Z"}]',
    });
    expect((await dolarapi.fetchLatest()).every((s) => s.value === '12.055')).toBe(true);
    fresh();
    server.route('/v1/dolares', { body: '[{"moneda":"USD","casa":"blue","compra":13,"venta":13.2}]' });
    expect((await errorOf(dolarapi.fetchLatest())).code).toBe('PROVIDER_SCHEMA_CHANGED');
  });

  it('[TC-FX-PROVIDER-002] la respuesta grabada en vivo (multilínea) se lee y el punto medio es exacto', async () => {
    fresh();
    server.route('/v1/dolares', { body: fixture('dolarapi-bo/dolares.recorded-2026-10-03.json') });
    const samples = await dolarapi.fetchLatest();
    expect(samples.map((s) => `${s.base}/${s.rateType}=${s.value}`)).toEqual([
      'USD/OFFICIAL=12',
      'USD/PARALLEL=11.98',
      'USDT/PARALLEL=11.98',
    ]);
    expect(midpoint('12.04', '12.07')).toBe('12.055');
    expect(midpoint('0.000000000000000001', '0.000000000000000002')).toBe('0.000000000000000002');
  });
});
