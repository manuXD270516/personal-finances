import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { PgUnitOfWork, requireSqlExecutor } from '@pf/platform/api';
import {
  EventConsumerRuntime,
  EventContractError,
  EventDeliveryMetrics,
  EventSubscriptions,
  OutboxRelay,
  PgOutboxWriter,
  deadLetterQueueName,
  eventQueueName,
  purgeDeliveredEvents,
  readOutboxBacklog,
  type DomainEventDraft,
  type EventConsumerDefinition,
  type EventEnvelope,
  type OutboxRelayOptions,
} from '@pf/platform/events';
import { currentCorrelation, runWithCorrelation, uuidv7 } from '@pf/platform/logging';
import { PgBossJobQueue, type JobQueue } from '@pf/platform/queue';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { createWorkerRuntime } from '../../src/worker/create-worker-runtime.js';
import { baseEnv, capturingLogger, workerConfig } from '../support/harness.js';

// Entrega de eventos (openspec add-event-outbox, platform/event-delivery) contra PostgreSQL real con pg-boss real:
// productor como pf_app (RLS del workspace), relay y consumidores como pf_worker.
const deps = inject('deps');
const quiet = capturingLogger('finance-worker', 'worker', 'warn').logger;
const USER = '0199b000-0000-7000-8000-0000000000aa';
const TYPE = 'identity.WorkspaceSettingsChanged';

let appPool: Pool;
let workerPool: Pool;
let migratorPool: Pool;
const writer = new PgOutboxWriter(eventSchemaRegistry());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => Promise<T | undefined>, timeoutMs = 30_000, stepMs = 100): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() - started > timeoutMs) throw new Error('until: timeout');
    await sleep(stepMs);
  }
}

/** Evento válido de `identity.WorkspaceSettingsChanged.v1` para un agregado y versión. */
function settingsChanged(workspaceId: string, aggregateId: string, version: number): DomainEventDraft {
  return {
    eventId: uuidv7(),
    eventType: TYPE,
    eventVersion: 1,
    occurredAt: new Date().toISOString(),
    workspaceId,
    aggregateType: 'Workspace',
    aggregateId,
    aggregateVersion: version,
    actor: { type: 'USER', id: USER },
    payload: {
      workspaceId,
      changes: [{ field: 'fiscalMonthStartDay', before: 1, after: (version % 28) + 1 }],
    },
  };
}

/** "Comando": un efecto de negocio y sus eventos en la misma unidad de trabajo (rol pf_app, RLS del workspace). */
async function command(
  workspaceId: string,
  drafts: readonly DomainEventDraft[],
  fail?: () => void,
): Promise<EventEnvelope[]> {
  return new PgUnitOfWork(appPool).run({ userId: USER, workspaceId }, async () => {
    await requireSqlExecutor().query(
      `INSERT INTO platform.it_event_effect (consumer, event_id, workspace_id, aggregate_id, aggregate_version)
       VALUES ('command', $1, $2, $2, 0)`,
      [randomUUID(), workspaceId],
    );
    const written: EventEnvelope[] = [];
    for (const d of drafts) written.push(await writer.append(d));
    fail?.();
    return written;
  });
}

/** Consulta como pf_worker con el contexto RLS de `workspaceId`. */
async function asWorker<R>(workspaceId: string, text: string, values: unknown[] = []): Promise<R[]> {
  const client = await workerPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', '', true), set_config('app.workspace_id', $1, true)`,
      [workspaceId],
    );
    const { rows } = await client.query(text, values);
    await client.query('COMMIT');
    return rows as R[];
  } finally {
    client.release();
  }
}

interface Effect {
  consumer: string;
  event_id: string;
  aggregate_id: string;
  aggregate_version: number;
}

const effects = (workspaceId: string, consumer: string) =>
  asWorker<Effect>(
    workspaceId,
    `SELECT consumer, event_id, aggregate_id, aggregate_version FROM platform.it_event_effect
      WHERE consumer = $1 ORDER BY id`,
    [consumer],
  );

