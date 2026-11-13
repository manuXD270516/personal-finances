import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildFingerprint,
  incompleteSuite,
  jobVerdict,
  persistRowStatus,
  renderImportsSection,
  runnerFactor,
  scheduledJobsInWindow,
  summarizeMaintenance,
  summarizePersistBreakdown,
  summarizeWaits,
  thinDrainTrace,
  waitForRest,
  writeIncompleteReport,
  type DbSample,
  type DrainTraceEntry,
  type ImportsReport,
  type OutboxDiagnosis,
  type PersistBatchSample,
  type PersistTimingsRaw,
  type RestProbe,
  type RestSnapshot,
} from './perf-report.js';

const BUDGET_MS = 20_000;
const T0 = 1_700_000_000_000;

/** 25 lotes de 200 filas con los pasos de un lote típico (ms) que suman `batchMs`. */
function batchesOf(
  count: number,
  batchMs: number,
  overrides: Record<number, number> = {},
): PersistBatchSample[] {
  const out: PersistBatchSample[] = [];
  let at = T0 + 300;
  for (let i = 1; i <= count; i += 1) {
    const dur = overrides[i] ?? batchMs;
    out.push({
      batch: i,
      startedAtMs: at,
      durationMs: dur,
      steps: {
        'load-batch': dur * 0.05,
        'record-batch': dur * 0.8,
        'tx.build': dur * 0.1,
        'tx.ledger': dur * 0.3,
        'tx.transactions': dur * 0.2,
        'tx.outbox': dur * 0.1,
        'tx.lifecycle': dur * 0.1,
        'mark-persisted': dur * 0.04,
        links: dur * 0.04,
        'job-save': dur * 0.02,
      },
    });
    at += dur + 2;
  }
  return out;
}

