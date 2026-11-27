import { createHash } from 'node:crypto';
import { expect, test, type Response } from '@playwright/test';
import {
  JWT,
  SESSION_COOKIE,
  appUrl,
  bff,
  env,
  issuer,
  login,
  migratorDb,
  sessionTokens,
  sidOf,
} from '../src/helpers.js';

test.describe('autenticación vía BFF con Keycloak real (identity/authentication)', () => {
  test('[TC-IDENTITY-AUTH-002] el login OIDC vía BFF usa PKCE y crea una cookie de sesión segura y opaca', async ({
    page,
    context,
    browserName,
  }) => {
    const authorize: string[] = [];
    const callbacks: string[] = [];
    const callbackResponses: Response[] = [];
    page.on('response', (r) => {
      if (r.url().includes('/api/bff/auth/callback')) callbackResponses.push(r);
    });
    page.on('request', (r) => {
      if (r.url().includes('/protocol/openid-connect/auth')) authorize.push(r.url());
      if (r.url().includes('/api/bff/auth/callback')) callbacks.push(r.url());
    });
    await login(page, 'owner');
    await expect(page.getByTestId('welcome')).toHaveText('Hola, Owner Demo');

    // Redirección al IdP: response_type=code, PKCE S256, state y nonce; el verifier nunca sale del servidor.
    const authz = new URL(authorize[0]!);
    expect(authz.searchParams.get('response_type')).toBe('code');
    expect(authz.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authz.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(authz.searchParams.get('state')).toBeTruthy();
    expect(authz.searchParams.get('nonce')).toBeTruthy();
    expect(authz.searchParams.has('code_verifier')).toBe(false);

    // Cookie: __Host-, HttpOnly, Secure, SameSite=Lax, Path=/, sin Domain explícito; valor opaco (no un JWT).
    const cookie = (await context.cookies(appUrl())).find((c) => c.name === SESSION_COOKIE)!;
    // La API de cookies de Playwright en WebKit informa `sameSite: 'None'` para esta cookie (observado con Playwright
    // 1.63 sobre https) y no expone el `Set-Cookie` de la redirección: en WebKit se comprueban los demás atributos y
    // en Chromium además el `Set-Cookie` completo (mismo código del BFF, que no cambia: D516; TC-PLATFORM-WEBUI-020).
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, path: '/' });
    if (browserName !== 'webkit') {
      expect(cookie.sameSite).toBe('Lax');
      const setCookie = (
        await Promise.all(callbackResponses.map(async (r) => (await r.allHeaders())['set-cookie'] ?? ''))
      ).find((h) => h.includes(SESSION_COOKIE));
      expect(setCookie, 'el callback emite la cookie de sesión').toBeDefined();
      expect(setCookie).toMatch(/Path=[/](;|$)/m);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Lax');
      expect(setCookie).not.toMatch(/Domain=/i);
    }
    expect(cookie.domain).toBe(new URL(appUrl()).hostname);
    expect(cookie.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie.value).not.toMatch(JWT);

    // Callback con un state ya consumido o nunca emitido: sin sesión nueva y página de error en español.
    const sid = await sidOf(context);
    const reused = await page.goto(callbacks[0]!);
    expect(reused?.status()).toBe(200);
    await expect(page).toHaveURL(/\/auth\/error\?reason=state$/);
    await expect(page.locator('p[role="alert"]')).toHaveText(
      'El enlace de inicio de sesión ya se usó o venció. Vuelve a iniciar sesión.',
    );
    await page.goto(`${appUrl()}/api/bff/auth/callback?code=x&state=nunca-emitido`);
    await expect(page).toHaveURL(/\/auth\/error\?reason=state$/);
    expect(await sidOf(context)).toBe(sid);
  });

  test('[TC-IDENTITY-AUTH-003] ningún token de acceso, refresh ni id es observable desde el navegador', async ({
    page,
  }) => {
    const seen: { url: string; headers: string; body: string }[] = [];
    page.on('response', async (r: Response) => {
      let body = '';
      let headers = JSON.stringify(r.headers());
      try {
        headers = JSON.stringify(await r.allHeaders());
        body = (await r.body()).toString('utf8');
      } catch {
        /* redirecciones sin cuerpo o respuesta descartada al navegar */
      }
      seen.push({ url: r.url(), headers, body });
    });
    await login(page, 'owner');
    for (const path of ['/', '/configuracion', '/preferencias', '/workspaces/nuevo']) {
      await page.goto(`${appUrl()}${path}`);
      await expect(page.getByTestId('ready')).toBeAttached();
    }
    await expect(page.locator('input[name="displayName"], input[name="name"]').first()).toBeVisible();

    const db = await migratorDb();
    let stored: Awaited<ReturnType<typeof sessionTokens>>;
    try {
      stored = await sessionTokens(db);
    } finally {
      await db.end();
    }
    const { accessToken, refreshToken, idToken } = stored.tokens;
    expect(accessToken).toMatch(JWT);
    // En el almacén de sesiones los tokens están cifrados (AES-256-GCM), no son JWT legibles.
    expect(stored.raw).not.toContain(accessToken);
    // El texto cifrado es base64url aleatorio: puede contener "eyJ" por azar. Lo que importa es que
    // no aparezca ningún segmento real de los tokens ni nada con forma de JWT (cabecera.payload.).
    for (const token of [accessToken, refreshToken, idToken].filter(Boolean) as string[]) {
      for (const segment of token.split('.').filter((part) => part.length >= 16)) {
        expect(stored.raw).not.toContain(segment);
      }
    }
    expect(stored.raw).not.toMatch(/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\./);

    const browserSide = await page.evaluate(() => ({
      documentCookie: document.cookie,
      localStorage: JSON.stringify({ ...localStorage }),
      sessionStorage: JSON.stringify({ ...sessionStorage }),
      html: document.documentElement.outerHTML,
    }));
    expect(browserSide.documentCookie).not.toContain('pfos_sid');
    for (const value of Object.values(browserSide)) {
      for (const token of [accessToken, refreshToken, idToken]) if (token) expect(value).not.toContain(token);
      expect(value).not.toMatch(JWT);
    }
    // Ninguna respuesta (HTML, JSON, cabeceras) del origen de la app contiene un JWT de ningún tipo.
    const fromApp = seen.filter((r) => r.url.startsWith(appUrl()));
    expect(fromApp.length).toBeGreaterThan(5);
    const leaks = fromApp.filter((r) => JWT.test(`${r.url}\n${r.headers}\n${r.body}`));
    expect(leaks.map((r) => r.url)).toEqual([]);
  });

  test('[TC-IDENTITY-AUTH-004] cerrar sesión invalida la sesión del BFF y la cookie anterior deja de dar acceso', async ({
    page,
    context,
    browser,
  }) => {
    await login(page, 'editor');
    const sid = await sidOf(context);
    const db = await migratorDb();
    try {
      const { tokens } = await sessionTokens(db);
      const endSession = page.waitForRequest((r) => r.url().includes('/protocol/openid-connect/logout'));
      // "Cerrar sesión" vive en el menú de la cuenta de la barra superior (AppFrame).
      await page.getByTestId('user-menu').click();
      await page.getByTestId('logout').click();
      await endSession; // RP-initiated logout en el IdP
      await expect(page).toHaveURL(/\/realms\/pfos\/protocol\/openid-connect\/auth/); // volvió a pedir login

      expect((await context.cookies(appUrl())).find((c) => c.name === SESSION_COOKIE)).toBeUndefined();
      const left = await db.query('SELECT 1 FROM iam.bff_session WHERE sid_hash = $1', [
        createHash('sha256').update(sid, 'utf8').digest(),
      ]);
      expect(left.rowCount).toBe(0);

      // La cookie copiada ya no da acceso y nada llega a finance-api (401 del propio BFF).
      const stale = await browser.newContext();
      const res = await stale.request.get(`${appUrl()}/api/bff/v1/me`, {
        headers: { cookie: `${SESSION_COOKIE}=${sid}` },
      });
      expect(res.status()).toBe(401);
      expect(((await res.json()) as { code: string }).code).toBe('UNAUTHENTICATED');
      await stale.close();

      // El refresh token quedó revocado en el IdP.
      const refresh = await fetch(`${issuer()}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`pfos-web:${env()['OIDC_CLIENT_SECRET']}`).toString('base64')}`,
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken! }),
      });
      expect(refresh.status).toBe(400);
      expect(((await refresh.json()) as { error: string }).error).toBe('invalid_grant');
    } finally {
      await db.end();
    }
  });

  test('[TC-PLATFORM-WEBUI-020] la sesión real persiste entre páginas con la cookie __Host- de producción (también en WebKit, por https)', async ({
    page,
    context,
  }) => {
    await login(page, 'owner');
    const sid = await sidOf(context);
    for (const path of ['/cuentas', '/transacciones']) {
      await page.goto(new URL(path, appUrl()).href);
      await expect(page).toHaveURL(new RegExp(path + '$'));
      await expect(page.getByTestId('ready')).toBeAttached();
    }
    // Sigue autenticada (no volvió al IdP) y la cookie es la misma, con los atributos de producción.
    await expect(page).not.toHaveURL(/openid-connect/);
    expect(await sidOf(context)).toBe(sid);
    const cookie = (await context.cookies(appUrl())).find((c) => c.name === SESSION_COOKIE)!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, path: '/' });
    expect(cookie.domain).toBe(new URL(appUrl()).hostname);
  });

  test('una mutación sin token CSRF se rechaza con 403 CSRF_REJECTED', async ({ page }) => {
    await login(page, 'owner');
    const r = await bff(page, 'POST', '/api/bff/v1/workspaces', {
      body: { name: 'Sin CSRF', baseCurrency: 'BOB' },
      headers: { 'x-csrf-token': 'no-valido' },
    });
    expect(r.status).toBe(403);
    expect(r.body?.['code']).toBe('CSRF_REJECTED');
  });
});
