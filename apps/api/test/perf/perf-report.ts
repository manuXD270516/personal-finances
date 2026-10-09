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
 * add-ledger-core 5.5 (criterio docs/31 D43): overhead de RLS < 10 % (EXPLAIN ANALYZE) medido sobre las consultas REALES
 * de la aplicación (las sentencias que emite `PgBalanceQuery`, con sus parámetros) y las de índice; el agregado
 * sintético de todo el workspace se reporta como informativo (no falla). Bajo `noiseFloorMs` la diferencia es ruido.
 */
export const RLS_OVERHEAD = { maxRatio: 0.1, noiseFloorMs: 0.5 } as const;

export type NfrId = keyof typeof PERF_THRESHOLDS | 'RLS-OVERHEAD';

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

export interface BenchResult {
  readonly id: string;
  readonly nfr: NfrId;
  readonly title: string;
  readonly stats: LatencyStats;
  /** Valor comparado contra el umbral (p95 en ms, o ratio para RLS). */
  readonly value: number;
  readonly limit: number;
  readonly unit: 'ms' | 'ratio';
  readonly gate: boolean;
  readonly passed: boolean;
  readonly notes?: string;
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

/** Overhead de RLS: medianas de `Execution Time` (EXPLAIN ANALYZE) con RLS (pf_app) vs sin RLS (superusuario). */
export function rlsResult(input: {
  id: string;
  title: string;
  withRls: readonly number[];
  withoutRls: readonly number[];
  /** Nodos del plan con RLS (p. ej. `Index Only Scan (posting_balance_ix)`). */
  plan?: string;
  /** `false` ⇒ informativo: se reporta pero no es una brecha (agregado sintético, docs/31 D43). */
  gate?: boolean;
}): BenchResult {
  const a = stats(input.withRls);
  const b = stats(input.withoutRls);
  const ratio = b.p50 > 0 ? (a.p50 - b.p50) / b.p50 : 0;
  const passed = ratio < RLS_OVERHEAD.maxRatio || a.p50 - b.p50 < RLS_OVERHEAD.noiseFloorMs;
  return {
    id: input.id,
    nfr: 'RLS-OVERHEAD',
    title: input.title,
    stats: a,
    value: Math.round(ratio * 1000) / 1000,
    limit: RLS_OVERHEAD.maxRatio,
    unit: 'ratio',
    gate: input.gate ?? true,
    passed,
    notes: `mediana con RLS ${a.p50} ms vs sin RLS ${b.p50} ms (p95 ${a.p95} vs ${b.p95})${
      a.p50 - b.p50 < RLS_OVERHEAD.noiseFloorMs
        ? `; diferencia bajo el piso de ruido (${RLS_OVERHEAD.noiseFloorMs} ms)`
        : ''
    }${input.plan ? `; plan: ${input.plan}` : ''}`,
  };
}

export function buildReport(input: Omit<PerfReport, 'version' | 'breaches'>): PerfReport {
  const breaches = input.results
    .filter((r) => r.gate && !r.passed)
    .map(
      (r) =>
        `${r.nfr} ${r.id}: ${r.value}${r.unit === 'ms' ? ' ms' : ''} > ${r.limit}${r.unit === 'ms' ? ' ms' : ''}`,
    );
  return { version: 1, ...input, breaches };
}

export function renderMarkdown(report: PerfReport): string {
  const fmt = (r: BenchResult) => (r.unit === 'ms' ? `${r.value} ms` : `${(r.value * 100).toFixed(1)} %`);
  const lim = (r: BenchResult) => (r.unit === 'ms' ? `≤ ${r.limit} ms` : `< ${r.limit * 100} %`);
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
  ];
  return lines.join('\n');
}

export function writeReport(report: PerfReport, outDir: string): { json: string; md: string } {
  mkdirSync(outDir, { recursive: true });
  const json = join(outDir, 'perf-results.json');
  const md = join(outDir, 'perf-summary.md');
  writeFileSync(json, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(md, renderMarkdown(report), 'utf8');
  return { json, md };
}
