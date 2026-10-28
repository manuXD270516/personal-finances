import { loadavg } from 'node:os';
import type {
  AcquireTimeout,
  ConnectionsReport,
  ConsumerDrain,
  PoolConnectionStats,
  ServerConnectionStats,
} from './perf-report.js';

/**
 * Presupuesto de conexiones del benchmark del import (fix-imports-perf-connection-budget, decisiones 2 y 3,
 * TC-PLATFORM-PIPELINE-029 y 030): la suma de los pools máximos que abre la suite debe caber en el servidor, y durante la
 * medición se publica, por pool, lo que se usó y lo que se esperó.
 */

/** Tamaño por omisión de la cola pg-boss de cada proceso (`PgBossJobQueue`: `max: options.poolMax ?? 4`). */
export const QUEUE_POOL_MAX = 4;
/** Conexiones propias del harness: el muestreador, la foto de carga de fondo y la consulta administrativa en curso. */
export const HARNESS_CONNECTIONS = 3;

export interface PoolBudget {
  readonly name: string;
  readonly max: number;
}

export interface ServerConnectionLimits {
  readonly maxConnections: number;
  readonly reserved: number;
}

export interface ConnectionBudgetCheck {
  readonly fits: boolean;
  readonly total: number;
  /** `max_connections` menos las reservadas. */
  readonly limit: number;
  readonly maxConnections: number;
  readonly reserved: number;
  readonly pools: readonly PoolBudget[];
}

export function checkConnectionBudget(
  pools: readonly PoolBudget[],
  server: ServerConnectionLimits,
): ConnectionBudgetCheck {
  const total = pools.reduce((sum, p) => sum + p.max, 0);
  const limit = server.maxConnections - server.reserved;
  return {
    fits: total <= limit,
    total,
    limit,
    maxConnections: server.maxConnections,
    reserved: server.reserved,
    pools,
  };
}

export function connectionBudgetMessage(check: ConnectionBudgetCheck): string {
  const detail = check.pools.map((p) => `${p.name} ${String(p.max)}`).join(', ');
  return check.fits
    ? `presupuesto de conexiones: ${String(check.total)} dentro de un límite de ${String(check.limit)} (max_connections ${String(check.maxConnections)} menos ${String(check.reserved)} reservadas); ${detail}`
    : `presupuesto de conexiones: ${String(check.total)} conexiones frente a un límite de ${String(check.limit)} (max_connections ${String(check.maxConnections)} menos ${String(check.reserved)} reservadas); ${detail}`;
}

export class ConnectionBudgetError extends Error {
  constructor(readonly check: ConnectionBudgetCheck) {
    super(
      `[TC-PLATFORM-PIPELINE-029] el benchmark no cabe en el servidor, no se mide: ${connectionBudgetMessage(check)}`,
    );
    this.name = 'ConnectionBudgetError';
  }
}

/** Falla sin medir si la suma de los pools máximos no cabe en el servidor. */
export function assertConnectionBudget(
  pools: readonly PoolBudget[],
  server: ServerConnectionLimits,
): ConnectionBudgetCheck {
  const check = checkConnectionBudget(pools, server);
  if (!check.fits) throw new ConnectionBudgetError(check);
  return check;
}

/** Lo mínimo que usan estas funciones de un cliente de pg. */
export interface SqlClient {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}

/** `max_connections` y `superuser_reserved_connections` del servidor (consultas en serie sobre un mismo cliente). */
export async function readServerLimits(client: SqlClient): Promise<ServerConnectionLimits> {
  const { rows } = await client.query(
    `SELECT name, setting FROM pg_settings WHERE name IN ('max_connections', 'superuser_reserved_connections')`,
  );
  const value = (name: string): number => {
    const row = rows.find((r) => r['name'] === name);
    if (!row) throw new Error(`pg_settings no devolvió ${name}`);
    return Number(row['setting']);
  };
  return {
    maxConnections: value('max_connections'),
    reserved: value('superuser_reserved_connections'),
  };
}

/** Lo que usa el muestreo de un `pg.Pool` (permite sustituirlo en los tests unitarios). */
export interface PoolLike {
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
  readonly options: { readonly max?: number };
  connect(...args: unknown[]): unknown;
}

