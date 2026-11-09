/**
 * Desglose de la persistencia del import de 5 000 filas (stabilize-import-persist-perf, design decisión 2): funciones
 * puras que convierten las marcas del recolector y las muestras de la base en lo que publica el reporte. Nada de esto
 * decide un veredicto: el umbral de 20 s de NFR-PERF-007 se aplica a la persistencia total (D152).
 */

/** Pasos del lote que son parte de otro (los mide TRANSACTIONS dentro de `record-batch`): no suman al lote. */
export const NESTED_STEP_PREFIX = 'tx.';

/** Tolerancia de la suma de las partes frente a la persistencia medida (requirement del desglose). */
export const BREAKDOWN_TOLERANCE = 0.05;
/** Un lote es atípico si dura más que este múltiplo de la mediana. */
export const OUTLIER_FACTOR = 3;

export interface PersistBatchSample {
  readonly batch: number;
  /** Instante de inicio (ms desde la época). */
  readonly startedAtMs: number;
  readonly durationMs: number;
  /** Duración de cada paso (`load-batch`, `record-batch`, `tx.ledger`...). */
  readonly steps: Readonly<Record<string, number>>;
}

/** Lo que reúne el recolector del worker más los instantes que observa la prueba. */
export interface PersistTimingsRaw {
  /** La API respondió 202 a la aprobación. */
  readonly approvedAtMs: number;
  readonly persistStartedAtMs: number;
  readonly persistFinishedAtMs: number;
  /** La prueba observó el estado final. */
  readonly observedAtMs: number;
  /** Pasos fuera de los lotes: `begin`, `timezone`, `pending-batches`, `close`. */
  readonly stageSteps: Readonly<Record<string, number>>;
  readonly batches: readonly PersistBatchSample[];
}

export interface BatchWait {
  readonly wait: string;
  readonly samples: number;
}

export interface PersistBatchBreakdown {
  readonly batch: number;
  readonly durationMs: number;
  /** Pasos de primer nivel del lote más `commit` (lo que queda hasta la duración del lote) y `tx.*` anidados. */
  readonly steps: Readonly<Record<string, number>>;
  readonly commitMs: number;
  readonly outlier: boolean;
  /** Esperas muestreadas mientras corría; solo en los lotes atípicos. */
  readonly waits?: readonly BatchWait[];
}

