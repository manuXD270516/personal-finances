import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { Bff, LOGIN_COOKIE, SESSION_COOKIE, type Clock } from '../../src/bff/bff';
import { OidcGrantRejected, type OidcClient, type OidcTokens } from '../../src/bff/oidc-client';
import { SessionCipher, hashSid, parseSessionKeys } from '../../src/bff/session-crypto';
import { PgSessionStore } from '../../src/bff/session-store';

// BFF contra PostgreSQL real (`iam.bff_session`, rol `pf_bff`) con un IdP falso y un finance-api falso. El global
// setup de apps/api levanta postgres:18 con Testcontainers y ejecuta `migrate` (que fija la contraseña de pf_bff).
declare module 'vitest' {
  export interface ProvidedContext {
    deps: { databaseUrl: string; bffDatabaseUrl: string; migratorUrl: string };
  }
}
const deps = inject('deps');

const APP = 'http://localhost:23000';
const API = 'http://finance-api.test';
const ISSUER = 'http://idp.test/realms/pfos';
const MIN = 60_000;
const T0 = Date.parse('2026-10-02T12:00:00Z');
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

class ManualClock implements Clock {
  constructor(public t: number) {}
  now(): number {
    return this.t;
  }
}

let seq = 0;
const fakeJwt = (kind: string) =>
  `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ kind, n: ++seq })).toString('base64url')}.c2lnbmF0dXJlLXZhbGlk`;

/** IdP falso: cuenta refresh/revocaciones; el refresh tarda 50 ms para abrir la ventana de carrera. */
class FakeIdp implements OidcClient {
  refreshCalls = 0;
  revoked: string[] = [];
  rejectRefresh = false;
  issued: OidcTokens[] = [];
  async authorizationUrl(input: Parameters<OidcClient['authorizationUrl']>[0]): Promise<URL> {
    const url = new URL(`${ISSUER}/protocol/openid-connect/auth`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: 'pfos-web',
      redirect_uri: input.redirectUri,
      scope: input.scope,
      state: input.state,
      nonce: input.nonce,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      ...(input.reauth ? { prompt: 'login', max_age: '0' } : {}),
    }).toString();
    return url;
  }
  async exchangeCode(url: URL): Promise<OidcTokens> {
    if (url.searchParams.get('code') !== 'good-code') throw new OidcGrantRejected('bad code');
    return this.mint(300);
  }
  async refresh(): Promise<OidcTokens> {
    this.refreshCalls += 1;
    await new Promise((r) => setTimeout(r, 50));
    if (this.rejectRefresh) throw new OidcGrantRejected('invalid_grant');
    return this.mint(300);
  }
  async revoke(token: string): Promise<void> {
    this.revoked.push(token);
  }
  async endSessionUrl(input: { idToken?: string; postLogoutRedirectUri: string }): Promise<URL> {
    const url = new URL(`${ISSUER}/protocol/openid-connect/logout`);
    url.searchParams.set('post_logout_redirect_uri', input.postLogoutRedirectUri);
    if (input.idToken) url.searchParams.set('id_token_hint', input.idToken);
    return url;
  }
  mint(expiresIn: number): OidcTokens {
    const t = {
      accessToken: fakeJwt('access'),
      expiresIn,
      refreshToken: fakeJwt('refresh'),
      idToken: fakeJwt('id'),
    };
    this.issued.push(t);
    return t;
  }
}

interface ApiCall {
  method: string;
  url: string;
  authorization: string | null;
  headers: Headers;
  body: string | undefined;
}

/**
 * finance-api falso: `/api/v1/me` devuelve el usuario provisionado; `/api/v1/me/session-events` 204 (o el estado de
 * `sessionEventsStatus`); el resto 200.
 */
