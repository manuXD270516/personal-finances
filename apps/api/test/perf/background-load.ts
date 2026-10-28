import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import {
  aggregateBackgroundLoad,
  isolationOf,
  replaceBackgroundLoadSection,
  summarizeSnapshot,
  type BackgroundLoadEntry,
  type BackgroundLoadSnapshot,
  type BackgroundLoadSummary,
  type IsolationPreparation,
  type PerfReport,
} from './perf-report.js';
import { prepareIsolationFor } from './isolation.js';

/**
 * Foto de la carga de fondo de la base y del host (investigate-perf-under-load, decisión 2). Cada suite `*.perf.ts` la
 * toma al empezar, antes de cada benchmark y al terminar, y la registra en `background-load.ndjson` (una línea por foto,
 * en el directorio del reporte). `nightly.perf.ts` la incluye en `perf-results.json` / `perf-summary.md` al escribir el
 * reporte y cada suite posterior (cuyo orden no está fijado) lo actualiza al terminar con `refreshReportFiles`.
 *
 * Las consultas de una foto van SIEMPRE en serie sobre un mismo cliente (nunca `Promise.all`): el harness lo vigila y
 * el cliente de pg las encola de todos modos.
 */

export const BACKGROUND_LOAD_LOG = 'background-load.ndjson';
const APPLICATION_NAME = 'pf-perf-background-load';

/** Directorio del reporte: `PF_PERF_OUT` o `reports/perf/` en la raíz del repo (el mismo que usa `nightly.perf.ts`). */
export function perfOutDir(): string {
  return process.env['PF_PERF_OUT'] ?? fileURLToPath(new URL('../../../../reports/perf/', import.meta.url));
}

/** `spendable.perf.ts` a partir de `import.meta.url` del archivo de la suite. */
export function suiteNameOf(metaUrl: string): string {
  return basename(metaUrl);
}

/** Lo mínimo que usa la foto de un cliente de pg (permite sustituirlo en los tests unitarios). */
export interface QueryClient {
  query(sql: string): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Tablas citadas en el design (H3): estado de vacuum/analyze y filas muertas. */
const CITED_TABLES = [
  ['pgboss', 'job'],
  ['platform', 'outbox'],
  ['platform', 'inbox'],
  ['ledger', 'posting'],
] as const;

const UNDEFINED_TABLE = '42P01';

/** Ejecuta la consulta; si la tabla aún no existe (p. ej. `pgboss` antes de la primera cola) devuelve `fallback`. */
async function safely(
  client: QueryClient,
  sql: string,
  fallback: Record<string, unknown>[] = [],
): Promise<Record<string, unknown>[]> {
  try {
    return (await client.query(sql)).rows;
  } catch (err) {
    if ((err as { code?: string }).code === UNDEFINED_TABLE) return fallback;
    throw err;
  }
}

const asNumber = (v: unknown): number => Number(v ?? 0);
const asIso = (v: unknown): string | null =>
  v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v);

export async function takeBackgroundLoad(client: QueryClient): Promise<BackgroundLoadSnapshot> {
  const takenAt = new Date().toISOString();
  const outbox = await safely(
    client,
    'SELECT count(*)::int AS n FROM platform.outbox WHERE published_at IS NULL',
  );
  const jobs = await safely(
    client,
    `SELECT name AS queue, state::text AS state, count(*)::int AS n
       FROM pgboss.job
      WHERE name LIKE 'events.%' AND name NOT LIKE '%.dlq' AND state IN ('created', 'retry', 'active')
      GROUP BY name, state
      ORDER BY name, state`,
  );
  const connections = await safely(
    client,
    `SELECT COALESCE(usename, '(sistema)') AS role,
            COALESCE(NULLIF(application_name, ''), '(sin nombre)') AS application,
            COALESCE(state, '(sin estado)') AS state,
            count(*)::int AS n
       FROM pg_stat_activity
      WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3`,
  );
  const locks = await safely(client, 'SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted');
  // `pgboss.job` está particionada por cola: se suman las particiones (`pg_inherits`) a la tabla padre.
  const tables = await safely(
    client,
    `WITH rels AS (
       SELECT c.oid, n.nspname || '.' || c.relname AS t
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE (n.nspname, c.relname) IN (${CITED_TABLES.map(([s, t]) => `('${s}', '${t}')`).join(', ')})
     ), members AS (
       SELECT oid AS member, t FROM rels
       UNION ALL
       SELECT i.inhrelid AS member, r.t FROM rels r JOIN pg_inherits i ON i.inhparent = r.oid
     )
     SELECT m.t AS "table",
            COALESCE(sum(s.n_live_tup), 0)::text AS live,
            COALESCE(sum(s.n_dead_tup), 0)::text AS dead,
            max(s.last_autovacuum) AS last_autovacuum,
            max(s.last_autoanalyze) AS last_autoanalyze
       FROM members m LEFT JOIN pg_stat_user_tables s ON s.relid = m.member
      GROUP BY m.t
      ORDER BY m.t`,
  );
  const cpu = process.cpuUsage();
  const [one = 0, five = 0, fifteen = 0] = loadavg();
  return {
    takenAt,
    outboxPending: asNumber(outbox[0]?.['n']),
    eventJobs: jobs.map((r) => ({
      queue: String(r['queue']),
      state: String(r['state']) as 'created' | 'retry' | 'active',
      count: asNumber(r['n']),
    })),
    connections: connections.map((r) => ({
      role: String(r['role']),
      application: String(r['application']),
      state: String(r['state']),
      count: asNumber(r['n']),
    })),
    ungrantedLocks: asNumber(locks[0]?.['n']),
    tables: tables.map((r) => ({
      table: String(r['table']),
      liveTuples: asNumber(r['live']),
      deadTuples: asNumber(r['dead']),
      lastAutovacuum: asIso(r['last_autovacuum']),
      lastAutoanalyze: asIso(r['last_autoanalyze']),
    })),
    loadAvg: [one, five, fifteen],
    processCpuMs: Math.round((cpu.user + cpu.system) / 1000),
  };
}

