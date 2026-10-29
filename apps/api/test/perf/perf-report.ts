import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Umbrales de rendimiento de Phase 1 tomados de docs/02-non-functional-requirements.md (§PERF) y de add-ledger-core
 * 5.5 (overhead de RLS). `perf-report.test.ts` verifica que docs/02 sigue declarando exactamente estos valores: si el
 * NFR cambia, el test falla hasta actualizar esta tabla.
 */
export const PERF_THRESHOLDS = {
  /** NFR-PERF-001: listado paginado (limit 50, filtros) con ≥ 50 000 transacciones; local ≤ 300 ms (cloud ≤ 200). */
  'NFR-PERF-001': { metric: 'p95', limitMs: 300, cloudLimitMs: 200, docText: 'local ≤ 300 ms p95' },
  /** NFR-PERF-002: búsqueda de texto en transacciones (`q`, limit 50) con ≥ 50 000 transacciones (add-dependency-updates 4.1). */
  'NFR-PERF-002': { metric: 'p95', limitMs: 400, docText: 'p95 ≤ 400 ms' },
  /** NFR-PERF-003: comandos de escritura (posting + audit + outbox). */
  'NFR-PERF-003': { metric: 'p95', limitMs: 150, docText: 'p95 ≤ **150 ms** server time' },
  /** NFR-PERF-004: API del dashboard (Home) `GET /reports/summary`. */
  'NFR-PERF-004': { metric: 'p95', limitMs: 300, docText: 'API de dashboard p95 ≤ **300 ms**' },
  /** NFR-PERF-006: reportes agregados (add-net-worth-evolution: evolución del patrimonio, 24 meses, dataset `large`). */
  'NFR-PERF-006': { metric: 'p95', limitMs: 800, docText: 'p95 ≤ 800 ms' },
  /** NFR-PERF-005: saldo de cuenta as-of con snapshots: por cuenta ≤ 50 ms; todas las cuentas ≤ 150 ms. */
  'NFR-PERF-005': {
    metric: 'p95',
    limitMs: 50,
    allAccountsLimitMs: 150,
    docText: 'p95 ≤ 50 ms por cuenta; ≤ 150 ms para todas las cuentas del workspace',
  },
} as const;

/**
 * NFR-PERF-008 / improve-event-throughput (docs/33 D112): cada consumidor drena ≥ 42 eventos/s sostenidos (backlog de
 * 5 000 eventos en ≤ 120 s con un handler trivial, TC-PLATFORM-EVENTS-014). Con los consumidores reales sobre el dataset
 * `large` el valor se mide y se reporta (informativo): el costo por evento depende de cada handler.
 */
export const PERF_THROUGHPUT = { minEventsPerSecond: 42, docText: '≥ 42 eventos/s por consumidor' } as const;

/**
 * add-ledger-core 5.5 (criterio docs/31 D43) y fix-nightly-pipeline (decisión 4): overhead de RLS < 10 % (EXPLAIN
 * ANALYZE) medido sobre las consultas REALES de la aplicación (las sentencias que emite `PgBalanceQuery`, con sus
 * parámetros) y las de índice; el agregado sintético de todo el workspace se reporta como informativo (no falla).
 *
 * Una brecha de tiempo debe estar DEMOSTRADA, no solo observada: 200 pares intercalados (con y sin RLS), diferencia por
 * par, mediana y un IC del 95 % por bootstrap de percentiles (2 000 remuestreos, semilla fija). Es brecha si el límite
 * inferior del IC alcanza a la vez el 10 % de la mediana sin RLS y `noiseFloorMs`, o si la política cambia el método de
 * acceso o el índice del plan.
 */
export const RLS_OVERHEAD = {
  maxRatio: 0.1,
  noiseFloorMs: 0.5,
  warmupPairs: 20,
  pairs: 200,
  bootstrapResamples: 2000,
  bootstrapSeed: 0x5eed,
} as const;

/**
 * Tablas que consulta la POLÍTICA de RLS (`platform.current_workspace_id()` y la pertenencia al workspace). Sus nodos
 * aparecen solo en el plan con RLS y son inherentes a ella: no cuentan como un cambio de acceso a los datos.
 */
export const RLS_POLICY_TABLES: readonly string[] = ['iam.workspace', 'iam.workspace_membership'];

/** Reconoce la tabla con o sin esquema: `EXPLAIN (FORMAT JSON)` sin `VERBOSE` nombra `workspace`, no `iam.workspace`. */
const isPolicyTable = (table: string): boolean =>
  RLS_POLICY_TABLES.some((t) => t === table || t.slice(t.indexOf('.') + 1) === table);

const SIGNATURE_SEPARATOR = ' → ';

/**
 * Firma de acceso de una sentencia sin los nodos de las tablas de la política. Cada nodo es
 * `<método> on <esquema.tabla> (<índice>)`; los nodos sin `on <tabla>` se conservan.
 */
export function dataAccessSignature(signature: string): string {
  return signature
    .split(SIGNATURE_SEPARATOR)
    .filter((node) => {
      const table = / on ([\w.]+)/u.exec(node)?.[1];
      return table === undefined || !isPolicyTable(table);
    })
    .join(SIGNATURE_SEPARATOR);
}

export type NfrId = keyof typeof PERF_THRESHOLDS | 'RLS-OVERHEAD' | 'NFR-PERF-008';

export interface LatencyStats {
  readonly n: number;
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly mean: number;
}

/** Percentil por rango más cercano (nearest-rank) sobre una muestra ordenada. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) throw new RangeError('muestra vacía');
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

export function stats(samples: readonly number[]): LatencyStats {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    n: sorted.length,
    min: round(sorted[0]!),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted.at(-1)!),
    mean: round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
  };
}

export type RlsVerdict =
  | 'OK'
  | 'no demostrada sobre el piso absoluto'
  | 'no demostrada sobre el 10 %'
  | 'brecha demostrada'
  | 'plan distinto';

export interface BenchResult {
  readonly id: string;
  readonly nfr: NfrId;
  readonly title: string;
  readonly stats: LatencyStats;
  /** Valor comparado contra el umbral (p95 en ms, o ratio para RLS). */
  readonly value: number;
  readonly limit: number;
  readonly unit: 'ms' | 'ratio' | 'ev/s';
  readonly gate: boolean;
  readonly passed: boolean;
  readonly notes?: string;
  /** Solo filas de RLS: IC del 95 % (ms) de la mediana de la diferencia por par (con − sin RLS). */
  readonly ci95Ms?: readonly [number, number];
  /** Solo filas de RLS: pares de ejecuciones intercaladas medidos. */
  readonly pairs?: number;
  /** Solo filas de RLS: motivo del veredicto. */
  readonly verdict?: RlsVerdict;
  /**
   * investigate-perf-under-load: `false` si la suite empezó con carga de fondo ajena (veredicto `interferencia`); la
   * medición no es válida y no se compara con su umbral. Ausente = válida.
   */
  readonly valid?: boolean;
  /** Mensaje de la interferencia medida (solo con `valid === false`). */
  readonly interference?: string;
  /** Carga de fondo (resumen de la foto) antes de este benchmark. Aditivo. */
  readonly backgroundLoad?: BackgroundLoadSummary;
}

