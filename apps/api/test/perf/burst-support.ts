import { EventDeliveryMetrics } from '@pf/platform/events';
import type { Client } from 'pg';
import { asAdmin, type Harness } from '../support/portability.js';
import { classifyRetryReason, percentile, type JobFailure, type RetriedJobs } from './perf-report.js';

/**
 * Soporte del perfil de ráfaga del import (optimize-consumer-throughput, E6–E10b): CSV de N filas, backlog por consumidor,
 * duración por evento con el handler real, muestreo de esperas por bloqueos y motivo de los reintentos.
 */

/** Los tres hechos que publica cada transacción importada (add-basic-csv-import, decisión 11). */
export const BURST_EVENT_TYPES = [
  'transactions.TransactionCreated',
  'transactions.TransactionPosted',
  'ledger.JournalEntryPosted',
] as const;

export function generateCsv(rows: number): Buffer {
  const lines = ['Fecha;Descripción;Monto'];
  for (let i = 0; i < rows; i += 1) {
    const day = String((i % 28) + 1).padStart(2, '0');
    const month = String((Math.floor(i / 28) % 3) + 8).padStart(2, '0');
    const cents = String(i % 100).padStart(2, '0');
    lines.push(`${day}/${month}/2026;COMPRA COMERCIO ${i};-${(i % 250) + 1},${cents}`);
  }
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'latin1');
}

/** Colas de consumidores (`events.*` sin dead-letter) con sus pendientes y reintentos; 0 las que no tienen trabajos. */
export async function consumerBacklogWithZeros(
  h: Harness,
): Promise<{ backlog: Map<string, number>; retrying: Map<string, number> }> {
  return asAdmin(h, async (c) => {
    const queues = await c.query<{ name: string }>(
      `SELECT name FROM pgboss.queue WHERE name LIKE 'events.%' AND name NOT LIKE '%.dlq'`,
    );
    const { rows } = await c.query<{ name: string; pending: number; retrying: number }>(
      `SELECT name, count(*)::int AS pending, (count(*) FILTER (WHERE state = 'retry'))::int AS retrying
         FROM pgboss.job
        WHERE name LIKE 'events.%' AND name NOT LIKE '%.dlq' AND state IN ('created', 'retry', 'active')
        GROUP BY name`,
    );
    return {
      backlog: new Map([...queues.rows.map((r) => [r.name, 0] as const), ...rows.map((r) => [r.name, r.pending] as const)]),
      retrying: new Map(rows.map((r) => [r.name, r.retrying] as const)),
    };
  });
}