export const ACQUIRE_TIMEOUT_MESSAGE = /timeout exceeded when trying to connect/iu;

/** Espera y vencimientos de adquisición de los pools instrumentados. */
export class AcquisitionRecorder {
  private readonly maxWait = new Map<string, number>();
  readonly timeouts: AcquireTimeout[] = [];

  record(pool: string, waitedMs: number): void {
    this.maxWait.set(pool, Math.max(this.maxWait.get(pool) ?? 0, waitedMs));
  }

  maxWaitMs(pool: string): number {
    return this.maxWait.get(pool) ?? 0;
  }
}

/**
 * Envuelve `pool.connect` para medir cuánto tarda cada adquisición y registrar las que vencen. `pg-pool` llama a
 * `this.connect(cb)` desde `query()`, de modo que la propiedad de instancia cubre tanto `pool.connect()` como
 * `pool.query()`. Devuelve la función que restaura el original.
 */
export function instrumentPool(
  name: string,
  pool: PoolLike,
  recorder: AcquisitionRecorder,
  now: () => number = () => performance.now(),
): () => void {
  const original = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  const settle = (started: number, error: unknown): void => {
    const waitedMs = now() - started;
    recorder.record(name, waitedMs);
    if (error instanceof Error && ACQUIRE_TIMEOUT_MESSAGE.test(error.message)) {
      recorder.timeouts.push({
        pool: name,
        inUse: pool.totalCount - pool.idleCount,
        max: pool.options.max ?? 0,
        waitedMs,
      });
    }
  };
  (pool as { connect: (...args: unknown[]) => unknown }).connect = (...args: unknown[]): unknown => {
    const started = now();
    const last = args[args.length - 1];
    if (typeof last === 'function') {
      const cb = last as (err: unknown, ...rest: unknown[]) => void;
      return original(...args.slice(0, -1), (err: unknown, ...rest: unknown[]) => {
        settle(started, err);
        cb(err, ...rest);
      });
    }
    const result = original(...args) as Promise<unknown>;
    return result.then(
      (client) => {
        settle(started, undefined);
        return client;
      },
      (err: unknown) => {
        settle(started, err);
        throw err;
      },
    );
  };
  return () => {
    (pool as { connect: unknown }).connect = original;
  };
}

interface PoolPeak {
  max: number;
  peakInUse: number;
  peakWaiting: number;
}

/**
 * Muestreador de conexiones: cada `intervalMs` lee `totalCount`, `idleCount` y `waitingCount` de cada pool y, del
 * servidor, las conexiones por `application_name`. Las consultas van en serie sobre un único cliente propio, que se
 * cuenta en el presupuesto (`HARNESS_CONNECTIONS`).
 */
export class ConnectionSampler {
  private readonly peaks = new Map<string, PoolPeak>();
  private readonly byApplication = new Map<string, number>();
  private serverPeak = 0;
  private peakLoad1m = 0;
  private samples = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private inFlight: Promise<void> = Promise.resolve();

  constructor(
    private readonly pools: Readonly<Record<string, PoolLike>>,
    private readonly client: SqlClient,
    private readonly recorder: AcquisitionRecorder,
    private readonly intervalMs = 1000,
  ) {
    for (const [name, pool] of Object.entries(pools)) {
      this.peaks.set(name, { max: pool.options.max ?? 0, peakInUse: 0, peakWaiting: 0 });
    }
  }

  /** Una muestra: pools del proceso y conexiones del servidor por `application_name`. */
  async sampleOnce(): Promise<void> {
    for (const [name, pool] of Object.entries(this.pools)) {
      const peak = this.peaks.get(name)!;
      peak.peakInUse = Math.max(peak.peakInUse, pool.totalCount - pool.idleCount);
      peak.peakWaiting = Math.max(peak.peakWaiting, pool.waitingCount);
    }
    const { rows } = await this.client.query(
      `SELECT COALESCE(NULLIF(application_name, ''), '(sin nombre)') AS application, count(*)::int AS n
         FROM pg_stat_activity
        WHERE backend_type = 'client backend'
        GROUP BY 1`,
    );
    let total = 0;
    for (const r of rows) {
      const app = String(r['application']);
      const n = Number(r['n']);
      total += n;
      this.byApplication.set(app, Math.max(this.byApplication.get(app) ?? 0, n));
    }
    this.serverPeak = Math.max(this.serverPeak, total);
    this.peakLoad1m = Math.max(this.peakLoad1m, loadavg()[0] ?? 0);
    this.samples += 1;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = (): void => {
      if (!this.running) return;
      this.inFlight = this.sampleOnce()
        .catch(() => undefined)
        .then(() => {
          if (this.running) this.timer = setTimeout(tick, this.intervalMs);
        });
    };
    tick();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
    await this.sampleOnce().catch(() => undefined);
  }

