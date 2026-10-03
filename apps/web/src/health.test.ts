import { describe, expect, it } from 'vitest';
import { liveness, readiness } from './health';

const WEB_ENV = {
  PFOS_ENV: 'ci',
  WEB_PUBLIC_URL: 'http://localhost:23000',
  FINANCE_API_URL: 'http://finance-api:8080',
  OIDC_ISSUER_URL: 'http://localhost:28081/realms/pfos',
  OIDC_CLIENT_SECRET: 'client-secret-0123456789',
  BFF_DATABASE_URL: 'postgres://pf_bff:s3cr3t-bff-pass@postgres:5432/pfos',
  BFF_SESSION_ENC_KEY: `k1:${'s'.repeat(32)}`,
};

describe('probes del web shell', () => {
  it('liveness responde 200 sin tocar dependencias', async () => {
    const res = liveness();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('readiness responde 503 indicando config si la configuración es inválida', async () => {
    const bad = await readiness({ PFOS_ENV: 'ci' }, async () => undefined);
    expect(bad.status).toBe(503);
    expect(await bad.json()).toEqual({
      status: 'not_ready',
      checks: { config: 'down' },
      failing: ['config'],
    });
  });

  it('readiness: 503 si el almacén de sesiones no responde y 200 si responde', async () => {
    const down = await readiness(WEB_ENV, async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ failing: ['sessionStore'] });
    const up = await readiness(WEB_ENV, async () => undefined);
    expect(up.status).toBe(200);
    expect(await up.json()).toEqual({
      status: 'ready',
      checks: { config: 'up', sessionStore: 'up' },
      failing: [],
    });
  });
});
