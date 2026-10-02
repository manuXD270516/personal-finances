import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { csrfTokenFor } from '@/lib/csrf';
import { problem, sidOf } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Estado de sesión para el JS del navegador: identidad + token CSRF. NUNCA tokens OAuth. */
export async function GET(req: NextRequest) {
  const sid = sidOf(req);
  const s = await getSession(sid);
  if (!s || !sid) return problem(401, 'SESSION_REQUIRED');
  return NextResponse.json({
    authenticated: true,
    user: { sub: s.sub, name: s.name, email: s.email },
    csrfToken: csrfTokenFor(sid, s.csrfSecret),
    accessTokenExpiresInS: Math.round((s.accessTokenExpiresAt - Date.now()) / 1000),
    refreshCount: s.refreshCount,
  });
}
