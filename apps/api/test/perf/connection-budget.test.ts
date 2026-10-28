import { describe, expect, it } from 'vitest';
import {
  AcquisitionRecorder,
  assertConnectionBudget,
  checkConnectionBudget,
  ConnectionBudgetError,
  ConnectionSampler,
  DrainTracker,
  HARNESS_CONNECTIONS,
  instrumentPool,
  QUEUE_POOL_MAX,
  readServerLimits,
  type PoolBudget,
  type PoolLike,
  type SqlClient,
} from './connection-budget.js';

// Pools por omisión del benchmark del import: API 52, worker 52, una cola pg-boss de 4 por proceso y 3 del harness.
const DEFAULT_POOLS: PoolBudget[] = [
  { name: 'api', max: 52 },
  { name: 'worker', max: 52 },
  { name: 'api-queue', max: QUEUE_POOL_MAX },
  { name: 'worker-queue', max: QUEUE_POOL_MAX },
  { name: 'harness', max: HARNESS_CONNECTIONS },
];

describe('presupuesto de conexiones del benchmark del import (fix-imports-perf-connection-budget)', () => {
  it('[TC-PLATFORM-PIPELINE-029] 115 conexiones frente a un servidor de 100 con 3 reservadas no caben: falla con la suma, el límite y cada pool', () => {
    const check = checkConnectionBudget(DEFAULT_POOLS, { maxConnections: 100, reserved: 3 });
    expect(check).toMatchObject({ fits: false, poolsSum: 115, limit: 97 });
    let error: unknown;
    try {
      assertConnectionBudget(DEFAULT_POOLS, { maxConnections: 100, reserved: 3 });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ConnectionBudgetError);
    const message = (error as Error).message;
    expect(message).toContain('115 conexiones frente a un límite de 97');
    for (const text of ['api 52', 'worker 52', 'api-queue 4', 'worker-queue 4', 'harness 3']) {
      expect(message).toContain(text);
    }
    expect(message).toContain('TC-PLATFORM-PIPELINE-029');
  });

  it('[TC-PLATFORM-PIPELINE-029] una suma que cabe pasa, también justo en el límite', () => {
    const pools: PoolBudget[] = [
      { name: 'api', max: 22 },
      { name: 'worker', max: 34 },
      { name: 'api-queue', max: 4 },
      { name: 'worker-queue', max: 4 },
      { name: 'harness', max: 3 },
    ];
    expect(assertConnectionBudget(pools, { maxConnections: 70, reserved: 3 })).toMatchObject({
      fits: true,
      poolsSum: 67,
      limit: 67,
    });
    expect(() => assertConnectionBudget(pools, { maxConnections: 100, reserved: 3 })).not.toThrow();
    expect(checkConnectionBudget(pools, { maxConnections: 70, reserved: 4 }).fits).toBe(false);
  });

  it('[TC-PLATFORM-PIPELINE-029] max_connections y las reservadas salen de pg_settings', async () => {
    const queries: string[] = [];
    const client: SqlClient = {
      query: (sql) => {
        queries.push(sql);
        return Promise.resolve({
          rows: [
            { name: 'superuser_reserved_connections', setting: '3' },
            { name: 'max_connections', setting: '100' },
          ],
        });
      },
    };
    await expect(readServerLimits(client)).resolves.toEqual({ maxConnections: 100, reserved: 3 });
    expect(queries[0]).toContain('pg_settings');
    await expect(readServerLimits({ query: () => Promise.resolve({ rows: [] }) })).rejects.toThrow(
      /max_connections/u,
    );
  });
});

class FakePool implements PoolLike {
  totalCount = 0;
  idleCount = 0;
  waitingCount = 0;
  readonly options: { max: number };
  constructor(max: number) {
    this.options = { max };
  }
  /** Resuelve o rechaza tras `delayMs` según `outcome`; la forma con callback es la que usa `pool.query()`. */
  outcome: 'ok' | 'timeout' | 'auth' = 'ok';
  now = 0;
  advance = 0;
  connect(...args: unknown[]): unknown {
    const last = args[args.length - 1];
    this.now += this.advance;
    const error =
      this.outcome === 'timeout'
        ? new Error('timeout exceeded when trying to connect')
        : this.outcome === 'auth'
          ? new Error('password authentication failed')
          : null;
    if (typeof last === 'function') {
      (last as (err: Error | null, client?: object) => void)(error, error ? undefined : {});
      return undefined;
    }
    return error ? Promise.reject(error) : Promise.resolve({});
  }
}

