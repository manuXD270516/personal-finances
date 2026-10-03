import pg, { type Pool, type PoolClient } from 'pg';
import type { Logger } from '../logging/index.js';
import type { JobQueue, QueueOptions, TransactionalJob } from '../queue/job-queue.js';
import type { EventEnvelope } from './envelope.js';
import type { EventDeliveryMetrics } from './metrics.js';

/** Cola de un consumidor suscrito a un tipo de evento. */
export interface EventRoute {
  readonly queue: string;
  readonly options: QueueOptions;
}

/** Qué colas reciben cada `(eventType, eventVersion)`. */
export interface EventRoutes {
  routesFor(eventType: string, eventVersion: number): readonly EventRoute[];
}

/** Canal de `pg_notify` del trigger `platform.outbox_notify` (migración 20261003120000). */
export const OUTBOX_NOTIFY_CHANNEL = 'pf_outbox';

/**
 * Clave del advisory lock de transacción del relay: una sola réplica publica a la vez, condición para que el orden
 * por agregado de la cola refleje el orden de confirmación (SPIKE-05). Valor fijo arbitrario de 63 bits.
 */
export const OUTBOX_RELAY_LOCK_KEY = 7_311_853_002_771_001n;

export interface OutboxRelayOptions {
  /** Pool con el rol `pf_worker` (lee el outbox de todos los workspaces). */
  readonly pool: Pool;
  readonly queue: JobQueue;
  readonly routes: EventRoutes;
  readonly logger: Logger;
  readonly metrics?: EventDeliveryMetrics;
  readonly batchSize?: number;
  /** Polling de respaldo del `LISTEN` (ms). */
  readonly pollIntervalMs?: number;
  /** Conexión dedicada para `LISTEN pf_outbox` (misma URL del pool); sin ella solo hay polling. */
  readonly listenConnectionString?: string;
  /** Solo tests: se invoca tras encolar y antes de marcar `published_at` (simula una caída si lanza). */
  readonly afterEnqueue?: (eventIds: readonly string[]) => Promise<void> | void;
}

interface PendingRow {
  id: string;
  event_type: string;
  event_version: number;
  aggregate_id: string;
  correlation_id: string;
  envelope: EventEnvelope;
  trace_context: Record<string, string>;
}

const MAX_ERROR_LENGTH = 1000;

/**
 * Relay del outbox (openspec add-event-outbox, design §5). Cada lote es UNA transacción: advisory lock de relay
 * único, filas pendientes por `sequence` con `FOR UPDATE SKIP LOCKED`, encolado en pg-boss sobre la misma conexión
 * (`JobQueue.enqueueInTransaction`, job `id = eventId`, `key = aggregateId`) y `published_at`. Encolar y marcar son
 * atómicos: una caída antes del COMMIT no pierde ni duplica eventos.
 */
export class OutboxRelay {
  private running = false;
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;
  private listener: pg.Client | undefined;
  private readonly ensured = new Set<string>();

  constructor(private readonly options: OutboxRelayOptions) {}