describe('desglose de la persistencia del import (stabilize-import-persist-perf)', () => {
  it('[TC-PLATFORM-PIPELINE-033] una persistencia de 19 949 ms se publica desglosada con la suma dentro de ±5 % y el veredicto por la total', () => {
    const batches = batchesOf(25, 755);
    const batchesMs = 25 * 755;
    const raw: PersistTimingsRaw = {
      approvedAtMs: T0,
      persistStartedAtMs: T0 + 300,
      persistFinishedAtMs: T0 + 300 + 100 + 60 + batchesMs + 24 * 2 + 250,
      observedAtMs: T0 + 300 + 100 + 60 + batchesMs + 24 * 2 + 250 + 266,
      stageSteps: { begin: 100, timezone: 20, 'pending-batches': 40, close: 250 },
      batches,
    };
    const b = summarizePersistBreakdown(raw, 19_949);
    expect(b.batchCount).toBe(25);
    expect(b.initialWaitMs).toBe(300);
    expect(b.closeMs).toBe(250);
    expect(b.observationMs).toBe(266);
    expect(b.batches).toHaveLength(25);
    // Cada lote publica sus pasos de primer nivel, los anidados de TRANSACTIONS y la confirmación.
    const first = b.batches[0]!;
    expect(Object.keys(first.steps)).toEqual(
      expect.arrayContaining([
        'load-batch',
        'record-batch',
        'tx.ledger',
        'tx.lifecycle',
        'mark-persisted',
        'links',
        'job-save',
        'commit',
      ]),
    );
    expect(b.partsSumMs).toBeGreaterThanOrEqual(18_952);
    expect(b.partsSumMs).toBeLessThanOrEqual(20_946);
    expect(b.withinTolerance).toBe(true);
    // El veredicto de la fila lo decide la persistencia total frente a 20 000 ms, no el desglose.
    expect(persistRowStatus(19_949, BUDGET_MS)).toBe('dentro del presupuesto');
    expect(persistRowStatus(20_001, BUDGET_MS)).toBe('fallida');
  });

  it('[TC-PLATFORM-PIPELINE-033] una suma que se aleja más de ±5 % de la persistencia medida no queda dentro de la tolerancia', () => {
    const raw: PersistTimingsRaw = {
      approvedAtMs: T0,
      persistStartedAtMs: T0 + 100,
      persistFinishedAtMs: T0 + 5_100,
      observedAtMs: T0 + 5_200,
      stageSteps: { begin: 10, close: 10 },
      batches: batchesOf(5, 900),
    };
    expect(summarizePersistBreakdown(raw, 8_000).withinTolerance).toBe(false);
  });

  it('[TC-PLATFORM-PIPELINE-034] el lote 17 de 2 400 ms con mediana de 610 ms se marca atípico (> 1 830 ms) con sus pasos y esperas', () => {
    const batches = batchesOf(25, 610, { 17: 2_400 });
    const lote17 = batches[16]!;
    const samples: DbSample[] = [
      sample(lote17.startedAtMs + 100, { 'IO:WALSync': 2, 'Client:ClientRead': 1 }),
      sample(lote17.startedAtMs + 600, { 'IO:WALSync': 1 }),
      sample(batches[2]!.startedAtMs + 10, { 'IO:DataFileRead': 4 }),
    ];
    const raw: PersistTimingsRaw = {
      approvedAtMs: T0,
      persistStartedAtMs: T0 + 300,
      persistFinishedAtMs: batches.at(-1)!.startedAtMs + batches.at(-1)!.durationMs + 100,
      observedAtMs: batches.at(-1)!.startedAtMs + batches.at(-1)!.durationMs + 400,
      stageSteps: { begin: 50, close: 100 },
      batches,
    };
    const b = summarizePersistBreakdown(raw, 17_000, samples);
    expect(b.medianBatchMs).toBe(610);
    expect(b.outlierThresholdMs).toBe(1_830);
    expect(b.batches.filter((x) => x.outlier).map((x) => x.batch)).toEqual([17]);
    const outlier = b.batches[16]!;
    expect(outlier.durationMs).toBe(2_400);
    expect(outlier.steps['record-batch']).toBeGreaterThan(0);
    // Solo las esperas muestreadas mientras corría el lote 17 (no las del lote 3).
    expect(outlier.waits).toEqual([
      { wait: 'IO:WALSync', samples: 3 },
      { wait: 'Client:ClientRead', samples: 1 },
    ]);
    expect(b.batches[0]!.waits).toBeUndefined();
  });

  it('[TC-PLATFORM-PIPELINE-035] una limpieza automática de la cola y un punto de control se publican con su inicio y su duración, y la medición sigue válida', () => {
    const samples: DbSample[] = [
      sample(T0 + 1_000, {}, { autovacuum: ['pgboss.job_common'] }),
      sample(T0 + 1_250, {}, { autovacuum: ['pgboss.job_common'] }),
      sample(T0 + 1_500, {}, { autovacuum: [] }),
      sample(T0 + 3_000, {}, { checkpoints: 1, checkpointMs: 850 }),
    ];
    const entries = summarizeMaintenance(samples, T0);
    expect(entries).toEqual([
      { kind: 'autovacuum', target: 'pgboss.job_common', startOffsetMs: 1_000, durationMs: 500 },
      { kind: 'checkpoint', startOffsetMs: 3_000, durationMs: 850 },
    ]);
    const report = importsReport({ maintenance: entries });
    const md = renderImportsSection(report).join('\n');
    expect(md).toContain('limpieza automática de pgboss.job_common a +1000 ms durante 500 ms');
    expect(md).toContain('punto de control a +3000 ms durante 850 ms');
    expect(md).toContain('la medición sigue siendo válida');
    expect(report.verdict.kind).toBe('ok');
    // Resumen de esperas: aditivo y sin efecto en el veredicto.
    expect(summarizeWaits([sample(T0, { 'IO:WALSync': 3, 'Lock:relation': 1 })]).byWait[0]).toEqual({
      wait: 'IO:WALSync',
      samples: 3,
      share: 0.75,
    });
  });
});

