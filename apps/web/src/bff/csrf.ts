import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Protección CSRF del BFF en capas (docs/12 §3, NFR-SEC-008):
 *  1. Cookie de sesión `SameSite=Lax` (el navegador no la envía en un POST cross-site).
 *  2. `Origin` (o, si falta, `Sec-Fetch-Site: same-origin`) igual al origen público de la app.
 *  3. Synchronizer token `X-CSRF-Token = HMAC-SHA256(csrfSecret, sid)`, ligado a la sesión.
 *  4. Cuerpos solo `application/json` / `application/merge-patch+json` (un `<form>` ajeno no puede producirlos
 *     sin preflight CORS).
 * Cualquier fallo ⇒ 403 `CSRF_REJECTED` sin reenviar nada a finance-api.
 */
export const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

export const isSafeMethod = (method: string): boolean => SAFE_METHODS.has(method.toUpperCase());

export const csrfTokenFor = (sid: string, csrfSecret: string): string =>
  createHmac('sha256', csrfSecret).update(sid, 'utf8').digest('base64url');

/** `true` si la petición mutante viene del propio origen. Los métodos seguros siempre pasan. */
export function originAllowed(req: Request, appOrigin: string): boolean {
  if (isSafeMethod(req.method)) return true;
  const origin = req.headers.get('origin');
  if (origin !== null) return origin === appOrigin;
  return req.headers.get('sec-fetch-site') === 'same-origin';
}

export function csrfTokenValid(req: Request, sid: string, csrfSecret: string): boolean {
  if (isSafeMethod(req.method)) return true;
  const given = Buffer.from(req.headers.get('x-csrf-token') ?? '', 'utf8');
  const expected = Buffer.from(csrfTokenFor(sid, csrfSecret), 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const JSON_TYPES = new Set(['application/json', 'application/merge-patch+json']);

/** Las mutaciones con cuerpo solo aceptan JSON; sin cuerpo (p. ej. DELETE) no se exige tipo. */
export function contentTypeAllowed(req: Request): boolean {
  if (isSafeMethod(req.method)) return true;
  const type = req.headers.get('content-type');
  if (type === null)
    return req.headers.get('content-length') === null || req.headers.get('content-length') === '0';
  const base = type.split(';')[0]!.trim().toLowerCase();
  if (JSON_TYPES.has(base)) return true;
  // `multipart/form-data` SÍ lo puede producir un <form> ajeno sin preflight: por eso solo se admite en la subida del
  // import del workspace y, como en todo POST, siguen exigidos el Origin propio y el X-CSRF-Token (capas 2 y 3), que un
  // <form> no puede fijar.
  return base === 'multipart/form-data' && new URL(req.url).pathname.endsWith('/v1/workspace-imports');
}
