// Las tres opciones evaluadas detrás de una interfaz común.
//  A: BullMQ 6 sobre Valkey      B: BullMQ 6 con backend PostgreSQL      C: pg-boss 12
import { Queue, Worker, createPostgresBackend, type Job } from 'bullmq';
import { PgBoss } from 'pg-boss';
import { randomUUID } from 'node:crypto';
import { CONSUMER, PG_URL, QUEUE, REDIS_URL } from './config.js';
import type { Pool, PoolClient } from './db.js';
import type { Envelope } from './envelope.js';
import type { Publisher } from './relay.js';
import { handleWithExec, handleWithPool, recordDeadLetter, type HandleOpts } from './consumer.js';

export type OptionId = 'A' | 'B' | 'C';

export interface ConsumerOpts extends Omit<HandleOpts, 'consumer'> {
  concurrency?: number;
  attempts?: number; // intentos totales
  backoffMs?: number;
  /** C: política key_strict_fifo (orden FIFO nativo por aggregateId) */
  strictFifo?: boolean;
  /** C: usar work({transactional:true}) en vez del modo por lotes */
  pgBossTransactional?: boolean;
  onEvent?: (r: 'applied' | 'duplicate', env: Envelope) => void;
}

export interface QueueOption {
  id: OptionId;
  label: string;
  publisher: Publisher;
  /** true si el publisher encola dentro de la tx del relay (publicación+marca atómicas) */
  atomicPublish: boolean;
  init(o?: { attempts?: number; backoffMs?: number; strictFifo?: boolean }): Promise<void>;
  startConsumer(o?: ConsumerOpts): Promise<void>;
  /** Cierre ordenado: deja de tomar jobs y espera a los activos. */
  stopConsumer(): Promise<void>;
  counts(): Promise<Record<string, number>>;
  /** Test: encola el MISMO evento con otro id de job (simula re-entrega duplicada por la cola). */
  enqueueCopy(env: Envelope): Promise<void>;
  close(): Promise<void>;
}

const redisConn = () => {
  const u = new URL(REDIS_URL);
  return { host: u.hostname, port: Number(u.port || 6379) };
};

// ---------------------------------------------------------------------------------------------
export function bullmqOption(kind: 'redis' | 'postgres', pool: Pool): QueueOption {
  const isPg = kind === 'postgres';
  const pgConn = { connectionString: PG_URL, schema: 'bullmq', migrate: true, max: 20 };
  let queue: Queue<any> | undefined;
  let worker: Worker<any> | undefined;
  let jobOpts = { attempts: 3, backoff: { type: 'exponential', delay: 200 } };

  const mkQueue = (): Queue<any> =>
    isPg
      ? new Queue(QUEUE, { connection: pgConn as any }, createPostgresBackend as any)
      // enableOfflineQueue:false => si Valkey está caído, add() falla rápido en vez de colgarse
      : new Queue(QUEUE, { connection: { ...redisConn(), enableOfflineQueue: false, maxRetriesPerRequest: 1 } as any });

  return {
    id: isPg ? 'B' : 'A',
    label: isPg ? 'BullMQ 6 (backend PostgreSQL)' : 'BullMQ 6 (Valkey)',
    atomicPublish: false,
    async init(o) {
      jobOpts = { attempts: o?.attempts ?? 3, backoff: { type: 'exponential', delay: o?.backoffMs ?? 200 } };
      queue ??= mkQueue();
      queue.on('error', () => {});
      await queue.waitUntilReady();
      await queue.obliterate({ force: true }).catch(() => {});
    },
    publisher: {
      async publish(events: Envelope[], _tx: PoolClient) {
        // jobId = eventId: dedupe del lado de BullMQ mientras el job exista
        await queue!.addBulk(events.map((e) => ({
          name: `${e.eventType}.v${e.eventVersion}`, data: e, opts: { jobId: e.eventId, ...jobOpts },
        })));
      },
    },
    async startConsumer(o = {}) {
      const processor = async (job: Job<any>) => {
        try {
          const r = await handleWithPool(pool, job.data, { ...o, consumer: CONSUMER });
          o.onEvent?.(r, job.data);
          return r;
        } catch (e) {
          const attempts = job.opts.attempts ?? 1;
          if (job.attemptsMade + 1 >= attempts) await recordDeadLetter(pool, CONSUMER, job.data, e, attempts);
          throw e;
        }
      };
      const wopts = {
        concurrency: o.concurrency ?? 8,
        lockDuration: 5000,     // un job con lock vencido (worker muerto) se considera "stalled"
        stalledInterval: 2000,
        maxStalledCount: 5,
      };
      worker = isPg
        ? new Worker(QUEUE, processor, { ...wopts, connection: pgConn as any }, createPostgresBackend as any)
        : new Worker(QUEUE, processor, { ...wopts, connection: { ...redisConn(), maxRetriesPerRequest: null } as any });
      worker.on('error', () => {});
      await worker.waitUntilReady();
    },
    async stopConsumer() {
      await worker?.close(); // espera jobs activos
      worker = undefined;
    },
    async enqueueCopy(env) {
      await queue!.add('dup', env, { jobId: randomUUID(), ...jobOpts });
    },
    async counts() {
      return queue!.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
    },
    async close() {
      await worker?.close().catch(() => {});
      await queue?.close().catch(() => {});
    },
  };
}

