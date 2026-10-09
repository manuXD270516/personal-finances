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
