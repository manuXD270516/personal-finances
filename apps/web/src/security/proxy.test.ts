import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const WEB_ENV = {
  PFOS_ENV: 'ci',
  WEB_PUBLIC_URL: 'https://app.pfos.example',
  FINANCE_API_URL: 'http://finance-api:8080',
  OIDC_ISSUER_URL: 'https://auth.pfos.example/realms/pfos',
  OIDC_CLIENT_SECRET: 'client-secret-0123456789',
  BFF_DATABASE_URL: 'postgres://pf_bff:s3cr3t-bff@db.internal:5432/pfos',
  BFF_SESSION_ENC_KEY: `k1:${'a'.repeat(32)}`,
  OBJECT_STORAGE_PUBLIC_ENDPOINT: 'https://files.pfos.example',
};

type Proxy = (req: NextRequest) => Response;
let proxy: Proxy;

const page = (path: string, cookie = '__Host-pfos_sid=abc') =>
  new NextRequest(`https://app.pfos.example${path}`, { headers: { cookie } });

const cspOf = (res: Response, name = 'content-security-policy'): string => {
  const value = res.headers.get(name);
  expect(value).toBeTruthy();
  return value as string;
};
const nonceOf = (policy: string): string => /script-src[^;]*'nonce-([^']+)'/.exec(policy)?.[1] ?? '';

beforeAll(async () => {
  for (const [name, value] of Object.entries(WEB_ENV)) vi.stubEnv(name, value);
  proxy = (await import('../../proxy')).default as Proxy;
});

describe('proxy.ts: CSP con nonce por petición (add-web-content-security-policy)', () => {
  it('[TC-SECURITY-CSP-001] la página sale con la CSP aplicada y reenvía a Next la política con el mismo nonce', () => {
    const res = proxy(page('/'));
    const policy = cspOf(res);
    expect(res.headers.get('content-security-policy-report-only')).toBeNull();
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' https://files.pfos.example;");
    // Mecanismo de Next: las cabeceras de la petición modificadas viajan en x-middleware-request-*.
    const forwarded = cspOf(res, 'x-middleware-request-content-security-policy');
    expect(nonceOf(forwarded)).toBe(nonceOf(policy));
    expect(res.headers.get('x-middleware-override-headers')).toContain('content-security-policy');
  });

  it('[TC-SECURITY-CSP-002] dos peticiones traen nonces distintos', () => {
    const a = nonceOf(cspOf(proxy(page('/'))));
    const b = nonceOf(cspOf(proxy(page('/'))));
    expect(a).not.toBe('');
    expect(b).not.toBe('');
    expect(a).not.toBe(b);
  });

  it('[TC-SECURITY-CSP-005] las páginas públicas de auth también llevan CSP con nonce propio, sin sesión', () => {
    const res = proxy(page('/auth/error', ''));
    expect(nonceOf(cspOf(res))).not.toBe('');
    expect(nonceOf(cspOf(res, 'x-middleware-request-content-security-policy'))).toBe(nonceOf(cspOf(res)));
  });

  it('[TC-SECURITY-CSP-001] la redirección al login no es HTML y no lleva CSP', () => {
    const res = proxy(page('/', ''));
    expect(res.status).toBe(303);
    expect(res.headers.get('content-security-policy')).toBeNull();
  });

  it('[TC-SECURITY-CSP-001] WEB_CSP_REPORT_ONLY: misma política en la cabecera informativa (D458)', async () => {
    vi.stubEnv('WEB_CSP_REPORT_ONLY', 'true');
    vi.resetModules();
    const reportOnly = (await import('../../proxy')).default as Proxy;
    const res = reportOnly(page('/'));
    expect(res.headers.get('content-security-policy')).toBeNull();
    const policy = cspOf(res, 'content-security-policy-report-only');
    expect(policy).toContain("frame-ancestors 'none'");
    // Next sigue leyendo el nonce de la petición reenviada.
    expect(nonceOf(cspOf(res, 'x-middleware-request-content-security-policy'))).toBe(nonceOf(policy));
    vi.stubEnv('WEB_CSP_REPORT_ONLY', '');
  });
});
