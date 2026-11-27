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
 * 5.2 y 5.3 del change 72 y 5.2 de `refine-spending-anomaly-calibration`; D473, D483 y D514). Corre en el job nightly `perf`; no
 * bloquea los PR.
 *
 *  - TC-FORECAST-ANOMALY-026 (NFR-PERF-012, Should): la pasada diaria del workspace principal con 7 días de gastos nuevos
 *    termina en ≤ 10 s y evalúa gastos.
 *  - TC-FORECAST-ANOMALY-025 (fila BLOQUEANTE del nightly desde D514, que revisa D483 y levanta D488): la evaluación sobre toda
 *    la historia (cada gasto con sus 365 días anteriores, sin persistir) contra las etiquetas `OUTLIER` y
 *    `NEW_COUNTERPARTY_FRAUD` del Large Seed (exportadas fuera de la base por el seed de `nightly.perf.ts`) exige precisión
 *    ≥ 0.80 y recall ≥ 0.85 con el seed a escala completa (`PF_PERF_SCALE=1`, la del nightly). Se publica siempre en consola y en
 *    `anomalies.json`, con los marcados sin etiqueta por criterio y los umbrales usados, sin montos ni descripciones. A una
 *    escala menor (corridas locales con `PF_PERF_SCALE` < 1) solo se mide y se publica: los umbrales de salida son de la
 *    escala completa.
 *  - Los umbrales de detección del Large Seed se fijan con los valores por omisión de la configuración (15, 3, 8 y 99.5).
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
/** Escala del Large Seed (`PF_PERF_SCALE`, por omisión 1 = la del nightly): los umbrales de D514 son de la escala completa. */
const SCALE = Number(process.env['PF_PERF_SCALE'] ?? '1');
const FULL_SCALE = SCALE >= 1;
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
        { scale: SCALE, concurrency: 4, labelsOut: LABELS },
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
  it('[TC-FORECAST-ANOMALY-025] la evaluación contra las etiquetas OUTLIER y NEW_COUNTERPARTY_FRAUD cumple precisión ≥ 0.80 y recall ≥ 0.85 (fila bloqueante, D514)', async () => {
    expect(existsSync(LABELS), `faltan las etiquetas del Large Seed (${LABELS}): sembrar con labelsOut`).toBe(
      true,
    );
    const labels = parseLabels(readFileSync(LABELS, 'utf8'), WS);
    expect(labels.length).toBeGreaterThan(0);
    const started = performance.now();
    const report = await asWorker(() => forecasting.anomalies.backtest.report(WS, labels));
    const seconds = Math.round((performance.now() - started) / 1000);
    console.info(`anomalies backtest (${seconds} s, escala ${SCALE}, fila bloqueante D514):
${formatBacktestReport(report)}`);
    // Se publica siempre, también cuando falla, para ver qué criterio se degradó.
    writeFileSync(
      join(perfOutDir(), 'anomalies.json'),
      `${JSON.stringify({ blocking: FULL_SCALE, decision: 'D514', scale: SCALE, seconds, ...report }, null, 2)}
`,
    );
    expect(report.expected).toBeGreaterThan(0);
    expect(report.precision).not.toBeNull();
    expect(report.recall).not.toBeNull();
    if (FULL_SCALE) {
      expect(Number(report.precision), 'precisión ≥ 0.80').toBeGreaterThanOrEqual(0.8);
      expect(Number(report.recall), 'recall ≥ 0.85').toBeGreaterThanOrEqual(0.85);
      expect(report.passes).toBe(true);
    } else {
      console.warn(
        `[anomalies] escala ${SCALE} < 1: precisión ${report.precision ?? 'n/a'} y recall ${report.recall ?? 'n/a'} solo informativos (los umbrales de D514 son de la escala completa)`,
      );
    }
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
