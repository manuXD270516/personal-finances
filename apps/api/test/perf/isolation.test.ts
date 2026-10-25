import { describe, expect, it } from 'vitest';
import {
  foreignActiveQueries,
  HOST_LOAD_LIMIT,
  prepareIsolation,
  purgeBacklog,
  QUIET_MAX_WAIT_MS,
  QUIET_SAMPLE_INTERVAL_MS,
  waitForQuiet,
  type PurgeClient,
  type QuietProbe,
} from './isolation.js';

/** Sonda con reloj simulado: `sleep` avanza el tiempo y las cargas salen de la lista (la última se repite). */
function probeOf(loads: number[], foreign: number[] = [0]) {
  let t = 0;
  let i = 0;
  const sleeps: number[] = [];
  const probe: QuietProbe = {
    hostLoad1m: () => loads[Math.min(i, loads.length - 1)]!,
    foreignActiveQueries: () => {
      const n = foreign[Math.min(i, foreign.length - 1)]!;
      i += 1;
      return Promise.resolve(n);
    },
    sleep: (ms) => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
    now: () => t,
  };
  return { probe, sleeps };
}

describe('precondición de aislamiento: espera de quietud del host (investigate-perf-under-load 5.2, D291)', () => {
  it('[TC-PLATFORM-PIPELINE-024] los valores por defecto son carga 1 min < 3,0, tope de 5 min y muestreo cada 10 s', () => {
    expect([HOST_LOAD_LIMIT, QUIET_MAX_WAIT_MS, QUIET_SAMPLE_INTERVAL_MS]).toEqual([3.0, 300_000, 10_000]);
  });

  it('[TC-PLATFORM-PIPELINE-024] con el host ya en quietud no espera', async () => {
    const { probe, sleeps } = probeOf([0.4]);
    const out = await waitForQuiet(probe);
    expect(out).toMatchObject({ quiet: true, waitedMs: 0, hostLoad1m: 0.4, samples: 1 });
    expect(sleeps).toEqual([]);
  });

  it('[TC-PLATFORM-PIPELINE-024] con carga alta espera de a 10 s hasta que baja de 3,0', async () => {
    const { probe, sleeps } = probeOf([7.5, 5.1, 3.2, 2.9]);
    const out = await waitForQuiet(probe);
    expect(out).toMatchObject({ quiet: true, waitedMs: 30_000, hostLoad1m: 2.9, samples: 4 });
    expect(sleeps).toEqual([10_000, 10_000, 10_000]);
  });

  it('[TC-PLATFORM-PIPELINE-026] si la carga no baja en 5 min devuelve quiet=false con la carga medida', async () => {
    const { probe } = probeOf([7.96]);
    const out = await waitForQuiet(probe);
    expect(out).toMatchObject({ quiet: false, waitedMs: 300_000, hostLoad1m: 7.96, samples: 31 });
  });

  it('[TC-PLATFORM-PIPELINE-026] un tope que no es múltiplo del intervalo muestrea justo en el tope', async () => {
    const { probe, sleeps } = probeOf([9]);
    const out = await waitForQuiet(probe, { maxWaitMs: 25_000, intervalMs: 10_000 });
    expect(out.waitedMs).toBe(25_000);
    expect(sleeps).toEqual([10_000, 10_000, 5_000]);
  });

  it('[TC-PLATFORM-PIPELINE-026] una consulta ajena activa impide la quietud aunque la carga sea baja', async () => {
    const { probe } = probeOf([0.2], [3]);
    const out = await waitForQuiet(probe, { maxWaitMs: 20_000 });
    expect(out).toMatchObject({ quiet: false, foreignActiveQueries: 3, hostLoad1m: 0.2 });
  });

  it('[TC-PLATFORM-PIPELINE-024] la carga igual al límite no es quietud (estrictamente menor que 3,0)', async () => {
    const { probe } = probeOf([3.0]);
    expect((await waitForQuiet(probe, { maxWaitMs: 10_000 })).quiet).toBe(false);
  });
});

function recordingClient(
  handlers: { match: RegExp; result: { rowCount?: number; rows?: unknown[]; error?: object } }[],
) {
  const statements: string[] = [];
  const client: PurgeClient = {
    query: (sql) => {
      statements.push(sql);
      const h = handlers.find((x) => x.match.test(sql));
      if (h?.result.error) return Promise.reject(Object.assign(new Error('falla'), h.result.error));
      return Promise.resolve({
        rows: (h?.result.rows ?? []) as Record<string, unknown>[],
        rowCount: h?.result.rowCount ?? 0,
      });
    },
  };
  return { client, statements };
}