function fakeApi(userId: () => string) {
  const calls: ApiCall[] = [];
  const state = { sessionEventsStatus: 204 };
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body =
      init?.body instanceof ArrayBuffer || ArrayBuffer.isView(init?.body)
        ? new TextDecoder().decode(init.body as ArrayBuffer)
        : typeof init?.body === 'string'
          ? init.body
          : undefined;
    calls.push({
      method: init?.method ?? 'GET',
      url,
      authorization: headers.get('authorization'),
      headers,
      body,
    });
    if (url.endsWith('/api/v1/me')) return Response.json({ id: userId(), displayName: 'Owner Demo' });
    if (url.endsWith('/api/v1/me/session-events')) {
      return state.sessionEventsStatus === 204
        ? new Response(null, { status: 204 })
        : Response.json({ code: 'INTERNAL_ERROR' }, { status: state.sessionEventsStatus });
    }
    if (url.includes('/lifecycle/export')) {
      return new Response('\uFEFFsequence,kind\r\n1,TRANSITION\r\n', {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': 'attachment; filename="recorrido-Category-c1.csv"',
        },
      });
    }
    if (init?.method === 'POST') {
      return Response.json(
        { id: randomUUID() },
        { status: 201, headers: { location: '/api/v1/workspaces/abc', etag: '"1"' } },
      );
    }
    return Response.json({ ok: true }, { headers: { etag: '"7"' } });
  };
  return { calls, state, fetch: impl as typeof fetch };
}

let pool: Pool;
let admin: Client;
let userId: string;
const cipher = new SessionCipher(parseSessionKeys(`it1:${'k'.repeat(40)}`));

function setup(timeouts = { idleMs: 30 * MIN, absoluteMs: 12 * 60 * MIN }) {
  const clock = new ManualClock(T0);
  const idp = new FakeIdp();
  const api = fakeApi(() => userId);
  const store = new PgSessionStore(pool, cipher);
  const make = () =>
    new Bff({
      store,
      oidc: idp,
      clock,
      fetch: api.fetch,
      settings: { appOrigin: APP, apiBaseUrl: API, scope: 'openid profile email pfos.api', timeouts },
    });
  return { clock, idp, api, store, bff: make(), make };
}

const cookieOf = (res: Response, name: string): string | undefined =>
  res.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0]
    ?.slice(name.length + 1);

const setCookieHeader = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));

/** Login completo contra el IdP falso: devuelve el `sid` de la cookie de sesión. */
async function login(bff: Bff, returnTo = '/configuracion'): Promise<{ sid: string; authorize: URL }> {
  const start = await bff.login(
    new Request(`${APP}/api/bff/auth/login?returnTo=${encodeURIComponent(returnTo)}`),
  );
  const authorize = new URL(start.headers.get('location')!);
  const loginSid = cookieOf(start, LOGIN_COOKIE)!;
  const cb = await bff.callback(
    new Request(`${APP}/api/bff/auth/callback?code=good-code&state=${authorize.searchParams.get('state')}`, {
      headers: { cookie: `${LOGIN_COOKIE}=${loginSid}` },
    }),
  );
  expect(cb.status).toBe(303);
  return { sid: cookieOf(cb, SESSION_COOKIE)!, authorize };
}

const withSid = (sid: string, headers: Record<string, string> = {}) => ({
  cookie: `${SESSION_COOKIE}=${sid}`,
  ...headers,
});

async function csrfOf(bff: Bff, sid: string): Promise<string> {
  const r = await bff.session(new Request(`${APP}/api/bff/session`, { headers: withSid(sid) }));
  return ((await r.json()) as { csrfToken: string }).csrfToken;
}

const sessionRows = async () =>
  (await admin.query<{ n: number }>(`SELECT count(*)::int AS n FROM iam.bff_session WHERE kind = 'ACTIVE'`))
    .rows[0]!.n;

beforeAll(async () => {
  pool = new Pool({ connectionString: deps.bffDatabaseUrl, max: 10 });
  admin = new Client({ connectionString: deps.migratorUrl });
  await admin.connect();
  // Usuario real para la FK de iam.bff_session.user_id (alta por la función de provisión, rol pf_app).
  const app = new Client({ connectionString: deps.databaseUrl });
  await app.connect();
  try {
    const r = await app.query<{ id: string }>('SELECT iam.provision_user($1, $2, $3, $4) AS id', [
      ISSUER,
      `kc-bff-${randomUUID()}`,
      'owner@demo.pfos.test',
      'Owner Demo',
    ]);
    userId = r.rows[0]!.id;
  } finally {
    await app.end();
  }
});

afterAll(async () => {
  await pool?.end();
  await admin?.end();
});

beforeEach(async () => {
  await admin.query('DELETE FROM iam.bff_session');
});