  /** Procesa un lote. Devuelve cuántos eventos marcó como publicados (0 si otra réplica tiene el lock). */
  async runOnce(): Promise<number> {
    const batchSize = this.options.batchSize ?? 200;
    const client = await this.options.pool.connect();
    let broken = false;
    let rows: PendingRow[] = [];
    try {
      await client.query('BEGIN');
      const lock = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        OUTBOX_RELAY_LOCK_KEY.toString(),
      ]);
      if (!lock.rows[0]?.locked) {
        await client.query('COMMIT');
        return 0;
      }
      rows = (
        await client.query<PendingRow>(
          `SELECT id, event_type, event_version, aggregate_id, correlation_id, envelope, trace_context
             FROM platform.outbox
            WHERE published_at IS NULL
            ORDER BY sequence
            LIMIT $1
            FOR UPDATE SKIP LOCKED`,
          [batchSize],
        )
      ).rows;
      if (rows.length === 0) {
        await client.query('COMMIT');
        return 0;
      }
      await this.enqueue(rows, client);
      await this.options.afterEnqueue?.(rows.map((r) => r.id));
      await client.query(
        `UPDATE platform.outbox
            SET published_at = clock_timestamp(), publish_attempts = publish_attempts + 1, last_error = NULL
          WHERE id = ANY($1::uuid[])`,
        [rows.map((r) => r.id)],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        broken = true;
      });
      if (rows.length > 0) await this.recordFailure(rows, err);
      throw err;
    } finally {
      client.release(broken);
    }
    for (const row of rows) this.options.metrics?.published(row.event_type);
    this.options.logger.debug({ published: rows.length }, 'outbox batch published');
    return rows.length;
  }

  private async enqueue(rows: readonly PendingRow[], client: PoolClient): Promise<void> {
    const byQueue = new Map<string, { route: EventRoute; jobs: TransactionalJob<EventEnvelope>[] }>();
    for (const row of rows) {
      for (const route of this.options.routes.routesFor(row.event_type, row.event_version)) {
        const entry = byQueue.get(route.queue) ?? { route, jobs: [] };
        entry.jobs.push({
          id: row.id,
          key: row.aggregate_id,
          payload: row.envelope,
          correlationId: row.correlation_id,
          traceContext: row.trace_context,
        });
        byQueue.set(route.queue, entry);
      }
    }
    for (const [queue, { route, jobs }] of byQueue) {
      if (!this.ensured.has(queue)) {
        if (route.options.deadLetter) await this.options.queue.ensureQueue(route.options.deadLetter);
        await this.options.queue.ensureQueue(queue, route.options);
        this.ensured.add(queue);
      }
      await this.options.queue.enqueueInTransaction(queue, jobs, client);
    }
  }

  /** Best effort, fuera de la transacción revertida: deja rastro del fallo en las filas del lote. */
  private async recordFailure(rows: readonly PendingRow[], err: unknown): Promise<void> {
    this.options.metrics?.publishFailed();
    const message = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(
      0,
      MAX_ERROR_LENGTH,
    );
    await this.options.pool
      .query(
        `UPDATE platform.outbox SET publish_attempts = publish_attempts + 1, last_error = $2
          WHERE id = ANY($1::uuid[]) AND published_at IS NULL`,
        [rows.map((r) => r.id), message],
      )
      .catch(() => undefined);
  }

  /** Arranca el bucle: `LISTEN` como despertador + polling de respaldo; lote lleno ⇒ siguiente lote inmediato. */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (this.options.listenConnectionString) {
      const listener = new pg.Client({
        connectionString: this.options.listenConnectionString,
        application_name: 'finance-worker-outbox-listen',
      });
      listener.on('error', (err) =>
        this.options.logger.warn({ err: { type: err.name, message: err.message } }, 'outbox listener error'),
      );
      listener.on('notification', () => this.wake?.());
      await listener.connect();
      await listener.query(`LISTEN ${OUTBOX_NOTIFY_CHANNEL}`);
      this.listener = listener;
    }
    const batchSize = this.options.batchSize ?? 200;
    const pollMs = this.options.pollIntervalMs ?? 500;
    this.loop = (async () => {
      let backoff = 100;
      while (this.running) {
        try {
          const published = await this.runOnce();
          backoff = 100;
          if (published >= batchSize) continue;
          await this.sleep(pollMs);
        } catch (err) {
          this.options.logger.warn(
            { err: { type: err instanceof Error ? err.name : typeof err }, retry_in_ms: backoff },
            'outbox relay batch failed',
          );
          await this.sleep(backoff);
          backoff = Math.min(backoff * 2, 5_000);
        }
      }
    })();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      function done() {
        clearTimeout(timer);
        resolve();
      }
      this.wake = done;
    });
  }

  /** Deja de iterar, espera el lote en curso y cierra el `LISTEN`. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.wake?.();
    await this.loop;
    this.loop = undefined;
    await this.listener?.end().catch(() => undefined);
    this.listener = undefined;
  }
}
