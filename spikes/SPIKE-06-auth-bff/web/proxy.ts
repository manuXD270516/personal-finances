import { NextResponse, type NextRequest } from 'next/server';

// Next.js 16: `proxy.ts` (antes `middleware.ts`, runtime Node.js). Solo chequeo LIGERO:
// presencia de cookie -> si no hay, redirige a login. La validación real de la sesión
// ocurre en el Server Component / Route Handler (el proxy no consulta Valkey).
export function proxy(req: NextRequest) {
  if (!req.cookies.has('__Host-pfos_sid')) {
    const login = new URL('/api/bff/auth/login', req.url);
    login.searchParams.set('returnTo', req.nextUrl.pathname);
    return NextResponse.redirect(login, 303);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/app/:path*'] };
