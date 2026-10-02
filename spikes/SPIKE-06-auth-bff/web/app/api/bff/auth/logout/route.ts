import { NextResponse, type NextRequest } from 'next/server';
import { oidc, client } from '@/lib/oidc';
import { env } from '@/lib/env';
import { destroySession, getSession } from '@/lib/session';
import { checkCsrfToken, checkOrigin } from '@/lib/csrf';
import { clearSessionCookie, problem, sidOf } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Logout: (1) revoca refresh token en el IdP, (2) borra la sesión server-side, (3) borra la cookie,
 * (4) devuelve la URL de RP-initiated logout (end_session_endpoint) para cerrar la sesión SSO del IdP.
 * Es POST + CSRF para que un tercero no pueda desloguear al usuario (logout CSRF).
 */
export async function POST(req: NextRequest) {
  const bad = checkOrigin(req);
  if (bad) return problem(bad.status, bad.code);
  const sid = sidOf(req);
  const s = await getSession(sid);
  const config = await oidc();
  if (!s || !sid) {
    const res = NextResponse.json({ redirectTo: env.postLogoutRedirectUri });
    clearSessionCookie(res);
    return res;
  }
  const badToken = checkCsrfToken(req, sid, s.csrfSecret);
  if (badToken) return problem(badToken.status, badToken.code);

  if (s.refreshToken) {
    try {
      await client.tokenRevocation(config, s.refreshToken, { token_type_hint: 'refresh_token' });
    } catch (e) {
      console.warn(JSON.stringify({ msg: 'refresh_revocation_failed', err: e instanceof Error ? e.message : String(e) }));
    }
  }
  await destroySession(sid);
  const endSession = client.buildEndSessionUrl(config, {
    // id_token_hint evita la pantalla de confirmación de Keycloak. Ojo: el id_token viaja en la URL
    // (aud=pfos-bff, typ=ID): la API lo rechaza; ver README "Riesgos".
    ...(s.idToken ? { id_token_hint: s.idToken } : { client_id: env.clientId }),
    post_logout_redirect_uri: env.postLogoutRedirectUri,
  });
  const res = NextResponse.json({ redirectTo: endSession.href });
  clearSessionCookie(res);
  return res;
}