/** Trabajos pendientes de una cola de consumidor (`events.<consumidor>`) en un estado de pg-boss. */
export interface EventJobCount {
  readonly queue: string;
  readonly state: 'created' | 'retry' | 'active';
  readonly count: number;
}

/** Conexiones de `pg_stat_activity` por rol, aplicación y estado. */
export interface ConnectionCount {
  readonly role: string;
  readonly application: string;
  readonly state: string;
  readonly count: number;
}

/** Estado de una tabla citada en el design de investigate-perf-under-load (H3) según `pg_stat_user_tables`. */
export interface TableStat {
  readonly table: string;
  readonly liveTuples: number;
  readonly deadTuples: number;
  readonly lastAutovacuum: string | null;
  readonly lastAutoanalyze: string | null;
}

/**
 * Foto de la carga de fondo de la base y del host (investigate-perf-under-load, decisión 2): lo que hay en marcha
 * mientras un benchmark mide. La toma `background-load.ts`; aquí solo se agrega y se formatea.
 */
export interface BackgroundLoadSnapshot {
  readonly takenAt: string;
  /** Eventos con `published_at IS NULL` en `platform.outbox`. */
  readonly outboxPending: number;
  readonly eventJobs: readonly EventJobCount[];
  readonly connections: readonly ConnectionCount[];
  /** Locks de `pg_locks` con `granted = false`. */
  readonly ungrantedLocks: number;
  readonly tables: readonly TableStat[];
  /** `os.loadavg()`: 1, 5 y 15 minutos. */
  readonly loadAvg: readonly [number, number, number];
  /** CPU consumida por el proceso de Vitest hasta ahora (usuario + sistema, ms). */
  readonly processCpuMs: number;
}

/** Resumen compacto de una foto, el que lleva cada resultado en `perf-results.json`. */
export interface BackgroundLoadSummary {
  readonly takenAt: string;
  readonly outboxPending: number;
  /** Total de trabajos pendientes en colas `events.*`. */
  readonly eventJobs: number;
  /** Total de conexiones activas a la base. */
  readonly connections: number;
  readonly ungrantedLocks: number;
  readonly loadAvg1m: number;
}

export type IsolationVerdict = 'limpia' | 'interferencia';

/**
 * Preparación del aislamiento de una suite (D291): lo que hizo el harness antes de su foto de inicio. Purga del backlog
 * residual, espera de quietud del host (carga de 1 min bajo `hostLoadLimit`) y consultas activas ajenas en la base.
 */
export interface IsolationPreparation {
  readonly purgedOutbox: number;
  readonly purgedJobs: number;
  /** `true` si el host quedó en quietud (carga bajo el límite y sin consultas ajenas) dentro del tope de espera. */
  readonly quiet: boolean;
  readonly waitedMs: number;
  /** Carga de 1 min medida en la última muestra de la espera. */
  readonly hostLoad1m: number;
  readonly hostLoadLimit: number;
  readonly foreignActiveQueries: number;
}

/** Veredicto de aislamiento de una suite al empezar. */
export interface Isolation {
  readonly verdict: IsolationVerdict;
  readonly outboxPending: number;
  readonly eventJobs: number;
  readonly message: string;
  /** Solo con preparación: carga del host y datos de la purga y la espera. */
  readonly preparation?: IsolationPreparation;
}

/** Línea del registro `background-load.ndjson` que escribe cada suite (una por foto). */
export interface BackgroundLoadEntry {
  /** Identifica la corrida (arranque del PostgreSQL del contenedor): descarta restos de corridas anteriores. */
  readonly runId: string;
  readonly suite: string;
  readonly phase: 'start' | 'benchmark' | 'end';
  readonly benchmark?: string;
  readonly snapshot: BackgroundLoadSnapshot;
  /** Datos propios del benchmark (p. ej. los trabajos de la cola del matcher antes de la ráfaga). */
  readonly extra?: Readonly<Record<string, string | number>>;
  /** Solo en la foto de inicio: purga y espera de quietud previas (D291). */
  readonly preparation?: IsolationPreparation;
}

export interface BenchmarkBackgroundLoad {
  readonly benchmark: string;
  readonly snapshot: BackgroundLoadSnapshot;
  readonly extra?: Readonly<Record<string, string | number>>;
}

export interface SuiteBackgroundLoad {
  readonly suite: string;
  /** Posición real de la suite en la corrida (1 = la primera en arrancar). */
  readonly order: number;
  readonly start: BackgroundLoadSnapshot;
  readonly isolation: Isolation;
  readonly benchmarks: readonly BenchmarkBackgroundLoad[];
  readonly end?: BackgroundLoadSnapshot;
}

