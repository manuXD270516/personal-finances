import { createHash } from 'node:crypto';

/**
 * JSON Canonicalization Scheme (RFC 8785) para valores que vienen de `JSON.parse`: claves ordenadas por unidades
 * UTF-16, sin espacios, números con la serialización de ECMAScript y strings con `JSON.stringify`.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonicalJson: número no finito');
    return JSON.stringify(value);
  }
  if (Array.isArray(value))
    return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  throw new TypeError(`canonicalJson: tipo no serializable ${typeof value}`);
}

/**
 * `request_hash = SHA-256(method ‖ routeTemplate ‖ JCS(body))` (design §3). Separador NUL para que
 * `("POST", "/a")` y `("POS", "T/a")` no colisionen. Cuerpo ausente ⇒ `null`.
 */
export function idempotencyRequestHash(method: string, routeTemplate: string, body: unknown): string {
  return createHash('sha256')
    .update(method.toUpperCase())
    .update('\u0000')
    .update(routeTemplate)
    .update('\u0000')
    .update(canonicalJson(body === undefined ? null : body))
    .digest('hex');
}
