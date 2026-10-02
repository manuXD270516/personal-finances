import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter, rateLimitHeaders, type RateLimitPolicy } from './rate-limiter.js';

const WRITES: RateLimitPolicy = { name: 'writes', quota: 120, windowSeconds: 60 };

describe('InMemoryRateLimiter (token bucket, design §8)', () => {
  it('[TC-PLATFORM-API-020] 120 escrituras en un minuto pasan y la 121 se rechaza con Retry-After', async () => {
    const limiter = new InMemoryRateLimiter();
    const t0 = Date.parse('2026-10-02T12:00:00Z');
    for (let i = 0; i < 120; i += 1) {
      const d = await limiter.consume('user:u1', WRITES, new Date(t0 + i * 100));
      expect(d.allowed, `petición ${i + 1}`).toBe(true);
    }
    const rejected = await limiter.consume('user:u1', WRITES, new Date(t0 + 12_000));
    expect(rejected.allowed).toBe(false);
    expect(rejected.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(rateLimitHeaders(WRITES, rejected)).toEqual({
      'ratelimit-policy': '"writes";q=120;w=60',
      ratelimit: `"writes";r=0;t=${rejected.resetSeconds}`,
    });
    // Otro usuario tiene su propio bucket; tras esperar Retry-After vuelve a haber cuota.
    expect((await limiter.consume('user:u2', WRITES, new Date(t0 + 12_000))).allowed).toBe(true);
    const later = new Date(t0 + 12_000 + rejected.retryAfterSeconds * 1000);
    expect((await limiter.consume('user:u1', WRITES, later)).allowed).toBe(true);
  });

  it('[TC-PLATFORM-API-020] la ventana es deslizante: la cuota se libera a medida que las peticiones salen de ella', async () => {
    const limiter = new InMemoryRateLimiter();
    const t0 = Date.parse('2026-10-02T12:00:00Z');
    const first = await limiter.consume('k', WRITES, new Date(t0));
    expect(first.remaining).toBe(119);
    expect(first.resetSeconds).toBe(60);
    const muchLater = await limiter.consume('k', WRITES, new Date(t0 + 3_600_000));
    expect(muchLater.remaining).toBe(119);
    const small: RateLimitPolicy = { name: 'writes', quota: 2, windowSeconds: 60 };
    await limiter.consume('s', small, new Date(t0));
    await limiter.consume('s', small, new Date(t0 + 30_000));
    const denied = await limiter.consume('s', small, new Date(t0 + 59_000));
    expect(denied).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    expect((await limiter.consume('s', small, new Date(t0 + 60_001))).allowed).toBe(true);
  });

  it('acota la memoria descartando buckets llenos', async () => {
    const limiter = new InMemoryRateLimiter(2);
    const t0 = Date.parse('2026-10-02T12:00:00Z');
    await limiter.consume('a', WRITES, new Date(t0));
    await limiter.consume('b', WRITES, new Date(t0));
    const c = await limiter.consume('c', WRITES, new Date(t0 + 120_000));
    expect(c.allowed).toBe(true);
  });
});
