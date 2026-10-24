import type { BackgroundLoadEntry } from './perf-report.js';
import { median } from './perf-report.js';
import type { ExperimentConfig } from './experiment-env.js';
import type { MetricRecord, SampleRecord } from './experiment.js';

/**
 * Bloque `PERF-EXPERIMENT <label>` que cada corrida de la rama de experimentos imprime al terminar (teardown del
 * global-setup): switches, medianas por benchmark, foto de carga de fondo por suite, resumen del muestreo y los extras
 * (pg_stat_statements y EXPLAIN). Se recoge con `get_job_logs` buscando `PERF-EXPERIMENT <label>`.
 */
export const BLOCK_START = (label: string): string => `PERF-EXPERIMENT ${label} >>>`;
export const BLOCK_END = (label: string): string => `PERF-EXPERIMENT ${label} <<<`;

export interface PurgeEntry {
  readonly kind: 'purge';
  readonly suite: string;
  readonly at: string;
  readonly outbox: number;
  readonly jobs: number;
}

export interface BlockInput {
  readonly config: ExperimentConfig;
  readonly runUrl?: string;
  readonly metrics: readonly (MetricRecord | PurgeEntry)[];
  readonly load: readonly BackgroundLoadEntry[];
  readonly samples: readonly SampleRecord[];
  readonly extras: string;
}

const total = (xs: readonly { count?: number; n?: number }[]): number =>
  xs.reduce((a, x) => a + (x.count ?? x.n ?? 0), 0);

function switchesLine(c: ExperimentConfig): string {
  return [
    `suites=${c.suites.length > 0 ? c.suites.join(',') : '(todas)'}`,
    `purge=${c.purgeBacklog ? '1' : '0'}`,
    `trivial_handler=${c.trivialHandler ? '1' : '0'}`,
    `concurrency=${c.concurrency !== undefined ? String(c.concurrency) : '(por defecto)'}`,
    `one_consumer=${c.oneConsumer ?? '(todos)'}`,
  ].join(' ');
}

const fmt = (v: number | undefined): string =>
  v === undefined || Number.isNaN(v) ? '-' : String(Math.round(v * 100) / 100);

function metricsTable(metrics: readonly MetricRecord[]): string[] {
  if (metrics.length === 0) return ['(sin métricas: ninguna suite registró resultados)'];
  const lines = [
    '| suite | benchmark | valor | unidad | umbral | p50 | p95 | n | nota |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const m of metrics)
    lines.push(
      `| ${m.suite} | ${m.name.replace(/\|/gu, '/')} | ${fmt(m.value)} | ${m.unit} | ${fmt(m.limit)} | ${fmt(m.p50)} | ${fmt(m.p95)} | ${m.n ?? '-'} | ${m.note ?? ''} |`,
    );
  return lines;
}

function loadTable(load: readonly BackgroundLoadEntry[]): string[] {
  if (load.length === 0) return ['(sin fotos de carga de fondo)'];
  const lines = [
    '| hora (UTC) | suite | fase | benchmark | outbox pendiente | trabajos events.* | conexiones | locks no concedidos | loadavg 1m |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const e of load) {
    const s = e.snapshot;
    lines.push(
      `| ${s.takenAt.slice(11, 19)} | ${e.suite} | ${e.phase} | ${(e.benchmark ?? '').replace(/\|/gu, '/')} | ${String(s.outboxPending)} | ${String(total(s.eventJobs))} | ${String(total(s.connections))} | ${String(s.ungrantedLocks)} | ${fmt(s.loadAvg[0])} |`,
    );
  }
  return lines;
}

export function summarizeSamples(samples: readonly SampleRecord[]): string[] {
  if (samples.length === 0) return ['(sin muestras)'];
  const tags = [...new Set(samples.map((s) => s.tag))];
  const lines: string[] = [];
  for (const tag of tags) {
    const mine = samples.filter((s) => s.tag === tag);
    const conns = mine.map((s) => total(s.connections));
    const ungranted = mine.map((s) => total(s.ungranted));
    const active = mine.map((s) => total(s.active));
    const waits = new Map<string, number>();
    const locks = new Map<string, number>();
    for (const s of mine) {
      for (const a of s.active) {
        const key = `${a.waitType}/${a.waitEvent}`;
        waits.set(key, (waits.get(key) ?? 0) + a.n);
      }
      for (const l of s.ungranted) {
        const key = `${l.locktype}/${l.mode} en ${l.relation}`;
        locks.set(key, (locks.get(key) ?? 0) + l.n);
      }
    }
    const top = (m: Map<string, number>, n: number): string =>
      [...m]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([k, v]) => `${k} x${String(v)}`)
        .join('; ') || '-';
    const peakByApp = new Map<string, number>();
    for (const s of mine) {
      const per = new Map<string, number>();
      for (const c of s.connections) {
        const key = `${c.role}/${c.application}`;
        per.set(key, (per.get(key) ?? 0) + c.n);
      }
      for (const [k, v] of per) peakByApp.set(k, Math.max(peakByApp.get(k) ?? 0, v));
    }
    lines.push(
      `- ${tag}: ${String(mine.length)} muestras; conexiones máx ${String(Math.max(...conns))} de ${String(mine[0]!.maxConnections)} (mediana ${fmt(median(conns))}); backends activos máx ${String(Math.max(...active))} (mediana ${fmt(median(active))}); locks no concedidos máx ${String(Math.max(...ungranted))} (muestras con locks: ${String(ungranted.filter((n) => n > 0).length)}); loadavg 1m máx ${fmt(Math.max(...mine.map((s) => s.loadAvg1m)))}`,
      `  - esperas (tipo/evento, suma de backends activos por muestra): ${top(waits, 8)}`,
      `  - locks no concedidos: ${top(locks, 6)}`,
      `  - pico de conexiones por rol/aplicación: ${top(peakByApp, 8)}`,
    );
  }
  return lines;
}

export function renderExperimentBlock(input: BlockInput): string {
  const { config } = input;
  const metrics = input.metrics.filter((m): m is MetricRecord => m.kind === 'metric');
  const purges = input.metrics.filter((m): m is PurgeEntry => m.kind === 'purge');
  const out = [
    BLOCK_START(config.label),
    `label: ${config.label}`,
    `switches: ${switchesLine(config)}`,
    ...(input.runUrl ? [`run: ${input.runUrl}`] : []),
    `generado: ${new Date().toISOString()}`,
    '',
    '## Medianas y p95 por benchmark',
    '',
    ...metricsTable(metrics),
    '',
    '## Purgas del backlog',
    '',
    ...(purges.length === 0
      ? ['(ninguna)']
      : purges.map(
          (p) =>
            `- antes de ${p.suite} (${p.at.slice(11, 19)} UTC): ${String(p.outbox)} eventos del outbox y ${String(p.jobs)} trabajos`,
        )),
    '',
    '## Foto de carga de fondo',
    '',
    ...loadTable(input.load),
    '',
    '## Muestreo (locks, esperas, conexiones)',
    '',
    ...summarizeSamples(input.samples),
    '',
    '## Extras (pg_stat_statements y EXPLAIN)',
    '',
    input.extras.trim() === '' ? '(sin extras)' : input.extras.trim(),
    '',
    BLOCK_END(config.label),
  ];
  return `${out.join('\n')}\n`;
}
