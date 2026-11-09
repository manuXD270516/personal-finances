import { cpus, loadavg, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import type { PersistStep, PersistTimings } from '@pf/imports/interface/imports.module';
import type { BatchStep, BatchStepTimer } from '@pf/transactions/interface/transactions.module';
import { asAdmin, type Harness } from '../support/portability.js';
import {
  buildFingerprint,
  type DbSample,
  type OutboxDiagnosis,
  type PersistBatchSample,
  type PersistTimingsRaw,
  type QueueJobRow,
  type RunnerFingerprint,
} from './persist-breakdown.js';

/**
 * Instrumentación del benchmark del import (stabilize-import-persist-perf, design decisión 2): recolector de tiempos del
 * worker, muestreador de la base durante la persistencia, huella del runner y diagnóstico del outbox. Solo se usa desde
 * los `*.perf.ts`; en producción no existe nada de esto.
 */

/** Recolector de tiempos: lo inyecta el harness al arrancar el worker (`persistTimings`). */
export class PersistCollector implements PersistTimings, BatchStepTimer {
  private startedAtMs = 0;
  private finishedAtMs = 0;
  private stageSteps: Record<string, number> = {};
  private batches: PersistBatchSample[] = [];
  private current: { batch: number; startedAtMs: number; steps: Record<string, number> } | undefined;

  reset(): void {
    this.startedAtMs = 0;
    this.finishedAtMs = 0;
    this.stageSteps = {};
    this.batches = [];
    this.current = undefined;
  }

  persistStarted(): void {
    this.reset();
    this.startedAtMs = Date.now();
  }

  persistFinished(): void {
    this.finishedAtMs = Date.now();
  }

  async batch<T>(batchNo: number, fn: () => Promise<T>): Promise<T> {
    const startedAtMs = Date.now();
    const t0 = performance.now();
    this.current = { batch: batchNo, startedAtMs, steps: {} };
    try {
      return await fn();
    } finally {
      const cur = this.current;
      this.current = undefined;
      this.batches.push({
        batch: batchNo,
        startedAtMs,
        durationMs: performance.now() - t0,
        steps: cur?.steps ?? {},
      });
    }
  }

  async measure<T>(step: PersistStep | BatchStep, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now();
    try {
      return await fn();
    } finally {
      const ms = performance.now() - t0;
      const target = this.current ? this.current.steps : this.stageSteps;
      target[step] = (target[step] ?? 0) + ms;
    }
  }

  raw(approvedAtMs: number, observedAtMs: number): PersistTimingsRaw {
    return {
      approvedAtMs,
      persistStartedAtMs: this.startedAtMs,
      persistFinishedAtMs: this.finishedAtMs,
      observedAtMs,
      stageSteps: { ...this.stageSteps },
      batches: [...this.batches],
    };
  }
}

export interface SqlRunner {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

/**
 * Serializa las consultas de un cliente compartido: el muestreador de conexiones, el de la persistencia y la huella
 * comparten UNA conexión del harness (presupuesto de conexiones) y nunca consultan en paralelo sobre ella.
 */
export class SerialClient implements SqlRunner {
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly client: SqlRunner) {}

  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> {
    const run = this.tail.then(
      () => this.client.query(text, values),
      () => this.client.query(text, values),
    );
    this.tail = run.catch(() => undefined);
    return run;
  }
}

/** Intervalo de muestreo de la persistencia. */
export const PERSIST_SAMPLE_MS = 250;
/** Cada cuántas muestras se cuentan los trabajos `events.*` encolados (el conteo recorre la tabla de trabajos). */
const QUEUE_COUNT_EVERY = 8;

/**
 * Muestrea la base cada 250 ms mientras se persiste: esperas de las sesiones activas por tipo, limpiezas automáticas en
 * curso, puntos de control (deltas de `pg_stat_checkpointer`), trabajos `events.*` encolados y carga del host. Una
 * muestra fallida no invalida la medición.
 */
export class PersistSampler {
  readonly samples: DbSample[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private inFlight: Promise<void> = Promise.resolve();
  private ticks = 0;
  private queued = 0;
  private lastCheckpoint: { n: number; ms: number } | undefined;

  constructor(
    private readonly client: SqlRunner,
    private readonly intervalMs = PERSIST_SAMPLE_MS,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = (): void => {
      if (!this.running) return;
      this.inFlight = this.sampleOnce().finally(() => {
        if (this.running) this.timer = setTimeout(tick, this.intervalMs);
      });
    };
    tick();
  }

  async stop(): Promise<readonly DbSample[]> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
    return this.samples;
  }

  async sampleOnce(): Promise<void> {
    try {
      const atMs = Date.now();
      const waits = await this.client.query(
        `SELECT wait_event_type || ':' || wait_event AS wait, count(*)::int AS n
           FROM pg_stat_activity
          WHERE state = 'active' AND wait_event IS NOT NULL AND datname = current_database()
            AND backend_type = 'client backend' AND pid <> pg_backend_pid()
          GROUP BY 1`,
      );
      const vacuum = await this.client.query(
        `SELECT relid::regclass::text AS rel FROM pg_stat_progress_vacuum WHERE datname = current_database()`,
      );
      const cp = await this.client.query(
        `SELECT (num_timed + num_requested)::int AS n, (write_time + sync_time)::float8 AS ms FROM pg_stat_checkpointer`,
      );
      this.ticks += 1;
      if (this.ticks % QUEUE_COUNT_EVERY === 1) {
        const q = await this.client.query(
          `SELECT count(*)::int AS n FROM pgboss.job WHERE name LIKE 'events.%' AND state = 'created'`,
        );
        this.queued = Number(q.rows[0]?.['n'] ?? 0);
      }
      const now = { n: Number(cp.rows[0]?.['n'] ?? 0), ms: Number(cp.rows[0]?.['ms'] ?? 0) };
      const prev = this.lastCheckpoint;
      this.lastCheckpoint = now;
      this.samples.push({
        atMs,
        waits: Object.fromEntries(waits.rows.map((r) => [String(r['wait']), Number(r['n'])])),
        autovacuum: vacuum.rows.map((r) => String(r['rel'])),
        checkpoints: prev ? Math.max(0, now.n - prev.n) : 0,
        checkpointMs: prev ? Math.max(0, now.ms - prev.ms) : 0,
        queuedEventJobs: this.queued,
        loadAvg1m: loadavg()[0] ?? 0,
      });
    } catch {
      // Una muestra fallida no invalida la medición.
    }
  }
}

/** Trabajos de colas no `events.*` que empezaron desde `sinceMs` (filtrados después por `scheduledJobsInWindow`). */
export async function queueJobsSince(h: Harness, sinceMs: number): Promise<QueueJobRow[]> {
  return asAdmin(h, async (c) => {
    const { rows } = await c.query<{ name: string; started_ms: string; duration_ms: string | null }>(
      `SELECT name,
              (EXTRACT(EPOCH FROM started_on) * 1000)::bigint::text AS started_ms,
              (EXTRACT(EPOCH FROM (COALESCE(completed_on, now()) - started_on)) * 1000)::text AS duration_ms
         FROM pgboss.job
        WHERE started_on IS NOT NULL AND name NOT LIKE 'events.%' AND started_on >= to_timestamp($1 / 1000.0)`,
      [sinceMs],
    );
    return rows.map((r) => ({
      name: r.name,
      startedAtMs: Number(r.started_ms),
      durationMs: Number(r.duration_ms ?? 0),
    }));
  });
}

// ── Huella del runner ───────────────────────────────────────────────────────────────────────────────────────────

const CALIBRATION_ROWS = 5000;
const CALIBRATION_RULES = 200;

/**
 * Una pasada de la carga de CPU fija y determinista: 5 000 filas contra 200 reglas de 5 condiciones (subcadena, importe
 * y una expresión regular cada 200 reglas), sin base de datos. Devuelve un acumulador para que el motor no la elimine.
 */
export function calibrationPass(): number {
  const descriptions = Array.from(
    { length: CALIBRATION_ROWS },
    (_, i) => `comercio ${String(i % 400)} suc ${String(i % 13)} ref ${String(i)}`,
  );
  const amounts = Array.from({ length: CALIBRATION_ROWS }, (_, i) => 10 + (i % 997));
  const regex = /comercio (\d+) (suc|sucursal) \d+/u;
  let matched = 0;
  for (let rule = 1; rule <= CALIBRATION_RULES; rule += 1) {
    const needle = `comercio ${String(rule)}`;
    const floor = 1000 + rule;
    for (let row = 0; row < CALIBRATION_ROWS; row += 1) {
      const text = descriptions[row] as string;
      let score = 0;
      if (text.includes(needle)) score += 1;
      if ((amounts[row] as number) >= floor) score += 1;
      if (text.includes(needle.slice(0, 9))) score += 1;
      if ((amounts[row] as number) < floor + 5000) score += 1;
      if (rule % 200 === 0 ? regex.test(text) : text.startsWith('c')) score += 1;
      if (score === 5) matched += 1;
    }
  }
  return matched;
}

const middle = (values: number[]): number =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

/** Calibración de CPU: mediana de 5 pasadas tras una de calentamiento (ms). */
export function cpuCalibrationMs(): number {
  calibrationPass();
  const times: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const t0 = performance.now();
    calibrationPass();
    times.push(performance.now() - t0);
  }
  return middle(times);
}