// ---------------------------------------------------------------------------------------------
export const DLQ = `${QUEUE}-dlq`;

export function pgBossOption(pool: Pool): QueueOption {
  let boss: PgBoss | undefined;
  let strict = false;
  const mkBoss = () => {
    const b = new PgBoss({ connectionString: PG_URL, schema: 'pgboss', max: 20, useListenNotify: true, schedule: false });
    b.on('error', () => {});
    return b;
  };
  return {
    id: 'C',
    label: 'pg-boss 12',
    atomicPublish: true,
    async init(o) {
      strict = !!o?.strictFifo;
      boss ??= mkBoss();
      await boss.start();
      for (const q of [QUEUE, DLQ]) await boss.deleteQueue(q).catch(() => {});
      await boss.createQueue(DLQ);
      await boss.createQueue(QUEUE, {
        policy: strict ? 'key_strict_fifo' : 'standard',
        retryLimit: (o?.attempts ?? 3) - 1,
        retryDelay: Math.max(1, Math.round((o?.backoffMs ?? 1000) / 1000)), // segundos
        retryBackoff: true,
        deadLetter: DLQ,
        notify: true,
        expireInSeconds: 20, // un job 'active' de un worker muerto vuelve a reintentarse tras expirar
      });
    },
    publisher: {
      async publish(events: Envelope[], tx: PoolClient) {
        // Encola DENTRO de la transacción del relay: publicar y marcar published_at son atómicos.
        await boss!.insert(QUEUE, events.map((e) => ({
          id: e.eventId, data: e, ...(strict ? { singletonKey: e.aggregateId } : {}),
        })), { db: { executeSql: (text: string, values?: unknown[]) => tx.query(text, values as any[]) } });
      },
    },
    async startConsumer(o = {}) {
      if (!boss) { boss = mkBoss(); await boss.start(); }
      const polling = { pollingIntervalSeconds: 0.5, notifyPollingIntervalSeconds: 0.5 };
      if (o.pgBossTransactional) {
        // Variante "transactional": inbox + efecto + completion del job en UNA transacción.
        // OJO: con batchSize 1 cada worker espera notifyPollingInterval entre jobs (no hace "burst").
        await boss!.work(QUEUE, { ...polling, localConcurrency: o.concurrency ?? 8, batchSize: 1, transactional: true },
          async (jobs: any[], tx: any) => {
            for (const job of jobs) {
              const r = await handleWithExec((s, p) => tx.executeSql(s, p), job.data, { ...o, consumer: CONSUMER });
              o.onEvent?.(r, job.data);
            }
          });
      } else {
        // Variante por lotes (default): fetch de N jobs, burst mientras el lote venga lleno, resultado por job.
        // Cada job tiene su propia tx (inbox + efecto); dentro del lote se respeta el orden por agregado.
        await boss!.work(QUEUE, {
          ...polling, localConcurrency: Math.max(1, Math.ceil((o.concurrency ?? 8) / 4)), batchSize: 20,
          burstWhenBatchFull: true, perJobResults: true,
        }, async (jobs: any[]) => {
          const byAgg = new Map<string, any[]>();
          for (const j of jobs) byAgg.set(j.data.aggregateId, [...(byAgg.get(j.data.aggregateId) ?? []), j]);
          const results: { id: string; status: 'completed' | 'failed' }[] = [];
          await Promise.all([...byAgg.values()].map(async (list) => {
            let blocked = false;
            for (const job of list) {
              if (blocked) { results.push({ id: job.id, status: 'failed' }); continue; }
              try {
                const r = await handleWithPool(pool, job.data, { ...o, consumer: CONSUMER });
                o.onEvent?.(r, job.data);
                results.push({ id: job.id, status: 'completed' });
              } catch {
                results.push({ id: job.id, status: 'failed' });
                blocked = true; // no adelantar eventos posteriores del mismo agregado
              }
            }
          }));
          return results;
        });
      }
      // DLQ nativa: pg-boss copia el job a DLQ tras agotar reintentos; lo registramos en platform.dead_letter
      await boss!.work(DLQ, polling, async (jobs: any[]) => {
        for (const job of jobs) await recordDeadLetter(pool, CONSUMER, job.data, 'retries exhausted (pg-boss DLQ)', -1);
      });
    },
    async stopConsumer() {
      await boss!.offWork(QUEUE, { wait: true });
      await boss!.offWork(DLQ, { wait: true });
    },
    async enqueueCopy(env) {
      await boss!.send(QUEUE, env, { id: randomUUID(), ...(strict ? { singletonKey: env.aggregateId } : {}) });
    },
    async counts() {
      const q = await boss!.getQueue(QUEUE);
      return { queued: q?.queuedCount ?? 0, active: q?.activeCount ?? 0, failed: q?.failedCount ?? 0 };
    },
    async close() {
      await boss?.stop({ graceful: true, timeout: 10000 }).catch(() => {});
      boss = undefined;
    },
  };
}

export function makeOption(id: OptionId, pool: Pool): QueueOption {
  return id === 'A' ? bullmqOption('redis', pool) : id === 'B' ? bullmqOption('postgres', pool) : pgBossOption(pool);
}
