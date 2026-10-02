import { NextResponse, type NextRequest } from 'next/server';
import { oidc, client } from '@/lib/oidc';
import { env } from '@/lib/env';
import { savePendingAuth } from '@/lib/session';
import { safeReturnTo } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Inicia Authorization Code + PKCE (S256). state/nonce/verifier quedan server-side, nunca en el navegador. */
export async function GET(req: NextRequest) {
  const config = await oidc();
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  await savePendingAuth(state, { codeVerifier, nonce, returnTo: safeReturnTo(req.nextUrl.searchParams.get('returnTo')) });
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: env.redirectUri,
    scope: env.scope,
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  return NextResponse.redirect(url, 303);
}