export interface BackgroundLoadReport {
  readonly runId: string;
  /** Archivos `*.perf.ts` en el orden real en que arrancaron. */
  readonly fileOrder: readonly string[];
  readonly suites: readonly SuiteBackgroundLoad[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/** Trabajos pendientes (todos los estados) de una cola `events.*`. */
export function jobsOfQueue(snapshot: BackgroundLoadSnapshot, queue: string): number {
  return sum(snapshot.eventJobs.filter((j) => j.queue === queue).map((j) => j.count));
}

/**
 * Aislamiento de una suite al empezar (D291): no debe haber eventos pendientes de publicar ni trabajos de colas
 * `events.*` que provengan de una carga o de una suite anterior, y, si hubo preparación, el host debe haber quedado en
 * quietud (carga de 1 min bajo el límite y sin consultas activas ajenas) dentro del tope de espera. La suite aún no hizo
 * nada, así que todo lo que la foto muestra es ajeno.
 */
export function isolationOf(snapshot: BackgroundLoadSnapshot, preparation?: IsolationPreparation): Isolation {
  const outboxPending = snapshot.outboxPending;
  const eventJobs = sum(snapshot.eventJobs.map((j) => j.count));
  const reasons: string[] = [];
  if (outboxPending > 0 || eventJobs > 0) {
    const queues = [...new Set(snapshot.eventJobs.filter((j) => j.count > 0).map((j) => j.queue))];
    reasons.push(
      `${outboxPending} eventos pendientes de publicar; ${eventJobs} trabajos de colas events.* ajenos${
        queues.length > 0 ? `: ${queues.join(', ')}` : ''
      }`,
    );
  }
  if (preparation && !preparation.quiet) {
    const parts: string[] = [];
    if (preparation.hostLoad1m >= preparation.hostLoadLimit) {
      parts.push(
        `carga del host ${round2(preparation.hostLoad1m)} (1 min) sin bajar de ${preparation.hostLoadLimit} tras esperar ${Math.round(preparation.waitedMs / 1000)} s`,
      );
    }
    if (preparation.foreignActiveQueries > 0) {
      parts.push(`${preparation.foreignActiveQueries} consultas activas ajenas en la base`);
    }
    reasons.push(parts.length > 0 ? `host sin quietud: ${parts.join('; ')}` : 'host sin quietud');
  }
  const base = { outboxPending, eventJobs, ...(preparation ? { preparation } : {}) };
  if (reasons.length === 0) {
    return { verdict: 'limpia', ...base, message: 'sin carga de fondo ajena' };
  }
  return { verdict: 'interferencia', ...base, message: `interferencia (${reasons.join('; ')})` };
}

export function summarizeSnapshot(snapshot: BackgroundLoadSnapshot): BackgroundLoadSummary {
  return {
    takenAt: snapshot.takenAt,
    outboxPending: snapshot.outboxPending,
    eventJobs: sum(snapshot.eventJobs.map((j) => j.count)),
    connections: sum(snapshot.connections.map((c) => c.count)),
    ungrantedLocks: snapshot.ungrantedLocks,
    loadAvg1m: round2(snapshot.loadAvg[0]),
  };
}

/**
 * Una suite que empieza con carga de fondo ajena no publica su medición como válida (TC-PLATFORM-PIPELINE-026): el
 * resultado queda `valid: false` y `passed: false`, sin compararlo con su umbral, y el reporte lo cuenta como brecha.
 * Con el aislamiento limpio devuelve el mismo resultado.
 */
export function applyInterference(result: BenchResult, isolation: Isolation): BenchResult {
  if (isolation.verdict === 'limpia') return result;
  return {
    ...result,
    valid: false,
    passed: false,
    interference: isolation.message,
    notes: `medición no válida: ${isolation.message}; el valor ${result.value} no se compara con el umbral${
      result.notes ? `; ${result.notes}` : ''
    }`,
  };
}

/**
 * Throughput de una ráfaga con solo los eventos de la ráfaga: del primer al último evento procesado (mínimo 1 s, como
 * `throughputResult`). El tiempo de espera detrás de un backlog ajeno no cuenta.
 */
export function burstWindow(input: { events: number; firstProcessedAt: Date; lastProcessedAt: Date }): {
  seconds: number;
  eventsPerSecond: number;
} {
  const raw = (input.lastProcessedAt.getTime() - input.firstProcessedAt.getTime()) / 1000;
  const seconds = Math.max(1, Math.round(raw * 10) / 10);
  return { seconds, eventsPerSecond: round2(input.events / seconds) };
}

/**
 * Agrupa el registro de fotos por suite, en el orden real de arranque. Solo cuenta la última corrida del registro
 * (`runId` de la última línea): un `reports/perf/` reutilizado no mezcla corridas.
 */
export function aggregateBackgroundLoad(entries: readonly BackgroundLoadEntry[]): BackgroundLoadReport {
  const runId = entries.at(-1)?.runId ?? '';
  const bySuite = new Map<string, BackgroundLoadEntry[]>();
  for (const e of entries.filter((x) => x.runId === runId)) {
    bySuite.set(e.suite, [...(bySuite.get(e.suite) ?? []), e]);
  }
  const suites = [...bySuite.entries()].map(([suite, list]) => {
    const startEntry = list.find((e) => e.phase === 'start') ?? list[0]!;
    const end = [...list].reverse().find((e) => e.phase === 'end');
    return {
      suite,
      start: startEntry.snapshot,
      isolation: isolationOf(startEntry.snapshot, startEntry.preparation),
      benchmarks: list
        .filter((e) => e.phase === 'benchmark')
        .map((e) => ({
          benchmark: e.benchmark ?? '(sin nombre)',
          snapshot: e.snapshot,
          ...(e.extra ? { extra: e.extra } : {}),
        })),
      ...(end ? { end: end.snapshot } : {}),
    };
  });
  suites.sort((a, b) => a.start.takenAt.localeCompare(b.start.takenAt));
  return {
    runId,
    fileOrder: suites.map((x) => x.suite),
    suites: suites.map((x, i) => ({ ...x, order: i + 1 })),
  };
}

export interface PerfReport {
  readonly version: 1;
  readonly generatedAt: string;
  readonly environment: Record<string, string | number | boolean>;
  readonly dataset: Record<string, string | number>;
  readonly results: readonly BenchResult[];
  readonly breaches: readonly string[];
  /** Carga de fondo por suite (investigate-perf-under-load). Aditivo: ausente en reportes sin fotos. */
  readonly backgroundLoad?: BackgroundLoadReport;
  /** Benchmark del import de 5 000 filas (fix-imports-perf-connection-budget). Aditivo: ausente si la suite no corrió. */
  readonly imports?: ImportsReport;
  /** Costo por evento de cada consumidor con handler real (optimize-consumer-throughput). Informativo, aditivo. */
  readonly consumerCost?: readonly ConsumerCost[];
}

export function latencyResult(input: {
  id: string;
  nfr: keyof typeof PERF_THRESHOLDS;
  title: string;
  samples: readonly number[];
  limitMs: number;
  gate?: boolean;
  notes?: string;
}): BenchResult {
  const s = stats(input.samples);
  const gate = input.gate ?? true;
  return {
    id: input.id,
    nfr: input.nfr,
    title: input.title,
    stats: s,
    value: s.p95,
    limit: input.limitMs,
    unit: 'ms',
    gate,
    passed: s.p95 <= input.limitMs,
    ...(input.notes ? { notes: input.notes } : {}),
  };
}

/**
 * Throughput de un consumidor: `value` = eventos/s sostenidos en su ventana de proceso (primer a último evento) y `limit`
 * el mínimo (`passed` = `value ≥ limit`). Las estadísticas son las de los eventos/s por segundo de reloj de la ventana.
 */
export function throughputResult(input: {
  id: string;
  title: string;
  /** Eventos procesados en cada segundo de la ventana. */
  perSecond: readonly number[];
  events: number;
  seconds: number;
  minEventsPerSecond: number;
  gate?: boolean;
  notes?: string;
}): BenchResult {
  const rate = input.seconds > 0 ? Math.round((input.events / input.seconds) * 100) / 100 : 0;
  return {
    id: input.id,
    nfr: 'NFR-PERF-008',
    title: input.title,
    stats: stats(input.perSecond.length > 0 ? input.perSecond : [0]),
    value: rate,
    limit: input.minEventsPerSecond,
    unit: 'ev/s',
    gate: input.gate ?? false,
    passed: rate >= input.minEventsPerSecond,
    notes: `${input.events} eventos en ${Math.round(input.seconds * 10) / 10} s; p50/p95/p99 = eventos/s por segundo${
      input.notes ? `; ${input.notes}` : ''
    }`,
  };
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Mediana real (promedio de los dos centrales en muestras pares); no modifica la entrada. */
export function median(samples: readonly number[]): number {
  if (samples.length === 0) throw new RangeError('muestra vacía');
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** PRNG determinista (mulberry32): el IC se reproduce a partir de las muestras del reporte. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** IC de percentiles (2.5 % y 97.5 %) de la mediana por bootstrap con semilla fija. */
export function bootstrapMedianCi(
  samples: readonly number[],
  resamples: number = RLS_OVERHEAD.bootstrapResamples,
  seed: number = RLS_OVERHEAD.bootstrapSeed,
): readonly [number, number] {
  if (samples.length === 0) throw new RangeError('muestra vacía');
  const random = seededRandom(seed);
  const n = samples.length;
  const medians: number[] = [];
  const draw = new Array<number>(n);
  for (let r = 0; r < resamples; r += 1) {
    for (let i = 0; i < n; i += 1) draw[i] = samples[Math.floor(random() * n)]!;
    medians.push(median(draw));
  }
  medians.sort((a, b) => a - b);
  return [
    medians[Math.floor(0.025 * resamples)]!,
    medians[Math.min(resamples - 1, Math.floor(0.975 * resamples))]!,
  ];
}

/**
 * Overhead de RLS (fix-nightly-pipeline, decisión 4). `withRls[i]` y `withoutRls[i]` son un par intercalado de
 * `Execution Time` (EXPLAIN ANALYZE) con RLS (pf_app) y sin RLS (superusuario). `plans` lleva, por sentencia, el método
 * de acceso, tabla e índice del plan (p. ej. `Index Only Scan on ledger.posting (posting_balance_ix)`) con y sin RLS;
 * los nodos de las tablas de la política (`RLS_POLICY_TABLES`) se ignoran al compararlos.
 */
export function rlsResult(input: {
  id: string;
  title: string;
  withRls: readonly number[];
  withoutRls: readonly number[];
  plans?: { readonly withRls: readonly string[]; readonly withoutRls: readonly string[] };
  /** `false` ⇒ informativo: se reporta pero no es una brecha (agregado sintético, docs/31 D43). */
  gate?: boolean;
}): BenchResult {
  if (input.withRls.length === 0 || input.withRls.length !== input.withoutRls.length) {
    throw new RangeError(
      'rlsResult necesita el mismo número (> 0) de ejecuciones con y sin RLS: pares intercalados',
    );
  }
  const a = stats(input.withRls);
  const diffs = input.withRls.map((w, i) => w - input.withoutRls[i]!);
  const medWith = median(input.withRls);
  const medWithout = median(input.withoutRls);
  const medDiff = median(diffs);
  const [inf, sup] = bootstrapMedianCi(diffs);
  const ratio = medWithout > 0 ? medDiff / medWithout : 0;
  const ratioMs = RLS_OVERHEAD.maxRatio * medWithout;
  const dataPlans = input.plans && {
    withRls: input.plans.withRls.map(dataAccessSignature),
    withoutRls: input.plans.withoutRls.map(dataAccessSignature),
  };
  const planChanged =
    dataPlans !== undefined && dataPlans.withRls.join(' | ') !== dataPlans.withoutRls.join(' | ');
  let verdict: RlsVerdict;
  if (planChanged) verdict = 'plan distinto';
  else if (inf >= ratioMs && inf >= RLS_OVERHEAD.noiseFloorMs) verdict = 'brecha demostrada';
  else if (medDiff < Math.max(ratioMs, RLS_OVERHEAD.noiseFloorMs)) verdict = 'OK';
  else if (inf < ratioMs) verdict = 'no demostrada sobre el 10 %';
  else verdict = 'no demostrada sobre el piso absoluto';
  const planNote = dataPlans
    ? planChanged
      ? `; plan distinto: sin RLS ${dataPlans.withoutRls.join(' | ')} → con RLS ${dataPlans.withRls.join(' | ')}`
      : `; plan: ${dataPlans.withRls.join(' | ')}`
    : '';
  return {
    id: input.id,
    nfr: 'RLS-OVERHEAD',
    title: input.title,
    stats: a,
    value: round3(ratio),
    limit: RLS_OVERHEAD.maxRatio,
    unit: 'ratio',
    gate: input.gate ?? true,
    passed: verdict !== 'brecha demostrada' && verdict !== 'plan distinto',
    ci95Ms: [round3(inf), round3(sup)],
    pairs: diffs.length,
    verdict,
    notes: `mediana con RLS ${round3(medWith)} ms vs sin RLS ${round3(medWithout)} ms; diferencia ${round3(medDiff)} ms, IC95 [${round3(inf)}, ${round3(sup)}] ms (${diffs.length} pares); veredicto: ${verdict}${planNote}`,
  };
}

/** `sin RLS X → con RLS Y` de las notas de una fila de RLS con el plan cambiado. */
const planOf = (notes: string | undefined): string =>
  /plan distinto: sin RLS (.*) → con RLS (.*)$/u
    .exec(notes ?? '')
    ?.slice(1, 3)
    .join(' → ') ?? '';

export function buildReport(input: Omit<PerfReport, 'version' | 'breaches'>): PerfReport {
  const breaches = input.results
    .filter((r) => r.gate && !r.passed)
    .map((r) =>
      r.valid === false
        ? `${r.nfr} ${r.id}: ${r.interference ?? 'interferencia'}`
        : r.verdict === 'plan distinto'
          ? `${r.nfr} ${r.id}: plan distinto (${planOf(r.notes)})`
          : r.unit === 'ev/s'
            ? `${r.nfr} ${r.id}: ${r.value} ev/s < ${r.limit} ev/s`
            : `${r.nfr} ${r.id}: ${r.value}${r.unit === 'ms' ? ' ms' : ''} > ${r.limit}${r.unit === 'ms' ? ' ms' : ''}`,
    );
  return { version: 1, ...input, breaches };
}

/** El aviso por issue pega `perf-summary.md` (límite de GitHub 65 536 caracteres): el diagnóstico se recorta. */
export const MAX_DIAGNOSTICS_CHARS = 24_000;

export const BACKGROUND_LOAD_START = '<!-- background-load:start -->';
export const BACKGROUND_LOAD_END = '<!-- background-load:end -->';
/** La sección de carga de fondo se recorta para que el aviso por issue (65 536 caracteres) no se desborde. */
export const MAX_BACKGROUND_LOAD_CHARS = 16_000;

const dash = (v: string | null) => v ?? '—';
const loadOf = (s: BackgroundLoadSnapshot) => s.loadAvg.map(round2).join(' / ');
const jobsDetail = (s: BackgroundLoadSnapshot): string => {
  const queues = [...new Set(s.eventJobs.map((j) => j.queue))];
  return queues.length === 0
    ? 'ninguno'
    : queues
        .map(
          (q) =>
            `${q} (${s.eventJobs
              .filter((j) => j.queue === q)
              .map((j) => `${j.state} ${j.count}`)
              .join(', ')})`,
        )
        .join('; ');
};
const connectionsDetail = (s: BackgroundLoadSnapshot): string =>
  s.connections.length === 0
    ? 'ninguna'
    : s.connections.map((c) => `${c.role}/${c.application}/${c.state} ${c.count}`).join(', ');

const preparationDetail = (i: Isolation): string =>
  i.preparation
    ? `; purga previa: ${i.preparation.purgedOutbox} eventos del outbox y ${i.preparation.purgedJobs} trabajos events.*; espera de quietud: ${Math.round(i.preparation.waitedMs / 1000)} s, carga ${round2(i.preparation.hostLoad1m)} (límite ${i.preparation.hostLoadLimit}), ${i.preparation.foreignActiveQueries} consultas ajenas activas`
    : '';

/**
 * Sección "Carga de fondo por suite" de `perf-summary.md` entre marcadores (las suites que corren después de `nightly`
 * la reemplazan con `replaceBackgroundLoadSection`). Va con el orden real de los archivos y, por suite, la foto al
 * empezar, antes de cada benchmark y al terminar.
 */
export function renderBackgroundLoadSection(bl: BackgroundLoadReport): string[] {
  const body: string[] = ['## Carga de fondo por suite', ''];
  if (bl.suites.length === 0) {
    body.push('Sin fotos de carga de fondo en esta corrida.', '');
  } else {
    body.push(
      `> Orden real de los archivos: ${bl.fileOrder.join(' → ')}. Foto de la base y del host (investigate-perf-under-load):`,
      '> eventos pendientes del outbox, trabajos `events.*` (created, retry, active), conexiones, locks no concedidos y',
      '> carga del host. Antes de la foto de inicio el harness purga el backlog residual y espera la quietud del host (D291);',
      '> "interferencia" = la suite empezó con eventos o trabajos ajenos, o con el host sin quietud, y falla.',
      '',
      '### Al empezar cada suite',
      '',
      '| # | Suite | Eventos pendientes | Trabajos events.* | Conexiones | Locks no concedidos | Carga del host (1/5/15 min) | Aislamiento |',
      '|---|---|---|---|---|---|---|---|',
      ...bl.suites.map(
        (x) =>
          `| ${x.order} | ${x.suite} | ${x.start.outboxPending} | ${x.isolation.eventJobs} | ${summarizeSnapshot(x.start).connections} | ${x.start.ungrantedLocks} | ${loadOf(x.start)} | ${x.isolation.verdict} |`,
      ),
      '',
      '### Detalle al empezar',
      '',
      ...bl.suites.map(
        (x) =>
          `- **${x.suite}:** trabajos: ${jobsDetail(x.start)}; conexiones: ${connectionsDetail(x.start)}${preparationDetail(x.isolation)}${
            x.isolation.verdict === 'interferencia' ? `; ${x.isolation.message}` : ''
          }`,
      ),
      '',
      '### Tablas citadas al empezar (pg_stat_user_tables)',
      '',
      '| Suite | Tabla | Filas vivas | Filas muertas | Último autovacuum | Último autoanalyze |',
      '|---|---|---|---|---|---|',
      ...bl.suites.flatMap((x) =>
        x.start.tables.map(
          (t) =>
            `| ${x.suite} | ${t.table} | ${t.liveTuples} | ${t.deadTuples} | ${dash(t.lastAutovacuum)} | ${dash(t.lastAutoanalyze)} |`,
        ),
      ),
      '',
      '### Al terminar cada suite',
      '',
      '| Suite | Eventos pendientes | Trabajos events.* | Conexiones | Locks no concedidos | Carga del host (1/5/15 min) |',
      '|---|---|---|---|---|---|',
      ...bl.suites
        .filter((x) => x.end !== undefined)
        .map((x) => {
          const e = summarizeSnapshot(x.end!);
          return `| ${x.suite} | ${e.outboxPending} | ${e.eventJobs} | ${e.connections} | ${e.ungrantedLocks} | ${loadOf(x.end!)} |`;
        }),
      '',
      '### Antes de cada benchmark',
      '',
      '| Suite | Benchmark | Eventos pendientes | Trabajos events.* | Conexiones | Locks no concedidos | Carga 1 min | Datos del benchmark |',
      '|---|---|---|---|---|---|---|---|',
      ...bl.suites.flatMap((x) =>
        x.benchmarks.map((b) => {
          const m = summarizeSnapshot(b.snapshot);
          const extra = b.extra
            ? Object.entries(b.extra)
                .map(([k, v]) => `${k}: ${v}`)
                .join('; ')
            : '';
          return `| ${x.suite} | ${b.benchmark} | ${m.outboxPending} | ${m.eventJobs} | ${m.connections} | ${m.ungrantedLocks} | ${m.loadAvg1m} | ${extra} |`;
        }),
      ),
      '',
    );
  }
  let text = body.join('\n');
  if (text.length > MAX_BACKGROUND_LOAD_CHARS) {
    text = `${text.slice(0, MAX_BACKGROUND_LOAD_CHARS)}\n\n[recortado a ${MAX_BACKGROUND_LOAD_CHARS} caracteres; el registro completo está en background-load.ndjson y perf-results.json del artefacto perf]\n`;
  }
  return [BACKGROUND_LOAD_START, text, BACKGROUND_LOAD_END];
}

/** Reemplaza la sección entre marcadores de un `perf-summary.md`; si no los tiene, la agrega al final. */
export function replaceBackgroundLoadSection(markdown: string, bl: BackgroundLoadReport): string {
  const section = renderBackgroundLoadSection(bl).join('\n');
  const start = markdown.indexOf(BACKGROUND_LOAD_START);
  const end = markdown.indexOf(BACKGROUND_LOAD_END);
  if (start === -1 || end === -1 || end < start) return `${markdown.replace(/\n*$/u, '')}\n\n${section}\n`;
  return `${markdown.slice(0, start)}${section}${markdown.slice(end + BACKGROUND_LOAD_END.length)}`;
}

export function renderMarkdown(report: PerfReport, diagnostics?: string): string {
  const fmt = (r: BenchResult) =>
    r.unit === 'ms'
      ? `${r.value} ms${r.valid === false ? ' (no válida)' : ''}`
      : r.unit === 'ev/s'
        ? `${r.value} ev/s${r.valid === false ? ' (no válida)' : ''}`
        : `${(r.value * 100).toFixed(1)} %`;
  const lim = (r: BenchResult) =>
    r.unit === 'ms' ? `≤ ${r.limit} ms` : r.unit === 'ev/s' ? `≥ ${r.limit} ev/s` : `< ${r.limit * 100} %`;
  const lines = [
    '# Benchmarks nightly (PFOS)',
    '',
    `> Generado ${report.generatedAt}. Umbrales: docs/02 §PERF y add-ledger-core 5.5. Tiempos = ida y vuelta HTTP en`,
    '> el mismo host (cota superior del server time) salvo las filas de ledger/RLS (caso de uso / EXPLAIN ANALYZE).',
    '',
    `**Resultado:** ${report.breaches.length === 0 ? 'OK — sin umbrales superados' : `FALLA — ${report.breaches.length} umbral(es) superado(s)`}`,
    '',
    '## Dataset',
    '',
    '| Clave | Valor |',
    '|---|---|',
    ...Object.entries(report.dataset).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Resultados',
    '',
    '| NFR | Medición | n | p50 | p95 | p99 | Valor | Umbral | Gate | Estado |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...report.results.map(
      (r) =>
        `| ${r.nfr} | ${r.title} | ${r.stats.n} | ${r.stats.p50} | ${r.stats.p95} | ${r.stats.p99} | ${fmt(r)} | ${lim(r)} | ${r.gate ? 'sí' : 'informativo'} | ${r.valid === false ? 'INTERFERENCIA' : r.passed ? 'OK' : 'FALLA'} |`,
    ),
    '',
    ...(report.results.some((r) => r.notes)
      ? ['## Notas', '', ...report.results.filter((r) => r.notes).map((r) => `- **${r.id}:** ${r.notes}`), '']
      : []),
    ...(report.backgroundLoad ? [...renderBackgroundLoadSection(report.backgroundLoad), ''] : []),
    '## Entorno',
    '',
    '| Clave | Valor |',
    '|---|---|',
    ...Object.entries(report.environment).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    ...(diagnostics && diagnostics.trim().length > 0
      ? [
          '## Diagnóstico de RLS (EXPLAIN ANALYZE con y sin política)',
          '',
          diagnostics.length > MAX_DIAGNOSTICS_CHARS
            ? `${diagnostics.slice(0, MAX_DIAGNOSTICS_CHARS)}\n\n[recortado a ${MAX_DIAGNOSTICS_CHARS} caracteres; el texto completo está en rls-explain.md del artefacto perf]`
            : diagnostics,
          '',
        ]
      : []),
  ];
  return lines.join('\n');
}

export function writeReport(
  report: PerfReport,
  outDir: string,
  diagnostics?: string,
): { json: string; md: string } {
  mkdirSync(outDir, { recursive: true });
  const json = join(outDir, 'perf-results.json');
  const md = join(outDir, 'perf-summary.md');
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(md, renderMarkdown(report, diagnostics), 'utf8');
  return { json, md };
}

// ── Benchmark del import: conexiones y drenado por consumidor (fix-imports-perf-connection-budget) ──

/** Adquisición de conexión que venció (`timeout exceeded when trying to connect`). */
export interface AcquireTimeout {
  readonly pool: string;
  /** Conexiones en uso del pool cuando venció. */
  readonly inUse: number;
  readonly max: number;
  readonly waitedMs: number;
}

export interface PoolConnectionStats {
  readonly pool: string;
  readonly max: number;
  readonly peakInUse: number;
  readonly peakWaiting: number;
  readonly maxAcquireMs: number;
  readonly timeouts: number;
}

export interface ServerConnectionStats {
  readonly maxConnections: number;
  readonly reserved: number;
  readonly peak: number;
  readonly peakByApplication: Readonly<Record<string, number>>;
}

export interface ConnectionsReport {
  readonly samples: number;
  /** Pico de la carga del host (1 min) durante el muestreo; contexto para una conexión lenta (HI4). */
  readonly peakLoad1m?: number;
  readonly budget: { readonly poolsSum: number; readonly limit: number; readonly fits: boolean };
  readonly pools: readonly PoolConnectionStats[];
  readonly server: ServerConnectionStats;
  readonly timeouts: readonly AcquireTimeout[];
}

export interface ConsumerDrain {
  /** Cola `events.<consumidor>` o `outbox`. */
  readonly queue: string;
  readonly pendingAtPersist: number;
  readonly peakPending: number;
  /** Pico de trabajos en estado `retry` (reintento con espera) durante el drenado: un fallo transitorio alarga la cola. */
  readonly peakRetrying?: number;
  /** ms desde el fin de la persistencia hasta dejar el backlog en 0; `null` si no llegó a 0 mientras se observó. */
  readonly drainedAfterPersistMs: number | null;
  /** Ritmo de drenado del backlog al terminar la persistencia (pendientes / tiempo); `null` si no aplica. */
  readonly eventsPerSecond: number | null;
}

/** Trabajos de una cola `events.*` que fallaron al menos una vez, con el último error registrado por pg-boss. */
export interface RetriedJobs {
  readonly queue: string;
  readonly jobs: number;
  readonly maxRetryCount: number;
  /** Latencia máxima (alta a fin) de un trabajo reintentado de la cola. */
  readonly maxLatencyMs?: number;
  readonly error: string;
  /** Motivo del reintento (E10b, HI6 de docs/53): `expiración` del trabajo activo o `fallo del handler`. */
  readonly reason?: RetryReason;
}

export type RetryReason = 'expiración' | 'fallo del handler';

/**
 * Clasifica un reintento por el último error que pg-boss guardó: un trabajo activo que superó `expireInSeconds` se
 * reintenta SIN excepción del handler (expiración); cualquier otro mensaje es un fallo del handler.
 */
export function classifyRetryReason(error: string): RetryReason {
  return /expire|expir|timed out|handler execution exceeded/iu.test(error)
    ? 'expiración'
    : 'fallo del handler';
}

/** Fallos de entrega de un consumidor registrados por el worker (`job failed`), agrupados por error. */
export interface JobFailure {
  readonly queue: string;
  readonly count: number;
  readonly maxAttempt: number;
  readonly error: string;
}

export type ImportsVerdict =
  | { readonly kind: 'ok'; readonly message: string }
  | { readonly kind: 'conexiones'; readonly message: string }
  | { readonly kind: 'drenado'; readonly message: string };

/** Configuración con la que corrió una fila del benchmark del import (D307, D311). */
export interface ImportsConfiguration {
  readonly label: 'code' | 'host';
  readonly eventConsumerConcurrency: number;
  readonly workerPoolMax: number;
  readonly apiPoolMax: number;
  /** Suma de los pools máximos de la suite (API, worker, colas y harness) frente a `usableConnections`. */
  readonly poolsSum: number;
  readonly usableConnections: number;
  /** `true`: la fila decide el veredicto del job (la de la plantilla del host, D311); `false`: informativa. */
  readonly gate: boolean;
}

export interface ImportsReport {
  readonly rows: number;
  readonly previewMs: number;
  readonly persistMs: number;
  /** Drenado total medido desde el fin de la persistencia. */
  readonly drainAfterPersistMs: number;
  readonly drainBudgetMs: number;
  readonly connections?: ConnectionsReport;
  readonly drainByConsumer: readonly ConsumerDrain[];
  /** Trabajos de los consumidores que se reintentaron durante la medición (causa de una cola que tarda en llegar a 0). */
  readonly retries?: readonly RetriedJobs[];
  /** Por qué fallaron las entregas (registro del worker): causa de los reintentos que alargan una cola. */
  readonly jobFailures?: readonly JobFailure[];
  readonly verdict: ImportsVerdict;
  readonly configuration?: ImportsConfiguration;
  /** Fila con la configuración de la plantilla del host (misma forma que la raíz): bloqueante desde D311. */
  readonly hostConfig?: ImportsReport;
}

/** Costo por evento de un consumidor con su handler real (optimize-consumer-throughput, E6–E8). Siempre informativo. */
export interface ConsumerCost {
  readonly consumer: string;
  readonly p50Ms: number;
  readonly p95Ms: number;
  /** Ritmo con el consumidor como único activo (eventos por segundo); `null` si no se midió. */
  readonly soloEventsPerSecond: number | null;
  /** Milisegundos acumulados de muestras con esperas por bloqueos durante su drenado. */
  readonly lockWaitsMs: number;
  /** Eventos por invocación del efecto, si el consumidor está agrupado. */
  readonly groupSize?: number;
  readonly gate: false;
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
const budgetSeconds = (ms: number): string => `${String(Math.round(ms / 1000))} s`;
const poolLabel = (pool: string): string => (pool === 'api' || pool === 'worker' ? `del ${pool}` : pool);

/**
 * Veredicto del benchmark del import. Una adquisición de conexión vencida es `conexiones` y NO se reporta como un fallo
 * del drenado (aunque este también haya excedido); un drenado sobre el presupuesto nombra los consumidores que terminaron
 * después de él, con su tiempo.
 */
export function importsVerdict(input: {
  readonly drainAfterPersistMs: number;
  readonly drainBudgetMs: number;
  readonly connections?: Pick<ConnectionsReport, 'timeouts' | 'server'>;
  readonly drainByConsumer: readonly ConsumerDrain[];
}): ImportsVerdict {
  const first = input.connections?.timeouts[0];
  if (first) {
    const server = input.connections?.server;
    const peak = server
      ? `; pico del servidor ${String(server.peak)} de ${String(server.maxConnections)} conexiones`
      : '';
    return {
      kind: 'conexiones',
      message: `[TC-PLATFORM-PIPELINE-030] veredicto conexiones: la adquisición de conexión del pool ${poolLabel(first.pool)} venció tras ${String(Math.round(first.waitedMs))} ms con ${String(first.inUse)} de ${String(first.max)} conexiones en uso${peak}`,
    };
  }
  if (input.drainAfterPersistMs > input.drainBudgetMs) {
    const late = input.drainByConsumer
      .filter((c) => c.drainedAfterPersistMs === null || c.drainedAfterPersistMs > input.drainBudgetMs)
      .map(
        (c) =>
          `${c.queue} ${c.drainedAfterPersistMs === null ? 'sin llegar a 0' : seconds(c.drainedAfterPersistMs)}`,
      );
    return {
      kind: 'drenado',
      message: `[TC-PLATFORM-PIPELINE-032] veredicto drenado: ${seconds(input.drainAfterPersistMs)} frente a ${budgetSeconds(input.drainBudgetMs)} después de la persistencia; terminaron después del presupuesto: ${late.length > 0 ? late.join(', ') : 'ningún consumidor individual (el total incluye la espera entre observaciones)'}`,
    };
  }
  return { kind: 'ok', message: 'sin adquisiciones vencidas y drenado dentro del presupuesto' };
}

export const IMPORTS_SECTION_START = '<!-- imports:start -->';
export const IMPORTS_SECTION_END = '<!-- imports:end -->';

/** Sección "Import de 5 000 filas" de `perf-summary.md` (conexiones por pool, servidor y drenado por consumidor). */
export function renderImportsSection(r: ImportsReport): string[] {
  const out = renderImportsRow(r, '## Import de 5 000 filas: conexiones y drenado por consumidor');
  if (r.hostConfig) {
    out.push(...renderImportsRow(r.hostConfig, '### Configuración de la plantilla del host'));
  }
  return out;
}

/** Estado de una fila del benchmark del import: bloqueante (decide el veredicto) o informativa (se publica sin decidir). */
export function importsRowStatus(r: ImportsReport): string {
  const gate = r.configuration?.gate ?? true;
  if (gate) return r.verdict.kind === 'ok' ? 'bloqueante, OK' : `bloqueante, FALLA (${r.verdict.kind})`;
  if (r.verdict.kind === 'ok') return 'informativa, dentro del presupuesto';
  const late = r.drainByConsumer
    .filter((c) => c.drainedAfterPersistMs === null || c.drainedAfterPersistMs > r.drainBudgetMs)
    .map(
      (c) =>
        `${c.queue} ${c.drainedAfterPersistMs === null ? 'sin llegar a 0' : seconds(c.drainedAfterPersistMs)}`,
    );
  return `informativa, excedida (${r.verdict.kind})${late.length > 0 ? `: ${late.join(', ')}` : ''}`;
}

function renderImportsRow(r: ImportsReport, heading: string): string[] {
  const cfg = r.configuration;
  const out: string[] = [
    heading,
    '',
    ...(cfg
      ? [
          `**Configuración ${cfg.label === 'host' ? 'de la plantilla del host' : 'del código'}:** concurrencia ${String(cfg.eventConsumerConcurrency)} por consumidor, pool de ${String(cfg.workerPoolMax)} en el worker y de ${String(cfg.apiPoolMax)} en la API; suma de pools de ${String(cfg.poolsSum)} conexiones frente a ${String(cfg.usableConnections)} útiles. **Fila:** ${importsRowStatus(r)}.`,
          '',
        ]
      : []),
    `**Veredicto:** ${r.verdict.kind === 'ok' ? 'OK' : `FALLA (${r.verdict.kind})`}: ${r.verdict.message}`,
    '',
    `Vista previa ${seconds(r.previewMs)}, persistencia ${seconds(r.persistMs)}, drenado ${seconds(r.drainAfterPersistMs)} después de la persistencia (presupuesto ${budgetSeconds(r.drainBudgetMs)}).`,
    '',
  ];
  const c = r.connections;
  if (c) {
    out.push(
      `Presupuesto de pools: ${String(c.budget.poolsSum)} frente a un límite de ${String(c.budget.limit)} (max_connections ${String(c.server.maxConnections)} menos ${String(c.server.reserved)} reservadas); pico del servidor ${String(c.server.peak)}; ${String(c.samples)} muestras${c.peakLoad1m === undefined ? '' : `; pico de carga del host ${String(c.peakLoad1m)}`}.`,
      '',
      '| Pool | Máximo | Pico en uso | Pico en espera | Espera máx. (ms) | Vencidas |',
      '|---|---|---|---|---|---|',
      ...c.pools.map(
        (p) =>
          `| ${p.pool} | ${String(p.max)} | ${String(p.peakInUse)} | ${String(p.peakWaiting)} | ${String(p.maxAcquireMs)} | ${String(p.timeouts)} |`,
      ),
      '',
      `Pico del servidor por aplicación: ${Object.entries(c.server.peakByApplication)
        .map(([app, n]) => `${app} ${String(n)}`)
        .join(', ')}`,
      '',
    );
  }
  out.push(
    '| Consumidor | Pendientes al terminar la persistencia | Pico | Pico en reintento | Drenado (s) | Ritmo (ev/s) |',
    '|---|---|---|---|---|---|',
    ...r.drainByConsumer.map(
      (d) =>
        `| ${d.queue} | ${String(d.pendingAtPersist)} | ${String(d.peakPending)} | ${String(d.peakRetrying ?? 0)} | ${d.drainedAfterPersistMs === null ? 'sin llegar a 0' : (d.drainedAfterPersistMs / 1000).toFixed(1)} | ${d.eventsPerSecond === null ? '—' : String(d.eventsPerSecond)} |`,
    ),
    '',
  );
  if (r.jobFailures && r.jobFailures.length > 0) {
    out.push(
      'Fallos de entrega (registro del worker):',
      '',
      '| Cola | Fallos | Intento máx. | Error |',
      '|---|---|---|---|',
      ...r.jobFailures.map(
        (j) =>
          `| ${j.queue} | ${String(j.count)} | ${String(j.maxAttempt)} | ${j.error.replace(/\|/gu, '/')} |`,
      ),
      '',
    );
  }
  if (r.retries && r.retries.length > 0) {
    out.push(
      'Trabajos reintentados:',
      '',
      '| Cola | Trabajos | Reintentos máx. | Latencia máx. (s) | Último error |',
      '|---|---|---|---|---|',
      ...r.retries.map(
        (j) =>
          `| ${j.queue} | ${String(j.jobs)} | ${String(j.maxRetryCount)} | ${j.maxLatencyMs === undefined ? '—' : (j.maxLatencyMs / 1000).toFixed(1)} | ${j.error.replace(/\|/gu, '/')}${j.reason ? ` (${j.reason})` : ''} |`,
      ),
      '',
    );
  }
  return out;
}

/**
 * Publica el reporte del import: siempre `imports-perf.json` y, si ya existen el `perf-results.json` y el
 * `perf-summary.md` de la corrida (los escribe `nightly.perf.ts`), agrega `imports` al primero y la sección entre
 * marcadores al segundo (aditivo: el resto del reporte no cambia).
 */
export function writeImportsReport(report: ImportsReport, outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'imports-perf.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const jsonPath = join(outDir, 'perf-results.json');
  const mdPath = join(outDir, 'perf-summary.md');
  if (!existsSync(jsonPath) || !existsSync(mdPath)) return;
  const current = JSON.parse(readFileSync(jsonPath, 'utf8')) as PerfReport;
  writeFileSync(jsonPath, `${JSON.stringify({ ...current, imports: report }, null, 2)}\n`, 'utf8');
  const section = [IMPORTS_SECTION_START, ...renderImportsSection(report), IMPORTS_SECTION_END].join('\n');
  const md = readFileSync(mdPath, 'utf8');
  const start = md.indexOf(IMPORTS_SECTION_START);
  const end = md.indexOf(IMPORTS_SECTION_END);
  writeFileSync(
    mdPath,
    start === -1 || end === -1 || end < start
      ? `${md.replace(/\n*$/u, '')}\n\n${section}\n`
      : `${md.slice(0, start)}${section}${md.slice(end + IMPORTS_SECTION_END.length)}`,
    'utf8',
  );
}

// ── Costo por evento de cada consumidor con handler real (optimize-consumer-throughput, TC-PLATFORM-THROUGHPUT-012/013) ──

export const CONSUMER_COST_SECTION_START = '<!-- consumer-cost:start -->';
export const CONSUMER_COST_SECTION_END = '<!-- consumer-cost:end -->';

/**
 * Sección "Costo por evento de cada consumidor" de `perf-summary.md`. Todas las filas son informativas: no entran en
 * `breaches` ni cambian el veredicto del job (D300, D312). Ordenadas del más lento al más rápido por ritmo aislado.
 */
export function renderConsumerCostSection(rows: readonly ConsumerCost[]): string[] {
  const rank = (c: ConsumerCost): number => c.soloEventsPerSecond ?? Number.POSITIVE_INFINITY;
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || a.consumer.localeCompare(b.consumer));
  const slowest = sorted.find((c) => c.soloEventsPerSecond !== null);
  return [
    '## Costo por evento de cada consumidor (informativo)',
    '',
    'Duración por evento con el handler real, ritmo con el consumidor como único activo y esperas por bloqueos de base de datos durante su drenado. Ninguna fila decide el veredicto del job (D300).',
    '',
    ...(slowest
      ? [
          `El consumidor más lento es \`${slowest.consumer}\` con ${String(slowest.soloEventsPerSecond)} ev/s.`,
          '',
        ]
      : []),
    '| Consumidor | p50 (ms) | p95 (ms) | Ritmo aislado (ev/s) | Esperas por bloqueos (ms) | Eventos por invocación | Gate |',
    '|---|---|---|---|---|---|---|',
    ...sorted.map(
      (c) =>
        `| ${c.consumer}${c === slowest ? ' (más lento)' : ''} | ${String(c.p50Ms)} | ${String(c.p95Ms)} | ${c.soloEventsPerSecond === null ? '—' : String(c.soloEventsPerSecond)} | ${String(c.lockWaitsMs)} | ${c.groupSize === undefined ? '—' : String(c.groupSize)} | informativo |`,
    ),
    '',
  ];
}

/**
 * Publica el costo por consumidor: siempre `consumer-cost-perf.json` y, si ya existen el `perf-results.json` y el
 * `perf-summary.md` de la corrida, agrega `consumerCost` al primero y la sección entre marcadores al segundo (aditivo).
 */
export function writeConsumerCostReport(rows: readonly ConsumerCost[], outDir: string): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'consumer-cost-perf.json'), `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  const jsonPath = join(outDir, 'perf-results.json');
  const mdPath = join(outDir, 'perf-summary.md');
  if (!existsSync(jsonPath) || !existsSync(mdPath)) return;
  const current = JSON.parse(readFileSync(jsonPath, 'utf8')) as PerfReport;
  writeFileSync(jsonPath, `${JSON.stringify({ ...current, consumerCost: rows }, null, 2)}\n`, 'utf8');
  const section = [
    CONSUMER_COST_SECTION_START,
    ...renderConsumerCostSection(rows),
    CONSUMER_COST_SECTION_END,
  ].join('\n');
  const md = readFileSync(mdPath, 'utf8');
  const start = md.indexOf(CONSUMER_COST_SECTION_START);
  const end = md.indexOf(CONSUMER_COST_SECTION_END);
  writeFileSync(
    mdPath,
    start === -1 || end === -1 || end < start
      ? `${md.replace(/\n*$/u, '')}\n\n${section}\n`
      : `${md.slice(0, start)}${section}${md.slice(end + CONSUMER_COST_SECTION_END.length)}`,
    'utf8',
  );
}