const outboxRows = (ids: readonly string[]) =>
  workerPool
    .query<{ id: string; published_at: Date | null; publish_attempts: number; last_error: string | null }>(
      'SELECT id, published_at, publish_attempts, last_error FROM platform.outbox WHERE id = ANY($1::uuid[])',
      [ids],
    )
    .then((r) => r.rows);

/** Consumidor que registra el efecto en la tabla con RLS (solo eventos de su workspace). */
function recordingConsumer(
  workspaceId: string,
  over: Partial<EventConsumerDefinition> & { before?: (e: EventEnvelope) => Promise<void> | void } = {},
): EventConsumerDefinition {
  const consumer = over.consumer ?? `it.c${randomUUID().slice(0, 8)}`;
  return {
    consumer,
    events: [{ type: TYPE, version: 1 }],
    retryDelaySeconds: 1,
    ...over,
    handler:
      over.handler ??
      (async (event, ctx) => {
        if (event.workspaceId !== workspaceId) return;
        await over.before?.(event);
        await ctx.tx.query(
          `INSERT INTO platform.it_event_effect (consumer, event_id, workspace_id, aggregate_id, aggregate_version)
           VALUES ($1, $2, $3, $4, $5)`,
          [consumer, event.eventId, event.workspaceId, event.aggregateId, event.aggregateVersion],
        );
      }),
  };
}

class SpyMetrics extends EventDeliveryMetrics {
  duplicates = 0;
  dead = 0;
  failures = 0;
  constructor() {
    super(undefined);
  }
  override duplicate(): void {
    this.duplicates += 1;
  }
  override deadLettered(): void {
    this.dead += 1;
  }
  override publishFailed(): void {
    this.failures += 1;
  }
}

interface Worker {
  readonly queue: JobQueue;
  readonly relay: OutboxRelay;
  readonly consumers: EventConsumerRuntime;
  stop(): Promise<void>;
}

/** Relay + consumidores sobre pg-boss real (rol pf_worker); `queue` permite envolver la cola (fallos). */
async function startWorker(
  defs: readonly EventConsumerDefinition[],
  options: {
    metrics?: EventDeliveryMetrics;
    relay?: Partial<OutboxRelayOptions>;
    wrap?: (q: JobQueue) => JobQueue;
    startRelay?: boolean;
  } = {},
): Promise<Worker> {
  const base = new PgBossJobQueue({
    connectionString: deps.workerDatabaseUrl,
    logger: quiet,
    pollingIntervalSeconds: 0.5,
    role: 'consumer',
  });
  await base.start();
  const queue = options.wrap ? options.wrap(base) : base;
  const subscriptions = new EventSubscriptions(defs);
  const metrics = options.metrics ?? new SpyMetrics();
  const consumers = new EventConsumerRuntime({
    pool: workerPool,
    queue,
    subscriptions,
    logger: quiet,
    metrics,
  });
  const relay = new OutboxRelay({
    pool: workerPool,
    queue,
    routes: subscriptions,
    logger: quiet,
    metrics,
    pollIntervalMs: 200,
    listenConnectionString: deps.workerDatabaseUrl,
    ...options.relay,
  });
  await consumers.start();
  if (options.startRelay ?? true) await relay.start();
  return {
    queue,
    relay,
    consumers,
    async stop() {
      await relay.stop();
      await base.drain();
      await base.stop();
    },
  };
}

