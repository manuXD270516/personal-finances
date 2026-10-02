import { describe, expect, it } from 'vitest';
import { liveness, readiness } from './health';

describe('probes del web shell', () => {
  it('liveness responde 200 sin tocar dependencias', async () => {
    const res = liveness();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('readiness responde 503 indicando config si la configuración es inválida, y 200 si es válida', async () => {
    const bad = readiness({});
    expect(bad.status).toBe(503);
    expect(await bad.json()).toEqual({
      status: 'not_ready',
      checks: { config: 'down' },
      failing: ['config'],
    });
    expect(readiness({ PFOS_ENV: 'ci' }).status).toBe(200);
  });
});