export function appendEntry(outDir: string, entry: BackgroundLoadEntry): void {
  mkdirSync(outDir, { recursive: true });
  appendFileSync(join(outDir, BACKGROUND_LOAD_LOG), `${JSON.stringify(entry)}\n`, 'utf8');
}

/** Líneas del registro en orden de escritura; ignora las que no son JSON (escritura interrumpida). */
export function readEntries(outDir: string): BackgroundLoadEntry[] {
  const file = join(outDir, BACKGROUND_LOAD_LOG);
  if (!existsSync(file)) return [];
  const entries: BackgroundLoadEntry[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      entries.push(JSON.parse(line) as BackgroundLoadEntry);
    } catch {
      // línea truncada: se ignora
    }
  }
  return entries;
}

/**
 * Actualiza `backgroundLoad` en `perf-results.json` y la sección entre marcadores de `perf-summary.md` con el registro
 * completo. Solo toca un reporte de ESTA corrida (mismo `runId`, o sin fotos al escribirse); devuelve si lo actualizó.
 */
export function refreshReportFiles(outDir: string): boolean {
  const jsonPath = join(outDir, 'perf-results.json');
  const mdPath = join(outDir, 'perf-summary.md');
  if (!existsSync(jsonPath) || !existsSync(mdPath)) return false;
  const report = JSON.parse(readFileSync(jsonPath, 'utf8')) as PerfReport;
  const loaded = aggregateBackgroundLoad(readEntries(outDir));
  const current = report.backgroundLoad;
  if (!current || (current.runId !== '' && current.runId !== loaded.runId)) return false;
  writeFileSync(jsonPath, `${JSON.stringify({ ...report, backgroundLoad: loaded }, null, 2)}\n`, 'utf8');
  writeFileSync(mdPath, replaceBackgroundLoadSection(readFileSync(mdPath, 'utf8'), loaded), 'utf8');
  return true;
}

/** La suite no puede empezar con carga de fondo ajena: falla con el veredicto `interferencia` y las cantidades medidas. */
export function assertIsolated(
  suite: string,
  snapshot: BackgroundLoadSnapshot,
  preparation?: IsolationPreparation,
): void {
  const isolation = isolationOf(snapshot, preparation);
  if (isolation.verdict === 'interferencia' && process.env['PF_PERF_NO_PURGE'] !== '1') {
    throw new Error(`[TC-PLATFORM-PIPELINE-026] ${suite} no puede medir: ${isolation.message}`);
  }
}

/** Toma y registra las fotos de una suite. Un fallo al observar nunca hace fallar el benchmark: se avisa por stderr. */
export class SuiteLoadRecorder {
  private runId = '';
  /** Resumen de la última foto tomada antes de un benchmark (para anotar sus resultados). */
  lastSummary: BackgroundLoadSummary | undefined;
  /** Última foto completa tomada (al empezar, antes de un benchmark o al terminar). */
  lastSnapshot: BackgroundLoadSnapshot | undefined;