  report(server: ServerConnectionLimits, budget: ConnectionBudgetCheck): ConnectionsReport {
    const pools: PoolConnectionStats[] = [...this.peaks].map(([pool, p]) => ({
      pool,
      max: p.max,
      peakInUse: p.peakInUse,
      peakWaiting: p.peakWaiting,
      maxAcquireMs: Math.round(this.recorder.maxWaitMs(pool)),
      timeouts: this.recorder.timeouts.filter((t) => t.pool === pool).length,
    }));
    const serverStats: ServerConnectionStats = {
      maxConnections: server.maxConnections,
      reserved: server.reserved,
      peak: this.serverPeak,
      peakByApplication: Object.fromEntries([...this.byApplication].sort(([a], [b]) => a.localeCompare(b))),
    };
    return {
      samples: this.samples,
      peakLoad1m: Math.round(this.peakLoad1m * 100) / 100,
      budget: { total: budget.total, limit: budget.limit, fits: budget.fits },
      pools,
      server: serverStats,
      timeouts: [...this.recorder.timeouts],
    };
  }
}

/** Seguimiento del drenado por cola desde el fin de la persistencia (decisión 4, TC-PLATFORM-PIPELINE-031). */
export class DrainTracker {
  private readonly pendingAtStart = new Map<string, number>();
  private readonly peak = new Map<string, number>();
  private readonly zeroSince = new Map<string, number>();

  /**
   * `t`: ms desde el fin de la persistencia. `backlog`: pendientes por cola (las colas sin trabajos cuentan 0).
   * `outbox`: hechos sin publicar. Una cola solo se da por drenada cuando ella y el outbox están en 0, porque los eventos
   * aún sin publicar le llegarán después.
   */
  observe(t: number, backlog: ReadonlyMap<string, number>, outbox: number): void {
    const names = new Set([...backlog.keys(), ...this.pendingAtStart.keys()]);
    for (const name of names) {
      const pending = backlog.get(name) ?? 0;
      if (!this.pendingAtStart.has(name)) this.pendingAtStart.set(name, pending);
      this.peak.set(name, Math.max(this.peak.get(name) ?? 0, pending));
      this.mark(name, t, pending === 0 && outbox === 0);
    }
    if (!this.pendingAtStart.has('outbox')) this.pendingAtStart.set('outbox', outbox);
    this.peak.set('outbox', Math.max(this.peak.get('outbox') ?? 0, outbox));
    this.mark('outbox', t, outbox === 0);
  }

  private mark(name: string, t: number, idle: boolean): void {
    if (!idle) this.zeroSince.delete(name);
    else if (!this.zeroSince.has(name)) this.zeroSince.set(name, t);
  }

  /** `null` en `drainedAfterPersistMs` = la cola no llegó a 0 mientras se observó. */
  result(): ConsumerDrain[] {
    return [...this.pendingAtStart]
      .map(([queue, pendingAtPersist]) => {
        const drainedAfterPersistMs = this.zeroSince.get(queue) ?? null;
        return {
          queue,
          pendingAtPersist,
          peakPending: this.peak.get(queue) ?? pendingAtPersist,
          drainedAfterPersistMs: drainedAfterPersistMs === null ? null : Math.round(drainedAfterPersistMs),
          eventsPerSecond:
            drainedAfterPersistMs === null || drainedAfterPersistMs <= 0 || pendingAtPersist === 0
              ? null
              : Math.round((pendingAtPersist / (drainedAfterPersistMs / 1000)) * 10) / 10,
        };
      })
      .sort((a, b) => a.queue.localeCompare(b.queue));
  }
}
