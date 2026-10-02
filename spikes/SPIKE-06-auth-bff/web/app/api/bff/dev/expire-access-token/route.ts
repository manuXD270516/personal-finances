import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { getSession, saveSession } from '@/lib/session';
import { checkCsrfToken, checkOrigin } from '@/lib/csrf';
import { problem, sidOf } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** SOLO DEV (BFF_DEV_ENDPOINTS=1): marca el access token como expirado para probar el refresh transparente. */
export async function POST(req: NextRequest) {
  if (!env.devEndpoints) return problem(404, 'NOT_FOUND');
  const bad = checkOrigin(req);
  if (bad) return problem(bad.status, bad.code);
  const sid = sidOf(req);
  const s = await getSession(sid);
  if (!s || !sid) return problem(401, 'SESSION_REQUIRED');
  const badToken = checkCsrfToken(req, sid, s.csrfSecret);
  if (badToken) return problem(badToken.status, badToken.code);
  await saveSession(sid, { ...s, accessTokenExpiresAt: 0 });
  return NextResponse.json({ ok: true });
}
