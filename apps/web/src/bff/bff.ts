import { randomBytes } from 'node:crypto';
import { contentTypeAllowed, csrfTokenFor, csrfTokenValid, isSafeMethod, originAllowed } from './csrf';
import { OidcGrantRejected, pkce, type OidcClient, type OidcTokens } from './oidc-client';
import { hashSid, newOpaqueId } from './session-crypto';
import type { ActiveSession, SessionStore, SessionTimeouts, TokenSet } from './session-store';

/**
 * BFF de finance-web (ADR-0010 enmienda, ADR-0019, design §2): login OIDC Authorization Code + PKCE, sesión
 * server-side en `iam.bff_session`, refresh de un solo vuelo, logout RP-initiated con revocación, CSRF y proxy
 * autenticado `/api/bff/v1/*` → `finance-api /api/v1/*`. Sin dependencias de Next: recibe y devuelve `Request` /
 * `Response` estándar (las route handlers solo delegan), así se prueba sin servidor.
 *
 * El navegador solo recibe la cookie opaca `__Host-pfos_sid`; access, refresh e id tokens nunca salen del servidor.
 */
export const SESSION_COOKIE = '__Host-pfos_sid';
export const LOGIN_COOKIE = '__Host-pfos_login';
export const LOGIN_TTL_MS = 10 * 60_000;
/** Se renueva el access token si expira en menos de 60 s (design §2). */
export const REFRESH_SKEW_MS = 60_000;
export const CALLBACK_PATH = '/api/bff/auth/callback';
export const PROXY_PREFIX = '/api/bff/v1';

export interface Clock {
  now(): number;
}

export interface BffSettings {
  /** Origen público (`WEB_PUBLIC_URL`), sin barra final. */
  readonly appOrigin: string;
  /** Base interna de finance-api (`FINANCE_API_URL`), sin barra final. */
  readonly apiBaseUrl: string;
  readonly scope: string;
  readonly timeouts: SessionTimeouts;
}

export interface BffLogger {
  warn(fields: Record<string, unknown>, msg: string): void;
  error(fields: Record<string, unknown>, msg: string): void;
}

export interface BffDeps {
  readonly store: SessionStore;
  readonly oidc: OidcClient;
  readonly settings: BffSettings;
  readonly clock?: Clock;
  /** Fetch hacia finance-api (inyectable en tests). */
  readonly fetch?: typeof fetch;
  readonly logger?: BffLogger;
}

/** Motivos de la página de error de login (`/auth/error?reason=…`, textos en el catálogo i18n). */
export type LoginErrorReason = 'state' | 'idp' | 'callback' | 'provision';

const FORWARD_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'idempotency-key',
  'if-match',
  'if-none-match',
  'traceparent',
  // Atribución en la auditoría (add-audit-trail): el user agent del navegador; la IP va en X-Forwarded-For.
  'user-agent',
];
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  // Descargas (exportación del recorrido, docs/31 D52): adjunto con nombre de archivo seguro fijado por finance-api.
  'content-disposition',
  'etag',
  'retry-after',
  'idempotent-replayed',
  'x-request-id',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IP = /^[0-9a-fA-F.:]{2,45}$/;
/** Cabecera con la que finance-api reconoce el origen `ui` de la auditoría (`@pf/platform/nest` CLIENT_ORIGIN_HEADER). */
export const CLIENT_ORIGIN_HEADER = 'x-pfos-origin';
export const SESSION_EVENTS_PATH = '/api/v1/me/session-events';

/** IP del navegador según el proxy de entrada de finance-web (primer salto de `X-Forwarded-For` o `X-Real-IP`). */
export function clientIpOf(headers: Headers): string | undefined {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim();
  return forwarded && IP.test(forwarded) ? forwarded : undefined;
}

export function problem(status: number, code: string, title: string, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/problem+json');
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify({ type: 'about:blank', title, status, code }), { status, headers: h });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function cookie(name: string, value: string, maxAgeSeconds?: number): string {
  // `__Host-`: Secure + Path=/ + sin Domain. Chromium acepta Secure en orígenes de loopback por http (desarrollo/E2E).
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax'];
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join('; ');
}

export const clearCookie = (name: string): string => cookie(name, '', 0);

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) {
      const value = part.slice(eq + 1).trim();
      return value.length > 0 && value.length <= 128 ? value : undefined;
    }
  }
  return undefined;
}

