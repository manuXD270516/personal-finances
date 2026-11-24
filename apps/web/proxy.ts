import { loadConfig } from '@pf/platform/config';
import createMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { buildContentSecurityPolicy, cspHeaderName, filesOriginOf, generateNonce } from './src/security/csp';

const intl = createMiddleware(routing);

/** Páginas públicas (sin sesión): error de login y sesión expirada, con o sin prefijo de locale. */
const PUBLIC_PAGE = /^\/(?:(?:en|pt)\/)?auth(?:\/|$)/;
const SESSION_COOKIE = '__Host-pfos_sid';

let publicOrigin: string | undefined;
/** Origen público (`WEB_PUBLIC_URL`, contrato de configuración): el Host con el que escucha el contenedor no sirve. */
const origin = (): string => (publicOrigin ??= loadConfig('web').WEB_PUBLIC_URL);

interface CspSettings {
  readonly filesOrigin: string | undefined;
  readonly https: boolean;
  readonly reportOnly: boolean;
}
let cspSettings: CspSettings | undefined;
/** Parámetros de la CSP leídos una vez de la configuración de la web (`OBJECT_STORAGE_PUBLIC_ENDPOINT`, `WEB_CSP_REPORT_ONLY`). */
const settings = (): CspSettings => {
  if (cspSettings) return cspSettings;
  const config = loadConfig('web');
  cspSettings = {
    filesOrigin: filesOriginOf(config.OBJECT_STORAGE_PUBLIC_ENDPOINT),
    https: new URL(config.WEB_PUBLIC_URL).protocol === 'https:',
    reportOnly: config.WEB_CSP_REPORT_ONLY,
  };
  return cspSettings;
};

/**
 * Next 16: `proxy.ts` reemplaza a `middleware.ts`. Chequeo LIGERO de sesión (presencia de la cookie opaca): sin
 * cookie, toda página protegida redirige al login del BFF (Authorization Code + PKCE). La validez real de la
 * sesión la comprueba cada página en el servidor contra `iam.bff_session`. Luego, negociación de locale.
 *
 * CSP con nonce por petición (add-web-content-security-policy, NFR-SEC-008): la política va en la cabecera de la PETICIÓN
 * que se reenvía a Next (de ahí extrae el nonce para sus scripts) y en la de la RESPUESTA. `next-intl` arma sus rewrites
 * con las cabeceras de la petición que recibe, así que basta pasarle la petición ya con la política. Las redirecciones
 * (303 al login, locale) no tienen cuerpo HTML y no la llevan.
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
  const { filesOrigin, https, reportOnly } = settings();
  const policy = buildContentSecurityPolicy({
    nonce: generateNonce(),
    filesOrigin,
    https,
    // `NODE_ENV` es la constante de compilación de Next (dev server o no), no configuración de la aplicación.
    // eslint-disable-next-line no-restricted-properties
    development: process.env['NODE_ENV'] === 'development',
  });
  const headers = new Headers(req.headers);
  // Next lee el nonce de esta cabecera de la petición, también en modo informativo.
  headers.set('Content-Security-Policy', policy);
  const res = intl(new NextRequest(req, { headers }));
  if (res.status < 300 || res.status >= 400) res.headers.set(cspHeaderName(reportOnly), policy);
  return res;
}

export const config = {
  // Excluye /api (BFF y health), assets internos de Next y archivos con extensión.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