  constructor(
    readonly suite: string,
    private readonly connectionString: string,
    private readonly outDir: string = perfOutDir(),
  ) {}

  private async observe(): Promise<BackgroundLoadSnapshot> {
    const client = new Client({
      connectionString: this.connectionString,
      application_name: APPLICATION_NAME,
    });
    await client.connect();
    try {
      if (this.runId === '') {
        const rows = (await client.query('SELECT pg_postmaster_start_time()::text AS run_id')).rows;
        this.runId = String(rows[0]?.['run_id'] ?? '');
      }
      return await takeBackgroundLoad(client);
    } finally {
      await client.end();
    }
  }

  private async record(
    phase: BackgroundLoadEntry['phase'],
    benchmark?: string,
    extra?: BackgroundLoadEntry['extra'],
    preparation?: IsolationPreparation,
  ): Promise<BackgroundLoadSnapshot | undefined> {
    try {
      const snapshot = await this.observe();
      appendEntry(this.outDir, {
        runId: this.runId,
        suite: this.suite,
        phase,
        ...(benchmark !== undefined ? { benchmark } : {}),
        snapshot,
        ...(extra ? { extra } : {}),
        ...(preparation ? { preparation } : {}),
      });
      this.lastSnapshot = snapshot;
      if (phase === 'benchmark') this.lastSummary = summarizeSnapshot(snapshot);
      return snapshot;
    } catch (err) {
      process.stderr.write(
        `[background-load] no se pudo tomar la foto (${phase}) de ${this.suite}: ${String(err)}\n`,
      );
      return undefined;
    }
  }

  start(preparation?: IsolationPreparation): Promise<BackgroundLoadSnapshot | undefined> {
    return this.record('start', undefined, undefined, preparation);
  }

  /**
   * Precondición de aislamiento (D291): purga el backlog residual, espera la quietud del host, toma la foto de inicio
   * (con la preparación registrada) y falla la suite con el veredicto `interferencia` si queda carga ajena. Un fallo al
   * preparar o al observar no hace fallar la suite por sí solo: se avisa por stderr y manda la foto.
   */
  async prepare(): Promise<void> {
    let preparation: IsolationPreparation | undefined;
    try {
      preparation = await prepareIsolationFor(this.connectionString, (m) =>
        process.stderr.write(`[isolation] ${this.suite}: ${m}\n`),
      );
      process.stderr.write(
        `[isolation] ${this.suite}: purgados ${String(preparation.purgedOutbox)} eventos del outbox y ${String(preparation.purgedJobs)} trabajos events.*; quietud ${String(preparation.quiet)} tras ${String(Math.round(preparation.waitedMs / 1000))} s (carga ${String(preparation.hostLoad1m)})\n`,
      );
    } catch (err) {
      process.stderr.write(
        `[isolation] no se pudo preparar el aislamiento de ${this.suite}: ${String(err)}\n`,
      );
    }
    const snapshot = await this.start(preparation);
    if (snapshot) assertIsolated(this.suite, snapshot, preparation);
  }

  /** Foto antes de un benchmark, con datos propios opcionales (p. ej. los trabajos de la cola del matcher). */
  benchmark(
    name: string,
    extra?: Readonly<Record<string, string | number>>,
  ): Promise<BackgroundLoadSnapshot | undefined> {
    return this.record('benchmark', name, extra);
  }

  async end(): Promise<void> {
    await this.record('end');
    try {
      refreshReportFiles(this.outDir);
    } catch (err) {
      process.stderr.write(`[background-load] no se pudo actualizar el reporte: ${String(err)}\n`);
    }
  }
}

/**
 * Registra los hooks de la foto de carga de fondo en una suite `*.perf.ts`: llámala en el nivel superior del archivo,
 * ANTES de sus propios `beforeAll`/`beforeEach`, para que la foto de inicio se tome antes de que la suite siembre nada
 * y la de cierre después de que cierre sus recursos (los hooks `after` corren en orden inverso).
 */
export function recordSuiteLoad(metaUrl: string, superuserUrl: string): SuiteLoadRecorder {
  const recorder = new SuiteLoadRecorder(suiteNameOf(metaUrl), superuserUrl);
  // Purga + espera de quietud (hasta 5 min) + foto de inicio; falla la suite si queda interferencia.
  beforeAll(async () => {
    await recorder.prepare();
  }, 900_000);
  beforeEach(async ({ task }) => {
    await recorder.benchmark(task.name);
  }, 120_000);
  afterAll(async () => {
    await recorder.end();
  }, 120_000);
  return recorder;
}
