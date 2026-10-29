import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { Logger } from '../logging/index.js';
import type { JobBatchHandler, JobContext, JobHandler, JobQueue, WorkOptions } from '../queue/job-queue.js';
import type { EventEnvelope } from './envelope.js';
import { EventDeliveryMetrics } from './metrics.js';
import {
  DEFAULT_EVENT_CONSUMER_BATCH_SIZE,
  DEFAULT_EVENT_CONSUMER_CONCURRENCY,
  EventConsumerRuntime,
  EventSubscriptions,
  RESERVED_WORKER_CONNECTIONS,
  assertConsumerConnectionBudget,
  consumerWorkOptions,
  totalConsumerConcurrency,
  type EventConsumerDefinition,
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

// ── Entrega agrupada (optimize-consumer-throughput, decisión 2) ──

const W1 = '0192a000-0000-7000-8000-000000000001';
const W2 = '0192a000-0000-7000-8000-000000000002';

const envelope = (n: number, workspaceId = W1): EventEnvelope => ({
  eventId: `0192b000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  eventType: 'ledger.JournalEntryPosted',
  eventVersion: 1,
  occurredAt: '2026-10-01T12:00:00.000Z',
  workspaceId,
  aggregateType: 'JournalEntry',
  aggregateId: `0192c000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  aggregateVersion: 1,
  correlationId: '0192d000-0000-7000-8000-000000000001',
  causationId: null,
  actor: { type: 'SYSTEM', id: null },
  payload: {},
});

interface FakeTransaction {
  workspaceId: string;
  statements: string[];
  outcome: 'committed' | 'rolled-back' | 'open';
}

/** Pool falso: inbox en memoria con transacciones; el rollback descarta lo insertado en la transacción. */
function fakePool() {
  const inbox = new Set<string>();
  const transactions: FakeTransaction[] = [];
  const pool = {
    connect: async () => {
      let tx: FakeTransaction | undefined;
      let staged: string[] = [];
      return {
        query: async (text: string, values: unknown[] = []) => {
          if (text.startsWith('BEGIN')) {
            tx = { workspaceId: '', statements: [], outcome: 'open' };
            transactions.push(tx);
            staged = [];
            return { rows: [] };
          }
          if (text === 'COMMIT') {
            for (const key of staged) inbox.add(key);
            tx!.outcome = 'committed';
            return { rows: [] };
          }
          if (text === 'ROLLBACK') {
            tx!.outcome = 'rolled-back';
            return { rows: [] };
          }
          if (text.includes('set_config')) {
            tx!.workspaceId = String(values[1]);
            return { rows: [] };
          }
          tx!.statements.push(
            text.includes('unnest') ? 'inbox-group' : text.includes('platform.inbox') ? 'inbox-one' : 'other',
          );
          if (text.includes('workspace_is_retired')) return { rows: [{ retired: false }] };
          if (text.includes('unnest')) {
            const consumer = String(values[0]);
            const ids = values[2] as string[];
            const fresh = ids.filter(
              (id) => !inbox.has(`${consumer}|${id}`) && !staged.includes(`${consumer}|${id}`),
            );
            for (const id of fresh) staged.push(`${consumer}|${id}`);
            return { rows: fresh.map((event_id) => ({ event_id })) };
          }
          if (text.includes('platform.inbox')) {
            const key = `${String(values[0])}|${String(values[1])}`;
            if (inbox.has(key)) return { rows: [] };
            staged.push(key);
            return { rows: [{ '?column?': 1 }] };
          }
          return { rows: [] };
        },
        release: () => undefined,
      };
    },
    query: async () => ({ rows: [], rowCount: 0 }),
  } as unknown as Pool;
  return { pool, inbox, transactions };
}

function fakeQueue() {
  const handlers = new Map<
    string,
    { single?: JobHandler<EventEnvelope>; batch?: JobBatchHandler<EventEnvelope>; options: WorkOptions }
  >();
  const queue = {
    ensureQueue: async () => undefined,
    work: async (name: string, options: WorkOptions, handler: JobHandler<EventEnvelope>) => {
      handlers.set(name, { ...handlers.get(name), single: handler, options });
    },
    workBatch: async (name: string, options: WorkOptions, handler: JobBatchHandler<EventEnvelope>) => {
      handlers.set(name, { ...handlers.get(name), batch: handler, options });
    },
  } as unknown as JobQueue;
  return { queue, handlers };
}

const silent = {
  info: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
} as unknown as Logger;

const job = (event: EventEnvelope, attempt = 1): JobContext<EventEnvelope> => ({
  id: event.eventId,
  queue: 'events.it.grouped',
  attempt,
  payload: event,
  correlationId: event.correlationId as string,
  signal: new AbortController().signal,
});

function setup(def: Partial<EventConsumerDefinition> = {}) {
  const calls: { events: string[]; workspaceId: string }[] = [];
  const single: string[] = [];
  const definition: EventConsumerDefinition = {
    consumer: 'it.grouped',
    events: [{ type: 'ledger.JournalEntryPosted', version: 1 }],
    handler: async (e) => {
      single.push(e.eventId);
    },
    grouping: {},
    groupHandler: async (events) => {
      calls.push({ events: events.map((e) => e.eventId), workspaceId: events[0]!.workspaceId });
    },
    ...def,
  };
  const { pool, inbox, transactions } = fakePool();
  const { queue, handlers } = fakeQueue();
  const metricsCalls: string[] = [];
  const metrics = {
    consumed: () => undefined,
    duplicate: () => undefined,
    deadLettered: () => undefined,
    trackConsumers: () => undefined,
    groupApplied: (c: string, n: number) => metricsCalls.push(`applied:${c}:${String(n)}`),
    groupFallback: (c: string) => metricsCalls.push(`fallback:${c}`),
  } as unknown as EventDeliveryMetrics;
  const subscriptions = new EventSubscriptions([definition]);
  const runtime = new EventConsumerRuntime({ pool, queue, subscriptions, logger: silent, metrics });
  const run = async (jobs: JobContext<EventEnvelope>[]) => {
    await runtime.start();
    return handlers.get('events.it.grouped')!.batch!(jobs);
  };
  return { calls, single, inbox, transactions, run, handlers, runtime, metricsCalls };
}

describe('entrega agrupada de eventos (optimize-consumer-throughput)', () => {
  it('[TC-PLATFORM-THROUGHPUT-001] 100 eventos de un workspace se aplican en una transacción, con inbox de 100 y una invocación', async () => {
    const t = setup();
    const events = Array.from({ length: 100 }, (_, i) => envelope(i + 1));
    const results = await t.run(events.map((e) => job(e)));
    expect(results.every((r) => r.error === undefined)).toBe(true);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.events).toHaveLength(100);
    expect(t.inbox.size).toBe(100);
    const committed = t.transactions.filter((x) => x.outcome === 'committed');
    expect(committed).toHaveLength(1);
    expect(committed[0]!.workspaceId).toBe(W1);
    expect(committed[0]!.statements.filter((s) => s === 'inbox-group')).toHaveLength(1);
    expect(t.single).toEqual([]);
  });

  it('[TC-PLATFORM-THROUGHPUT-002] los eventos ya registrados en el inbox no vuelven a aplicarse', async () => {
    const t = setup();
    const events = Array.from({ length: 100 }, (_, i) => envelope(i + 1));
    for (const e of events.slice(0, 3)) t.inbox.add(`it.grouped|${e.eventId}`);
    const results = await t.run(events.map((e) => job(e)));
    expect(results.every((r) => r.error === undefined)).toBe(true);
    expect(t.calls).toHaveLength(1);
    expect(t.calls[0]!.events).toEqual(events.slice(3).map((e) => e.eventId));
    expect(t.inbox.size).toBe(100);
  });

  it('[TC-PLATFORM-THROUGHPUT-002] si todo el lote son duplicados no invoca el efecto y confirma los trabajos', async () => {
    const t = setup();
    const events = [envelope(1), envelope(2)];
    for (const e of events) t.inbox.add(`it.grouped|${e.eventId}`);
    const results = await t.run(events.map((e) => job(e)));
    expect(results.every((r) => r.error === undefined)).toBe(true);
    expect(t.calls).toHaveLength(0);
  });

  it('[TC-PLATFORM-THROUGHPUT-003] si el grupo falla se revierte y se reintenta evento por evento: solo el culpable queda en reintento', async () => {
    const poison = envelope(5);
    const single: string[] = [];
    const t = setup({
      groupHandler: async (events) => {
        if (events.some((e) => e.eventId === poison.eventId)) throw new Error('no puedo aplicar el agregado A');
      },
      handler: async (e) => {
        if (e.eventId === poison.eventId) throw new Error('no puedo aplicar el agregado A');
        single.push(e.eventId);
      },
    });
    const events = Array.from({ length: 10 }, (_, i) => envelope(i + 1));
    const results = await t.run(events.map((e) => job(e)));
    const failed = results.filter((r) => r.error !== undefined);
    expect(failed.map((r) => r.id)).toEqual([poison.eventId]);
    // Los 9 sanos quedaron registrados una sola vez; el culpable, no.
    expect(t.inbox.size).toBe(9);
    expect(t.inbox.has(`it.grouped|${poison.eventId}`)).toBe(false);
    expect(t.transactions.filter((x) => x.outcome === 'rolled-back').length).toBeGreaterThanOrEqual(1);
    expect(t.metricsCalls).toContain('fallback:it.grouped');
    expect(single).toHaveLength(9);
  });

  it('[TC-PLATFORM-THROUGHPUT-004] un lote de dos workspaces invoca el efecto dos veces, cada una con su contexto', async () => {
    const t = setup();
    const events = [
      ...Array.from({ length: 60 }, (_, i) => envelope(i + 1, W1)),
      ...Array.from({ length: 40 }, (_, i) => envelope(i + 101, W2)),
    ];
    await t.run(events.map((e) => job(e)));
    expect(t.calls.map((c) => [c.workspaceId, c.events.length])).toEqual([
      [W1, 60],
      [W2, 40],
    ]);
    const committed = t.transactions.filter((x) => x.outcome === 'committed');
    expect(committed.map((x) => x.workspaceId)).toEqual([W1, W2]);
  });

  it('[TC-PLATFORM-THROUGHPUT-006] un consumidor sin agrupación usa la cola por evento y una transacción por entrega', async () => {
    const { pool, transactions } = fakePool();
    const { queue, handlers } = fakeQueue();
    const single: string[] = [];
    const def: EventConsumerDefinition = {
      consumer: 'it.plain',
      events: [{ type: 'ledger.JournalEntryPosted', version: 1 }],
      handler: async (e) => {
        single.push(e.eventId);
      },
    };
    const runtime = new EventConsumerRuntime({
      pool,
      queue,
      subscriptions: new EventSubscriptions([def]),
      logger: silent,
    });
    await runtime.start();
    const entry = handlers.get('events.it.plain')!;
    expect(entry.batch).toBeUndefined();
    for (let i = 1; i <= 10; i += 1) await entry.single!({ ...job(envelope(i)), queue: 'events.it.plain' });
    expect(single).toHaveLength(10);
    expect(transactions.filter((x) => x.outcome === 'committed')).toHaveLength(10);
  });

  it('[TC-PLATFORM-THROUGHPUT-006] el consumidor agrupado pide lotes de 100 por omisión y su maxBatch manda', async () => {
    const t = setup();
    await t.runtime.start();
    expect(t.handlers.get('events.it.grouped')!.options.batchSize).toBe(100);
    const t2 = setup({ grouping: { maxBatch: 250 } });
    await t2.runtime.start();
    expect(t2.handlers.get('events.it.grouped')!.options.batchSize).toBe(250);
  });

  it('[TC-PLATFORM-THROUGHPUT-006] definir grouping sin groupHandler (o al revés) o un maxBatch fuera de 1–500 falla al registrar', () => {
    const base = { consumer: 'it.bad', events: [{ type: 'a.B', version: 1 }], handler: async () => undefined };
    expect(() => new EventSubscriptions([{ ...base, grouping: {} }])).toThrow(/groupHandler/);
    expect(() => new EventSubscriptions([{ ...base, groupHandler: async () => undefined }])).toThrow(/grouping/);
    expect(
      () =>
        new EventSubscriptions([{ ...base, grouping: { maxBatch: 501 }, groupHandler: async () => undefined }]),
    ).toThrow(/maxBatch/);
  });

  it('[TC-PLATFORM-THROUGHPUT-011] la métrica registra una observación de 100 eventos por invocación y los grupos reintentados', async () => {
    const t = setup();
    await t.run(Array.from({ length: 100 }, (_, i) => job(envelope(i + 1))));
    expect(t.metricsCalls).toContain('applied:it.grouped:100');
    expect(t.metricsCalls.filter((m) => m.startsWith('fallback'))).toHaveLength(0);
  });
});
