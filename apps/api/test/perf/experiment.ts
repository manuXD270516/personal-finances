import { appendFileSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { parseExperiment, type ExperimentConfig } from './experiment-env.js';

/**
 * Instrumentación de la rama de experimentos de investigate-perf-under-load (tarea 3.1; NO se fusiona): purga del
 * backlog, `pg_stat_statements`, muestreo de locks/esperas/conexiones, EXPLAIN (ANALYZE, BUFFERS) de las consultas
 * reales de una petición y métricas por benchmark. Todo queda desactivado sin `PF_PERF_LABEL` (salvo los interruptores
 * de comportamiento, que se activan solos por su variable). Cada pieza es no fatal: un fallo al observar nunca hace
 * fallar el benchmark. Las consultas de cada cliente van SIEMPRE en serie.
 */
export const experiment: ExperimentConfig = parseExperiment(process.env);
export const experimentActive = experiment.label !== '';

export const METRICS_FILE = 'experiment-metrics.ndjson';
export const SAMPLES_FILE = 'experiment-samples.ndjson';
export const EXTRAS_FILE = 'experiment-extras.md';
export const BLOCK_FILE = 'experiment-block.md';

export function experimentOutDir(): string {
  return process.env['PF_PERF_OUT'] ?? fileURLToPath(new URL('../../../../reports/perf/', import.meta.url));
}

const warn = (what: string, err: unknown): void => {
  process.stderr.write(`[experiment] ${what}: ${String(err)}\n`);
};

/** Borra los archivos de la corrida anterior (una corrida local repetida no mezcla resultados). */
export function resetExperimentFiles(outDir: string = experimentOutDir()): void {
  mkdirSync(outDir, { recursive: true });
  for (const f of [METRICS_FILE, SAMPLES_FILE, EXTRAS_FILE, BLOCK_FILE])
    rmSync(join(outDir, f), { force: true });
}

function append(file: string, text: string): void {
  const dir = experimentOutDir();
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, file), text, 'utf8');
}

// ---------------------------------------------------------------------------------------------------------------------
// Purga del backlog residual (E3, PF_PERF_PURGE_BACKLOG=1): outbox sin publicar y colas `events.*` de la base efímera.
// ---------------------------------------------------------------------------------------------------------------------

export interface PurgeResult {
  readonly outbox: number;
  readonly jobs: number;
}

