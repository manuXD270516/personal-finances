import 'reflect-metadata';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createAuditRuntime } from '@pf/audit/interface/audit.module';
import { formatBacktestReport, type ForecastingRuntime } from '@pf/forecasting/interface/forecasting.module';
import { identityWorkspaceTimeZones } from '@pf/identity/interface/identity.module';
import { runWithRequestContext } from '@pf/platform/api';
import { loadConfig } from '@pf/platform/config';
import { PgOutboxWriter } from '@pf/platform/events';
import { FixedClock, Instant } from '@pf/shared-kernel';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { parseLabels } from '../../src/forecasting/anomaly-backtest-cli.js';
import { AUDIT_POLICIES, financeRuntimes, LIFECYCLE_MACHINES } from '../../src/identity/identity-wiring.js';
import { eventSchemaRegistry } from '../../src/runtime/event-contracts.js';
import { LARGE_MAIN_WORKSPACE_ID, LARGE_MANIFEST } from '../../src/seed/large/large-plan.js';
import { runSeed } from '../../src/seed/run-seed.js';
import { baseEnv, capturingLogger, workerConfig } from '../support/harness.js';
import { anomalyLabelsPath, perfOutDir, recordSuiteLoad } from './background-load.js';

/**
 * Detección de gastos atípicos con el workspace principal del Large Seed (openspec add-spending-anomaly-detection, tareas
 * 5.2 y 5.3; D473 y D483). Corre en el job nightly `perf`; no bloquea los PR.
 *
 *  - TC-FORECAST-ANOMALY-026 (NFR-PERF-012, Should): la pasada diaria del workspace principal con 7 días de gastos nuevos
 *    termina en ≤ 10 s y evalúa gastos.
 *  - TC-FORECAST-ANOMALY-025 (fila INFORMATIVA del nightly desde D488, docs/77): la evaluación sobre toda la historia (cada
 *    gasto con sus 365 días anteriores, sin persistir) contra las etiquetas `OUTLIER` y `NEW_COUNTERPARTY_FRAUD` del Large Seed
 *    (exportadas fuera de la base por el seed de `nightly.perf.ts`) se mide y se publica (consola y `anomalies.json` en el
 *    directorio del reporte) contra los umbrales de D483 (precisión ≥ 0.60 y recall ≥ 0.70), pero no falla el job hasta la
 *    recalibración (openspec refine-spending-anomaly-calibration). El informe no lleva montos ni descripciones.
 *
 * Variables: `PF_PERF_SCALE` (0..1, por omisión 1) para el seed si el workspace no existe, y `PF_PERF_LABELS` (ruta del JSONL de
 * etiquetas; por omisión `anomalies.labels.jsonl` en el directorio del reporte).
 */
const deps = inject('deps');
recordSuiteLoad(import.meta.url, deps.superuserUrl);
const ISSUER = 'https://idp.test/realms/pfos';
const WS = LARGE_MAIN_WORKSPACE_ID;
/** NFR-PERF-012 (docs/02): la pasada diaria de un workspace con el volumen del Large Seed ≤ 10 s. */
const PASS_BUDGET_MS = 10_000;
const LABELS = anomalyLabelsPath();
const workerLog = capturingLogger('finance-worker', 'worker', 'warn');
// Un día después de la última fecha del Large Seed (mediodía en La Paz): los 7 días anteriores traen gastos nuevos.
const clock = new FixedClock(Instant.parse(`${nextDay(LARGE_MANIFEST.anchorDate)}T16:00:00Z`));

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

let worker: Pool;
let forecasting: ForecastingRuntime;