beforeAll(async () => {
  appPool = new Pool({ connectionString: deps.databaseUrl, max: 6 });
  workerPool = new Pool({ connectionString: deps.workerDatabaseUrl, max: 10 });
  migratorPool = new Pool({ connectionString: deps.migratorUrl, max: 1 });
  // Tabla de efectos de prueba con RLS forzada por workspace (cumple el chequeo de catálogo TC-SECURITY-RLS-004).
  await migratorPool.query(`
    CREATE TABLE IF NOT EXISTS platform.it_event_effect (
      id                bigserial PRIMARY KEY,
      consumer          text NOT NULL,
      event_id          uuid NOT NULL,
      workspace_id      uuid NOT NULL,
      aggregate_id      uuid NOT NULL,
      aggregate_version integer NOT NULL,
      applied_at        timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    ALTER TABLE platform.it_event_effect ENABLE ROW LEVEL SECURITY;
    ALTER TABLE platform.it_event_effect FORCE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS it_event_effect_ws ON platform.it_event_effect;
    CREATE POLICY it_event_effect_ws ON platform.it_event_effect TO pf_app
      USING (workspace_id = platform.current_workspace_id())
      WITH CHECK (workspace_id = platform.current_workspace_id());
  `);
});

afterAll(async () => {
  await migratorPool?.query('DROP TABLE IF EXISTS platform.it_event_effect');
  await Promise.all([appPool?.end(), workerPool?.end(), migratorPool?.end()]);
});

