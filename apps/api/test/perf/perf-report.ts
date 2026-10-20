import { mkdirSync, writeFileSync } from 'node:fs';
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
      return table === undefined || !RLS_POLICY_TABLES.includes(table);
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
}

export interface PerfReport {
  readonly version: 1;
  readonly generatedAt: string;
  readonly environment: Record<string, string | number | boolean>;
  readonly dataset: Record<string, string | number>;
  readonly results: readonly BenchResult[];
  readonly breaches: readonly string[];
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
      r.verdict === 'plan distinto'
        ? `${r.nfr} ${r.id}: plan distinto (${planOf(r.notes)})`
        : r.unit === 'ev/s'
          ? `${r.nfr} ${r.id}: ${r.value} ev/s < ${r.limit} ev/s`
          : `${r.nfr} ${r.id}: ${r.value}${r.unit === 'ms' ? ' ms' : ''} > ${r.limit}${r.unit === 'ms' ? ' ms' : ''}`,
    );
  return { version: 1, ...input, breaches };
}

/** El aviso por issue pega `perf-summary.md` (límite de GitHub 65 536 caracteres): el diagnóstico se recorta. */
export const MAX_DIAGNOSTICS_CHARS = 24_000;

export function renderMarkdown(report: PerfReport, diagnostics?: string): string {
  const fmt = (r: BenchResult) =>
    r.unit === 'ms'
      ? `${r.value} ms`
      : r.unit === 'ev/s'
        ? `${r.value} ev/s`
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
        `| ${r.nfr} | ${r.title} | ${r.stats.n} | ${r.stats.p50} | ${r.stats.p95} | ${r.stats.p99} | ${fmt(r)} | ${lim(r)} | ${r.gate ? 'sí' : 'informativo'} | ${r.passed ? 'OK' : 'FALLA'} |`,
    ),
    '',
    ...(report.results.some((r) => r.notes)
      ? ['## Notas', '', ...report.results.filter((r) => r.notes).map((r) => `- **${r.id}:** ${r.notes}`), '']
      : []),
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