export async function outboxPending(h: Harness): Promise<number> {
  return asAdmin(h, async (c) => {
    const { rows } = await c.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM platform.outbox WHERE published_at IS NULL`,
    );
    return rows[0]!.n;
  });
}

/** Trabajos de los consumidores creados desde `since` que se reintentaron al menos una vez, con el motivo (E10b). */
export async function retriedJobs(h: Harness, since: Date): Promise<RetriedJobs[]> {
  return asAdmin(h, async (c) => {
    const { rows } = await c.query<{
      name: string;
      jobs: number;
      max_retry: number;
      max_latency_ms: number;
      error: string | null;
    }>(
      `SELECT name, count(*)::int AS jobs, max(retry_count)::int AS max_retry,
              (max(EXTRACT(EPOCH FROM (COALESCE(completed_on, now()) - created_on))) * 1000)::int AS max_latency_ms,
              left(max(COALESCE(output::jsonb ->> 'message', output::text)), 200) AS error
         FROM pgboss.job
        WHERE name LIKE 'events.%' AND name NOT LIKE '%.dlq' AND retry_count > 0 AND created_on >= $1
        GROUP BY name
        ORDER BY name`,
      [since],
    );
    return rows.map((r) => ({
      queue: r.name,
      jobs: r.jobs,
      maxRetryCount: r.max_retry,
      maxLatencyMs: r.max_latency_ms,
      error: r.error ?? '(sin mensaje)',
      reason: classifyRetryReason(r.error ?? ''),
    }));
  });
}

/** Fallos de entrega que registró el worker (`job failed`), agrupados por cola y error. */
export function jobFailures(h: Harness): JobFailure[] {
  const groups = new Map<string, JobFailure>();
  for (const line of h.workerLog?.lines ?? []) {
    if (!line.includes('"job failed"')) continue;
    const rec = JSON.parse(line) as Record<string, unknown>;
    const err = (rec['err'] ?? {}) as { type?: string; message?: string; code?: string };
    const queue = String(rec['job.queue'] ?? '(sin cola)');
    const error = `${err.code ? `${err.code} ` : ''}${err.type ?? 'Error'}: ${(err.message ?? '').slice(0, 160)}`;
    const key = `${queue} | ${error}`;
    const attempt = Number(rec['job.attempt'] ?? 1);
    const current = groups.get(key);
    groups.set(key, {
      queue,
      error,
      count: (current?.count ?? 0) + 1,
      maxAttempt: Math.max(current?.maxAttempt ?? 0, attempt),
    });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 15);
}

/** Métricas del worker que además guardan la duración de cada evento por consumidor (E6, handler real). */
export class SamplingMetrics extends EventDeliveryMetrics {
  readonly samples = new Map<string, number[]>();

  constructor() {
    super(undefined);
  }

  override consumed(consumer: string, seconds: number): void {
    super.consumed(consumer, seconds);
    const list = this.samples.get(consumer);
    if (list) list.push(seconds * 1000);
    else this.samples.set(consumer, [seconds * 1000]);
  }

  reset(): void {
    this.samples.clear();
  }

  /** p50 y p95 en milisegundos (rango más cercano); ceros sin muestras. */
  percentiles(consumer: string): { n: number; p50Ms: number; p95Ms: number } {
    const sorted = [...(this.samples.get(consumer) ?? [])].sort((a, b) => a - b);
    if (sorted.length === 0) return { n: 0, p50Ms: 0, p95Ms: 0 };
    const round = (v: number) => Math.round(v * 100) / 100;
    return {
      n: sorted.length,
      p50Ms: round(percentile(sorted, 50)),
      p95Ms: round(percentile(sorted, 95)),
    };
  }
}

export interface LockWaitRow {
  /** Sentencia que esperaba (primeros caracteres). */
  readonly waiting: string;
  /** Sentencia de la sesión que la bloqueaba, si la hay. */
  readonly blocker: string;
  /** Muestras en las que se observó esta espera (una por segundo y sesión). */
  readonly samples: number;
}

/**
 * Muestrea cada segundo las sesiones con `wait_event_type = 'Lock'` (E7) con consultas en serie sobre UNA conexión propia
 * (contada en la precondición de presupuesto del harness).
 */
export class LockWaitSampler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private readonly rows = new Map<string, LockWaitRow>();
  private ticks = 0;

  constructor(
    private readonly client: Client,
    private readonly intervalMs = 1000,
  ) {}

  start(): void {
    this.rows.clear();
    this.ticks = 0;
    this.timer = setInterval(() => void this.sample(), this.intervalMs);
  }

  private async sample(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { rows } = await this.client.query<{ waiting: string; blocker: string | null }>(
        `SELECT left(regexp_replace(a.query, '\\s+', ' ', 'g'), 110) AS waiting,
                (SELECT left(regexp_replace(b.query, '\\s+', ' ', 'g'), 110)
                   FROM pg_stat_activity b WHERE b.pid = ANY (pg_blocking_pids(a.pid)) LIMIT 1) AS blocker
           FROM pg_stat_activity a
          WHERE a.wait_event_type = 'Lock' AND a.datname = current_database() AND a.pid <> pg_backend_pid()`,
      );
      this.ticks += 1;
      for (const r of rows) {
        const key = `${r.waiting}\u0000${r.blocker ?? ''}`;
        const current = this.rows.get(key);
        this.rows.set(key, {
          waiting: r.waiting,
          blocker: r.blocker ?? '(sin bloqueador visible)',
          samples: (current?.samples ?? 0) + 1,
        });
      }
    } catch {
      // Un muestreo fallido no invalida la medición.
    } finally {
      this.running = false;
    }
  }

  stop(): { totalMs: number; top: LockWaitRow[] } {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const all = [...this.rows.values()].sort((a, b) => b.samples - a.samples);
    return { totalMs: all.reduce((sum, r) => sum + r.samples, 0) * this.intervalMs, top: all.slice(0, 8) };
  }
}
