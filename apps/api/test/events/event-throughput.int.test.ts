import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  EventConsumerRuntime,
  EventDeliveryMetrics,
  EventSubscriptions,
  deadLetterQueueName,
  eventQueueName,
  type EventConsumerDefinition,
  type EventEnvelope,
} from '@pf/platform/events';
import { uuidv7 } from '@pf/platform/logging';
import { PgBossJobQueue } from '@pf/platform/queue';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createWorkerRuntime } from '../../src/worker/create-worker-runtime.js';
import { baseEnv, capturingLogger, workerConfig } from '../support/harness.js';

// Rendimiento sostenido de los consumidores (openspec improve-event-throughput, platform/event-delivery) contra
// PostgreSQL real con pg-boss real: el backlog se encola directo en la cola del consumidor (como lo deja el relay) y se
// mide cuánto tarda el runtime de consumidores, con su configuración por defecto, en drenarlo.
const deps = inject('deps');
const quiet = capturingLogger('finance-worker', 'worker', 'warn').logger;
const TYPE = 'identity.WorkspaceSettingsChanged';

let workerPool: Pool;
let migratorPool: Pool;

beforeAll(() => {
  workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 12 });
  migratorPool = new Pool({ connectionString: deps.migratorUrl, max: 1 });
});

afterAll(async () => {
  await Promise.all([workerPool?.end(), migratorPool?.end()]);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 30_000, stepMs = 50): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error('until: timeout');
    await sleep(stepMs);
  }
}

const eventFor = (workspaceId: string, aggregateId: string, version: number): EventEnvelope => ({
  eventId: uuidv7(),
  eventType: TYPE,
  eventVersion: 1,
  occurredAt: new Date().toISOString(),
  workspaceId,
  aggregateType: 'Workspace',
  aggregateId,
  aggregateVersion: version,
  correlationId: uuidv7(),
  causationId: null,
  actor: { type: 'SYSTEM', id: null },
  payload: {},
});

async function startQueue(): Promise<PgBossJobQueue> {
  const queue = new PgBossJobQueue({
    connectionString: deps.workerDatabaseUrl,
    logger: quiet,
    pollingIntervalSeconds: 0.5,
    role: 'consumer',
  });
  await queue.start();
  return queue;
}

/** Crea la cola del consumidor (con su dead-letter y reintentos) como lo haría el relay. */
async function ensureConsumerQueue(queue: PgBossJobQueue, def: EventConsumerDefinition): Promise<void> {
  const route = new EventSubscriptions([def]).routesFor(TYPE, 1)[0]!;
  await queue.ensureQueue(deadLetterQueueName(def.consumer));
  await queue.ensureQueue(route.queue, route.options);
}

