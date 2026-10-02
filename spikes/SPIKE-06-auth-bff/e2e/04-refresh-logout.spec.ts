import { test, expect } from '@playwright/test';
import { API, APP, E, TOKEN_ENDPOINT, bff, evidence, jwtPayload, login, readSession, sidOf, valkey } from './helpers';

const expireAccessToken = (page: import('@playwright/test').Page) => bff(page, 'POST', '/api/bff/dev/expire-access-token', { body: {} });

test('refresh transparente, single-flight y rotación de refresh token', async ({ page, context }) => {
  await login(page, 'editor');
  const sid = await sidOf(context);
  const before = (await readSession(sid))!.data;
  const me1 = await bff(page, 'GET', '/api/bff/me');
  expect(me1.status).toBe(200);

  await page.waitForTimeout(1100); // iat tiene resolución de segundos
  expect((await expireAccessToken(page)).status).toBe(200);

  // 5 peticiones concurrentes con el access token "expirado": un solo refresh
  const parallel = await page.evaluate(async () => {
    const s = await (await fetch('/api/bff/session')).json();
    const rs = await Promise.all(Array.from({ length: 5 }, () => fetch('/api/bff/me').then((r) => r.status)));
    return { rs, csrf: s.csrfToken };
  });
  expect(parallel.rs).toEqual([200, 200, 200, 200, 200]);

  const after = (await readSession(sid))!.data;
  const me2 = await bff(page, 'GET', '/api/bff/me');
  expect(after.refreshCount).toBe(1);
  expect(after.accessToken).not.toBe(before.accessToken);
  expect(after.refreshToken).not.toBe(before.refreshToken); // rotación
  expect(me2.body.token.iat).toBeGreaterThan(me1.body.token.iat);

  // Reutilizar el refresh token viejo (rotado) => Keycloak lo rechaza
  const reuse = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: before.refreshToken, client_id: E.OIDC_CLIENT_ID!, client_secret: E.OIDC_CLIENT_SECRET! }),
  });
  const reuseBody = await reuse.json();
  expect(reuse.status).toBe(400);
  // ¿La sesión BFF sobrevive a un intento de reuse? (comportamiento de Keycloak, se documenta)
  // Se fuerza otro refresh con el refresh token VIGENTE para ver si Keycloak invalidó la familia.
  await expireAccessToken(page);
  const afterReuse = await bff(page, 'GET', '/api/bff/me');

  evidence('04a-refresh', {
    parallelStatuses: parallel.rs,
    refreshCount: after.refreshCount,
    accessTokenChanged: after.accessToken !== before.accessToken,
    refreshTokenRotated: after.refreshToken !== before.refreshToken,
    iatBefore: me1.body.token.iat,
    iatAfter: me2.body.token.iat,
    oldRefreshTokenReuse: { status: reuse.status, error: reuseBody.error, description: reuseBody.error_description },
    refreshWithCurrentTokenAfterReuseAttempt: `${afterReuse.status} ${afterReuse.body?.code ?? ''}`.trim(),
  });
});

test('logout: revoca refresh, borra sesión, RP-initiated logout en Keycloak', async ({ page, context, request }) => {
  await login(page, 'owner');
  const sid = await sidOf(context);
  const s = (await readSession(sid))!;
  const endSessionUrls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/protocol/openid-connect/logout')) endSessionUrls.push(r.url());
  });

  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(`${APP}/`);

  const end = new URL(endSessionUrls[0]!);
  expect(end.searchParams.get('post_logout_redirect_uri')).toBe(`${APP}/`);
  expect(await valkey.exists(s.key)).toBe(0); // sesión server-side borrada
  expect((await context.cookies(APP)).find((c) => c.name === '__Host-pfos_sid')).toBeUndefined();
  const sessionAfter = await page.evaluate(async () => (await fetch('/api/bff/session')).status);
  expect(sessionAfter).toBe(401);

  // Refresh token revocado en el IdP
  const useRevoked = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.data.refreshToken, client_id: E.OIDC_CLIENT_ID!, client_secret: E.OIDC_CLIENT_SECRET! }),
  });
  const useRevokedBody = await useRevoked.json();
  expect(useRevoked.status).toBe(400);

  // Sesión SSO de Keycloak cerrada: volver a /app pide credenciales (no hay auto-login silencioso)
  await page.goto('/app');
  await expect(page.locator('#username')).toBeVisible();

  // El id_token_hint viaja en la URL de logout: ¿sirve contra la API? No (aud=pfos-bff, typ=ID)
  const idTokenHint = end.searchParams.get('id_token_hint')!;
  const withIdToken = await request.get(`${API}/api/v1/me`, { headers: { Authorization: `Bearer ${idTokenHint}` } });
  expect(withIdToken.status()).toBe(401);

  // El access token (aún no expirado) sigue siendo válido contra la API hasta su exp: stateless JWT
  const oldAccess = await request.get(`${API}/api/v1/me`, { headers: { Authorization: `Bearer ${s.data.accessToken}` } });

  evidence('04b-logout', {
    endSessionParams: [...end.searchParams.keys()],
    valkeySessionExists: 0,
    sessionEndpointAfterLogout: sessionAfter,
    revokedRefreshToken: { status: useRevoked.status, error: useRevokedBody.error, description: useRevokedBody.error_description },
    loginFormShownAfterLogout: true,
    idTokenHintAgainstApi: { status: withIdToken.status(), reason: (await withIdToken.json()).reason, typ: jwtPayload(idTokenHint).typ, aud: jwtPayload(idTokenHint).aud },
    oldAccessTokenAgainstApiAfterLogout: oldAccess.status(),
  });
});