beforeAll(async () => {
  const admin = new Client({ connectionString: deps.superuserUrl });
  await admin.connect();
  try {
    const present = await admin.query('SELECT 1 FROM iam.workspace WHERE id = $1', [WS]);
    if (present.rowCount === 0) {
      // Suite ejecutada sola: siembra el Large Seed y exporta las etiquetas junto a la ejecución.
      await runSeed(
        loadConfig('seed', {
          PFOS_ENV: 'ci',
          LOG_LEVEL: 'warn',
          DATABASE_URL: deps.databaseUrl,
          OIDC_ISSUER_URL: ISSUER,
        }),
        capturingLogger('finance-api', 'seed', 'warn').logger,
        'large',
        { scale: Number(process.env['PF_PERF_SCALE'] ?? '1'), concurrency: 4, labelsOut: LABELS },
      );
    }
  } finally {
    await admin.end();
  }
  worker = new Pool({ connectionString: deps.workerDatabaseUrl, max: 6 });
  const audit = createAuditRuntime({
    pool: worker,
    clock,
    policies: AUDIT_POLICIES,
    timeZones: identityWorkspaceTimeZones(worker),
    machines: LIFECYCLE_MACHINES,
  });
  const finance = financeRuntimes({
    pool: worker,
    clock,
    audit: audit.port,
    lifecycle: audit.lifecycle,
    lifecycleQuery: audit.lifecycleQuery,
    history: audit.history,
    logger: workerLog.logger,
    config: workerConfig(baseEnv(deps)),
    outbox: new PgOutboxWriter(eventSchemaRegistry()),
  });
  forecasting = finance.forecasting;
}, 4 * 3_600_000);

afterAll(async () => {
  await worker?.end();
});

const asWorker = <T>(fn: () => Promise<T>): Promise<T> =>
  runWithRequestContext(
    { actor: { type: 'WORKER', process: 'forecasting.schedule' }, origin: 'recurring' },
    fn,
  );

describe('detección de gastos atípicos con el workspace principal del Large Seed', () => {
  it('[TC-FORECAST-ANOMALY-025] la evaluación contra las etiquetas OUTLIER y NEW_COUNTERPARTY_FRAUD publica precisión y recall frente a 0.60 y 0.70 (fila informativa, D488)', async () => {
    expect(existsSync(LABELS), `faltan las etiquetas del Large Seed (${LABELS}): sembrar con labelsOut`).toBe(
      true,
    );
    const labels = parseLabels(readFileSync(LABELS, 'utf8'), WS);
    expect(labels.length).toBeGreaterThan(0);
    const started = performance.now();
    const report = await asWorker(() => forecasting.anomalies.backtest.report(WS, labels));
    const seconds = Math.round((performance.now() - started) / 1000);
    console.info(`anomalies backtest (${seconds} s, fila informativa D488):
${formatBacktestReport(report)}`);
    // Fila informativa (D488): se mide y se publica siempre; quedar bajo los umbrales de D483 no falla el job.
    writeFileSync(
      join(perfOutDir(), 'anomalies.json'),
      `${JSON.stringify({ blocking: false, decision: 'D488', seconds, ...report }, null, 2)}
`,
    );
    if (!report.passes) {
      console.warn(
        `[anomalies] fila informativa (D488): precisión ${report.precision ?? 'n/a'} y recall ${report.recall ?? 'n/a'} bajo los umbrales de D483 (0.60 y 0.70)`,
      );
    }
    expect(report.expected).toBeGreaterThan(0);
    expect(report.precision).not.toBeNull();
    expect(report.recall).not.toBeNull();
  }, 3_600_000);

  it('[TC-FORECAST-ANOMALY-026] la pasada diaria del workspace principal con 7 días de gastos tarda 10 s o menos', async () => {
    const started = performance.now();
    const outcome = await asWorker(() => forecasting.anomalies.detect.runWorkspace(WS));
    const elapsed = performance.now() - started;
    console.info(
      `anomalies pass: ${Math.round(elapsed)} ms, ${outcome.evaluated} evaluated, ${outcome.flagged} flagged, ${outcome.notRated} without rate (budget ${PASS_BUDGET_MS} ms)`,
    );
    expect(outcome.evaluated).toBeGreaterThan(0);
    expect(elapsed).toBeLessThanOrEqual(PASS_BUDGET_MS);
  }, 600_000);
});
