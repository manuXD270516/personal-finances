import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, cspHeaderName, filesOriginOf, generateNonce } from './csp';

const NONCE = 'AAAAAAAAAAAAAAAAAAAAAA==';

const directives = (policy: string): Map<string, string[]> =>
  new Map(
    policy
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((p) => p[0] !== '')
      .map(([name, ...values]) => [name as string, values]),
  );

const prod = (overrides: Partial<Parameters<typeof buildContentSecurityPolicy>[0]> = {}) =>
  buildContentSecurityPolicy({
    nonce: NONCE,
    filesOrigin: 'https://files.pfos.example',
    https: true,
    development: false,
    ...overrides,
  });

describe('constructor de la CSP de la web (add-web-content-security-policy)', () => {
  it('[TC-SECURITY-CSP-001] producción: scripts solo con nonce y strict-dynamic, sin unsafe-inline ni unsafe-eval', () => {
    const d = directives(prod());
    expect(d.get('script-src')).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
    expect(prod()).not.toMatch(/unsafe-eval/);
    expect(d.get('script-src')?.join(' ')).not.toContain('unsafe-inline');
    expect(d.get('default-src')).toEqual(["'self'"]);
  });

  it('[TC-SECURITY-CSP-001] orden y directivas cerradas de la decisión 3 del design', () => {
    expect(prod()).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'`,
        `style-src 'self' 'nonce-${NONCE}'`,
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        "connect-src 'self' https://files.pfos.example",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        'upgrade-insecure-requests',
      ].join('; '),
    );
  });

  it('[TC-SECURITY-CSP-003] connect-src es self más el origen de archivos, reducido a esquema, host y puerto', () => {
    expect(filesOriginOf('https://files.pfos.example/pfos-quarantine/ws/x?y=1')).toBe(
      'https://files.pfos.example',
    );
    expect(filesOriginOf('http://127.0.0.1:29000/')).toBe('http://127.0.0.1:29000');
    const d = directives(prod({ filesOrigin: filesOriginOf('https://files.pfos.example/ruta') }));
    expect(d.get('connect-src')).toEqual(["'self'", 'https://files.pfos.example']);
  });

  it('[TC-SECURITY-CSP-003] sin origen de archivos (o inválido), connect-src es solo self', () => {
    expect(filesOriginOf(undefined)).toBeUndefined();
    expect(filesOriginOf('no es una url')).toBeUndefined();
    expect(directives(prod({ filesOrigin: undefined })).get('connect-src')).toEqual(["'self'"]);
  });

  it('[TC-SECURITY-CSP-004] frame-ancestors none, object-src none, base-uri none y form-action self', () => {
    const d = directives(prod());
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.get('base-uri')).toEqual(["'none'"]);
  });

  it('[TC-SECURITY-CSP-006] estilos: hojas con self y nonce, atributos en línea permitidos (D457)', () => {
    const d = directives(prod());
    expect(d.get('style-src')).toEqual(["'self'", `'nonce-${NONCE}'`]);
    expect(d.get('style-src-attr')).toEqual(["'unsafe-inline'"]);
  });

  it('[TC-SECURITY-CSP-001] upgrade-insecure-requests solo con origen HTTPS', () => {
    expect(directives(prod({ https: true })).has('upgrade-insecure-requests')).toBe(true);
    expect(directives(prod({ https: false })).has('upgrade-insecure-requests')).toBe(false);
  });

  it('[TC-SECURITY-CSP-001] unsafe-eval y ws: solo en desarrollo', () => {
    const dev = directives(prod({ development: true }));
    expect(dev.get('script-src')).toContain("'unsafe-eval'");
    expect(dev.get('connect-src')).toContain('ws:');
    const production = directives(prod({ development: false }));
    expect(production.get('script-src')).not.toContain("'unsafe-eval'");
    expect(production.get('connect-src')).not.toContain('ws:');
  });

  it('[TC-SECURITY-CSP-001] WEB_CSP_REPORT_ONLY solo cambia el nombre de la cabecera, no la política (D458)', () => {
    expect(cspHeaderName(false)).toBe('Content-Security-Policy');
    expect(cspHeaderName(true)).toBe('Content-Security-Policy-Report-Only');
  });

  it('[TC-SECURITY-CSP-002] 1000 nonces distintos de al menos 128 bits', () => {
    const nonces = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const nonce = generateNonce();
      expect(Buffer.from(nonce, 'base64').length).toBeGreaterThanOrEqual(16);
      expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
      nonces.add(nonce);
    }
    expect(nonces.size).toBe(1000);
  });
});