/** `returnTo` solo puede ser una ruta relativa propia (evita open redirect). */
export function safeReturnTo(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value.startsWith('/api/')) return '/';
  return value;
}

const unauthenticated = (): Response =>
  problem(401, 'UNAUTHENTICATED', 'Authentication required', { 'set-cookie': clearCookie(SESSION_COOKIE) });
const csrfRejected = (): Response => problem(403, 'CSRF_REJECTED', 'Request rejected by CSRF protection');

export class Bff {
  private readonly clock: Clock;
  private readonly fetchApi: typeof fetch;
  private readonly inflight = new Map<string, Promise<TokenSet | null>>();

  constructor(private readonly deps: BffDeps) {
    this.clock = deps.clock ?? { now: () => Date.now() };
    this.fetchApi = deps.fetch ?? fetch;
  }

  private get settings(): BffSettings {
    return this.deps.settings;
  }

  private get redirectUri(): string {
    return `${this.settings.appOrigin}${CALLBACK_PATH}`;
  }

  // ───────────────────────────── login ─────────────────────────────

  /** `GET /api/bff/auth/login?returnTo=/…`: inicia Code + PKCE; state/nonce/verifier quedan server-side. */
  async login(req: Request): Promise<Response> {
    const params = new URL(req.url).searchParams;
    const returnTo = safeReturnTo(params.get('returnTo'));
    // `reauth=1`: fuerza credenciales de nuevo (openspec add-workspace-export: export/import exigen auth_time reciente).
    const reauth = params.get('reauth') === '1';
    const loginSid = newOpaqueId();
    const codeVerifier = pkce.verifier();
    const state = pkce.state();
    const nonce = pkce.nonce();
    await this.deps.store.createPending(
      hashSid(loginSid),
      { state, nonce, codeVerifier, returnTo },
      this.clock.now(),
      LOGIN_TTL_MS,
    );
    const url = await this.deps.oidc.authorizationUrl({
      redirectUri: this.redirectUri,
      scope: this.settings.scope,
      state,
      nonce,
      codeChallenge: await pkce.challenge(codeVerifier),
      ...(reauth ? { reauth: true } : {}),
    });
    const headers = new Headers({ location: url.href, 'cache-control': 'no-store' });
    headers.append('set-cookie', cookie(LOGIN_COOKIE, loginSid, LOGIN_TTL_MS / 1000));
    return new Response(null, { status: 303, headers });
  }

  /**
   * `GET /api/bff/auth/callback`: consume el registro pre-sesión (un solo uso, ligado al navegador por la cookie
   * `__Host-pfos_login`), canjea el código, provisiona al usuario con `GET /api/v1/me` y crea la sesión con un
   * `sid` NUEVO (rotación). Cualquier fallo lleva a la página de error en español sin crear sesión.
   */
  async callback(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const loginSid = readCookie(req, LOGIN_COOKIE);
    const pending = loginSid
      ? await this.deps.store.consumePending(hashSid(loginSid), this.clock.now())
      : null;
    if (url.searchParams.has('error')) return this.loginError('idp');
    if (!pending || pending.state !== url.searchParams.get('state')) return this.loginError('state');

    // URL "actual" reconstruida sobre el redirect_uri registrado (no se confía en Host).
    const callbackUrl = new URL(this.redirectUri);
    callbackUrl.search = url.search;
    let tokens: OidcTokens;
    try {
      tokens = await this.deps.oidc.exchangeCode(callbackUrl, pending);
    } catch (err) {
      this.deps.logger?.warn({ err: errorName(err) }, 'oidc callback failed');
      return this.loginError('callback');
    }
    const tokenSet = this.toTokenSet(tokens);

    // Provisión JIT: el primer request autenticado a finance-api crea el usuario y su workspace personal.
    let userId: string | undefined;
    try {
      const me = await this.callApi('GET', '/api/v1/me', tokenSet.accessToken);
      if (me.ok) userId = ((await me.json()) as { id?: unknown }).id as string | undefined;
      else await me.body?.cancel();
    } catch (err) {
      this.deps.logger?.error({ err: errorName(err) }, 'finance-api unavailable during login');
    }
    if (typeof userId !== 'string' || !UUID.test(userId)) {
      await this.revokeQuietly(tokenSet.refreshToken);
      return this.loginError('provision');
    }

    const previous = readCookie(req, SESSION_COOKIE);
    if (previous) await this.destroyBySid(previous);
    const sid = newOpaqueId();
    await this.deps.store.createActive({
      sidHash: hashSid(sid),
      userId,
      tokens: tokenSet,
      csrfSecret: randomBytes(32).toString('base64url'),
      now: this.clock.now(),
      timeouts: this.settings.timeouts,
    });
    // Auditoría del inicio de sesión (FR-AUDIT-005): una vez por sesión, nunca en los requests siguientes.
    await this.recordSessionEvent(tokenSet.accessToken, req, 'STARTED', null);
    const headers = new Headers({
      location: `${this.settings.appOrigin}${pending.returnTo}`,
      'cache-control': 'no-store',
    });
    headers.append('set-cookie', cookie(SESSION_COOKIE, sid));
    headers.append('set-cookie', clearCookie(LOGIN_COOKIE));
    return new Response(null, { status: 303, headers });
  }