export interface PersistBreakdown {
  readonly initialWaitMs: number;
  readonly beginMs: number;
  readonly setupMs: number;
  readonly batchesMs: number;
  readonly betweenBatchesMs: number;
  readonly closeMs: number;
  readonly observationMs: number;
  readonly partsSumMs: number;
  readonly persistMs: number;
  /** (suma − persistencia) / persistencia. */
  readonly deviation: number;
  readonly withinTolerance: boolean;
  readonly batchCount: number;
  readonly medianBatchMs: number;
  readonly outlierThresholdMs: number;
  readonly stepTotalsMs: Readonly<Record<string, number>>;
  readonly batches: readonly PersistBatchBreakdown[];
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Muestra de la base tomada cada 250 ms durante la persistencia. */
export interface DbSample {
  /** Instante (ms desde la época). */
  readonly atMs: number;
  /** `tipo:evento` de espera de las sesiones activas → cantidad de sesiones. */
  readonly waits: Readonly<Record<string, number>>;
  /** Relaciones que una limpieza automática está procesando (`pg_stat_progress_vacuum`). */
  readonly autovacuum: readonly string[];
  /** Puntos de control ocurridos desde la muestra anterior (`pg_stat_checkpointer`) y su tiempo escrito más sincronizado. */
  readonly checkpoints: number;
  readonly checkpointMs: number;
  /** Trabajos `events.*` encolados y carga del host (`os.loadavg()[0]`). */
  readonly queuedEventJobs: number;
  readonly loadAvg1m: number;
}

export function waitsIn(
  samples: readonly DbSample[],
  fromMs: number,
  toMs: number,
  limit = 5,
): readonly BatchWait[] {
  const counts = new Map<string, number>();
  for (const s of samples) {
    if (s.atMs < fromMs || s.atMs > toMs) continue;
    for (const [wait, n] of Object.entries(s.waits)) counts.set(wait, (counts.get(wait) ?? 0) + n);
  }
  return [...counts]
    .map(([wait, samplesCount]) => ({ wait, samples: samplesCount }))
    .sort((a, b) => b.samples - a.samples || a.wait.localeCompare(b.wait))
    .slice(0, limit);
}

/**
 * Descompone la persistencia en espera inicial, lotes por paso, cierre y observación [TC-PLATFORM-PIPELINE-033], marca
 * los lotes atípicos (> 3 × la mediana) con las esperas muestreadas mientras corrían [TC-PLATFORM-PIPELINE-034] y
 * comprueba que la suma de las partes quede dentro de ±5 % de la persistencia medida.
 */
export function summarizePersistBreakdown(
  raw: PersistTimingsRaw,
  persistMs: number,
  samples: readonly DbSample[] = [],
): PersistBreakdown {
  const ordered = [...raw.batches].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const median = medianOf(ordered.map((b) => b.durationMs));
  const threshold = median * OUTLIER_FACTOR;
  const batches: PersistBatchBreakdown[] = ordered.map((b) => {
    const topLevel = sum(
      Object.entries(b.steps)
        .filter(([k]) => !k.startsWith(NESTED_STEP_PREFIX))
        .map(([, v]) => v),
    );
    const commitMs = Math.max(0, b.durationMs - topLevel);
    const outlier = median > 0 && b.durationMs > threshold;
    const waits = outlier ? waitsIn(samples, b.startedAtMs, b.startedAtMs + b.durationMs) : undefined;
    return {
      batch: b.batch,
      durationMs: round1(b.durationMs),
      steps: {
        ...Object.fromEntries(Object.entries(b.steps).map(([k, v]) => [k, round1(v)])),
        commit: round1(commitMs),
      },
      commitMs: round1(commitMs),
      outlier,
      ...(waits ? { waits } : {}),
    };
  });
  let between = 0;
  for (let i = 1; i < ordered.length; i += 1) {
    const prev = ordered[i - 1] as PersistBatchSample;
    between += Math.max(
      0,
      (ordered[i] as PersistBatchSample).startedAtMs - (prev.startedAtMs + prev.durationMs),
    );
  }
  const stepTotals: Record<string, number> = {};
  for (const b of batches) {
    for (const [k, v] of Object.entries(b.steps)) stepTotals[k] = round1((stepTotals[k] ?? 0) + v);
  }
  const initialWaitMs = Math.max(0, raw.persistStartedAtMs - raw.approvedAtMs);
  const beginMs = raw.stageSteps['begin'] ?? 0;
  const setupMs = (raw.stageSteps['timezone'] ?? 0) + (raw.stageSteps['pending-batches'] ?? 0);
  const batchesMs = sum(ordered.map((b) => b.durationMs));
  const closeMs = raw.stageSteps['close'] ?? 0;
  const observationMs = Math.max(0, raw.observedAtMs - raw.persistFinishedAtMs);
  const partsSumMs = initialWaitMs + beginMs + setupMs + batchesMs + between + closeMs + observationMs;
  const deviation = persistMs > 0 ? (partsSumMs - persistMs) / persistMs : 0;
  return {
    initialWaitMs: Math.round(initialWaitMs),
    beginMs: Math.round(beginMs),
    setupMs: Math.round(setupMs),
    batchesMs: Math.round(batchesMs),
    betweenBatchesMs: Math.round(between),
    closeMs: Math.round(closeMs),
    observationMs: Math.round(observationMs),
    partsSumMs: Math.round(partsSumMs),
    persistMs: Math.round(persistMs),
    deviation: Math.round(deviation * 1000) / 1000,
    withinTolerance: Math.abs(deviation) <= BREAKDOWN_TOLERANCE,
    batchCount: ordered.length,
    medianBatchMs: round1(median),
    outlierThresholdMs: round1(threshold),
    stepTotalsMs: stepTotals,
    batches,
  };
}

// ── Esperas y mantenimiento concurrente ─────────────────────────────────────────────────────────────────────────

export interface WaitSummary {
  readonly samples: number;
  readonly peakLoad1m: number;
  readonly peakQueuedEventJobs: number;
  /** Esperas de la base por tipo, de la más frecuente a la menos. */
  readonly byWait: readonly (BatchWait & { readonly share: number })[];
}

export function summarizeWaits(samples: readonly DbSample[], limit = 10): WaitSummary {
  const counts = new Map<string, number>();
  for (const s of samples) {
    for (const [wait, n] of Object.entries(s.waits)) counts.set(wait, (counts.get(wait) ?? 0) + n);
  }
  const total = sum([...counts.values()]);
  return {
    samples: samples.length,
    peakLoad1m: samples.reduce((m, s) => Math.max(m, s.loadAvg1m), 0),
    peakQueuedEventJobs: samples.reduce((m, s) => Math.max(m, s.queuedEventJobs), 0),
    byWait: [...counts]
      .map(([wait, n]) => ({
        wait,
        samples: n,
        share: total > 0 ? Math.round((n / total) * 1000) / 1000 : 0,
      }))
      .sort((a, b) => b.samples - a.samples || a.wait.localeCompare(b.wait))
      .slice(0, limit),
  };
}

export interface MaintenanceEntry {
  readonly kind: 'autovacuum' | 'checkpoint';
  /** Relación que procesó la limpieza automática; ausente en los puntos de control. */
  readonly target?: string;
  /** Inicio desde el comienzo de la ventana de la persistencia. */
  readonly startOffsetMs: number;
  readonly durationMs: number;
}

/**
 * Mantenimiento concurrente de la base dentro de la ventana [TC-PLATFORM-PIPELINE-035]: cada limpieza automática (desde
 * la primera muestra que la ve hasta la última) y cada punto de control (con su tiempo escrito y sincronizado, o el
 * intervalo de la muestra si la base no lo informa). Publicar mantenimiento NO invalida la medición.
 */
export function summarizeMaintenance(
  samples: readonly DbSample[],
  windowStartMs: number,
  sampleIntervalMs = 250,
): readonly MaintenanceEntry[] {
  const out: MaintenanceEntry[] = [];
  const open = new Map<string, { first: number; last: number }>();
  const ordered = [...samples].sort((a, b) => a.atMs - b.atMs);
  const flush = (target: string, span: { first: number; last: number }): void => {
    out.push({
      kind: 'autovacuum',
      target,
      startOffsetMs: Math.max(0, Math.round(span.first - windowStartMs)),
      durationMs: Math.round(span.last - span.first + sampleIntervalMs),
    });
  };
  for (const s of ordered) {
    const present = new Set(s.autovacuum);
    for (const target of present) {
      const span = open.get(target);
      if (span) span.last = s.atMs;
      else open.set(target, { first: s.atMs, last: s.atMs });
    }
    for (const [target, span] of open) {
      if (!present.has(target)) {
        flush(target, span);
        open.delete(target);
      }
    }
    if (s.checkpoints > 0) {
      out.push({
        kind: 'checkpoint',
        startOffsetMs: Math.max(0, Math.round(s.atMs - windowStartMs)),
        durationMs: Math.round(s.checkpointMs > 0 ? s.checkpointMs : sampleIntervalMs),
      });
    }
  }
  for (const [target, span] of open) flush(target, span);
  return out.sort((a, b) => a.startOffsetMs - b.startOffsetMs);
}

// ── Trabajos programados dentro de la ventana ───────────────────────────────────────────────────────────────────

export interface QueueJobRow {
  readonly name: string;
  readonly startedAtMs: number;
  readonly durationMs: number;
}

export interface ScheduledJobEntry {
  readonly name: string;
  readonly startOffsetMs: number;
  readonly durationMs: number;
}

/** Colas del propio pipeline medido: no son «trabajos programados ajenos». */
export const OWN_QUEUES: readonly string[] = ['imports.persist', 'imports.process'];

/**
 * Trabajos de colas que NO son `events.*` ni del propio import y que empezaron dentro de la ventana (persistencia más
 * drenado) [TC-PLATFORM-PIPELINE-040, TC-PLATFORM-PIPELINE-041]. Se publican con su inicio y su duración; no repiten ni
 * invalidan la medición.
 */
export function scheduledJobsInWindow(
  rows: readonly QueueJobRow[],
  windowStartMs: number,
  windowEndMs: number,
): readonly ScheduledJobEntry[] {
  return rows
    .filter(
      (r) =>
        !r.name.startsWith('events.') &&
        !OWN_QUEUES.includes(r.name) &&
        r.startedAtMs >= windowStartMs &&
        r.startedAtMs <= windowEndMs,
    )
    .map((r) => ({
      name: r.name,
      startOffsetMs: Math.round(r.startedAtMs - windowStartMs),
      durationMs: Math.round(r.durationMs),
    }))
    .sort((a, b) => a.startOffsetMs - b.startOffsetMs);
}

// ── Huella del runner ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Referencia inicial de la calibración de CPU (mediana de las corridas rápidas de la tabla del design: 53–57 ms de la
 * evaluación de reglas). Documentada en docs/23 §5.5. La calibración del harness es una carga sintética propia (sin
 * base): hasta que las primeras corridas del nightly la midan, el factor es una aproximación; la referencia de
 * confirmaciones se fija con esas tres primeras corridas (tarea 5.2).
 */
