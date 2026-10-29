import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  EventConsumerRuntime,
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
import { capturingLogger } from '../support/harness.js';

// Entrega agrupada (openspec optimize-consumer-throughput, platform/event-delivery) contra PostgreSQL real con pg-boss
// real: el backlog se encola directo en la cola del consumidor (como lo deja el relay).
const deps = inject('deps');
const quiet = capturingLogger('finance-worker', 'worker', 'warn').logger;
const TYPE = 'identity.WorkspaceSettingsChanged';

let workerPool: Pool;
let adminPool: Pool;

beforeAll(() => {
  workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 8 });
  adminPool = new Pool({ connectionString: deps.superuserUrl, max: 1 });
});

afterAll(async () => {
  await Promise.all([workerPool?.end(), adminPool?.end()]);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 60_000, stepMs = 100): Promise<T> {
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

async function ensureConsumerQueue(queue: PgBossJobQueue, def: EventConsumerDefinition): Promise<void> {
  const route = new EventSubscriptions([def]).routesFor(TYPE, 1)[0]!;
  await queue.ensureQueue(deadLetterQueueName(def.consumer));
  await queue.ensureQueue(route.queue, route.options);
}

/** Encola `events` en una sola transacción, como un lote del relay. */
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

describe('platform/event-delivery: entrega agrupada', () => {
  it('[TC-PLATFORM-THROUGHPUT-005] con lotes de 100 y versiones 1 a 10 de cada agregado, cada grupo trae a lo sumo una versión por agregado y se observan en orden', async () => {
    const AGGREGATES = 100;
    const VERSIONS = 10;
    const ws = randomUUID();
    const consumer = `it.grp${randomUUID().slice(0, 8)}`;
    const aggregates = Array.from({ length: AGGREGATES }, () => randomUUID());
    const observed = new Map<string, number[]>();
    let maxPerAggregateInGroup = 0;
    let groups = 0;
    const def: EventConsumerDefinition = {
      consumer,
      events: [{ type: TYPE, version: 1 }],
      concurrency: 1,
      grouping: { maxBatch: 100 },
      handler: async () => {
        throw new Error('el respaldo evento por evento no debe usarse');
      },
      groupHandler: async (events) => {
        groups += 1;
        const perAggregate = new Map<string, number>();
        for (const e of events) {
          perAggregate.set(e.aggregateId, (perAggregate.get(e.aggregateId) ?? 0) + 1);
          const list = observed.get(e.aggregateId) ?? [];
          list.push(e.aggregateVersion);
          observed.set(e.aggregateId, list);
        }
        maxPerAggregateInGroup = Math.max(maxPerAggregateInGroup, ...perAggregate.values());
      },
    };
    const queue = await startQueue();
    try {
      await ensureConsumerQueue(queue, def);
      for (let v = 1; v <= VERSIONS; v += 1) {
        await enqueue(
          queue,
          def,
          aggregates.map((agg) => eventFor(ws, agg, v)),
        );
      }
      const runtime = new EventConsumerRuntime({
        pool: workerPool,
        queue,
        subscriptions: new EventSubscriptions([def]),
        logger: quiet,
      });
      await runtime.start();
      await until(
        async () => ((await inboxCount(consumer)) >= AGGREGATES * VERSIONS ? true : undefined),
        90_000,
      );
      expect(maxPerAggregateInGroup).toBe(1);
      expect(groups).toBeLessThan(AGGREGATES * VERSIONS);
      for (const agg of aggregates) expect(observed.get(agg)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    } finally {
      await stopAll(queue);
    }
  }, 180_000);

  it('[TC-PLATFORM-THROUGHPUT-004] un lote con eventos de dos workspaces invoca el efecto una vez por workspace con el contexto RLS de cada uno', async () => {
    const w1 = randomUUID();
    const w2 = randomUUID();
    const consumer = `it.rls${randomUUID().slice(0, 8)}`;
    const calls: { contextWorkspace: string; workspaces: Set<string>; size: number }[] = [];
    const def: EventConsumerDefinition = {
      consumer,
      events: [{ type: TYPE, version: 1 }],
      concurrency: 1,
      grouping: { maxBatch: 100 },
      handler: async () => undefined,
      groupHandler: async (events, ctx) => {
        const { rows } = await ctx.tx.query(`SELECT current_setting('app.workspace_id', true) AS ws`);
        calls.push({
          contextWorkspace: (rows[0] as { ws: string }).ws,
          workspaces: new Set(events.map((e) => e.workspaceId)),
          size: events.length,
        });
      },
    };
    const queue = await startQueue();
    try {
      await ensureConsumerQueue(queue, def);
      await enqueue(queue, def, [
        ...Array.from({ length: 60 }, () => eventFor(w1, randomUUID(), 1)),
        ...Array.from({ length: 40 }, () => eventFor(w2, randomUUID(), 1)),
      ]);
      const runtime = new EventConsumerRuntime({
        pool: workerPool,
        queue,
        subscriptions: new EventSubscriptions([def]),
        logger: quiet,
      });
      await runtime.start();
      await until(async () => ((await inboxCount(consumer)) >= 100 ? true : undefined), 60_000);
      const bySize = new Map<string, number>();
      for (const c of calls) {
        expect(c.workspaces.size).toBe(1);
        expect(c.workspaces.has(c.contextWorkspace)).toBe(true);
        bySize.set(c.contextWorkspace, (bySize.get(c.contextWorkspace) ?? 0) + c.size);
      }
      expect(bySize.get(w1)).toBe(60);
      expect(bySize.get(w2)).toBe(40);
      // La cola puede entregar el lote en una o más lecturas: cada una produce a lo sumo una invocación por workspace.
      const inbox = await workerPool.query<{ workspace_id: string; n: number }>(
        'SELECT workspace_id, count(*)::int AS n FROM platform.inbox WHERE consumer = $1 GROUP BY workspace_id',
        [consumer],
      );
      expect(Object.fromEntries(inbox.rows.map((r) => [r.workspace_id, r.n]))).toEqual({
        [w1]: 60,
        [w2]: 40,
      });
    } finally {
      await stopAll(queue);
    }
  }, 120_000);

  it('[TC-PLATFORM-THROUGHPUT-003] si el efecto del grupo falla por un evento, ningún efecto del grupo queda y solo el culpable queda en reintento; los demás se registran una vez', async () => {
    const ws = randomUUID();
    const consumer = `it.fb${randomUUID().slice(0, 8)}`;
    const poisonAggregate = randomUUID();
    const poison = eventFor(ws, poisonAggregate, 1);
    const healthy = Array.from({ length: 9 }, () => eventFor(ws, randomUUID(), 1));
    const applied: string[] = [];
    const def: EventConsumerDefinition = {
      consumer,
      events: [{ type: TYPE, version: 1 }],
      concurrency: 1,
      grouping: { maxBatch: 100 },
      retryLimit: 1,
      retryDelaySeconds: 60,
      handler: async (event) => {
        if (event.aggregateId === poisonAggregate) throw new Error('no puedo aplicar el agregado A');
        applied.push(event.eventId);
      },
      groupHandler: async (events) => {
        // Efecto del grupo: aplica uno a uno y falla en el culpable, DESPUÉS de haber aplicado a los sanos.
        for (const e of events) {
          if (e.aggregateId === poisonAggregate) throw new Error('no puedo aplicar el agregado A');
          applied.push(`group:${e.eventId}`);
        }
      },
    };
    const queue = await startQueue();
    try {
      await ensureConsumerQueue(queue, def);
      await enqueue(queue, def, [poison, ...healthy]);
      const runtime = new EventConsumerRuntime({
        pool: workerPool,
        queue,
        subscriptions: new EventSubscriptions([def]),
        logger: quiet,
      });
      await runtime.start();
      await until(async () => ((await inboxCount(consumer)) >= 9 ? true : undefined), 60_000);
      await sleep(1500);
      // El culpable no quedó en el inbox y los 9 sanos se aplicaron una sola vez, por el camino individual.
      expect(await inboxCount(consumer)).toBe(9);
      const individually = applied.filter((a) => !a.startsWith('group:'));
      expect(new Set(individually)).toEqual(new Set(healthy.map((e) => e.eventId)));
      expect(individually).toHaveLength(9);
      const jobs = await adminPool.query<{ state: string; n: number }>(
        `SELECT state, count(*)::int AS n FROM pgboss.job WHERE name = $1 GROUP BY state`,
        [eventQueueName(consumer)],
      );
      const byState = Object.fromEntries(jobs.rows.map((r) => [r.state, r.n]));
      expect(byState['completed']).toBe(9);
      expect(byState['retry'] ?? 0).toBe(1);
    } finally {
      await stopAll(queue);
    }
  }, 120_000);
});
