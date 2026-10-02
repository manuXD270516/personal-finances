import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { getSession, destroySession, type SessionData } from '@/lib/session';
import { checkContentType, checkCsrfToken, checkOrigin } from '@/lib/csrf';
import { ensureFreshAccessToken, refresh, SessionExpired } from '@/lib/tokens';
import { clearSessionCookie, problem, sidOf } from '@/lib/http';

export const dynamic = 'force-dynamic';

const FORWARD_REQ_HEADERS = ['content-type', 'accept', 'idempotency-key', 'if-match', 'traceparent'];
const FORWARD_RES_HEADERS = ['content-type', 'etag', 'location', 'retry-after'];

/**
 * Proxy BFF: /api/bff/<path> -> ${API_URL}/api/v1/<path> con Authorization: Bearer <access_token>.
 * El navegador solo ve el JSON de la API; el token vive en el session store.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  // 1) CSRF antes de tocar la sesión
  const bad = checkOrigin(req) ?? checkContentType(req);
  if (bad) return problem(bad.status, bad.code);

  const sid = sidOf(req);
  let s = await getSession(sid);
  if (!s || !sid) return problem(401, 'SESSION_REQUIRED');
  const badToken = checkCsrfToken(req, sid, s.csrfSecret);
  if (badToken) return problem(badToken.status, badToken.code);

  const { path } = await ctx.params;
  if (path.some((p) => p === '..' || p === '.' || p === '')) return problem(400, 'BAD_PATH');
  const target = new URL(`${env.apiUrl}/api/v1/${path.map(encodeURIComponent).join('/')}`);
  target.search = req.nextUrl.search;

  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer();
  const call = (session: SessionData) => {
    const headers = new Headers();
    for (const h of FORWARD_REQ_HEADERS) {
      const v = req.headers.get(h);
      if (v) headers.set(h, v);
    }
    headers.set('authorization', `Bearer ${session.accessToken}`);
    return fetch(target, { method: req.method, headers, body, redirect: 'manual', cache: 'no-store' });
  };

  let upstream: Response;
  try {
    s = await ensureFreshAccessToken(sid, s); // refresh transparente si expira en < 60 s
    upstream = await call(s);
    if (upstream.status === 401) {
      // token revocado/rotado por el IdP antes de exp: un reintento tras refresh forzado
      s = await refresh(sid, s);
      upstream = await call(s);
    }
  } catch (e) {
    if (e instanceof SessionExpired) {
      await destroySession(sid);
      const res = problem(401, 'SESSION_EXPIRED');
      clearSessionCookie(res);
      return res;
    }
    console.error(e);
    return problem(502, 'UPSTREAM_UNAVAILABLE');
  }

  const headers = new Headers({ 'Cache-Control': 'no-store' });
  for (const h of FORWARD_RES_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
