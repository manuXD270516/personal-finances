import { test, expect } from '@playwright/test';
import { APP, evidence, jwtPayload, login, readSession, sidOf } from './helpers';

const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

test('login Code+PKCE end-to-end y el navegador nunca ve access/refresh token', async ({ page, context }) => {
  // Captura TODO lo que recibe el navegador: URLs, headers y bodies de cada respuesta.
  const seen: Array<{ url: string; status: number; headers: string; body: string }> = [];
  const authorizeUrls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/protocol/openid-connect/auth')) authorizeUrls.push(r.url());
  });
  page.on('response', async (r) => {
    let body = '';
    try {
      body = (await r.body()).toString('utf8');
    } catch {
      /* redirects no tienen body */
    }
    seen.push({ url: r.url(), status: r.status(), headers: JSON.stringify(await r.allHeaders()), body });
  });

  const t0 = Date.now();
  await login(page, 'owner');
  const loginMs = Date.now() - t0;
  await expect(page.getByTestId('welcome')).toHaveText('Hola, Owner Demo');

  // Ejercita el proxy BFF para que haya respuestas JSON de la API en la captura
  await page.getByRole('button', { name: 'Ver cuentas (VIEWER)' }).click();
  await expect(page.getByTestId('result')).toContainText('"status": 200');

  // PKCE S256 + state + nonce en la petición de autorización
  const authz = new URL(authorizeUrls[0]!);
  expect(authz.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authz.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(authz.searchParams.get('state')).toBeTruthy();
  expect(authz.searchParams.get('nonce')).toBeTruthy();
  expect(authz.searchParams.get('client_id')).toBe('pfos-bff');
  expect(authz.searchParams.has('code_verifier')).toBe(false);

  // Cookie: httpOnly + Secure + SameSite=Lax + __Host-
  const cookies = await context.cookies(APP);
  const sidCookie = cookies.find((c) => c.name === '__Host-pfos_sid')!;
  expect(sidCookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/' });
  expect(sidCookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/); // 256 bits opacos

  // Tokens reales (leídos server-side del store cifrado, solo para comparar)
  const sid = await sidOf(context);
  const s = await readSession(sid);
  expect(s).not.toBeNull();
  const { accessToken, refreshToken } = s!.data;
  expect(jwtPayload(accessToken).aud).toContain('finance-api');
  // En Valkey no hay tokens en claro
  expect(s!.raw.includes(accessToken)).toBe(false);
  expect(s!.raw.includes('eyJ')).toBe(false);

  // Storage del navegador
  const browserSide = await page.evaluate(() => ({
    documentCookie: document.cookie,
    localStorage: JSON.stringify({ ...localStorage }),
    sessionStorage: JSON.stringify({ ...sessionStorage }),
    html: document.documentElement.outerHTML,
  }));
  expect(browserSide.documentCookie).not.toContain('pfos_sid');
  for (const v of Object.values(browserSide)) {
    expect(v).not.toContain(accessToken);
    expect(v).not.toContain(refreshToken);
    expect(v.match(JWT_RE)).toBeNull();
  }

  // Todas las respuestas recibidas por el navegador (app + Keycloak)
  const leaks = seen.filter((r) => [r.url, r.headers, r.body].some((x) => x.includes(accessToken) || x.includes(refreshToken)));
  expect(leaks).toEqual([]);
  // Ninguna respuesta del origen de la app contiene un JWT de ningún tipo
  const appJwts = seen.filter((r) => r.url.startsWith(APP)).flatMap((r) => [r.url, r.headers, r.body].join('\n').match(JWT_RE) ?? []);
  expect(appJwts).toEqual([]);

  evidence('01-login-no-token-leak', {
    loginMs,
    authorizeRequest: Object.fromEntries([...authz.searchParams].map(([k, v]) => [k, ['state', 'nonce', 'code_challenge'].includes(k) ? `${v.slice(0, 6)}…(${v.length})` : v])),
    cookie: { ...sidCookie, value: `${sidCookie.value.slice(0, 4)}…(${sidCookie.value.length} chars)` },
    documentCookie: browserSide.documentCookie,
    localStorageKeys: Object.keys(JSON.parse(browserSide.localStorage)),
    sessionStorageKeys: Object.keys(JSON.parse(browserSide.sessionStorage)),
    responsesInspected: seen.length,
    responsesFromApp: seen.filter((r) => r.url.startsWith(APP)).length,
    responsesFromKeycloak: seen.filter((r) => r.url.includes(':61681')).length,
    leaksOfAccessOrRefreshToken: leaks.length,
    jwtsInAppResponses: appJwts.length,
    valkeyValueContainsJwt: s!.raw.includes('eyJ'),
    accessTokenClaims: (({ iss, aud, azp, typ, scope, exp, iat }) => ({ iss, aud, azp, typ, scope, lifetimeS: Number(exp) - Number(iat) }))(jwtPayload(accessToken) as Record<string, unknown>),
  });
});