describe('huella del runner (stabilize-import-persist-perf)', () => {
  it('[TC-PLATFORM-PIPELINE-036] 123 ms frente a 54 ms da el factor 2,28 y la fila del host de 32 723 ms se publica fallida sin repetirse ni invalidarse', () => {
    expect(runnerFactor(123, 54)).toBe(2.28);
    const runner = buildFingerprint({
      cpuModel: 'CPU sintética',
      cpuCount: 4,
      totalMemoryBytes: 16 * 1024 ** 3,
      cpuCalibrationMs: 123,
    });
    expect(runner.cpuFactor).toBe(2.28);
    const report = importsReport({ persistMs: 32_723, runner, persistBudgetMs: BUDGET_MS });
    const md = renderImportsSection(report).join('\n');
    expect(md).toContain('factor 2,28');
    expect(md).toContain('Persistencia:** 32,7 s frente a 20 s: fallida');
    // Informativa: el veredicto y la configuración no cambian por la huella.
    expect(report.verdict.kind).toBe('ok');
    expect(JSON.stringify(report)).not.toContain('invalid');
  });

  it('[TC-PLATFORM-PIPELINE-037] 54 ms frente a 54 ms publica el factor 1,00 y ninguna fila cambia su veredicto', () => {
    expect(runnerFactor(54, 54)).toBe(1);
    const runner = buildFingerprint({
      cpuModel: 'CPU sintética',
      cpuCount: 4,
      totalMemoryBytes: 16 * 1024 ** 3,
      cpuCalibrationMs: 54,
      cpuReferenceMs: 54,
    });
    const withRunner = importsReport({ persistMs: 14_400, runner, persistBudgetMs: BUDGET_MS });
    const without = importsReport({ persistMs: 14_400, persistBudgetMs: BUDGET_MS });
    expect(renderImportsSection(withRunner).join('\n')).toContain('(factor 1,00)');
    expect(withRunner.verdict).toEqual(without.verdict);
    expect(persistRowStatus(withRunner.persistMs, BUDGET_MS)).toBe(
      persistRowStatus(without.persistMs, BUDGET_MS),
    );
  });
});

const diagnosis: OutboxDiagnosis = {
  pending: 37,
  byType: [
    { eventType: 'transactions.TransactionCreated', pending: 30, maxAttempts: 3, lastError: 'boom' },
    { eventType: 'transactions.TransactionPosted', pending: 7, maxAttempts: 1, lastError: null },
  ],
  oldestPendingAgeMs: 540_000,
  longestTransactionMs: 61_000,
  longestTransactionQuery: 'SELECT 1',
};

describe('suites informativas sin completar (D300, D359)', () => {
  it('[TC-PLATFORM-PIPELINE-038] con 37 pendientes al vencer 600 s la ráfaga se publica «sin completar» con el diagnóstico y el job no falla por ella', () => {
    const suite = incompleteSuite({
      suite: 'ráfaga del import (fase A)',
      step: 'publicación del outbox',
      capMs: 600_000,
      diagnosis,
    });
    expect(suite).toMatchObject({ status: 'sin completar', gate: false, step: 'publicación del outbox' });
    const dir = mkdtempSync(join(tmpdir(), 'pf-incomplete-'));
    writeIncompleteReport([suite], dir);
    const json = JSON.parse(
      readFileSync(join(dir, 'incomplete-suites-perf.json'), 'utf8'),
    ) as (typeof suite)[];
    expect(json[0]!.diagnosis.byType.map((t) => t.pending)).toEqual([30, 7]);
    // El veredicto del job no cambia: con la fila del host en 14 400 ms no falla.
    const verdict = jobVerdict({ hostPersistMs: 14_400, persistBudgetMs: BUDGET_MS, incomplete: [suite] });
    expect(verdict.fails).toBe(false);
    expect(verdict.published).toEqual(['ráfaga del import (fase A)']);
  });

  it('[TC-PLATFORM-PIPELINE-038] la sección publicada lista los eventos por tipo, sus intentos y su último error', async () => {
    const { renderIncompleteSection } = await import('./perf-report.js');
    const md = renderIncompleteSection([
      incompleteSuite({ suite: 'ráfaga', step: 'publicación del outbox', capMs: 600_000, diagnosis }),
    ]).join('\n');
    expect(md).toContain('| transactions.TransactionCreated | 30 | 3 | boom |');
    expect(md).toContain('Eventos pendientes en el outbox: 37');
    expect(md).toContain('transacción abierta más larga: 61,0 s (SELECT 1)');
  });

  it('[TC-PLATFORM-PIPELINE-039] con la ráfaga sin completar y la fila del host en 21 300 ms el job falla por la fila del host y publica ambas por separado', () => {
    const suite = incompleteSuite({
      suite: 'ráfaga',
      step: 'publicación del outbox',
      capMs: 600_000,
      diagnosis,
    });
    const verdict = jobVerdict({ hostPersistMs: 21_300, persistBudgetMs: BUDGET_MS, incomplete: [suite] });
    expect(verdict.fails).toBe(true);
    expect(verdict.reasons).toHaveLength(1);
    expect(verdict.reasons[0]).toContain('21300');
    expect(verdict.published).toEqual(['ráfaga']);
  });
});