describe('instrumentación de la adquisición de conexiones', () => {
  it('[TC-PLATFORM-PIPELINE-030] mide la espera máxima y registra la adquisición vencida con el pool, el uso y el máximo', async () => {
    const pool = new FakePool(34);
    pool.totalCount = 34;
    pool.idleCount = 0;
    let clock = 0;
    const recorder = new AcquisitionRecorder();
    const restore = instrumentPool('worker', pool, recorder, () => clock);
    // adquisición lenta que termina bien (promesa)
    pool.advance = 0;
    const slow = pool.connect() as Promise<unknown>;
    clock = 300;
    await slow;
    expect(recorder.maxWaitMs('worker')).toBe(300);
    expect(recorder.timeouts).toEqual([]);
    // adquisición con callback (la que usa pool.query) que vence a los 2 150 ms
    pool.outcome = 'timeout';
    clock = 1000;
    const result = await new Promise<Error | null>((resolve) => {
      const started = clock;
      pool.connect((err: Error | null) => resolve(err));
      clock = started + 2150;
    });
    expect(result?.message).toMatch(/timeout exceeded/u);
    expect(recorder.timeouts).toHaveLength(1);
    expect(recorder.timeouts[0]).toMatchObject({ pool: 'worker', inUse: 34, max: 34 });
    // adquisición con promesa rechazada
    await expect(pool.connect()).rejects.toThrow(/timeout exceeded/u);
    expect(recorder.timeouts).toHaveLength(2);
    restore();
    // restaurado: ya no registra
    await expect(pool.connect()).rejects.toThrow();
    expect(recorder.timeouts).toHaveLength(2);
  });

  it('[TC-PLATFORM-PIPELINE-030] un error que no es de adquisición no cuenta como conexión vencida', async () => {
    const pool = new FakePool(4);
    pool.outcome = 'auth';
    const recorder = new AcquisitionRecorder();
    instrumentPool('api', pool, recorder, () => 0);
    await expect(pool.connect()).rejects.toThrow(/password/u);
    expect(recorder.timeouts).toEqual([]);
  });
});

describe('muestreador de conexiones', () => {
  it('[TC-PLATFORM-PIPELINE-030] publica por pool el pico en uso, el pico en espera y la espera máxima, y del servidor el pico frente a su máximo', async () => {
    const api = new FakePool(52);
    const worker = new FakePool(34);
    const recorder = new AcquisitionRecorder();
    recorder.record('worker', 2150.4);
    let inFlight = 0;
    let maxInFlight = 0;
    const serverRows = [
      [
        { application: 'finance-api', n: 5 },
        { application: 'finance-worker', n: 20 },
        { application: 'pfos-consumer', n: 3 },
      ],
      [
        { application: 'finance-api', n: 4 },
        { application: 'finance-worker', n: 34 },
        { application: 'pfos-consumer', n: 4 },
      ],
    ];
    let call = 0;
    const client: SqlClient = {
      query: async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return { rows: serverRows[Math.min(call++, serverRows.length - 1)]! };
      },
    };
    const sampler = new ConnectionSampler({ api, worker }, client, recorder, 1000);
    worker.totalCount = 20;
    worker.idleCount = 6;
    api.totalCount = 5;
    api.idleCount = 5;
    await sampler.sampleOnce();
    worker.totalCount = 34;
    worker.idleCount = 0;
    worker.waitingCount = 7;
    await sampler.sampleOnce();
    worker.totalCount = 30;
    worker.idleCount = 20;
    worker.waitingCount = 0;
    await sampler.sampleOnce();
    const budget = checkConnectionBudget(DEFAULT_POOLS, { maxConnections: 100, reserved: 3 });
    const report = sampler.report({ maxConnections: 100, reserved: 3 }, budget);
    expect(maxInFlight).toBe(1); // consultas en serie sobre el cliente propio
    expect(report.samples).toBe(3);
    expect(report.pools).toEqual([
      { pool: 'api', max: 52, peakInUse: 0, peakWaiting: 0, maxAcquireMs: 0, timeouts: 0 },
      { pool: 'worker', max: 34, peakInUse: 34, peakWaiting: 7, maxAcquireMs: 2150, timeouts: 0 },
    ]);
    expect(report.server).toEqual({
      maxConnections: 100,
      reserved: 3,
      peak: 42,
      peakByApplication: { 'finance-api': 5, 'finance-worker': 34, 'pfos-consumer': 4 },
    });
    expect(report.budget).toEqual({ poolsSum: 115, limit: 97, fits: false });
  });

  it('[TC-PLATFORM-PIPELINE-030] start y stop muestrean periódicamente y detienen el temporizador', async () => {
    const pool = new FakePool(4);
    let n = 0;
    const client: SqlClient = {
      query: () => {
        n += 1;
        return Promise.resolve({ rows: [{ application: 'x', n: 1 }] });
      },
    };
    const sampler = new ConnectionSampler({ api: pool }, client, new AcquisitionRecorder(), 5);
    sampler.start();
    await new Promise((r) => setTimeout(r, 40));
    await sampler.stop();
    const after = n;
    expect(after).toBeGreaterThanOrEqual(3);
    await new Promise((r) => setTimeout(r, 30));
    expect(n).toBe(after);
  });
});

