import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { valkeyCheck } from './checks/valkey.js';
import { isValkeyEnabled } from './index.js';
import { ReadinessProbe, type DependencyCheck } from './readiness.js';

const ok = (name: string): DependencyCheck => ({ name, check: async () => {} });
const failing = (name: string): DependencyCheck => ({
  name,
  check: async () => {
    throw new Error(`connect ECONNREFUSED 10.0.0.1:5432 password=nunca-en-la-respuesta`);
  },
});
const hanging = (name: string): DependencyCheck => ({ name, check: () => new Promise(() => {}) });

describe('ReadinessProbe', () => {
  it('[TC-PLATFORM-STACK-002] informa no-listo indicando la dependencia que falla, sin detalles ni secretos', async () => {
    const seen: string[] = [];
    const probe = new ReadinessProbe([ok('object-storage'), failing('postgres')], 500, (n) => seen.push(n));
    const report = await probe.evaluate();
    expect(report).toEqual({
      status: 'not_ready',
      checks: { 'object-storage': 'up', postgres: 'down' },
      failing: ['postgres'],
    });
    expect(JSON.stringify(report)).not.toContain('nunca-en-la-respuesta');
    expect(seen).toEqual(['postgres']);
  });

  it('una dependencia que no responde cuenta como caída al vencer el timeout', async () => {
    const probe = new ReadinessProbe([hanging('object-storage'), ok('postgres')], 50);
    const started = Date.now();
    const report = await probe.evaluate();
    expect(report.failing).toEqual(['object-storage']);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('listo cuando todas las dependencias responden', async () => {
    const report = await new ReadinessProbe([ok('postgres'), ok('object-storage')], 100).evaluate();
    expect(report.status).toBe('ready');
  });

  it('Valkey solo es dependencia crítica con JOB_QUEUE_DRIVER=bullmq o SESSION_STORE=valkey', () => {
    expect(isValkeyEnabled({ JOB_QUEUE_DRIVER: 'pgboss', SESSION_STORE: 'postgres' })).toBe(false);
    expect(isValkeyEnabled({ JOB_QUEUE_DRIVER: 'bullmq', SESSION_STORE: 'postgres' })).toBe(true);
    expect(isValkeyEnabled({ JOB_QUEUE_DRIVER: 'pgboss', SESSION_STORE: 'valkey' })).toBe(true);
  });
});

describe('valkeyCheck (RESP sobre TCP)', () => {
  let server: Server | undefined;
  afterEach(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    server = undefined;
  });

  async function fakeValkey(reply: (cmds: string) => string): Promise<number> {
    server = createServer((socket) => {
      socket.on('data', (d) => socket.write(reply(d.toString('utf8'))));
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', () => r()));
    const address = server.address();
    if (typeof address !== 'object' || !address) throw new Error('sin puerto');
    return address.port;
  }

  it('responde up con AUTH + PING correctos', async () => {
    const port = await fakeValkey((cmds) => (cmds.includes('AUTH') ? '+OK\r\n+PONG\r\n' : '-ERR\r\n'));
    await expect(
      valkeyCheck(`redis://:clave@127.0.0.1:${port}/0`).check(new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it('falla si el servidor responde con error', async () => {
    const port = await fakeValkey(() => '-NOAUTH Authentication required.\r\n');
    await expect(
      valkeyCheck(`redis://127.0.0.1:${port}/0`).check(new AbortController().signal),
    ).rejects.toThrow();
  });

  it('falla si nadie escucha', async () => {
    const port = await fakeValkey(() => '');
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    await expect(
      valkeyCheck(`redis://127.0.0.1:${port}/0`).check(new AbortController().signal),
    ).rejects.toThrow();
  });
});
