import { loadConfig } from '@pf/platform/config';
import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);

/** Páginas públicas (sin sesión): error de login y sesión expirada, con o sin prefijo de locale. */
const PUBLIC_PAGE = /^\/(?:(?:en|pt)\/)?auth(?:\/|$)/;
const SESSION_COOKIE = '__Host-pfos_sid';

let publicOrigin: string | undefined;
/** Origen público (`WEB_PUBLIC_URL`, contrato de configuración): el Host con el que escucha el contenedor no sirve. */
const origin = (): string => (publicOrigin ??= loadConfig('web').WEB_PUBLIC_URL);

/**
 * Next 16: `proxy.ts` reemplaza a `middleware.ts`. Chequeo LIGERO de sesión (presencia de la cookie opaca): sin
 * cookie, toda página protegida redirige al login del BFF (Authorization Code + PKCE). La validez real de la
 * sesión la comprueba cada página en el servidor contra `iam.bff_session`. Luego, negociación de locale.
 */
export default function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (!PUBLIC_PAGE.test(pathname) && !req.cookies.has(SESSION_COOKIE)) {
    const login = new URL('/api/bff/auth/login', origin());
    login.searchParams.set('returnTo', `${pathname}${search}`);
    const res = NextResponse.redirect(login, 303);
    res.headers.set('cache-control', 'no-store');
    return res;
  }
  return intl(req);
}

export const config = {
  // Excluye /api (BFF y health), assets internos de Next y archivos con extensión.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
