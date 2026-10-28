import { loadavg } from 'node:os';
import { Client } from 'pg';
import type { IsolationPreparation } from './perf-report.js';

/**
 * Aislamiento del benchmark (investigate-perf-under-load, tarea 5.2; D291). Solo para el harness de pruebas y dentro
 * del mismo job: antes de la foto de inicio de cada suite `*.perf.ts`, (1) purga del backlog residual de la base
 * efímera (eventos pendientes del outbox y trabajos de las colas `events.*`) y (2) espera de quietud del host (carga de
 * 1 min bajo `HOST_LOAD_LIMIT`, sin consultas activas ajenas en la base) con un tope de espera. Si el host no se calma,
 * la suite falla con el veredicto `interferencia` (`isolationOf`). Las consultas de un cliente van SIEMPRE en serie.
 */

/** Carga de 1 min del host por debajo de la cual se considera en quietud (evidencia: carga 2,9–3,5 → p95 46–78 ms). */
export const HOST_LOAD_LIMIT = 3.0;
/** Tope de la espera de quietud. */
export const QUIET_MAX_WAIT_MS = 300_000;
/** Intervalo de muestreo de la espera. */
export const QUIET_SAMPLE_INTERVAL_MS = 10_000;
export const ISOLATION_APPLICATION = 'pf-perf-isolation';

/** Aplicaciones del propio harness: no cuentan como consultas ajenas. */
const OWN_APPLICATIONS = [ISOLATION_APPLICATION, 'pf-perf-background-load'];

export interface PurgeClient {
  query(sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

const UNDEFINED_TABLE = '42P01';

export interface PurgeResult {
  readonly outbox: number;
  readonly jobs: number;
}

/**
 * Marca como publicados los eventos pendientes del outbox y borra los trabajos pendientes (`created`, `retry`,
 * `active`) de las colas `events.*` (no las `.dlq`). Si `pgboss` aún no tiene tablas, no hay nada que purgar.
 */
export async function purgeBacklog(client: PurgeClient): Promise<PurgeResult> {
  if (process.env['PF_PERF_NO_PURGE'] === '1') return { outbox: 0, jobs: 0 }; // RAMA DE EXPERIMENTOS: reproduce E10
  const outbox = await client.query(
    'UPDATE platform.outbox SET published_at = clock_timestamp() WHERE published_at IS NULL',
  );
  let jobs = 0;
  try {
    const del = await client.query(
      `DELETE FROM pgboss.job
        WHERE name LIKE 'events.%' AND name NOT LIKE '%.dlq' AND state IN ('created', 'retry', 'active')`,
    );
    jobs = del.rowCount ?? 0;
  } catch (err) {
    if ((err as { code?: string }).code !== UNDEFINED_TABLE) throw err;
  }
  return { outbox: outbox.rowCount ?? 0, jobs };
}

/** Consultas en estado `active` de la base que no son del propio harness (los autovacuum no son `client backend`). */
export async function foreignActiveQueries(client: PurgeClient): Promise<number> {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n
       FROM pg_stat_activity
      WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()
        AND state = 'active'
        AND application_name NOT IN (${OWN_APPLICATIONS.map((a) => `'${a}'`).join(', ')})`,
  );
  return Number(rows[0]?.['n'] ?? 0);
}

export interface QuietProbe {
  hostLoad1m(): number;
  foreignActiveQueries(): Promise<number>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export interface QuietOptions {
  readonly loadLimit?: number;
  readonly maxWaitMs?: number;
  readonly intervalMs?: number;
}

export interface QuietOutcome {
  readonly quiet: boolean;
  readonly waitedMs: number;
  /** Última carga de 1 min muestreada. */
  readonly hostLoad1m: number;
  readonly foreignActiveQueries: number;
  readonly samples: number;
}

/**
 * Muestrea cada `intervalMs` hasta que la carga de 1 min sea menor que `loadLimit` y no haya consultas ajenas activas, o
 * hasta agotar `maxWaitMs` (la última muestra cae justo en el tope). Si ya hay quietud, no espera.
 */
export async function waitForQuiet(probe: QuietProbe, options: QuietOptions = {}): Promise<QuietOutcome> {
  const loadLimit = options.loadLimit ?? HOST_LOAD_LIMIT;
  const maxWaitMs = options.maxWaitMs ?? QUIET_MAX_WAIT_MS;
  const intervalMs = options.intervalMs ?? QUIET_SAMPLE_INTERVAL_MS;
  const startedAt = probe.now();
  let samples = 0;
  for (;;) {
    const hostLoad1m = probe.hostLoad1m();
    const foreign = await probe.foreignActiveQueries();
    samples += 1;
    const waitedMs = probe.now() - startedAt;
    const quiet = hostLoad1m < loadLimit && foreign === 0;
    if (quiet || waitedMs >= maxWaitMs) {
      return { quiet, waitedMs, hostLoad1m, foreignActiveQueries: foreign, samples };
    }
    await probe.sleep(Math.min(intervalMs, maxWaitMs - waitedMs));
  }
}

export interface PrepareDeps {
  readonly client: PurgeClient;
  readonly probe?: QuietProbe;
  readonly options?: QuietOptions;
  readonly log?: (message: string) => void;
}

/** Tablas que la purga deja con filas muertas: se vacían para que el autovacuum no compita con la suite. */
const VACUUM_TABLES = [
  ['platform.outbox', 'outbox'],
  ['pgboss.job', 'jobs'],
] as const;

/** Purga el backlog, vacía las tablas afectadas y espera la quietud del host. Nunca lanza por el VACUUM. */
export async function prepareIsolation(deps: PrepareDeps): Promise<IsolationPreparation> {
  const log = deps.log ?? (() => undefined);
  const purged = await purgeBacklog(deps.client);
  for (const [table, key] of VACUUM_TABLES) {
    if (purged[key] === 0) continue;
    try {
      await deps.client.query(`VACUUM (ANALYZE) ${table}`);
    } catch (err) {
      log(`no se pudo vaciar ${table} tras la purga: ${String(err)}`);
    }
  }
  const probe: QuietProbe = deps.probe ?? {
    hostLoad1m: () => loadavg()[0] ?? 0,
    foreignActiveQueries: () => foreignActiveQueries(deps.client),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
  };
  const quiet = await waitForQuiet(probe, deps.options);
  return {
    purgedOutbox: purged.outbox,
    purgedJobs: purged.jobs,
    quiet: quiet.quiet,
    waitedMs: quiet.waitedMs,
    hostLoad1m: quiet.hostLoad1m,
    hostLoadLimit: deps.options?.loadLimit ?? HOST_LOAD_LIMIT,
    foreignActiveQueries: quiet.foreignActiveQueries,
  };
}

/** Abre un cliente propio (superusuario, ignora RLS), prepara el aislamiento y lo cierra. */
export async function prepareIsolationFor(
  connectionString: string,
  log: (message: string) => void,
): Promise<IsolationPreparation> {
  const client = new Client({ connectionString, application_name: ISOLATION_APPLICATION });
  await client.connect();
  try {
    return await prepareIsolation({ client, log });
  } finally {
    await client.end().catch(() => undefined);
  }
}