/** Sonda de reposo con una secuencia de estados: cada `snapshot()` devuelve el siguiente (el último se repite). */
function restProbe(states: RestSnapshot[], tickMs = 2_000): RestProbe & { slept: number } {
  let i = 0;
  let clock = 0;
  const probe = {
    slept: 0,
    snapshot: async () => states[Math.min(i++, states.length - 1)]!,
    sleep: async (ms: number) => {
      probe.slept += ms;
      clock += ms;
    },
    now: () => clock + 0 * tickMs,
  };
  return probe;
}

const AT_REST: RestSnapshot = { outboxPending: 0, openEventJobs: 0, foreignActiveQueries: 0 };

describe('aislamiento entre las configuraciones del import (stabilize-import-persist-perf)', () => {
  it('[TC-PLATFORM-PIPELINE-042] con 12 201 eventos pendientes de la configuración anterior la fila del host no empieza hasta que la base queda en reposo', async () => {
    // La purga con el worker detenido baja el backlog: el primer sondeo aún ve el residuo, el segundo ya no.
    const probe = restProbe([
      { outboxPending: 12_201, openEventJobs: 400, foreignActiveQueries: 0 },
      AT_REST,
    ]);
    const outcome = await waitForRest(probe, { maxWaitMs: 120_000, intervalMs: 2_000 });
    expect(outcome.atRest).toBe(true);
    expect(outcome.samples).toBe(2);
    expect(outcome.violations).toEqual([]);
    expect(probe.slept).toBe(2_000);
  });

  it('[TC-PLATFORM-PIPELINE-042] una base en reposo no espera y una que no baja se publica sin reposo con los motivos al vencer el tope', async () => {
    const calm = await waitForRest(restProbe([AT_REST]), { maxWaitMs: 120_000, intervalMs: 2_000 });
    expect(calm).toMatchObject({ atRest: true, samples: 1, waitedMs: 0 });

    const stuck = await waitForRest(
      restProbe([{ outboxPending: 12_201, openEventJobs: 3, foreignActiveQueries: 1 }]),
      { maxWaitMs: 10_000, intervalMs: 2_000 },
    );
    expect(stuck.atRest).toBe(false);
    expect(stuck.waitedMs).toBe(10_000);
    expect(stuck.violations).toEqual([
      '12201 eventos pendientes en el outbox',
      '3 trabajos events.* abiertos',
      '1 consultas ajenas activas',
    ]);
    const md = renderImportsSection(
      importsReport({
        restBeforeMeasure: {
          purgedOutbox: 12_201,
          purgedJobs: 3,
          vacuumed: ['platform.outbox', 'pgboss.job'],
          atRest: stuck.atRest,
          waitedMs: stuck.waitedMs,
          violations: stuck.violations,
        },
      }),
    ).join('\n');
    expect(md).toContain('purga de 12201 eventos del outbox y 3 trabajos events.*');
    expect(md).toContain('VACUUM (ANALYZE) de platform.outbox, pgboss.job');
    expect(md).toContain('NO quedó en reposo tras 10,0 s');
  });

  it('[TC-PLATFORM-PIPELINE-043] un drenado de 180 s que no llega a 0 se publica con su seguimiento y su diagnóstico sin cambiar el veredicto del job', () => {
    const points: DrainTraceEntry[] = Array.from({ length: 360 }, (_, i) => ({
      afterMs: i * 500,
      outboxPending: 12_201,
      queuedEventJobs: 200,
    }));
    const trace = thinDrainTrace(points);
    // Un punto cada 10 s más el último: 18 puntos de 10 s + el de 0 s + el final.
    expect(trace[0]).toMatchObject({ afterMs: 0 });
    expect(trace.at(-1)).toMatchObject({ afterMs: 179_500 });
    expect(trace.length).toBe(19);

    const report = importsReport({
      persistMs: 13_563,
      drainAfterPersistMs: 180_000,
      drainTrace: trace,
      drainStall: { capMs: 180_000, diagnosis },
      configuration: {
        label: 'code',
        eventConsumerConcurrency: 4,
        workerPoolMax: 52,
        apiPoolMax: 22,
        poolsSum: 85,
        usableConnections: 97,
        gate: false,
      },
    });
    const md = renderImportsSection(report).join('\n');
    expect(md).toContain('El drenado NO terminó dentro de 180,0 s');
    expect(md).toContain('Seguimiento del drenado');
    expect(md).toContain('+10,0 s 12201 / 200');
    // La fila del host con 14 400 ms sigue decidiendo el veredicto del job, no la del código.
    expect(jobVerdict({ hostPersistMs: 14_400, persistBudgetMs: BUDGET_MS, incomplete: [] }).fails).toBe(
      false,
    );
  });
});

