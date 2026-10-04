import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { lastValueFrom, of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { ApiContract, ApiProblem, InMemoryRateLimiter } from '../../api/index.js';
import {
  chargeFailedAuthentication,
  RateLimitGuard,
  RateLimitInterceptor,
  rateLimitSubject,
} from './interceptors.js';
import type { ApiConventionsOptions } from './options.js';
import { setPrincipal, type ApiRequest, type ApiResponse } from './request-context.js';

const WS = '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9e99';

const contract = ApiContract.fromDocument({
  openapi: '3.1.0',
  info: { title: 't', version: '1' },
  paths: {
    '/workspaces/{workspaceId}/things': {
      get: {
        operationId: 'listThings',
        parameters: [{ name: 'workspaceId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
  },
});

function options(quota = 2): ApiConventionsOptions {
  return {
    contract,
    clock: new FixedClock(Instant.parse('2026-10-04T12:00:00Z')),
    problemTypeBase: 'https://pfos.dev/problems/',
    idempotency: {} as ApiConventionsOptions['idempotency'],
    cursors: {} as ApiConventionsOptions['cursors'],
    rateLimit: {
      limiter: new InMemoryRateLimiter(),
      reads: { name: 'reads', quota, windowSeconds: 60 },
      writes: { name: 'writes', quota, windowSeconds: 60 },
    },
  };
}

interface Fake {
  req: ApiRequest;
  res: ApiResponse & { headers: Record<string, string> };
  ctx: ExecutionContext;
}

function request(
  over: { ip?: string; authorization?: string; forwardedFor?: string; workspaceId?: string } = {},
): Fake {
  const headers: Record<string, string> = {};
  if (over.authorization) headers['authorization'] = over.authorization;
  if (over.forwardedFor) headers['x-forwarded-for'] = over.forwardedFor;
  const req = {
    method: 'GET',
    headers,
    route: { path: '/api/v1/workspaces/:workspaceId/things' },
    params: { workspaceId: over.workspaceId ?? WS },
    ip: over.ip ?? '10.0.0.5',
    socket: { remoteAddress: over.ip ?? '10.0.0.5' },
  } as unknown as ApiRequest;
  const sent: Record<string, string> = {};
  const res = {
    headers: sent,
    setHeader: (k: string, v: string) => {
      sent[k.toLowerCase()] = v;
    },
  } as unknown as Fake['res'];
  const ctx = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { req, res, ctx };
}

const handler: CallHandler = { handle: () => of('ok') };

/** Guard global → (guard de identidad: `authenticate`) → interceptor: el orden real del pipeline de Nest. */
async function pass(
  opts: ApiConventionsOptions,
  fake: Fake,
  authenticate?: string | false,
): Promise<'ok' | string> {
  try {
    await new RateLimitGuard(opts).canActivate(fake.ctx);
    if (authenticate === false) {
      // Guard de identidad con token inválido: cobra la cuota de la IP y responde 401 (o 429 si se agotó).
      await chargeFailedAuthentication(opts, fake.req);
      throw new ApiProblem('UNAUTHENTICATED');
    }
    if (authenticate) setPrincipal(fake.req, { userId: authenticate });
    return (await lastValueFrom(new RateLimitInterceptor(opts).intercept(fake.ctx, handler))) as 'ok';
  } catch (err) {
    if (err instanceof ApiProblem) return err.code;
    throw err;
  }
}

describe('límite de tasa por usuario (platform/api-conventions, NFR-SEC-011)', () => {
  it('[TC-PLATFORM-API-020] autenticadas por el BFF (misma IP): la cuota es por usuario verificado, no por IP', async () => {
    const opts = options(2);
    const viaBff = (user: string, workspaceId: string) =>
      pass(opts, request({ ip: '172.18.0.9', authorization: 'Bearer x', workspaceId }), user);
    expect(await viaBff('user-a', WS)).toBe('ok');
    expect(await viaBff('user-a', WS)).toBe('ok');
    expect(await viaBff('user-a', WS)).toBe('RATE_LIMITED');
    // Otro usuario (en su workspace) detrás del MISMO BFF conserva su cuota: antes compartían el bucket de la IP.
    expect(await viaBff('user-b', '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9e98')).toBe('ok');
  });

  it('[TC-PLATFORM-API-020] la cuota se consume UNA vez por petición y fija RateLimit/RateLimit-Policy', async () => {
    const opts = options(5);
    const fake = request({ authorization: 'Bearer x' });
    expect(await pass(opts, fake, 'user-a')).toBe('ok');
    expect(fake.res.headers['ratelimit-policy']).toBe('"reads";q=5;w=60');
    expect(fake.res.headers['ratelimit']).toMatch(/^"reads";r=4;t=\d+$/);
  });

  it('[TC-PLATFORM-API-020] anónimas (sin Authorization) se cuentan por IP ANTES de la identidad', async () => {
    const opts = options(1);
    expect(await pass(opts, request({ ip: '203.0.113.7' }))).toBe('ok');
    expect(await pass(opts, request({ ip: '203.0.113.7' }))).toBe('RATE_LIMITED');
    // La guard sola ya rechaza (antes de que el guard de identidad responda 401).
    await expect(
      new RateLimitGuard(opts).canActivate(request({ ip: '203.0.113.7' }).ctx),
    ).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(
      await pass(opts, request({ ip: '203.0.113.8', workspaceId: '0192f3c4-7b2e-7c1a-9d8e-3f2a1b0c9e97' })),
    ).toBe('ok');
  });

  it('X-Forwarded-For no cambia el sujeto anónimo (solo `req.ip`, que respeta `trust proxy`)', () => {
    const a = request({ ip: '172.18.0.9', forwardedFor: '198.51.100.1' });
    const b = request({ ip: '172.18.0.9', forwardedFor: '198.51.100.2' });
    expect(rateLimitSubject(a.req)).toBe('ip:172.18.0.9');
    expect(rateLimitSubject(b.req)).toBe('ip:172.18.0.9');
    setPrincipal(a.req, { userId: 'user-a' });
    expect(rateLimitSubject(a.req)).toBe('user:user-a');
  });

  it('con credenciales pero sin identidad montada (local/ci) se cuenta por IP en el interceptor', async () => {
    const opts = options(1);
    expect(await pass(opts, request({ ip: '10.1.1.1', authorization: 'Bearer x' }))).toBe('ok');
    expect(await pass(opts, request({ ip: '10.1.1.1', authorization: 'Bearer x' }))).toBe('RATE_LIMITED');
  });

  it('[TC-PLATFORM-API-020] tokens inválidos repetidos desde una IP ⇒ 429; un usuario válido desde la misma IP no se ve afectado', async () => {
    const opts = options(2);
    const garbage = () => pass(opts, request({ ip: '172.18.0.9', authorization: 'Bearer garbage' }), false);
    expect(await garbage()).toBe('UNAUTHENTICATED');
    expect(await garbage()).toBe('UNAUTHENTICATED');
    expect(await garbage()).toBe('RATE_LIMITED');
    expect(await garbage()).toBe('RATE_LIMITED');
    expect(await pass(opts, request({ ip: '172.18.0.9', authorization: 'Bearer valid' }), 'user-a')).toBe(
      'ok',
    );
  });

  it('una petición anónima ya contada por el guard no se cobra dos veces al fallar la autenticación', async () => {
    const opts = options(2);
    const anon = () => pass(opts, request({ ip: '203.0.113.9' }), false);
    expect(await anon()).toBe('UNAUTHENTICATED');
    expect(await anon()).toBe('UNAUTHENTICATED');
    expect(await anon()).toBe('RATE_LIMITED');
  });
});