export async function purgeBacklog(superuserUrl: string, suite: string): Promise<PurgeResult | undefined> {
  const client = new pg.Client({ connectionString: superuserUrl, application_name: 'pf-perf-purge' });
  try {
    await client.connect();
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
      if ((err as { code?: string }).code !== '42P01') throw err; // pg-boss aún sin tablas: nada que purgar
    }
    const result = { outbox: outbox.rowCount ?? 0, jobs };
    append(
      METRICS_FILE,
      `${JSON.stringify({ kind: 'purge', suite, at: new Date().toISOString(), ...result })}\n`,
    );
    process.stderr.write(
      `[experiment] purga del backlog antes de ${suite}: ${String(result.outbox)} eventos del outbox y ${String(result.jobs)} trabajos de colas events.*\n`,
    );
    return result;
  } catch (err) {
    warn(`no se pudo purgar el backlog antes de ${suite}`, err);
    return undefined;
  } finally {
    await client.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Métricas por benchmark
// ---------------------------------------------------------------------------------------------------------------------

export interface MetricRecord {
  readonly kind: 'metric';
  readonly suite: string;
  readonly name: string;
  readonly unit: 'ms' | 'ev/s' | 'ratio' | 's';
  /** Valor comparado con el umbral (p95 en ms, ev/s...). */
  readonly value: number;
  readonly limit?: number;
  readonly p50?: number;
  readonly p95?: number;
  readonly n?: number;
  readonly note?: string;
}

export function recordMetric(m: Omit<MetricRecord, 'kind'>): void {
  if (!experimentActive) return;
  try {
    append(METRICS_FILE, `${JSON.stringify({ kind: 'metric', ...m })}\n`);
  } catch (err) {
    warn('no se pudo registrar la métrica', err);
  }
}

/** Mediana real de una muestra (promedio de los dos centrales en muestras pares). */
export function medianOf(samples: readonly number[]): number {
  const s = [...samples].sort((a, b) => a - b);
  if (s.length === 0) return Number.NaN;
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// ---------------------------------------------------------------------------------------------------------------------
// pg_stat_statements: reinicio al empezar una ventana y volcado de las 20 consultas más costosas al terminarla.
// ---------------------------------------------------------------------------------------------------------------------

export async function resetStatements(superuserUrl: string): Promise<void> {
  if (!experimentActive) return;
  const client = new pg.Client({ connectionString: superuserUrl, application_name: 'pf-perf-stats' });
  try {
    await client.connect();
    await client.query('SELECT pg_stat_statements_reset()');
  } catch (err) {
    warn('no se pudo reiniciar pg_stat_statements', err);
  } finally {
    await client.end().catch(() => undefined);
  }
}

const oneLine = (sql: string, max = 240): string => {
  const flat = sql.replace(/\s+/gu, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

const cell = (s: string): string => s.replace(/\|/gu, '\\|');

export async function dumpTopStatements(superuserUrl: string, window: string, limit = 20): Promise<void> {
  if (!experimentActive) return;
  const client = new pg.Client({ connectionString: superuserUrl, application_name: 'pf-perf-stats' });
  try {
    await client.connect();
    const { rows } = await client.query(
      `SELECT query, calls::text AS calls, round(total_exec_time::numeric, 1)::text AS total_ms,
              round(mean_exec_time::numeric, 3)::text AS mean_ms, round(max_exec_time::numeric, 1)::text AS max_ms,
              rows::text AS rows, shared_blks_hit::text AS hit, shared_blks_read::text AS read,
              round(COALESCE(shared_blk_read_time, 0)::numeric, 1)::text AS read_ms
         FROM pg_stat_statements
        WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND query NOT LIKE '%pg_stat_statements%' AND query NOT LIKE '%pg_stat_activity%'
        ORDER BY total_exec_time DESC
        LIMIT $1`,
      [limit],
    );
    const lines = [
      `### pg_stat_statements: ${window} (top ${String(limit)} por tiempo total)`,
      '',
      '| # | llamadas | total ms | media ms | máx ms | filas | bloques hit | bloques read | read ms | consulta |',
      '|---|---|---|---|---|---|---|---|---|---|',
      ...rows.map(
        (r, i) =>
          `| ${String(i + 1)} | ${r.calls} | ${r.total_ms} | ${r.mean_ms} | ${r.max_ms} | ${r.rows} | ${r.hit} | ${r.read} | ${r.read_ms} | \`${cell(oneLine(String(r.query)))}\` |`,
      ),
      '',
    ];
    append(EXTRAS_FILE, `${lines.join('\n')}\n`);
  } catch (err) {
    warn(`no se pudo volcar pg_stat_statements (${window})`, err);
  } finally {
    await client.end().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Muestreo de locks, esperas y conexiones durante una ventana (cada segundo, en serie sobre un mismo cliente).
// ---------------------------------------------------------------------------------------------------------------------

export interface SampleRecord {
  readonly kind: 'sample';
  readonly tag: string;
  readonly at: string;
  readonly maxConnections: number;
  readonly connections: readonly { role: string; application: string; state: string; n: number }[];
  /** Backends de cliente no inactivos con su evento de espera (`wait_event_type` / `wait_event`). */
  readonly active: readonly { state: string; waitType: string; waitEvent: string; n: number }[];
  /** Locks no concedidos por tipo, modo y relación. */
  readonly ungranted: readonly { locktype: string; mode: string; relation: string; n: number }[];
  readonly loadAvg1m: number;
}

const str = (v: unknown, fallback: string): string => (v === null || v === undefined ? fallback : String(v));

export async function takeSample(client: pg.Client, tag: string): Promise<SampleRecord> {
  const conns = await client.query(
    `SELECT COALESCE(usename, '(sistema)') AS role, COALESCE(NULLIF(application_name, ''), '(sin nombre)') AS app,
            COALESCE(state, '(sin estado)') AS state, count(*)::int AS n
       FROM pg_stat_activity
      WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()
      GROUP BY 1, 2, 3 ORDER BY 1, 2, 3`,
  );
  const active = await client.query(
    `SELECT COALESCE(state, '(sin estado)') AS state, COALESCE(wait_event_type, '-') AS wtype,
            COALESCE(wait_event, '-') AS wevent, count(*)::int AS n
       FROM pg_stat_activity
      WHERE datname = current_database() AND backend_type = 'client backend' AND pid <> pg_backend_pid()
        AND state IS DISTINCT FROM 'idle'
      GROUP BY 1, 2, 3 ORDER BY 4 DESC`,
  );
  const locks = await client.query(
    `SELECT locktype, mode, COALESCE(relation::regclass::text, '-') AS relation, count(*)::int AS n
       FROM pg_locks WHERE NOT granted GROUP BY 1, 2, 3 ORDER BY 4 DESC`,
  );
  const max = await client.query(`SELECT current_setting('max_connections')::int AS n`);
  return {
    kind: 'sample',
    tag,
    at: new Date().toISOString(),
    maxConnections: Number(max.rows[0]?.n ?? 0),
    connections: conns.rows.map((r) => ({
      role: str(r.role, ''),
      application: str(r.app, ''),
      state: str(r.state, ''),
      n: Number(r.n),
    })),
    active: active.rows.map((r) => ({
      state: str(r.state, ''),
      waitType: str(r.wtype, '-'),
      waitEvent: str(r.wevent, '-'),
      n: Number(r.n),
    })),
    ungranted: locks.rows.map((r) => ({
      locktype: str(r.locktype, ''),
      mode: str(r.mode, ''),
      relation: str(r.relation, '-'),
      n: Number(r.n),
    })),
    loadAvg1m: Math.round((loadavg()[0] ?? 0) * 100) / 100,
  };
}

/** Empieza a muestrear cada `intervalMs` (1 s); devuelve la función que detiene el muestreo. Sin etiqueta no hace nada. */
export function startSampler(superuserUrl: string, tag: string, intervalMs = 1000): () => Promise<void> {
  if (!experimentActive) return async () => undefined;
  let stopped = false;
  const client = new pg.Client({ connectionString: superuserUrl, application_name: 'pf-perf-sampler' });
  const loop = (async () => {
    try {
      await client.connect();
      while (!stopped) {
        append(SAMPLES_FILE, `${JSON.stringify(await takeSample(client, tag))}\n`);
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    } catch (err) {
      warn(`el muestreo "${tag}" se interrumpió`, err);
    } finally {
      await client.end().catch(() => undefined);
    }
  })();
  return async () => {
    stopped = true;
    await loop;
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// EXPLAIN (ANALYZE, BUFFERS) de las consultas REALES de una petición: se capturan (texto y parámetros) las sentencias que
// la API en proceso envía por `pg.Client.query` durante `fn` y se repiten con EXPLAIN en una transacción con rol pf_app
// que se revierte siempre. Las sentencias de contexto (`set_config`, `SET`) se ejecutan tal cual; las demás SELECT/WITH
// se explican; el resto (DML) se omite. Si el `pg` del proceso de pruebas no es el de la API, no captura nada y lo dice.
// ---------------------------------------------------------------------------------------------------------------------

interface CapturedStatement {
  readonly client: number;
  readonly text: string;
  readonly values: readonly unknown[];
}

type QueryFn = (this: unknown, ...args: unknown[]) => unknown;

export async function captureStatements<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; statements: CapturedStatement[] }> {
  const proto = pg.Client.prototype as unknown as { query: QueryFn };
  const original = proto.query;
  const ids = new WeakMap<object, number>();
  const statements: CapturedStatement[] = [];
  let nextId = 0;
  proto.query = function patched(this: unknown, ...args: unknown[]): unknown {
    try {
      const first = args[0];
      const text = typeof first === 'string' ? first : (first as { text?: unknown } | null)?.text;
      if (typeof text === 'string') {
        const valuesArg = typeof first === 'string' ? args[1] : (first as { values?: unknown }).values;
        const owner = this as object;
        if (!ids.has(owner)) ids.set(owner, (nextId += 1));
        statements.push({
          client: ids.get(owner)!,
          text,
          values: Array.isArray(valuesArg) ? (valuesArg as unknown[]) : [],
        });
      }
    } catch {
      // la captura nunca interfiere con la consulta
    }
    return original.apply(this, args);
  };
  try {
    const result = await fn();
    return { result, statements };
  } finally {
    proto.query = original;
  }
}

const CONTEXT_STATEMENT = /^\s*(select\s+set_config|set\s)/iu;
const EXPLAINABLE = /^\s*(select|with)\b/iu;
const TX_CONTROL = /^\s*(begin|commit|rollback|savepoint|release)\b/iu;

export async function explainCaptured(
  appUrl: string,
  title: string,
  statements: readonly CapturedStatement[],
): Promise<void> {
  if (!experimentActive) return;
  const lines = [`### EXPLAIN (ANALYZE, BUFFERS): ${title}`, ''];
  if (statements.length === 0) {
    lines.push('Sin consultas capturadas (el `pg` del proceso de pruebas no es el de la API).', '');
    append(EXTRAS_FILE, `${lines.join('\n')}\n`);
    return;
  }
  const byClient = new Map<number, CapturedStatement[]>();
  for (const s of statements) byClient.set(s.client, [...(byClient.get(s.client) ?? []), s]);
  const client = new pg.Client({ connectionString: appUrl, application_name: 'pf-perf-explain' });
  try {
    await client.connect();
    let n = 0;
    for (const [id, list] of byClient) {
      await client.query('BEGIN');
      try {
        for (const s of list) {
          if (TX_CONTROL.test(s.text) || /\bpgboss\./u.test(s.text)) continue;
          if (CONTEXT_STATEMENT.test(s.text)) {
            await client.query({ text: s.text, values: [...s.values] });
            continue;
          }
          if (!EXPLAINABLE.test(s.text)) continue;
          n += 1;
          lines.push(
            `#### Consulta ${String(n)} (conexión ${String(id)})`,
            '',
            '```sql',
            oneLine(s.text, 1200),
            '```',
            `parámetros: ${oneLine(JSON.stringify(s.values), 300)}`,
            '',
            '```',
          );
          try {
            const plan = await client.query({
              text: `EXPLAIN (ANALYZE, BUFFERS, SETTINGS) ${s.text}`,
              values: [...s.values],
            });
            lines.push(plan.rows.map((r) => String(r['QUERY PLAN'])).join('\n'));
          } catch (err) {
            lines.push(`no se pudo explicar: ${String(err)}`);
          }
          lines.push('```', '');
        }
      } finally {
        await client.query('ROLLBACK').catch(() => undefined);
      }
    }
  } catch (err) {
    lines.push(`no se pudo conectar para explicar: ${String(err)}`, '');
  } finally {
    await client.end().catch(() => undefined);
  }
  append(EXTRAS_FILE, `${lines.join('\n')}\n`);
}

// ---------------------------------------------------------------------------------------------------------------------
// Lectura de los archivos (para el bloque PERF-EXPERIMENT y los tests).
// ---------------------------------------------------------------------------------------------------------------------

export function readNdjson<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const out: T[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      // línea truncada
    }
  }
  return out;
}

export function writeText(file: string, text: string): void {
  mkdirSync(experimentOutDir(), { recursive: true });
  writeFileSync(join(experimentOutDir(), file), text, 'utf8');
}