  private loginError(reason: LoginErrorReason): Response {
    const headers = new Headers({
      location: `${this.settings.appOrigin}/auth/error?reason=${reason}`,
      'cache-control': 'no-store',
    });
    headers.append('set-cookie', clearCookie(LOGIN_COOKIE));
    return new Response(null, { status: 303, headers });
  }

  // ───────────────────────────── sesión ─────────────────────────────

  /** Sesión vigente de la petición (o `null`): la usan las páginas protegidas y todas las rutas del BFF. */
  async currentSession(sid: string | undefined): Promise<ActiveSession | null> {
    if (!sid) return null;
    return this.deps.store.findActive(hashSid(sid), this.clock.now(), this.settings.timeouts);
  }

  /** `GET /api/bff/session`: estado para el JS del navegador (token CSRF, workspace activo). NUNCA tokens OAuth. */
  async session(req: Request): Promise<Response> {
    const sid = readCookie(req, SESSION_COOKIE);
    const s = await this.currentSession(sid);
    if (!s || !sid) return unauthenticated();
    return json(this.sessionView(s, sid));
  }

  /** `PUT /api/bff/session` `{ activeWorkspaceId }`: guarda el workspace activo si el usuario es miembro. */
  async updateSession(req: Request): Promise<Response> {
    if (!originAllowed(req, this.settings.appOrigin) || !contentTypeAllowed(req)) return csrfRejected();
    const sid = readCookie(req, SESSION_COOKIE);
    const s = await this.currentSession(sid);
    if (!s || !sid) return unauthenticated();
    if (!csrfTokenValid(req, sid, s.csrfSecret)) return csrfRejected();
    const body = (await req.json().catch(() => null)) as { activeWorkspaceId?: unknown } | null;
    const workspaceId = body?.activeWorkspaceId;
    if (workspaceId !== null && (typeof workspaceId !== 'string' || !UUID.test(workspaceId))) {
      return problem(400, 'VALIDATION_FAILED', 'activeWorkspaceId must be a UUID or null');
    }
    if (workspaceId !== null) {
      // La API decide la membresía (403 WORKSPACE_ACCESS_DENIED si no es miembro): se reenvía su respuesta.
      const check = await this.forward(req, s, 'GET', `/api/v1/workspaces/${workspaceId}`, undefined);
      if (check.status !== 200) return check;
      await check.body?.cancel();
    }
    await this.deps.store.setActiveWorkspace(s.id, workspaceId);
    return json(this.sessionView({ ...s, activeWorkspaceId: workspaceId }, sid));
  }

  private sessionView(s: ActiveSession, sid: string) {
    return {
      authenticated: true,
      userId: s.userId,
      csrfToken: csrfTokenFor(sid, s.csrfSecret),
      activeWorkspaceId: s.activeWorkspaceId,
      idleExpiresAt: new Date(s.idleExpiresAt).toISOString(),
      absoluteExpiresAt: new Date(s.absoluteExpiresAt).toISOString(),
    };
  }

  // ───────────────────────────── logout ─────────────────────────────