describe('[TC-IDENTITY-AUTH-002] el login OIDC vía BFF usa PKCE y crea una cookie de sesión segura y opaca', () => {
  it('redirige al IdP con code + S256 + state + nonce; el callback crea una cookie __Host- HttpOnly/Secure/Lax', async () => {
    const { bff, api } = setup();
    const { sid, authorize } = await login(bff);
    expect(authorize.searchParams.get('response_type')).toBe('code');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorize.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authorize.searchParams.get('state')).toBeTruthy();
    expect(authorize.searchParams.get('nonce')).toBeTruthy();
    expect(authorize.searchParams.get('redirect_uri')).toBe(`${APP}/api/bff/auth/callback`);
    expect(authorize.searchParams.has('code_verifier')).toBe(false);
    expect(sid).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sid).not.toMatch(JWT);
    // La provisión JIT ocurre con el primer GET /me autenticado.
    expect(api.calls[0]).toMatchObject({ method: 'GET', url: `${API}/api/v1/me` });
    expect(api.calls[0]!.authorization).toMatch(/^Bearer eyJ/);
  });

  it('atributos de la cookie: Path=/, HttpOnly, Secure, SameSite=Lax y sin Domain; redirige al returnTo propio', async () => {
    const { bff } = setup();
    const start = await bff.login(new Request(`${APP}/api/bff/auth/login?returnTo=//evil.example/x`));
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    const cb = await bff.callback(
      new Request(`${APP}/api/bff/auth/callback?code=good-code&state=${state}`, {
        headers: { cookie: `${LOGIN_COOKIE}=${cookieOf(start, LOGIN_COOKIE)}` },
      }),
    );
    const header = setCookieHeader(cb, SESSION_COOKIE)!;
    expect(header).toContain('Path=/');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header.toLowerCase()).not.toContain('domain=');
    expect(cb.headers.get('location')).toBe(`${APP}/`);
    expect(setCookieHeader(cb, LOGIN_COOKIE)).toContain('Max-Age=0');
  });

  it('[TC-IDENTITY-EXPORT-001] reauth=1 fuerza credenciales de nuevo (prompt=login, max_age=0); el login normal no', async () => {
    const { bff } = setup();
    const normal = new URL(
      (await bff.login(new Request(`${APP}/api/bff/auth/login?returnTo=/configuracion`))).headers.get(
        'location',
      )!,
    );
    expect(normal.searchParams.has('prompt')).toBe(false);
    expect(normal.searchParams.has('max_age')).toBe(false);
    const forced = new URL(
      (
        await bff.login(new Request(`${APP}/api/bff/auth/login?reauth=1&returnTo=/configuracion`))
      ).headers.get('location')!,
    );
    expect(forced.searchParams.get('prompt')).toBe('login');
    expect(forced.searchParams.get('max_age')).toBe('0');
  });

  it('un state reutilizado o nunca emitido no crea sesión y lleva a la página de error en español', async () => {
    const { bff } = setup();
    const start = await bff.login(new Request(`${APP}/api/bff/auth/login`));
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    const loginCookie = `${LOGIN_COOKIE}=${cookieOf(start, LOGIN_COOKIE)}`;
    const ok = await bff.callback(
      new Request(`${APP}/api/bff/auth/callback?code=good-code&state=${state}`, {
        headers: { cookie: loginCookie },
      }),
    );
    expect(cookieOf(ok, SESSION_COOKIE)).toBeTruthy();
    expect(await sessionRows()).toBe(1);
    const reused = await bff.callback(
      new Request(`${APP}/api/bff/auth/callback?code=good-code&state=${state}`, {
        headers: { cookie: loginCookie },
      }),
    );
    const unknown = await bff.callback(
      new Request(`${APP}/api/bff/auth/callback?code=good-code&state=nunca-emitido`, {
        headers: { cookie: loginCookie },
      }),
    );
    for (const r of [reused, unknown]) {
      expect(r.status).toBe(303);
      expect(r.headers.get('location')).toBe(`${APP}/auth/error?reason=state`);
      expect(cookieOf(r, SESSION_COOKIE)).toBeUndefined();
    }
    expect(await sessionRows()).toBe(1);
  });
});

describe('[TC-IDENTITY-AUTH-003] ningún token es observable desde el navegador', () => {
  it('el almacén guarda los tokens cifrados y /api/bff/session no expone tokens OAuth', async () => {
    const { bff, idp } = setup();
    const { sid } = await login(bff);
    const issued = idp.issued[0]!;
    const row = await admin.query<{ tokens_enc: Buffer; csrf_secret_enc: Buffer; sid_hash: Buffer }>(
      'SELECT tokens_enc, csrf_secret_enc, sid_hash FROM iam.bff_session',
    );
    const stored = row.rows[0]!;
    const raw = stored.tokens_enc.toString('utf8');
    expect(raw).not.toContain(issued.accessToken);
    expect(raw).not.toContain(issued.refreshToken!);
    expect(raw).not.toMatch(/eyJ/);
    expect(stored.sid_hash.equals(hashSid(sid))).toBe(true);
    const session = await bff.session(new Request(`${APP}/api/bff/session`, { headers: withSid(sid) }));
    const text = await session.text();
    expect(text).not.toMatch(JWT);
    expect(JSON.parse(text)).toMatchObject({ authenticated: true, userId });
  });
});

