import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVENT_CONSUMER_BATCH_SIZE,
  DEFAULT_EVENT_CONSUMER_CONCURRENCY,
  RESERVED_WORKER_CONNECTIONS,
  assertConsumerConnectionBudget,
  consumerWorkOptions,
  totalConsumerConcurrency,
} from './consumers.js';

const defs = (...concurrencies: (number | undefined)[]) =>
  concurrencies.map((concurrency, i) => ({
    consumer: `it.c${i}`,
    ...(concurrency !== undefined ? { concurrency } : {}),
  }));

describe('configuración de consumidores (improve-event-throughput)', () => {
  it('sin configuración usa concurrencia 4 y lotes de 10', () => {
    expect(consumerWorkOptions({})).toEqual({ concurrency: 4, batchSize: 10 });
    expect(DEFAULT_EVENT_CONSUMER_CONCURRENCY).toBe(4);
    expect(DEFAULT_EVENT_CONSUMER_BATCH_SIZE).toBe(10);
  });

  it('la definición del consumidor manda sobre los defaults del runtime', () => {
    expect(consumerWorkOptions({ concurrency: 1 }, { concurrency: 8, batchSize: 25 })).toEqual({
      concurrency: 1,
      batchSize: 25,
    });
    expect(consumerWorkOptions({ batchSize: 3 }, { concurrency: 8 })).toEqual({
      concurrency: 8,
      batchSize: 3,
    });
  });

  it('valores no válidos (0, negativos, fraccionarios) caen al default en lugar de bloquear la cola', () => {
    expect(consumerWorkOptions({ concurrency: 0, batchSize: -1 }, { concurrency: 2.5 })).toEqual({
      concurrency: 4,
      batchSize: 10,
    });
  });

  it('[TC-PLATFORM-EVENTS-018] la concurrencia total suma la efectiva de cada consumidor', () => {
    expect(totalConsumerConcurrency(defs(undefined, 1, 2), { concurrency: 4 })).toBe(7);
  });

  it('[TC-PLATFORM-EVENTS-018] una configuración que cabe en el pool no falla', () => {
    expect(() =>
      assertConsumerConnectionBudget({
        consumers: defs(undefined, undefined),
        defaults: { concurrency: 4 },
        poolMax: 8 + RESERVED_WORKER_CONNECTIONS,
      }),
    ).not.toThrow();
  });

  it('[TC-PLATFORM-EVENTS-018] una configuración que excede el pool falla indicando concurrencia total y pool', () => {
    expect(() =>
      assertConsumerConnectionBudget({
        consumers: defs(undefined, undefined, undefined),
        defaults: { concurrency: 4 },
        poolMax: 10,
      }),
    ).toThrow(/concurrencia total de 3 consumidores de eventos es 12 .*DATABASE_POOL_MAX=10/);
  });
});

/** Archivo del repositorio (`deploy/...`) leído como texto: la plantilla del host es la fuente del presupuesto. */
const repoFile = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../${path}`, import.meta.url)), 'utf8');

describe('presupuesto de conexiones de la plantilla del host (add-conversion-cost-analysis, D249)', () => {
  const env = repoFile('deploy/host/etc-pfos/pfos.env.example');
  const compose = repoFile('deploy/compose/compose.prod.yaml');
  const poolMax = Number(/^DATABASE_POOL_MAX=(\d+)\s*$/mu.exec(env)?.[1]);
  const maxConnections = Number(/- max_connections=(\d+)/u.exec(compose)?.[1]);
  /** Pool de la API en la plantilla del host (add-basic-csv-import y posteriores: 22). */
  const apiPool = 22;

  it('[TC-PLATFORM-EVENTS-019] el worker con 28 consumidores de concurrencia 1 y 4 reservadas cabe en el pool de 34', () => {
    expect(poolMax).toBe(34);
    expect(() =>
      assertConsumerConnectionBudget({
        consumers: defs(...Array.from({ length: 28 }, () => 1)),
        poolMax,
      }),
    ).not.toThrow();
    expect(28 + RESERVED_WORKER_CONNECTIONS).toBe(32);
  });

  it('[TC-PLATFORM-EVENTS-019] con una concurrencia mayor que el pool el arranque falla indicando la concurrencia total y el pool', () => {
    expect(() =>
      assertConsumerConnectionBudget({
        consumers: defs(...Array.from({ length: 28 }, () => 1), 4),
        poolMax,
      }),
    ).toThrow(/concurrencia total de 29 consumidores de eventos es 32 .*DATABASE_POOL_MAX=34/);
  });

  it('[TC-PLATFORM-EVENTS-019] API 22 + worker 34 = 56 cabe en max_connections = 70 con margen', () => {
    expect(maxConnections).toBe(70);
    expect(apiPool + poolMax).toBe(56);
    expect(apiPool + poolMax).toBeLessThan(maxConnections);
  });
});