  /**
   * `POST /api/bff/auth/logout` (Origin + token CSRF: un tercero no puede cerrar la sesión): revoca el refresh
   * token en el IdP, borra la sesión y la cookie, y devuelve la URL de RP-initiated logout del IdP.
   */
  async logout(req: Request): Promise<Response> {
    if (!originAllowed(req, this.settings.appOrigin)) return csrfRejected();
    const sid = readCookie(req, SESSION_COOKIE);
    const s = await this.currentSession(sid);
    const home = `${this.settings.appOrigin}/`;
    if (!s || !sid) {
      const res = json({ redirectTo: home });
      res.headers.append('set-cookie', clearCookie(SESSION_COOKIE));
      return res;
    }
    if (!csrfTokenValid(req, sid, s.csrfSecret)) return csrfRejected();
    // Auditoría del cierre (FR-AUDIT-005) mientras el access token sigue vigente; luego se revoca.
    const tokens = await this.freshTokens(s).catch(() => null);
    if (tokens) await this.recordSessionEvent(tokens.accessToken, req, 'ENDED', s.activeWorkspaceId);
    await this.revokeQuietly(s.tokens.refreshToken);
    await this.deps.store.delete(s.id);
    let redirectTo = home;
    try {
      redirectTo = (
        await this.deps.oidc.endSessionUrl({
          ...(s.tokens.idToken ? { idToken: s.tokens.idToken } : {}),
          postLogoutRedirectUri: home,
        })
      ).href;
    } catch (err) {
      this.deps.logger?.warn({ err: errorName(err) }, 'end_session_endpoint unavailable');
    }
    const res = json({ redirectTo });
    res.headers.append('set-cookie', clearCookie(SESSION_COOKIE));
    return res;
  }

  // ───────────────────────────── proxy ─────────────────────────────

  /** `/api/bff/v1/<path>` → `finance-api /api/v1/<path>` con `Authorization: Bearer <access token>`. */
  async proxy(req: Request, segments: readonly string[]): Promise<Response> {
    // 1) Origen y tipo de contenido ANTES de mirar la sesión: lo cross-site se rechaza aunque traiga cookie.
    if (!originAllowed(req, this.settings.appOrigin) || !contentTypeAllowed(req)) return csrfRejected();
    const sid = readCookie(req, SESSION_COOKIE);
    const s = await this.currentSession(sid);
    if (!s || !sid) return unauthenticated();
    if (!csrfTokenValid(req, sid, s.csrfSecret)) return csrfRejected();
    if (segments.length === 0 || segments.some((p) => p === '' || p === '.' || p === '..')) {
      return problem(400, 'VALIDATION_FAILED', 'Invalid path');
    }
    const search = new URL(req.url).search;
    const path = `/api/v1/${segments.map(encodeURIComponent).join('/')}${search}`;
    const body = isSafeMethod(req.method) ? undefined : await req.arrayBuffer();
    return this.forward(req, s, req.method.toUpperCase(), path, body);
  }