const COMMIT_ROWS = 500;

/**
 * Calibración de confirmaciones: 500 `INSERT` con su `COMMIT` (autocommit) en una tabla temporal; mediana de 3 pasadas
 * en confirmaciones por segundo. La tabla temporal vive solo en la sesión del cliente.
 */
export async function commitCalibration(client: SqlRunner): Promise<number> {
  await client.query('CREATE TEMP TABLE IF NOT EXISTS pf_commit_calibration (n integer, filler text)');
  const rates: number[] = [];
  try {
    for (let pass = 0; pass < 3; pass += 1) {
      await client.query('TRUNCATE pf_commit_calibration');
      const t0 = performance.now();
      for (let i = 0; i < COMMIT_ROWS; i += 1) {
        await client.query("INSERT INTO pf_commit_calibration (n, filler) VALUES ($1, repeat('x', 64))", [i]);
      }
      rates.push(COMMIT_ROWS / ((performance.now() - t0) / 1000));
    }
  } finally {
    await client.query('DROP TABLE IF EXISTS pf_commit_calibration');
  }
  return Math.round(middle(rates));
}

/** Huella del runner al empezar y antes del benchmark del import (informativa: nunca decide un veredicto). */
export async function takeFingerprint(client: SqlRunner): Promise<RunnerFingerprint> {
  const info = cpus();
  let commitsPerSecond: number | null = null;
  try {
    commitsPerSecond = await commitCalibration(client);
  } catch {
    // Sin la calibración de confirmaciones, la huella sigue publicándose con el resto.
  }
  return buildFingerprint({
    cpuModel: info[0]?.model ?? 'desconocido',
    cpuCount: info.length,
    totalMemoryBytes: totalmem(),
    cpuCalibrationMs: cpuCalibrationMs(),
    commitsPerSecond,
  });
}

