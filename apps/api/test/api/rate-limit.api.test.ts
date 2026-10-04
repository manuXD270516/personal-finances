import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { apiConfig, baseEnv, capturingLogger } from '../support/harness.js';

// Límite de tasa con el guard de identidad REAL (JWT verificado): todas las peticiones salen de la misma IP, como las
// del BFF. La cuota de lecturas es por usuario autenticado; las anónimas se cuentan por IP antes del 401.
const deps = inject('deps');
const ISSUER = 'https://idp.test/realms/pfos';
const AUDIENCE = 'finance-api';
const READS = 3;

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let signingKey: Key;
let runtime: ApiRuntime;
let baseUrl: string;
const clock = new FixedClock(Instant.parse('2026-10-04T12:00:00Z'));

async function tokenFor(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: ISSUER,
    aud: AUDIENCE,
    sub,
    iat: now - 5,
    exp: now + 300,
    typ: 'Bearer',
    scope: 'openid pfos.api',
    email: `${sub}@pfos.test`,
    email_verified: true,
    name: sub,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-1', typ: 'JWT' })
    .sign(signingKey);
}

const me = (headers: Record<string, string> = {}) => fetch(`${baseUrl}/api/v1/me`, { headers });

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  signingKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-1', alg: 'RS256', use: 'sig' };
  runtime = await createApiRuntime(
    apiConfig(baseEnv(deps, { RATE_LIMIT_READS_PER_MIN: String(READS) })),
    capturingLogger('finance-api', 'api').logger,
    {
      clock,
      identity: {
        jwt: { issuer: ISSUER, audience: AUDIENCE, requiredScope: 'pfos.api', jwks: { keys: [jwk] } },
      },
    },
  );
  baseUrl = await runtime.listen(0, '127.0.0.1');
});

afterAll(async () => {
  await runtime?.close();
});

describe('límite de tasa por usuario detrás del BFF (platform/api-conventions, NFR-SEC-011)', () => {
  it('[TC-PLATFORM-API-020] la cuota de un usuario autenticado no consume la de otro usuario desde la misma IP', async () => {
    const a = await tokenFor(`kc-rl-a-${randomUUID()}`);
    const b = await tokenFor(`kc-rl-b-${randomUUID()}`);
    for (let i = 0; i < READS; i += 1) {
      const r = await me({ authorization: `Bearer ${a}` });
      expect(r.status, await r.text()).toBe(200);
      expect(r.headers.get('ratelimit-policy')).toBe(`"reads";q=${READS};w=60`);
    }
    const limited = await me({ authorization: `Bearer ${a}` });
    expect(limited.status).toBe(429);
    expect(((await limited.json()) as { code: string }).code).toBe('RATE_LIMITED');
    expect(limited.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);

    // Mismo origen (127.0.0.1, como el BFF), otro usuario: cuota propia completa.
    const other = await me({ authorization: `Bearer ${b}` });
    expect(other.status).toBe(200);
    expect(other.headers.get('ratelimit')).toBe(`"reads";r=${READS - 1};t=60`);
  });

  it('[TC-PLATFORM-API-020] anónimas se cuentan por IP antes del 401 y X-Forwarded-For no abre cuotas nuevas', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < READS + 1; i += 1) {
      // Un cliente que rota X-Forwarded-For no consigue un bucket distinto (no hay proxy de confianza configurado).
      statuses.push((await me({ 'x-forwarded-for': `198.51.100.${i + 1}` })).status);
    }
    expect(statuses).toEqual([...Array<number>(READS).fill(401), 429]);
    // Un usuario autenticado desde la misma IP no se ve afectado por el bucket anónimo.
    const c = await tokenFor(`kc-rl-c-${randomUUID()}`);
    expect((await me({ authorization: `Bearer ${c}` })).status).toBe(200);
  });

  it('[TC-PLATFORM-API-020] tokens inválidos repetidos desde una IP ⇒ 429 en vez de 401; un usuario válido desde la misma IP no se ve afectado', async () => {
    clock.set(Instant.parse('2026-10-04T12:05:00Z')); // ventanas nuevas: sin rastro de los tests anteriores
    const garbage = [
      'Bearer garbage',
      'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl',
      'Bearer ',
      `Bearer ${await tokenFor('kc-rl-x')}x`,
    ];
    const statuses: number[] = [];
    for (let i = 0; i < READS + 2; i += 1) {
      statuses.push((await me({ authorization: garbage[i % garbage.length]! })).status);
    }
    expect(statuses).toEqual([...Array<number>(READS).fill(401), 429, 429]);
    const limited = await me({ authorization: 'Bearer garbage' });
    expect(((await limited.json()) as { code: string }).code).toBe('RATE_LIMITED');
    expect(limited.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
    // Tráfico válido (como el del BFF) desde la misma IP: cuota por usuario, intacta.
    const valid = await tokenFor(`kc-rl-d-${randomUUID()}`);
    const ok = await me({ authorization: `Bearer ${valid}` });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('ratelimit')).toBe(`"reads";r=${READS - 1};t=60`);
  });
});
