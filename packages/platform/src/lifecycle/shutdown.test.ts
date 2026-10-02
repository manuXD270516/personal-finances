import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../logging/index.js';
import { installGracefulShutdown } from './shutdown.js';

const silent = createLogger({
  service: 'test',
  role: 'api',
  environment: 'ci',
  level: 'silent',
  destination: new Writable({ write: (_c, _e, cb) => cb() }),
});

describe('apagado ordenado', () => {
  it('ejecuta la tarea una sola vez aunque lleguen varias señales y sale con 0', async () => {
    const exits: number[] = [];
    let runs = 0;
    const trigger = installGracefulShutdown(
      async () => {
        runs += 1;
        await new Promise((r) => setTimeout(r, 20));
      },
      { logger: silent, timeoutMs: 1000, signals: [], exit: (c) => exits.push(c) },
    );
    await Promise.all([trigger('SIGTERM'), trigger('SIGTERM')]);
    expect(runs).toBe(1);
    expect(exits).toEqual([0]);
  });

  it('sale con 1 si la tarea falla', async () => {
    const exits: number[] = [];
    const trigger = installGracefulShutdown(
      async () => {
        throw new Error('boom');
      },
      { logger: silent, timeoutMs: 1000, signals: [], exit: (c) => exits.push(c) },
    );
    await trigger('SIGTERM');
    expect(exits).toEqual([1]);
  });

  it('fuerza la salida con 1 si se supera el plazo', async () => {
    const exits: number[] = [];
    const trigger = installGracefulShutdown(() => new Promise(() => {}), {
      logger: silent,
      timeoutMs: 30,
      signals: [],
      exit: (c) => exits.push(c),
    });
    void trigger('SIGTERM');
    await new Promise((r) => setTimeout(r, 80));
    expect(exits).toEqual([1]);
  });
});