  private async forward(
    req: Request,
    session: ActiveSession,
    method: string,
    path: string,
    body: ArrayBuffer | undefined,
  ): Promise<Response> {
    let upstream: Response;
    try {
      let tokens = await this.freshTokens(session);
      if (!tokens) return this.expire(session);
      upstream = await this.callApi(method, path, tokens.accessToken, req.headers, body);
      if (upstream.status === 401) {
        // Token revocado o rotado antes de `exp`: un único reintento tras un refresh forzado. La API rechaza la
        // autenticación antes de ejecutar nada, así que reintentar una mutación no duplica efectos.
        await upstream.body?.cancel();
        tokens = await this.refresh(session.id, tokens.accessToken);
        if (!tokens) return this.expire(session);
        upstream = await this.callApi(method, path, tokens.accessToken, req.headers, body);
      }
    } catch (err) {
      if (err instanceof OidcGrantRejected) return this.expire(session);
      this.deps.logger?.error({ err: errorName(err) }, 'finance-api proxy failed');
      return problem(503, 'SERVICE_UNAVAILABLE', 'Upstream unavailable');
    }
    const headers = new Headers({ 'cache-control': 'no-store' });
    for (const h of FORWARD_RESPONSE_HEADERS) {
      const v = upstream.headers.get(h);
      if (v) headers.set(h, v);
    }
    const location = upstream.headers.get('location');
    if (location?.startsWith('/api/v1/')) headers.set('location', `${PROXY_PREFIX}/${location.slice(8)}`);
    return new Response(upstream.status === 304 ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  }

  private callApi(
    method: string,
    path: string,
    accessToken: string,
    incoming?: Headers,
    body?: ArrayBuffer,
  ): Promise<Response> {
    const headers = new Headers({ accept: 'application/json' });
    if (incoming) {
      for (const h of FORWARD_REQUEST_HEADERS) {
        const v = incoming.get(h);
        if (v) headers.set(h, v);
      }
    }
    headers.set('authorization', `Bearer ${accessToken}`);
    headers.set(CLIENT_ORIGIN_HEADER, 'ui');
    const ip = incoming ? clientIpOf(incoming) : undefined;
    if (ip) headers.set('x-forwarded-for', ip);
    return this.fetchApi(`${this.settings.apiBaseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined && body.byteLength > 0 ? { body } : {}),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });
  }

  /**
   * `POST /api/v1/me/session-events` (FR-AUDIT-005): best effort, nunca impide el login ni el logout; un fallo queda
   * en el log técnico sin PII. User agent e IP viajan como cabeceras del navegador; tokens y cookies nunca.
   */
  private async recordSessionEvent(
    accessToken: string,
    req: Request,
    event: 'STARTED' | 'ENDED',
    workspaceId: string | null,
  ): Promise<void> {
    try {
      const incoming = new Headers();
      const ua = req.headers.get('user-agent');
      if (ua) incoming.set('user-agent', ua);
      const ip = clientIpOf(req.headers);
      if (ip) incoming.set('x-forwarded-for', ip);
      const traceparent = req.headers.get('traceparent');
      if (traceparent) incoming.set('traceparent', traceparent);
      incoming.set('content-type', 'application/json');
      const body = new TextEncoder().encode(JSON.stringify({ event, workspaceId })).buffer as ArrayBuffer;
      const res = await this.callApi('POST', SESSION_EVENTS_PATH, accessToken, incoming, body);
      await res.body?.cancel();
      if (res.status !== 204) {
        this.deps.logger?.warn({ status: res.status, event }, 'session event not audited');
      }
    } catch (err) {
      this.deps.logger?.warn({ err: errorName(err), event }, 'session event not audited');
    }
  }

  // ───────────────────────────── refresh ─────────────────────────────

  /** Tokens con al menos `REFRESH_SKEW_MS` de vida; `null` si la sesión desapareció. */
  private async freshTokens(session: ActiveSession): Promise<TokenSet | null> {
    if (session.tokens.accessTokenExpiresAt - this.clock.now() > REFRESH_SKEW_MS) return session.tokens;
    return this.refresh(session.id);
  }

  /**
   * Refresh de un solo vuelo (design §2): promesa compartida por sesión dentro del proceso y, entre procesos,
   * `pg_advisory_xact_lock` por sesión con relectura de los tokens bajo el bloqueo. Solo llama al IdP si los tokens
   * releídos siguen por expirar (o, en un refresh forzado, si siguen siendo los que la API rechazó).
   */
  private refresh(sessionId: string, rejectedAccessToken?: string): Promise<TokenSet | null> {
    const running = this.inflight.get(sessionId);
    if (running) return running;
    const p = this.deps.store
      .withRefreshLock(sessionId, async (current) => {
        const stillValid = current.accessTokenExpiresAt - this.clock.now() > REFRESH_SKEW_MS;
        if (rejectedAccessToken === undefined ? stillValid : current.accessToken !== rejectedAccessToken) {
          return undefined; // otra petición (u otra réplica) ya renovó
        }
        if (!current.refreshToken) throw new OidcGrantRejected('session without refresh token');
        const next = await this.deps.oidc.refresh(current.refreshToken);
        return this.toTokenSet(next, current);
      })
      .finally(() => this.inflight.delete(sessionId));
    this.inflight.set(sessionId, p);
    return p;
  }

  private toTokenSet(t: OidcTokens, previous?: TokenSet): TokenSet {
    const refreshToken = t.refreshToken ?? previous?.refreshToken;
    const idToken = t.idToken ?? previous?.idToken;
    return {
      accessToken: t.accessToken,
      accessTokenExpiresAt: this.clock.now() + (t.expiresIn ?? 60) * 1000,
      ...(refreshToken ? { refreshToken } : {}),
      ...(idToken ? { idToken } : {}),
    };
  }

  private async expire(session: ActiveSession): Promise<Response> {
    await this.deps.store.delete(session.id);
    return unauthenticated();
  }

  private async destroyBySid(sid: string): Promise<void> {
    const s = await this.currentSession(sid);
    if (s) await this.deps.store.delete(s.id);
  }

  private async revokeQuietly(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    try {
      await this.deps.oidc.revoke(refreshToken);
    } catch (err) {
      this.deps.logger?.warn({ err: errorName(err) }, 'refresh token revocation failed');
    }
  }
}

const errorName = (err: unknown): string => (err instanceof Error ? err.name : 'unknown');
