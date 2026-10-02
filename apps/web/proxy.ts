import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

// Next 16: `proxy.ts` reemplaza a `middleware.ts`. Negociación de locale (es por defecto).
export default createMiddleware(routing);

export const config = {
  // Excluye /api (incluye /api/health/*), assets internos de Next y archivos con extensión.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
