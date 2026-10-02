import { NextResponse, type NextRequest } from 'next/server';
import { oidc, client } from '@/lib/oidc';
import { env } from '@/lib/env';
import { consumePendingAuth, createSession, destroySession } from '@/lib/session';
import { problem, setSessionCookie, sidOf } from '@/lib/http';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get('state');
  if (!state) return problem(400, 'OIDC_STATE_MISSING');
  const pending = await consumePendingAuth(state); // one-time
  if (!pending) return problem(400, 'OIDC_STATE_UNKNOWN_OR_REUSED');

  const config = await oidc();
  // URL "actual" reconstruida sobre el redirect_uri registrado (no confiar en Host).
  const currentUrl = new URL(env.redirectUri);
  currentUrl.search = req.nextUrl.search;
  let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
  try {
    tokens = await client.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: pending.codeVerifier,
      expectedState: state,
      expectedNonce: pending.nonce,
      idTokenExpected: true, // valida firma, iss, aud, nonce, exp del id_token
    });
  } catch (e) {
    console.warn(JSON.stringify({ msg: 'oidc_callback_failed', err: e instanceof Error ? e.message : String(e) }));
    return problem(400, 'OIDC_CALLBACK_FAILED');
  }
  const claims = tokens.claims()!;

  // Rotación de sesión en login: cualquier sid previo se invalida.
  await destroySession(sidOf(req));
  const sid = await createSession({
    sub: claims.sub,
    name: typeof claims.name === 'string' ? claims.name : undefined,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    accessToken: tokens.access_token,
    accessTokenExpiresAt: Date.now() + (tokens.expires_in ?? 60) * 1000,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
  });
  const res = NextResponse.redirect(new URL(pending.returnTo, env.appOrigin), 303);
  setSessionCookie(res, sid);
  return res;
}
