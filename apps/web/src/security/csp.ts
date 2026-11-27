/**
 * Política de seguridad de contenido de la web (openspec add-web-content-security-policy, NFR-SEC-008). Funciones puras:
 * `proxy.ts` genera un nonce por petición, arma la política y la pone en la petición reenviada (Next lo lee de ahí para
 * sus scripts) y en la respuesta.
 */

export interface CspInput {
  /** Nonce de la petición (base64). */
  readonly nonce: string;
  /** Origen (esquema, host y puerto) de la subida directa de documentos; sin él, `connect-src 'self'`. */
  readonly filesOrigin?: string | undefined;
  /** Origen público de la web en HTTPS: habilita `upgrade-insecure-requests`. */
  readonly https: boolean;
  /** `NODE_ENV=development`: suma `'unsafe-eval'` (pilas de React) y `ws:` (HMR). Nunca en producción. */
  readonly development: boolean;
}

/** 128 bits aleatorios por petición, en base64. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/** Reduce una URL a su origen (esquema, host y puerto, sin ruta ni consulta); `undefined` si no es una URL absoluta. */
export function filesOriginOf(url: string | undefined): string | undefined {
  if (url === undefined || url === '') return undefined;
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? undefined : origin;
  } catch {
    return undefined;
  }
}

/** Política de producción de la decisión 3 del design (una sola línea, en este orden). */
export function buildContentSecurityPolicy(input: CspInput): string {
  const nonce = `'nonce-${input.nonce}'`;
  const scriptSrc = ["'self'", nonce, "'strict-dynamic'", ...(input.development ? ["'unsafe-eval'"] : [])];
  const connectSrc = [
    "'self'",
    ...(input.filesOrigin ? [input.filesOrigin] : []),
    ...(input.development ? ['ws:'] : []),
  ];
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc.join(' ')}`,
    `style-src 'self' ${nonce}`,
    // React serializa `style={…}` como atributos en el HTML del servidor; los nonces no aplican a atributos (D457).
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSrc.join(' ')}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(input.https ? ['upgrade-insecure-requests'] : []),
  ];
  return directives.join('; ');
}

/** `WEB_CSP_REPORT_ONLY` (D458): misma política, cabecera informativa en lugar de aplicada. */
export function cspHeaderName(reportOnly: boolean): string {
  return reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
}