/** Encola `events` en una sola transacción, como un lote del relay (mismo `created_on`). */
async function enqueue(
  queue: PgBossJobQueue,
  def: EventConsumerDefinition,
  events: readonly EventEnvelope[],
): Promise<void> {
  const client = await workerPool.connect();
  try {
    await client.query('BEGIN');
    await queue.enqueueInTransaction(
      eventQueueName(def.consumer),
      events.map((e) => ({
        id: e.eventId,
        key: e.aggregateId,
        payload: e,
        correlationId: e.correlationId,
        traceContext: {},
      })),
      client,
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const inboxCount = async (consumer: string): Promise<number> =>
  (
    await workerPool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM platform.inbox WHERE consumer = $1',
      [consumer],
    )
  ).rows[0]!.n;

async function stopAll(queue: PgBossJobQueue): Promise<void> {
  await queue.drain();
  await queue.stop();
}

describe('platform/event-delivery: rendimiento sostenido de los consumidores', () => {
  it('[TC-PLATFORM-EVENTS-014] un backlog de 5 000 eventos en 500 agregados se drena en 120 s o menos con orden por agregado', async () => {
    const AGGREGATES = 500;
    const VERSIONS = 10;
    const ws = randomUUID();
    const consumer = `it.drain${randomUUID().slice(0, 8)}`;
    const aggregates = Array.from({ length: AGGREGATES }, () => randomUUID());
    const observed = new Map<string, number[]>();
    const def: EventConsumerDefinition = {
      consumer,
      events: [{ type: TYPE, version: 1 }],
      // Handler trivial: solo registra lo que ve, en el orden en que lo recibe.
      handler: async (event) => {
        const list = observed.get(event.aggregateId) ?? [];
        list.push(event.aggregateVersion);
        observed.set(event.aggregateId, list);
      },
    };
    const queue = await startQueue();
    try {
      await ensureConsumerQueue(queue, def);
      // Una ronda por versión (como los lotes sucesivos del relay): la cola ve las versiones en orden de confirmación.
      for (let v = 1; v <= VERSIONS; v++) {
        await enqueue(
          queue,
          def,
          aggregates.map((agg) => eventFor(ws, agg, v)),
        );
      }
      // Configuración por defecto del runtime (concurrencia 4, lotes de 10), sin overrides.
      const runtime = new EventConsumerRuntime({
        pool: workerPool,
        queue,
        subscriptions: new EventSubscriptions([def]),
        logger: quiet,
      });
      const started = Date.now();
      await runtime.start();
      await until(
        async () => ((await inboxCount(consumer)) >= AGGREGATES * VERSIONS ? true : undefined),
        150_000,
      );
      const seconds = (Date.now() - started) / 1000;
      process.stderr.write(
        `[TC-PLATFORM-EVENTS-014] ${AGGREGATES * VERSIONS} eventos en ${seconds.toFixed(1)} s (${(
          (AGGREGATES * VERSIONS) /
          seconds
        ).toFixed(0)} ev/s)\n`,
      );
      expect(seconds).toBeLessThanOrEqual(120);
      expect(observed.size).toBe(AGGREGATES);
      for (const agg of aggregates) expect(observed.get(agg)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    } finally {
      await stopAll(queue);
    }
  }, 240_000);

  it('[TC-PLATFORM-EVENTS-015] concurrencia 4 y lotes de 10 conservan el orden por agregado con un evento en reintento', async () => {
    const ws = randomUUID();
    const consumer = `it.order${randomUUID().slice(0, 8)}`;
    const slow = randomUUID();
    const others = Array.from({ length: 9 }, () => randomUUID());
    const calls: { aggregate: string; version: number; ok: boolean }[] = [];
    let failedOnce = false;
    const def: EventConsumerDefinition = {
      consumer,
      events: [{ type: TYPE, version: 1 }],
      concurrency: 4,
      batchSize: 10,
      retryDelaySeconds: 1,
      handler: async (event) => {
        await sleep(Math.random() * 10);
        if (event.aggregateId === slow && event.aggregateVersion === 1 && !failedOnce) {
          failedOnce = true;
          calls.push({ aggregate: event.aggregateId, version: 1, ok: false });
          throw new Error('fallo transitorio de v1');
        }
        calls.push({ aggregate: event.aggregateId, version: event.aggregateVersion, ok: true });
      },
    };
    const queue = await startQueue();
    try {
      await ensureConsumerQueue(queue, def);
      // v1..v5 del agregado A intercalados con 5 versiones de otros 9 agregados.
      for (let v = 1; v <= 5; v++) {
        await enqueue(
          queue,
          def,
          [slow, ...others].map((agg) => eventFor(ws, agg, v)),
        );
      }
      const runtime = new EventConsumerRuntime({
        pool: workerPool,
        queue,
        subscriptions: new EventSubscriptions([def]),
        logger: quiet,
      });
      await runtime.start();
      await until(async () => ((await inboxCount(consumer)) >= 50 ? true : undefined), 60_000);

      const okVersions = (agg: string) =>
        calls.filter((c) => c.aggregate === agg && c.ok).map((c) => c.version);
      expect(okVersions(slow)).toEqual([1, 2, 3, 4, 5]);
      for (const agg of others) expect(okVersions(agg)).toEqual([1, 2, 3, 4, 5]);
      // v2 de A no se intentó antes de que v1 se completara con éxito.
      const firstOkV1 = calls.findIndex((c) => c.aggregate === slow && c.version === 1 && c.ok);
      const firstV2 = calls.findIndex((c) => c.aggregate === slow && c.version === 2);
      expect(firstV2).toBeGreaterThan(firstOkV1);
      expect(calls.filter((c) => c.aggregate === slow && c.version === 1)).toHaveLength(2);
      // Los demás agregados avanzaron mientras v1 estaba en reintento.
      const lastOther = Math.max(...others.map((agg) => calls.map((c) => c.aggregate).lastIndexOf(agg)));
      expect(lastOther).toBeLessThan(firstOkV1);
    } finally {
      await stopAll(queue);
    }
  }, 90_000);

  it('[TC-PLATFORM-EVENTS-016] el fallo de un trabajo del lote no reintenta los demás', async () => {
    const ws = randomUUID();
    const consumer = `it.batch${randomUUID().slice(0, 8)}`;
    const failing = randomUUID();
    const aggregates = [failing, ...Array.from({ length: 9 }, () => randomUUID())];
    const attempts = new Map<string, number>();
    const def: EventConsumerDefinition = {
      consumer,
      events: [{ type: TYPE, version: 1 }],
      concurrency: 1,
      batchSize: 10,
      retryDelaySeconds: 1,
      handler: async (event) => {
        attempts.set(event.aggregateId, (attempts.get(event.aggregateId) ?? 0) + 1);
        if (event.aggregateId === failing && attempts.get(failing) === 1)
          throw new Error('falla el agregado A');
      },
    };
    const queue = await startQueue();
    try {
      await ensureConsumerQueue(queue, def);
      // Los 10 trabajos existen antes de arrancar: el primer lote los trae juntos.
      const events = aggregates.map((agg) => eventFor(ws, agg, 1));
      await enqueue(queue, def, events);
      const runtime = new EventConsumerRuntime({
        pool: workerPool,
        queue,
        subscriptions: new EventSubscriptions([def]),
        logger: quiet,
      });
      await runtime.start();
      // Los 9 restantes quedan registrados; el de A queda en reintento (su inbox no existe todavía).
      await until(async () => ((await inboxCount(consumer)) >= 9 ? true : undefined), 20_000);
      // El reintento de A llega y completa el inbox, sin tocar a los demás.
      await until(async () => ((await inboxCount(consumer)) >= 10 ? true : undefined), 20_000);
      await sleep(1_500);
      for (const agg of aggregates.slice(1)) expect(attempts.get(agg)).toBe(1);
      expect(attempts.get(failing)).toBe(2);
      expect(await inboxCount(consumer)).toBe(10);
      // Solo el trabajo de A pasó por reintento.
      const retried = await migratorPool.query<{ id: string }>(
        `SELECT id FROM pgboss.job WHERE name = $1 AND retry_count > 0`,
        [eventQueueName(consumer)],
      );
      expect(retried.rows.map((r) => r.id)).toEqual([events[0]!.eventId]);
    } finally {
      await stopAll(queue);
    }
  }, 60_000);

  it('[TC-PLATFORM-EVENTS-017] event_consumer_backlog y event_consumer_duration_seconds reportan por consumidor', async () => {
    const ws = randomUUID();
    const consumer = `it.metrics${randomUUID().slice(0, 8)}`;
    const def: EventConsumerDefinition = {
      consumer,
      events: [{ type: TYPE, version: 1 }],
      handler: async () => undefined,
    };
    const { meter, collect, durations } = fakeMeter();
    const metrics = new EventDeliveryMetrics(workerPool, meter);
    const queue = await startQueue();
    try {
      await ensureConsumerQueue(queue, def);
      await enqueue(
        queue,
        def,
        Array.from({ length: 7 }, () => eventFor(ws, randomUUID(), 1)),
      );
      const runtime = new EventConsumerRuntime({
        pool: workerPool,
        queue,
        subscriptions: new EventSubscriptions([def]),
        logger: quiet,
        metrics,
      });
      // Consumidor detenido: los 7 eventos están pendientes.
      expect((await collect()).get(consumer)).toBe(7);
      await runtime.start();
      await until(async () => ((await collect()).get(consumer) === 0 ? true : undefined), 20_000);
      expect(durations.filter((d) => d.attributes['consumer'] === consumer)).toHaveLength(7);
      // Sin etiquetas de alta cardinalidad: solo `consumer`.
      for (const d of durations) expect(Object.keys(d.attributes)).toEqual(['consumer']);
    } finally {
      await stopAll(queue);
    }
  }, 60_000);

  it('[TC-PLATFORM-EVENTS-018] el worker no arranca si la concurrencia sumada excede su pool de conexiones', async () => {
    const consumers: EventConsumerDefinition[] = Array.from({ length: 3 }, (_, i) => ({
      consumer: `it.pool${i}${randomUUID().slice(0, 8)}`,
      events: [{ type: TYPE, version: 1 }],
      handler: async () => undefined,
    }));
    const config = workerConfig(baseEnv(deps, { EVENT_CONSUMER_CONCURRENCY: '12', DATABASE_POOL_MAX: '10' }));
    const rejection = createWorkerRuntime(config, quiet, {
      eventConsumers: consumers,
      ledgerMaintenanceOnStart: false,
      fxGapFillOnStart: false,
      lifecycleBackfillOnStart: false,
      planningPeriodsOnStart: false,
    });
    await expect(rejection).rejects.toThrow(/concurrencia total .* es \d+ .*DATABASE_POOL_MAX=10/);
  }, 60_000);
});

type Meter = NonNullable<ConstructorParameters<typeof EventDeliveryMetrics>[1]>;
type Observable = object;
type BatchObservableCallback = (result: unknown) => unknown;

/** Meter falso que conserva los histogramas y evalúa los gauges observables con sus atributos. */
function fakeMeter() {
  const durations: { value: number; attributes: Record<string, unknown> }[] = [];
  const gauges = new Map<Observable, string>();
  let batch: BatchObservableCallback | undefined;
  const meter = {
    createCounter: () => ({ add: () => undefined }),
    createHistogram: () => ({
      record: (value: number, attributes: Record<string, unknown>) => durations.push({ value, attributes }),
    }),
    createObservableGauge: (name: string) => {
      const gauge = {} as Observable;
      gauges.set(gauge, name);
      return gauge;
    },
    addBatchObservableCallback: (cb: BatchObservableCallback) => {
      batch = cb;
    },
  } as unknown as Meter;
  /** Backlog por consumidor (`event_consumer_backlog{consumer}`). */
  async function collect(): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    await batch?.({
      observe: (o: Observable, v: number, attrs?: Record<string, unknown>) => {
        if (gauges.get(o) === 'pf.events.consumer.backlog') out.set(String(attrs?.['consumer']), v);
      },
    } as never);
    return out;
  }
  return { meter, collect, durations };
}