describe('trabajos programados dentro de la ventana medida (stabilize-import-persist-perf)', () => {
  it('[TC-PLATFORM-PIPELINE-040] sin trabajos de colas ajenas el reporte publica 0 trabajos programados', () => {
    const rows = [
      { name: 'events.planning.budget-thresholds', startedAtMs: T0 + 100, durationMs: 50 },
      { name: 'imports.persist', startedAtMs: T0 + 10, durationMs: 15_000 },
    ];
    expect(scheduledJobsInWindow(rows, T0, T0 + 60_000)).toEqual([]);
    const md = renderImportsSection(importsReport({ scheduledJobs: [] })).join('\n');
    expect(md).toContain('Trabajos programados ajenos dentro de la ventana: 0.');
  });

  it('[TC-PLATFORM-PIPELINE-041] un trabajo horario de 4 200 ms dentro de la ventana se publica con inicio y duración sin repetir la medición', () => {
    const rows = [
      { name: 'reporting.cash-flow-watch', startedAtMs: T0 + 6_500, durationMs: 4_200 },
      { name: 'reporting.cash-flow-watch', startedAtMs: T0 + 90_000, durationMs: 100 },
      { name: 'events.reporting.data-version', startedAtMs: T0 + 7_000, durationMs: 5 },
    ];
    const jobs = scheduledJobsInWindow(rows, T0, T0 + 60_000);
    expect(jobs).toEqual([{ name: 'reporting.cash-flow-watch', startOffsetMs: 6_500, durationMs: 4_200 }]);
    const report = importsReport({ scheduledJobs: jobs, persistMs: 14_000, persistBudgetMs: BUDGET_MS });
    const md = renderImportsSection(report).join('\n');
    expect(md).toContain('reporting.cash-flow-watch a +6500 ms durante 4200 ms');
    expect(md).toContain('sin repetirse');
    expect(persistRowStatus(report.persistMs, BUDGET_MS)).toBe('dentro del presupuesto');
  });
});

function sample(
  atMs: number,
  waits: Record<string, number>,
  extra: Partial<Pick<DbSample, 'autovacuum' | 'checkpoints' | 'checkpointMs'>> = {},
): DbSample {
  return {
    atMs,
    waits,
    autovacuum: extra.autovacuum ?? [],
    checkpoints: extra.checkpoints ?? 0,
    checkpointMs: extra.checkpointMs ?? 0,
    queuedEventJobs: 0,
    loadAvg1m: 0,
  };
}

function importsReport(overrides: Partial<ImportsReport> = {}): ImportsReport {
  return {
    rows: 5000,
    previewMs: 9_000,
    persistMs: 14_000,
    drainAfterPersistMs: 40_000,
    drainBudgetMs: 120_000,
    drainByConsumer: [],
    verdict: { kind: 'ok', message: 'sin adquisiciones vencidas y drenado dentro del presupuesto' },
    ...overrides,
  };
}