export const CPU_CALIBRATION_REFERENCE_MS = 54;
/** Sin fijar hasta tener 3 corridas (tarea 5.2 del change 63). */
export const COMMIT_CALIBRATION_REFERENCE: number | null = null;

export interface RunnerFingerprint {
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly totalMemoryMb: number;
  readonly cpuCalibrationMs: number;
  readonly cpuReferenceMs: number;
  /** Calibración de CPU / referencia, con 2 decimales (1,00 = runner de referencia). */
  readonly cpuFactor: number;
  readonly commitsPerSecond: number | null;
  readonly commitReference: number | null;
  /** Referencia / medida (más confirmaciones por segundo ⇒ runner más rápido); `null` sin referencia. */
  readonly commitFactor: number | null;
}

/** Factor relativo de una calibración de tiempo frente a su referencia [TC-PLATFORM-PIPELINE-036, -037]. */
export function runnerFactor(measuredMs: number, referenceMs: number): number {
  return referenceMs > 0 ? Math.round((measuredMs / referenceMs) * 100) / 100 : 0;
}

export function buildFingerprint(input: {
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly totalMemoryBytes: number;
  readonly cpuCalibrationMs: number;
  readonly cpuReferenceMs?: number;
  readonly commitsPerSecond?: number | null;
  readonly commitReference?: number | null;
}): RunnerFingerprint {
  const cpuReferenceMs = input.cpuReferenceMs ?? CPU_CALIBRATION_REFERENCE_MS;
  const commitsPerSecond = input.commitsPerSecond ?? null;
  const commitReference = input.commitReference ?? COMMIT_CALIBRATION_REFERENCE;
  return {
    cpuModel: input.cpuModel,
    cpuCount: input.cpuCount,
    totalMemoryMb: Math.round(input.totalMemoryBytes / (1024 * 1024)),
    cpuCalibrationMs: Math.round(input.cpuCalibrationMs),
    cpuReferenceMs,
    cpuFactor: runnerFactor(input.cpuCalibrationMs, cpuReferenceMs),
    commitsPerSecond,
    commitReference,
    commitFactor:
      commitsPerSecond !== null && commitsPerSecond > 0 && commitReference !== null
        ? Math.round((commitReference / commitsPerSecond) * 100) / 100
        : null,
  };
}

