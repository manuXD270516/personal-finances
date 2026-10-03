import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import {
  currentRequestContext,
  runWithRequestContext,
  updateRequestContext,
  uuidFromOpaqueId,
  type RequestContext,
} from '../api/context/request-context.js';
import { clientIpOf, requestContextMiddleware } from './request-context.middleware.js';

const req = (headers: Record<string, string>, remoteAddress = '::ffff:10.0.0.9') =>
  ({ headers, socket: { remoteAddress } }) as unknown as IncomingMessage;

function contextFor(headers: Record<string, string>): RequestContext | undefined {
  let seen: RequestContext | undefined;
  requestContextMiddleware()(req(headers), {} as ServerResponse, () => {
    updateRequestContext({ actor: { type: 'USER', userId: '0190a000-0000-7000-8000-000000000001' } });
    seen = { ...currentRequestContext() };
  });
  return seen;
}

describe('contexto ambiental de la petición (add-audit-trail, atribución)', () => {
  it('[TC-AUDIT-CONTENT-001] origen ui solo con la cabecera del BFF; user agent truncado; Idempotency-Key; actor del guard', () => {
    expect(
      contextFor({ 'x-pfos-origin': 'ui', 'user-agent': 'x'.repeat(600), 'idempotency-key': 'K-1' }),
    ).toMatchObject({
      origin: 'ui',
      userAgent: 'x'.repeat(512),
      idempotencyKey: 'K-1',
      actor: { type: 'USER', userId: '0190a000-0000-7000-8000-000000000001' },
    });
    expect(contextFor({ 'x-pfos-origin': 'mobile' })?.origin).toBe('api');
    expect(contextFor({})).toMatchObject({ origin: 'api', userAgent: null, idempotencyKey: null });
    // Fuera de la petición no queda contexto (no se filtra entre peticiones).
    expect(currentRequestContext()).toBeUndefined();
  });

  it('la IP del cliente sale del primer salto de X-Forwarded-For o del socket; valores no IP se descartan', () => {
    expect(clientIpOf(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' }))).toBe('203.0.113.7');
    expect(clientIpOf(req({}))).toBe('10.0.0.9');
    expect(clientIpOf(req({ 'x-forwarded-for': '<script>' }, ''))).toBeNull();
  });

  it('[TC-AUDIT-ACTOR-001] un job anida su propio actor sin alterar el contexto exterior', () => {
    runWithRequestContext({ actor: { type: 'USER', userId: 'u' }, origin: 'ui' }, () => {
      runWithRequestContext(
        { actor: { type: 'WORKER', process: 'audit.ensure-partitions' }, origin: 'system' },
        () => {
          expect(currentRequestContext()).toMatchObject({ actor: { type: 'WORKER' }, origin: 'system' });
        },
      );
      expect(currentRequestContext()).toMatchObject({ actor: { type: 'USER' }, origin: 'ui' });
    });
  });

  it('un X-Request-Id opaco se convierte en un UUID estable; un UUID se conserva', () => {
    const a = uuidFromOpaqueId('req-abc-12345');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuidFromOpaqueId('req-abc-12345')).toBe(a);
    expect(uuidFromOpaqueId('0190A000-0000-7000-8000-0000000000C1')).toBe(
      '0190a000-0000-7000-8000-0000000000c1',
    );
  });
});