describe('purga del backlog residual (investigate-perf-under-load 5.2, D291)', () => {
  it('[TC-PLATFORM-PIPELINE-025] marca publicados los eventos pendientes y borra solo los trabajos pendientes de colas events.* (no las dlq)', async () => {
    const { client, statements } = recordingClient([
      { match: /UPDATE platform\.outbox/u, result: { rowCount: 470_165 } },
      { match: /DELETE FROM pgboss\.job/u, result: { rowCount: 1_390_000 } },
    ]);
    expect(await purgeBacklog(client)).toEqual({ outbox: 470_165, jobs: 1_390_000 });
    expect(statements[0]).toMatch(/SET published_at = clock_timestamp\(\) WHERE published_at IS NULL/u);
    expect(statements[1]).toMatch(/name LIKE 'events\.%' AND name NOT LIKE '%\.dlq'/u);
    expect(statements[1]).toMatch(/state IN \('created', 'retry', 'active'\)/u);
    expect(statements).toHaveLength(2);
  });

  it('[TC-PLATFORM-PIPELINE-024] sin tablas de pg-boss no hay nada que purgar; otro error se propaga', async () => {
    const missing = recordingClient([
      { match: /UPDATE platform\.outbox/u, result: { rowCount: 3 } },
      { match: /DELETE FROM pgboss\.job/u, result: { error: { code: '42P01' } } },
    ]);
    expect(await purgeBacklog(missing.client)).toEqual({ outbox: 3, jobs: 0 });
    const broken = recordingClient([
      { match: /DELETE FROM pgboss\.job/u, result: { error: { code: '57014' } } },
    ]);
    await expect(purgeBacklog(broken.client)).rejects.toThrow('falla');
  });

  it('[TC-PLATFORM-PIPELINE-024] las consultas ajenas excluyen la conexión propia y las aplicaciones del harness', async () => {
    const { client, statements } = recordingClient([
      { match: /pg_stat_activity/u, result: { rows: [{ n: 2 }] } },
    ]);
    expect(await foreignActiveQueries(client)).toBe(2);
    expect(statements[0]).toMatch(/pid <> pg_backend_pid\(\)/u);
    expect(statements[0]).toMatch(/state = 'active'/u);
    expect(statements[0]).toMatch(
      /application_name NOT IN \('pf-perf-isolation', 'pf-perf-background-load'\)/u,
    );
  });

  it('[TC-PLATFORM-PIPELINE-024] la preparación purga, vacía las tablas afectadas en serie y devuelve el registro para el reporte', async () => {
    const { client, statements } = recordingClient([
      { match: /UPDATE platform\.outbox/u, result: { rowCount: 10 } },
      { match: /DELETE FROM pgboss\.job/u, result: { rowCount: 20 } },
    ]);
    const { probe } = probeOf([1.0]);
    const prep = await prepareIsolation({ client, probe });
    expect(prep).toEqual({
      purgedOutbox: 10,
      purgedJobs: 20,
      quiet: true,
      waitedMs: 0,
      hostLoad1m: 1.0,
      hostLoadLimit: 3.0,
      foreignActiveQueries: 0,
    });
    expect(statements.slice(2)).toEqual(['VACUUM (ANALYZE) platform.outbox', 'VACUUM (ANALYZE) pgboss.job']);
  });

  it('[TC-PLATFORM-PIPELINE-024] sin nada que purgar no vacía; un fallo del VACUUM no hace fallar la preparación', async () => {
    const clean = recordingClient([]);
    await prepareIsolation({ client: clean.client, probe: probeOf([1]).probe });
    expect(clean.statements.some((s) => s.startsWith('VACUUM'))).toBe(false);
    const logs: string[] = [];
    const failing = recordingClient([
      { match: /UPDATE platform\.outbox/u, result: { rowCount: 1 } },
      { match: /^VACUUM/u, result: { error: { code: '25001' } } },
    ]);
    const prep = await prepareIsolation({
      client: failing.client,
      probe: probeOf([1]).probe,
      log: (m) => logs.push(m),
    });
    expect(prep.quiet).toBe(true);
    expect(logs[0]).toMatch(/no se pudo vaciar platform\.outbox/u);
  });

  it('[TC-PLATFORM-PIPELINE-026] con el host que no se calma la preparación lo registra con la carga medida y la suite lo verá como interferencia', async () => {
    const { client } = recordingClient([]);
    const prep = await prepareIsolation({
      client,
      probe: probeOf([7.96]).probe,
      options: { maxWaitMs: 30_000 },
    });
    expect(prep).toMatchObject({ quiet: false, hostLoad1m: 7.96, waitedMs: 30_000 });
  });
});