// ── Veredicto de la persistencia y suites informativas ──────────────────────────────────────────────────────────

export type PersistRowStatus = 'dentro del presupuesto' | 'fallida';

/** La fila bloqueante se decide SOLO con la persistencia total frente al presupuesto (nunca con el desglose ni la huella). */
export function persistRowStatus(persistMs: number, budgetMs: number): PersistRowStatus {
  return persistMs <= budgetMs ? 'dentro del presupuesto' : 'fallida';
}

export interface OutboxPendingByType {
  readonly eventType: string;
  readonly pending: number;
  readonly maxAttempts: number;
  readonly lastError: string | null;
}

/** Diagnóstico del outbox al vencer el tope de la preparación de la ráfaga [TC-PLATFORM-PIPELINE-038]. */
export interface OutboxDiagnosis {
  readonly pending: number;
  readonly byType: readonly OutboxPendingByType[];
  readonly oldestPendingAgeMs: number | null;
  /** Transacción abierta más larga de la base (ms) y su consulta recortada, si la hay. */
  readonly longestTransactionMs: number | null;
  readonly longestTransactionQuery: string | null;
  /** `EXPLAIN` de la consulta del relay (cabezas por agregado), recortado. */
  readonly relayPlan?: string;
}

/** Suite informativa que no completó su preparación dentro de su tope. */
export interface IncompleteSuite {
  readonly suite: string;
  readonly status: 'sin completar';
  readonly step: string;
  readonly capMs: number;
  readonly diagnosis: OutboxDiagnosis;
  readonly gate: false;
}

export function incompleteSuite(input: {
  readonly suite: string;
  readonly step: string;
  readonly capMs: number;
  readonly diagnosis: OutboxDiagnosis;
}): IncompleteSuite {
  return { ...input, status: 'sin completar', gate: false };
}

/**
 * Veredicto del job modelado como lo aplica el benchmark: solo las filas bloqueantes fallan; una suite informativa
 * «sin completar» se publica y no suma ningún motivo (D300, D359) [TC-PLATFORM-PIPELINE-038, -039].
 */
export function jobVerdict(input: {
  readonly hostPersistMs: number;
  readonly persistBudgetMs: number;
  readonly incomplete: readonly IncompleteSuite[];
}): { readonly fails: boolean; readonly reasons: readonly string[]; readonly published: readonly string[] } {
  const reasons: string[] = [];
  if (persistRowStatus(input.hostPersistMs, input.persistBudgetMs) === 'fallida') {
    reasons.push(
      `la persistencia de la fila del host (${String(input.hostPersistMs)} ms) supera ${String(input.persistBudgetMs)} ms`,
    );
  }
  return { fails: reasons.length > 0, reasons, published: input.incomplete.map((s) => s.suite) };
}
