import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { env } from './env';

/** Synchronizer token derivado de la sesión: HMAC(csrfSecret, sid). No se guarda aparte. */
export const csrfTokenFor = (sid: string, csrfSecret: string): string =>
  createHmac('sha256', csrfSecret).update(sid).digest('base64url');

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export type CsrfFailure = { status: 403 | 415; code: string };

/**
 * Defensa en capas para métodos no seguros (docs/12 §3):
 *  1. Cookie SameSite=Lax (el navegador no la envía en POST cross-site).
 *  2. Origin (o Sec-Fetch-Site) debe ser el propio origen.
 *  3. Solo application/json (un <form> cross-site no puede producirlo sin preflight CORS).
 *  4. Header X-CSRF-Token = HMAC(csrfSecret, sid).
 * Se ejecuta ANTES de mirar la sesión: una petición cross-site se rechaza aunque traiga cookie.
 */
export function checkOrigin(req: NextRequest): CsrfFailure | null {
  if (SAFE.has(req.method)) return null;
  const origin = req.headers.get('origin');
  if (origin !== null) return origin === env.appOrigin ? null : { status: 403, code: 'CSRF_ORIGIN_MISMATCH' };
  const site = req.headers.get('sec-fetch-site');
  return site === 'same-origin' ? null : { status: 403, code: 'CSRF_ORIGIN_MISSING' };
}

export function checkContentType(req: NextRequest): CsrfFailure | null {
  if (SAFE.has(req.method)) return null;
  const ct = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  const hasBody = req.headers.get('content-length') !== '0' && req.headers.has('content-type');
  if (!hasBody && req.method === 'DELETE') return null;
  return ct === 'application/json' ? null : { status: 415, code: 'CSRF_CONTENT_TYPE' };
}

export function checkCsrfToken(req: NextRequest, sid: string, csrfSecret: string): CsrfFailure | null {
  if (SAFE.has(req.method)) return null;
  const got = Buffer.from(req.headers.get('x-csrf-token') ?? '');
  const want = Buffer.from(csrfTokenFor(sid, csrfSecret));
  return got.length === want.length && timingSafeEqual(got, want) ? null : { status: 403, code: 'CSRF_TOKEN_INVALID' };
}
