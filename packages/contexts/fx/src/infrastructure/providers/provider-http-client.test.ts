import { FixedClock, Instant } from '@pf/shared-kernel';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ProviderError } from '../../domain/index.js';
import { fixture, FixtureServer } from './fixture-server.test-support.js';
import { maxAgeMs, PROVIDER_USER_AGENT, ProviderHttpClient, retryAfterMs } from './provider-http-client.js';

// Cliente HTTP de providers contra un servidor LOCAL (sin red): límites de uso, caché, Retry-After, timeout y
// privacidad de la solicitud (fx/market-rate-providers; design.md decisiones 9 y 10).
const server = new FixtureServer();
let clock: FixedClock;
let client: ProviderHttpClient;
const RATE = '/api/v1/rate';

const newClient = (timeoutMs = 2000) =>
  new ProviderHttpClient({ clock, timeoutMs, allowedHosts: ['127.0.0.1'] });

async function errorOf(p: Promise<unknown>): Promise<ProviderError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ProviderError) return err;
    throw err;
  }
  throw new Error('expected a ProviderError');
}

beforeAll(async () => {
  await server.start();
});
afterAll(async () => {
  await server.stop();
});
afterEach(() => {
  server.requests.length = 0;
});

describe('ProviderHttpClient (fx/market-rate-providers)', () => {
  it('[TC-FX-PROVIDER-011] 429 con Retry-After 120: ninguna solicitud antes de las 09:02:00Z', async () => {
    clock = new FixedClock(Instant.parse('2026-10-02T09:00:00Z'));
    client = newClient();
    server.route(RATE, { status: 429, headers: { 'retry-after': '120' }, body: '{"error":"rate limited"}' });
    const first = await errorOf(client.getText('PARALELO_BO', `${server.baseUrl}${RATE}`, 60));
    expect([first.code, first.httpStatus, first.retryAfterUntil]).toEqual([
      'PROVIDER_RATE_LIMITED',
      429,
      '2026-10-02T09:02:00.000Z',
    ]);
    clock.set(Instant.parse('2026-10-02T09:01:00Z'));
    const waiting = await errorOf(client.getText('PARALELO_BO', `${server.baseUrl}${RATE}`, 60));
    expect(waiting.code).toBe('PROVIDER_RATE_LIMITED');
    expect(server.requestsTo(RATE)).toHaveLength(1);
    clock.set(Instant.parse('2026-10-02T09:02:00Z'));
    server.route(RATE, { body: fixture('paralelo-bo/rate.ok.json') });
    await client.getText('PARALELO_BO', `${server.baseUrl}${RATE}`, 60);
    expect(server.requestsTo(RATE)).toHaveLength(2);
  });

  it('[TC-FX-PROVIDER-011] caché max-age 60: la lectura de las 09:00:30Z reutiliza la respuesta de las 09:00:00Z', async () => {
    clock = new FixedClock(Instant.parse('2026-10-02T09:00:00Z'));
    client = newClient();
    server.route(RATE, {
      body: fixture('paralelo-bo/rate.ok.json'),
      headers: { 'cache-control': 'public, max-age=60', 'ratelimit-limit': '60' },
    });
    const a = await client.getText('PARALELO_BO', `${server.baseUrl}${RATE}`, 60);
    clock.set(Instant.parse('2026-10-02T09:00:30Z'));
    const b = await client.getText('PARALELO_BO', `${server.baseUrl}${RATE}`, 60);
    expect(server.requestsTo(RATE)).toHaveLength(1);
    expect([a.fromCache, b.fromCache, b.body, b.fetchedAt]).toEqual([
      false,
      true,
      a.body,
      '2026-10-02T09:00:00.000Z',
    ]);
    clock.set(Instant.parse('2026-10-02T09:01:00Z'));
    expect((await client.getText('PARALELO_BO', `${server.baseUrl}${RATE}`, 60)).fromCache).toBe(false);
    expect(server.requestsTo(RATE)).toHaveLength(2);
  });

  it('[TC-FX-PROVIDER-011] ráfaga de 100 lecturas en 1 minuto: como máximo 60 solicitudes a paralelo.bo', async () => {
    clock = new FixedClock(Instant.parse('2026-10-02T09:00:00Z'));
    client = newClient();
    server.route(RATE, {
      body: fixture('paralelo-bo/rate.ok.json'),
      headers: { 'cache-control': 'no-store' },
    });
    let limited = 0;
    for (let i = 0; i < 100; i++) {
      clock.set(Instant.ofEpochMillis(Date.parse('2026-10-02T09:00:00Z') + i * 500));
      try {
        await client.getText('PARALELO_BO', `${server.baseUrl}${RATE}`, 60);
      } catch (err) {
        if (!(err instanceof ProviderError) || err.code !== 'PROVIDER_RATE_LIMITED') throw err;
        limited++;
      }
    }
    expect(server.requestsTo(RATE).length).toBeLessThanOrEqual(60);
    expect(server.requestsTo(RATE).length + limited).toBe(100);
  });

  it('[TC-FX-PROVIDER-013] la solicitud es un GET anónimo: sin query, cuerpo, Cookie ni Authorization; solo Accept y User-Agent', async () => {
    clock = new FixedClock(Instant.parse('2026-10-02T09:00:00Z'));
    client = newClient();
    server.route(RATE, { body: fixture('paralelo-bo/rate.ok.json') });
    await client.getText('PARALELO_BO', `${server.baseUrl}${RATE}`, 60);
    const [req] = server.requestsTo(RATE);
    expect(req?.method).toBe('GET');
    expect(req?.url).toBe(RATE);
    expect(req?.body).toBe('');
    const names = Object.keys(req?.headers ?? {}).sort();
    expect(names).toEqual(['accept', 'connection', 'host', 'user-agent']);
    expect(req?.headers['user-agent']).toBe(PROVIDER_USER_AGENT);
    expect(req?.headers['user-agent']).toMatch(/^PFOS-fx\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\//);
    expect(req?.headers['accept']).toBe('application/json');
    // URLs con query o credenciales y hosts fuera de la allowlist nunca se consultan.
    expect((await errorOf(client.getText('PARALELO_BO', `${server.baseUrl}${RATE}?ws=1`, 60))).code).toBe(
      'PROVIDER_UNAVAILABLE',
    );
    expect((await errorOf(client.getText('PARALELO_BO', 'https://example.com/api/v1/rate', 60))).code).toBe(
      'PROVIDER_UNAVAILABLE',
    );
    expect(server.requestsTo(RATE)).toHaveLength(1);
  });

  it('[TC-FX-PROVIDER-014] provider lento: el intento termina en PROVIDER_TIMEOUT; 503 y redirecciones son PROVIDER_UNAVAILABLE', async () => {
    clock = new FixedClock(Instant.parse('2026-10-02T09:00:00Z'));
    client = newClient(200);
    server.route(RATE, { body: '{}', delayMs: 1500 });
    expect((await errorOf(client.getText('PARALELO_BO', `${server.baseUrl}${RATE}`, 60))).code).toBe(
      'PROVIDER_TIMEOUT',
    );
    server.route(RATE, { status: 503, body: '{"error":"down"}' });
    const down = await errorOf(client.getText('PARALELO_BO', `${server.baseUrl}${RATE}`, 60));
    expect([down.code, down.httpStatus]).toEqual(['PROVIDER_UNAVAILABLE', 503]);
    server.route(RATE, { status: 302, headers: { location: 'https://evil.example/' } });
    expect((await errorOf(client.getText('PARALELO_BO', `${server.baseUrl}${RATE}`, 60))).code).toBe(
      'PROVIDER_UNAVAILABLE',
    );
  });

  it('interpreta Retry-After (segundos o fecha; 60 s por defecto) y max-age − Age', () => {
    const now = Date.parse('2026-10-02T09:00:00Z');
    expect(retryAfterMs('120', now)).toBe(120_000);
    expect(retryAfterMs(undefined, now)).toBe(60_000);
    expect(retryAfterMs('Fri, 02 Oct 2026 09:05:00 GMT', now)).toBe(300_000);
    expect(maxAgeMs('public, max-age=60', '18')).toBe(42_000);
    expect(maxAgeMs('public, max-age=0, must-revalidate', undefined)).toBe(0);
    expect(maxAgeMs('no-store', undefined)).toBe(0);
  });
});