// ── Diagnóstico del outbox ──────────────────────────────────────────────────────────────────────────────────────

const RELAY_HEADS_QUERY = `SELECT o.id
             FROM platform.outbox o
            WHERE o.published_at IS NULL
              AND NOT EXISTS (
                    SELECT 1 FROM platform.outbox p
                     WHERE p.published_at IS NULL
                       AND p.workspace_id = o.workspace_id
                       AND p.aggregate_id = o.aggregate_id
                       AND p.sequence < o.sequence)
            ORDER BY o.sequence
            LIMIT 500`;

/**
 * Diagnóstico del outbox al vencer el tope de la preparación de la ráfaga (H7 del design): pendientes por tipo con
 * intentos y último error, antigüedad del más viejo, `EXPLAIN` de la consulta de cabezas del relay y la transacción
 * abierta más larga. Cada consulta es independiente: si una falla, el resto se publica.
 */
export async function diagnoseOutbox(h: Harness): Promise<OutboxDiagnosis> {
  return asAdmin(h, async (c) => {
    const byType = await c.query<{ event_type: string; n: number; attempts: number; err: string | null }>(
      `SELECT event_type, count(*)::int AS n, max(publish_attempts)::int AS attempts,
              left(max(last_error), 200) AS err
         FROM platform.outbox WHERE published_at IS NULL
        GROUP BY event_type ORDER BY n DESC LIMIT 20`,
    );
    const oldest = await c.query<{ age_ms: string | null }>(
      `SELECT (EXTRACT(EPOCH FROM (clock_timestamp() - min(created_at))) * 1000)::bigint::text AS age_ms
         FROM platform.outbox WHERE published_at IS NULL`,
    );
    const longest = await c.query<{ ms: string; query: string }>(
      `SELECT (EXTRACT(EPOCH FROM (clock_timestamp() - xact_start)) * 1000)::bigint::text AS ms,
              left(regexp_replace(query, '\\s+', ' ', 'g'), 160) AS query
         FROM pg_stat_activity
        WHERE xact_start IS NOT NULL AND pid <> pg_backend_pid() AND datname = current_database()
        ORDER BY xact_start LIMIT 1`,
    );
    let plan: string | undefined;
    try {
      const explain = await c.query<Record<string, string>>(`EXPLAIN ${RELAY_HEADS_QUERY}`);
      plan = explain.rows
        .map((r) => Object.values(r)[0] ?? '')
        .join('\n')
        .slice(0, 2000);
    } catch {
      plan = undefined;
    }
    const pending = byType.rows.reduce((sum, r) => sum + r.n, 0);
    const longestRow = longest.rows[0];
    return {
      pending,
      byType: byType.rows.map((r) => ({
        eventType: r.event_type,
        pending: r.n,
        maxAttempts: r.attempts,
        lastError: r.err,
      })),
      oldestPendingAgeMs: oldest.rows[0]?.age_ms ? Number(oldest.rows[0].age_ms) : null,
      longestTransactionMs: longestRow ? Number(longestRow.ms) : null,
      longestTransactionQuery: longestRow?.query ?? null,
      ...(plan ? { relayPlan: plan } : {}),
    };
  });
}