describe('drenado por consumidor desde la persistencia', () => {
  it('[TC-PLATFORM-PIPELINE-031] publica pendientes iniciales, tiempo hasta 0 y ritmo por consumidor; el outbox sin publicar retrasa a todos', () => {
    const tracker = new DrainTracker();
    tracker.observe(
      0,
      new Map([
        ['events.a', 1000],
        ['events.b', 0],
        ['events.c', 50],
      ]),
      200,
    );
    tracker.observe(
      10_000,
      new Map([
        ['events.a', 500],
        ['events.b', 30],
        ['events.c', 0],
      ]),
      0,
    );
    tracker.observe(
      20_000,
      new Map([
        ['events.a', 0],
        ['events.b', 0],
        ['events.c', 0],
      ]),
      0,
    );
    tracker.observe(
      21_000,
      new Map([
        ['events.a', 0],
        ['events.b', 0],
        ['events.c', 0],
      ]),
      0,
    );
    const byQueue = Object.fromEntries(tracker.result().map((d) => [d.queue, d]));
    expect(byQueue['events.a']).toEqual({
      queue: 'events.a',
      pendingAtPersist: 1000,
      peakPending: 1000,
      peakRetrying: 0,
      drainedAfterPersistMs: 20_000,
      eventsPerSecond: 50,
    });
    // events.b empezó en 0 pero el outbox aún tenía eventos por publicar: no está drenada hasta que se vacía
    expect(byQueue['events.b']).toMatchObject({
      pendingAtPersist: 0,
      peakPending: 30,
      drainedAfterPersistMs: 20_000,
    });
    expect(byQueue['events.b']!.eventsPerSecond).toBeNull();
    expect(byQueue['events.c']).toMatchObject({ pendingAtPersist: 50, drainedAfterPersistMs: 10_000 });
    expect(byQueue['outbox']).toMatchObject({ pendingAtPersist: 200, drainedAfterPersistMs: 10_000 });
  });

  it('[TC-PLATFORM-PIPELINE-031] una cola que vuelve a tener pendientes reinicia su tiempo y una que no llega a 0 queda en null', () => {
    const tracker = new DrainTracker();
    tracker.observe(
      0,
      new Map([
        ['events.a', 10],
        ['events.b', 10],
      ]),
      0,
    );
    tracker.observe(
      1000,
      new Map([
        ['events.a', 0],
        ['events.b', 5],
      ]),
      0,
    );
    tracker.observe(
      2000,
      new Map([
        ['events.a', 3],
        ['events.b', 5],
      ]),
      0,
    );
    tracker.observe(
      3000,
      new Map([
        ['events.a', 0],
        ['events.b', 5],
      ]),
      0,
    );
    const byQueue = Object.fromEntries(tracker.result().map((d) => [d.queue, d]));
    expect(byQueue['events.a']!.drainedAfterPersistMs).toBe(3000);
    expect(byQueue['events.b']!.drainedAfterPersistMs).toBeNull();
    expect(byQueue['events.b']!.eventsPerSecond).toBeNull();
  });
});

describe('reintentos en el drenado', () => {
  it('[TC-PLATFORM-PIPELINE-031] el pico de trabajos en reintento por cola queda en el drenado', () => {
    const tracker = new DrainTracker();
    tracker.observe(0, new Map([['events.a', 3]]), 0, new Map([['events.a', 1]]));
    tracker.observe(1000, new Map([['events.a', 2]]), 0, new Map([['events.a', 2]]));
    tracker.observe(2000, new Map([['events.a', 0]]), 0);
    const a = tracker.result().find((d) => d.queue === 'events.a');
    expect(a).toMatchObject({ peakRetrying: 2, drainedAfterPersistMs: 2000 });
    expect(tracker.result().find((d) => d.queue === 'outbox')?.peakRetrying).toBe(0);
  });
});