describe('platform/event-delivery: escritura transaccional', () => {
  it('[TC-PLATFORM-EVENTS-001] un comando confirmado deja exactamente un evento pendiente con el envelope completo', async () => {
    const ws = randomUUID();
    const correlationId = uuidv7();
    const [written] = await runWithCorrelation({ correlationId }, () =>
      command(ws, [settingsChanged(ws, ws, 2)]),
    );
    const rows = await workerPool.query<{ envelope: EventEnvelope; published_at: Date | null }>(
      'SELECT envelope, published_at FROM platform.outbox WHERE aggregate_id = $1',
      [ws],
    );
    expect(rows.rows).toHaveLength(1);
    const { envelope, published_at } = rows.rows[0]!;
    expect(published_at).toBeNull();
    expect(envelope).toEqual(written);
    expect(envelope).toMatchObject({
      eventType: TYPE,
      eventVersion: 1,
      aggregateVersion: 2,
      workspaceId: ws,
      correlationId,
      actor: { type: 'USER', id: USER },
    });
    expect(envelope.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
    expect(() => eventSchemaRegistry().validate(envelope)).not.toThrow();
    // pf_app solo inserta: no puede leer ni marcar el outbox.
    await expect(appPool.query('SELECT 1 FROM platform.outbox LIMIT 1')).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('[TC-PLATFORM-EVENTS-002] un comando revertido no deja evento ni llega a ningún consumidor', async () => {
    const ws = randomUUID();
    const seen: string[] = [];
    const worker = await startWorker([recordingConsumer(ws, { before: (e) => void seen.push(e.eventId) })]);
    try {
      const draft = settingsChanged(ws, ws, 2);
      await expect(
        command(ws, [draft], () => {
          throw new Error('fallo del comando');
        }),
      ).rejects.toThrow('fallo del comando');
      expect(await outboxRows([draft.eventId])).toEqual([]);
      expect(await asWorker(ws, 'SELECT 1 FROM platform.it_event_effect')).toEqual([]);
      await sleep(1_500);
      expect(seen).toEqual([]);
    } finally {
      await worker.stop();
    }
  });

  it('[TC-PLATFORM-EVENTS-003] un evento fuera de contrato o sin schema hace fallar el comando sin efectos', async () => {
    const ws = randomUUID();
    const invalid = settingsChanged(ws, ws, 2);
    const noChanges = { ...invalid, payload: { workspaceId: ws, changes: [] } };
    await expect(command(ws, [noChanges])).rejects.toBeInstanceOf(EventContractError);
    const unknown = { ...settingsChanged(ws, ws, 3), eventType: 'identity.WorkspaceRenamed' };
    await expect(command(ws, [unknown])).rejects.toBeInstanceOf(EventContractError);
    expect(await outboxRows([invalid.eventId, unknown.eventId])).toEqual([]);
    expect(await asWorker(ws, 'SELECT 1 FROM platform.it_event_effect')).toEqual([]);
  });
});

describe('platform/event-delivery: relay y consumidores', () => {
  it('[TC-PLATFORM-EVENTS-004] si el relay cae tras encolar y antes de marcar no se pierde nada y el efecto es único', async () => {
    const ws = randomUUID();
    const def = recordingConsumer(ws);
    const written = await command(
      ws,
      Array.from({ length: 10 }, () => settingsChanged(ws, randomUUID(), 1)),
    );
    const ids = written.map((e) => e.eventId);
    // Relay que "cae" después de encolar y antes de marcar published_at (la transacción se revierte).
    const crashing = await startWorker([def], {
      startRelay: false,
      relay: {
        afterEnqueue: () => {
          throw new Error('caída simulada del relay');
        },
      },
    });
    try {
      await expect(crashing.relay.runOnce()).rejects.toThrow('caída simulada del relay');
    } finally {
      await crashing.stop();
    }
    const pending = await outboxRows(ids);
    expect(pending).toHaveLength(10);
    for (const row of pending) {
      expect(row.published_at).toBeNull();
      expect(row.publish_attempts).toBeGreaterThanOrEqual(1);
      expect(row.last_error).toContain('caída simulada');
    }
    const jobs = await workerPool.query('SELECT 1 FROM pgboss.job WHERE name = $1', [
      eventQueueName(def.consumer),
    ]);
    expect(jobs.rowCount).toBe(0);

    const worker = await startWorker([def]);
    try {
      await until(async () => ((await effects(ws, def.consumer)).length >= 10 ? true : undefined));
      await sleep(1_000);
      const applied = await effects(ws, def.consumer);
      expect(applied.map((e) => e.event_id).sort()).toEqual([...ids].sort());
      expect((await outboxRows(ids)).every((r) => r.published_at !== null)).toBe(true);
    } finally {
      await worker.stop();
    }
  });

  it('[TC-PLATFORM-EVENTS-005] cinco entregas del mismo evento producen un efecto y cuatro duplicados descartados', async () => {
    const ws = randomUUID();
    const metrics = new SpyMetrics();
    const def = recordingConsumer(ws);
    const runtime = new EventConsumerRuntime({
      pool: workerPool,
      queue: {} as JobQueue,
      subscriptions: new EventSubscriptions([def]),
      logger: quiet,
      metrics,
    });
    const [event] = await command(ws, [settingsChanged(ws, ws, 2)]);
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => runtime.deliver(def, event)));
    expect(outcomes.filter((o) => o === 'applied')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'duplicate')).toHaveLength(4);
    expect(await effects(ws, def.consumer)).toHaveLength(1);
    expect(metrics.duplicates).toBe(4);

    // Un efecto que falla no deja el evento como procesado: el reintento lo aplica.
    let failOnce = true;
    const flaky = recordingConsumer(ws, {
      before: () => {
        if (failOnce) {
          failOnce = false;
          throw new Error('efecto fallido');
        }
      },
    });
    await expect(runtime.deliver(flaky, event)).rejects.toThrow('efecto fallido');
    const inbox = await workerPool.query(
      'SELECT 1 FROM platform.inbox WHERE consumer = $1 AND event_id = $2',
      [flaky.consumer, event!.eventId],
    );
    expect(inbox.rowCount).toBe(0);
    expect(await runtime.deliver(flaky, event)).toBe('applied');
    expect(await effects(ws, flaky.consumer)).toHaveLength(1);
  });

  it('[TC-PLATFORM-EVENTS-006] los eventos de un mismo agregado se procesan en orden aunque se intercalen', async () => {
    const ws = randomUUID();
    const aggregates = Array.from({ length: 5 }, () => randomUUID());
    const slowAgg = randomUUID();
    const otherAgg = randomUUID();
    let slowFailed = false;
    const def = recordingConsumer(ws, {
      concurrency: 4,
      before: async (e) => {
        await sleep(Math.random() * 20);
        if (e.aggregateId === slowAgg && e.aggregateVersion === 1 && !slowFailed) {
          slowFailed = true;
          throw new Error('fallo transitorio de v1');
        }
      },
    });
    const worker = await startWorker([def]);
    try {
      for (let v = 1; v <= 10; v++) {
        for (const agg of aggregates) await command(ws, [settingsChanged(ws, agg, v)]);
      }
      await command(ws, [settingsChanged(ws, slowAgg, 1)]);
      await command(ws, [settingsChanged(ws, slowAgg, 2)]);
      await command(ws, [settingsChanged(ws, otherAgg, 1)]);
      await until(async () => ((await effects(ws, def.consumer)).length >= 53 ? true : undefined), 45_000);
      const applied = await effects(ws, def.consumer);
      for (const agg of aggregates) {
        expect(applied.filter((e) => e.aggregate_id === agg).map((e) => e.aggregate_version)).toEqual([
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
        ]);
      }
      expect(slowFailed).toBe(true);
      expect(applied.filter((e) => e.aggregate_id === slowAgg).map((e) => e.aggregate_version)).toEqual([
        1, 2,
      ]);
      const position = (agg: string, v: number) =>
        applied.findIndex((e) => e.aggregate_id === agg && e.aggregate_version === v);
      // El otro agregado no esperó al reintento de slowAgg v1.
      expect(position(otherAgg, 1)).toBeLessThan(position(slowAgg, 1));
    } finally {
      await worker.stop();
    }
  });

  it('[TC-PLATFORM-EVENTS-007] un evento que siempre falla agota sus reintentos y queda en dead-letter sin bloquear otros', async () => {
    const ws = randomUUID();
    const poisonAgg = randomUUID();
    const healthyAgg = randomUUID();
    const attempts: number[] = [];
    const metrics = new SpyMetrics();
    const def = recordingConsumer(ws, {
      retryLimit: 2,
      retryDelaySeconds: 1,
      before: (e) => {
        if (e.aggregateId === poisonAgg) {
          attempts.push(Date.now());
          throw new Error('evento venenoso');
        }
      },
    });
    const worker = await startWorker([def], { metrics });
    try {
      const [poison] = await command(ws, [settingsChanged(ws, poisonAgg, 1)]);
      await command(ws, [settingsChanged(ws, healthyAgg, 1)]);
      const dead = await until(
        async () =>
          (
            await workerPool.query<{ status: string; attempts: number; error: string; event_type: string }>(
              'SELECT status, attempts, error, event_type FROM platform.dead_letter WHERE consumer = $1 AND event_id = $2',
              [def.consumer, poison!.eventId],
            )
          ).rows[0],
        45_000,
      );
      expect(dead).toMatchObject({ status: 'OPEN', attempts: 3, event_type: `${TYPE}.v1` });
      expect(dead.error).toContain('evento venenoso');
      expect(attempts).toHaveLength(3);
      expect(attempts[1]! - attempts[0]!).toBeGreaterThanOrEqual(900);
      expect(attempts[2]! - attempts[1]!).toBeGreaterThanOrEqual(900);
      expect(metrics.dead).toBe(1);
      expect((await effects(ws, def.consumer)).map((e) => e.aggregate_id)).toEqual([healthyAgg]);
      // La copia en la cola DLQ no vuelve a contar el dead-letter.
      await sleep(1_500);
      expect(metrics.dead).toBe(1);
      expect(attempts).toHaveLength(3);
      // El dead-letter abierto congela su agregado en este consumidor: v2 se publica pero no se procesa.
      const [poison2] = await command(ws, [settingsChanged(ws, poisonAgg, 2)]);
      await until(async () => ((await outboxRows([poison2!.eventId]))[0]?.published_at ? true : undefined));
      await sleep(2_000);
      expect(attempts).toHaveLength(3);
      expect((await effects(ws, def.consumer)).map((e) => e.aggregate_id)).toEqual([healthyAgg]);
      expect(deadLetterQueueName(def.consumer)).toBe(`events.${def.consumer}.dlq`);
    } finally {
      await worker.stop();
    }
  });

  it('[TC-PLATFORM-EVENTS-008] con la cola caída el comando se confirma y el evento se publica cuando la cola vuelve', async () => {
    const ws = randomUUID();
    const def = recordingConsumer(ws, {
      events: [
        { type: 'identity.WorkspaceCreated', version: 1 },
        { type: TYPE, version: 1 },
      ],
    });
    let down = true;
    const metrics = new SpyMetrics();
    const worker = await startWorker([def], {
      metrics,
      startRelay: false,
      wrap: (q) =>
        new Proxy(q, {
          get(target, prop, receiver) {
            if (prop === 'enqueueInTransaction' && down) {
              return async () => {
                throw new Error('cola no disponible');
              };
            }
            const value = Reflect.get(target, prop, receiver) as unknown;
            return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
          },
        }),
    });
    try {
      const created: DomainEventDraft = {
        ...settingsChanged(ws, ws, 1),
        eventType: 'identity.WorkspaceCreated',
        payload: {
          workspaceId: ws,
          name: 'Hogar',
          baseCurrency: 'BOB',
          timeZone: 'America/La_Paz',
          locale: 'es-BO',
          fiscalMonthStartDay: 1,
          ownerUserId: USER,
          origin: 'USER_CREATED',
        },
      };
      const [event] = await command(ws, [created, settingsChanged(ws, ws, 2)]);
      expect(
        await asWorker(ws, `SELECT 1 FROM platform.it_event_effect WHERE consumer = 'command'`),
      ).toHaveLength(1);
      await expect(worker.relay.runOnce()).rejects.toThrow('cola no disponible');
      expect(metrics.failures).toBe(1);
      const [row] = await outboxRows([event!.eventId]);
      expect(row).toMatchObject({
        published_at: null,
        last_error: expect.stringContaining('cola no disponible'),
      });
      expect((await readOutboxBacklog(workerPool)).pending).toBeGreaterThanOrEqual(2);

      down = false;
      await worker.relay.start();
      await until(async () => ((await effects(ws, def.consumer)).length >= 2 ? true : undefined));
      expect((await effects(ws, def.consumer)).map((e) => e.event_id)[0]).toBe(event!.eventId);
      expect((await outboxRows([event!.eventId]))[0]?.published_at).not.toBeNull();
    } finally {
      await worker.stop();
    }
  });

  it('[TC-PLATFORM-EVENTS-013] tras una caída de la cola el relay publica la cabeza pendiente de cada agregado antes que sus sucesores', async () => {
    // Determinista: v1 y v2 del MISMO agregado se confirman juntos y el eventId de v2 ordena antes que el de v1.
    // pg-boss desempata la cabeza de una clave por (created_on, id): si ambos se encolan en la misma transacción
    // del relay (mismo created_on), v2 adelantaría a v1. El relay solo debe publicar la cabeza por agregado.
    const ws = randomUUID();
    const agg = randomUUID();
    const tail = () => uuidv7().slice(1);
    const v1 = { ...settingsChanged(ws, agg, 1), eventId: `f${tail()}` };
    const v2 = { ...settingsChanged(ws, agg, 2), eventId: `0${tail()}` };
    const other = settingsChanged(ws, randomUUID(), 1);
    expect(v2.eventId < v1.eventId).toBe(true);
    const def = recordingConsumer(ws);
    let down = true;
    const worker = await startWorker([def], {
      startRelay: false,
      wrap: (q) =>
        new Proxy(q, {
          get(target, prop, receiver) {
            if (prop === 'enqueueInTransaction' && down) {
              return async () => {
                throw new Error('cola no disponible');
              };
            }
            const value = Reflect.get(target, prop, receiver) as unknown;
            return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
          },
        }),
    });
    try {
      await command(ws, [v1, v2, other]);
      // La cola cae: varios intentos fallidos dejan los tres eventos pendientes con last_error.
      for (let i = 0; i < 3; i++) await expect(worker.relay.runOnce()).rejects.toThrow('cola no disponible');
      expect((await outboxRows([v1.eventId, v2.eventId])).every((r) => r.published_at === null)).toBe(true);

      // La cola vuelve: el primer lote publica v1 (cabeza) y el otro agregado, nunca v2 todavía.
      down = false;
      await worker.relay.runOnce();
      const published = async () =>
        new Map(
          (await outboxRows([v1.eventId, v2.eventId, other.eventId])).map((r) => [r.id, r.published_at]),
        );
      let state = await published();
      expect(state.get(v1.eventId)).not.toBeNull();
      expect(state.get(other.eventId)).not.toBeNull();
      expect(state.get(v2.eventId)).toBeNull();
      // Lotes siguientes: v2 sale en una transacción posterior.
      while ((await worker.relay.runOnce()) > 0) {
        /* drenar */
      }
      state = await published();
      expect(state.get(v2.eventId)).not.toBeNull();

      await until(async () =>
        (await effects(ws, def.consumer)).filter((e) => e.aggregate_id === agg).length >= 2
          ? true
          : undefined,
      );
      expect(
        (await effects(ws, def.consumer)).filter((e) => e.aggregate_id === agg).map((e) => e.event_id),
      ).toEqual([v1.eventId, v2.eventId]);
    } finally {
      await worker.stop();
    }
  });

  it('[TC-PLATFORM-EVENTS-009] la purga elimina solo eventos publicados vencidos y nunca pendientes', async () => {
    const ws = randomUUID();
    const [old, recent, pending] = await command(ws, [
      settingsChanged(ws, randomUUID(), 1),
      settingsChanged(ws, randomUUID(), 1),
      settingsChanged(ws, randomUUID(), 1),
    ]);
    await workerPool.query(
      `UPDATE platform.outbox SET published_at = clock_timestamp() - interval '8 days' WHERE id = $1`,
      [old!.eventId],
    );
    await workerPool.query(
      `UPDATE platform.outbox SET published_at = clock_timestamp() - interval '2 days' WHERE id = $1`,
      [recent!.eventId],
    );
    const staleInbox = randomUUID();
    const freshInbox = randomUUID();
    await workerPool.query(
      `INSERT INTO platform.inbox (consumer, event_id, workspace_id, processed_at)
       VALUES ('it.purge', $1, $3, clock_timestamp() - interval '31 days'), ('it.purge', $2, $3, clock_timestamp())`,
      [staleInbox, freshInbox, ws],
    );
    const result = await purgeDeliveredEvents(workerPool, { outboxRetentionDays: 7, inboxRetentionDays: 30 });
    expect(result.outbox).toBeGreaterThanOrEqual(1);
    expect(
      (await outboxRows([old!.eventId, recent!.eventId, pending!.eventId])).map((r) => r.id).sort(),
    ).toEqual([recent!.eventId, pending!.eventId].sort());
    const inbox = await workerPool.query<{ event_id: string }>(
      `SELECT event_id FROM platform.inbox WHERE consumer = 'it.purge'`,
    );
    expect(inbox.rows.map((r) => r.event_id)).toEqual([freshInbox]);
    // Un pendiente nunca es visible para el rol de purga, aunque se pida explícitamente.
    const client = await workerPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE pf_maintenance');
      const del = await client.query('DELETE FROM platform.outbox WHERE id = $1', [pending!.eventId]);
      expect(del.rowCount).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('[TC-PLATFORM-EVENTS-010] outbox_pending y outbox_lag_seconds reflejan los pendientes y vuelven a 0', async () => {
    const ws = randomUUID();
    const before = await readOutboxBacklog(workerPool);
    await command(ws, [
      settingsChanged(ws, randomUUID(), 1),
      settingsChanged(ws, randomUUID(), 1),
      settingsChanged(ws, randomUUID(), 1),
    ]);
    const later = new Date(Date.now() + 42_000);
    const backlog = await readOutboxBacklog(workerPool, later);
    expect(backlog.pending).toBe(before.pending + 3);
    expect(backlog.lagSeconds).toBeGreaterThanOrEqual(42);
    // Relay sin suscriptores: marca todo lo pendiente como publicado.
    const worker = await startWorker([], { startRelay: false });
    try {
      while ((await worker.relay.runOnce()) > 0) {
        /* lotes hasta vaciar */
      }
    } finally {
      await worker.stop();
    }
    expect(await readOutboxBacklog(workerPool)).toEqual({ pending: 0, lagSeconds: 0 });
  });
});

describe('platform/event-delivery: worker completo', () => {
  it('[TC-PLATFORM-EVENTS-011] el apagado ordenado deja terminar el evento en curso sin perderlo ni duplicarlo', async () => {
    const ws = randomUUID();
    const consumer = `it.shutdown${randomUUID().slice(0, 8)}`;
    const invocations: string[] = [];
    let started: (() => void) | undefined;
    const handlerStarted = new Promise<void>((r) => (started = r));
    const def = recordingConsumer(ws, {
      consumer,
      before: async (e) => {
        invocations.push(e.eventId);
        started?.();
        await sleep(1_000);
      },
    });
    const config = workerConfig(baseEnv(deps));
    const first = await createWorkerRuntime(config, quiet, {
      eventConsumers: [def],
      metrics: new SpyMetrics(),
    });
    let closed = false;
    try {
      const [e1] = await command(ws, [settingsChanged(ws, randomUUID(), 1)]);
      await handlerStarted;
      await first.close();
      closed = true;
      expect((await effects(ws, consumer)).map((e) => e.event_id)).toEqual([e1!.eventId]);

      const [e2] = await command(ws, [settingsChanged(ws, randomUUID(), 1)]);
      await sleep(1_500);
      expect((await effects(ws, consumer)).map((e) => e.event_id)).toEqual([e1!.eventId]);
      expect((await outboxRows([e2!.eventId]))[0]?.published_at).toBeNull();

      const second = await createWorkerRuntime(config, quiet, {
        eventConsumers: [def],
        metrics: new SpyMetrics(),
      });
      try {
        await until(async () => ((await effects(ws, consumer)).length >= 2 ? true : undefined));
        await sleep(500);
        expect((await effects(ws, consumer)).map((e) => e.event_id)).toEqual([e1!.eventId, e2!.eventId]);
        expect(invocations.filter((id) => id === e1!.eventId)).toHaveLength(1);
      } finally {
        await second.close();
      }
    } finally {
      if (!closed) await first.close();
    }
  });

  it('[TC-PLATFORM-EVENTS-012] el consumidor procesa el evento aislado en su workspace y con el correlationId de origen', async () => {
    const w1 = randomUUID();
    const w2 = randomUUID();
    await command(w1, []);
    await command(w2, []);
    const logs = capturingLogger('finance-worker', 'worker', 'info');
    const seen: { workspaces: string[]; correlationId: string | undefined }[] = [];
    const consumer = `it.ctx${randomUUID().slice(0, 8)}`;
    const def: EventConsumerDefinition = {
      consumer,
      events: [{ type: TYPE, version: 1 }],
      handler: async (event, ctx) => {
        if (event.workspaceId !== w1) return;
        const { rows } = await ctx.tx.query('SELECT DISTINCT workspace_id FROM platform.it_event_effect');
        seen.push({
          workspaces: (rows as { workspace_id: string }[]).map((r) => r.workspace_id),
          correlationId: currentCorrelation()?.correlationId,
        });
      },
    };
    const runtime = await createWorkerRuntime(workerConfig(baseEnv(deps)), logs.logger, {
      eventConsumers: [def],
      metrics: new SpyMetrics(),
    });
    try {
      const correlationId = uuidv7();
      await runWithCorrelation({ correlationId }, () => command(w1, [settingsChanged(w1, w1, 2)]));
      const result = await until(async () => seen[0]);
      expect(result).toEqual({ workspaces: [w1], correlationId });
      const jobLines = logs
        .records()
        .filter((r) => r['job.queue'] === eventQueueName(consumer) && r['msg'] === 'job completed');
      expect(jobLines.length).toBeGreaterThanOrEqual(1);
      for (const line of jobLines) expect(line['correlation_id']).toBe(correlationId);
    } finally {
      await runtime.close();
    }
  });
});
