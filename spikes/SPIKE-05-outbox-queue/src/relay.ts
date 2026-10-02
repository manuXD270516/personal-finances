// Relay outbox -> cola. Polling con FOR UPDATE SKIP LOCKED + LISTEN/NOTIFY como despertador.
import pg from 'pg';
import { PG_URL, sleep } from './config.js';
import type { Pool, PoolClient } from './db.js';
import type { Envelope } from './envelope.js';

export interface Publisher {
  /** `tx` es la transacción del relay; un publisher sobre PG puede encolar dentro de ella (publicación atómica). */
  publish(events: Envelope[], tx: PoolClient): Promise<void>;
}

export class SimulatedCrash extends Error {}

export interface RelayOpts {
  batchSize?: number;
  pollMs?: number;
  listen?: boolean;
  publishTimeoutMs?: number;
  /** Se evalúa tras publicar y ANTES de marcar published_at: si devuelve true, simula crash (rollback). */
  crashAfterPublish?: () => boolean;
  onError?: (e: unknown) => void;
}

export class Relay {
  private running = false;
  private loop?: Promise<void>;
  private wake?: () => void;
  private listener?: pg.Client;
  public published = 0;
  public errors = 0;

  constructor(private pool: Pool, private publisher: Publisher, private o: RelayOpts = {}) {}

  /** Un lote. Devuelve cuántas filas marcó como publicadas. */
  async runOnce(): Promise<number> {
    const batch = this.o.batchSize ?? 500;
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const { rows } = await c.query(
        `SELECT id, envelope FROM platform.outbox WHERE published_at IS NULL
         ORDER BY sequence LIMIT $1 FOR UPDATE SKIP LOCKED`, [batch]);
      if (rows.length === 0) { await c.query('COMMIT'); return 0; }
      const events = rows.map((r) => r.envelope as Envelope);
      const timeout = this.o.publishTimeoutMs ?? 5000;
      let t: NodeJS.Timeout | undefined;
      await Promise.race([
        this.publisher.publish(events, c),
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`publish timeout ${timeout}ms`)), timeout); }),
      ]).finally(() => clearTimeout(t));
      if (this.o.crashAfterPublish?.()) throw new SimulatedCrash('relay crashed after publish, before marking');
      await c.query(
        'UPDATE platform.outbox SET published_at = clock_timestamp(), attempts = attempts + 1 WHERE id = ANY($1::uuid[])',
        [rows.map((r) => r.id)]);
      await c.query('COMMIT');
      this.published += rows.length;
      return rows.length;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async start(): Promise<void> {
    this.running = true;
    if (this.o.listen ?? true) {
      this.listener = new pg.Client({ connectionString: PG_URL, application_name: 'spike05-relay-listen' });
      this.listener.on('error', () => {});
      await this.listener.connect();
      await this.listener.query('LISTEN outbox');
      this.listener.on('notification', () => this.wake?.());
    }
    this.loop = (async () => {
      let backoff = 100;
      while (this.running) {
        try {
          const n = await this.runOnce();
          backoff = 100;
          if (n >= (this.o.batchSize ?? 500)) continue;
          await new Promise<void>((r) => { this.wake = r; setTimeout(r, this.o.pollMs ?? 500); });
        } catch (e) {
          this.errors++;
          this.o.onError?.(e);
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 2000);
        }
      }
    })();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
    await this.listener?.end().catch(() => {});
  }
}

/**
 * Sweeper: vuelve a dejar como "no publicados" eventos publicados hace > olderThanMs que el consumidor
 * no procesó (ni están en DLQ). Cubre el caso "la cola perdió jobs" (Valkey sin persistencia / failover).
 */
export async function sweepUnconsumed(pool: Pool, consumer: string, olderThanMs: number): Promise<number> {
  const r = await pool.query(
    `UPDATE platform.outbox o SET published_at = NULL
      WHERE published_at < clock_timestamp() - make_interval(secs => $2::double precision / 1000)
        AND NOT EXISTS (SELECT 1 FROM platform.inbox i WHERE i.consumer = $1 AND i.event_id = o.id)
        AND NOT EXISTS (SELECT 1 FROM platform.dead_letter d WHERE d.consumer = $1 AND d.event_id = o.id)`,
    [consumer, olderThanMs]);
  return r.rowCount ?? 0;
}
