import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createApiRuntime, type ApiRuntime } from '../../src/api/create-api-runtime.js';
import { apiConfig, baseEnv, capturingLogger, viaPort } from '../support/harness.js';
import { ToggleableTcpProxy } from '../support/tcp-proxy.js';

const deps = inject('deps');

describe('probes de salud de finance-api (platform/observability)', () => {
  const pgProxy = new ToggleableTcpProxy(deps.postgresHost, deps.postgresPort);
  const s3Proxy = new ToggleableTcpProxy(deps.s3Host, deps.s3Port);
  let runtime: ApiRuntime;
  let baseUrl: string;
  const dbPassword = new URL(deps.databaseUrl).password;

  beforeAll(async () => {
    await Promise.all([pgProxy.start(), s3Proxy.start()]);
    const env = baseEnv(deps, {
      DATABASE_URL: viaPort(deps.databaseUrl, pgProxy.port),
      OBJECT_STORAGE_ENDPOINT: `http://127.0.0.1:${s3Proxy.port}`,
    });
    runtime = await createApiRuntime(apiConfig(env), capturingLogger('finance-api', 'api').logger);
    baseUrl = await runtime.listen(0, '127.0.0.1');
  });

  afterAll(async () => {
    await pgProxy.restore().catch(() => {});
    await runtime?.close();
    await Promise.all([pgProxy.stop(), s3Proxy.stop()]);
  });

  const get = async (path: string) => {
    const res = await fetch(`${baseUrl}${path}`);
    return { status: res.status, body: (await res.json()) as Record<string, unknown>, text: '' };
  };

  it('[TC-PLATFORM-STACK-002] /health/ready responde 200 cuando PostgreSQL y el object storage responden', async () => {
    const ready = await get('/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({
      status: 'ready',
      checks: { postgres: 'up', 'object-storage': 'up' },
      failing: [],
    });
  });

  it('[TC-PLATFORM-OBS-001] /health/live responde 200 aunque la base de datos no sea alcanzable', async () => {
    await pgProxy.stop();
    try {
      const live = await get('/health/live');
      expect(live.status).toBe(200);
      // Sin detalles de dependencias ni secretos.
      expect(live.body).toEqual({ status: 'ok' });
    } finally {
      await pgProxy.restore();
    }
  });

  it('[TC-PLATFORM-STACK-002] sin PostgreSQL /health/ready = 503 indicando la dependencia, y vuelve a 200 sin reiniciar la API', async () => {
    await pgProxy.stop();
    const down = await get('/health/ready');
    expect(down.status).toBe(503);
    expect(down.body).toMatchObject({
      status: 'not_ready',
      failing: ['postgres'],
      checks: { postgres: 'down' },
    });
    const raw = JSON.stringify(down.body);
    expect(raw).not.toContain(dbPassword);
    expect(raw).not.toContain('127.0.0.1');
    expect((await get('/health/live')).status).toBe(200);

    await pgProxy.restore();
    const up = await get('/health/ready');
    expect(up.status).toBe(200);
    expect(up.body['status']).toBe('ready');
  });

  it('[TC-PLATFORM-STACK-002] sin object storage /health/ready = 503 indicando object-storage, y se recupera', async () => {
    await s3Proxy.stop();
    const down = await get('/health/ready');
    expect(down.status).toBe(503);
    expect(down.body).toMatchObject({
      failing: ['object-storage'],
      checks: { postgres: 'up', 'object-storage': 'down' },
    });
    expect(JSON.stringify(down.body)).not.toContain(deps.s3SecretKey);

    await s3Proxy.restore();
    expect((await get('/health/ready')).status).toBe(200);
  });

  it('los probes viven fuera de /api/v1', async () => {
    expect((await fetch(`${baseUrl}/api/v1/health/live`)).status).toBe(404);
  });
});

describe('readiness con Valkey habilitado por toggle', () => {
  it('[TC-PLATFORM-STACK-002] con SESSION_STORE=valkey, Valkey inalcanzable deja la API no lista indicando valkey', async () => {
    const closedPort = new ToggleableTcpProxy('127.0.0.1', 1);
    await closedPort.start();
    const port = closedPort.port;
    await closedPort.stop(); // puerto libre: nadie escucha

    const env = baseEnv(deps, {
      SESSION_STORE: 'valkey',
      VALKEY_URL: `redis://:clave-valkey@127.0.0.1:${port}/0`,
    });
    const runtime = await createApiRuntime(apiConfig(env), capturingLogger('finance-api', 'api').logger);
    try {
      const baseUrl = await runtime.listen(0, '127.0.0.1');
      const res = await fetch(`${baseUrl}/health/ready`);
      const body = (await res.json()) as Record<string, unknown>;
      expect(res.status).toBe(503);
      expect(body).toMatchObject({
        failing: ['valkey'],
        checks: { postgres: 'up', 'object-storage': 'up', valkey: 'down' },
      });
      expect(JSON.stringify(body)).not.toContain('clave-valkey');
    } finally {
      await runtime.close();
    }
  });

  it('con los toggles por defecto (pgboss + postgres) Valkey no se verifica', async () => {
    const runtime = await createApiRuntime(
      apiConfig(baseEnv(deps)),
      capturingLogger('finance-api', 'api').logger,
    );
    try {
      expect(runtime.resources.probe.dependencyNames).toEqual(['postgres', 'object-storage']);
    } finally {
      await runtime.close();
    }
  });
});