describe('[TC-IDENTITY-AUTH-004] cerrar sesión invalida la sesión del BFF y la cookie anterior deja de dar acceso', () => {
  it('revoca el refresh token, borra la sesión y la cookie, y devuelve el end_session del IdP; la cookie vieja da 401', async () => {
    const { bff, idp, api } = setup();
    const { sid } = await login(bff);
    const csrf = await csrfOf(bff, sid);
    const out = await bff.logout(
      new Request(`${APP}/api/bff/auth/logout`, {
        method: 'POST',
        headers: withSid(sid, { origin: APP, 'x-csrf-token': csrf, 'content-type': 'application/json' }),
        body: '{}',
      }),
    );
    expect(out.status).toBe(200);
    const { redirectTo } = (await out.json()) as { redirectTo: string };
    expect(redirectTo).toContain(`${ISSUER}/protocol/openid-connect/logout`);
    expect(new URL(redirectTo).searchParams.get('post_logout_redirect_uri')).toBe(`${APP}/`);
    expect(setCookieHeader(out, SESSION_COOKIE)).toContain('Max-Age=0');
    expect(idp.revoked).toEqual([idp.issued[0]!.refreshToken]);
    expect(await sessionRows()).toBe(0);

    const before = api.calls.length;
    const reuse = await bff.proxy(new Request(`${APP}/api/bff/v1/workspaces`, { headers: withSid(sid) }), [
      'workspaces',
    ]);
    expect(reuse.status).toBe(401);
    expect(((await reuse.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
    expect(api.calls.length).toBe(before);
  });

  it('logout sin token CSRF o desde otro origen se rechaza y la sesión sigue activa', async () => {
    const { bff } = setup();
    const { sid } = await login(bff);
    for (const headers of [withSid(sid, { origin: APP }), withSid(sid, { origin: 'https://evil.example' })]) {
      const r = await bff.logout(new Request(`${APP}/api/bff/auth/logout`, { method: 'POST', headers }));
      expect(r.status).toBe(403);
    }
    expect(await sessionRows()).toBe(1);
  });
});

describe('[TC-IDENTITY-AUTH-005] la sesión expira por inactividad de 30 minutos y por duración absoluta de 12 horas', () => {
  const get = (bff: Bff, sid: string) =>
    bff.proxy(new Request(`${APP}/api/bff/v1/me`, { headers: withSid(sid) }), ['me']);

  it('inactividad: 30 min sin actividad ⇒ 401 UNAUTHENTICATED; con actividad a los 29 min la expiración se desliza', async () => {
    const { bff, clock } = setup();
    const { sid } = await login(bff);
    clock.t = T0 + 29 * MIN;
    expect((await get(bff, sid)).status).toBe(200);
    clock.t = T0 + 29 * MIN + 30 * MIN - 1000; // 30 min tras la última actividad, menos 1 s
    expect((await get(bff, sid)).status).toBe(200);
    clock.t += 30 * MIN + 1000;
    const expired = await get(bff, sid);
    expect(expired.status).toBe(401);
    expect(((await expired.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
    expect(await sessionRows()).toBe(0);
  });

  it('absoluta: con actividad cada 5 min, a las 12 h desde el login la petición exige un nuevo login', async () => {
    const { bff, clock, idp } = setup();
    const { sid } = await login(bff);
    for (let t = 5 * MIN; t < 12 * 60 * MIN; t += 5 * MIN) {
      clock.t = T0 + t;
      expect((await get(bff, sid)).status, `t=${t / MIN} min`).toBe(200);
    }
    expect(idp.refreshCalls).toBeGreaterThan(0); // los access tokens de 5 min se renovaron en el camino
    clock.t = T0 + 12 * 60 * MIN + 1000;
    expect((await get(bff, sid)).status).toBe(401);
    expect(await sessionRows()).toBe(0);
  });
});

describe('[TC-IDENTITY-SESSION-001] peticiones concurrentes con el token por expirar provocan un único refresh', () => {
  it('5 peticiones simultáneas (en dos réplicas del BFF) ⇒ 1 refresh; todas 200 y la sesión sigue activa', async () => {
    const { bff, clock, idp, make, api } = setup();
    const { sid } = await login(bff);
    const replica = make(); // otro proceso: sin la promesa compartida, solo el advisory lock lo coordina
    clock.t = T0 + 300_000 - 30_000; // el access token expira en 30 s
    const replies = await Promise.all(
      [bff, replica, bff, replica, bff].map((b) =>
        b.proxy(new Request(`${APP}/api/bff/v1/me`, { headers: withSid(sid) }), ['me']),
      ),
    );
    expect(replies.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(idp.refreshCalls).toBe(1);
    const fresh = idp.issued[1]!.accessToken;
    expect(api.calls.slice(-5).every((c) => c.authorization === `Bearer ${fresh}`)).toBe(true);
    const sixth = await bff.proxy(new Request(`${APP}/api/bff/v1/me`, { headers: withSid(sid) }), ['me']);
    expect(sixth.status).toBe(200);
    expect(idp.refreshCalls).toBe(1);
  });

  it('refresh rechazado por el IdP (revocado) ⇒ 401 UNAUTHENTICATED y la sesión se elimina del almacén', async () => {
    const { bff, clock, idp } = setup();
    const { sid } = await login(bff);
    idp.rejectRefresh = true;
    clock.t = T0 + 300_000 - 30_000;
    const r = await bff.proxy(new Request(`${APP}/api/bff/v1/me`, { headers: withSid(sid) }), ['me']);
    expect(r.status).toBe(401);
    expect(((await r.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
    expect(setCookieHeader(r, SESSION_COOKIE)).toContain('Max-Age=0');
    expect(await sessionRows()).toBe(0);
  });
});

describe('[TC-IDENTITY-SESSION-002] el BFF rechaza mutaciones sin token anti-CSRF o desde otro origen', () => {
  const expense = JSON.stringify({ amount: { amount: '75.00', currency: 'BOB' } });

  it('sin token o con Origin ajeno: 403 CSRF_REJECTED sin llegar a finance-api; con token y Origin propio se reenvía', async () => {
    const { bff, api } = setup();
    const { sid } = await login(bff);
    const csrf = await csrfOf(bff, sid);
    const path = ['workspaces', randomUUID(), 'transactions'];
    const url = `${APP}/api/bff/v1/${path.join('/')}`;
    const before = api.calls.length;
    const cases = [
      withSid(sid, { origin: APP, 'content-type': 'application/json' }),
      withSid(sid, {
        origin: 'https://evil.example',
        'x-csrf-token': csrf,
        'content-type': 'application/json',
      }),
      withSid(sid, { origin: APP, 'x-csrf-token': csrf, 'content-type': 'text/plain' }),
    ];
    for (const headers of cases) {
      const r = await bff.proxy(new Request(url, { method: 'POST', headers, body: expense }), path);
      expect(r.status).toBe(403);
      expect(r.headers.get('content-type')).toBe('application/problem+json');
      expect(((await r.json()) as { code: string }).code).toBe('CSRF_REJECTED');
    }
    expect(api.calls.length).toBe(before);

    const ok = await bff.proxy(
      new Request(url, {
        method: 'POST',
        headers: withSid(sid, {
          origin: APP,
          'x-csrf-token': csrf,
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        }),
        body: expense,
      }),
      path,
    );
    expect(ok.status).toBe(201);
    expect(ok.headers.get('location')).toBe('/api/bff/v1/workspaces/abc');
    expect(api.calls.at(-1)).toMatchObject({ method: 'POST', url: `${API}/api/v1/${path.join('/')}` });
  });
});

describe('[TC-AUDIT-LIFECYCLE-020] descarga del recorrido por el BFF (docs/31 D52)', () => {
  it('un GET de exportación (sin token CSRF: método seguro) reenvía el archivo con Content-Disposition y Accept-Language', async () => {
    const { bff, api } = setup();
    const { sid } = await login(bff);
    const path = ['workspaces', randomUUID(), 'categories', randomUUID(), 'lifecycle', 'export'];
    const r = await bff.proxy(
      new Request(`${APP}/api/bff/v1/${path.join('/')}?format=csv`, {
        headers: withSid(sid, { 'accept-language': 'es-BO,es;q=0.9' }),
      }),
      path,
    );
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="recorrido-Category-c1.csv"');
    expect(r.headers.get('cache-control')).toBe('no-store');
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM intacto (se reenv\u00EDa sin re-codificar)
    expect(new TextDecoder().decode(bytes)).toBe('sequence,kind\r\n1,TRANSITION\r\n');
    const call = api.calls.at(-1)!;
    expect(call.url).toBe(`${API}/api/v1/${path.join('/')}?format=csv`);
    expect(call.headers.get('accept-language')).toBe('es-BO,es;q=0.9');
    expect(call.authorization).toMatch(/^Bearer /);
  });
});

describe('[TC-AUDIT-SESSION-001] el BFF audita el inicio y el cierre de sesión sin tokens ni cookies', () => {
  const browser = {
    'user-agent': 'Mozilla/5.0 (PFOS BFF test)',
    'x-forwarded-for': '198.51.100.23, 10.0.0.2',
  };
  const sessionEvents = (calls: ApiCall[]) =>
    calls.filter((c) => c.url === `${API}/api/v1/me/session-events`);

  it('un único STARTED tras el login (no en los requests siguientes) y ENDED al logout con el workspace activo', async () => {
    const { bff, api, idp } = setup();
    const start = await bff.login(new Request(`${APP}/api/bff/auth/login`));
    const state = new URL(start.headers.get('location')!).searchParams.get('state');
    const cb = await bff.callback(
      new Request(`${APP}/api/bff/auth/callback?code=good-code&state=${state}`, {
        headers: { cookie: `${LOGIN_COOKIE}=${cookieOf(start, LOGIN_COOKIE)}`, ...browser },
      }),
    );
    const sid = cookieOf(cb, SESSION_COOKIE)!;
    for (let i = 0; i < 2; i += 1) {
      const r = await bff.proxy(
        new Request(`${APP}/api/bff/v1/workspaces`, { headers: withSid(sid, browser) }),
        ['workspaces'],
      );
      expect(r.status).toBe(200);
    }
    const proxied = api.calls.filter((c) => c.url === `${API}/api/v1/workspaces`);
    expect(proxied.every((c) => c.headers.get('x-pfos-origin') === 'ui')).toBe(true);
    expect(proxied.every((c) => c.headers.get('user-agent') === browser['user-agent'])).toBe(true);
    expect(proxied.every((c) => c.headers.get('x-forwarded-for') === '198.51.100.23')).toBe(true);

    const activeWorkspace = randomUUID();
    await admin.query('UPDATE iam.bff_session SET active_workspace_id = $1', [activeWorkspace]);
    const csrf = await csrfOf(bff, sid);
    const out = await bff.logout(
      new Request(`${APP}/api/bff/auth/logout`, {
        method: 'POST',
        headers: withSid(sid, {
          origin: APP,
          'x-csrf-token': csrf,
          'content-type': 'application/json',
          ...browser,
        }),
        body: '{}',
      }),
    );
    expect(out.status).toBe(200);

    const events = sessionEvents(api.calls);
    expect(events.map((c) => JSON.parse(c.body ?? '{}'))).toEqual([
      { event: 'STARTED', workspaceId: null },
      { event: 'ENDED', workspaceId: activeWorkspace },
    ]);
    for (const c of events) {
      expect(c.method).toBe('POST');
      expect(c.authorization).toBe(`Bearer ${idp.issued[0]!.accessToken}`);
      expect(c.headers.get('user-agent')).toBe(browser['user-agent']);
      expect(c.headers.get('x-forwarded-for')).toBe('198.51.100.23');
      expect(c.headers.get('cookie')).toBeNull();
      expect(c.body).not.toMatch(JWT);
      expect(c.body).not.toContain(sid);
    }
  });

  it('si finance-api no puede auditar, el login igual se completa (best effort con log técnico)', async () => {
    const { bff, api } = setup();
    api.state.sessionEventsStatus = 500;
    const { sid } = await login(bff);
    expect(sid).toBeTruthy();
    expect(sessionEvents(api.calls)).toHaveLength(1);
    expect(await sessionRows()).toBe(1);
  });
});

describe('aislamiento del rol pf_bff', () => {
  it('pf_bff no puede leer tablas de negocio ni iam.user (solo iam.bff_session)', async () => {
    const err = await pool.query('SELECT 1 FROM iam."user" LIMIT 1').catch((e: { code?: string }) => e);
    expect((err as { code?: string }).code).toBe('42501');
  });
});
